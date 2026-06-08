# Data License

The source code in this repository is licensed under the [MIT License](LICENSE).

**Data artefacts** — the Source Index YAML files under `sources/` and the seed CKG JSONL files under `seed/` — are released under [Creative Commons Zero v1.0 Universal (CC0)](https://creativecommons.org/publicdomain/zero/1.0/).

You can copy, modify, distribute, and use the data — including for commercial purposes — without asking and without attribution. This includes:

- **`sources/**/*.yaml`** — every Source Index entry: regulator identifiers, URLs, jurisdiction/domain coordinates, fetch-recipe metadata, access-status notes, verification timestamps.
- **`seed/**/*.jsonl`** — the seed knowledge graph: instruments, sources, obligations from the Karnataka labour pilot.

## What this does NOT cover

- **Underlying regulatory text** referenced by URLs in the Source Index belongs to the issuing Indian government authority. It is generally in the public domain under Indian law (no copyright in government work, Indian Copyright Act §52(1)(q)), but the data license here does not relicense it — it just covers our catalogue *of* it.

- **Obligations extracted from third-party documents** are derived works. Where the source document carries a copyright notice or restrictive licence, the extracted obligation is provided under that source's terms; the schema and structuring we add are CC0.

## Why CC0

Compliance Grid is a community-extending public good. The data layer needs to be friction-free for any operator to pull, modify, contribute back, or fork. CC0 is the most permissive option that exists.

## Citations

Every extracted obligation carries a `source_refs[]` array that points at the document it came from. Treat that as your trail to the canonical text — the schema-shaped obligation is a convenience, the cited source is the law.
