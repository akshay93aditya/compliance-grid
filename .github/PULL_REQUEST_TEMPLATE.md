## What this changes

<!-- One paragraph. What's the practical effect? -->

## Why

<!-- The problem this solves. If it's an audit finding or an issue, link it. -->

## How I verified

- [ ] `npm run typecheck` clean
- [ ] `npm test` green
- [ ] `npm run sources:validate` clean (if `sources/` touched)
- [ ] `npm run build` succeeds (if `app/` or build config touched)
- [ ] Live smoke against the affected portal (if recipe added/changed) — paste the `children[]` count below

## Notes for reviewers

<!--
Anything reviewers should know that isn't obvious from the diff?
- Behaviour changes the user will see
- Breaking changes (avoid these unless we've discussed)
- Deferred follow-ups
-->

## Checklist

- [ ] No new transitive imports introduced (check fetcher / listing-handler / recipes if you added one)
- [ ] No personal data, secrets, or hard-coded contact emails added
- [ ] If this adds a Source Index entry: filename matches `id`, path encodes `<jurisdiction>/<domain>`, URL is unique
- [ ] If this adds a recipe: matcher + childUrlFilter + extractTitle all unit-tested; registered in `src/recipes/index.ts`
- [ ] If this changes data semantics: migration uses `IF NOT EXISTS` and is idempotent
