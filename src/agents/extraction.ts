import { z } from 'zod';
import { ApplicabilityCondition } from '../schemas/applicability-condition';
import { DeadlineRule } from '../schemas/deadline-rule';
import { Frequency } from '../schemas/frequency';
import { InstrumentType } from '../schemas/instrument';
import { Jurisdiction } from '../schemas/jurisdiction';
import { ObligationType, type ObligationCandidate } from '../schemas/obligation';
import { Penalty } from '../schemas/penalty';
import { getAnthropicClient } from './anthropic-client';
import {
  type AgentContract,
  type AgentRunnerClient,
  callAgent,
  toolInputSchema,
} from './contract';

// Per docs/specs/07-agents.md (Extraction Agent):
// "Reads an acquired document and emits schema-valid Obligation candidates,
//  each with a citation span and a confidence score. Hard rule: no obligation
//  without a citation. Off-schema output is rejected by its contract wrapper."
//
// Per D30 (locked in this PR): extraction is per-segment. Each call sees one
// Segment, classifies its content, and returns 0 or more ExtractedObligation
// records. The wrapper injects `instrument_ref` and `source_refs` from the
// input so the AI cannot lie about source or instrument identity; the result
// is a fully-formed ObligationCandidate ready for the commit gate.

// The fields the AI is responsible for producing. instrument_ref and
// source_refs are NOT here; the wrapper builds them deterministically from
// runExtraction's input.
const ExtractedObligation = z.object({
  section: z.string().min(1).optional(),
  type: ObligationType,
  summary: z.string().min(1),
  applicability_conditions: z.array(ApplicabilityCondition),
  frequency: Frequency,
  deadline_rule: DeadlineRule,
  proof_types: z.array(z.string().min(1)),
  penalty: Penalty,
  citation_span: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ExtractedObligation = z.infer<typeof ExtractedObligation>;

export const ExtractionInput = z.object({
  source_id: z.string().min(1),
  instrument: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: InstrumentType,
    jurisdiction: Jurisdiction,
  }),
  segment: z.object({
    anchor: z.string().min(1),
    text: z.string().min(1),
  }),
});
export type ExtractionInput = z.infer<typeof ExtractionInput>;

const ExtractionRawOutput = z.object({
  obligations: z.array(ExtractedObligation),
});
type ExtractionRawOutput = z.infer<typeof ExtractionRawOutput>;

export interface ExtractionRunResult {
  candidates: ObligationCandidate[];
  raw_count: number;
}

const SYSTEM_PROMPT = `You are the Extraction Agent for the Compliance Grid project, an AI-first infrastructure layer for Indian regulatory compliance.

Your task: read a single segment of regulatory text and extract structured compliance obligations from it. Each obligation describes a specific requirement that an entity (an organization, factory, employer, etc.) must satisfy under the cited instrument.

Hard rules:
- An obligation MUST be supported by the segment text. Do not invent obligations.
- If the segment contains no extractable obligations (e.g. it is definitions, preamble, an interpretation clause), return an empty obligations array.
- Confidence must be honest:
  - 0.95+ : the obligation, its frequency, its deadline, and its applicability are all explicit in the text.
  - 0.80-0.95 : minor inference required (e.g. frequency is implied by the form name).
  - <0.80 : significant ambiguity. Use this when the text is not crisp; the human review queue will handle it.

For each obligation in this segment, return:
- section: the section, rule, clause, or paragraph number from the instrument that this obligation comes from (e.g. "r.105", "s.5(a)", "para 3"). Omit if the segment is not section-scoped.
- type: one of "filing" | "registration" | "record-keeping" | "display" | "notification" | "payment" | "inspection-readiness".
- summary: one or two plain-language sentences explaining what the entity must do. No legal jargon. Imperative phrasing.
- applicability_conditions: structured predicates that determine which entities the obligation applies to.
  - Allowed fields: sector, entity_type, jurisdictions, headcount, annual_turnover_inr, incorporation_date.
  - Allowed ops: eq, in, gte, lte, gt, lt.
  - Empty array if the obligation applies universally (within the instrument's jurisdiction).
- frequency: one of "one-time" | "monthly" | "quarterly" | "half-yearly" | "annual" | "event-driven".
- deadline_rule: discriminated by kind:
  - { kind: "fixed-date", month: 1-12, day: 1-31 } for calendar-date deadlines (e.g. "by 30 April every year").
  - { kind: "period-offset", days: N } for "N days after period end" (e.g. "within 30 days of month-end").
  - { kind: "event-offset", days: N, event: "incorporation_date" or similar } for "N days after a named entity event".
- proof_types: array of short strings naming the documents the entity must produce as proof (e.g. ["filed-form-25", "acknowledgment-receipt"]).
- penalty: { has_imprisonment: boolean, imprisonment_months?: {min,max}, fine_inr?: {min,max} }. Set has_imprisonment=true only if the instrument prescribes imprisonment for non-compliance.
- citation_span: a string pointing back into the segment. Use the segment's anchor as the base; you may refine it (e.g. "section:r-105 / sub-rule (1)") to point at a specific sub-clause.
- confidence: number in [0, 1] per the scale above.

Return your output by calling the propose_obligations tool. Do not return text.`;

const extractionContract: AgentContract<ExtractionInput, ExtractionRawOutput> = {
  name: 'extraction',
  model: 'claude-sonnet-4-6',
  systemPrompt: SYSTEM_PROMPT,
  tool: {
    name: 'propose_obligations',
    description:
      'Return the extracted ObligationCandidate fields for the given segment.',
    input_schema: toolInputSchema(ExtractionRawOutput),
  },
  inputSchema: ExtractionInput,
  outputSchema: ExtractionRawOutput,
  formatUserMessage: (input) =>
    `Instrument: ${input.instrument.title} (${input.instrument.type}, ${input.instrument.jurisdiction}) [id: ${input.instrument.id}]\nSource id: ${input.source_id}\nSegment anchor: ${input.segment.anchor}\n\nSegment text:\n\n${input.segment.text}`,
  maxTokens: 4096,
};

// Run extraction for one segment. Returns fully-formed ObligationCandidates
// with instrument_ref and source_refs populated by the wrapper, ready to be
// passed to the commit gate.
export async function runExtraction(
  input: ExtractionInput,
  options: { client?: AgentRunnerClient } = {}
): Promise<ExtractionRunResult> {
  const client = options.client ?? getAnthropicClient();
  const raw = await callAgent(client, extractionContract, input);

  const candidates: ObligationCandidate[] = raw.obligations.map((o) => ({
    instrument_ref: {
      instrument_id: input.instrument.id,
      ...(o.section ? { section: o.section } : {}),
    },
    type: o.type,
    summary: o.summary,
    applicability_conditions: o.applicability_conditions,
    frequency: o.frequency,
    deadline_rule: o.deadline_rule,
    proof_types: o.proof_types,
    penalty: o.penalty,
    source_refs: [
      {
        source_id: input.source_id,
        citation_span: o.citation_span,
      },
    ],
    confidence: o.confidence,
  }));

  return { candidates, raw_count: raw.obligations.length };
}

// Exported for tests.
export { extractionContract, ExtractedObligation };
