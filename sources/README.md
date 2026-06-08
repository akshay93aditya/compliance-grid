# Source Index

This directory is the **public registry of regulatory portals** that Compliance Grid knows about. Pure metadata: URLs, jurisdictions, domains, and fetch recipes. **Zero AI cost** to curate.

A new operator clones the repo and immediately has the full map of where the law lives. They pick an entry whose obligations have not yet been extracted (or refresh one whose `last_verified` is stale) and run the pipeline. The result lands in the local CKG and — when the operator opts in via `cg publish` — in the federated commons.

## Layout

```
sources/<jurisdiction>/<domain>/<id>.yaml
```

- `<jurisdiction>` is `IN` for central or `IN-XX` for a state (ISO 3166-2 code).
- `<domain>` is a free-string but should follow the conventional set: `labour`, `corporate`, `legal`, `tax`, etc.
- `<id>` is a lowercase-with-hyphens slug, unique across the whole index.

See `ONTOLOGY.md` for the Central / State / Local classification rules. In
short: central sources use `IN`, state sources use `IN-XX`, and local-body
sources live under their parent state or union-territory jurisdiction with
`governance_level: local` and a precise `authority.name`.

## Three questions every entry answers

1. **Where does compliance data live?** The URL, authority, jurisdiction,
   domain, and coverage metadata identify the source.
2. **Where is it updated?** `access.update_surface` records the listing,
   gazette search, "What's New" page, circulars page, form workflow, or other
   update surface when known.
3. **How do we access it?** `access.status`, `access.approach`, and
   `access.next_step` distinguish extraction-ready sources from sites that
   need a static recipe, browser fetch, form-postback recipe, or manual access
   strategy.

## Contributing a source

1. Pick a regulatory portal that isn't already in the index.
2. Create `sources/<jurisdiction>/<domain>/<id>.yaml` following the schema in `src/schemas/source-index.ts`.
3. Classify it using the ontology axes: governance level, jurisdiction, and domain.
4. Verify the URL before committing the entry. If it cannot be verified, set `trust_tier: unverified` and mark that honestly in the notes or ontology metadata.
5. Probe access enough to avoid treating a 200 response as extraction-ready. If only reachability was verified, set `access.status: needs-access-probe`.
6. Run `npm run sources:validate` locally. It must pass.
7. Open a PR. CI runs the validator; a maintainer reviews and merges.

The schema requires: `id`, `url`, `jurisdiction`, `domain`, `trust_tier`, `fetch_recipe`. Optional: `notes`, `maintainer`, `added`, `last_verified`.

## What gets validated

- YAML parses
- Schema matches (Zod, per `src/schemas/source-index.ts`)
- Filename matches `<id>.yaml`
- Path matches `sources/<jurisdiction>/<domain>/`
- `id` is unique across the index

URL reachability is **not** validated in CI — portals go down, and the file stays accurate as long as the URL was correct when added. The patrol loop (D47) surfaces breakage at runtime.

## Trust tiers

- `gazette` — official electronic gazette of a government (highest trust)
- `govt-portal` — a government department's own portal
- `secondary` — a non-government tracker (PRS, legal aggregators)
- `unverified` — known to exist but not verifiable as authoritative

## Fetch recipes

- `kind: static-url` — fetch the URL, treat the response as the document
- `kind: listing-page` — fetch the URL, expect a portal index with multiple linked documents; the listing recipe (in `src/recipes/`) enumerates children

For SPA portals (D45), set `requires_browser: true` so `crawlPortal` uses the headless-Chromium path (D49) instead of plain fetch.
