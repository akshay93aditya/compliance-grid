import { redirect } from 'next/navigation';
import { endSession } from '../_lib/session';

// GET is fine for logout in a v1 same-site app — the nav link triggers it
// directly. If we add CSRF tokens later, switch to a server-action POST.
export async function GET(): Promise<never> {
  await endSession();
  redirect('/login');
}
