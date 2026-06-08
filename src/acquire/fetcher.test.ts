import { describe, expect, it, vi } from 'vitest';
import { fetchSource } from './fetcher';
import { CONTACT_EMAIL, USER_AGENT } from './user-agent';

function mockFetcher(opts: {
  status?: number;
  contentType?: string | null;
  body?: string;
  url?: string;
}): typeof fetch {
  const status = opts.status ?? 200;
  const headers = new Headers();
  if (opts.contentType !== null && opts.contentType !== undefined) {
    headers.set('content-type', opts.contentType);
  }
  const body = opts.body ?? '';
  const response = new Response(body as BodyInit, { status, headers });
  Object.defineProperty(response, 'url', { value: opts.url ?? '' });
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('fetchSource', () => {
  it('returns status, url, contentType, and bytes on success', async () => {
    const fetcher = mockFetcher({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body>hi</body></html>',
      url: 'https://example.com/page',
    });
    const result = await fetchSource('https://example.com/page', { fetcher });
    expect(result.status).toBe(200);
    expect(result.contentType).toContain('text/html');
    expect(new TextDecoder().decode(result.bytes)).toBe('<html><body>hi</body></html>');
    expect(result.url).toBe('https://example.com/page');
  });

  it('sends the project User-Agent', async () => {
    const fetcher = mockFetcher({ status: 200 });
    await fetchSource('https://example.com/', { fetcher });
    const init = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ 'User-Agent': USER_AGENT });
  });

  it('sends Accept-Language and From headers for politeness + UA filter resilience', async () => {
    const fetcher = mockFetcher({ status: 200 });
    await fetchSource('https://example.com/', { fetcher });
    const init = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      'Accept-Language': 'en-IN,en;q=0.9',
      From: CONTACT_EMAIL,
    });
  });

  it('throws on a 4xx response', async () => {
    const fetcher = mockFetcher({ status: 404 });
    await expect(fetchSource('https://example.com/missing', { fetcher })).rejects.toThrow(
      /HTTP 404/
    );
  });

  it('throws on a 5xx response', async () => {
    const fetcher = mockFetcher({ status: 503 });
    await expect(fetchSource('https://example.com/down', { fetcher })).rejects.toThrow(
      /HTTP 503/
    );
  });

  it('propagates network errors from fetch', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as unknown as typeof fetch;
    await expect(fetchSource('https://nope.invalid/', { fetcher })).rejects.toThrow(
      /ENOTFOUND/
    );
  });
});
