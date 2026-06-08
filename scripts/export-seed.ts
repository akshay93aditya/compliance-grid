// Phase 3.1 (D50) — Seed CKG export. Dumps the current CKG's public-data
// tables (instruments, sources, obligations) to JSONL under
// `seed/<jurisdiction>/<domain>/*.jsonl`, partitioned by the canonical
// coordinate so new clones can opt in to specific scopes if they want.
//
// Filters out test-leaked rows (URL containing 'test.example' or
// 'localhost') so the committed seed is purely real CKG data.
//
// Does NOT export org-vault tables. Per D50: the boundary is structural.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closePool, getPool } from '../src/db/pool';

const SEED_DIR = 'seed';

// Pattern for rows that are clearly test fixtures and must not be exported.
const TEST_URL_RE = /(test\.example|localhost|127\.0\.0\.1)/i;

async function writeBucketedJsonl<T>(
  bucketed: Map<string, T[]>,
  filename: string
): Promise<{ files: number; rows: number }> {
  let files = 0;
  let total = 0;
  for (const [bucket, items] of bucketed.entries()) {
    const path = `${SEED_DIR}/${bucket}/${filename}`;
    await mkdir(dirname(path), { recursive: true });
    const body = items.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(path, body, 'utf-8');
    files += 1;
    total += items.length;
  }
  return { files, rows: total };
}

interface InstrumentSeed {
  id: string;
  type: string;
  title: string;
  jurisdiction: string;
  citation: string;
}

interface SourceSeed {
  id: string;
  jurisdiction: string;
  domain: string;
  url: string;
  fetch_recipe: unknown;
  trust_tier: string;
  last_seen: string;
  content_hash: string;
}

interface ObligationSeed {
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

async function exportInstruments(): Promise<{ files: number; rows: number }> {
  // Instruments don't carry a domain column at the DB level; we infer the
  // domain from the first source referenced by an obligation against this
  // instrument. An instrument with no obligations is skipped — it would
  // contribute nothing to a downstream operator.
  const { rows } = await getPool().query<InstrumentSeed & { domain: string }>(
    `SELECT i.id, i.type, i.title, i.jurisdiction, i.citation,
            MIN(s.domain) AS domain
     FROM instruments i
     JOIN obligations o ON o.instrument_id = i.id
     JOIN sources s ON s.id = (o.source_refs->0->>'source_id')
     WHERE s.url !~ $1
     GROUP BY i.id, i.type, i.title, i.jurisdiction, i.citation`,
    [TEST_URL_RE.source]
  );

  const bucketed = new Map<string, InstrumentSeed[]>();
  for (const r of rows) {
    const bucket = `${r.jurisdiction}/${r.domain}`;
    if (!bucketed.has(bucket)) bucketed.set(bucket, []);
    bucketed.get(bucket)!.push({
      id: r.id,
      type: r.type,
      title: r.title,
      jurisdiction: r.jurisdiction,
      citation: r.citation,
    });
  }
  return writeBucketedJsonl(bucketed, 'instruments.jsonl');
}

async function exportSources(): Promise<{ files: number; rows: number }> {
  const { rows } = await getPool().query<SourceSeed>(
    `SELECT id, jurisdiction, domain, url, fetch_recipe, trust_tier,
            to_char(last_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen,
            content_hash
     FROM sources
     WHERE url !~ $1
     ORDER BY id`,
    [TEST_URL_RE.source]
  );
  const bucketed = new Map<string, SourceSeed[]>();
  for (const r of rows) {
    const bucket = `${r.jurisdiction}/${r.domain}`;
    if (!bucketed.has(bucket)) bucketed.set(bucket, []);
    bucketed.get(bucket)!.push(r);
  }
  return writeBucketedJsonl(bucketed, 'sources.jsonl');
}

async function exportObligations(): Promise<{ files: number; rows: number }> {
  // Obligation bucket = the bucket of the first source it references.
  // An obligation with multi-jurisdictional sources is bucketed by the
  // first one; cross-bucket cases are rare at v1 and surface as a single
  // entry in one bucket plus a comment in the load script's logs.
  const { rows } = await getPool().query<
    ObligationSeed & { _jurisdiction: string; _domain: string }
  >(
    `SELECT o.canonical_id, o.instrument_id, o.section, o.type, o.summary,
            o.applicability_conditions, o.frequency, o.deadline_rule,
            o.proof_types, o.penalty, o.source_refs, o.version, o.confidence,
            s.jurisdiction AS _jurisdiction,
            s.domain       AS _domain
     FROM obligations o
     JOIN sources s ON s.id = (o.source_refs->0->>'source_id')
     WHERE s.url !~ $1
     ORDER BY o.canonical_id`,
    [TEST_URL_RE.source]
  );
  const bucketed = new Map<string, ObligationSeed[]>();
  for (const r of rows) {
    const bucket = `${r._jurisdiction}/${r._domain}`;
    if (!bucketed.has(bucket)) bucketed.set(bucket, []);
    const { _jurisdiction: _j, _domain: _d, ...seed } = r;
    bucketed.get(bucket)!.push(seed);
  }
  return writeBucketedJsonl(bucketed, 'obligations.jsonl');
}

async function main(): Promise<void> {
  const instruments = await exportInstruments();
  const sources = await exportSources();
  const obligations = await exportObligations();

  console.log(
    JSON.stringify(
      {
        seed_dir: SEED_DIR,
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
