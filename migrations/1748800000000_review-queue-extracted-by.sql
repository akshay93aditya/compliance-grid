-- Phase 3.5 (D53) — federation confidence-gate. Adds `extracted_by` to
-- review_queue so a sub-threshold federation row queued for review
-- preserves its provenance, which is then handed to the commit gate
-- when a reviewer approves or modifies the candidate.
--
-- Without this column, federation rows that fail the confidence gate
-- would lose their extractor identity in the queue → on approve, they
-- would commit with extracted_by=NULL (incorrectly attributed as local).

-- Up Migration

ALTER TABLE review_queue
  ADD COLUMN extracted_by TEXT NULL;

-- Existing queued rows came from local extractions before federation
-- existed; leave them NULL.

-- Down Migration

ALTER TABLE review_queue
  DROP COLUMN IF EXISTS extracted_by;
