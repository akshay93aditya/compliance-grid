import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Per-portal listing recipe for the Delhi Pollution Control Committee
// (https://dpcc.delhi.gov.in/). Drupal-based site; PDF anchors live both
// on the notifications subpage (/notifications) and the homepage. Anchor
// text is the human-readable document title (e.g. "National Ambient Air
// Quality Standards", "CETP Standard").
//
// PDFs serve from /sites/default/files/<year-month>/<slug>.pdf.

const PDF_FILTER = (url: string): boolean => /\.pdf(\?|$|#)/i.test(url);

function cleanTitle(
  _$: cheerio.CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>
): string {
  const raw = ($a.text() || '').replace(/\s+/g, ' ').trim();
  return raw || 'Untitled';
}

export const dpccDelhiRecipe: ListingRecipe = {
  name: 'dpcc-delhi-gov-in',
  matches: (url: string) => /^https?:\/\/dpcc\.delhi\.gov\.in/i.test(url),
  anchorSelector: 'a[href]',
  childUrlFilter: PDF_FILTER,
  extractTitle: cleanTitle,
};
