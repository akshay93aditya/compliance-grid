import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '../../src/auth/current-user';
import { getPool } from '../../src/db/pool';
import { loadObligations } from '../../src/db/obligations';
import { evaluateApplicability } from '../../src/gates/evaluate-applicability';
import { loadProofStateForOrg } from '../../src/vault/proof-records';
import type { ProofState } from '../../src/engine-c/compute-compliance-health';
import { hasDemoData } from '../../src/db/demo-data';
import { markProofAction, clearProofAction } from './actions';

// Per-obligation list for the signed-in entity. Pure DB + pure
// applicability evaluation; no AI cost. This is the surface where users
// actually edit proof state — the Health page reads the result and shows
// the rollup, the Calendar page renders the AI-polished cards.

const PAGE_SIZE = 25;

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; state?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/obligations');
  if (!session.entity) redirect('/onboarding');
  if (!session.org) redirect('/onboarding');
  const ENTITY = session.entity;

  const params = await searchParams;
  const filter: ProofState | 'all' = (() => {
    const s = params.state;
    if (s === 'complied' || s === 'pending' || s === 'overdue') return s;
    return 'all';
  })();
  const rawPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const pool = getPool();
  const [allLoaded, proofState, demoActive] = await Promise.all([
    loadObligations(pool, { jurisdiction: ENTITY.jurisdictions[0] }),
    loadProofStateForOrg(pool, session.org.id),
    hasDemoData(pool),
  ]);
  const applicable = evaluateApplicability({
    entity: ENTITY,
    obligations: allLoaded,
  });

  const enriched = applicable.map((o) => {
    const state: ProofState = proofState.get(o.canonical_id) ?? 'pending';
    return { obligation: o, state };
  });
  const filtered =
    filter === 'all' ? enriched : enriched.filter((e) => e.state === filter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const counts = {
    all: enriched.length,
    complied: enriched.filter((e) => e.state === 'complied').length,
    pending: enriched.filter((e) => e.state === 'pending').length,
    overdue: enriched.filter((e) => e.state === 'overdue').length,
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {demoActive ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Some or all of these obligations are from the demo seed (Karnataka
          labour pilot). They are <em>not</em> a complete picture of your
          real compliance. Clear with{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">
            npm run db:demo:clear
          </code>{' '}
          and run discovery for your actual obligations.
        </div>
      ) : null}

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Obligations</h1>
          <p className="mt-1 text-sm text-slate-600">
            {session.org.name}: {ENTITY.entity_type} · {ENTITY.sector} ·{' '}
            {ENTITY.jurisdictions.join(', ')}
          </p>
        </div>
        <Link
          href="/health"
          className="text-sm text-sky-700 underline underline-offset-4 hover:text-sky-900"
        >
          ← Back to Health
        </Link>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2 text-xs">
        <FilterLink current={filter} value="all" label={`All ${counts.all}`} />
        <FilterLink current={filter} value="pending" label={`Pending ${counts.pending}`} />
        <FilterLink current={filter} value="complied" label={`Complied ${counts.complied}`} />
        <FilterLink current={filter} value="overdue" label={`Overdue ${counts.overdue}`} />
      </nav>

      {pageItems.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {enriched.length === 0
            ? `No applicable obligations found for ${ENTITY.entity_type} in ${ENTITY.jurisdictions[0]}.`
            : `No obligations in the "${filter}" bucket.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {pageItems.map(({ obligation: o, state }) => {
            const borderTone =
              state === 'complied'
                ? 'border-emerald-300'
                : o.penalty.has_imprisonment
                  ? 'border-red-300'
                  : 'border-slate-200';
            return (
              <li
                key={o.canonical_id}
                className={`rounded-lg border bg-white p-4 ${borderTone}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                      <StateBadge state={state} />
                      <span>·</span>
                      <span>{o.type}</span>
                      <span>·</span>
                      <span>{o.frequency}</span>
                      {o.penalty.has_imprisonment ? (
                        <>
                          <span>·</span>
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                            jail-risk
                          </span>
                        </>
                      ) : null}
                    </div>
                    <p className="mt-2 break-words text-sm font-medium text-slate-900">
                      {o.summary}
                    </p>
                    <p className="mt-1 break-words font-mono text-xs text-slate-500">
                      {o.instrument_ref.instrument_id}
                      {o.instrument_ref.section
                        ? ` · ${o.instrument_ref.section}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {state === 'complied' ? (
                      <form action={clearProofAction}>
                        <input
                          type="hidden"
                          name="canonical_id"
                          value={o.canonical_id}
                        />
                        <button
                          type="submit"
                          className="w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          Reopen
                        </button>
                      </form>
                    ) : (
                      <form action={markProofAction}>
                        <input
                          type="hidden"
                          name="canonical_id"
                          value={o.canonical_id}
                        />
                        <input type="hidden" name="state" value="complied" />
                        <button
                          type="submit"
                          className="w-32 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
                        >
                          Mark complied
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="mt-8 flex items-center justify-between text-sm">
          <PageLink
            page={Math.max(1, page - 1)}
            label="← Previous"
            disabled={page === 1}
            filter={filter}
          />
          <p className="text-slate-500">
            Page {page} of {totalPages} · showing {pageItems.length} of{' '}
            {filtered.length}
          </p>
          <PageLink
            page={Math.min(totalPages, page + 1)}
            label="Next →"
            disabled={page === totalPages}
            filter={filter}
          />
        </nav>
      ) : null}
    </main>
  );
}

function FilterLink({
  current,
  value,
  label,
}: {
  current: string;
  value: 'all' | 'pending' | 'complied' | 'overdue';
  label: string;
}) {
  const isActive = current === value;
  const href =
    value === 'all' ? '/obligations' : `/obligations?state=${value}`;
  return (
    <Link
      href={href}
      className={`rounded-md border px-2.5 py-1 ${
        isActive
          ? 'border-sky-600 bg-sky-50 text-sky-700'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </Link>
  );
}

function StateBadge({ state }: { state: ProofState }) {
  if (state === 'complied') {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
        complied
      </span>
    );
  }
  if (state === 'overdue') {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
        overdue
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
      pending
    </span>
  );
}

function PageLink({
  page,
  label,
  disabled,
  filter,
}: {
  page: number;
  label: string;
  disabled: boolean;
  filter: string;
}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (filter !== 'all') params.set('state', filter);
  return (
    <Link
      href={`/obligations?${params.toString()}`}
      aria-disabled={disabled}
      className={`rounded-md border px-3 py-1.5 ${
        disabled
          ? 'pointer-events-none border-slate-200 text-slate-300'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </Link>
  );
}
