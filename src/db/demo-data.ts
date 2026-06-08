import type { Pool, PoolClient } from 'pg';

type Executor = Pool | PoolClient;

// Returns true when the local CKG contains any obligation tagged
// `extracted_by = 'demo'`. Surfaces serve a banner so users understand
// they're looking at pilot data, not authoritative compliance for their
// real entity. Loaded eagerly on every protected page render — the query
// is a partial-index count, so it's essentially free.
export async function hasDemoData(executor: Executor): Promise<boolean> {
  const { rows } = await executor.query<{ has_demo: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM obligations WHERE extracted_by = 'demo'
     ) AS has_demo`
  );
  return rows[0]?.has_demo === true;
}

export interface DemoStats {
  obligations: number;
  instruments: number;
  sources: number;
}

// Optional: counts for the banner copy. Pure DB; safe to call on every
// page load.
export async function countDemoData(executor: Executor): Promise<DemoStats> {
  const { rows } = await executor.query<{
    obligations: string;
    instruments: string;
    sources: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM obligations WHERE extracted_by = 'demo')::text AS obligations,
       (SELECT COUNT(DISTINCT instrument_id) FROM obligations WHERE extracted_by = 'demo')::text AS instruments,
       (SELECT COUNT(DISTINCT (sr->>'source_id'))
          FROM obligations, jsonb_array_elements(source_refs) sr
          WHERE extracted_by = 'demo')::text AS sources`
  );
  const r = rows[0];
  if (!r) return { obligations: 0, instruments: 0, sources: 0 };
  return {
    obligations: Number.parseInt(r.obligations, 10),
    instruments: Number.parseInt(r.instruments, 10),
    sources: Number.parseInt(r.sources, 10),
  };
}
