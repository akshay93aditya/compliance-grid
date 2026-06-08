// Browser-acquire smoke. Verifies the D49 path actually renders an SPA
// portal and surfaces non-empty post-render HTML. Useful when an entry
// is tagged `access.status: browser-required` and we need to confirm
// Playwright can extract anything before investing in a full recipe.
//
// Usage:
//   npx tsx scripts/smoke-browser.ts <portal-url> [wait-selector]
//   npx tsx scripts/smoke-browser.ts https://tnrera.in/
//   npx tsx scripts/smoke-browser.ts https://tnrera.in/Notifications 'table'
//
// Prints: final URL, HTML length, anchor count, PDF anchor count, plus
// the first 10 anchor hrefs so the recipe writer can see what kind of
// listing structure to target. Exit 0 if HTML length > a baseline shell
// size (5 KB), non-zero otherwise.

import { closeBrowser, fetchWithBrowser } from '../src/acquire/browser-fetcher';
import * as cheerio from 'cheerio';

const url = process.argv[2];
const waitSelector = process.argv[3];

if (!url) {
  console.error('Usage: tsx scripts/smoke-browser.ts <portal-url> [wait-selector]');
  process.exit(2);
}

async function main(): Promise<number> {
  const t0 = Date.now();
  try {
    const result = await fetchWithBrowser(url, {
      waitUntil: 'networkidle',
      ...(waitSelector ? { waitForSelector: waitSelector } : {}),
    });
    const elapsedMs = Date.now() - t0;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes);
    const $ = cheerio.load(html);

    const anchors = $('a[href]')
      .map((_i, el) => $(el).attr('href') ?? '')
      .get()
      .filter((h) => h.length > 0);

    const pdfAnchors = anchors.filter((h) => /\.pdf(\?|$|#)/i.test(h));
    const tableCount = $('table').length;
    const trCount = $('tr').length;

    console.log(JSON.stringify({
      url,
      finalUrl: result.url,
      status: result.status,
      htmlBytes: html.length,
      elapsedMs,
      tableCount,
      trCount,
      anchorCount: anchors.length,
      pdfAnchorCount: pdfAnchors.length,
      sampleAnchors: anchors.slice(0, 10),
      samplePdfs: pdfAnchors.slice(0, 5),
    }, null, 2));

    // 5 KB is a generous shell threshold — most SPA shells are <5 KB
    // pre-render. If we got significantly more, JS executed and added
    // real content.
    return html.length > 5_000 ? 0 : 1;
  } finally {
    await closeBrowser();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
