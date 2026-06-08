import type { Pool, PoolClient } from 'pg';

type Executor = Pool | PoolClient;

// Phase 3.3 (D51) — federation publish helpers. The runner in
// `scripts/publish.ts` composes these into the full
// "load → group → write → commit → push → PR → mark-published" flow.
//
// These helpers do not touch the network, the filesystem, or `gh`. They
// are pure DB primitives so the runner can be tested against an
// in-memory or local-bare-repo fixture and the DB layer can be
// unit-tested independently.

export interface PublishObligationRow {
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
  source_refs: { source_id: string; citation_span: string }[];
  version: string;
  confidence: number;
  // Provenance — included in the published JSONL so the receiver can
  // apply per-extractor trust policies (Phase 3.5+).
  extracted_at: string;
  // Bucket for partitioning the output JSONL files. Inferred from the
  // first referenced source's jurisdiction + domain.
  bucket_jurisdiction: string;
  bucket_domain: string;
}

interface ObligationDbRow extends Omit<
  PublishObligationRow,
  'extracted_at' | 'bucket_jurisdiction' | 'bucket_domain'
> {
  extracted_at: Date;
  bucket_jurisdiction: string;
  bucket_domain: string;
}

// Loads every obligation with `published_at IS NULL`, with its bucket
// coordinates pre-computed from the first source it references. Filters
// out test-leaked rows (URL containing `test.example` etc.) so a publish
// run can't accidentally exfiltrate fixture data.
export async function loadUnpublishedObligations(
  executor: Executor
): Promise<PublishObligationRow[]> {
  const { rows } = await executor.query<ObligationDbRow>(
    `SELECT o.canonical_id, o.instrument_id, o.section, o.type, o.summary,
            o.applicability_conditions, o.frequency, o.deadline_rule,
            o.proof_types, o.penalty, o.source_refs, o.version, o.confidence,
            o.created_at AS extracted_at,
            s.jurisdiction AS bucket_jurisdiction,
            s.domain       AS bucket_domain
     FROM obligations o
     JOIN sources s ON s.id = (o.source_refs->0->>'source_id')
     WHERE o.published_at IS NULL
       AND o.extracted_by IS NULL
       AND s.url !~ '(test\\.example|localhost|127\\.0\\.0\\.1)'
     ORDER BY o.created_at ASC`
  );
  return rows.map((r) => ({
    ...r,
    extracted_at: r.extracted_at.toISOString(),
  }));
}

export interface PublishInstrumentRow {
  id: string;
  type: string;
  title: string;
  jurisdiction: string;
  citation: string;
}

// Loads instruments referenced by the given canonical_ids. Always re-emit
// these even if they were included in a prior publish — the receiver
// dedupes by id, and instrument rows can change (e.g. citation correction).
export async function loadInstrumentsForObligations(
  executor: Executor,
  canonicalIds: string[]
): Promise<PublishInstrumentRow[]> {
  if (canonicalIds.length === 0) return [];
  const { rows } = await executor.query<PublishInstrumentRow>(
    `SELECT DISTINCT i.id, i.type, i.title, i.jurisdiction, i.citation
     FROM instruments i
     JOIN obligations o ON o.instrument_id = i.id
     WHERE o.canonical_id = ANY($1::text[])
     ORDER BY i.id`,
    [canonicalIds]
  );
  return rows;
}

export interface PublishSourceRow {
  id: string;
  jurisdiction: string;
  domain: string;
  url: string;
  fetch_recipe: unknown;
  trust_tier: string;
  last_seen: string;
  content_hash: string;
}

interface SourceDbRow extends Omit<PublishSourceRow, 'last_seen'> {
  last_seen: Date;
}

// Loads sources referenced by the given canonical_ids. Always re-emit;
// receiver dedupes by id.
export async function loadSourcesForObligations(
  executor: Executor,
  canonicalIds: string[]
): Promise<PublishSourceRow[]> {
  if (canonicalIds.length === 0) return [];
  const { rows } = await executor.query<SourceDbRow>(
    `SELECT DISTINCT s.id, s.jurisdiction, s.domain, s.url,
            s.fetch_recipe, s.trust_tier, s.last_seen, s.content_hash
     FROM sources s
     JOIN obligations o
       ON s.id IN (SELECT jsonb_extract_path_text(elem, 'source_id')
                   FROM jsonb_array_elements(o.source_refs) AS elem)
     WHERE o.canonical_id = ANY($1::text[])
     ORDER BY s.id`,
    [canonicalIds]
  );
  return rows.map((r) => ({
    ...r,
    last_seen: r.last_seen.toISOString(),
  }));
}

// Marks the given obligations as published at NOW(). Called by the
// runner only after `git push` + `gh pr create` both succeed — a failed
// publish leaves rows unpublished so the next run retries them.
export async function markObligationsPublished(
  executor: Executor,
  canonicalIds: string[]
): Promise<{ updated: number }> {
  if (canonicalIds.length === 0) return { updated: 0 };
  const result = await executor.query(
    `UPDATE obligations
     SET published_at = NOW()
     WHERE canonical_id = ANY($1::text[]) AND published_at IS NULL`,
    [canonicalIds]
  );
  return { updated: result.rowCount ?? 0 };
}

// Counts how many obligations are still unpublished. Used by the runner
// to short-circuit when there's nothing to do.
export async function countUnpublishedObligations(
  executor: Executor
): Promise<number> {
  const { rows } = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM obligations o
     JOIN sources s ON s.id = (o.source_refs->0->>'source_id')
     WHERE o.published_at IS NULL
       AND o.extracted_by IS NULL
       AND s.url !~ '(test\\.example|localhost|127\\.0\\.0\\.1)'`
  );
  return Number(rows[0]?.count ?? '0');
}
