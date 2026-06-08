---
name: New recipe request
about: A regulator portal that should be in the Source Index + have an extraction recipe
title: 'recipe: '
labels: enhancement, recipe
assignees: ''
---

## Regulator

- **Name**:
- **Jurisdiction** (e.g., `IN-KA`, `IN`):
- **Domain** (e.g., `labour`, `tax`, `environment`):
- **Landing URL**:
- **Listing URL** (where the obligations live):

## Discriminator output

Please paste the cheap-discriminator check so we know what kind of recipe this needs:

```bash
curl --max-time 15 -A 'Mozilla/5.0 ...' "<listing URL>" -o /tmp/t.html
wc -c /tmp/t.html
grep -c '<tr' /tmp/t.html
grep -oE 'href="[^"]+\.pdf' /tmp/t.html | wc -l
```

```
paste output
```

Interpretation:
- `<tr` count > 1 and PDF anchors found → static-html-needs-recipe (likely the `createTableListingRecipe` factory works)
- `<tr` count is 1 (header only) → SPA / DataTables AJAX → `requires_browser: true`
- Anchors live in `<li>` or `<div>` instead of `<tr>` → custom recipe

## Sample row

If the listing has rows, paste 1-2 sample row markup:

```html
<!-- paste here -->
```

## Volume

How many obligations / documents does this regulator publish per year?

## Are you willing to write the recipe?

- [ ] Yes — I'll submit a PR
- [ ] No — I'm flagging it as a gap
