# Changelog

All notable changes to this project are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does **not** strictly follow SemVer at v0 — see ROADMAP.md.

## [Unreleased]

### Added
- OSS hygiene: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, PR template, three issue templates, Dependabot config, `DATA-LICENSE.md` (CC0 for data artefacts), `NOTICE` (third-party + legal disclaimer).
- CI: `validate.yml` now runs typecheck + sources:validate + unit tests + production build; new `audit` job reports `npm audit` to the workflow summary (non-blocking).
- Sync workflow is fork-safe (skips cleanly without secrets; only the canonical repo runs the cron).
- `package.json` metadata: description, license, repository, bugs, homepage, keywords, packageManager.

### Changed
- `src/acquire/user-agent.ts`: crawler `From:` header is now configured via `COMPLIANCE_GRID_CONTACT_EMAIL`. The previous personal-email default was replaced with a non-routable placeholder `crawler@compliance-grid.local`. **Operators forking this repo should set their own.**

## [0.1.0] — 2026-06-08

First public release. Engine, CLI, Source Index, federation primitives, Next.js app.

### Engine

- Acquire layer: polite fetcher (vanilla Chrome UA + `Accept-Language: en-IN` + `From:` header + Undici Agent with `SSL_OP_LEGACY_SERVER_CONNECT` for old TLS stacks), HTML/PDF/Image dispatch, OCR-of-PDF with text-layer-first + per-page tesseract fallback, browser-acquire path via Playwright for SPA portals.
- Extraction: per-segment Sonnet 4.6 with bounded concurrency (default 4-way parallel); routing through a confidence + semantic gate (`>= 0.9` auto-commits, else queue for review); deterministic dedupe + version + commit gates.
- Projection: Sonnet 4.6 plain-language cards (`what_to_do` / `when` / `proof`) with wrapper-built citation + freshness + confidence + jail-risk. Cached in Postgres keyed by `(canonical_id, version, source_verified_at, model, prompt_hash)`.
- Patrol: daily content-hash diff over known sources; `ChangeEvent` emission on commits; GitHub Actions cron at 06:00 IST.
- 6 verified per-portal recipes shipping: `karmika-spandana-ka`, `dgft-gov-in`, `gazettes-uk-gov-in`, `egazette-odisha-gov-in`, `lc-kerala-gov-in`, `dpcc-delhi-gov-in`.

### CLI

- `npm run cg`: reads `./input-docs/` (PDF / `.md` / `.txt`), runs the `profile-builder` agent (Sonnet 4.6) into a structured + free-text company profile with per-claim citations, then the deterministic `applicability-matcher` against the Source Index → ranked top-50 regulators in `./output/`.

### Source Index

- 436 catalogued regulator portals across `IN` and all 36 states/UTs, schema-validated YAML. Validator checks: schema, filename ↔ id, path encodes jurisdiction + domain, URL uniqueness, freshness (warn > 180 days), access.status ↔ requires_browser consistency.

### App (Next.js 16 App Router)

- `/signup`, `/login`, `/logout`, `/onboarding` (Zod-validated EntityProfile capture).
- `/health`: Engine D traffic-light rollup with coverage report (Source Index ↔ CKG) and demo-data banner when `extracted_by='demo'` rows exist.
- `/obligations`: per-applicable-obligation list with Mark complied / Reopen actions writing to the Org Vault.
- `/calendar`: Engine C projected cards (cap default 5, hard cap 15, projection-cached).
- `/alerts`: Engine A change alerts (cap default 3, hard cap 10).
- `/review`: Reviewer queue with cursor pagination on `(created_at, id)`.

### Federation

- `npm run publish` / `npm run pull` against the `compliance-grid-data` Commons. Federation receives through the same `routeCandidate` gate as local extractions; `extracted_by` provenance preserved end-to-end.

### Data + DB

- Schema: instruments, sources (with `domain` plumbed through, no longer hardcoded), obligations (canonical key on `(instrument_id, section, type)`, GIN index on `source_refs`), change_events, modules + module_coverage_events, edges, review_queue, projection_cache, users/orgs/entity_profiles/sessions (private), proof_records (private).
- Seed CKG: opt-in via `npm run db:demo`, tagged `extracted_by='demo'` so the UI bands it clearly. `npm run db:setup` migrates schemas only.

### Notable production fixes (post-audit)

- Removed hardcoded `domain: 'labour'` from `runPipeline`.
- Pushed coarse filters (`entityType`, `excludeDemo`) into SQL on `loadObligations`.
- Batch `loadObligationContexts(ids[])` collapses Engine A + Engine C N+1 patterns to one round-trip.
- Tesseract worker reused as a process-singleton instead of spawn-per-image.
- Five runtime DB indexes added (sources jurisdiction+domain+last_seen, sources(url), obligations(instrument_id), change_events(detected_at DESC, status), GIN on obligations.source_refs).
- Review queue switched to cursor pagination on `(created_at, id)`.

### Security

- scrypt password hashing (parameter-versioned format, `timingSafeEqual` verify).
- AES-256-GCM Org Vault with per-tenant + per-field AAD binding; KEK from `COMPLIANCE_GRID_VAULT_KEY` (32-byte hex or passphrase via scrypt).
- HttpOnly Secure SameSite=Lax session cookie, 30-day TTL.
- Edge-safe middleware (`SESSION_COOKIE` constant carries no `pg` / `next/headers` transitive deps).

### Known accepted risks

- PostCSS advisory through Next 16.2.7. `npm audit fix --force` would downgrade to Next 9.3.3 and is not acceptable. Tracking upstream.
