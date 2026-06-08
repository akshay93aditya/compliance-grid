import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

// Per D33 follow-up (Phase 1.5.1): a listing page is a portal index that
// links out to deep documents (typically PDFs). AI Discovery surfaces the
// portal URL; this handler then deterministically enumerates the child
// documents on that page using a per-portal recipe.
//
// AI proposes the portal (Discovery). Deterministic code disposes the
// child enumeration (this layer).

export interface ListingChild {
  url: string;
  title: string;
  rawHref: string;
}

export interface ListingRecipe {
  // Short identifier, e.g. "karmika-spandana-ka". Recorded for traceability.
  name: string;

  // Whether this recipe applies to the given portal URL.
  matches: (url: string) => boolean;

  // CSS selector for the anchor elements to consider. Default: 'a'.
  anchorSelector?: string;

  // Optional filter on the resolved (absolute) URL. Return false to drop
  // (e.g., to exclude non-PDF links).
  childUrlFilter?: (url: string) => boolean;

  // Optional title extractor. Receives cheerio API and the anchor element.
  // Default: the anchor's own text content.
  extractTitle?: (
    $: cheerio.CheerioAPI,
    anchor: cheerio.Cheerio<AnyNode>
  ) => string;

  // Phase 1.5.3b (D49): when true, `crawlPortal` fetches the listing page
  // via headless Chromium (so SPA-rendered listings can be enumerated).
  // Default false (cheap static fetch). Recipes for SPA portals declare
  // this; the orchestrator routes the fetch accordingly.
  requiresBrowser?: boolean;
}

// Pure function: parse HTML, walk anchors via the recipe, return children.
// URL resolution uses the parent page's URL as the base.
export function extractListing(
  parentUrl: string,
  html: string,
  recipe: ListingRecipe
): ListingChild[] {
  const $ = cheerio.load(html);
  const selector = recipe.anchorSelector ?? 'a';
  const seen = new Set<string>();
  const out: ListingChild[] = [];

  $(selector).each((_, el) => {
    const $a = $(el);
    const rawHref = $a.attr('href');
    if (!rawHref) return;

    let url: string;
    try {
      url = new URL(rawHref, parentUrl).toString();
    } catch {
      return;
    }

    if (recipe.childUrlFilter && !recipe.childUrlFilter(url)) return;
    if (seen.has(url)) return;
    seen.add(url);

    const title = (
      recipe.extractTitle
        ? recipe.extractTitle($, $a)
        : ($a.text().replace(/\s+/g, ' ').trim() || 'Untitled')
    ).slice(0, 500);

    out.push({ url, title: title || 'Untitled', rawHref });
  });

  return out;
}
