import { describe, expect, it, vi } from 'vitest';
import type { AgentRunnerClient } from './contract';
import { runDiscovery } from './discovery';

function makeClient(payload: unknown): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_sources',
            input: payload,
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

function makeFetcher(plan: Record<string, number>): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    const status = plan[url] ?? 404;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

describe('runDiscovery (unit, mocked)', () => {
  it('returns verified candidates and separates rejected ones', async () => {
    const client = makeClient({
      sources: [
        {
          url: 'https://labour.kar.nic.in/',
          title: 'Karnataka Labour Department',
          jurisdiction: 'IN-KA',
          domain: 'labour',
          proposed_fetch_recipe: { kind: 'listing-page', config: {} },
          proposed_trust_tier: 'govt-portal',
          rationale: 'Official KA labour portal.',
        },
        {
          url: 'https://nonexistent.example.invalid/',
          title: 'Phantom',
          jurisdiction: 'IN-KA',
          domain: 'labour',
          proposed_fetch_recipe: { kind: 'static-url', config: {} },
          proposed_trust_tier: 'govt-portal',
          rationale: 'Should fail.',
        },
      ],
    });
    const fetcher = makeFetcher({
      'https://labour.kar.nic.in/': 200,
      'https://nonexistent.example.invalid/': 404,
    });

    const result = await runDiscovery(
      { coordinate: { jurisdiction: 'IN-KA', domain: 'labour' } },
      { client, fetcher }
    );

    expect(result.proposed).toHaveLength(2);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]!.url).toBe('https://labour.kar.nic.in/');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain('404');
  });

  it('rejects output that fails the Zod schema (proposed_trust_tier invalid)', async () => {
    const client = makeClient({
      sources: [
        {
          url: 'https://example.com/',
          title: 'X',
          jurisdiction: 'IN-KA',
          domain: 'labour',
          proposed_fetch_recipe: { kind: 'static-url', config: {} },
          proposed_trust_tier: 'rumor',
          rationale: 'no',
        },
      ],
    });
    await expect(
      runDiscovery(
        { coordinate: { jurisdiction: 'IN-KA', domain: 'labour' } },
        { client, fetcher: makeFetcher({}) }
      )
    ).rejects.toThrow();
  });

  it('rejects output with an unsupported fetch_recipe kind', async () => {
    const client = makeClient({
      sources: [
        {
          url: 'https://example.com/',
          title: 'X',
          jurisdiction: 'IN-KA',
          domain: 'labour',
          proposed_fetch_recipe: { kind: 'rss-feed', config: {} },
          proposed_trust_tier: 'govt-portal',
          rationale: 'no',
        },
      ],
    });
    await expect(
      runDiscovery(
        { coordinate: { jurisdiction: 'IN-KA', domain: 'labour' } },
        { client, fetcher: makeFetcher({}) }
      )
    ).rejects.toThrow();
  });

  it('rejects malformed jurisdiction in input', async () => {
    await expect(
      runDiscovery(
        { coordinate: { jurisdiction: 'us-ca' as never, domain: 'labour' } },
        { client: makeClient({ sources: [] }), fetcher: makeFetcher({}) }
      )
    ).rejects.toThrow();
  });
});

// Integration test. Skipped unless ANTHROPIC_API_KEY is set. Makes one real
// API call (Haiku 4.5, ~1k tokens) and a few HEAD requests against Indian
// government domains. Designed to run rarely (credit-conscious).
const hasKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasKey)('runDiscovery (integration, live API)', () => {
  it(
    'returns at least one verified source for IN-KA labour',
    async () => {
      const result = await runDiscovery({
        coordinate: { jurisdiction: 'IN-KA', domain: 'labour' },
      });
      // Print verified + rejected for the human's review.
      // eslint-disable-next-line no-console
      console.log(
        '\nDiscovery (IN-KA labour) verified:',
        result.verified.map((c) => ({ url: c.url, tier: c.proposed_trust_tier, title: c.title }))
      );
      // eslint-disable-next-line no-console
      console.log(
        'Discovery (IN-KA labour) rejected:',
        result.rejected.map((r) => ({ url: r.candidate.url, reason: r.reason }))
      );
      expect(result.proposed.length).toBeGreaterThanOrEqual(2);
      expect(result.verified.length + result.rejected.length).toBe(
        result.proposed.length
      );
    },
    60_000
  );
});
