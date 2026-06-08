import { loadSourceIndex, type SourceIndexEntry } from '../db/coverage';
import type { ProfileBuilderOutput } from '../agents/profile-builder';

// Per docs/specs/07-agents.md (Applicability Matcher): deterministic
// ranking of Source Index entries against a derived company profile.
// No AI cost — the matcher is a pure function so a user can scroll the
// output and audit each weight without re-running anything.
//
// Scoring is intentionally simple in v1:
//   +3  jurisdiction match (entry.jurisdiction is in profile's
//       primary or other jurisdictions, OR is 'IN' central)
//   +2  domain matches one of the profile's signaled domains (derived
//       from sector + regulatory_signals)
//   +1  domain is a "universal" compliance area applicable to most
//       entities (tax, legal, labour for any entity with employees)
//
// A future revision can refine this with the same scoring shape — the
// agent contract is "given this profile + this index, return ranked
// entries" not "use this specific scoring."

export interface ApplicabilityMatch {
  entry: SourceIndexEntry;
  score: number;
  reasons: string[];
}

// Coarse sector → domain hints. Used to give a regulator the +2 if a
// user in that sector is more likely to need to comply with it. Free
// text from `profile.regulatory_signals` is also matched against the
// `domain` string for opportunistic boosts.
const SECTOR_DOMAIN_HINTS: Record<string, string[]> = {
  manufacturing: ['labour', 'environment', 'industry', 'tax', 'pharma'],
  pharma: ['pharma', 'environment', 'tax', 'labour'],
  'it-software': ['data-digital', 'tax', 'labour', 'foreign-trade'],
  fintech: ['financial', 'securities', 'tax', 'legal'],
  retail: ['tax', 'real-estate', 'labour', 'legal'],
  logistics: ['transport', 'tax', 'labour', 'maritime'],
  'real-estate': ['real-estate', 'tax', 'environment', 'legal'],
  agriculture: ['agriculture', 'tax', 'environment', 'labour'],
  energy: ['energy', 'environment', 'tax', 'labour'],
};

const UNIVERSAL_DOMAINS = new Set([
  'tax',
  'legal',
  'corporate',
  'foreign-trade',
]);

export interface MatchInput {
  profile: ProfileBuilderOutput;
  sourceIndexDir?: string;
}

export async function rankApplicableSources(
  input: MatchInput
): Promise<ApplicabilityMatch[]> {
  const entries = await loadSourceIndex(input.sourceIndexDir);
  const profile = input.profile;

  // Build the jurisdiction allow-set: profile's primary + other + IN.
  const allowJurisdictions = new Set<string>(['IN']);
  if (profile.primary_jurisdiction !== 'unknown') {
    allowJurisdictions.add(profile.primary_jurisdiction);
  }
  for (const j of profile.other_jurisdictions) allowJurisdictions.add(j);

  // Sector-driven domain hints.
  const sectorKey = profile.sector.toLowerCase().trim();
  const sectorDomains = new Set<string>(SECTOR_DOMAIN_HINTS[sectorKey] ?? []);

  // Opportunistic: scan the regulatory_signals text for known domain
  // tokens. Crude but very useful for "they mentioned GST" type signals.
  const regSignal = (profile.regulatory_signals ?? '').toLowerCase();
  const tokensInSignals = new Set<string>(
    [
      'gst',
      'tax',
      'income-tax',
      'rbi',
      'sebi',
      'fema',
      'mca',
      'companies-act',
      'epfo',
      'esi',
      'factory',
      'environment',
      'pollution',
      'fda',
      'fssai',
      'shops-and-establishment',
      'dgft',
      'export',
      'import',
      'customs',
    ].filter((t) => regSignal.includes(t))
  );

  const matches: ApplicabilityMatch[] = [];
  for (const entry of entries) {
    const reasons: string[] = [];
    let score = 0;

    if (allowJurisdictions.has(entry.jurisdiction)) {
      score += 3;
      reasons.push(`+3 jurisdiction match (${entry.jurisdiction})`);
    } else {
      // Skip non-applicable jurisdictions early — they have no path to
      // a non-zero score in v1.
      continue;
    }

    if (sectorDomains.has(entry.domain)) {
      score += 2;
      reasons.push(`+2 sector ${profile.sector} typically engages ${entry.domain}`);
    }

    if (UNIVERSAL_DOMAINS.has(entry.domain)) {
      score += 1;
      reasons.push(`+1 universal domain (${entry.domain})`);
    }

    if (tokensInSignals.has(entry.domain) || tokensInSignals.has(entry.id)) {
      score += 2;
      reasons.push('+2 signal in docs mentions this domain/regulator');
    }

    matches.push({ entry, score, reasons });
  }

  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return matches;
}
