import type { Pool, PoolClient } from 'pg';
import { Obligation, type ObligationType } from '../schemas/obligation';

type Executor = Pool | PoolClient;

export type DedupeResult =
  | { kind: 'existing'; obligation: Obligation }
  | { kind: 'new' };

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

export function rowToObligation(row: ObligationRow): Obligation {
  return Obligation.parse({
    canonical_id: row.canonical_id,
    instrument_ref: {
      instrument_id: row.instrument_id,
      ...(row.section ? { section: row.section } : {}),
    },
    type: row.type,
    summary: row.summary,
    applicability_conditions: row.applicability_conditions,
    frequency: row.frequency,
    deadline_rule: row.deadline_rule,
    proof_types: row.proof_types,
    penalty: row.penalty,
    source_refs: row.source_refs,
    version: row.version,
    confidence: row.confidence,
  });
}

// Looks up an existing obligation by D8's canonical key (instrument + section + type).
// Jurisdiction is derived via the instrument and so does not appear in the lookup.
// Returns { kind: 'new' } if no row matches; { kind: 'existing', obligation }
// otherwise. Uses `IS NOT DISTINCT FROM` so NULL sections compare as equal.
export async function dedupe(
  executor: Executor,
  input: {
    instrument_id: string;
    section?: string | null;
    type: ObligationType;
  }
): Promise<DedupeResult> {
  const { rows } = await executor.query<ObligationRow>(
    `SELECT canonical_id, instrument_id, section, type, summary,
            applicability_conditions, frequency, deadline_rule,
            proof_types, penalty, source_refs, version, confidence
     FROM obligations
     WHERE instrument_id = $1
       AND section IS NOT DISTINCT FROM $2
       AND type = $3`,
    [input.instrument_id, input.section ?? null, input.type]
  );
  if (rows.length === 0) return { kind: 'new' };
  if (rows.length > 1) {
    throw new Error(
      `dedupe: canonical key uniqueness violated; got ${rows.length} rows`
    );
  }
  return { kind: 'existing', obligation: rowToObligation(rows[0]!) };
}
