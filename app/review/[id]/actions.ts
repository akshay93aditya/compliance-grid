'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getPool } from '../../../src/db/pool';
import { modifyReview } from '../../../src/review/actions';
import { ObligationCandidate } from '../../../src/schemas/obligation';

const REVIEWER = 'ui-admin';

// Server action for the modify form. Reads the textarea JSON, parses it,
// validates via ObligationCandidate.parse, and commits via modifyReview.
// On JSON or schema error: redirect back to the detail page with the
// error in a query string so the reviewer can fix and resubmit.
export async function modifyAction(formData: FormData): Promise<void> {
  const id = formData.get('id');
  const candidateJson = formData.get('candidate');
  if (typeof id !== 'string' || id.length === 0) return;
  if (typeof candidateJson !== 'string') {
    redirect(`/review/${id}?error=${encodeURIComponent('missing candidate JSON')}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid JSON';
    redirect(`/review/${id}?error=${encodeURIComponent(msg)}`);
  }

  let validated;
  try {
    validated = ObligationCandidate.parse(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid schema';
    redirect(`/review/${id}?error=${encodeURIComponent(msg)}`);
  }

  try {
    await modifyReview(getPool(), {
      review_queue_id: id,
      reviewed_by: REVIEWER,
      modified_candidate: validated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'commit failed';
    redirect(`/review/${id}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath('/review');
  redirect('/review');
}
