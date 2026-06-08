'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '../../src/auth/current-user';
import { getPool } from '../../src/db/pool';
import {
  deleteProofRecord,
  upsertProofRecord,
} from '../../src/vault/proof-records';
import type { ProofState } from '../../src/engine-c/compute-compliance-health';

function isProofState(s: string): s is ProofState {
  return s === 'complied' || s === 'pending' || s === 'overdue';
}

export async function markProofAction(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/obligations');
  if (!session.org) redirect('/onboarding');

  const canonicalId = String(formData.get('canonical_id') ?? '').trim();
  const stateRaw = String(formData.get('state') ?? 'complied').trim();
  if (!canonicalId) return;
  if (!isProofState(stateRaw)) return;

  await upsertProofRecord(getPool(), {
    orgId: session.org.id,
    obligationCanonicalId: canonicalId,
    state: stateRaw,
    markedBy: session.user.id,
  });

  revalidatePath('/obligations');
  revalidatePath('/health');
}

export async function clearProofAction(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/obligations');
  if (!session.org) redirect('/onboarding');

  const canonicalId = String(formData.get('canonical_id') ?? '').trim();
  if (!canonicalId) return;

  await deleteProofRecord(getPool(), {
    orgId: session.org.id,
    obligationCanonicalId: canonicalId,
  });

  revalidatePath('/obligations');
  revalidatePath('/health');
}
