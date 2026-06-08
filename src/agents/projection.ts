import { z } from 'zod';
import { Instrument } from '../schemas/instrument';
import { Obligation } from '../schemas/obligation';
import { getAnthropicClient } from './anthropic-client';
import {
  type AgentContract,
  type AgentRunnerClient,
  callAgent,
  toolInputSchema,
} from './contract';

// Per docs/specs/07-agents.md (Projection Agent):
// "Turns canonical graph facts into plain-language, cited, simplified
//  guidance and prepared documents. Reads from the graphs; never writes
//  back. Every legal claim it emits is grounded in a graph fact with a
//  citation."
//
// Per D37 (locked in this PR): Projection is per-obligation. The wrapper
// builds the deterministic card fields (citation, freshness, confidence,
// jail_risk) so the AI cannot misattribute or hallucinate them; the AI
// produces only three plain-language strings (what_to_do, when, proof).
// This is the same AI-proposes-code-disposes split that Extraction uses
// for instrument_ref and source_refs.

// What the AI returns.
const ProjectionRawOutput = z.object({
  what_to_do: z.string().min(1),
  when: z.string().min(1),
  // May be empty when the obligation has no proof requirement.
  proof: z.string(),
});
type ProjectionRawOutput = z.infer<typeof ProjectionRawOutput>;

export const ProjectionInput = z.object({
  obligation: Obligation,
  instrument: Instrument,
  // The Source's last_seen timestamp. Carried through the call so the
  // freshness label reflects the real verification time, not "now".
  source_verified_at: z.iso.datetime(),
});
export type ProjectionInput = z.infer<typeof ProjectionInput>;

export interface ProjectionCard {
  obligation_canonical_id: string;
  // AI-authored fields (validated against ProjectionRawOutput).
  what_to_do: string;
  when: string;
  proof: string;
  // Wrapper-built deterministic fields.
  citation: string;
  freshness_label: string;
  confidence_label: string;
  jail_risk: boolean;
}

// Deterministic field builders. Exported so tests can assert on them
// directly without spinning up a mock client.

export function buildCitation(input: ProjectionInput): string {
  const section = input.obligation.instrument_ref.section;
  if (section && section.length > 0) {
    return `Source: ${input.instrument.title} (${section})`;
  }
  return `Source: ${input.instrument.title}`;
}

export function buildFreshnessLabel(verifiedAtIso: string): string {
  const date = verifiedAtIso.slice(0, 10);
  return `Verified by the Compliance Grid pipeline on ${date}`;
}

export function buildConfidenceLabel(confidence: number): string {
  if (confidence >= 0.95) return 'High confidence: explicit in the source';
  if (confidence >= 0.9) return 'High confidence, with minor inference';
  if (confidence >= 0.8) return 'Moderate confidence, some inference required';
  return 'Extracted with significant inference, under review';
}

const SYSTEM_PROMPT = `You are the Projection Agent for the Compliance Grid project, an AI-first infrastructure layer for Indian regulatory compliance.

Your task: turn one canonical compliance obligation (from the CKG) into three plain-language strings for an obligation card that a non-expert can act on.

Hard rules:
- Plain language only. No legal jargon ("hereunder," "the said," "as aforesaid," "in pursuance thereof," "notwithstanding").
- Full sentences with explicit subjects and verbs.
- Imperative phrasing. The card tells the entity what to do, not what the law says abstractly.
- No marketing language. Forbidden words and patterns: "unlock," "seamless," "empower," "revolutionize," "leverage," "robust," "best-in-class," "in today's fast-paced world," "we've got you covered."
- No em-dashes. Use periods, commas, or restructure.
- No motivational filler. Say the thing. Stop.
- Do not invent details. Your three strings claim only what the obligation's structured fields support. If a field is unclear or missing, say so plainly rather than guessing.

Return three strings via the propose_card tool:

- what_to_do: one or two sentences. Imperative. What the entity must actually do.
  Examples:
    "Submit Form 25 to the Chief Inspector."
    "Maintain an attendance register in Form 12 and keep it available for inspection at all reasonable times."
    "Notify the registering officer of any change in establishment details."

- when: a readable phrasing of the deadline, derived from the structured frequency and deadline_rule.
  Examples:
    "by 31 January each year"
    "within 30 days after the end of each month"
    "within 30 days of any reportable accident"
    "at all times during business hours"
    "once at registration"

- proof: a short description of what the entity must retain as proof. May be empty ("") when the obligation has no specific proof requirement (for example, a notification obligation that just requires informing an authority).
  Examples:
    "Filed Form 25 with the inspectorate's acknowledgment receipt"
    "A signed copy of the register kept on the premises"
    ""

Citation, freshness label, confidence label, and jail-risk flag are handled deterministically by the calling code. You do not produce or repeat them.`;

const projectionContract: AgentContract<ProjectionInput, ProjectionRawOutput> = {
  name: 'projection',
  model: 'claude-sonnet-4-6',
  systemPrompt: SYSTEM_PROMPT,
  tool: {
    name: 'propose_card',
    description:
      'Return the three plain-language strings for this obligation card.',
    input_schema: toolInputSchema(ProjectionRawOutput),
  },
  inputSchema: ProjectionInput,
  outputSchema: ProjectionRawOutput,
  formatUserMessage: (input) => {
    const o = input.obligation;
    const inst = input.instrument;
    const applicability =
      o.applicability_conditions.length === 0
        ? 'applies universally within the instrument'
        : o.applicability_conditions
            .map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`)
            .join('; ');
    const rule = o.deadline_rule;
    const deadlineStr =
      rule.kind === 'fixed-date'
        ? `fixed-date month=${rule.month} day=${rule.day}`
        : rule.kind === 'period-offset'
          ? `period-offset ${rule.days} days after period end`
          : `event-offset ${rule.days} days after "${rule.event}"`;
    const section = o.instrument_ref.section ?? '(whole instrument)';
    return `Obligation:
  type: ${o.type}
  raw legal summary: ${o.summary}
  applicability: ${applicability}
  frequency: ${o.frequency}
  deadline: ${deadlineStr}
  proof types: ${JSON.stringify(o.proof_types)}
  penalty.has_imprisonment: ${o.penalty.has_imprisonment}

Instrument:
  title: ${inst.title}
  type: ${inst.type}
  jurisdiction: ${inst.jurisdiction}
  section reference: ${section}

Produce the plain-language card via the propose_card tool.`;
  },
  maxTokens: 1024,
};

export interface RunProjectionOptions {
  client?: AgentRunnerClient;
  // When provided, the AI-authored fields (what_to_do/when/proof) are
  // pulled from + written back to the projection_cache table. Hit on
  // (canonical_id, version, source_verified_at, model, prompt_hash);
  // miss falls through to a Sonnet call as before. Deterministic
  // wrapper fields are always re-derived from current inputs so they
  // reflect the latest freshness label.
  cacheExecutor?: import('pg').Pool | import('pg').PoolClient;
}

export async function runProjection(
  input: ProjectionInput,
  options: RunProjectionOptions = {}
): Promise<ProjectionCard> {
  let raw: ProjectionRawOutput | null = null;

  // Cache hit short-circuits the Sonnet call. The wrapper fields below
  // are still computed fresh so freshness_label tracks the latest
  // source_verified_at even when AI output is cached.
  if (options.cacheExecutor) {
    const { getCachedProjection } = await import('./projection-cache');
    const cached = await getCachedProjection(options.cacheExecutor, input);
    if (cached) {
      raw = {
        what_to_do: cached.what_to_do,
        when: cached.when,
        proof: cached.proof,
      };
    }
  }

  if (!raw) {
    const client = options.client ?? getAnthropicClient();
    raw = await callAgent(client, projectionContract, input);
    if (options.cacheExecutor) {
      const { putCachedProjection } = await import('./projection-cache');
      // Fire-and-forget would be nice but keeping the await means a
      // restart mid-write loses the value and re-incurs cost; rare
      // but cleaner to be deterministic here.
      await putCachedProjection(options.cacheExecutor, input, {
        what_to_do: raw.what_to_do,
        when: raw.when,
        proof: raw.proof,
      });
    }
  }

  return {
    obligation_canonical_id: input.obligation.canonical_id,
    what_to_do: raw.what_to_do,
    when: raw.when,
    proof: raw.proof,
    citation: buildCitation(input),
    freshness_label: buildFreshnessLabel(input.source_verified_at),
    confidence_label: buildConfidenceLabel(input.obligation.confidence),
    jail_risk: input.obligation.penalty.has_imprisonment,
  };
}

// Exported for tests.
export { projectionContract };
