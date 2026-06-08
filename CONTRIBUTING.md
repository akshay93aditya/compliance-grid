# Contributing to Compliance Grid

Compliance Grid is a community-extending project: every operator who runs the CLI against a regulator we don't yet cover, or contributes a recipe, shrinks the gap for the next one. PRs are welcome.

## What contributions look like

The highest-leverage contributions are usually:

1. **New extraction recipes** under `src/recipes/` — one per portal. See the existing `karmika`, `dgft`, `gazettes-uk`, `egazette-odisha`, `lc-kerala`, `dpcc-delhi` recipes for the pattern.
2. **Source Index entries** under `sources/<jurisdiction>/<domain>/*.yaml` — catalogue regulators we don't yet list.
3. **Bug fixes + perf wins** anywhere in `src/`.
4. **Docs improvements** — README clarity, missing setup steps, broken examples.
5. **Extracted obligations** pushed to the public Commons via `npm run publish` (see `docs/specs/08-federation.md`).

## Before you submit a PR

Run these locally — CI runs them too:

```bash
nvm use                       # Node 22
npm install
npm run typecheck             # no errors
npm test                      # ~318 unit tests, no DB needed
npm run sources:validate      # 436 YAMLs validate, no warnings
npm run build                 # Next.js production build
```

If you're adding a new extraction recipe, also run the live smoke against the portal:

```bash
npx tsx scripts/smoke-crawl-portal.ts https://your-portal.example.com/listing
```

The smoke should return a non-empty `children[]` with sensible titles. Document the discriminator step in your PR — see [#79](../../pull/79) for the established format.

## Recipe-writing playbook

The trap that catches most new recipes: WebFetch / a CMS preview will say "looks like a server-rendered HTML table" while the actual `<tbody>` is empty and populated via DataTables AJAX. Cheap discriminator:

```bash
curl --max-time 15 -A 'Mozilla/5.0 ...' https://target/ -o /tmp/t.html
grep -c '<tr' /tmp/t.html      # if this is 1 (header only), it's AJAX
grep -oE 'href="[^"]+\.pdf' /tmp/t.html | wc -l  # actual PDF anchors in static HTML
```

If `<tr>` count is > 1 and PDF anchors exist in static HTML, write a `createTableListingRecipe` (factory) or a custom recipe with a custom `extractTitle`. If not, the recipe needs `requires_browser: true` and the D49 Playwright path.

## PR expectations

- **One topic per PR.** Easier to review, easier to revert.
- **Tests required** for new pure-function logic. Live smokes for new recipes.
- **Commits don't need to be squashed** — descriptive commit messages are valued; the merge UI handles whatever style the maintainer prefers.
- **Don't bump `package.json` versions** unless asked.
- **No `npm audit fix --force`** — it can do bad things (e.g., downgrade Next to 9.x). Coordinate dependency updates with maintainers.

## Setup pitfalls

- **Brew Postgres + pgvector**: `brew install postgresql@17 pgvector && brew services start postgresql@17`, then `psql -d <db> -c "CREATE EXTENSION vector;"` separately.
- **Node 22 required** (`.nvmrc`). Earlier versions break the migration runner.
- **`COMPLIANCE_GRID_VAULT_KEY` must be set** before any vault-touching page renders. Generate with `openssl rand -hex 32`.
- **The seed CKG is opt-in**: `npm run db:setup` migrates schemas only; `npm run db:demo` loads the IN-KA labour pilot (clearly badged as demo). Real obligations come from running discovery against the Source Index.

## Code style

- TypeScript end-to-end (D1). No new languages.
- Pure functions in `src/gates/`, `src/segment/`, `src/cli/applicability-matcher.ts`, `src/db/coverage.ts` — keep them pure, don't sneak I/O in.
- AI calls go through `AgentContract` (`src/agents/contract.ts`). Don't bypass it.
- DB queries take an `Executor` (`Pool | PoolClient`) and use parameterised SQL. No string concatenation.

## Security

See [SECURITY.md](SECURITY.md) for responsible-disclosure.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
