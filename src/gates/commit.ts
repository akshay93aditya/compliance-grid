import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ObligationCandidate,
  type ObligationCandidate as ObligationCandidateType,
} from '../schemas/obligation';
import { canonicalize } from './canonicalize';
import { dedupe } from './dedupe';
import { version } from './version';

type Executor = Pool | PoolClient;

export type CommitResult = {
  canonical_id: string;
  version: string;
  action: 'inserted' | 'versioned';
  change_event_id: string | null;
};

export interface CommitOptions {
  // Per D39: emit a row in `change_events` for each commit so Engine A can
  // surface the change as an alert. Defaults to true. Disable in unit tests
  // that don't set up a backing `sources` row (the change_events.source_ref
  // FK requires it). The runPipeline flow always persists the Source before
  // calling commit, so the default is correct in production paths.
  emitChangeEvent?: boolean;
  // Per D52 (Phase 3.4 cg pull): records which operator's run produced
  // this obligation. Undefined = locally extracted (the existing path).
  // Set by `cg pull` to the federation extractor's identifier. Only
  // honored on the INSERT branch; an UPDATE leaves `extracted_by`
  // untouched so a locally-extracted row keeps its original provenance
  // even after federation re-touches the canonical_id.
  extractedBy?: string;
}

// The commit gate. Takes an ObligationCandidate (no canonical_id, no version
// yet), re-validates it via Zod (belt-and-braces against the application
// boundary), computes its canonical_id via `canonicalize`, looks up the
// canonical key via `dedupe`, and either INSERTs a new row at version '1' or
// UPDATEs the existing row with a bumped version via `version`.
//
// Per D39: also INSERTs a row into `change_events` (status 'detected',
// change_type 'new' for inserts or 'amended' for versioned updates), unless
// the caller opts out via emitChangeEvent: false.
//
// The caller is responsible for wrapping multiple commits in withTransaction
// when atomicity across writes is required.
//
// Throws on:
//   - Zod validation failure (caller passed a malformed candidate)
//   - DB CHECK constraint failure (final belt-and-braces; e.g. trying to
//     commit an obligation with empty source_refs would fail here even if
//     Zod let it through)
//   - referential integrity failure (e.g. instrument_id does not exist, or
//     source_ref does not exist when emitChangeEvent is true)
export async function commit(
  executor: Executor,
  candidate: ObligationCandidateType,
  options: CommitOptions = {}
): Promise<CommitResult> {
  const validated = ObligationCandidate.parse(candidate);

  const canonical_id = canonicalize({
    instrument_id: validated.instrument_ref.instrument_id,
    section: validated.instrument_ref.section,
    type: validated.type,
  });

  const existing = await dedupe(executor, {
    instrument_id: validated.instrument_ref.instrument_id,
    section: validated.instrument_ref.section,
    type: validated.type,
  });

  const emitChangeEvent = options.emitChangeEvent ?? true;

  let action: 'inserted' | 'versioned';
  let resultingVersion: string;

  if (existing.kind === 'existing') {
    resultingVersion = version(existing.obligation.version);
    action = 'versioned';
    await executor.query(
      `UPDATE obligations SET
         summary = $1,
         applicability_conditions = $2::jsonb,
         frequency = $3,
         deadline_rule = $4::jsonb,
         proof_types = $5::jsonb,
         penalty = $6::jsonb,
         source_refs = $7::jsonb,
         version = $8,
         confidence = $9
       WHERE canonical_id = $10`,
      [
        validated.summary,
        JSON.stringify(validated.applicability_conditions),
        validated.frequency,
        JSON.stringify(validated.deadline_rule),
        JSON.stringify(validated.proof_types),
        JSON.stringify(validated.penalty),
        JSON.stringify(validated.source_refs),
        resultingVersion,
        validated.confidence,
        canonical_id,
      ]
    );
  } else {
    resultingVersion = version(undefined);
    action = 'inserted';
    await executor.query(
      `INSERT INTO obligations
         (canonical_id, instrument_id, section, type, summary,
          applicability_conditions, frequency, deadline_rule,
          proof_types, penalty, source_refs, version, confidence,
          extracted_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb,
               $10::jsonb, $11::jsonb, $12, $13, $14)`,
      [
        canonical_id,
        validated.instrument_ref.instrument_id,
        validated.instrument_ref.section ?? null,
        validated.type,
        validated.summary,
        JSON.stringify(validated.applicability_conditions),
        validated.frequency,
        JSON.stringify(validated.deadline_rule),
        JSON.stringify(validated.proof_types),
        JSON.stringify(validated.penalty),
        JSON.stringify(validated.source_refs),
        resultingVersion,
        validated.confidence,
        options.extractedBy ?? null,
      ]
    );
  }

  let changeEventId: string | null = null;
  if (emitChangeEvent) {
    const sourceRef = validated.source_refs[0]?.source_id;
    if (!sourceRef) {
      throw new Error(
        'commit: candidate has no source_refs; cannot emit ChangeEvent. The anti-hallucination invariant (source_refs.min(1)) should have prevented this.'
      );
    }
    changeEventId = `ce_${randomUUID()}`;
    const changeType = action === 'inserted' ? 'new' : 'amended';
    await executor.query(
      `INSERT INTO change_events
         (id, obligation_canonical_id, change_type, effective_date,
          source_ref, detected_at, status)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, NOW(), 'detected')`,
      [changeEventId, canonical_id, changeType, sourceRef]
    );
  }

  return {
    canonical_id,
    version: resultingVersion,
    action,
    change_event_id: changeEventId,
  };
}
