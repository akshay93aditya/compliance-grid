import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProofState } from '../engine-c/compute-compliance-health';

type Executor = Pool | PoolClient;

function newProofRecordId(): string {
  return `pf_${randomBytes(12).toString('hex')}`;
}

export interface ProofRecordRow {
  id: string;
  org_id: string;
  obligation_canonical_id: string;
  state: ProofState;
  note: string | null;
  marked_at: Date;
  marked_by: string;
}

// Returns the proofState map shape that computeComplianceHealthScore
// already accepts — canonical_id -> ProofState. Obligations without a
// row in proof_records default to 'pending' downstream (D41 behavior).
export async function loadProofStateForOrg(
  executor: Executor,
  orgId: string
): Promise<Map<string, ProofState>> {
  const { rows } = await executor.query<{
    obligation_canonical_id: string;
    state: ProofState;
  }>(
    `SELECT obligation_canonical_id, state
       FROM proof_records WHERE org_id = $1`,
    [orgId]
  );
  const out = new Map<string, ProofState>();
  for (const r of rows) out.set(r.obligation_canonical_id, r.state);
  return out;
}

// Upserts a single proof state. Latest mark wins; history would land in
// a separate proof_record_events table if a future audit need surfaces.
export async function upsertProofRecord(
  executor: Executor,
  args: {
    orgId: string;
    obligationCanonicalId: string;
    state: ProofState;
    markedBy: string;
    note?: string;
  }
): Promise<void> {
  await executor.query(
    `INSERT INTO proof_records (
       id, org_id, obligation_canonical_id, state, note, marked_by, marked_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (org_id, obligation_canonical_id) DO UPDATE SET
       state     = EXCLUDED.state,
       note      = EXCLUDED.note,
       marked_by = EXCLUDED.marked_by,
       marked_at = now()`,
    [
      newProofRecordId(),
      args.orgId,
      args.obligationCanonicalId,
      args.state,
      args.note ?? null,
      args.markedBy,
    ]
  );
}

export async function deleteProofRecord(
  executor: Executor,
  args: { orgId: string; obligationCanonicalId: string }
): Promise<void> {
  await executor.query(
    `DELETE FROM proof_records
      WHERE org_id = $1 AND obligation_canonical_id = $2`,
    [args.orgId, args.obligationCanonicalId]
  );
}
