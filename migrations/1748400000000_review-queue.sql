-- Phase 1.4.4: review queue for ObligationCandidates that fail the
-- confidence gate (D9) or the semantic-validation gate (D32).
-- Sub-threshold or semantically-questionable candidates land here for human
-- review instead of being auto-committed to the CKG.

-- Up Migration

CREATE TABLE review_queue (
  id           BIGSERIAL        PRIMARY KEY,
  candidate    JSONB            NOT NULL,
  confidence   DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason       TEXT             NOT NULL CHECK (length(reason) > 0),
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  TEXT,
  decision     TEXT             CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'modified'))
);

-- Partial index for the common "oldest pending review item" query.
CREATE INDEX review_queue_pending_idx
  ON review_queue (created_at)
  WHERE reviewed_at IS NULL;

-- Down Migration

DROP TABLE IF EXISTS review_queue;
