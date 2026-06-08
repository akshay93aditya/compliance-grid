-- Phase 3.3 (D51) — federation publish state. Adds `published_at` to
-- obligations so `cg publish` can find rows that have not yet been
-- contributed to the CKG Commons companion repo.
--
-- Per D50: only obligations carry this flag. Instruments and sources are
-- always re-included in the publish payload (the receiver dedupes by id);
-- they are supporting context, not the unit of contribution.
--
-- NULL = unpublished. NOT NULL = the timestamp of the publish run that
-- wrote this row into the Commons workspace. `published_at` resets on
-- nothing — a future republish (e.g. after spec changes that re-extract)
-- is handled by deleting and re-inserting the row through the commit gate.

-- Up Migration

ALTER TABLE obligations
  ADD COLUMN published_at TIMESTAMPTZ NULL;

-- Backfill: every existing row was committed before the federation
-- pipeline existed. Treat them as unpublished so the maintainer's first
-- `cg publish` run picks them up.
-- (No UPDATE needed; default NULL is already correct.)

-- Index supports the "find unpublished obligations" query.
CREATE INDEX obligations_unpublished_idx
  ON obligations (created_at ASC)
  WHERE published_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS obligations_unpublished_idx;
ALTER TABLE obligations
  DROP COLUMN IF EXISTS published_at;
