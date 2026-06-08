# Source Index Ontology

The Source Index records where Indian regulatory material lives. It does not
record what the law says. The CKG and seed files do that after extraction.

## Canonical axes

Every entry must be classed on three axes:

1. **Governance level**
   - `central`: Union government, national statutory regulators, national
     portals, or central gazettes.
   - `state`: State government departments, state regulators, state boards, or
     state gazettes.
   - `local`: Municipal corporations, municipalities, panchayats, development
     authorities, and other city or district bodies that issue compliance
     material.
2. **Jurisdiction**
   - Central entries use `jurisdiction: IN`.
   - State entries use `jurisdiction: IN-XX`, matching the existing
     `Jurisdiction` schema.
   - Local entries use the parent state or union territory jurisdiction in the
     existing schema, and set `governance_level: local` plus a precise
     `authority.name`.
3. **Domain**
   - Use one domain per regulatory function, not one per department. Examples:
     `labour`, `tax`, `environment`, `food-safety`, `corporate`, `financial`,
     `securities`, `standards`, `local-governance`.

The existing path rule stays binding:

```text
sources/<jurisdiction>/<domain>/<id>.yaml
```

This keeps Source Index entries aligned with module coordinates
`jurisdiction/domain/version` and avoids a separate taxonomy for federation.

## Recommended metadata

The current validator requires `id`, `url`, `jurisdiction`, `domain`,
`trust_tier`, and `fetch_recipe`. Source Index entries should also include the
following metadata where known:

```yaml
governance_level: central | state | local
authority:
  name: Full public authority name
  type: ministry | department | statutory-regulator | board | local-body | secondary-tracker
  parent: Optional supervising ministry or government
coverage:
  instrument_types:
    - Act
    - Rule
    - Notification
  topics:
    - Short topic label
verification:
  method: curl-head | browser-smoke | manual
  status: verified | blocked | unverified
access:
  status: extraction-ready | static-html-needs-recipe | browser-required | form-postback-needs-recipe | blocked | needs-access-probe
  update_surface: Where changes appear, if known
  approach: How Acquire should reach the data
  next_step: Smallest concrete recipe or verification task
```

Do not use this metadata to make legal claims. It is routing and triage
metadata for discovery, crawling, patrol, and review.

## Source classes

Compliance data can live in more than one kind of place. The index should cover
all of them:

- **Gazettes and statute repositories:** definitive publication of Acts,
  rules, amendments, repeals, and notifications.
- **Department portals:** circulars, forms, rule pages, manuals, and public
  notices maintained by ministries or departments.
- **Regulator portals:** directions, circulars, regulations, orders, licences,
  and returns issued by statutory regulators and boards.
- **Transactional filing portals:** login or workflow systems where compliance
  obligations are operationalized through forms, registrations, renewals,
  returns, fee payment, certificates, or proof upload.
- **State and local portals:** state department sites, boards, municipal bodies,
  development authorities, and local trade-licence or establishment-licence
  surfaces.
- **Secondary trackers:** early-warning or discovery aids. They can help find
  changes, but committed obligations should anchor to official sources.

## Access statuses

A URL returning 200 is not enough. Each entry should say how the data can be
reached:

- `extraction-ready`: a known recipe exists and can enumerate documents.
- `static-html-needs-recipe`: the page contains usable links or tables in the
  HTML, but no Source Index recipe has been written yet.
- `browser-required`: the page is an SPA or rendered after JavaScript. Use the
  browser-acquire path before parsing.
- `form-postback-needs-recipe`: the site uses ASP.NET, search forms, POST
  filters, or similar stateful navigation. The recipe must model the form flow.
- `blocked`: the site exists, but respectful automated access is blocked.
- `needs-access-probe`: the URL was verified, but the HTML/rendered structure
  has not yet been inspected. This is not extraction-ready.

## Standardization rules

- Do not invent state codes. Use `IN` or ISO-style `IN-XX` codes accepted by
  `src/schemas/jurisdiction.ts`.
- Do not add an entry unless the URL was verified or the entry is explicitly
  marked `trust_tier: unverified` and `verification.status: unverified`.
- Prefer official sources over secondary trackers. Use `secondary` only when
  the source is useful for early detection and commits will later anchor to an
  official instrument.
- Use `gazette` only for official gazette portals or official statute
  repositories.
- Use `govt-portal` for government departments, statutory regulators, boards,
  and local bodies.
- Local bodies must remain under the parent `IN-XX` jurisdiction until the code
  introduces a city-level jurisdiction schema. The local authority name is
  carried in `authority.name`.
- Never treat HTTP 200 as enough. A registered source should distinguish URL
  reachability from data access.
