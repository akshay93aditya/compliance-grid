import type { Browser, BrowserContext, Page } from 'playwright';
import type { FetchResult } from './fetcher';
import { USER_AGENT } from './user-agent';

// Browser-based Acquire path for SPA portals (Phase 1.5.3b, D49). Most
// modern Indian govt portals (labour.gov.in, dpal.karnataka.gov.in,
// gazettes.karnataka.gov.in, prsindia.org/billtrack, etc.) are SPAs:
// the initial HTML response is a shell, and the actual listing content
// is fetched/rendered via JavaScript after page load. Plain fetch sees
// the chrome but not the content. This module loads the URL in headless
// Chromium and returns the post-render HTML.
//
// Cost: ~1-3s per fetch after browser launch (~500ms first time).
// Memory: one Chromium process per Node process, shared across all
// fetches. Use only when the static path can't see the content.

export interface BrowserFetchOptions {
  timeoutMs?: number;
  // Wait condition before reading the rendered HTML. Default 'networkidle'
  // (resolves when there have been no network requests for 500ms) — works
  // for most SPAs but can hang on pages with long-poll connections, in
  // which case callers should switch to 'domcontentloaded' + an explicit
  // waitForSelector.
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  // Optional CSS selector to wait for before considering the page ready.
  // Useful when 'networkidle' isn't reliable for the target site.
  waitForSelector?: string;
}

// Process-singleton browser so launch cost is paid once per Node process.
// We DO NOT close the browser between fetches — that would re-launch
// Chromium ~3s per call. closeBrowser() at process exit handles cleanup.
let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import('playwright').then((pw) =>
      pw.chromium.launch({ headless: true })
    );
  }
  return browserPromise;
}

async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = getBrowser().then((b) =>
      b.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 800 },
      })
    );
  }
  return contextPromise;
}

// Fetches a URL with a headless Chromium browser. Returns the same shape
// as fetchSource so callers can swap implementations transparently.
// Throws on navigation failure (HTTP error, timeout, network error).
export async function fetchWithBrowser(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const waitUntil = options.waitUntil ?? 'networkidle';

  const context = await getContext();
  const page: Page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil,
      timeout: timeoutMs,
    });
    if (!response) {
      throw new Error(`fetchWithBrowser(${url}): no response`);
    }
    const status = response.status();
    if (status < 200 || status >= 300) {
      throw new Error(
        `fetchWithBrowser(${url}): HTTP ${status} ${response.statusText()}`
      );
    }
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, {
        timeout: timeoutMs,
      });
    }
    const html = await page.content();
    const finalUrl = page.url();
    return {
      status,
      url: finalUrl,
      contentType: 'text/html; charset=utf-8',
      bytes: new TextEncoder().encode(html),
    };
  } finally {
    await page.close();
  }
}

// Closes the shared browser process. Idempotent. Call at process exit
// (e.g. in `finally` after a batch run) to release the Chromium memory.
export async function closeBrowser(): Promise<void> {
  if (contextPromise) {
    try {
      const ctx = await contextPromise;
      await ctx.close();
    } catch {
      // best effort
    }
    contextPromise = null;
  }
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      // best effort
    }
    browserPromise = null;
  }
}
