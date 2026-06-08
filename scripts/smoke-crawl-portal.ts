// End-to-end smoke for crawlPortal — exercises the production fetcher,
// recipe registry, and extractListing pipeline against a live URL.
// No database or Anthropic key required: this is the "discover children"
// half of the patrol, isolated.
//
// Usage:
//   npx tsx scripts/smoke-crawl-portal.ts <portal-url>
//   npx tsx scripts/smoke-crawl-portal.ts \
//     https://www.dgft.gov.in/CP/?opt=notification
//
// Exit code 0 on at least one child extracted; non-zero otherwise.

import { crawlPortal } from '../src/acquire/crawl-portal';

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx scripts/smoke-crawl-portal.ts <portal-url>');
  process.exit(2);
}

async function main(): Promise<number> {
  const t0 = Date.now();
  let result;
  try {
    result = await crawlPortal(url);
  } catch (err) {
    console.error('crawlPortal threw:', err instanceof Error ? err.message : err);
    return 1;
  }
  const elapsedMs = Date.now() - t0;

  console.log(JSON.stringify({
    url,
    recipe: result.recipeName,
    parentUrlAfterRedirects: result.parentUrl,
    childrenFound: result.children.length,
    elapsedMs,
    firstFive: result.children.slice(0, 5).map((c) => ({
      title: c.title.length > 120 ? c.title.slice(0, 120) + '…' : c.title,
      url: c.url,
    })),
  }, null, 2));

  return result.children.length > 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
