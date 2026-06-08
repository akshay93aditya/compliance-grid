import { z } from 'zod';
import { Jurisdiction } from './jurisdiction';

// Per D15: trust tiers cover Indian sources at the granularity the product
// needs to surface freshness/trust labels honestly.
export const TrustTier = z.enum([
  'gazette',
  'govt-portal',
  'secondary',
  'unverified',
]);
export type TrustTier = z.infer<typeof TrustTier>;

// Per D16: a fetch recipe is validated but extensible. Concrete handlers
// (e.g. 'static-url', 'listing-page') register downstream as they ship.
export const FetchRecipe = z.object({
  kind: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type FetchRecipe = z.infer<typeof FetchRecipe>;

// Per docs/specs/03-architecture.md "Object schemas":
//   Source { id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash }
export const Source = z.object({
  id: z.string().min(1),
  jurisdiction: Jurisdiction,
  domain: z.string().min(1),
  url: z.url(),
  fetch_recipe: FetchRecipe,
  trust_tier: TrustTier,
  last_seen: z.iso.datetime(),
  content_hash: z.string().min(1),
});

export type Source = z.infer<typeof Source>;
