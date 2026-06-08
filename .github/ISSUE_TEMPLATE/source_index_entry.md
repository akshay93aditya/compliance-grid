---
name: Source Index entry
about: Add a regulator to the Source Index registry (no recipe required)
title: 'source: '
labels: source-index
assignees: ''
---

## Regulator

- **Name**:
- **Jurisdiction** (e.g., `IN-KA`, `IN`):
- **Domain** (e.g., `labour`, `tax`, `environment`):
- **URL** (landing or listing — whichever is more authoritative):
- **Authority type** (`department` / `ministry` / `board` / `statutory-regulator` / etc. — see `src/schemas/source-index.ts`):

## Probe result

```bash
curl --max-time 15 -A 'Mozilla/5.0 ...' "<URL>" -o /dev/null -w '%{http_code} %{content_type}\n'
```

```
paste result
```

If it's `200`, the entry is `access.status: needs-access-probe` and someone can write a recipe later. If it's `403`, capture whether a fresh browser UA fixes it; if not, mark `blocked` with a Tier note.

## Coverage

What kinds of instruments does this regulator publish? (Acts, Rules, Notifications, Circulars, Orders, Tariffs, etc.)

## Topics

Free-form `lowercase-kebab` tags that describe the regulator's scope.

## Are you willing to submit the yaml?

- [ ] Yes — I'll submit a PR with the file under `sources/<jurisdiction>/<domain>/<id>.yaml`
- [ ] No — I'm just flagging the gap
