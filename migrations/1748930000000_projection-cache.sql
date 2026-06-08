-- Projection cache. Each card is one Sonnet call (~$0.02). /calendar
-- and /alerts currently re-pay that on every page render. The audit
-- (2026-06-08) called this out as the largest single AI cost leak —
-- a user refreshing /calendar 5 times burns ~5×N×$0.02.
--
-- Cache key (vision-aligned):
--   - canonical_id           ← which obligation
--   - version                ← invalidates when the obligation versions
--   - source_verified_at     ← invalidates when the underlying source
--                              actually moved (patrol-driven)
--   - model                  ← invalidates on model upgrade
--   - prompt_hash            ← invalidates on prompt rewrite (so card
--                              regenerates when the contract changes)
--
-- A hit returns the stored what_to_do / when / proof + the deterministic
-- citation/freshness/confidence/jail_risk built fresh at read time.
--
-- TTL is implicit: the (canonical_id, version, source_verified_at)
-- composite invalidates naturally as patrols re-extract changing
-- sources. No explicit eviction column needed at v1.

CREATE TABLE IF NOT EXISTS projection_cache (
  canonical_id        TEXT NOT NULL,
  version             TEXT NOT NULL,
  source_verified_at  TIMESTAMPTZ NOT NULL,
  model               TEXT NOT NULL,
  prompt_hash         TEXT NOT NULL,
  what_to_do          TEXT NOT NULL,
  "when"              TEXT NOT NULL,
  proof               TEXT NOT NULL,
  cached_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_id, version, source_verified_at, model, prompt_hash)
);

-- Stats-only index for analytics / monitoring of cache age.
CREATE INDEX IF NOT EXISTS projection_cache_cached_at_idx
  ON projection_cache(cached_at DESC);
