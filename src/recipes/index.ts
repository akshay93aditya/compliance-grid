import type { ListingRecipe } from '../acquire/listing-handler';
import { dgftRecipe } from './dgft';
import { dpccDelhiRecipe } from './dpcc-delhi';
import { karmikaRecipe } from './karmika';
import { lcKeralaRecipe } from './lc-kerala';
import { odEGazetteRecipe } from './od-egazette';
import { ukEGazetteRecipe } from './uk-egazette';

// All per-portal listing recipes the system knows about. New portals get a
// dedicated recipe file and an entry here. Per D34 (Phase 1.5.1): recipes
// are deterministic; AI does not author them at runtime.
const ALL_RECIPES: ListingRecipe[] = [
  karmikaRecipe,
  dgftRecipe,
  ukEGazetteRecipe,
  odEGazetteRecipe,
  lcKeralaRecipe,
  dpccDelhiRecipe,
];

// Returns the first recipe whose matcher accepts the URL, or undefined.
// Caller decides what to do with no-recipe (default: throw or surface to human).
export function findRecipe(url: string): ListingRecipe | undefined {
  return ALL_RECIPES.find((r) => r.matches(url));
}

// Exposed for tests and for introspection (e.g. "what portals do we cover?").
export function listRecipes(): ListingRecipe[] {
  return [...ALL_RECIPES];
}

export {
  dgftRecipe,
  dpccDelhiRecipe,
  karmikaRecipe,
  lcKeralaRecipe,
  odEGazetteRecipe,
  ukEGazetteRecipe,
};
