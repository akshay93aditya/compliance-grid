import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPool } from '../../src/db/pool';
import { generateChangeAlerts } from '../../src/engine-a/generate-change-alerts';
import { getCurrentSession } from '../../src/auth/current-user';

// Engine A surface. Renders change alerts sorted by D40 (jail_risk DESC,
// due_date ASC nulls last, change_type 'amended' before 'new').
//
// Each alert is one Sonnet 4.6 projection (~$0.02). To keep page loads
// from burning money, this page applies a hard cap: default 3 alerts,
// max 10 via the ?max= query param. The ?days= param picks the time
// window (default 30 days).
//
// Empty state is the v1 norm: ChangeEvents emission landed in Phase 2.3
// (D39); the historical bulk Phase 1.5.5 ingest predates it so the table
// is empty until new ingest runs (or patrol-detected changes) produce
// fresh events.

const DEFAULT_MAX = 3;
const HARD_CAP = 10;
const DEFAULT_DAYS = 30;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ max?: string; days?: string; entity?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/alerts');
  if (!session.entity) redirect('/onboarding');
  const ENTITY = session.entity;

  const params = await searchParams;

  const rawMax = Number.parseInt(params.max ?? '', 10);
  const maxAlerts = Number.isFinite(rawMax) && rawMax > 0
    ? Math.min(rawMax, HARD_CAP)
    : DEFAULT_MAX;

  const rawDays = Number.parseInt(params.days ?? '', 10);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const useEntityFilter = params.entity !== 'off';

  const result = await generateChangeAlerts(getPool(), {
    since,
    maxAlerts,
    ...(useEntityFilter ? { entity: ENTITY } : {}),
  });

  const estimatedCost = (result.projected_count * 0.02).toFixed(2);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Change alerts</h1>
        <p className="mt-1 text-sm text-slate-600">
          ChangeEvents in the last {days} days
          {useEntityFilter ? (
            <>
              {' '}
              applicable to your entity ({ENTITY.entity_type},{' '}
              {ENTITY.sector}, {ENTITY.jurisdictions[0]})
            </>
          ) : (
            <> across the CKG (no entity filter)</>
          )}
          . Sorted by jail-risk first, then by due-date proximity (D40).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <Link
            href={`/alerts?max=${maxAlerts}&days=${days}&entity=${
              useEntityFilter ? 'off' : 'on'
            }`}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
          >
            {useEntityFilter ? 'Show all (no entity filter)' : 'Filter to demo entity'}
          </Link>
          <span className="text-slate-500">
            Cap{' '}
            <span className="font-mono">{maxAlerts}</span>
            {' '}alerts · est. cost ~${estimatedCost} this page load
          </span>
        </div>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Events in window" value={result.change_events_found} />
        <Stat label="Applicable" value={result.applicable_count} />
        <Stat label="Projected" value={result.projected_count} />
        <Stat label="Skipped (over cap)" value={result.skipped_due_to_cap} />
      </section>

      {result.alerts.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {result.change_events_found === 0 ? (
            <>
              No change events in this window. ChangeEvent emission landed in
              Phase 2.3 (D39); the historical bulk ingest predates it. The
              table grows when new commits land (ingestion or patrol-detected
              changes).
            </>
          ) : useEntityFilter && result.applicable_count === 0 ? (
            <>
              {result.change_events_found} events in this window, but none
              applies to the demo entity. Try{' '}
              <Link
                className="text-sky-700 underline underline-offset-4"
                href={`/alerts?max=${maxAlerts}&days=${days}&entity=off`}
              >
                showing all
              </Link>
              .
            </>
          ) : (
            <>No alerts produced — see counts above.</>
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {result.alerts.map((a) => (
            <li
              key={a.change_event_id}
              className={`rounded-lg border bg-white p-4 ${
                a.card.jail_risk ? 'border-red-300' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <span>{a.change_type}</span>
                    <span>·</span>
                    <span>{a.change_status}</span>
                    {a.due_date ? (
                      <>
                        <span>·</span>
                        <span>due {a.due_date}</span>
                      </>
                    ) : null}
                    {a.card.jail_risk ? (
                      <>
                        <span>·</span>
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                          jail-risk
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-2 break-words text-base font-medium text-slate-900">
                    {a.card.what_to_do}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">{a.card.when}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Proof: {a.card.proof}
                  </p>
                  <p className="mt-2 break-words font-mono text-xs text-slate-500">
                    {a.card.citation}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                {a.card.freshness_label} · {a.card.confidence_label} · detected{' '}
                {new Date(a.detected_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
