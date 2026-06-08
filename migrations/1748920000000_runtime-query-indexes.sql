-- Runtime-query index hardening per audit findings.
--
-- These indexes target queries the app actually runs in /health,
-- /calendar, /alerts, /obligations, and the patrol loop. None of them
-- change schema; they only speed lookups.
--
-- CREATE INDEX uses IF NOT EXISTS so re-running is idempotent.
-- CONCURRENTLY is intentionally NOT used here because node-pg-migrate
-- wraps each migration file in a transaction (and CONCURRENTLY can't
-- live in one). Production rollouts on a hot table should rebuild
-- these out-of-band with CONCURRENTLY.

-- sources lookups
-- - patrol filters by (jurisdiction, domain, last_seen) when picking
--   which sources to re-check.
-- - skipExisting + dedup against Commons hits sources(url) on every
--   crawl child.
CREATE INDEX IF NOT EXISTS sources_jurisdiction_domain_last_seen_idx
  ON sources(jurisdiction, domain, last_seen DESC);

CREATE INDEX IF NOT EXISTS sources_url_idx ON sources(url);

-- obligations lookups
-- - loadObligationContexts (engine-a, engine-c) joins by instrument_id.
--   The canonical-key UNIQUE on (instrument_id, section, type) helps for
--   single-row lookups but a plain instrument_id index serves the
--   "give me every obligation under this instrument" pattern better.
CREATE INDEX IF NOT EXISTS obligations_instrument_id_idx
  ON obligations(instrument_id);

-- change_events lookups
-- - generate-change-alerts filters by status + sorts by detected_at DESC.
--   A compound index that already starts with detected_at DESC is what we
--   want; the existing _status_idx is fine for status-only.
CREATE INDEX IF NOT EXISTS change_events_detected_at_status_idx
  ON change_events(detected_at DESC, status);

-- obligations.source_refs GIN
-- - clear-demo, coverage report, and the federation publish path all
--   need "give me every obligation that references this source_id".
--   Today that's a JSONB-element scan; a GIN turns it into an index hit.
CREATE INDEX IF NOT EXISTS obligations_source_refs_gin_idx
  ON obligations USING GIN (source_refs jsonb_path_ops);
