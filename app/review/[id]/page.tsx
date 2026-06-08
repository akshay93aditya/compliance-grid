import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '../../../src/db/pool';
import { loadReviewItem } from '../../../src/db/review-queue';
import { approveAction, rejectAction } from '../actions';
import { modifyAction } from './actions';

// Server component. Loads a single review_queue item and shows the queued
// reason plus an editable JSON view of the candidate. The reviewer can:
//   - Approve as-is (Phase 1.6.1 approveAction)
//   - Reject (Phase 1.6.1 rejectAction)
//   - Modify: edit the JSON in the textarea and submit, which validates
//     via Zod and commits the modified candidate (Phase 1.6.1 modifyAction)
export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const item = await loadReviewItem(getPool(), id);
  if (!item) notFound();

  const initialJson = JSON.stringify(item.candidate, null, 2);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <nav className="mb-4 text-sm">
        <Link
          className="text-sky-700 underline underline-offset-4 hover:text-sky-900"
          href="/review"
        >
          ← Back to review queue
        </Link>
      </nav>

      <header className="mb-6 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <span>Queue #{item.id}</span>
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
        <h1 className="mt-2 text-xl font-semibold text-slate-900">
          {item.candidate.summary}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
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
        <p className="mt-1 text-xs text-slate-400">
          Queued {new Date(item.created_at).toLocaleString()}
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Why it was queued
        </h2>
        <p className="mt-2 break-words text-sm text-slate-700">{item.reason}</p>
      </section>

      {error ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Could not modify:</span> {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Candidate JSON
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Edit and submit Modify to commit the corrected version. The server
          validates via Zod; invalid JSON or schema errors come back here.
          Leave unchanged and use Approve to commit as-is.
        </p>

        <form action={modifyAction} className="mt-4">
          <input type="hidden" name="id" value={item.id} />
          <textarea
            name="candidate"
            defaultValue={initialJson}
            rows={28}
            className="block w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            spellCheck={false}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 active:bg-sky-800"
            >
              Modify and commit
            </button>
            <form
              action={approveAction}
              className="contents"
            >
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
              >
                Approve as-is
              </button>
            </form>
            <form action={rejectAction} className="contents">
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100"
              >
                Reject
              </button>
            </form>
          </div>
        </form>
      </section>
    </main>
  );
}
