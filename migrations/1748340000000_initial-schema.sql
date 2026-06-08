-- Phase 1.2 initial schema. Per docs/specs/03-architecture.md "Object schemas"
-- and 06-tech-stack.md. The Zod schemas in src/schemas/ are the source of
-- truth; these tables mirror them and enforce key invariants at the DB level
-- (belt-and-braces with the application-layer commit gate, Phase 1.3).

-- Up Migration

-- Helper: maintain updated_at on row update.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CKG node: Instrument.
CREATE TABLE instruments (
  id            TEXT        PRIMARY KEY,
  type          TEXT        NOT NULL CHECK (type IN ('Act', 'Rule', 'Notification')),
  title         TEXT        NOT NULL CHECK (length(title) > 0),
  jurisdiction  TEXT        NOT NULL CHECK (jurisdiction ~ '^IN(-[A-Z]{2})?$'),
  citation      TEXT        NOT NULL CHECK (length(citation) > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_instruments
  BEFORE UPDATE ON instruments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CKG node: Source.
CREATE TABLE sources (
  id            TEXT        PRIMARY KEY,
  jurisdiction  TEXT        NOT NULL CHECK (jurisdiction ~ '^IN(-[A-Z]{2})?$'),
  domain        TEXT        NOT NULL CHECK (length(domain) > 0),
  url           TEXT        NOT NULL CHECK (length(url) > 0),
  fetch_recipe  JSONB       NOT NULL,
  trust_tier    TEXT        NOT NULL CHECK (trust_tier IN ('gazette', 'govt-portal', 'secondary', 'unverified')),
  last_seen     TIMESTAMPTZ NOT NULL,
  content_hash  TEXT        NOT NULL CHECK (length(content_hash) > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_sources
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CKG node: Obligation. The source_refs CHECK enforces CLAUDE.md section 2's
-- anti-hallucination invariant ("no obligation without a citation") at the
-- DB layer.
CREATE TABLE obligations (
  canonical_id              TEXT             PRIMARY KEY,
  instrument_id             TEXT             NOT NULL REFERENCES instruments(id),
  section                   TEXT             CHECK (section IS NULL OR length(section) > 0),
  type                      TEXT             NOT NULL CHECK (type IN ('filing', 'registration', 'record-keeping', 'display', 'notification', 'payment', 'inspection-readiness')),
  summary                   TEXT             NOT NULL CHECK (length(summary) > 0),
  applicability_conditions  JSONB            NOT NULL DEFAULT '[]'::jsonb,
  frequency                 TEXT             NOT NULL CHECK (frequency IN ('one-time', 'monthly', 'quarterly', 'half-yearly', 'annual', 'event-driven')),
  deadline_rule             JSONB            NOT NULL,
  proof_types               JSONB            NOT NULL DEFAULT '[]'::jsonb,
  penalty                   JSONB            NOT NULL,
  source_refs               JSONB            NOT NULL CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) >= 1),
  version                   TEXT             NOT NULL CHECK (length(version) > 0),
  confidence                DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at                TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_obligations
  BEFORE UPDATE ON obligations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per D8: canonical key on (instrument, section, obligation_type).
-- Jurisdiction is derived via instruments(id). NULLS NOT DISTINCT (Postgres
-- 15+) treats two NULL sections as the same value for uniqueness, so a
-- whole-instrument obligation of a given type exists at most once per instrument.
CREATE UNIQUE INDEX obligations_canonical_key
  ON obligations (instrument_id, section, type)
  NULLS NOT DISTINCT;

-- CKG node: ChangeEvent.
CREATE TABLE change_events (
  id                       TEXT        PRIMARY KEY,
  obligation_canonical_id  TEXT        NOT NULL REFERENCES obligations(canonical_id),
  change_type              TEXT        NOT NULL CHECK (change_type IN ('new', 'amended', 'superseded', 'repealed', 'clarified')),
  effective_date           DATE        NOT NULL,
  source_ref               TEXT        NOT NULL REFERENCES sources(id),
  detected_at              TIMESTAMPTZ NOT NULL,
  status                   TEXT        NOT NULL CHECK (status IN ('detected', 'verification-pending', 'confirmed', 'propagated', 'dismissed')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_change_events
  BEFORE UPDATE ON change_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX change_events_obligation_idx ON change_events (obligation_canonical_id);
CREATE INDEX change_events_status_idx     ON change_events (status);

-- Coverage Ledger per D24. The modules table holds current state; transitions
-- are appended to module_coverage_events for audit-grade integrity.
CREATE TABLE modules (
  jurisdiction     TEXT        NOT NULL CHECK (jurisdiction ~ '^IN(-[A-Z]{2})?$'),
  domain           TEXT        NOT NULL CHECK (length(domain) > 0),
  version          TEXT        NOT NULL CHECK (length(version) > 0),
  depends_on       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  coverage_status  TEXT        NOT NULL CHECK (coverage_status IN ('not_covered', 'expanding', 'live', 'stale', 'refreshing')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (jurisdiction, domain, version)
);

CREATE TRIGGER set_updated_at_modules
  BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE module_coverage_events (
  id            BIGSERIAL    PRIMARY KEY,
  jurisdiction  TEXT         NOT NULL,
  domain        TEXT         NOT NULL,
  version       TEXT         NOT NULL,
  from_status   TEXT         CHECK (from_status IS NULL OR from_status IN ('not_covered', 'expanding', 'live', 'stale', 'refreshing')),
  to_status     TEXT         NOT NULL CHECK (to_status IN ('not_covered', 'expanding', 'live', 'stale', 'refreshing')),
  triggered_by  TEXT,
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  FOREIGN KEY (jurisdiction, domain, version) REFERENCES modules (jurisdiction, domain, version)
);

CREATE INDEX module_coverage_events_coordinate_idx
  ON module_coverage_events (jurisdiction, domain, version, occurred_at DESC);

-- Generic adjacency table per 06-tech-stack.md ("graph modeled with adjacency
-- tables, not a dedicated graph DB"). Polymorphic refs intentionally lack
-- FK enforcement at the DB layer; integrity is enforced by the deterministic
-- gates and schema layer.
CREATE TABLE edges (
  id           BIGSERIAL    PRIMARY KEY,
  from_type    TEXT         NOT NULL CHECK (length(from_type) > 0),
  from_id      TEXT         NOT NULL CHECK (length(from_id) > 0),
  to_type      TEXT         NOT NULL CHECK (length(to_type) > 0),
  to_id        TEXT         NOT NULL CHECK (length(to_id) > 0),
  relationship TEXT         NOT NULL CHECK (length(relationship) > 0),
  metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (from_type, from_id, to_type, to_id, relationship)
);

CREATE INDEX edges_from_idx ON edges (from_type, from_id);
CREATE INDEX edges_to_idx   ON edges (to_type, to_id);
CREATE INDEX edges_rel_idx  ON edges (relationship);

-- Down Migration

DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS module_coverage_events;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS change_events;
DROP TABLE IF EXISTS obligations;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS instruments;
DROP FUNCTION IF EXISTS set_updated_at();
