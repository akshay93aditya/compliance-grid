import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Per-portal listing recipe for the Kerala Labour Commissioner's office
// (https://lc.kerala.gov.in/). Drupal-based site; PDFs live under
// /sites/default/files/inline-files/<name>.pdf and the anchor text is
// the human-readable circular title — perfect 1:1 with what we want as
// the listing-child title.
//
// Anchor markup:
//   <a class="file file--mime-application-pdf file--application-pdf"
//      data-entity-type="file"
//      data-entity-uuid="…"
//      filename="…"
//      href="/sites/default/files/inline-files/<slug>.pdf">
//     Circular Plantation Sector — Sunstroke Prevention 2026
//   </a>
//
// Title strategy: the anchor's own text (Drupal puts the human name
// right in there). We strip the trailing `-reg` / `– reg` suffix that
// Kerala labour circulars commonly carry — pure cosmetic but keeps the
// projected card titles readable.

const PDF_FILTER = (url: string): boolean => /\.pdf(\?|$|#)/i.test(url);

const TRAILING_REG = /\s*[-–—]\s*reg\.?\s*$/i;

function cleanTitle(
  _$: cheerio.CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>
): string {
  const raw = ($a.text() || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Untitled';
  return raw.replace(TRAILING_REG, '').trim() || raw;
}

export const lcKeralaRecipe: ListingRecipe = {
  name: 'lc-kerala-gov-in',
  matches: (url: string) => /^https?:\/\/lc\.kerala\.gov\.in/i.test(url),
  // Permissive selector; the PDF-only filter weeds out nav + image
  // anchors. Don't restrict by class because some PDF anchors omit it
  // (the inline-file anchors are tagged but homepage features aren't).
  anchorSelector: 'a[href]',
  childUrlFilter: PDF_FILTER,
  extractTitle: cleanTitle,
};
