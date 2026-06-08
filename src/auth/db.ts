import type { Pool, PoolClient } from 'pg';
import type { EntityType } from '../schemas/entity-profile';

type Executor = Pool | PoolClient;

// Thin DB layer for the auth tables. Stays narrow on purpose: each
// function does one named SQL thing; the call sites do the composition.

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface OrgRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: Date;
}

export interface EntityProfileRow {
  id: string;
  org_id: string;
  entity_type: EntityType;
  sector: string;
  jurisdictions: string[];
  headcount: number;
  annual_turnover_inr: number;
  incorporation_date: string | null;
  registered_state: string | null;
  pan_encrypted: string | null;
  gstin_encrypted: string | null;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: Date;
}

export async function findUserByEmail(
  executor: Executor,
  email: string
): Promise<UserRow | null> {
  const { rows } = await executor.query<UserRow>(
    `SELECT id, email, password_hash, created_at
       FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function findUserById(
  executor: Executor,
  userId: string
): Promise<UserRow | null> {
  const { rows } = await executor.query<UserRow>(
    `SELECT id, email, password_hash, created_at
       FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function insertUser(
  executor: Executor,
  args: { id: string; email: string; passwordHash: string }
): Promise<void> {
  await executor.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [args.id, args.email.toLowerCase(), args.passwordHash]
  );
}

export async function insertOrg(
  executor: Executor,
  args: { id: string; name: string; ownerId: string }
): Promise<void> {
  await executor.query(
    `INSERT INTO orgs (id, name, owner_id) VALUES ($1, $2, $3)`,
    [args.id, args.name, args.ownerId]
  );
}

export async function findOrgByOwnerId(
  executor: Executor,
  ownerId: string
): Promise<OrgRow | null> {
  const { rows } = await executor.query<OrgRow>(
    `SELECT id, name, owner_id, created_at
       FROM orgs WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [ownerId]
  );
  return rows[0] ?? null;
}

export async function findEntityProfileByOrgId(
  executor: Executor,
  orgId: string
): Promise<EntityProfileRow | null> {
  const { rows } = await executor.query<EntityProfileRow>(
    `SELECT id, org_id, entity_type, sector, jurisdictions, headcount,
            annual_turnover_inr::bigint::text AS annual_turnover_inr_text,
            incorporation_date::text AS incorporation_date,
            registered_state, pan_encrypted, gstin_encrypted
       FROM entity_profiles WHERE org_id = $1 LIMIT 1`,
    [orgId]
  );
  const row = rows[0] as
    | (Omit<EntityProfileRow, 'annual_turnover_inr'> & {
        annual_turnover_inr_text: string;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    annual_turnover_inr: Number.parseInt(row.annual_turnover_inr_text, 10),
  };
}

export async function upsertEntityProfile(
  executor: Executor,
  args: {
    id: string;
    orgId: string;
    entityType: EntityType;
    sector: string;
    jurisdictions: string[];
    headcount: number;
    annualTurnoverInr: number;
    incorporationDate?: string;
    registeredState?: string;
  }
): Promise<void> {
  await executor.query(
    `INSERT INTO entity_profiles (
       id, org_id, entity_type, sector, jurisdictions, headcount,
       annual_turnover_inr, incorporation_date, registered_state
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (org_id) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       sector = EXCLUDED.sector,
       jurisdictions = EXCLUDED.jurisdictions,
       headcount = EXCLUDED.headcount,
       annual_turnover_inr = EXCLUDED.annual_turnover_inr,
       incorporation_date = EXCLUDED.incorporation_date,
       registered_state = EXCLUDED.registered_state,
       updated_at = now()`,
    [
      args.id,
      args.orgId,
      args.entityType,
      args.sector,
      args.jurisdictions,
      args.headcount,
      args.annualTurnoverInr,
      args.incorporationDate ?? null,
      args.registeredState ?? null,
    ]
  );
}

export async function insertSession(
  executor: Executor,
  args: { token: string; userId: string; expiresAt: Date }
): Promise<void> {
  await executor.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [args.token, args.userId, args.expiresAt.toISOString()]
  );
}

export async function findSession(
  executor: Executor,
  token: string
): Promise<SessionRow | null> {
  const { rows } = await executor.query<SessionRow>(
    `SELECT token, user_id, expires_at
       FROM sessions WHERE token = $1 AND expires_at > now() LIMIT 1`,
    [token]
  );
  return rows[0] ?? null;
}

export async function deleteSession(
  executor: Executor,
  token: string
): Promise<void> {
  await executor.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}
