# 07 — Agents

Two distinct kinds. **Never confuse them.**
- **Build-governance agents** police *how we build this repo*. Active from Phase 0.
- **Runtime agents** are *part of the product*. Specced now, activated when their pipeline phase begins.

Full definitions live in `.claude/agents/`. This file is the roster and the rules of engagement.

---

## Build-governance agents (active now)

### Gatekeeper (`.claude/agents/gatekeeper.md`)
The master tracker and auditor. Keeps the whole picture. Audits `PRODUCT-DEVELOPMENT-STATUS.md` against reality. Enforces the definition of done. **Blocks any section-2 (anti-hallucination) violation.** Nothing is "done" until the Gatekeeper has nothing outstanding. Has authority to halt work that drifts from spec or introduces unverified claims.

### Ruthless Optimizer (`.claude/agents/ruthless-optimizer.md`)
Trims fat. Questions every task, dependency, abstraction, and feature against the PRD and Vision. Standing authority to challenge any addition with "does the spec require this? does it serve v1? is there a simpler way?" Guards performance, simplicity, and goal-alignment. Default answer to scope creep is no.

### Readme Writer (`.claude/agents/readme-writer.md`)
Documentation is architecture. Maintains `README.md` and `docs/` so anyone on GitHub can understand, run, and contribute. Produces and updates diagrams (mermaid), workflows, and guides. Documentation is part of the definition of done, not an afterthought.

---

## Runtime agents (specced now, activated by phase)

### Discovery Agent (`.claude/agents/discovery-agent.md`)
Finds government sources, portals, and listing pages for a given coordinate (seeded) and patrols known sources for new/changed listings (patrolling). Output: schema-valid `Source` candidates with fetch-recipes. Never invents a source; every source is a real, reachable URL it verified.

### Extraction Agent (`.claude/agents/extraction-agent.md`)
Reads an acquired document and emits schema-valid `Obligation` candidates, each with a citation span and a confidence score. Hard rule: no obligation without a citation. Off-schema output is rejected by its contract wrapper.

### Projection Agent (`.claude/agents/projection-agent.md`)
Turns canonical graph facts into plain-language, cited, simplified guidance and prepared documents. Reads from the graphs; never writes back. Every legal claim it emits is grounded in a graph fact with a citation.

---

## Rules of engagement
1. Build-governance agents review; they do not silently rewrite the human's decisions. They surface, challenge, and block — the human and the specs decide.
2. Runtime agents operate strictly inside their contract (input schema, output schema, validation). AI is free inside the box; the box is rigid.
3. Any agent that is uncertain states the uncertainty. None of them invents to fill a gap.
4. The Gatekeeper has final say on "done." The Ruthless Optimizer has standing veto on bloat. Conflicts go to the human.
