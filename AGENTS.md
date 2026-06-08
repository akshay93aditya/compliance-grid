# AGENTS.md — Operating Contract for Compliance Grid

> This file is the **first thing you read** and the **constant context** for every action in this repository. Treat it as binding. If any instruction elsewhere conflicts with this file, this file wins unless the human explicitly overrides it in-session.

---

## 0. What you are building

**Compliance Grid** — an open-source, AI-first infrastructure layer that maintains a single, shared, deduplicated **Canonical Knowledge Graph (CKG)** of India's regulatory obligations, plus a private per-organization **Org Vault**, exposed through simplifying AI projections. The "UPI/ONDC for compliance."

The CKG is a **federated public good**: every deployment contributes extractions back to a shared `compliance-grid-data` companion repo via `cg publish`, and pulls in others' contributions via `cg pull`. New operators clone the repo and inherit the community's work to date. No single operator pays for the entire intelligence layer. The Org Vault is per-deployment and never federates.

The full intent lives in `docs/specs/`. **You must read all of them before writing code.** They are:

| File | What it governs |
|---|---|
| `docs/specs/01-vision.md` | Why this exists, the end-state, the principles, the open-source contract |
| `docs/specs/02-prd.md` | What we build, scope, the engines, v1 boundaries, the four-layer model |
| `docs/specs/03-architecture.md` | The four layers, components, protocol, data flow, federation flow |
| `docs/specs/04-product-design-guidelines.md` | UX principles, the simplification mandate |
| `docs/specs/05-copy-guidelines.md` | Voice, tone, plain-language rules, citation rules |
| `docs/specs/06-tech-stack.md` | The locked stack, conventions, repository layout |
| `docs/specs/07-agents.md` | The full roster: build-governance agents + runtime agents |
| `docs/specs/08-federation.md` | Open-source contract, Source Index format, federation protocol, trust gates |

---

## 1. The prime directive

**AI proposes. Deterministic code disposes.** This is the architectural soul of the product AND the rule for how you build it.

- Inside the product: AI does fetching, reading, adaptive reasoning. Deterministic code validates, deduplicates, versions, commits. Nothing enters the CKG without passing a deterministic gate.
- Inside the build: you propose; the **Gatekeeper** and **Ruthless Optimizer** agents and the human dispose. No unilateral scope expansion.

## 2. Anti-hallucination law (NON-NEGOTIABLE)

The human does not tolerate hallucination, invented facts, or being confidently wrong. Therefore:

1. **Never invent an API, library, function, env var, file path, schema field, or government source.** If you are not certain it exists, say so and verify (read the file, run `--help`, check the package) before using it.
2. **Never claim something is done that you have not verified.** "I created X" must be backed by a file that exists. Run the check.
3. **Every product claim about the law must carry a citation** to a source instrument. An obligation with no `source_refs` is invalid and must not be committed. This rule is enforced in code, not vibes.
4. **If you are uncertain, say "I am not certain" and state what would resolve it.** Uncertainty stated is correct behavior. False confidence is a defect.
5. **Distinguish "I did this" from "I propose this."** Never blur them.
6. **No silent assumptions.** If a spec is ambiguous, stop and ask, or log the question in `PRODUCT-DEVELOPMENT-STATUS.md` under Open Questions. Do not guess and proceed.

A violation of section 2 is the most serious kind of error in this repo.

## 3. The status spec is sacred

`PRODUCT-DEVELOPMENT-STATUS.md` is the single source of truth for project state.

- **After every meaningful action, update it.** What was done, what decision was made, what is now open.
- It exists for two reasons: (a) so the human always knows the true state, (b) so context stays clean — a new session reads this file and the specs and is immediately oriented.
- Never let it drift from reality. If the status spec says X is done and X is not done, that is a section-2 violation.
- It is updated by the work, and audited by the **Gatekeeper**.

## 4. No bloat

Every file, dependency, abstraction, and feature must justify itself against the PRD and Vision. The **Ruthless Optimizer** has standing authority to question any addition. Before you add anything ask: *does the spec require this? does it serve v1? is there a simpler way?* When in doubt, don't.

## 5. Documentation is architecture

The **Readme Writer** agent maintains `README.md` and `docs/` so that anyone landing on the GitHub repo can understand, run, and contribute. Diagrams, workflows, guides. Documentation is not an afterthought; it is part of the definition of done.

## 6. Definition of done (for any unit of work)

A task is done only when ALL hold:
1. Code exists and runs (verified, not assumed).
2. It conforms to the specs and the tech stack conventions.
3. `PRODUCT-DEVELOPMENT-STATUS.md` is updated.
4. Relevant docs/README updated by (or queued for) the Readme Writer.
5. Gatekeeper has nothing outstanding against it.
6. No section-2 violations.

## 7. How to start a session

1. Read this file.
2. Read `PRODUCT-DEVELOPMENT-STATUS.md` to learn current state.
3. Read the relevant spec(s) for the task at hand.
4. Confirm the task with the human if anything is ambiguous.
5. Engage the appropriate agents (see `docs/specs/07-agents.md`).
6. Work. Verify. Update status. Update docs.

## 8. The agents (summary — full defs in `.Codex/agents/`)

**Build-governance (active now):**
- **Gatekeeper** — tracks everything, audits the status spec against reality, enforces definition-of-done, blocks section-2 violations.
- **Ruthless Optimizer** — trims fat, questions tasks/decisions, steers toward the goal, guards performance and simplicity.
- **Readme Writer** — maintains all documentation and diagrams.

**Runtime (specced now, activated when their phase begins):**
- **Discovery Agent** — finds government sources/portals/listing pages.
- **Extraction Agent** — reads documents, emits schema-valid Obligation candidates with citations.
- **Projection Agent** — turns graph facts into simple, cited, plain-language output.

Build-governance agents apply to *how we build*. Runtime agents are *part of the product*. Never confuse the two.

## 9. Style of working

- Clean, cohesive, incremental. Small verified steps over large unverified leaps.
- Prefer deterministic code; reserve AI for what only AI can do.
- Match the conventions already in the repo. Don't introduce a second way to do something that already has a way.
- Conventional commits. Push regularly. The repo on GitHub is the system of record.
