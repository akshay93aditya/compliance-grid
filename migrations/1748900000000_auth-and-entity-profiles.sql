-- Phase 1.6.3 (D54 pending) — auth + entity profile persistence.
--
-- Replaces the DEMO_ENTITY hardcoded in app/_lib/demo-entity.ts. Per D7
-- (consented per-tenant encryption, server-side processing) the PAN +
-- GSTIN columns are reserved for ciphertext set in Chunk C of this PR
-- chain (the Org Vault). For now they remain NULL.
--
-- v1 model: one entity per org (D12 pilot). Multi-entity orgs is a
-- future migration when a real org needs more than one corporate
-- vehicle.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  -- Format: 'scrypt$N$r$p$<salt-hex>$<key-hex>'. Plumbed through
  -- src/auth/password.ts; never compared directly.
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(email) > 0 AND email LIKE '%@%'),
  CHECK (length(password_hash) > 0)
);

CREATE TABLE IF NOT EXISTS orgs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(name) > 0)
);

CREATE INDEX IF NOT EXISTS orgs_owner_id_idx ON orgs(owner_id);

CREATE TABLE IF NOT EXISTS entity_profiles (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL UNIQUE REFERENCES orgs(id) ON DELETE CASCADE,
  entity_type          TEXT NOT NULL,
  sector               TEXT NOT NULL,
  jurisdictions        TEXT[] NOT NULL,
  headcount            INTEGER NOT NULL,
  annual_turnover_inr  BIGINT NOT NULL,
  incorporation_date   DATE,
  registered_state     TEXT,
  -- Reserved for the Chunk C Org Vault. Ciphertext only; plaintext never
  -- crosses the DB boundary.
  pan_encrypted        TEXT,
  gstin_encrypted      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (entity_type = ANY (ARRAY[
    'proprietorship','partnership','llp','pvt-ltd','public-ltd',
    'opc','huf','trust','society'
  ])),
  CHECK (length(sector) > 0),
  CHECK (array_length(jurisdictions, 1) >= 1),
  CHECK (headcount >= 0),
  CHECK (annual_turnover_inr >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  -- 64-char hex from crypto.randomBytes(32); kept secret. Stored
  -- verbatim because the cookie value IS the token (no double-hashing
  -- of an already-random value).
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(token) >= 32),
  CHECK (expires_at > created_at)
);

-- For periodic cleanup of expired sessions (a tiny cron, deferred).
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
