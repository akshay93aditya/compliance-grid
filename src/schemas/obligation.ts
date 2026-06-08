import { z } from 'zod';
import { InstrumentRef } from './instrument-ref';
import { ApplicabilityCondition } from './applicability-condition';
import { Frequency } from './frequency';
import { DeadlineRule } from './deadline-rule';
import { Penalty } from './penalty';

// Per D17.
export const ObligationType = z.enum([
  'filing',
  'registration',
  'record-keeping',
  'display',
  'notification',
  'payment',
  'inspection-readiness',
]);
export type ObligationType = z.infer<typeof ObligationType>;

// A pointer from an Obligation to where it is cited within a registered Source.
// citation_span is a free string here (page/paragraph pointer); structured
// citation formats are an enrichment for later phases.
export const SourceRef = z.object({
  source_id: z.string().min(1),
  citation_span: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRef>;

// Per docs/specs/03-architecture.md "Object schemas":
//   Obligation { canonical_id, instrument_ref, type, summary,
//                applicability_conditions[], frequency, deadline_rule,
//                proof_types[], penalty{has_imprisonment,range},
//                source_refs[], version, confidence }
//
// Invariant from CLAUDE.md section 2 and the spec ("no obligation without a
// citation"): source_refs must be non-empty. The schema enforces .min(1).
// The deterministic commit gate (Phase 1.3) will re-enforce this as a
// belt-and-braces check at the system-of-record boundary.
//
// Jurisdiction for the canonical key (D8) is resolved via instrument_ref ->
// Instrument.jurisdiction by the canonicalize() function, not stored here, to
// avoid denormalization.
export const Obligation = z.object({
  canonical_id: z.string().min(1),
  instrument_ref: InstrumentRef,
  type: ObligationType,
  summary: z.string().min(1),
  applicability_conditions: z.array(ApplicabilityCondition),
  frequency: Frequency,
  deadline_rule: DeadlineRule,
  proof_types: z.array(z.string().min(1)),
  penalty: Penalty,
  source_refs: z.array(SourceRef).min(1),
  version: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Obligation = z.infer<typeof Obligation>;

// What the Extraction Agent produces, before the deterministic gates assign
// canonical_id (per D8's key, computed by `canonicalize`) and version
// (assigned by `commit` via the `version` gate).
export const ObligationCandidate = Obligation.omit({
  canonical_id: true,
  version: true,
});
export type ObligationCandidate = z.infer<typeof ObligationCandidate>;
