import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPool } from '../../src/db/pool';
import { generateComplianceHealthReport } from '../../src/engine-c/generate-compliance-health-report';
import type { HealthColor } from '../../src/engine-c/compute-compliance-health';
import { getCurrentSession } from '../../src/auth/current-user';
import { loadProofStateForOrg } from '../../src/vault/proof-records';
import { countDemoData, hasDemoData } from '../../src/db/demo-data';
import { computeCoverageReport } from '../../src/db/coverage';

// Engine D surface. Renders the traffic-light compliance health score
// (D41) for the signed-in user's entity. Pure DB + pure computation;
// no AI cost.
//
// proofState is loaded from the Org Vault's proof_records table; an
// obligation without a row defaults to 'pending' in the rollup. Users
// edit the proof state on `/obligations` (a sister surface that lists
// per-obligation rows with mark-as-complied controls).
export default async function HealthPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/health');
  if (!session.entity) redirect('/onboarding');
  if (!session.org) redirect('/onboarding');
  const ENTITY = session.entity;

  const pool = getPool();
  const [proofState, demoActive, coverage] = await Promise.all([
    loadProofStateForOrg(pool, session.org.id),
    hasDemoData(pool),
    computeCoverageReport(pool, ENTITY),
  ]);
  const demoCounts = demoActive ? await countDemoData(pool) : null;

  const report = await generateComplianceHealthReport(pool, {
    entity: ENTITY,
    proofState,
  });

  const overallTone = toneFor(report.score.overall);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {demoCounts ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            Demo data is loaded — {demoCounts.obligations} obligations from the
            Karnataka labour pilot.
          </p>
          <p className="mt-1 text-amber-800">
            These are <em>not</em> a complete picture of any real entity's
            obligations, even for an IN-KA pvt-ltd manufacturer. They're a
            single regulator's labour rules from one pilot extraction — useful
            for evaluating the engine, not for compliance. Real obligations
            come from running discovery against the Source Index regulators
            that apply to your profile. Clear with{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">
              npm run db:demo:clear
            </code>
            .
          </p>
        </div>
      ) : null}

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance health</h1>
          <p className="mt-1 text-sm text-slate-600">
            {session.org?.name ?? 'Your organisation'}: {ENTITY.entity_type} · {ENTITY.sector} ·{' '}
            {ENTITY.jurisdictions.join(', ')} · {ENTITY.headcount} headcount
          </p>
        </div>
        <div
          className={`rounded-md border px-4 py-2 text-sm font-medium ${overallTone.box}`}
        >
          Overall:{' '}
          <span className={`uppercase tracking-wide ${overallTone.text}`}>
            {report.score.overall}
          </span>
        </div>
      </header>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Coverage report
        </p>
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-mono font-semibold">{coverage.applicable_regulators}</span>{' '}
          regulators in the Source Index apply to your profile (
          {coverage.by_jurisdiction
            .map((b) => `${b.jurisdiction} ${b.applicable}`)
            .join(' · ')}
          ).{' '}
          <span className="font-mono font-semibold text-emerald-700">
            {coverage.covered_regulators}
          </span>{' '}
          have obligations extracted to the CKG;{' '}
          <span className="font-mono font-semibold text-amber-700">
            {coverage.uncovered_regulators}
          </span>{' '}
          are uncovered. The rollup below shows only what we have so far —
          your real compliance picture grows as the uncovered set shrinks.
        </p>
        {coverage.uncovered_sample.length > 0 ? (
          <ul className="mt-3 space-y-0.5 text-xs text-slate-600">
            {coverage.uncovered_sample.map((u) => (
              <li key={u.id} className="font-mono">
                <span className="text-amber-700">⚠</span>{' '}
                {u.id}{' '}
                <span className="text-slate-400">({u.domain})</span>
              </li>
            ))}
            {coverage.uncovered_regulators > coverage.uncovered_sample.length ? (
              <li className="text-slate-400">
                + {coverage.uncovered_regulators - coverage.uncovered_sample.length} more
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Applicable obligations"
          value={report.score.total_applicable}
        />
        <Stat label="Complied" value={report.score.total_complied} />
        <Stat
          label="Open with jail risk"
          value={report.score.total_jail_risk_open}
          highlight={report.score.total_jail_risk_open > 0}
        />
      </section>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Per-domain rollup
      </h2>

      {report.score.per_domain.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No applicable obligations found for {ENTITY.entity_type} in{' '}
          {ENTITY.jurisdictions[0]}.
          {report.loaded_obligation_count > 0 ? (
            <>
              {' '}
              {report.loaded_obligation_count} obligations were loaded but none
              matched your entity's profile.
            </>
          ) : (
            <>
              {' '}
              The CKG has no obligations for this jurisdiction yet — try
              running the pipeline first.
            </>
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {report.score.per_domain.map((d) => {
            const tone = toneFor(d.color);
            return (
              <li
                key={d.domain}
                className={`rounded-lg border bg-white p-4 ${tone.border}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="break-words font-mono text-sm text-slate-800">
                      {d.domain}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {d.total} applicable · {d.complied} complied ·{' '}
                      {d.pending} pending · {d.overdue} overdue
                      {d.jail_risk_open > 0 ? (
                        <>
                          {' '}
                          ·{' '}
                          <span className="font-semibold text-red-700">
                            {d.jail_risk_open} jail-risk open
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${tone.badge}`}
                  >
                    {d.color}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
        <Link
          href="/obligations"
          className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700"
        >
          View obligations &rarr;
        </Link>
        <span className="ml-3 text-xs text-slate-500">
          Mark items as complied to update this rollup.
        </span>
      </div>

      <footer className="mt-8 text-xs text-slate-500">
        Loaded {report.loaded_obligation_count} obligations from the CKG; {report.score.total_applicable} applied to this entity.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-4 ${
        highlight ? 'border-red-300' : 'border-slate-200'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          highlight ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function toneFor(color: HealthColor): {
  box: string;
  text: string;
  border: string;
  badge: string;
} {
  if (color === 'red') {
    return {
      box: 'border-red-300 bg-red-50',
      text: 'text-red-700',
      border: 'border-red-300',
      badge: 'bg-red-100 text-red-700',
    };
  }
  if (color === 'amber') {
    return {
      box: 'border-amber-300 bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-300',
      badge: 'bg-amber-100 text-amber-700',
    };
  }
  return {
    box: 'border-emerald-300 bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
    badge: 'bg-emerald-100 text-emerald-700',
  };
}
