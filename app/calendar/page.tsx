import { redirect } from 'next/navigation';
import { getPool } from '../../src/db/pool';
import { generateComplianceCalendar } from '../../src/engine-c/generate-compliance-calendar';
import { getCurrentSession } from '../../src/auth/current-user';

// Engine C surface. Renders the personalized compliance calendar for the
// signed-in user's entity: each applicable obligation as a plain-language
// card with computed due date.
//
// Each card is one Sonnet 4.6 projection (~$0.02). Default cap is 5
// cards (~$0.10 per page load); hard ceiling 15 via the ?max= query
// param. The cap exists to keep casual page loads cheap.

const DEFAULT_MAX = 5;
const HARD_CAP = 15;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ max?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/calendar');
  if (!session.entity) redirect('/onboarding');
  const ENTITY = session.entity;

  const params = await searchParams;
  const rawMax = Number.parseInt(params.max ?? '', 10);
  const maxObligations =
    Number.isFinite(rawMax) && rawMax > 0
      ? Math.min(rawMax, HARD_CAP)
      : DEFAULT_MAX;

  const result = await generateComplianceCalendar(getPool(), {
    entity: ENTITY,
    maxObligations,
  });

  const estimatedCost = (result.projected_card_count * 0.02).toFixed(2);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Compliance calendar</h1>
        <p className="mt-1 text-sm text-slate-600">
          Personalized for {session.org?.name ?? 'your organisation'} ({ENTITY.entity_type},{' '}
          {ENTITY.sector}, {ENTITY.jurisdictions[0]},{' '}
          {ENTITY.headcount} headcount).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Cap <span className="font-mono">{maxObligations}</span> obligations · est. cost ~${estimatedCost} this page load
        </p>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Loaded" value={result.loaded_obligation_count} />
        <Stat label="Applicable" value={result.applicable_obligation_count} />
        <Stat label="Projected" value={result.projected_card_count} />
        <Stat label="Skipped (over cap)" value={result.skipped_due_to_cap} />
      </section>

      {result.cards.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No applicable obligations found for your entity. Either the CKG
          has no obligations matching this profile, or the Applicability
          Engine filtered them all out.
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedCards(result.cards).map((entry) => (
            <li
              key={`${entry.card.citation}-${entry.due_date ?? 'no-due'}`}
              className={`rounded-lg border bg-white p-4 ${
                entry.card.jail_risk ? 'border-red-300' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    {entry.due_date ? (
                      <span>due {entry.due_date}</span>
                    ) : (
                      <span>no fixed due date</span>
                    )}
                    {entry.card.jail_risk ? (
                      <>
                        <span>·</span>
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                          jail-risk
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-2 break-words text-base font-medium text-slate-900">
                    {entry.card.what_to_do}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {entry.card.when}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Proof: {entry.card.proof}
                  </p>
                  <p className="mt-2 break-words font-mono text-xs text-slate-500">
                    {entry.card.citation}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                {entry.card.freshness_label} · {entry.card.confidence_label}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// Sort cards by due_date ASC (nulls last) so the nearest deadline is on top.
// Within the same due-date bucket, jail-risk cards float up.
function sortedCards<T extends { due_date: string | null; card: { jail_risk: boolean } }>(
  cards: T[]
): T[] {
  return [...cards].sort((a, b) => {
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date.localeCompare(b.due_date);
    }
    if (a.card.jail_risk !== b.card.jail_risk) {
      return a.card.jail_risk ? -1 : 1;
    }
    return 0;
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
