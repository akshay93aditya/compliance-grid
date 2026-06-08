import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Generalises the karmika pattern: a portal with a static-HTML listing page
// where each row of a table contains some boilerplate (serial number, date,
// link text) plus the document title. The PDFs live in the `href` of an
// anchor inside the row.
//
// Per D45 most modern govt portals are SPAs, but the karmika style does
// recur on the static ones. Adding a new portal that fits the pattern is
// one call to createTableListingRecipe instead of writing a recipe by hand.

export interface CreateTableListingRecipeOptions {
  // Short identifier for the recipe (e.g. 'karmika-spandana-ka').
  name: string;
  // Whether the recipe applies to the given URL. Typically a hostname regex.
  hostMatcher: (url: string) => boolean;
  // Optional anchor selector. Defaults to all anchors.
  anchorSelector?: string;
  // Predicate for which child URLs to keep. Defaults to `.pdf` URLs only,
  // matching the karmika and similar gazette patterns.
  childUrlFilter?: (url: string) => boolean;
  // Stripped from the start of the row text, in order. Defaults match the
  // karmika row format: optional serial number then DD-MM-YYYY date.
  leadingStrips?: RegExp[];
  // Stripped from the end of the row text. Defaults to a trailing 'View'
  // (the link's own anchor text on karmika).
  trailingStrips?: RegExp[];
  // Phase 1.5.3b (D49): set to true for SPA portals so crawlPortal renders
  // the page in headless Chromium before applying the recipe. Default false
  // (cheap static fetch).
  requiresBrowser?: boolean;
}

const DEFAULT_PDF_FILTER = (url: string): boolean =>
  /\.pdf(\?|$|#)/i.test(url);

const DEFAULT_LEADING_STRIPS: RegExp[] = [
  /^\d+\s+/, // serial number "1 ", "12 "
  /^\d{2}-\d{2}-\d{4}\s+/, // DD-MM-YYYY date
];

const DEFAULT_TRAILING_STRIPS: RegExp[] = [
  /\s*View\s*$/i, // trailing "View" anchor text
];

export function createTableListingRecipe(
  options: CreateTableListingRecipeOptions
): ListingRecipe {
  const leadingStrips = options.leadingStrips ?? DEFAULT_LEADING_STRIPS;
  const trailingStrips = options.trailingStrips ?? DEFAULT_TRAILING_STRIPS;

  return {
    name: options.name,
    matches: options.hostMatcher,
    ...(options.anchorSelector !== undefined
      ? { anchorSelector: options.anchorSelector }
      : {}),
    ...(options.requiresBrowser ? { requiresBrowser: true } : {}),
    childUrlFilter: options.childUrlFilter ?? DEFAULT_PDF_FILTER,
    extractTitle: (_$: cheerio.CheerioAPI, $a: cheerio.Cheerio<AnyNode>) => {
      const row = $a.closest('tr');
      const fallback = () =>
        ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
      if (row.length === 0) return fallback();
      let text = row.text().replace(/\s+/g, ' ').trim();
      for (const re of trailingStrips) text = text.replace(re, '').trim();
      for (const re of leadingStrips) text = text.replace(re, '').trim();
      return text || fallback();
    },
  };
}
