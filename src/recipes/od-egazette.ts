import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Per-portal listing recipe for the Odisha eGazette
// (https://egazette.odisha.gov.in/). The homepage shows recent gazette
// entries in a 4-column server-rendered table:
//
//   <tr>
//     <td>{Department}</td>      <-- name + guardian, or actual department
//     <td>{Subject}</td>          <-- "Change of Name/Surname", "Change of Partnership", etc.
//     <td>{Issue Date YYYY-MM-DD}</td>
//     <td><a href="./uploads/{category}/press_signed_pdf/{uuid}.pdf">
//       <img src="…/download.png"/></a></td>
//   </tr>
//
// PDF hrefs are relative paths (./uploads/...). extractListing resolves
// them against the parent URL via the WHATWG URL constructor.
//
// Title strategy: pair Department text with Subject so the title is both
// unique across rows and indicates the gazette category.

function pickTitle(
  _$: cheerio.CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>
): string {
  const row = $a.closest('tr');
  if (row.length === 0) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const cells = row.find('> td');
  if (cells.length < 3) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const department = cells.eq(0).text().replace(/\s+/g, ' ').trim();
  const subject = cells.eq(1).text().replace(/\s+/g, ' ').trim();
  const date = cells.eq(2).text().replace(/\s+/g, ' ').trim();
  // {Subject}: {Department} [{date}] — Subject first since it's the
  // categorisation; Department is often a person name for change-of-name
  // gazettes.
  const head = [subject, department].filter(Boolean).join(': ');
  return date ? `${head} [${date}]` : head || 'Untitled';
}

const PDF_FILTER = (url: string): boolean => /\.pdf(\?|$|#)/i.test(url);

export const odEGazetteRecipe: ListingRecipe = {
  name: 'egazette-odisha-gov-in',
  matches: (url: string) =>
    /^https?:\/\/egazette\.odisha\.gov\.in/i.test(url),
  // Keep selector permissive — the page's download anchor wraps an <img>,
  // not text — but childUrlFilter weeds out non-PDFs (e.g. the manual.pdf
  // help link, which we want to drop since it's not a gazette).
  anchorSelector: 'a[href]',
  childUrlFilter: (url: string) => {
    if (!PDF_FILTER(url)) return false;
    // Drop the static help/manual page; gazette PDFs live under /uploads/.
    if (/\/manual\/public\/manual\.pdf$/i.test(url)) return false;
    return true;
  },
  extractTitle: pickTitle,
};
