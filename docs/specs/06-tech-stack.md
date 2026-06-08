# 06 — Tech Stack & Conventions

## Locked stack (Decision D1)
- **Language:** TypeScript end-to-end. No second language in v1 without an explicit logged decision.
- **App:** Next.js (App Router).
- **Workers:** Node processes (Discovery, Patrol, Extraction) run as scheduled/queued jobs.
- **Database:** PostgreSQL. The graph is modeled with **adjacency tables** (nodes + edges), not a dedicated graph DB. Revisit only if query patterns demand it (logged decision required).
- **Retrieval:** `pgvector` extension for embeddings/RAG.
- **AI:** Anthropic API, accessed only through typed **agent-contract wrappers** (never raw, unvalidated calls into the system of record).
- **Validation:** a schema library (e.g. Zod) defines the canonical object schemas once; both runtime validation and TS types derive from it. Single source of schema truth.

## Open-data layer (Phase 3.0+)
- **Source Index format:** YAML, one file per source under `sources/<jurisdiction>/<domain>/<id>.yaml`. Schema-validated in CI. Pure URLs + recipes; **no AI cost** to curate.
- **Seed CKG format:** JSONL, one line per node, files grouped by jurisdiction + domain under `seed/<jurisdiction>/<domain>/`. Loaded by an opt-in script (`npm run db:demo`) so new clones inherit the community's existing extractions.
- **Federation payload format:** signed JSONL (same shape as the seed files) submitted via PR to a separate `compliance-grid-data` companion repo. Trust gate at v1 is maintainer review.
- **Federation primitive:** Git, not an HTTP API. `cg publish` opens a PR; `cg pull` does `git pull` + canonicalize/dedupe ingest. Inherits Git's audit/review/blame machinery.
- **Org Vault stays out of every open-data layer.** Code enforces this — there is no path from Org Vault into a `cg publish` payload, by construction.

## Conventions
1. **Deterministic gates are pure functions.** No network, no AI, no I/O hidden inside. Fully unit-tested. Located together, clearly named (`canonicalize`, `dedupe`, `version`, `commit`, `evaluateApplicability`).
2. **AI lives behind contracts.** Every AI call goes through a wrapper that enforces the agent's input/output schema and rejects off-schema output. AI output is never trusted directly.
3. **The schema is defined once.** Canonical types from `03-architecture.md` are implemented in one place and imported everywhere. No drifting redefinitions.
4. **Citations are enforced in code.** The `commit` gate rejects any `Obligation` with empty `source_refs`. This is a test, not a guideline.
5. **Migrations are versioned and forward-only** in normal operation. The schema is part of the audit trail.
6. **Conventional commits.** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
7. **Secrets via environment only.** Never committed. `.env.example` documents required vars; `.env` is gitignored.
8. **Tests accompany deterministic logic.** Anything that owns the system of record (gates, applicability) ships with tests.
9. **Small, verified steps.** Prefer incremental, runnable changes over large unverified ones.

## Repository layout (target)
```
/                         repo root
  CLAUDE.md               operating contract (read first)
  PRODUCT-DEVELOPMENT-STATUS.md   living state
  README.md               maintained by Readme Writer
  LICENSE                 open-source license (TBD at Phase 3.0)
  .env.example
  docs/
    specs/                01..08 spec files
    diagrams/             architecture + workflow diagrams (mermaid)
    *.md                  guides maintained by Readme Writer
  .claude/
    agents/               agent definitions
    commands/             reusable slash-commands (optional)
  scripts/                bootstrap, dev, db, patrol, publish, pull scripts
  sources/                Source Index — one YAML per regulatory source
    <jurisdiction>/<domain>/<id>.yaml
  seed/                   Seed CKG — JSONL of pre-extracted obligations
    <jurisdiction>/<domain>/instruments.jsonl
                          /sources.jsonl
                          /obligations.jsonl
  src/                    product code
```

Companion repo (separate Git repository, same org):
```
compliance-grid-data/     federated CKG Commons
  <jurisdiction>/<domain>/instruments.jsonl
                         /obligations.jsonl
                         /change_events.jsonl
  CHANGELOG.md            human-readable history of merged contributions
```

## What does NOT go in the stack at v1
- A dedicated graph database.
- Automated government-system filing integrations (Engine B).
- A second backend language.
- Any dependency that the PRD/Vision does not require (Ruthless Optimizer enforces).
