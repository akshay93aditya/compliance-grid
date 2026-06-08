import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Per-portal listing recipe for the Uttarakhand eGazette
// (https://gazettes.uk.gov.in/). Server-rendered HTML table with rows
// of this shape:
//
//   <tr>
//     <td>{S.No}</td>
//     <td>{GO No}</td>
//     <td>{GO Date DD-MM-YYYY}</td>
//     <td>{Week Date}</td>
//     <td><strong>{Department Name}</strong></td>
//     <td>{Subject}</td>                                  <-- "NOTIFICATION" / "ORDER"
//     <td><a>{Gazette Type}</a></td>                      <-- "Daily" / "Weekly"
//     <td>{Page No}</td>
//     <td><a href="/GazetteFile/PDF\…">PDF File</a></td>
//   </tr>
//
// Note: PDF hrefs use a Windows-style backslash (`/GazetteFile/PDF\…`)
// which the WHATWG URL parser percent-encodes to %5C. The server accepts
// either form on probe.
//
// Title strategy: pair Department Name with the GO Number so the title
// is unique across rows and stays human-meaningful. Falls back to anchor
// text when the row layout doesn't match.

const PDF_FILTER = (url: string): boolean =>
  /\.pdf(\?|$|#)/i.test(url) || /%5C[^/]+\.pdf$/i.test(url);

function pickTitle(
  _$: cheerio.CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>
): string {
  const row = $a.closest('tr');
  if (row.length === 0) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const cells = row.find('> td');
  if (cells.length < 6) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const goNo = cells.eq(1).text().replace(/\s+/g, ' ').trim();
  const department = cells.eq(4).text().replace(/\s+/g, ' ').trim();
  const subject = cells.eq(5).text().replace(/\s+/g, ' ').trim();
  const head = [department, subject].filter(Boolean).join(' — ');
  return goNo && head ? `${head} (GO ${goNo})` : (head || goNo || 'Untitled');
}

export const ukEGazetteRecipe: ListingRecipe = {
  name: 'gazettes-uk-gov-in',
  matches: (url: string) => /^https?:\/\/gazettes\.uk\.gov\.in/i.test(url),
  // The PDF links live in the last <td>; we don't need a special selector,
  // but constraining to anchors that have href makes the per-row pass
  // cheaper since the page also contains "javascript:void(0)" anchors.
  anchorSelector: 'a[href]',
  childUrlFilter: PDF_FILTER,
  extractTitle: pickTitle,
};
