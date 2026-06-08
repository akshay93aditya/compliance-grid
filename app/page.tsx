import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '../src/auth/current-user';

// Marketing-light landing for unauthenticated visitors; redirects to the
// signed-in user's primary surface when there's a session.
export default async function HomePage() {
  const session = await getCurrentSession();
  if (session) {
    redirect(session.entity ? '/health' : '/onboarding');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Compliance Grid</h1>
      <p className="mt-3 text-slate-600">
        Know what compliance applies to your business, when it's due, and what
        proof to keep. Sourced directly from primary regulators with citations
        you can trace.
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700"
          href="/signup"
        >
          Get started
        </Link>
        <Link
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          href="/login"
        >
          Sign in
        </Link>
      </div>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          What's inside
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>
            <strong>Compliance health</strong> — a traffic-light rollup of every
            obligation that applies to your entity.
          </li>
          <li>
            <strong>Compliance calendar</strong> — personalised deadlines as
            plain-language "what to do / when / proof" cards.
          </li>
          <li>
            <strong>Change alerts</strong> — when regulators publish, you hear
            about it before it bites.
          </li>
        </ul>
      </section>
    </main>
  );
}
