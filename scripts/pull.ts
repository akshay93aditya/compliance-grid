// Phase 3.4 (D52) — cg pull runner. Syncs the federated CKG Commons
// (the companion `compliance-grid-data` repo) into the local Postgres.
// Federated incoming runs through the same canonicalize → dedupe →
// commit gate as locally-extracted data, with the extractor's identity
// recorded in `obligations.extracted_by` for provenance.
//
// Required env:
//   DATABASE_URL                       — local CKG to write into
//   COMPLIANCE_GRID_DATA_REMOTE        — git URL of the companion repo
//   COMPLIANCE_GRID_DATA_WORKSPACE     — local path for the clone
// Optional env:
//   COMPLIANCE_GRID_DATA_BASE_BRANCH   — default 'main'
//   PULL_EXTRACTED_BY                  — override the extractor label
//                                        recorded on inserted obligations
//                                        (default: 'commons')
//   PULL_DRY_RUN=1                     — read + parse but do not write to DB

import { readFile, glob } from 'node:fs/promises';
import { relative } from 'node:path';
import { closePool, getPool } from '../src/db/pool';
import { routeCandidate } from '../src/gates/route-candidate';
import {
  upsertPulledInstrument,
  upsertPulledSource,
  type PulledInstrument,
  type PulledSource,
} from '../src/db/pull';
import { ObligationCandidate } from '../src/schemas/obligation';
import { ensureWorkspace } from '../src/publish/git-workspace';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`cg pull: required env var ${name} is not set`);
    process.exit(2);
  }
  return v;
}

interface PullStats {
  instruments: { scanned: number; inserted: number; skipped: number };
  sources: { scanned: number; inserted: number; skipped: number };
  obligations: {
    scanned: number;
    inserted: number;
    versioned: number;
    queued: number;
    rejected: number;
  };
  errors: Array<{ path: string; message: string }>;
}

async function* readJsonl(path: string): AsyncGenerator<unknown> {
  const text = await readFile(path, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      yield JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `cg pull: invalid JSON in ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

async function pullInstruments(
  workspace: string,
  dryRun: boolean,
  stats: PullStats
): Promise<void> {
  for await (const path of glob(`${workspace}/**/instruments.jsonl`)) {
    const rel = relative(workspace, path);
    for await (const raw of readJsonl(path)) {
      stats.instruments.scanned += 1;
      const row = raw as PulledInstrument;
      if (dryRun) continue;
      try {
        const result = await upsertPulledInstrument(getPool(), row);
        if (result.inserted) stats.instruments.inserted += 1;
        else stats.instruments.skipped += 1;
      } catch (err) {
        stats.errors.push({
          path: rel,
          message: `instrument ${row.id ?? '?'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }
}

async function pullSources(
  workspace: string,
  dryRun: boolean,
  stats: PullStats
): Promise<void> {
  for await (const path of glob(`${workspace}/**/sources.jsonl`)) {
    const rel = relative(workspace, path);
    for await (const raw of readJsonl(path)) {
      stats.sources.scanned += 1;
      const row = raw as PulledSource;
      if (dryRun) continue;
      try {
        const result = await upsertPulledSource(getPool(), row);
        if (result.inserted) stats.sources.inserted += 1;
        else stats.sources.skipped += 1;
      } catch (err) {
        stats.errors.push({
          path: rel,
          message: `source ${row.id ?? '?'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }
}

async function pullObligations(
  workspace: string,
  extractedBy: string,
  dryRun: boolean,
  stats: PullStats
): Promise<void> {
  for await (const path of glob(`${workspace}/**/obligations.jsonl`)) {
    const rel = relative(workspace, path);
    for await (const raw of readJsonl(path)) {
      stats.obligations.scanned += 1;
      const row = raw as Record<string, unknown> & {
        canonical_id?: string;
        instrument_id?: string;
        section?: string | null;
        version?: string;
        extracted_at?: string;
      };
      // Re-shape into ObligationCandidate: the commit gate computes
      // canonical_id + version itself, so we drop those from the
      // incoming row. The published JSONL stores `instrument_id` +
      // `section` flat (mirroring the DB column layout); the candidate
      // schema expects a nested `instrument_ref`. Reconstruct it.
      // extracted_at is publisher-side provenance we don't currently
      // persist (no column locally); a future trust-policy phase may
      // want it.
      const {
        canonical_id: _ci,
        version: _v,
        extracted_at: _ea,
        instrument_id,
        section,
        ...rest
      } = row;
      const candidate: Record<string, unknown> = {
        ...rest,
        instrument_ref:
          section !== undefined && section !== null
            ? { instrument_id, section }
            : { instrument_id },
      };
      try {
        const validated = ObligationCandidate.parse(candidate);
        if (dryRun) continue;
        // Per D53: federation incoming runs through routeCandidate, the
        // same gate local extractions use. Sub-threshold confidence or
        // semantic-validation failures land in the review queue with
        // extracted_by preserved; a reviewer's later approve/modify will
        // commit with the right attribution. Federation pulls always
        // suppress ChangeEvent emission per D52.
        const result = await routeCandidate(getPool(), validated, {
          extractedBy,
          emitChangeEvent: false,
        });
        if (result.action === 'committed') {
          if (result.commit.action === 'inserted') {
            stats.obligations.inserted += 1;
          } else {
            stats.obligations.versioned += 1;
          }
        } else {
          stats.obligations.queued += 1;
        }
      } catch (err) {
        stats.obligations.rejected += 1;
        stats.errors.push({
          path: rel,
          message: `obligation ${(row.canonical_id as string) ?? '?'}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }
}

async function main(): Promise<number> {
  const remote = envRequired('COMPLIANCE_GRID_DATA_REMOTE');
  const workspace = envRequired('COMPLIANCE_GRID_DATA_WORKSPACE');
  const baseBranch = process.env.COMPLIANCE_GRID_DATA_BASE_BRANCH ?? 'main';
  const extractedBy = process.env.PULL_EXTRACTED_BY ?? 'commons';
  const dryRun = process.env.PULL_DRY_RUN === '1';

  const startedAt = Date.now();
  await ensureWorkspace(remote, workspace, baseBranch);

  const stats: PullStats = {
    instruments: { scanned: 0, inserted: 0, skipped: 0 },
    sources: { scanned: 0, inserted: 0, skipped: 0 },
    obligations: { scanned: 0, inserted: 0, versioned: 0, queued: 0, rejected: 0 },
    errors: [],
  };

  // Order matters: instruments → sources → obligations so the FKs
  // satisfy as obligation rows commit.
  await pullInstruments(workspace, dryRun, stats);
  await pullSources(workspace, dryRun, stats);
  await pullObligations(workspace, extractedBy, dryRun, stats);

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        result: dryRun ? 'dry-run-success' : 'success',
        workspace: relative(process.cwd(), workspace) || workspace,
        extractor_label: extractedBy,
        elapsed_ms: elapsedMs,
        stats,
      },
      null,
      2
    )
  );

  // Non-zero exit when any row failed parsing or gate validation so
  // an external scheduler can alert on it. Empty pulls are success.
  return stats.errors.length > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    await closePool().catch(() => undefined);
    process.exit(1);
  });
