'use server';

import { redirect } from 'next/navigation';
import { getPool } from '../../../src/db/pool';
import { findUserByEmail } from '../../../src/auth/db';
import { verifyPassword } from '../../../src/auth/password';
import { startSession } from '../../_lib/session';

function safeNext(next: string | null | undefined): string {
  // Open-redirect safety: only allow same-origin relative paths.
  if (!next || typeof next !== 'string') return '/health';
  if (!next.startsWith('/') || next.startsWith('//')) return '/health';
  return next;
}

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNext(String(formData.get('next') ?? ''));

  if (!email || !password) {
    redirect('/login?error=invalid');
  }

  const user = await findUserByEmail(getPool(), email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    redirect('/login?error=invalid');
  }

  await startSession(user.id);
  redirect(next);
}
