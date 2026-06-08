import Link from 'next/link';
import { getPool } from '../../src/db/pool';
import {
  countPendingReviews,
  loadPendingReviews,
} from '../../src/db/review-queue';
import { approveAction, rejectAction } from './actions';

const PAGE_SIZE = 25;

// Server component. Loads one page of pending review_queue items (oldest
// first, paginated via ?page=N) and renders them as cards with Approve /
// Reject form-actions wired to the Phase 1.6.1 server-side review
// functions. A separate detail page at /review/[id] handles Modify.
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const rawPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [pending, totalPending] = await Promise.all([
    loadPendingReviews(getPool(), { limit: PAGE_SIZE, offset }),
    countPendingReviews(getPool()),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalPending / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="mt-1 text-sm text-slate-600">
            Oldest pending items first. {totalPending} total pending.
          </p>
        </div>
        <p className="text-sm text-slate-500">
          Page {page} of {totalPages}
        </p>
      </header>

      {pending.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Nothing pending on this page.
          {page > 1 ? (
            <>
              {' '}
              <Link
                className="text-sky-700 underline underline-offset-4"
                href="/review"
              >
                Go to page 1
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : (
        <ul className="space-y-4">
          {pending.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <Link
                      className="text-sky-700 underline underline-offset-4 hover:text-sky-900"
                      href={`/review/${item.id}`}
                    >
                      Queue #{item.id}
                    </Link>
                    <span>·</span>
                    <span>
                      Confidence{' '}
                      <span className="font-mono text-slate-700">
                        {item.confidence.toFixed(2)}
                      </span>
                    </span>
                    <span>·</span>
                    <span>{item.candidate.type}</span>
                    {item.candidate.penalty.has_imprisonment ? (
                      <>
                        <span>·</span>
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                          jail-risk
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-2 break-words text-base font-medium text-slate-900">
                    {item.candidate.summary}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Instrument:{' '}
                    <span className="font-mono">
                      {item.candidate.instrument_ref.instrument_id}
                    </span>
                    {item.candidate.instrument_ref.section ? (
                      <>
                        {' '}
                        ·{' '}
                        <span className="font-mono">
                          {item.candidate.instrument_ref.section}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <form action={approveAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="w-24 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
                    >
                      Approve
                    </button>
                  </form>
                  <Link
                    href={`/review/${item.id}`}
                    className="w-24 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-center text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100"
                  >
                    Modify
                  </Link>
                  <form action={rejectAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="w-24 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Why it was queued
                  </h3>
                  <p className="mt-1 break-words text-sm text-slate-700">
                    {item.reason}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Frequency · Deadline
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {item.candidate.frequency}
                    {' · '}
                    {summarizeDeadlineRule(item.candidate.deadline_rule)}
                  </p>
                </div>
              </div>

              {item.candidate.applicability_conditions.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Applicability conditions
                  </h3>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                    {item.candidate.applicability_conditions.map((c, i) => (
                      <li key={i} className="font-mono">
                        {c.field} {c.op} {JSON.stringify(c.value)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="mt-4 text-xs text-slate-400">
                Queued {new Date(item.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="mt-8 flex items-center justify-between text-sm">
          <Link
            href={`/review?page=${Math.max(1, page - 1)}`}
            aria-disabled={page === 1}
            className={`rounded-md border px-3 py-1.5 ${
              page === 1
                ? 'pointer-events-none border-slate-200 text-slate-300'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            ← Previous
          </Link>
          <p className="text-slate-500">
            Page {page} of {totalPages}
          </p>
          <Link
            href={`/review?page=${Math.min(totalPages, page + 1)}`}
            aria-disabled={page === totalPages}
            className={`rounded-md border px-3 py-1.5 ${
              page === totalPages
                ? 'pointer-events-none border-slate-200 text-slate-300'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Next →
          </Link>
        </nav>
      ) : null}
    </main>
  );
}

function summarizeDeadlineRule(rule: {
  kind: string;
  month?: number;
  day?: number;
  days?: number;
  event?: string;
}): string {
  if (rule.kind === 'fixed-date' && rule.month !== undefined && rule.day !== undefined) {
    return `fixed ${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
  }
  if (rule.kind === 'period-offset' && rule.days !== undefined) {
    return `+${rule.days}d after period end`;
  }
  if (rule.kind === 'event-offset' && rule.days !== undefined && rule.event) {
    return `+${rule.days}d after ${rule.event}`;
  }
  return rule.kind;
}
