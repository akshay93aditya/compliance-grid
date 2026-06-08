import { z } from 'zod';
import { EntityType } from '../schemas/entity-profile';
import { Jurisdiction } from '../schemas/jurisdiction';
import { getAnthropicClient } from './anthropic-client';
import {
  type AgentContract,
  type AgentRunnerClient,
  callAgent,
  toolInputSchema,
} from './contract';

// Per docs/specs/07-agents.md (forthcoming Profile Builder section):
// Reads concatenated text from a folder of business docs (incorporation
// certificates, GST registrations, employee handbooks, sales records,
// etc.) and emits a structured + free-text company profile.
//
// The structured part feeds the existing applicability engine via
// EntityProfile shape (entity_type, sector, jurisdictions, headcount,
// turnover). The free-text part covers everything else — products,
// operational specifics, foreign trade, banking relationships — which
// the applicability-matcher reads to score relevance against richer
// Source Index entries.
//
// Hard rules (mirrors discovery / extraction):
// - Output ONLY through the tool schema. Off-schema = rejected.
// - Never invent factual claims. If a field is not in the docs, mark it
//   "unknown" rather than guessing. The matcher treats "unknown" as a
//   non-signal, not as a default.

export const ProfileBuilderInput = z.object({
  // One concatenated string per doc (path-prefixed for traceability).
  // The agent sees the docs as a single transcript; the caller can cap
  // size to fit the context window.
  doc_transcript: z.string().min(1),
});
export type ProfileBuilderInput = z.infer<typeof ProfileBuilderInput>;

export const ProfileBuilderOutput = z.object({
  // Best-effort structured fields. Anything unparseable from the docs
  // becomes the string "unknown" — the matcher and the human reviewer
  // can both see what the model wasn't able to derive.
  company_name: z.string(),
  entity_type: z.union([EntityType, z.literal('unknown')]),
  primary_jurisdiction: z.union([Jurisdiction, z.literal('unknown')]),
  other_jurisdictions: z.array(Jurisdiction),
  sector: z.string(),
  // The model occasionally returns numeric values as strings ("85") even
  // when the schema asks for a number. Preprocess to coerce numeric
  // strings before the union check; non-numeric strings fall through.
  headcount_estimate: z.preprocess(
    (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v),
    z.union([z.number().int().nonnegative(), z.literal('unknown')])
  ),
  annual_turnover_inr_estimate: z.preprocess(
    (v) => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v),
    z.union([z.number().nonnegative(), z.literal('unknown')])
  ),
  incorporation_date: z.union([z.iso.date(), z.literal('unknown')]),
  // Free-text sections that compose the company-profile.md output.
  // Each is a short paragraph; the renderer combines them.
  what_they_do: z.string().min(1),
  customers_and_markets: z.string(),
  operations_and_locations: z.string(),
  workforce_notes: z.string(),
  regulatory_signals: z
    .string()
    .describe(
      'Any compliance-relevant signals you noticed in the docs (e.g., GST registration mentioned, PAN visible, factory licence reference, FDI received, etc.).'
    ),
  // Citations: which source filenames contributed to each major claim.
  // The renderer puts these in the footer so a reviewer can verify.
  citations: z.array(
    z.object({
      claim: z.string(),
      source_files: z.array(z.string()).min(1),
    })
  ),
});
export type ProfileBuilderOutput = z.infer<typeof ProfileBuilderOutput>;

const SYSTEM_PROMPT = `
You are a compliance-focused analyst. You read a bundle of business
documents (incorporation certs, registrations, employee handbooks,
sales records, etc.) and produce a structured profile of the company.

Hard rules:
- You speak ONLY through the tool. No free-text replies.
- Never invent facts. If a field is not in the documents, return the
  literal string "unknown" for structured fields, or an honest "Not
  visible in the provided documents." for free-text fields.
- For citations, ONLY name files that actually contain the claim. Do
  not back-cite a generic file as a catch-all.
- Be specific in regulatory_signals — name the registrations, licences,
  authorities, and obligations you can see. Don't speculate.
`.trim();

const TOOL_DESCRIPTION =
  'Emit the structured + free-text company profile derived from the documents.';

export const profileBuilderContract: AgentContract<
  ProfileBuilderInput,
  ProfileBuilderOutput
> = {
  name: 'profile-builder',
  model: 'claude-sonnet-4-6',
  systemPrompt: SYSTEM_PROMPT,
  tool: {
    name: 'emit_profile',
    description: TOOL_DESCRIPTION,
    input_schema: toolInputSchema(ProfileBuilderOutput),
  },
  inputSchema: ProfileBuilderInput,
  outputSchema: ProfileBuilderOutput,
  maxTokens: 4096,
  formatUserMessage: (input: ProfileBuilderInput) =>
    `Build a compliance-focused profile from the following business documents.

${input.doc_transcript}

Now emit the profile via the emit_profile tool.`,
};

export async function runProfileBuilder(
  input: ProfileBuilderInput,
  client?: AgentRunnerClient
): Promise<ProfileBuilderOutput> {
  return callAgent(client ?? getAnthropicClient(), profileBuilderContract, input);
}
