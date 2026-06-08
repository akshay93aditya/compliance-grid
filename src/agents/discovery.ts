import { z } from 'zod';
import { Jurisdiction } from '../schemas/jurisdiction';
import { TrustTier } from '../schemas/source';
import { getAnthropicClient } from './anthropic-client';
import {
  type AgentContract,
  type AgentRunnerClient,
  callAgent,
  toolInputSchema,
} from './contract';
import { checkReachable } from './url-verifier';

// Per docs/specs/07-agents.md (Discovery Agent):
// "Finds government sources, portals, and listing pages for a given coordinate
//  (seeded) and patrols known sources for new/changed listings (patrolling).
//  Output: schema-valid Source candidates with fetch-recipes. Never invents a
//  source; every source is a real, reachable URL it verified."
//
// We restrict the fetch_recipe kind set the AI may propose to the handlers we
// support today. As new acquire handlers ship (Phase 1.4.2+), we widen this.
export const DiscoveryFetchRecipeKind = z.enum(['static-url', 'listing-page']);
export type DiscoveryFetchRecipeKind = z.infer<typeof DiscoveryFetchRecipeKind>;

export const SourceCandidate = z.object({
  url: z.url(),
  title: z.string().min(1),
  jurisdiction: Jurisdiction,
  domain: z.string().min(1),
  proposed_fetch_recipe: z.object({
    kind: DiscoveryFetchRecipeKind,
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  proposed_trust_tier: TrustTier,
  rationale: z.string().min(1),
});
export type SourceCandidate = z.infer<typeof SourceCandidate>;

export const DiscoveryInput = z.object({
  coordinate: z.object({
    jurisdiction: Jurisdiction,
    domain: z.string().min(1),
  }),
});
export type DiscoveryInput = z.infer<typeof DiscoveryInput>;

export const DiscoveryOutput = z.object({
  sources: z.array(SourceCandidate).min(1).max(4),
});
export type DiscoveryOutput = z.infer<typeof DiscoveryOutput>;

const SYSTEM_PROMPT = `You are the Discovery Agent for the Compliance Grid project, an AI-first infrastructure layer for Indian regulatory compliance.

Your task: given a regulatory coordinate (jurisdiction + domain), propose 2 to 4 authoritative government sources where instruments and obligations for that coordinate are published.

Hard rules:
- Only propose URLs you are reasonably confident exist on legitimate Indian government domains. Typical patterns include *.gov.in, *.nic.in, state-specific portals such as karnataka.gov.in, and gazette sites.
- Do not invent or guess URLs. If you are uncertain, omit the candidate. Quality over quantity.
- Prefer primary sources (official gazettes, ministry websites, department portals) over secondary aggregators.
- Each source must be a public web page or PDF link.

For each source provide:
- url: the exact URL.
- title: a brief human-readable title.
- jurisdiction: matching the input coordinate.
- domain: matching the input coordinate.
- proposed_fetch_recipe: an object with a kind ("static-url" or "listing-page") and an empty config object.
- proposed_trust_tier: one of "gazette", "govt-portal", "secondary", "unverified".
- rationale: one sentence explaining why this is an authoritative source.

Return your output by calling the propose_sources tool. Do not return text.`;

const discoveryContract: AgentContract<DiscoveryInput, DiscoveryOutput> = {
  name: 'discovery',
  model: 'claude-haiku-4-5-20251001',
  systemPrompt: SYSTEM_PROMPT,
  tool: {
    name: 'propose_sources',
    description:
      'Return the proposed government sources for the given regulatory coordinate.',
    input_schema: toolInputSchema(DiscoveryOutput),
  },
  inputSchema: DiscoveryInput,
  outputSchema: DiscoveryOutput,
  formatUserMessage: ({ coordinate }) =>
    `Coordinate: jurisdiction=${coordinate.jurisdiction}, domain=${coordinate.domain}. Propose 2 to 4 authoritative Indian government sources for this coordinate.`,
  maxTokens: 1500,
};

export interface DiscoveryRunResult {
  proposed: SourceCandidate[];
  verified: SourceCandidate[];
  rejected: { candidate: SourceCandidate; reason: string }[];
}

// Runs the Discovery Agent for a given coordinate and verifies each proposed
// URL's reachability before returning. The AI proposes; this function (the
// deterministic gate) disposes.
export async function runDiscovery(
  input: DiscoveryInput,
  options: {
    client?: AgentRunnerClient;
    fetcher?: typeof fetch;
  } = {}
): Promise<DiscoveryRunResult> {
  const client = options.client ?? getAnthropicClient();
  const result = await callAgent(client, discoveryContract, input);

  const verified: SourceCandidate[] = [];
  const rejected: { candidate: SourceCandidate; reason: string }[] = [];
  for (const candidate of result.sources) {
    const reachability = await checkReachable(candidate.url, {
      fetcher: options.fetcher,
    });
    if (reachability.kind === 'reachable') {
      verified.push(candidate);
    } else {
      rejected.push({ candidate, reason: reachability.reason });
    }
  }

  return { proposed: result.sources, verified, rejected };
}

// Exported for tests.
export { discoveryContract };
