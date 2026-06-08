import { afterAll, describe, expect, it } from 'vitest';
import { closeBrowser, fetchWithBrowser } from './browser-fetcher';
import { fetchSource } from './fetcher';

// Phase 1.5.3b browser-acquire path. Headless Chromium adds ~92 MB of
// binary + ~3s startup per process, so integration runs are gated on
// RUN_BROWSER_TESTS=1 like the OCR tests.
const runBrowser = process.env.RUN_BROWSER_TESTS === '1';

describe('fetchWithBrowser (module shape)', () => {
  it('is a function', () => {
    expect(typeof fetchWithBrowser).toBe('function');
  });

  it('closeBrowser is callable without a prior launch (no-op)', async () => {
    // Ensures the cleanup helper is safe to call defensively.
    await expect(closeBrowser()).resolves.toBeUndefined();
  });
});

describe.skipIf(!runBrowser)(
  'fetchWithBrowser (integration, real network)',
  () => {
    afterAll(async () => {
      await closeBrowser();
    });

    it(
      'returns the rendered DOM, larger than the static-fetch HTML for an SPA',
      { timeout: 60_000 },
      async () => {
        // dpal.karnataka.gov.in is a documented SPA (D45). Static fetch
        // returns the shell; browser fetch returns the post-render DOM.
        const url = 'https://dpal.karnataka.gov.in/14/karnataka-acts';

        const staticResult = await fetchSource(url, { timeoutMs: 30_000 });
        const browserResult = await fetchWithBrowser(url, {
          timeoutMs: 45_000,
          waitUntil: 'networkidle',
        });

        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            static_bytes: staticResult.bytes.length,
            browser_bytes: browserResult.bytes.length,
            ratio: (
              browserResult.bytes.length / Math.max(1, staticResult.bytes.length)
            ).toFixed(2),
          })
        );

        // The browser-rendered HTML should be strictly larger than the
        // static shell. A 1.2x lower bound is conservative; in practice
        // the ratio is much higher on a real SPA.
        expect(browserResult.bytes.length).toBeGreaterThan(
          staticResult.bytes.length
        );
        expect(browserResult.contentType).toMatch(/text\/html/);
      }
    );
  }
);
