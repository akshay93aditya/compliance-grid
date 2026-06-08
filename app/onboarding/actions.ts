'use server';

import { redirect } from 'next/navigation';
import { getPool } from '../../src/db/pool';
import { getCurrentSession } from '../../src/auth/current-user';
import { newEntityId } from '../../src/auth/ids';
import { upsertEntityProfile } from '../../src/auth/db';
import { EntityProfile } from '../../src/schemas/entity-profile';
import { Jurisdiction } from '../../src/schemas/jurisdiction';

export async function saveOnboardingAction(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/onboarding');
  if (!session.org) {
    // A logged-in user without an org is a data drift; safer to bounce
    // them back to signup than to silently create a second org.
    redirect('/signup');
  }

  const entityType = String(formData.get('entity_type') ?? '');
  const sector = String(formData.get('sector') ?? '').trim();
  const jurisdiction = String(formData.get('jurisdiction') ?? '');
  const registeredStateRaw = String(formData.get('registered_state') ?? '').trim();
  const headcountStr = String(formData.get('headcount') ?? '');
  const turnoverStr = String(formData.get('annual_turnover_inr') ?? '');
  const incorporationDateRaw = String(formData.get('incorporation_date') ?? '').trim();

  // Build the candidate object and run it through the canonical Zod
  // schema. If it fails, bounce back with ?error=invalid; the Zod parse
  // catches enum-typos and out-of-range numbers without us re-validating
  // each field in this action.
  const candidateBase = {
    entity_id: newEntityId(),
    org_id: session.org.id,
    entity_type: entityType,
    sector,
    jurisdictions: [jurisdiction],
    headcount: Number(headcountStr),
    annual_turnover_inr: Number(turnoverStr),
  } as Record<string, unknown>;
  if (incorporationDateRaw) {
    candidateBase.incorporation_date = incorporationDateRaw;
  }
  if (registeredStateRaw) {
    // Reject anything that doesn't match the Jurisdiction shape. Empty
    // means "same as jurisdiction" — handled by leaving the field unset.
    const parsed = Jurisdiction.safeParse(registeredStateRaw);
    if (!parsed.success) redirect('/onboarding?error=invalid');
    candidateBase.registered_state = parsed.data;
  }
  const parsed = EntityProfile.safeParse(candidateBase);
  if (!parsed.success) {
    redirect('/onboarding?error=invalid');
  }
  const entity = parsed.data;

  await upsertEntityProfile(getPool(), {
    id: entity.entity_id,
    orgId: entity.org_id,
    entityType: entity.entity_type,
    sector: entity.sector,
    jurisdictions: entity.jurisdictions,
    headcount: entity.headcount,
    annualTurnoverInr: entity.annual_turnover_inr,
    ...(entity.incorporation_date
      ? { incorporationDate: entity.incorporation_date }
      : {}),
    ...(entity.registered_state
      ? { registeredState: entity.registered_state }
      : {}),
  });

  redirect('/health');
}
