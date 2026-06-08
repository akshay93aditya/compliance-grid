-- Phase 1.7 patrol-loop support. Adds `processed_at` to sources so we can
-- distinguish "source row inserted" from "pipeline finished against this
-- source's current content_hash."
--
-- This tightens the D36 skipExisting approximation: a source whose row was
-- persisted but whose extraction failed mid-way is no longer wrongly skipped
-- on resume. The patrol loop (D47) uses the same column to decide which
-- sources need re-extraction after a content_hash change.

-- Up Migration

ALTER TABLE sources
  ADD COLUMN processed_at TIMESTAMPTZ NULL;

-- Backfill: existing rows came from successful end-to-end runs in Phase
-- 1.4.5 / 1.5.5 (163 obligations + 511 queued items live in the CKG from
-- those rows). Treat last_seen as a conservative lower bound on completion.
UPDATE sources
SET processed_at = last_seen
WHERE processed_at IS NULL;

-- Down Migration

ALTER TABLE sources
  DROP COLUMN IF EXISTS processed_at;
