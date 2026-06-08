import type * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ListingRecipe } from '../acquire/listing-handler';

// Per-portal listing recipe for DGFT (Directorate General of Foreign Trade).
//
// DGFT publishes notifications, public notices, and trade notices at
// https://www.dgft.gov.in/CP/?opt={notification|public-notice|trade-notice}.
// Each surface is a server-rendered HTML table with this row shape:
//
//   <tr>
//     <td>{Sl.No}</td>
//     <td>{Number}</td>
//     <td>{Year}</td>
//     <td>{Description}</td>           <-- the row title
//     <td>{Date DD/MM/YYYY}</td>
//     <td style="display:none">{CRT DT}</td>
//     <td><a class="attachmentBtn" href="{PDF URL on content.dgft.gov.in}">
//       Download (Type : PDF)</a></td>
//   </tr>
//
// The PDF link points at content.dgft.gov.in (separate CDN). We match
// on both www.dgft.gov.in (the listing host) and content.dgft.gov.in
// (so the PDF host is also recognised as DGFT-origin for downstream
// tagging).
//
// The karmika factory does not fit: the title we want is column 4
// (Description), not the concatenated row text. So we provide a
// custom extractTitle that picks the right cell.

function pickDescriptionCell(
  _$: cheerio.CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>
): string {
  // Walk up to the enclosing <tr>. The Description column is the
  // fourth visible <td> (column index 3). We skip hidden cells
  // (`display:none`) so the index stays stable even if the CRT DT
  // hidden cell is reordered.
  const row = $a.closest('tr');
  if (row.length === 0) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const visibleCells = row.find('> td').filter((_i, el) => {
    const style = ((el as { attribs?: Record<string, string> }).attribs?.style ?? '').toLowerCase();
    return !style.includes('display:none') && !style.includes('display: none');
  });
  if (visibleCells.length < 4) {
    return ($a.text() || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  const description = visibleCells.eq(3).text().replace(/\s+/g, ' ').trim();
  return description || 'Untitled';
}

const PDF_FILTER = (url: string): boolean => /\.pdf(\?|$|#)/i.test(url);

export const dgftRecipe: ListingRecipe = {
  name: 'dgft-gov-in',
  matches: (url: string) =>
    /^https?:\/\/(www\.)?(content\.)?dgft\.gov\.in/i.test(url),
  anchorSelector: 'a.attachmentBtn, a[href$=".pdf"], a[href*=".pdf?"]',
  childUrlFilter: PDF_FILTER,
  extractTitle: pickDescriptionCell,
};
