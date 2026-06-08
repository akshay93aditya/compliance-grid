import { describe, expect, it, vi } from 'vitest';
import { acquire, sha256Hex } from './acquire';

function mockFetcher(opts: {
  status?: number;
  contentType?: string | null;
  body?: string | Uint8Array;
  url?: string;
}): typeof fetch {
  const status = opts.status ?? 200;
  const headers = new Headers();
  if (opts.contentType !== null && opts.contentType !== undefined) {
    headers.set('content-type', opts.contentType);
  }
  const body =
    typeof opts.body === 'string'
      ? new TextEncoder().encode(opts.body)
      : opts.body ?? new Uint8Array();
  const response = new Response(body as BodyInit, { status, headers });
  Object.defineProperty(response, 'url', { value: opts.url ?? '' });
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('acquire (HTML path)', () => {
  it('dispatches HTML to the HTML normalizer', async () => {
    const fetcher = mockFetcher({
      contentType: 'text/html',
      body: `<html><head><title>X</title></head><body><h2>Heading</h2><p>Body text.</p></body></html>`,
      url: 'https://example.com/page',
    });
    const result = await acquire('https://example.com/page', { fetcher });
    expect(result.kind).toBe('html');
    if (result.kind !== 'html') return;
    expect(result.html.title).toBe('X');
    expect(result.html.sections[0]!.heading).toBe('Heading');
    expect(result.html.sections[0]!.text).toContain('Body text');
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the final (post-redirect) url from the fetch result', async () => {
    const fetcher = mockFetcher({
      contentType: 'text/html',
      body: '<html><body><h2>x</h2></body></html>',
      url: 'https://example.com/redirected',
    });
    const result = await acquire('https://example.com/original', { fetcher });
    expect(result.url).toBe('https://example.com/redirected');
  });
});

describe('acquire (unknown content type)', () => {
  it('throws when content type cannot be classified', async () => {
    const fetcher = mockFetcher({
      contentType: 'application/octet-stream',
      body: new Uint8Array([0, 1, 2, 3, 4, 5]),
    });
    await expect(acquire('https://example.com/bin', { fetcher })).rejects.toThrow(
      /unsupported content type/
    );
  });
});

// Real-network smoke test. Default-skipped so the regular suite stays offline
// and credit-free (network access only; no API spend). Run manually with
// RUN_NET_TESTS=1 against example.com (RFC2606-reserved, stable HTML).
const runNet = process.env.RUN_NET_TESTS === '1';
describe.skipIf(!runNet)('acquire (network smoke)', () => {
  it('acquires example.com end-to-end', async () => {
    const result = await acquire('https://example.com/');
    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      expect(result.html.title.toLowerCase()).toContain('example');
    }
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);
});

describe('sha256Hex', () => {
  it('returns a 64-char hex digest', () => {
    const hex = sha256Hex(new TextEncoder().encode('hello'));
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
    // Known SHA-256 of "hello"
    expect(hex).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('is deterministic', () => {
    const a = sha256Hex(new TextEncoder().encode('test'));
    const b = sha256Hex(new TextEncoder().encode('test'));
    expect(a).toBe(b);
  });
});
