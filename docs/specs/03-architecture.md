# 03 — Architecture

## Governing principle
**AI proposes. Deterministic code disposes.** Every AI action emits a **schema-validated structured artifact** — never free text into the system of record. Deterministic gates validate, canonicalize, deduplicate, version, and commit. This is what makes an AI-first system reproducible and audit-grade.

## The four layers (canonical model)
| Layer | What | Visibility | Where it lives | Federation |
|---|---|---|---|---|
| **Source Index** | Registry of regulatory portal URLs + recipes | Public, open data | `sources/` in this repo, one YAML per source | Git PRs against this repo |
| **CKG Commons** | The actual extracted knowledge: Instruments, Obligations, ChangeEvents, edges | Public, open data | `compliance-grid-data` companion repo, JSONL chunked by jurisdiction + domain | Git PRs against that repo, `cg publish` + `cg pull` |
| **CKG (local replica)** | Operator's running Postgres mirror of the Commons + their unpublished local commits | Local | Postgres in the deployment | Pulls from Commons on patrol cycle; pushes via `cg publish` |
| **Org Vault** | Per-deployment private data: Entity profiles, proofs, filings | Private, per-tenant, encrypted | Local Postgres / encrypted store | **Never federates.** Enforced in code per D7. |

**The Source Index points at WHERE the law lives. The CKG holds WHAT it says. The Org Vault holds WHO is affected and what they've done about it.** Three distinct things, three distinct rules of provenance.

RAG retrieval is split: CKG for *what the law says* (shared, cited); Org Vault for *this org's situation/history* (private). The streams never cross. The Org Vault is evaluated *against* the CKG by the deterministic Applicability Engine.

For the federation protocol — what gets published, how trust is gated, how conflicts resolve — see `08-federation.md`.

## The components
1. **Source Index** — flat-file registry of every regulatory portal we know about, plus the recipe for crawling it (`static-url` vs `listing-page`, `requiresBrowser`, etc.). Pure URLs and metadata: **zero AI cost to curate**. Day-one users get the full map. PRs add or correct entries.
2. **CKG** — global deduplicated store of canonical obligation nodes. Source of truth for the law. Operator's local Postgres is a replica of the Commons + their unpublished local commits.
3. **CKG Commons** — versioned, published mirror of the CKG that operators sync from on patrol cycle and contribute to via `cg publish`. Lives in a separate git repo so the code repo isn't bloated by data. Maintainer-reviewed; bot-gated when confidence-gate-for-federation lands.
4. **Modules** — CKG partitioned by coordinate `jurisdiction / domain / version` (e.g. `IN-TG/labour/v3`). Unit of expansion, loading, coverage. Vertical modules **compose** horizontals via `depends_on` (pharma references labour+EHS+tax, never copies) — structural dedup across verticals.
5. **Coverage Ledger + Expansion Trigger** — deterministic registry; per-coordinate lifecycle `not-covered -> expanding -> live -> (stale -> refreshing -> live)`. Expansion happens once; thereafter served from graph with zero re-work. Coverage is observable in the Commons, so contributors don't redundantly re-expand what someone else just did.
6. **Discovery Loop (AI)** — standing agent. **Seeded** (find authoritative sources for a coordinate) + **patrolling** (revisit known sources; detect new listing pages/sub-portals/structural change). Emits registered `Source` candidates with fetch-recipes that should be added to the Source Index via PR.
7. **Extraction + Canonicalization Pipeline** — per source: **Acquire** (fetch, detect type, OCR scans, normalize to clean text + page/coordinate map for citations) -> **Segment** (deterministic structural parse) -> **Extract (AI)** (schema-valid `Obligation` candidates, each with citation span + confidence; no obligation without a citation) -> **Canonicalize+dedupe (deterministic)** (canonical key; existing -> version, new -> mint id; AI only *proposes* fuzzy merges) -> **Confidence-gate** (auto-commit high confidence; else human review queue) -> **Publishable record** (commit also writes a federation-ready entry that `cg publish` will batch).
8. **Federation Pipeline (deterministic)** — `cg publish` exports recent local commits as a signed JSONL payload and opens an automated PR against the `compliance-grid-data` repo. `cg pull` syncs merged Commons changes back into the local CKG, running them through the same canonicalize+dedupe gates so federated incoming data is no different from locally-extracted data.
9. **Applicability Engine (deterministic)** — given an Entity profile + obligations in relevant live modules, computes exactly what applies. Same input + same graph version = same output. (AI's role was upstream: extracting applicability *conditions* into structured form.)
10. **Projection Layer (AI, graph-grounded)** — turns obligation nodes into plain-language, cited guidance and prepared documents. Reads from graphs; **never writes back**.

## v0 bootstrap
- **Source Index** ("where the law lives"): hand-curated at v0; community-extended thereafter. Pure URL+recipe work; zero AI cost.
- **Instrument skeleton** ("which laws exist"): finite, enumerable from authoritative lists. Build national-complete fast.
- **Obligation flesh** ("what each law requires"): expensive extraction, filled on priority. Unfilled = `skeleton-only` in the ledger; system knows what it doesn't know. **Paid for once by whoever runs the extraction, then shared via the Commons.**
- **Seed CKG**: the pilot deployment's extracted obligations are exported to `seed/*.jsonl` in this repo. On `npm run db:demo`, an opt-in script loads them with extracted_by=demo so new clones don't begin empty.
- **v0 build and ongoing updates are the SAME pipeline.** No architectural seam. Federated incoming data is also the same pipeline (runs through canonicalize+dedupe+commit gates).

## Update loop (post-v0)
- **Patrol (known sources):** volatility-based cadence. **Content-hash first** — unchanged -> stop (no AI cost). Changed -> diff -> feed only the changed region to AI. ~95% stays deterministic.
- **Federation pull:** patrol cycle also pulls newly-merged Commons changes. Operators stay current with the community's extractions without re-running any AI themselves.
- **Federation publish:** operator opts in (`cg publish`); recent local commits batched, signed, PR'd against `compliance-grid-data`. Maintainer reviews; on merge, every other operator picks it up on their next pull.
- **Discovery (unknown sources):** periodically re-ask "what authoritative sources exist for this coordinate?" vs. registered; emit Source Index PRs for new ones.
- **Propagation:** detected change -> `ChangeEvent` -> obligation versioned -> every affected entity recomputed deterministically. One detection, universal propagation. The propagation crosses the federation boundary too: a ChangeEvent in the Commons reaches every operator on their next pull.
- **Latency honesty:** source `trust_tier` + extraction `confidence` are first-class and surfaced. Fresh detection from a scan sits in "detected, verification pending" — never silently trusted, never hidden. Federation adds one more axis: `extracted_by` (which operator's run produced this) so consumers can apply additional trust policy if they want.

## The protocol (typed contracts + state machines)
### A. Object schemas (canonical types)
```
Source       { id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash }
Instrument   { id, type(Act|Rule|Notification), title, jurisdiction, citation }
Obligation   { canonical_id, instrument_ref, type, summary, applicability_conditions[],
               frequency, deadline_rule, proof_types[],
               penalty{ has_imprisonment, range }, source_refs[], version, confidence }
ChangeEvent  { id, obligation_ref, change_type, effective_date, source_ref, detected_at, status }
Module       { coordinate, version, depends_on[], coverage_status }
EntityProfile{ entity_id, org_id, sector, jurisdictions[], headcount, turnover, entity_type, ... }
```
**Invariant:** an `Obligation` with empty `source_refs` is invalid and must never be committed. Enforced in the commit gate.

### B. Agent contracts (the "MCP-like" part)
Each runtime AI agent is defined by: allowed inputs, exact output schema, validation it must pass. AI is free *inside* the box; the box is rigid. Reject any off-schema field or any obligation lacking a citation.

### C. Deterministic gates (pure functions, NO AI)
`canonicalize()`, `dedupe()`, `version()`, `commit()`, `evaluateApplicability()`. These make the system reproducible and auditable.

### D. Coverage state machine
Governs the module lifecycle; ties requirements 1/2/3 together.

## Requirement -> mechanism traceability
| Requirement | Mechanism |
|---|---|
| 1 Composable/on-demand | Modules as unit of expansion; verticals compose horizontals via `depends_on` |
| 2 Expand once, serve all (in-deployment AND cross-deployment) | Shared CKG + Coverage Ledger + federation pipeline (`cg publish` / `cg pull` against `compliance-grid-data` repo) |
| 3 Self-keeping | Discovery Loop (seeded + patrol) + content-hash patrol + federation pull |
| 4 No duplicates | Deterministic canonical key + dedup gate; AI only proposes merges. Same gates run on federated incoming data, so cross-deployment dedup is automatic. |
| 5 Simplified | Hard separation: CKG underneath, AI Projection Layer (cited) on top |
| 6 Day-one non-empty | Source Index shipped in `sources/`; seed CKG in `seed/*.jsonl`; load via `npm run db:demo` (opt-in) |

## Data flow
```
Source Index (sources/*.yaml, in-repo)
  --> Discovery Loop (AI) proposes additions via PR
  --> Acquire --> Segment --> Extract(AI, schema+cite) --> Canonicalize/Dedupe(det) --> Confidence Gate
        --> auto-commit OR human review --> CKG local replica (canonical, versioned)

Operator opt-in:
  cg publish --> JSONL payload --> PR against compliance-grid-data --> maintainer review --> merge
  cg pull <-- compliance-grid-data <-- other operators' published commits
        --> dedupe gate --> CKG local replica

EntityProfile (Org Vault, private) --> Applicability Engine (det) --> Projection Layer (AI, cited)
        --> App: Engine A alerts + Engine C health/calendar/prepared docs
        --> user files --> uploads proof --> Org Vault --> score updates
```

## Stack mapping (see 06-tech-stack.md)
- CKG + Coverage Ledger + Org Vault: Postgres (adjacency tables for graph edges), pgvector for retrieval.
- Deterministic gates: pure TS functions, unit-tested, no network/AI calls.
- Runtime agents: Anthropic API via typed agent-contract wrappers.
- Workers (Discovery, Patrol, Extraction): Node worker processes on scheduled jobs.
- App: Next.js.
