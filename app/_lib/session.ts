// Session lifecycle helpers — small wrappers around node:crypto + the
// `cookies()` API + the auth DB layer. App-router only.
//
// Lives under app/_lib because it depends on next/headers (server-only).
// Pure DB lookups stay in src/auth/db.ts.

import { cookies } from 'next/headers';
import { getPool } from '../../src/db/pool';
import {
  deleteSession as dbDeleteSession,
  insertSession,
} from '../../src/auth/db';
import { newSessionToken } from '../../src/auth/ids';
import { SESSION_COOKIE } from '../../src/auth/constants';

// Sessions last 30 days. Stored on the server (sessions table); the
// cookie is the random token only.
const SESSION_TTL_DAYS = 30;

export async function startSession(userId: string): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await insertSession(getPool(), { token, userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await dbDeleteSession(getPool(), token);
  }
  store.delete(SESSION_COOKIE);
}
