import { cookies } from 'next/headers';
import { getPool } from '../db/pool';
import type { EntityProfile } from '../schemas/entity-profile';
import { SESSION_COOKIE } from './constants';
import {
  findEntityProfileByOrgId,
  findOrgByOwnerId,
  findSession,
  findUserById,
  type EntityProfileRow,
  type OrgRow,
  type UserRow,
} from './db';

// Re-exported so app code can keep a single import path.
export { SESSION_COOKIE };

export interface SessionContext {
  user: UserRow;
  org: OrgRow | null;
  entity: EntityProfile | null;
}

// Reads the session cookie, looks up the user + (one) org + (one) entity
// for v1's single-tenant-per-user model. Returns null when there's no
// valid session — every protected page calls this and decides what to do
// (redirect to /login, /onboarding, etc).
//
// Server components and server actions call this; the cookies() API is
// only available in those contexts.
export async function getCurrentSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const pool = getPool();
  const session = await findSession(pool, token);
  if (!session) return null;

  const user = await findUserById(pool, session.user_id);
  if (!user) return null;

  const org = await findOrgByOwnerId(pool, user.id);
  let entity: EntityProfile | null = null;
  if (org) {
    const row = await findEntityProfileByOrgId(pool, org.id);
    entity = row ? rowToEntityProfile(row) : null;
  }

  return { user, org, entity };
}

function rowToEntityProfile(row: EntityProfileRow): EntityProfile {
  // PAN/GSTIN ciphertext is intentionally NOT included in the runtime
  // EntityProfile object — those decrypt only inside the Org Vault path
  // (Chunk C). The engines that take an EntityProfile never read them.
  return {
    entity_id: row.id,
    org_id: row.org_id,
    entity_type: row.entity_type,
    sector: row.sector,
    jurisdictions: row.jurisdictions as EntityProfile['jurisdictions'],
    headcount: row.headcount,
    annual_turnover_inr: row.annual_turnover_inr,
    ...(row.incorporation_date
      ? { incorporation_date: row.incorporation_date }
      : {}),
    ...(row.registered_state
      ? { registered_state: row.registered_state as EntityProfile['registered_state'] }
      : {}),
  };
}
