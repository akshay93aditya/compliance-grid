import type { Pool, PoolClient } from 'pg';
import { rowToObligation } from '../gates/dedupe';
import type { Instrument } from '../schemas/instrument';
import type { Obligation } from '../schemas/obligation';

type Executor = Pool | PoolClient;

export interface ObligationFilter {
  // Filter by parent instrument's jurisdiction (joins instruments).
  jurisdiction?: string;
  // Filter to a specific set of instrument ids.
  instrumentIds?: string[];
  // Hard cap on the number of rows returned.
  limit?: number;
  // Coarse DB-side filters (audit finding #7):
  // - entityType drops obligations whose applicability_conditions
  //   require a different entity_type via eq/in (or our entity_type
  //   via neq/nin). evaluateApplicability still runs over the result
  //   to catch finer conditions.
  // - excludeDemo drops `extracted_by='demo'` rows. Production
  //   surfaces pass true so the demo banner doesn't masquerade as
  //   the user's actual compliance.
  entityType?: string;
  excludeDemo?: boolean;
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

// Loads obligations from the CKG, parsed through the Zod schema layer
// for runtime safety. Joins instruments only when a jurisdiction filter
// is supplied so the common path is cheap.
//
// Coarse DB-side filters (audit finding #7) — the predicate type was
// added in PR #80 but the SQL pushdown landed here:
//   - entityType: NOT EXISTS over jsonb_array_elements drops rows
//     whose applicability_conditions require a different entity_type
//     via eq/in or forbid ours via neq/nin.
//   - excludeDemo: simple `extracted_by IS DISTINCT FROM 'demo'`.
//
// evaluateApplicability still runs over the result for sector /
// headcount / turnover threshold conditions that don't map cleanly to
// SQL today.
export async function loadObligations(
  executor: Executor,
  filter: ObligationFilter = {}
): Promise<Obligation[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filter.instrumentIds && filter.instrumentIds.length > 0) {
    params.push(filter.instrumentIds);
    conditions.push(`o.instrument_id = ANY($${params.length}::text[])`);
  }
  let sql = `SELECT o.canonical_id, o.instrument_id, o.section, o.type, o.summary,
                    o.applicability_conditions, o.frequency, o.deadline_rule,
                    o.proof_types, o.penalty, o.source_refs, o.version, o.confidence
             FROM obligations o`;
  if (filter.jurisdiction) {
    sql += ` JOIN instruments i ON o.instrument_id = i.id`;
    params.push(filter.jurisdiction);
    conditions.push(`i.jurisdiction = $${params.length}`);
  }

  if (filter.excludeDemo) {
    conditions.push(`(o.extracted_by IS DISTINCT FROM 'demo')`);
  }

  if (filter.entityType) {
    params.push(filter.entityType);
    const p = `$${params.length}`;
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(o.applicability_conditions) c
       WHERE c->>'field' = 'entity_type'
         AND c->>'op' IN ('eq','in','neq','nin')
         AND CASE
               WHEN c->>'op' = 'eq'  THEN (c->>'value') IS DISTINCT FROM ${p}
               WHEN c->>'op' = 'in'  THEN NOT (c->'value' ? ${p})
               WHEN c->>'op' = 'neq' THEN (c->>'value') = ${p}
               WHEN c->>'op' = 'nin' THEN (c->'value' ? ${p})
               ELSE FALSE
             END
    )`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY o.canonical_id`;
  if (filter.limit !== undefined) {
    params.push(filter.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await executor.query<ObligationRow>(sql, params);
  return rows.map((row) => rowToObligation(row));
}

export interface ObligationContext {
  obligation: Obligation;
  instrument: Instrument;
  // ISO datetime of the most-recently-verified source backing the obligation.
  source_verified_at: string;
}

// Loads everything Projection needs about one obligation: the parsed
// obligation itself, the parent instrument, and the freshness of the source
// row backing it (Source.last_seen for the most recent source_ref). Returns
// undefined when no obligation matches.
export async function loadObligationContext(
  executor: Executor,
  canonicalId: string
): Promise<ObligationContext | undefined> {
  const { rows } = await executor.query<
    ObligationRow & {
      i_id: string;
      i_type: 'Act' | 'Rule' | 'Notification';
      i_title: string;
      i_jurisdiction: string;
      i_citation: string;
    }
  >(
    `SELECT o.canonical_id, o.instrument_id, o.section, o.type, o.summary,
            o.applicability_conditions, o.frequency, o.deadline_rule,
            o.proof_types, o.penalty, o.source_refs, o.version, o.confidence,
            i.id AS i_id, i.type AS i_type, i.title AS i_title,
            i.jurisdiction AS i_jurisdiction, i.citation AS i_citation
     FROM obligations o
     JOIN instruments i ON o.instrument_id = i.id
     WHERE o.canonical_id = $1`,
    [canonicalId]
  );
  if (rows.length === 0) return undefined;
  const row = rows[0]!;

  const obligation = rowToObligation(row);

  const instrument: Instrument = {
    id: row.i_id,
    type: row.i_type,
    title: row.i_title,
    jurisdiction: row.i_jurisdiction as Instrument['jurisdiction'],
    citation: row.i_citation,
  };

  const sourceIds = obligation.source_refs.map((r) => r.source_id);
  let sourceVerifiedAt = new Date().toISOString();
  if (sourceIds.length > 0) {
    const { rows: srows } = await executor.query<{ last_seen: Date }>(
      `SELECT last_seen FROM sources
       WHERE id = ANY($1::text[])
       ORDER BY last_seen DESC LIMIT 1`,
      [sourceIds]
    );
    if (srows.length > 0 && srows[0]) {
      sourceVerifiedAt = new Date(srows[0].last_seen).toISOString();
    }
  }

  return { obligation, instrument, source_verified_at: sourceVerifiedAt };
}

// Batched counterpart to loadObligationContext. Used by Engine A / Engine
// C when projecting N alerts/cards at once — previously each was a
// separate JOIN + a separate Source freshness lookup, which is the
// classic N+1. This collapses both to two queries total regardless of N.
//
// Returns a Map keyed by canonical_id. IDs without a matching obligation
// are simply absent from the map (callers handle missing-context as
// they did before).
export async function loadObligationContexts(
  executor: Executor,
  canonicalIds: string[]
): Promise<Map<string, ObligationContext>> {
  if (canonicalIds.length === 0) return new Map();

  // 1) Single JOIN for every requested canonical_id.
  const { rows } = await executor.query<
    ObligationRow & {
      i_id: string;
      i_type: 'Act' | 'Rule' | 'Notification';
      i_title: string;
      i_jurisdiction: string;
      i_citation: string;
    }
  >(
    `SELECT o.canonical_id, o.instrument_id, o.section, o.type, o.summary,
            o.applicability_conditions, o.frequency, o.deadline_rule,
            o.proof_types, o.penalty, o.source_refs, o.version, o.confidence,
            i.id AS i_id, i.type AS i_type, i.title AS i_title,
            i.jurisdiction AS i_jurisdiction, i.citation AS i_citation
       FROM obligations o
       JOIN instruments i ON o.instrument_id = i.id
      WHERE o.canonical_id = ANY($1::text[])`,
    [canonicalIds]
  );

  // 2) Collect every source_id referenced across all loaded obligations,
  // then pull the freshest last_seen per source_id in one query.
  type ParsedOblig = ReturnType<typeof rowToObligation>;
  const parsedById = new Map<string, { row: typeof rows[number]; obligation: ParsedOblig }>();
  const allSourceIds = new Set<string>();
  for (const row of rows) {
    const obligation = rowToObligation(row);
    parsedById.set(row.canonical_id, { row, obligation });
    for (const r of obligation.source_refs) allSourceIds.add(r.source_id);
  }
  const sourceFreshness = new Map<string, Date>();
  if (allSourceIds.size > 0) {
    const { rows: srows } = await executor.query<{ id: string; last_seen: Date }>(
      `SELECT id, last_seen FROM sources WHERE id = ANY($1::text[])`,
      [[...allSourceIds]]
    );
    for (const sr of srows) sourceFreshness.set(sr.id, sr.last_seen);
  }

  // 3) Stitch obligations to instruments + freshness.
  const out = new Map<string, ObligationContext>();
  const now = new Date();
  for (const [canonicalId, { row, obligation }] of parsedById) {
    const instrument: Instrument = {
      id: row.i_id,
      type: row.i_type,
      title: row.i_title,
      jurisdiction: row.i_jurisdiction as Instrument['jurisdiction'],
      citation: row.i_citation,
    };
    let freshest: Date | undefined;
    for (const r of obligation.source_refs) {
      const ls = sourceFreshness.get(r.source_id);
      if (ls && (!freshest || ls > freshest)) freshest = ls;
    }
    out.set(canonicalId, {
      obligation,
      instrument,
      source_verified_at: (freshest ?? now).toISOString(),
    });
  }
  return out;
}
