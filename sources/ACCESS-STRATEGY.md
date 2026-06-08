# Source Access Strategy

The Source Index has three jobs:

1. Find every place where compliance requirements for Indian businesses live.
2. Track where those requirements are updated.
3. Record how Compliance Grid can access the relevant material.

The index is not complete because a portal returns HTTP 200. A 200 response
means only that the host is reachable. The next question is whether the legal
or compliance material can be enumerated, fetched, normalized, cited, and
patrolled.

## Coverage map

| Layer | What to index | Typical update surface | Access pattern |
|---|---|---|---|
| Central gazettes and statute repositories | Acts, rules, amendments, notifications | Gazette issue search, statute repository, amendment listing | Often search/form based; may require browser or manual deep links |
| Central ministries and departments | Circulars, forms, rules, manuals, public notices | "What's New", notifications page, document listing | Static HTML, SPA, or CMS table |
| Central statutory regulators | Regulations, directions, circulars, orders, returns | Regulator circulars page, master directions, press releases | Static HTML, search endpoint, ASP.NET form |
| Transactional portals | Registration, renewal, return, licence, proof-upload workflows | Form catalogue, user manuals, help pages, workflow pages | Often login-gated; index public help/manual surfaces first |
| State departments and boards | State rules, circulars, licences, consents, returns | Department notifications, state gazette, board circulars | Mixed static HTML, SPA, PDF listings |
| Local bodies | Trade licences, municipal permissions, public notices, local bye-laws | Municipal portal, services page, public notices | Often SPA or service portal; browser fetch likely |
| Secondary trackers | Early warning for bills or amendments | Tracker listing or RSS-like page | Detection only; commits must anchor to official sources |

## Access decision tree

1. Fetch headers.
   - 2xx or 3xx means the URL exists.
   - 4xx, DNS failure, or connection reset means skip or mark unverified.
2. Fetch HTML.
   - If useful anchors or tables are present, mark
     `access.status: static-html-needs-recipe`.
   - If the response is a shell such as `<div id="root"></div>`, mark
     `access.status: browser-required`.
   - If the page relies on viewstate, search forms, POST filters, or session
     fields, mark `access.status: form-postback-needs-recipe`.
3. Find the update surface.
   - Prefer official gazette listings, "What's New", notifications, circulars,
     rules, forms, manuals, public notices, or services catalogues.
   - If no update surface is known yet, say so. Do not infer it.
4. Define the smallest next step.
   - Static table: write a table/listing recipe.
   - SPA: run browser-acquire, inspect rendered DOM, then write a recipe.
   - Form workflow: model the search/filter request deterministically.
   - Login-only portal: index public manuals and forms first; record that
     authenticated workflow extraction is out of scope until credentials and
     consent rules are designed.

## Batch planning

Expand breadth in small batches. Good next batches:

- Central regulators: IRDAI, PFRDA, IBBI, TRAI, DoT, MeitY, CERT-In, UIDAI,
  DGCA, AERA.
- State gazettes: one verified gazette or law-department source per major
  state and union territory.
- State labour and factories: labour departments, factories departments, shops
  and establishments surfaces.
- State environment: pollution-control boards and consent portals.
- Local bodies: major municipal corporations and development authorities,
  starting with cities where trade, establishment, fire, signage, and health
  licences matter.

For each batch, include only entries that can be reviewed in a few minutes.
