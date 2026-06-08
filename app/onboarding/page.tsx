import { redirect } from 'next/navigation';
import { getCurrentSession } from '../../src/auth/current-user';
import { saveOnboardingAction } from './actions';

const ENTITY_TYPES = [
  { value: 'pvt-ltd', label: 'Private limited (Pvt Ltd)' },
  { value: 'public-ltd', label: 'Public limited' },
  { value: 'llp', label: 'Limited liability partnership (LLP)' },
  { value: 'opc', label: 'One-person company (OPC)' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'proprietorship', label: 'Sole proprietorship' },
  { value: 'huf', label: 'Hindu Undivided Family (HUF)' },
  { value: 'trust', label: 'Trust' },
  { value: 'society', label: 'Society' },
] as const;

// Per D12 pilot: IN-KA + IN-AP. We surface every Indian state/UT so the
// onboarding doesn't lock real users into the pilot scope, but the dropdown
// defaults to IN-KA.
const JURISDICTIONS = [
  'IN', 'IN-AN', 'IN-AP', 'IN-AR', 'IN-AS', 'IN-BR', 'IN-CH', 'IN-CT',
  'IN-DL', 'IN-DN', 'IN-GA', 'IN-GJ', 'IN-HP', 'IN-HR', 'IN-JH', 'IN-JK',
  'IN-KA', 'IN-KL', 'IN-LA', 'IN-LD', 'IN-MH', 'IN-ML', 'IN-MN', 'IN-MP',
  'IN-MZ', 'IN-NL', 'IN-OD', 'IN-PB', 'IN-PY', 'IN-RJ', 'IN-SK', 'IN-TG',
  'IN-TN', 'IN-TR', 'IN-UK', 'IN-UP', 'IN-WB',
];

const SECTORS = [
  'manufacturing',
  'services',
  'it-software',
  'fintech',
  'pharma',
  'retail',
  'logistics',
  'real-estate',
  'agriculture',
  'energy',
  'other',
] as const;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/onboarding');
  if (session.entity) redirect('/health');

  const params = await searchParams;
  const error = params.error;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Tell us about your business</h1>
      <p className="mt-2 text-sm text-slate-600">
        We use this to filter the applicable compliance obligations from the
        Knowledge Graph. You can update these later from settings.
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error === 'invalid'
            ? 'Some fields are missing or invalid. Please review.'
            : 'Saving failed. Try again.'}
        </p>
      ) : null}

      <form action={saveOnboardingAction} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">Entity type</span>
            <select
              name="entity_type"
              required
              defaultValue="pvt-ltd"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {ENTITY_TYPES.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Sector</span>
            <select
              name="sector"
              required
              defaultValue="manufacturing"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Primary jurisdiction</span>
            <select
              name="jurisdiction"
              required
              defaultValue="IN-KA"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              The state of your registered office.
            </span>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Registered state (optional)</span>
            <select
              name="registered_state"
              defaultValue=""
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">— same as jurisdiction —</option>
              {JURISDICTIONS.filter((j) => j !== 'IN').map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Headcount</span>
            <input
              type="number"
              name="headcount"
              required
              min={0}
              defaultValue={20}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-700">Annual turnover (INR)</span>
            <input
              type="number"
              name="annual_turnover_inr"
              required
              min={0}
              step={1000}
              defaultValue={10_000_000}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-700">Incorporation date (optional)</span>
            <input
              type="date"
              name="incorporation_date"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 active:bg-sky-800 sm:w-auto"
        >
          Save and continue
        </button>
      </form>
    </main>
  );
}
