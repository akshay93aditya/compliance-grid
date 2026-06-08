import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '../../../src/auth/current-user';
import { signupAction } from './actions';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentSession();
  if (session) redirect(session.entity ? '/health' : '/onboarding');

  const params = await searchParams;
  const error = params.error;

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mt-2 text-sm text-slate-600">
        Set up Compliance Grid for your organization.{' '}
        <Link
          className="text-sky-700 underline underline-offset-4 hover:text-sky-900"
          href="/login"
        >
          Already have an account?
        </Link>
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error === 'email-taken'
            ? 'An account already exists for that email. Try signing in.'
            : error === 'weak-password'
              ? 'Password must be at least 8 characters.'
              : error === 'invalid-email'
                ? 'Enter a valid email address.'
                : 'Sign up failed. Try again.'}
        </p>
      ) : null}

      <form action={signupAction} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="text-slate-700">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Organization name</span>
          <input
            type="text"
            name="org_name"
            required
            placeholder="Acme Manufacturing Pvt Ltd"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Password</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Minimum 8 characters.
          </span>
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 active:bg-sky-800"
        >
          Create account
        </button>
      </form>
    </main>
  );
}
