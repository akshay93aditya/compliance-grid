# Compliance Grid

The "UPI/ONDC for compliance." An AI-first infrastructure layer that maintains a single, shared, deduplicated knowledge graph of India's regulatory obligations, keeps it current automatically, and turns it into simple, cited, personalized guidance for any organization.

> **v0.1.0**. Engine, CLI, Source Index (436 regulator portals), 6 verified extraction recipes, federation primitives, Next.js app. See [CHANGELOG.md](CHANGELOG.md) for what shipped, [ROADMAP.md](ROADMAP.md) for what's next.

## Why this exists
Indian businesses face roughly 69,000 regulatory obligations across 1,536 laws, with about 9,000 changes a year spread over roughly 3,700 government websites, much of it in scanned, non-machine-readable formats. Two in five obligations carry imprisonment as a penalty. No shared, canonical, machine-usable map of "what the law requires of you" exists. This builds that map as infrastructure.

## Core idea
- A shared, canonical **Knowledge Graph (CKG)** of regulatory obligations, built and kept current by a **community-extending** AI pipeline — operators contribute extractions back via a federation Commons.
- A private, encrypted, per-organization **Org Vault** holding the org's structure, entities, and documents.
- An AI **Projection Layer** that turns graph complexity into plain-language, cited guidance.
- Governing principle: **AI proposes, deterministic code disposes.** Nothing enters the system of record without passing a deterministic gate.

## Quick start (5 min)

From `git clone` to a working signup:

```bash
# 1. Node 22 (use .nvmrc) and Postgres 17 + pgvector
nvm use                                         # honours .nvmrc
brew install postgresql@17 pgvector
brew services start postgresql@17
createdb compliance_grid_dev
psql -d compliance_grid_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 2. Configure env
cp .env.example .env
# Fill in DATABASE_URL (Brew Postgres is passwordless against your macOS user):
#   postgres://$(whoami)@localhost:5432/compliance_grid_dev
# Generate a vault master key:
#   openssl rand -hex 32   # paste as COMPLIANCE_GRID_VAULT_KEY
# Optional: ANTHROPIC_API_KEY (only needed for /calendar, /alerts, the patrol)

# 3. Install + migrate + seed
npm install
npm run db:setup     # migrations only — empty CKG by default
# Optional: load the Karnataka labour pilot as opt-in DEMO data
# (clearly badged in the UI, NOT your real compliance):
#   npm run db:demo
# Clear demo data any time with `npm run db:demo:clear`.

# 4. Run
npm run dev
# open http://localhost:3000 → click "Get started" → create an account
```

After signup the app routes you through onboarding (entity type, sector,
jurisdiction, headcount), then lands you on `/health`. The seed CKG covers
**Karnataka labour** (163 obligations across 19 instruments), so if you onboard
as `IN-KA` you'll see real content immediately. Other jurisdictions show empty
until you run the patrol or extract more sources.

## CLI MVP — `npm run cg`

The doc-driven path. Drop your business documents into `./input-docs/`,
add `ANTHROPIC_API_KEY` to `.env`, then:

```bash
mkdir -p input-docs
# Put your incorporation cert, GST registration, employee handbook,
# sales records, factory licence — any PDF, .md, or .txt — into
# ./input-docs/. Both input-docs/ and output/ are gitignored.

npm run cg
```

The CLI:
1. Reads every supported document under `./input-docs/` (PDF with OCR
   fallback for scans, plus `.txt` / `.md`).
2. Runs the **profile-builder** agent (Sonnet 4.6) — emits a structured
   + free-text company profile to `./output/company-profile.md` with
   per-claim citations to the source files.
3. Runs the **applicability-matcher** (deterministic, no AI cost) —
   ranks every regulator in the Source Index against your profile and
   writes the top 50 to `./output/applicable-sources.md`.

Review and edit `company-profile.md` if the model misread anything;
the matcher reads from it directly, so corrections flow downstream
when you re-run.

**Live example** — three sample documents (incorporation cert, GST
registration, business overview) for a Karnataka pvt-ltd auto-component
manufacturer produced:

> Company: Acme Widgets Private Limited
> Entity type: pvt-ltd · Sector: Auto-Components Manufacturing · Primary jurisdiction: IN-KA
> 172 regulators applicable. Top 3 by score: CBIC GST, CESTAT, eInvoice GST (all IN/tax).

End-to-end: ~$0.06 in Sonnet calls, ~10s total. Outputs are signed-off
markdown a real reviewer can read.

## App surfaces (what's at each URL)

| Route | What it does | Cost per page load |
|---|---|---|
| `/` | Public marketing landing. Authed users → `/health`. | $0 |
| `/signup` | Email + password + org name → user/org row + session. | $0 |
| `/login`, `/logout` | Standard auth. | $0 |
| `/onboarding` | Captures `EntityProfile` (entity type, sector, jurisdiction, headcount, turnover). Validated by the canonical Zod schema. | $0 |
| `/health` | Engine D — traffic-light compliance health rollup. Reads `proof_records` from the Org Vault. | $0 (pure DB) |
| `/obligations` | Per-obligation list filtered by entity. Mark-complied / Reopen actions update `proof_records`. | $0 (pure DB) |
| `/calendar` | Engine C — personalised deadlines as plain-language Sonnet cards. Capped at 5 cards (~$0.10) by default; `?max=15` hard ceiling. | ~$0.02 per card |
| `/alerts` | Engine A — change-event alerts as Sonnet cards. Capped at 3 by default. | ~$0.02 per alert |
| `/review` | Reviewer queue for sub-threshold extractions. Approve / Modify / Reject server actions. | $0 |

Only `/calendar` and `/alerts` need `ANTHROPIC_API_KEY`. Everything else
(including the Health rollup that's most users' day-one surface) is pure DB.

## How the repo is organized
- `CHANGELOG.md` + `ROADMAP.md` — what shipped, what's next.
- `CONTRIBUTING.md` + `SECURITY.md` + `CODE_OF_CONDUCT.md` — community hygiene.
- `docs/specs/` — Architecture (03), Tech Stack (06), Agents (07), Federation (08).
- `docs/diagrams/` — architecture and workflow diagrams.
- `.claude/agents/` — runtime agent definitions (Discovery, Extraction, Projection, Profile-Builder, Applicability-Matcher).
- `scripts/` — setup, smoke runners (`smoke-{auth,browser,crawl-portal,extract,patrol}.ts`), the CLI MVP (`cg.ts`), and the patrol/publish/pull entry points.
- `src/auth/` — sessions, scrypt password hashing, current-user lookup.
- `src/vault/` — AES-256-GCM crypto (`crypto.ts`) + proof-record persistence (`proof-records.ts`).
- `src/recipes/` — per-portal listing recipes. 6 verified as of writing: karmika-spandana-ka, dgft-gov-in, gazettes-uk-gov-in, egazette-odisha-gov-in, lc-kerala-gov-in, dpcc-delhi-gov-in.
- `src/` — engines, gates, acquire pipeline, schemas, DB.
- `app/` — Next.js 16 App Router pages + server actions.
- `migrations/` — versioned forward-only SQL migrations.
- `sources/` — Source Index: YAML files cataloguing regulator portals. ~436 entries.

## Going deeper
1. Read `CONTRIBUTING.md` if you plan to submit a PR.
2. Read `docs/specs/03-architecture.md`, `06-tech-stack.md`, `07-agents.md`, `08-federation.md` for design context.
3. To use the system programmatically (vs the UI), see "Using Compliance Grid" below. To extend the platform with new recipes or sources, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Using Compliance Grid

The system has three main verbs once Postgres is running and the schemas are
migrated: **ingest** regulations into the CKG, **query** the CKG for cards an
end user can act on, and **inspect** the raw data directly.

### As a programmatic API (vs the UI)

The four engines all expose pure functions you can call from your own
TypeScript without touching the Next.js app. For the UI flow, see
"Quick start" above. For programmatic ingestion of more sources, see
"Ingest regulations" below.

Per D44 the app is Next.js 16 App Router + React 19 + Tailwind 4. The
reviewer surface lives at `app/review/page.tsx`; the server actions in
`app/review/actions.ts` are thin wrappers around the Phase 1.6.1 functions in
`src/review/actions.ts`. Same pattern for `app/obligations/actions.ts` (Org
Vault) and `app/onboarding/actions.ts` (EntityProfile).

### Get a personalized compliance calendar (Engine C)

The product surface a user actually sees. Given an `EntityProfile`, the
system filters the CKG to applicable obligations and projects each into a
plain-language card.

```ts
import { getPool } from './src/db/pool.js';
import { generateComplianceCalendar } from './src/engine-c/generate-compliance-calendar.js';

const result = await generateComplianceCalendar(getPool(), {
  entity: {
    entity_id: 'org-1/entity-1',
    org_id: 'org-1',
    entity_type: 'pvt-ltd',
    sector: 'manufacturing',
    jurisdictions: ['IN-KA'],
    headcount: 25,
    annual_turnover_inr: 50_000_000,
  },
  maxObligations: 5, // explicit cost cap per D38 (each card = one Sonnet call)
});

for (const entry of result.cards) {
  console.log(entry.card.what_to_do);
  console.log('  when:', entry.card.when);
  console.log('  due:', entry.due_date);
  console.log('  citation:', entry.card.citation);
}
```

### Get a Compliance Health Score (Engine C)

Pure-deterministic per-domain green/amber/red rollup. No AI cost. Safe to
call on every page load.

```ts
import { generateComplianceHealthReport } from './src/engine-c/generate-compliance-calendar.js';

const report = await generateComplianceHealthReport(getPool(), {
  entity: { /* same EntityProfile as above */ },
  // Optional Map<canonical_id, 'complied' | 'pending' | 'overdue'>.
  // Without proofs, everything is treated as pending.
  // proofState: new Map([[canonicalId, 'complied']]),
});

console.log('overall:', report.score.overall); // 'green' | 'amber' | 'red'
console.log('per-domain:', report.score.per_domain);
```

### Get change alerts (Engine A)

Lists recent ChangeEvents (emitted automatically by every commit per D39),
optionally filtered by an entity, projected as alert cards sorted jail-risk-
first.

```ts
import { generateChangeAlerts } from './src/engine-a/generate-change-alerts.js';

const alerts = await generateChangeAlerts(getPool(), {
  // Without `entity`, every change surfaces. With an entity, only changes
  // to applicable obligations are projected.
  entity: { /* EntityProfile */ },
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // last 7 days
  maxAlerts: 5, // explicit cost cap (each = one Sonnet call)
});

for (const a of alerts.alerts) {
  console.log(`[${a.change_type}]`, a.card.what_to_do);
  console.log('  jail_risk:', a.card.jail_risk);
}
```

### Ingest a portal (deep PDFs from a govt site)

`crawlAndPipeline` chains the per-portal recipe (D34) with the full
extraction pipeline. The karmika recipe is registered; add more in
`src/recipes/` as new portals come online.

```ts
import { crawlAndPipeline } from './src/pipeline/crawl-and-pipeline.js';

const result = await crawlAndPipeline(getPool(), {
  portalUrl: 'https://karmikaspandana.karnataka.gov.in/16/new-labour-rules-and-bills/en',
  jurisdiction: 'IN-KA',
  trustTier: 'govt-portal',
  fetchRecipeKind: 'static-url',
  maxChildren: 5,         // per D35 explicit cost gate
  maxSegmentsPerChild: 10,
  skipExisting: true,     // D36: idempotent resume; skips children already in `sources`
});

console.log(`processed ${result.childrenProcessed} children`);
console.log(`committed ${result.totalCommitted} obligations`);
console.log(`queued ${result.totalQueued} candidates for human review`);
```

### Patrol known sources for changes (Phase 1.7)

`runPatrol` re-fetches each known source, diffs by `content_hash`, and
re-runs the pipeline only on sources whose content has actually changed
since the last successful run (D47). Unchanged sources pay zero AI cost
and emit no ChangeEvents — just a bumped `last_seen`. Run it on a cron.

```ts
import { runPatrol } from './src/pipeline/crawl-and-pipeline.js';

const result = await runPatrol(getPool(), {
  jurisdiction: 'IN-KA',
  domain: 'labour',
  trustTier: 'govt-portal',
  fetchRecipeKind: 'static-url',
  maxSources: 20,         // hard cap per invocation
  olderThanDays: 7,       // only re-check sources not seen in a week
});

console.log(`scanned ${result.sourcesScanned} sources`);
console.log(`unchanged: ${result.sourcesUnchanged}`);
console.log(`changed (reprocessed): ${result.sourcesChanged}`);
```

### Schedule the patrol (D48 cadence wiring)

A standalone runner at `scripts/patrol.ts` reads config from environment
variables and prints a JSON summary. Exit code 0 on a clean run, 1 if
any source had a fetch or pipeline error.

```bash
DATABASE_URL=postgres://... npm run patrol
# scoped + capped:
DATABASE_URL=... PATROL_JURISDICTION=IN-KA PATROL_DOMAIN=labour \
  PATROL_MAX_SOURCES=20 PATROL_OLDER_THAN_DAYS=7 npm run patrol
```

For Linux cron, patrol alone:

```cron
30 0 * * *  cd /path/to/compliance-grid && DATABASE_URL=... PATROL_MAX_SOURCES=50 /usr/local/bin/npm run patrol >> /var/log/cg-patrol.log 2>&1
```

### Cadenced sync (Phase 3.6): pull + patrol in one cron

`npm run sync` runs `cg pull` (if `COMPLIANCE_GRID_DATA_REMOTE` is set)
followed by `cg patrol`. Pull and patrol are independent — pull failure
does not block patrol, and patrol failure does not roll back a
successful pull. The combined exit code is non-zero if either step
failed.

```bash
# Pull skipped (no remote configured), patrol runs:
DATABASE_URL=postgres://... npm run sync

# Full cadenced sync:
DATABASE_URL=postgres://... \
  COMPLIANCE_GRID_DATA_REMOTE=git@github.com:<org>/compliance-grid-data.git \
  COMPLIANCE_GRID_DATA_WORKSPACE=$HOME/.cg/data-workspace \
  PATROL_MAX_SOURCES=50 \
  npm run sync
```

The GitHub Actions workflow at `.github/workflows/sync.yml` runs the
sync daily at 00:30 UTC (06:00 IST) and exposes a manual trigger. Set
`DATABASE_URL` and `ANTHROPIC_API_KEY` as repository secrets; setting
`COMPLIANCE_GRID_DATA_REMOTE` additionally enables the pull step.
Without it, the workflow runs patrol only (backward-compatible with
the pre-3.6 deployment).

### Publish to the CKG Commons (D51, Phase 3.3)

After your pipeline has produced commits, `cg publish` contributes them
back to the shared `compliance-grid-data` companion repo. Only obligations
not yet published are emitted; instruments and sources tag along
(receivers dedupe by id). The runner opens a PR via the `gh` CLI; a
maintainer reviews and merges.

```bash
export DATABASE_URL=postgres://...
export COMPLIANCE_GRID_DATA_REMOTE=git@github.com:<org>/compliance-grid-data.git
export COMPLIANCE_GRID_DATA_WORKSPACE=$HOME/.cg/data-workspace
export PUBLISH_EXTRACTED_BY=<your-github-handle>
npm run publish
```

For local testing against a `git init --bare` remote with no GitHub
involved, set `PUBLISH_DRY_RUN=1` — the runner writes JSONL, commits,
pushes the branch, and prints the would-be PR body, but skips
`gh pr create` and leaves obligations unpublished so retries are safe.

A failed publish leaves obligations unpublished automatically; the next
run picks them up. The boundary between public and private is structural:
`scripts/publish.ts` queries only `obligations`, `instruments`, and
`sources` (see `src/db/publish.ts`); the Org Vault never enters the
payload.

### Pull from the CKG Commons (D52, Phase 3.4)

`cg pull` syncs the federated Commons into your local CKG. Federated
incoming runs through the same canonicalize → dedupe → commit gate as
locally-extracted data, so dedupe and version semantics are identical.

```bash
export DATABASE_URL=postgres://...
export COMPLIANCE_GRID_DATA_REMOTE=git@github.com:<org>/compliance-grid-data.git
export COMPLIANCE_GRID_DATA_WORKSPACE=$HOME/.cg/data-workspace
# Optional: label for the extractor identity recorded on inserted rows
# (default 'commons')
export PULL_EXTRACTED_BY=commons
npm run pull
```

Each obligation lands with `extracted_by = <label>` (NULL = local). The
publish-side loader excludes `extracted_by IS NOT NULL`, so federated
rows never get re-published; no feedback loop forms across operators.

Local extractions always win on conflict: if a federated obligation
shares a canonical_id with a locally-extracted one, the commit gate
updates the content fields but leaves `extracted_by` unchanged. The
ChangeEvent emission is suppressed on pull — the Commons git history
is the audit trail.

Per **D53 (Phase 3.5)**, federation incoming runs through the same
`routeCandidate` gate as local extractions. A federation row with
`confidence < 0.9`, or whose applicability conditions reference fields
outside the EntityProfile vocabulary, lands in `review_queue` rather
than auto-committing — with the extractor identity preserved so the
reviewer's later approve/modify attributes the commit correctly. The
pull summary reports a `queued` count alongside `inserted`/`versioned`.

Use `PULL_DRY_RUN=1` to parse and stat without writing to the DB.

### Ingest a single document (one URL)

```ts
import { runPipeline } from './src/pipeline/crawl-and-pipeline.js';

const result = await runPipeline(getPool(), {
  url: 'https://example.gov.in/path/to/rule.pdf',
  instrument: {
    id: 'IN-KA/some-rule-2021',
    title: 'Some Rule, 2021',
    type: 'Rule',
    jurisdiction: 'IN-KA',
    citation: 'Citation as it appears in the source',
  },
  trustTier: 'govt-portal',
  fetchRecipeKind: 'static-url',
  maxSegments: 25,
});
```

### Project one obligation as a card (direct)

```ts
import { runProjection } from './src/agents/index.js';
import { loadObligationContext } from './src/db/obligations.js';

const context = await loadObligationContext(getPool(), 'IN-KA/some-id|r.1|filing');
if (context) {
  const card = await runProjection({
    obligation: context.obligation,
    instrument: context.instrument,
    source_verified_at: context.source_verified_at,
  });
  console.log(card.what_to_do);
}
```

### Review queued candidates (human-in-the-loop)

Sub-threshold or semantically-flagged candidates land in `review_queue`
(per D32). The Phase 1.6.1 actions let server-side code list and decide on
them. The Next.js UI for this is Phase 1.6.2.

```ts
import { loadPendingReviews } from './src/db/review-queue.js';
import {
  approveReview,
  rejectReview,
  modifyReview,
} from './src/review/actions.js';

const pending = await loadPendingReviews(getPool(), { limit: 10 });

for (const item of pending) {
  console.log(item.id, item.reason);
  console.log('  candidate:', item.candidate);

  // Approve: commit the candidate as-is.
  await approveReview(getPool(), {
    review_queue_id: item.id,
    reviewed_by: 'human-1',
  });

  // Reject: no commit.
  // await rejectReview(getPool(), { review_queue_id: item.id, reviewed_by: 'human-1' });

  // Modify: commit a corrected version.
  // const modified = { ...item.candidate, summary: 'rewritten' };
  // await modifyReview(getPool(), {
  //   review_queue_id: item.id,
  //   reviewed_by: 'human-1',
  //   modified_candidate: modified,
  // });
}
```

### Inspect the CKG directly

Plain `psql` against the local DB. The CKG is just Postgres adjacency tables.

```bash
# What instruments are in the CKG?
psql -d compliance_grid_dev -c \
  "SELECT id, title FROM instruments ORDER BY created_at;"

# How many obligations per instrument?
psql -d compliance_grid_dev -c \
  "SELECT instrument_id, COUNT(*) FROM obligations GROUP BY instrument_id;"

# Sample obligations with citations
psql -d compliance_grid_dev -c \
  "SELECT canonical_id, type, frequency, LEFT(summary, 80) FROM obligations LIMIT 5;"

# Items in the review queue, sorted oldest first
psql -d compliance_grid_dev -c \
  "SELECT id, confidence, LEFT(reason, 80) FROM review_queue
   WHERE reviewed_at IS NULL ORDER BY created_at LIMIT 10;"
```

### Required environment

| Variable | Required for | How to set |
|---|---|---|
| `DATABASE_URL` | Everything except pure deterministic helpers | `postgres://$(whoami)@localhost:5432/compliance_grid_dev` (Brew Postgres) |
| `COMPLIANCE_GRID_VAULT_KEY` | Auth + onboarding + `/health` + `/obligations` (anything touching the Org Vault) | `openssl rand -hex 32` (or any passphrase — derived via scrypt) |
| `ANTHROPIC_API_KEY` | AI calls: `runDiscovery`, `runExtraction`, `runProjection`, and orchestrators (`runPipeline`, `crawlAndPipeline`, `generateComplianceCalendar`, `generateChangeAlerts`). `/calendar` and `/alerts` need it; `/health` and `/obligations` do not. | https://console.anthropic.com/ |
| `PATROL_*` | Patrol cron run | See `.env.example` |
| `COMPLIANCE_GRID_DATA_REMOTE`, `PUBLISH_*`, `PULL_*` | Federation (cg publish / cg pull) | See `.env.example` + `docs/specs/08-federation.md` |

Each AI-using call costs real money (Sonnet 4.6 typically ~\$0.02 per call, Haiku 4.5 typically ~\$0.001). All orchestrators that fan out have explicit cost caps (`maxObligations`, `maxAlerts`, `maxChildren`, `maxSegmentsPerChild`) that callers must set explicitly per D35 / D38 / D40.

### Smoke runners (verify your setup)

```bash
# Recipe-level: pull children from a live portal (no DB, no API key)
npx tsx scripts/smoke-crawl-portal.ts https://www.dgft.gov.in/CP/?opt=notification

# Pipeline-level: acquire + segment + extract + route (needs DB + API key)
npx tsx scripts/smoke-extract.ts \
  "https://content.dgft.gov.in/Website/dgftprod/.../English_0002.pdf" \
  "Some DGFT Notification" "DGFT Notification 20/2026-27"

# Auth-level: create a user + session + entity, get a cookie
npx tsx scripts/smoke-auth.ts your-email@example.com

# Browser-acquire (Playwright/D49): render an SPA portal
npx tsx scripts/smoke-browser.ts https://gujrera.gujarat.gov.in/
```

## Local development

Requirements:
- Node.js 22 or higher. A `.nvmrc` is included; run `nvm use` to switch.
- npm.
- PostgreSQL 17 with the `pgvector` extension. Per D23, install via Homebrew.

Install Postgres locally (one-time):

```
brew install postgresql@17 pgvector
brew services start postgresql@17
createdb compliance_grid_dev
```

Brew's Postgres creates a passwordless local user matching your macOS
username. Set `DATABASE_URL` in your shell (replace `<user>` with the output
of `whoami`):

```
export DATABASE_URL="postgres://<user>@localhost:5432/compliance_grid_dev"
```

Install node deps, run migrations + load the seed CKG, run tests:

```
npm install
npm run db:setup     # migrations only — empty CKG by default
# Optional: load the Karnataka labour pilot as opt-in DEMO data
# (clearly badged in the UI, NOT your real compliance):
#   npm run db:demo
# Clear demo data any time with `npm run db:demo:clear`.
npm run typecheck
npm test
```

After `db:setup` you have an empty CKG plus a populated Source Index (`sources/`) catalogueing **436 regulator portals across IN and all 36 states/UTs**, **6 of which have verified extraction recipes** (karmika-spandana-ka, dgft-gov-in, gazettes-uk-gov-in, egazette-odisha-gov-in, lc-kerala-gov-in, dpcc-delhi-gov-in). See `sources/README.md` for the format. The four-layer architecture (Code / Source Index / CKG Commons / Org Vault) is documented in `docs/specs/08-federation.md`.

> **Heads-up — `npm run db:demo` loads a pilot, not your compliance.** If you want non-empty data to evaluate the engine, run `npm run db:demo` to load 12 instruments / 20 sources / 163 obligations from the IN-KA labour pilot. Every demo obligation is tagged `extracted_by = 'demo'` and shows up under an amber callout on `/health` + `/obligations`. **It is NOT a complete picture of any real entity's obligations, even one matching the pilot profile (IN-KA pvt-ltd manufacturing).** Real compliance comes from extracting against the Source Index regulators that apply to your profile. Clear demo data any time with `npm run db:demo:clear`.

`npm test` runs unit tests for the Zod schemas plus integration tests for the
DB layer. Integration tests skip automatically when `DATABASE_URL` is unset.

The repo contains:

- Canonical Zod schemas (`src/schemas/`) for `Jurisdiction`, `Instrument`,
  `InstrumentRef`, `Source`, `Obligation` (with `ApplicabilityCondition`,
  `Frequency`, `DeadlineRule`, `Penalty`, `SourceRef`), `ChangeEvent`,
  `Module`, and `EntityProfile`. Plus `ObligationCandidate` for the
  pre-commit shape the Extraction Agent emits.
- Postgres migrations (`migrations/`) mirroring the schemas and enforcing
  key invariants at the DB layer, including CLAUDE.md section 2's
  "no obligation without a citation" rule.
- The DB layer (`src/db/`): a lazy connection pool and a `withTransaction`
  helper.
- The deterministic gates (`src/gates/`):
  - `canonicalize` (pure): mints `canonical_id` from D8's key
  - `version` (pure): mints the next obligation version
  - `evaluateApplicability` (pure): the Applicability Engine
  - `computeDueDate` (pure): deadline arithmetic per `DeadlineRule` and
    `Frequency`
  - `dedupe` (DB): looks up by D8 canonical key
  - `commit` (DB): re-validates, computes canonical id and version, writes
    via INSERT or UPDATE
- The Coverage Ledger (`modules` + `module_coverage_events`, per D24).
- A generic `edges` adjacency table for graph relationships.
- The Discovery Agent and the generic agent-contract infrastructure
  (`src/agents/`). `AgentContract<I, O>` enforces input and output schemas
  via Zod and uses Anthropic tool use for structured output. `runDiscovery`
  proposes Indian government sources for a coordinate and verifies every
  URL is reachable via HEAD (with GET fallback) before returning.
- The Acquire pipeline (`src/acquire/`): polite fetcher (with project
  User-Agent), content-type detection (header + magic bytes), and dispatch
  to handler. `cheerio` for HTML, `unpdf` for text-PDF, `tesseract.js` for
  image OCR. Returns a normalized `AcquireResult` with a `content_hash`.
  Scanned PDFs are supported via `normalizePdfWithOcr` in `pdf-handler.ts`
  (D46): text-layer first, per-page OCR fallback using
  `pdf-to-png-converter` + tesseract.js. Born-digital PDFs pay zero OCR
  cost; mixed PDFs only OCR the scanned pages.
- Segment (`src/segment/`): turns an `AcquireResult` into a flat list of
  `Segment`s with citation anchors that the Extraction Agent will reference.
- Source persistence (`src/db/sources.ts`): `persistSource` writes a Source
  row with the real `content_hash`. `ON CONFLICT (id) DO UPDATE` so
  re-fetching the same URL refreshes rather than duplicates.
- The Extraction Agent (`src/agents/extraction.ts`). Sonnet 4.6, per-segment
  extraction (D30). Takes a `Segment` + source/instrument context; returns
  fully-formed `ObligationCandidate[]` with `instrument_ref` and `source_refs`
  built by the wrapper (the AI cannot misattribute identity). Enforces the
  rich schema for applicability conditions, deadlines, and penalties.
- The router and review queue (`src/gates/route-candidate.ts`,
  `src/gates/validate-applicability.ts`, `src/db/review-queue.ts`). Per D9
  + D32: each candidate from extraction goes through a confidence gate
  (>= 0.9 auto-commits) and a semantic gate (applicability values must
  match the EntityProfile field vocabulary). Either gate failing routes
  the candidate to the `review_queue` table with composed reasons; both
  passing routes it to the deterministic `commit` gate.
- The end-to-end pipeline (`src/pipeline/run-pipeline.ts`). Wires every
  layer together: ensures parent Instrument exists, calls `acquire(url)`,
  persists the Source, segments the document, runs Extraction per segment,
  routes each ObligationCandidate. Accepts a `maxSegments` option for
  budget control on large documents. Heavily gated live test
  (`RUN_PIPELINE_LIVE=1` + API key + DB) verified end-to-end against a real
  Karnataka government PDF; first real CKG data was produced this way.
- The listing handler + per-portal recipes
  (`src/acquire/listing-handler.ts`, `src/acquire/crawl-portal.ts`,
  `src/recipes/`). Addresses D33: AI Discovery returns portal URLs;
  deterministic per-portal recipes (one file per portal, registered in
  `src/recipes/index.ts`) enumerate child documents on those portals.
  **6 verified recipes** as of writing — `karmika-spandana-ka` (KA
  labour, 20+ rules), `dgft-gov-in` (520 notifications across 3
  surfaces), `gazettes-uk-gov-in` (Uttarakhand eGazette), `egazette-odisha-gov-in`,
  `lc-kerala-gov-in` (Kerala labour circulars), `dpcc-delhi-gov-in`
  (Delhi pollution standards). `crawlPortal(url)` fetches + finds
  matching recipe + returns child URLs with titles.
- The fetcher (`src/acquire/fetcher.ts`) sends a vanilla Chrome UA,
  `Accept-Language: en-IN`, and a `From:` header with the maintainer
  email (so site admins can trace traffic without UA-filtering biting
  us). An Undici Agent with `SSL_OP_LEGACY_SERVER_CONNECT` handles
  older Indian govt TLS stacks that refuse Node's default handshake.
- Auth + Org Vault (`src/auth/`, `src/vault/`). scrypt-hashed
  passwords (parameter-versioned format), HttpOnly session cookies,
  AES-256-GCM with AAD-bound `${tenantId}:${fieldName}` for PAN/GSTIN
  ciphertext. `proof_records` table stores per-org compliance state
  read by Engine D's traffic-light rollup.
- The crawl-and-pipeline orchestrator
  (`src/pipeline/crawl-and-pipeline.ts`). `crawlAndPipeline` chains
  `crawlPortal` into per-child `runPipeline` runs with explicit budget
  controls (`maxChildren`, `maxSegmentsPerChild`) and an optional
  per-child filter. `skipExisting` (D36) makes re-runs idempotent by
  skipping URLs already in `sources`. Default mapper turns each
  `ListingChild` into a `PipelineInstrument` using a slug of the child's
  title. **Bulk run against the full karmika labour-rules listing
  (Phase 1.5.5) ingested 163 real obligations across 19 instruments**
  (Code on Wages + state drafts; OSH&WCC + state rules; Code on Social
  Security; Industrial Relations Code; KA Motor Transport Workers Rules)
  plus 511 review-queue items.
- The Projection Agent (`src/agents/projection.ts`). Sonnet 4.6 per D26.
  `runProjection(input)` takes an Obligation + Instrument + verified-at
  timestamp; returns a `ProjectionCard` with imperative plain-language
  `what_to_do`, `when`, `proof` strings (produced by the AI) plus
  deterministic `citation`, `freshness_label`, `confidence_label`, and
  `jail_risk` (built by the wrapper, not the AI). Per D37: same
  AI-proposes / code-disposes split that Extraction uses. Sample card from
  a real KA OSH&WCC `r.10(1)` registration obligation: *"Register your
  beedi and cigar work establishment by submitting Form-V electronically
  on the Official Portal before you begin operations..."* With Projection
  live, the system now both ingests and reads the CKG.
- Engine C foundations (`src/engine-c/generate-compliance-calendar.ts`).
  `generateComplianceCalendar(executor, { entity, maxObligations, ... })`
  composes the Phase 1.3 Applicability Engine + `computeDueDate` + Phase
  2.1 `runProjection`. Per D38: explicit `maxObligations` cap because each
  projection is one Sonnet call. First live run against a synthetic KA
  manufacturing MSME: 163 obligations loaded, 80 applicable, 5 projected
  (capped). Cards include notice displays, weekly-rest-day notifications,
  cancellation procedures, and the establishment particulars notice. The
  product surface is alive.
- Engine A foundations (`src/engine-a/generate-change-alerts.ts`,
  `src/db/change-events.ts`). The `commit` gate now writes a
  `change_events` row on every commit (`change_type: 'new'` for inserts,
  `'amended'` for versioned updates) per D39. `generateChangeAlerts` reads
  recent change events, optionally filters by entity applicability,
  projects each affected obligation as an alert card, and sorts by
  jail_risk DESC then due_date ASC then change_type (D40). First live
  alert from a real KA OSH&WCC Notice-of-Disease obligation: *"As soon as
  a notified disease (listed in the Third Schedule of the Code) is
  detected in your establishment, send a Notice of Disease electronically
  to the Inspector Cum Facilitator..."*

Environment:
- `DATABASE_URL` (required for DB tests, migrations, and Source persistence).
- `ANTHROPIC_API_KEY` (required for live Discovery and Extraction integration tests).
- Optional `RUN_OCR_TESTS=1` to run the tesseract.js shape test.
- Optional `RUN_NET_TESTS=1` to run the real-network Acquire smoke test against example.com.

Phase 1 is functionally complete. Up next is Phase 1.5+ — production-izing
Discovery and Acquire for real-world sources (per D33: AI Discovery alone
cannot reliably surface deep-link instrument URLs; per-portal scraping
recipes are required). See `PRODUCT-DEVELOPMENT-STATUS.md` for the live
state.

## Stack
TypeScript end to end. Next.js app, Node workers, PostgreSQL (adjacency-table graph), pgvector for retrieval, Anthropic API for agents behind typed contracts. See `docs/specs/06-tech-stack.md`.

## Principles in one line
Build once and serve everyone. No duplication. Keep itself current. Absorb complexity and emit simplicity. Never invent, always cite, state uncertainty honestly.
