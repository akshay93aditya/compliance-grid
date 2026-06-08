-- Phase 1.6.4 — Org Vault for proof storage (GTM-unblock 2 of 2).
--
-- proof_records is the per-org compliance state: for each obligation that
-- applies to the org, has the org actually filed/registered/etc., and
-- when. Engine D's traffic-light rollup reads this table to compute
-- complied vs pending vs overdue counts; the parameter-passed proofState
-- used in tests stays as the input shape for the pure-function rollup.
--
-- The single UNIQUE constraint on (org_id, obligation_canonical_id)
-- gives us an upsert key: a single row per org-per-obligation, history
-- captured by `marked_at` (latest mark wins; a deeper audit log lands in
-- a future phase if proof workflow demands it).

CREATE TABLE IF NOT EXISTS proof_records (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  obligation_canonical_id  TEXT NOT NULL,
  state                    TEXT NOT NULL,
  -- Free-text user note (e.g. acknowledgement number, file location).
  -- Plaintext in v1 — these notes aren't categorically sensitive PII the
  -- way PAN/GSTIN are. If a future tenant requests encrypted notes, the
  -- column can grow a `_encrypted` peer.
  note                     TEXT,
  marked_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by                TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (state = ANY (ARRAY['complied','pending','overdue'])),
  CHECK (length(obligation_canonical_id) > 0),
  UNIQUE (org_id, obligation_canonical_id)
);

CREATE INDEX IF NOT EXISTS proof_records_org_id_idx ON proof_records(org_id);
