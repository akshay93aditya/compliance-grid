'use server';

import { redirect } from 'next/navigation';
import { getPool } from '../../../src/db/pool';
import { findUserByEmail, insertOrg, insertUser } from '../../../src/auth/db';
import { newOrgId, newUserId } from '../../../src/auth/ids';
import { hashPassword } from '../../../src/auth/password';
import { startSession } from '../../_lib/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signupAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const orgName = String(formData.get('org_name') ?? '').trim();

  if (!EMAIL_RE.test(email)) redirect('/signup?error=invalid-email');
  if (password.length < 8) redirect('/signup?error=weak-password');
  if (!orgName) redirect('/signup?error=invalid');

  const pool = getPool();

  // Take-taken check is best-effort; the UNIQUE constraint is the source
  // of truth. If two signups race, one gets the friendly error.
  const existing = await findUserByEmail(pool, email);
  if (existing) redirect('/signup?error=email-taken');

  const userId = newUserId();
  const orgId = newOrgId();

  // Two related inserts; wrap in a transaction so a half-created account
  // doesn't leave an orphan user row.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertUser(client, {
      id: userId,
      email,
      passwordHash: hashPassword(password),
    });
    await insertOrg(client, { id: orgId, name: orgName, ownerId: userId });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Race on the UNIQUE index — recover with the same friendly error.
    if (err instanceof Error && /duplicate key/i.test(err.message)) {
      redirect('/signup?error=email-taken');
    }
    throw err;
  } finally {
    client.release();
  }

  await startSession(userId);
  redirect('/onboarding');
}
