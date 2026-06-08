'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '../../src/db/pool';
import {
  approveReview,
  rejectReview,
} from '../../src/review/actions';

// Default reviewer label used by the UI for v1. A real auth integration
// would replace this with the signed-in user's identifier.
const REVIEWER = 'ui-admin';

export async function approveAction(formData: FormData): Promise<void> {
  const id = formData.get('id');
  if (typeof id !== 'string' || id.length === 0) return;
  await approveReview(getPool(), {
    review_queue_id: id,
    reviewed_by: REVIEWER,
  });
  revalidatePath('/review');
}

export async function rejectAction(formData: FormData): Promise<void> {
  const id = formData.get('id');
  if (typeof id !== 'string' || id.length === 0) return;
  await rejectReview(getPool(), {
    review_queue_id: id,
    reviewed_by: REVIEWER,
  });
  revalidatePath('/review');
}
