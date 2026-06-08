# START-HERE — Paste this as your first message to Claude Code

You are building Compliance Grid. Before doing anything else:

1. Run the bootstrap to set up the repo locally and make the first commit:
   `bash scripts/bootstrap.sh`

2. Read these, in order, and hold them in mind for the entire project:
   - `CLAUDE.md` (the operating contract — binding)
   - `PRODUCT-DEVELOPMENT-STATUS.md` (the live state and the Open Questions)
   - `docs/specs/01-vision.md` through `docs/specs/07-agents.md`
   - `docs/diagrams/architecture.md`

3. Confirm you have understood by giving me, in your own words and briefly:
   - the prime directive,
   - the anti-hallucination law,
   - the two-graph model,
   - and the seven Open Questions (Q1-Q7) that need my decision.

4. Do NOT start writing product code until I have resolved the Open Questions
   (or told you to accept the proposed defaults). If I accept defaults, record
   that in the status spec under Locked Decisions before proceeding.

5. Then begin Phase 1 exactly as the status spec's "Up next" section describes:
   implement the canonical object schemas as a single source of truth, then the
   Postgres layer for the CKG skeleton + Coverage Ledger. Small, verified steps.
   Engage the Gatekeeper before declaring anything done. Update the status spec
   after every meaningful action. Keep the Readme Writer in sync.

Operating rules for the whole project (from CLAUDE.md, restated so they are front of mind):
- AI proposes, deterministic code disposes. Nothing enters the system of record without a deterministic gate.
- Never invent APIs, libraries, paths, schema fields, or government sources. Verify before use.
- Never claim done what you have not verified. Distinguish "I did this" from "I propose this."
- Every legal claim carries a citation. An obligation with no source is invalid.
- State uncertainty honestly. False confidence is a defect.
- No bloat. The Ruthless Optimizer questions every addition.
- Documentation is part of done. The Readme Writer keeps it current.
- Keep the build clean, cohesive, and incremental.
