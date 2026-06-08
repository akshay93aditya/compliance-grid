import { randomBytes } from 'node:crypto';

// Tiny prefixed-id helpers. Keeps IDs visually classifiable in logs +
// DB inspections without dragging in a uuid dep.

const HEX_BYTES = 12; // 24 hex chars

export function newUserId(): string {
  return `usr_${randomBytes(HEX_BYTES).toString('hex')}`;
}

export function newOrgId(): string {
  return `org_${randomBytes(HEX_BYTES).toString('hex')}`;
}

export function newEntityId(): string {
  return `ent_${randomBytes(HEX_BYTES).toString('hex')}`;
}

export function newSessionToken(): string {
  // 32 bytes = 64 hex; this token is the cookie value and lives in the
  // sessions table as its primary key. No further hashing — the token is
  // already random and revocable per-row.
  return randomBytes(32).toString('hex');
}
