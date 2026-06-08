# Roadmap

This document is forward-looking. Past work lives in [CHANGELOG.md](CHANGELOG.md). Items here are **public** — internal product strategy lives elsewhere.

## Now

The platform produces real, citation-bearing compliance obligations from primary regulators end-to-end. The biggest gap is coverage — only 6 of the 436 catalogued regulators have verified extraction recipes — and the path to closing it is community-extending: every operator who runs `npm run cg` against a regulator we don't yet cover surfaces the gap; contributing back a recipe shrinks it for the next operator.

## Near-term (next 1-2 months)

### Coverage
- **More extraction recipes.** The static-HTML pattern (`createTableListingRecipe` factory, custom `extractTitle` for non-default column layouts) covers most state gazettes, labour commissioners, and pollution boards. SPA portals (RERAs, some commercial-tax dashboards) need the D49 Playwright path — that infra is in place; recipes are the missing piece.
- **Re-probe the deferred URLs.** ~80 entries are tagged `needs-access-probe` and ~5 are `blocked` with transient causes (DNS, 503, geo). A periodic re-probe pass moves them forward.

### Engine
- **DB-side applicability index.** Coarse filters (`entityType`, `excludeDemo`) landed in SQL; the next move is a materialised applicability index per `(entity_profile_version, jurisdiction)` so `/obligations` doesn't recompute every render at national scale.
- **Repeal detection.** Patrol handles new + amended via `ChangeEvent`. Detecting obligations that disappear from a re-extracted source (repeal / supersession) is a future enhancement.

### Federation
- **Trust policies.** `extracted_by` provenance is recorded end-to-end (PR-marked Commons contributions). Per-extractor allowlists and reputation scoring become config + filtering — no schema changes required.

## Medium-term

### Source Index → Discovery loop
- Patrol currently iterates the `sources` table (already-extracted). Discovery should also enumerate `sources/*.yaml` entries and propose acquisition for applicable regulators that don't yet have any extracted obligations. Coverage report already surfaces the gap; closing the loop turns it into a recipe-writing prompt.

### Module references on obligations
- D42 lock: `Compliance Health Score` rolls up per-`instrument_id` at v1. The right long-term key is `Module.coordinate.domain`. Lands when Modules are referenced from Obligations (schema migration + projection re-roll).

### Recipe synthesis
- All recipes today are human-written. A focused agent that synthesises recipes from observed HTML patterns is the move from "community-extending" to "self-extending." Out of v1 scope; tracked.

## Out of scope for v1

- **Engine B (automated filing).** Locked decision D4. The v1 loop is prepare → human files. Automated filing needs government API integrations + a much stronger liability posture; it's a separate product, not a near-term roadmap item.
- **Multi-tenancy beyond one-entity-per-org.** The auth + vault schema is single-tenant by design (D12 pilot scope). Multi-entity orgs land when a real operator hits the constraint.
- **Real-time push.** Daily patrol cadence is deliberate — government portals are eventually-consistent; sub-day polling adds rate-limit risk without product value.

## How to influence the roadmap

- File an issue with the appropriate template (bug / new recipe / source index entry).
- Submit a PR — see [CONTRIBUTING.md](CONTRIBUTING.md).
- For sponsorship / large-scale coverage requests, contact the maintainers via the address configured in `COMPLIANCE_GRID_CONTACT_EMAIL` for this deployment.
