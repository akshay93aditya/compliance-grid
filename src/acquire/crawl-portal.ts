import {
  fetchWithBrowser,
  type BrowserFetchOptions,
} from './browser-fetcher';
import { fetchSource, type FetchOptions } from './fetcher';
import { extractListing, type ListingChild } from './listing-handler';
import { findRecipe } from '../recipes/index';

export class NoRecipeError extends Error {
  constructor(public readonly url: string) {
    super(`crawlPortal: no listing recipe registered for URL ${url}`);
    this.name = 'NoRecipeError';
  }
}

export interface CrawlPortalResult {
  parentUrl: string;
  recipeName: string;
  children: ListingChild[];
}

export interface CrawlPortalOptions extends FetchOptions {
  // Phase 1.5.3b (D49): use headless Chromium to render JS-driven SPA
  // listing pages before extracting children. Recipes for SPA portals
  // declare `requiresBrowser: true` and the orchestrator forces this
  // on for them; static portals (e.g. karmika) ignore the flag.
  useBrowser?: boolean;
  browser?: BrowserFetchOptions;
}

// High-level: fetch a portal HTML page and enumerate the child documents
// linked from it using the matching per-portal recipe.
//
// Throws NoRecipeError if no recipe is registered for the URL. Per D34:
// recipes are deliberate registrations, not AI-authored at runtime.
// Per D49: a recipe with `requiresBrowser: true` automatically forces
// the browser-based fetch even when the caller didn't pass useBrowser.
export async function crawlPortal(
  url: string,
  options: CrawlPortalOptions = {}
): Promise<CrawlPortalResult> {
  const recipe = findRecipe(url);
  if (!recipe) throw new NoRecipeError(url);

  const useBrowser = options.useBrowser || recipe.requiresBrowser === true;
  const fetched = useBrowser
    ? await fetchWithBrowser(url, options.browser ?? {})
    : await fetchSource(url, options);

  const html = new TextDecoder('utf-8', { fatal: false }).decode(fetched.bytes);
  const children = extractListing(fetched.url, html, recipe);

  return {
    parentUrl: fetched.url,
    recipeName: recipe.name,
    children,
  };
}
