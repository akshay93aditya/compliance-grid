import { describe, expect, it, vi } from 'vitest';
import { checkReachable } from './url-verifier';

function mockFetcher(plan: { method: string; status: number }[]) {
  let i = 0;
  return vi.fn().mockImplementation(async (_url: string, init: { method: string }) => {
    const expected = plan[i++];
    expect(init.method).toBe(expected!.method);
    return new Response(null, { status: expected!.status });
  });
}

describe('checkReachable', () => {
  it('returns reachable when HEAD returns 200', async () => {
    const fetcher = mockFetcher([{ method: 'HEAD', status: 200 }]);
    const result = await checkReachable('https://example.com', { fetcher });
    expect(result.kind).toBe('reachable');
    if (result.kind === 'reachable') expect(result.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to GET when HEAD returns 405', async () => {
    const fetcher = mockFetcher([
      { method: 'HEAD', status: 405 },
      { method: 'GET', status: 200 },
    ]);
    const result = await checkReachable('https://example.com', { fetcher });
    expect(result.kind).toBe('reachable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('treats non-2xx (non-405) as unreachable', async () => {
    const fetcher = mockFetcher([{ method: 'HEAD', status: 404 }]);
    const result = await checkReachable('https://example.com/missing', { fetcher });
    expect(result.kind).toBe('unreachable');
    if (result.kind === 'unreachable') expect(result.reason).toContain('404');
  });

  it('treats a thrown error from fetch as unreachable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await checkReachable('https://nope.invalid', { fetcher });
    expect(result.kind).toBe('unreachable');
    if (result.kind === 'unreachable') expect(result.reason).toContain('ENOTFOUND');
  });

  it('treats a 5xx as unreachable', async () => {
    const fetcher = mockFetcher([{ method: 'HEAD', status: 503 }]);
    const result = await checkReachable('https://example.com', { fetcher });
    expect(result.kind).toBe('unreachable');
  });

  it('still rejects when GET fallback also fails', async () => {
    const fetcher = mockFetcher([
      { method: 'HEAD', status: 405 },
      { method: 'GET', status: 500 },
    ]);
    const result = await checkReachable('https://example.com', { fetcher });
    expect(result.kind).toBe('unreachable');
  });
});
