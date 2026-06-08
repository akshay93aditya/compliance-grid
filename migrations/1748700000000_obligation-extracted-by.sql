-- Phase 3.4 (D52) — federation pull provenance. Adds `extracted_by` to
-- obligations so the commit gate can record which operator's run
-- produced a row. NULL = locally extracted. Non-NULL = federation pull
-- from the named extractor.
--
-- Used by:
--   1. `cg pull` (this phase) to set extractor identity on incoming rows.
--   2. `cg publish` to exclude federated rows from the publish set
--      (operators only republish their own extractions, not what they
--      pulled from the Commons).
--   3. Future trust policies (D-future) to filter incoming federation
--      by extractor reputation.

-- Up Migration

ALTER TABLE obligations
  ADD COLUMN extracted_by TEXT NULL;

-- Index supports the "list rows from a specific extractor" query plus
-- the publish-side "exclude federated rows" filter (the partial form
-- keeps the index tiny because the bulk of rows are locally extracted
-- and have extracted_by IS NULL).
CREATE INDEX obligations_extracted_by_idx
  ON obligations (extracted_by)
  WHERE extracted_by IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS obligations_extracted_by_idx;
ALTER TABLE obligations
  DROP COLUMN IF EXISTS extracted_by;
