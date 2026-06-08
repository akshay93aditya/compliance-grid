// Phase 3.1 (D50) — Demo data loader. Reads every JSONL file under `seed/`
// and inserts the rows into the local Postgres. ON CONFLICT (id |
// canonical_id) DO NOTHING so re-running is idempotent and a partially-
// seeded database completes without throwing.
//
// **All obligations are tagged `extracted_by = 'demo'`** so the UI can
// banner them clearly as pilot data rather than authoritative compliance
// for any real entity. The PRD requirement 6 ("day-one non-empty") is
// satisfied here ONLY in demo mode — production-mode fresh installs see
// an empty CKG (per the seed-is-pilot-not-your-compliance correction).
//
// Invoked via `npm run db:demo`; `npm run db:setup` does migrations only.
//
// Insertion order is instruments → sources → obligations because of the
// FK + JSONB-reference dependency chain. ChangeEvents are not seeded:
// they're an audit trail of detection, not knowledge, and emitting fresh
// detection events for the operator's local run is the patrol loop's
// concern (D47).

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';

// Local .env shim — npm-script invocations don't otherwise see .env.
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { closePool, getPool } from '../src/db/pool';

const SEED_DIR = 'seed';

async function* walkJsonl(filename: string): AsyncGenerator<unknown> {
  // Use Node 22+ fs.glob to find every `<filename>` file under seed/.
  for await (const path of glob(`${SEED_DIR}/**/${filename}`)) {
    const text = await readFile(path, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        yield JSON.parse(trimmed);
      } catch (err) {
        throw new Error(
          `load-seed: invalid JSON in ${path}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
}

interface InstrumentRow {
  id: string;
  type: string;
  title: string;
  jurisdiction: string;
  citation: string;
}
interface SourceRow {
  id: string;
  jurisdiction: string;
  domain: string;
  url: string;
  fetch_recipe: Record<string, unknown>;
  trust_tier: string;
  last_seen: string;
  content_hash: string;
}
interface ObligationRow {
  canonical_id: string;
  instrument_id: string;
  section: string | null;
  type: string;
  summary: string;
  applicability_conditions: unknown;
  frequency: string;
  deadline_rule: unknown;
  proof_types: unknown;
  penalty: unknown;
  source_refs: unknown;
  version: string;
  confidence: number;
}

async function loadInstruments(): Promise<{ attempted: number; inserted: number }> {
  let attempted = 0;
  let inserted = 0;
  for await (const raw of walkJsonl('instruments.jsonl')) {
    const r = raw as InstrumentRow;
    attempted += 1;
    const result = await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.type, r.title, r.jurisdiction, r.citation]
    );
    if (result.rowCount && result.rowCount > 0) inserted += 1;
  }
  return { attempted, inserted };
}

async function loadSources(): Promise<{ attempted: number; inserted: number }> {
  let attempted = 0;
  let inserted = 0;
  for await (const raw of walkJsonl('sources.jsonl')) {
    const r = raw as SourceRow;
    attempted += 1;
    const result = await getPool().query(
      `INSERT INTO sources
         (id, jurisdiction, domain, url, fetch_recipe, trust_tier,
          last_seen, content_hash, processed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id,
        r.jurisdiction,
        r.domain,
        r.url,
        JSON.stringify(r.fetch_recipe),
        r.trust_tier,
        r.last_seen,
        r.content_hash,
      ]
    );
    if (result.rowCount && result.rowCount > 0) inserted += 1;
  }
  return { attempted, inserted };
}

async function loadObligations(): Promise<{ attempted: number; inserted: number }> {
  let attempted = 0;
  let inserted = 0;
  for await (const raw of walkJsonl('obligations.jsonl')) {
    const r = raw as ObligationRow;
    attempted += 1;
    const result = await getPool().query(
      `INSERT INTO obligations
         (canonical_id, instrument_id, section, type, summary,
          applicability_conditions, frequency, deadline_rule,
          proof_types, penalty, source_refs, version, confidence,
          extracted_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb,
               $10::jsonb, $11::jsonb, $12, $13, 'demo')
       ON CONFLICT (canonical_id) DO NOTHING`,
      [
        r.canonical_id,
        r.instrument_id,
        r.section,
        r.type,
        r.summary,
        JSON.stringify(r.applicability_conditions),
        r.frequency,
        JSON.stringify(r.deadline_rule),
        JSON.stringify(r.proof_types),
        JSON.stringify(r.penalty),
        JSON.stringify(r.source_refs),
        r.version,
        r.confidence,
      ]
    );
    if (result.rowCount && result.rowCount > 0) inserted += 1;
  }
  return { attempted, inserted };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const instruments = await loadInstruments();
  const sources = await loadSources();
  const obligations = await loadObligations();
  console.log(
    JSON.stringify(
      {
        seed_dir: SEED_DIR,
        elapsed_ms: Date.now() - startedAt,
        instruments,
        sources,
        obligations,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
