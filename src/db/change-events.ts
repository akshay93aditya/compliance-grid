import type { Pool, PoolClient } from 'pg';
import {
  ChangeEvent,
  type ChangeStatus,
  type ChangeType,
} from '../schemas/change-event';

type Executor = Pool | PoolClient;

export interface ChangeEventFilter {
  // Only return events detected at or after this timestamp.
  since?: Date;
  // Restrict to these statuses. Default: ['detected', 'verification-pending', 'confirmed'].
  statuses?: ChangeStatus[];
  // Restrict to these change types. Default: all.
  changeTypes?: ChangeType[];
  // Cap on rows returned.
  limit?: number;
}

interface ChangeEventRow {
  id: string;
  obligation_canonical_id: string;
  change_type: string;
  effective_date: Date;
  source_ref: string;
  detected_at: Date;
  status: string;
}

// Loads ChangeEvent rows from the CKG, parsed through the Zod schema. Used
// by Engine A (`generateChangeAlerts`) to drive alert generation. Returns
// events sorted by detected_at DESC so the most recent changes come first.
export async function loadChangeEvents(
  executor: Executor,
  filter: ChangeEventFilter = {}
): Promise<Array<ChangeEvent>> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filter.since) {
    params.push(filter.since.toISOString());
    conditions.push(`detected_at >= $${params.length}`);
  }

  const statuses = filter.statuses ?? [
    'detected',
    'verification-pending',
    'confirmed',
  ];
  params.push(statuses);
  conditions.push(`status = ANY($${params.length}::text[])`);

  if (filter.changeTypes && filter.changeTypes.length > 0) {
    params.push(filter.changeTypes);
    conditions.push(`change_type = ANY($${params.length}::text[])`);
  }

  let sql = `SELECT id, obligation_canonical_id, change_type,
                    effective_date, source_ref, detected_at, status
             FROM change_events`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY detected_at DESC`;
  if (filter.limit !== undefined) {
    params.push(filter.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await executor.query<ChangeEventRow>(sql, params);
  return rows.map((row) =>
    ChangeEvent.parse({
      id: row.id,
      obligation_ref: row.obligation_canonical_id,
      change_type: row.change_type,
      effective_date:
        row.effective_date instanceof Date
          ? row.effective_date.toISOString().slice(0, 10)
          : String(row.effective_date),
      source_ref: row.source_ref,
      detected_at:
        row.detected_at instanceof Date
          ? row.detected_at.toISOString()
          : String(row.detected_at),
      status: row.status,
    })
  );
}
