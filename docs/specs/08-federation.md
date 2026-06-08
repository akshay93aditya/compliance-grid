# 08 — Open-Source & Federation

## The premise
Compliance Grid is open source. The code, the index of regulatory sources, and the extracted obligations are public goods. A new operator clones the repo and inherits the community's work to date. Every operator's extraction can be contributed back. The shared knowledge accretes; no one bootstraps from scratch; no single operator pays for the entire intelligence layer.

This file is the protocol for how that works.

## What is public, what is private
| Artifact | Public / private | Rule |
|---|---|---|
| Code (this repo) | Public | MIT-style license. Anyone can fork, run, contribute. |
| **Source Index** (`sources/`) | Public, in this repo | Schema-validated YAML, one file per source. PRs add/correct. Pure metadata, no AI cost. |
| Seed CKG (`seed/`) | Public, in this repo | JSONL exported once at v0; refreshed periodically. Lets new clones start non-empty. |
| **CKG Commons** (`compliance-grid-data` repo) | Public, separate repo | The accumulating shared knowledge. Operators push to it via `cg publish`, pull from it via `cg pull`. |
| Local CKG (operator's Postgres) | Local replica | Mirror of Commons + the operator's not-yet-published commits. Functionally identical to Commons after a clean pull. |
| **Org Vault** (per-deployment) | Private, encrypted, local | Entity profiles, proofs, filings, compliance state. **Never federates.** Enforced in code per D7. There must be no path in the codebase from an Org Vault row to a `cg publish` payload. |

The line between public and private is the whole product architecture in one sentence.

## The Source Index format

```yaml
# sources/IN-KA/labour/karmika-portal.yaml
id: karmika-spandana-ka
url: https://karmikaspandana.karnataka.gov.in/16/new-labour-rules-and-bills/en
jurisdiction: IN-KA
domain: labour
trust_tier: govt-portal
fetch_recipe:
  kind: listing-page
  requires_browser: false
  config: {}
notes: |
  Karnataka Department of Labour documents portal.
  Static HTML; tabular listing of acts and rules with PDF children.
maintainer: akshay93aditya
added: 2026-05-28
last_verified: 2026-06-04
```

Required fields: `id`, `url`, `jurisdiction`, `domain`, `trust_tier`, `fetch_recipe`.

Schema validation runs in CI on PRs. URL reachability is **not** validated in CI (sources go down; the file stays accurate as long as the URL was correct when added; patrol surfaces breakage at runtime).

## The Seed CKG format

Files at `seed/<jurisdiction>/<domain>/{instruments,sources,obligations}.jsonl`. One node per line. Field order matches the canonical Zod schemas in `src/schemas/`.

```jsonl
{"id":"IN-KA/karnataka-osh-wcc-rules-2021","type":"Rule","title":"Karnataka OSH&WCC Rules 2021","jurisdiction":"IN-KA","citation":"..."}
{"canonical_id":"IN-KA/karnataka-osh-wcc-rules-2021|r.10|filing","instrument_ref":{...},"type":"filing","summary":"...","source_refs":[{"source_id":"src_...","citation_span":"..."}],"version":"v1","confidence":0.95,...}
```

On first migrate of a fresh database, `scripts/load-seed.ts` reads these files and inserts them through the same canonicalize/dedupe/commit gates as live extractions. Federated incoming data is treated identically — no separate "trusted import" path.

## The federation protocol

### `cg publish` (operator → Commons) — as built in Phase 3.3 (D51)
1. Operator runs `npm run publish` after their pipeline has produced commits.
2. The runner reads `published_at IS NULL` obligations from the local CKG. Only obligations carry the marker; instruments and sources are always re-emitted alongside (the receiver dedupes by id).
3. Rows are partitioned by `(jurisdiction, domain)` — the bucket coordinates come from the first source the obligation references.
4. The runner clones (or `fetch + reset --hard origin/<base>`) the configured companion repo `compliance-grid-data` into a workspace, writes per-bucket JSONL at `<jurisdiction>/<domain>/{sources,instruments,obligations}.jsonl`, merging with anything already there. Merge is dedupe-by-id + sort-by-id for stable diffs; rows are written sources → instruments → obligations so a mid-merge `cg pull` sees referenced rows first.
5. The runner commits + pushes a `publish/<extractor>/<timestamp>-<count>` branch and opens a PR against the base branch via `gh pr create`. The PR body lists counts, jurisdictions touched, confidence min/max/avg, and unique source URLs.
6. Only after `gh pr create` succeeds, the runner marks the obligations as `published_at = NOW()`. A failed gh call leaves rows unpublished so the next invocation retries them automatically.
7. Required env: `COMPLIANCE_GRID_DATA_REMOTE`, `COMPLIANCE_GRID_DATA_WORKSPACE`, `PUBLISH_EXTRACTED_BY`. Optional: `COMPLIANCE_GRID_DATA_BASE_BRANCH` (default `main`), `PUBLISH_DRY_RUN=1` (skips gh + skips the publish-mark; useful for tests).
8. **GPG signing is not implemented at v1.** The runner relies on Git's standard commit-signing (`git config commit.gpgsign true` per environment). Per-payload signature files land in a future phase if extractor reputation (D-future) needs cryptographic proof.
9. Maintainer reviews the PR; on merge, the JSONL lands in the data repo.

### `cg pull` (Commons → operator) — as built in Phase 3.4 (D52)
1. `npm run pull` runs on demand (patrol integration is queued for Phase 3.4b).
2. The runner `ensureWorkspace`s the configured companion repo (clones on first call; `fetch + reset --hard origin/<base>` on subsequent calls).
3. JSONL files are walked in topological order: every `**/instruments.jsonl`, then every `**/sources.jsonl`, then every `**/obligations.jsonl`.
4. Instruments and sources are upserted with `ON CONFLICT (id) DO NOTHING` — local-wins for supporting data. Federated sources are inserted with `processed_at = last_seen` so `crawlAndPipeline.skipExisting` (D36/D47) treats them as already-processed.
5. Obligations are reshaped from the published flat `{instrument_id, section, ...}` into the candidate's nested `{instrument_ref: {instrument_id, section}, ...}` and run through the same commit gate as local extractions. The gate's `extractedBy` option is honored on INSERT only — a locally-extracted row that gets a federation update keeps its NULL `extracted_by`. Local extraction wins.
6. The commit gate is called with `emitChangeEvent: false` on pull. The Commons git history is the audit trail; emitting locally would either double-count against patrol-detected events or fire thousands of "new" events on a fresh-clone first pull.
7. Required env: `COMPLIANCE_GRID_DATA_REMOTE`, `COMPLIANCE_GRID_DATA_WORKSPACE`. Optional: `COMPLIANCE_GRID_DATA_BASE_BRANCH` (default `main`), `PULL_EXTRACTED_BY` (default `'commons'`), `PULL_DRY_RUN=1`.
8. Exit code 1 if any row failed parsing or commit-gate validation (so external schedulers can alert on it). Empty pulls are success.
9. Provenance: every inserted obligation carries `extracted_by` = the configured label. The publish loader filters `extracted_by IS NULL` so federated rows never get re-published — structural guarantee against feedback loops across operators.

### What never crosses the boundary
- Entity profiles
- Proofs / receipts / registers
- Per-entity compliance state (`complied | pending | overdue` markers)
- Anything from `org_vaults` schema (when it lands)

The boundary is enforced structurally: `cg publish`'s SQL queries select only from `obligations`, `instruments`, and `sources` (verified — see `src/db/publish.ts`). It has no access to vault tables. A migration that adds a vault table must not add anything to the publish query — enforced by code review. ChangeEvents publishing is deferred to Phase 3.4+ (the table is currently locally-emitted detection state, not contributable knowledge).

## Trust gates on federated incoming data
- **Publisher-side (v1, maintainer review):** the maintainer of `compliance-grid-data` reviews the PR opened by `cg publish`, eyeballs the diff, and merges or rejects. Anti-hallucination invariant (`source_refs.min(1)`) is enforced by the schema/CHECK constraints; obvious garbage doesn't reach review.
- **Receiver-side (v1.x, shipped Phase 3.5 / D53):** every federation row arriving via `cg pull` goes through `routeCandidate` — the same gate local extractions use — not directly through `commit`. Sub-threshold confidence (< 0.9 per D9) or applicability-condition fields outside the EntityProfile vocabulary land in the local `review_queue` with the federation extractor recorded; an approving reviewer's commit attributes correctly. The receiver gets defense-in-depth against publisher mistakes without distrusting maintainers (sub-threshold rows are queued, not rejected).
- **Future (deferred):** extractor allowlists and reputation scoring. The data needed to implement these is already recorded — `obligations.extracted_by` and `review_queue.extracted_by` — so adding them is config + filtering, no schema changes.

## What stops bad actors
- **Schema violation:** rejected by the validator before PR is even opened.
- **Anti-hallucination (no-citation obligations):** rejected by the commit gate. Federated rows without `source_refs[]` fail the same check that protects locally-extracted data.
- **Mass spam:** rate limit per contributor account; PR-level review by maintainers.
- **Subtle poisoning** (high-confidence but factually wrong extractions): the hardest case. Mitigated by (a) requiring source URLs to be reachable and present in the Source Index, (b) confidence-gate-for-federation in v1.x, (c) extractor reputation in v2, (d) the natural deduplication by canonical key — bad data competing with multiple independent good extractions of the same obligation gets versioned and detected as a divergence.

## Why Git, not an HTTP API
- Inherits review, audit, blame, diff, signing for free
- No central server to run, host, monitor, secure
- Forking is the escape hatch — if the maintainers go away or go bad, anyone can fork the data repo and continue
- Aligns with the open-source mindset: data as code
- Trade-off: PR friction. We accept it; the gate is desirable, not incidental

When the Commons grows to the point where Git PRs are painful (~tens of thousands of rows changing per day), we revisit — at that scale, the project is mature enough to justify the ops cost of a central API.

## Bootstrap path (Phase 3.x)
- **Phase 3.0** — Spec updates (this file).
- **Phase 3.1** — Seed export. Dump the local CKG (19 instruments, 163 obligations, 20 sources from the IN-KA labour pilot) to `seed/`. Wire `scripts/load-seed.ts` into a post-migrate step.
- **Phase 3.2** — Source Index directory. Stand up `sources/` with the 20 known karmika sources + a hand-curated list of ~30–50 known Indian regulatory portals.
- **Phase 3.3** — `cg publish`: stand up the `compliance-grid-data` companion repo, implement the export + PR primitive.
- **Phase 3.4** — `cg pull`: wire into patrol; federated rows run through the same gates as locally-extracted ones.
- **Phase 3.5** — Confidence-gate-for-federation. Sub-threshold incoming goes to local review queue.

## Day-one experience for a new operator
```bash
git clone https://github.com/<org>/compliance-grid
cd compliance-grid
cp .env.example .env  # fill in DATABASE_URL, ANTHROPIC_API_KEY
npm install
npm run db:setup    # migrations only; npm run db:demo to opt into the seed
npm run dev           # /health, /alerts, /calendar, /review already populated
```

No empty database. No "what should I extract first?" wall. The operator chooses a source from `sources/` that hasn't been extracted yet (visible in the Coverage Ledger), runs the pipeline, and contributes back. Or not — local-only operation is always fine. Federation is opt-in.
