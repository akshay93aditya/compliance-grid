import { z } from 'zod';
import { Jurisdiction } from './jurisdiction';

// Phase 3.2 (D50) — Source Index entry schema. One file per source under
// `sources/<jurisdiction>/<domain>/<id>.yaml`. Pure metadata; no AI cost
// to curate. This is the public registry of WHERE the law lives. A new
// operator clones the repo and immediately has the full map.
//
// The CKG sources table (src/schemas/source.ts) is a related but distinct
// thing: it records the documents that were actually extracted to produce
// committed obligations. A Source Index entry can yield zero, one, or
// many CKG sources depending on whether it's a listing portal or a
// direct-document URL.

const TrustTier = z.enum(['gazette', 'govt-portal', 'secondary', 'unverified']);

const FetchRecipe = z.object({
  kind: z.enum(['static-url', 'listing-page']),
  requires_browser: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// Governance level of the issuing body. Drives downstream routing
// (jurisdiction-level filtering, applicability defaults). Added in the
// Codex Source Index first-pass.
export const GovernanceLevel = z.enum(['central', 'state', 'local']);
export type GovernanceLevel = z.infer<typeof GovernanceLevel>;

// Access state for the source. Codex's contract: honest state of how a
// recipe writer / patrol can reach the content, NOT whether the URL
// returned HTTP 200. A page that returns 200 but renders content via
// JavaScript is `browser-required`, not `static-html-needs-recipe`.
// Conversion from `blocked` to `verified` requires personal verification.
export const AccessStatus = z.enum([
  'verified', // Personally accessed; recipe exists OR direct fetch works.
  'static-html-needs-recipe', // Server-rendered listing/document; recipe is the only missing piece.
  'browser-required', // SPA or JS-rendered; requires the D49 browser-acquire path.
  'form-postback-needs-recipe', // Reachable but needs session/form/POST recipe.
  'blocked', // WAF / geo-restriction / 4xx; needs an access investigation before any scrape attempt.
  'needs-access-probe', // Not yet personally inspected; do not assume any of the above.
]);
export type AccessStatus = z.infer<typeof AccessStatus>;

const Access = z.object({
  status: AccessStatus,
  // Free-text descriptions populated by the Codex first-pass. Optional
  // here because the field set may grow; concrete consumers should
  // tolerate missing values.
  update_surface: z.string().optional(),
  approach: z.string().optional(),
  next_step: z.string().optional(),
  notes: z.string().optional(),
});

// Issuing/operating body for the source. Surveyed across all 207 Codex
// first-pass entries: 11 distinct values cover everything. New values
// added here in PR — keeping it as an enum catches typos and gives
// consumers exhaustive switch coverage.
export const AuthorityType = z.enum([
  'department',
  'ministry',
  'board',
  'statutory-regulator',
  'statutory-professional-body',
  'tribunal',
  'committee',
  'transactional-portal',
  'market-infrastructure',
  'secondary-tracker',
  'local-body',
]);
export type AuthorityType = z.infer<typeof AuthorityType>;

const Authority = z.object({
  name: z.string().min(1),
  type: AuthorityType,
  // Higher-level body the authority reports into. Optional because not
  // every entry has a meaningful parent (e.g. a central ministry has no
  // formal parent within the index).
  parent: z.string().optional(),
});

// How an entry was verified at registration time. `curl-head` and
// `curl-get` are the two HTTP-level probes Codex used; future entries
// may add browser-based or manual-inspection methods.
export const VerificationMethod = z.enum(['curl-head', 'curl-get']);
export type VerificationMethod = z.infer<typeof VerificationMethod>;

// Verification outcome. Distinct from `access.status`: this is whether
// the URL responded at registration time, NOT whether the content is
// scrape-ready. A site can have `verification.status: verified` AND
// `access.status: blocked` (the URL responds 200, but a downstream
// service like Akamai rate-limits actual scrapes).
export const VerificationStatus = z.enum(['verified', 'blocked']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

const Verification = z.object({
  method: VerificationMethod,
  status: VerificationStatus,
});

// What kinds of legal instruments the source publishes. The current
// vocabulary (Notification, Guideline, Licence, ...) is the Codex
// first-pass distinct set — kept as free-form strings rather than an
// enum because the list will grow as new entries arrive. Consumers
// should normalise case/whitespace before comparing.
const InstrumentTypeName = z.string().min(1);

// Topical tags scoped to the source. Free-form, lowercase-kebab. Same
// no-enum reasoning as instrument_types — this list grows.
const CoverageTopic = z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
  error: 'coverage.topics entries must be lowercase-with-hyphens (a-z, 0-9, hyphens; no leading/trailing hyphen)',
});

const Coverage = z.object({
  instrument_types: z.array(InstrumentTypeName).min(1),
  topics: z.array(CoverageTopic).min(1),
});

// Slug allowed in `id`: lowercase letters, digits, hyphens. Must be unique
// per (jurisdiction, domain); enforced by the validator (filename uniqueness
// is enough in practice since the path includes jurisdiction + domain).
const ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const SourceIndexEntry = z.object({
  id: z.string().regex(ID_RE, {
    error: 'id must be lowercase-with-hyphens (a-z, 0-9, hyphens; no leading/trailing hyphen)',
  }),
  url: z.url(),
  jurisdiction: Jurisdiction,
  domain: z.string().min(1),
  trust_tier: TrustTier,
  fetch_recipe: FetchRecipe,
  // Codex first-pass fields. Optional for backward-compatibility with the
  // original Phase 3.2 entries; new contributions should set them. The
  // patrol/discovery routing code reads `access.status` directly to
  // decide whether to attempt fetching, queue an access investigation,
  // or hand off to the browser path.
  governance_level: GovernanceLevel.optional(),
  authority: Authority.optional(),
  coverage: Coverage.optional(),
  verification: Verification.optional(),
  access: Access.optional(),
  notes: z.string().optional(),
  maintainer: z.string().optional(),
  added: z.iso.date().optional(),
  last_verified: z.iso.date().optional(),
});

export type SourceIndexEntry = z.infer<typeof SourceIndexEntry>;
