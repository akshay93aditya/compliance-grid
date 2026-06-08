// User-Agent + contact configuration for the crawler.
//
// Original D28 (2026-05): use a project-identifying UA so site
// administrators could trace traffic back. **Revised 2026-06-07**
// after empirical re-probe of 19 entries tagged blocked: 14/19 (74%)
// returned HTTP 200 immediately with a vanilla Chrome UA. The
// "blocked" category was dominated by UA-discrimination, not real
// access controls.
//
// Final design: send a vanilla Chrome UA so we get through the
// filters, AND a `From:` header (RFC 9110 §10.1.2) with the
// operator's contact address. Site administrators can filter,
// allowlist, or reach out via the address; ordinary WAFs ignore
// unknown headers, so it doesn't reintroduce filtering.
//
// **Contact email is configured per-operator** via the
// `COMPLIANCE_GRID_CONTACT_EMAIL` env var. Set it in your `.env` to
// an address you actually monitor — it gets sent on every fetch.
// The placeholder default is a non-routable address so we never
// silently leak a maintainer's personal email into production
// traffic. Forks should set their own.

const PLACEHOLDER_CONTACT = 'crawler@compliance-grid.local';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Resolved lazily so process.env mutations in tests / scripts are
// honoured. Falls back to the placeholder address when unset.
export function getContactEmail(): string {
  const env = process.env.COMPLIANCE_GRID_CONTACT_EMAIL;
  return env && env.length > 0 ? env : PLACEHOLDER_CONTACT;
}

// Backwards-compatible export — most callers want a string they can
// drop into a header. Captured at module load; long-running processes
// that hot-swap env should call getContactEmail() each time instead.
export const CONTACT_EMAIL = getContactEmail();

// Project identification kept for log telemetry, MCP tools, and any
// future contexts that want to know who's running this.
export const PROJECT_TAG = 'compliance-grid/0.1';
