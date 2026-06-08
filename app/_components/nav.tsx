import Link from 'next/link';
import { getCurrentSession } from '../../src/auth/current-user';

// Thin top-of-page nav strip shared across surfaces. Static link list for
// v1; no active-route highlighting yet (server-component context doesn't
// have pathname; we'd need a small client wrapper to add it). Keep it
// minimal — function over flourish per the design guidelines.
export async function Nav() {
  const session = await getCurrentSession();

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
        <Link className="font-semibold tracking-tight text-slate-900" href="/">
          Compliance Grid
        </Link>
        {session ? (
          <>
            <span className="ml-2 flex gap-4 text-slate-600">
              <Link className="hover:text-slate-900" href="/health">
                Health
              </Link>
              <Link className="hover:text-slate-900" href="/obligations">
                Obligations
              </Link>
              <Link className="hover:text-slate-900" href="/calendar">
                Calendar
              </Link>
              <Link className="hover:text-slate-900" href="/alerts">
                Alerts
              </Link>
              <Link className="hover:text-slate-900" href="/review">
                Review
              </Link>
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
              <span className="truncate font-mono">{session.user.email}</span>
              <Link
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
                href="/logout"
              >
                Sign out
              </Link>
            </span>
          </>
        ) : (
          <span className="ml-auto flex items-center gap-3 text-xs">
            <Link
              className="text-slate-700 hover:text-slate-900"
              href="/login"
            >
              Sign in
            </Link>
            <Link
              className="rounded-md bg-sky-600 px-2.5 py-1 font-medium text-white hover:bg-sky-700"
              href="/signup"
            >
              Sign up
            </Link>
          </span>
        )}
      </div>
    </nav>
  );
}
