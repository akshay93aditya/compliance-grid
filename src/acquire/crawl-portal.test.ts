import { describe, expect, it, vi } from 'vitest';
import { NoRecipeError, crawlPortal } from './crawl-portal';

function mockFetcher(opts: {
  url?: string;
  contentType?: string;
  body: string;
}): typeof fetch {
  const headers = new Headers();
  headers.set('content-type', opts.contentType ?? 'text/html; charset=utf-8');
  const response = new Response(opts.body as BodyInit, { status: 200, headers });
  Object.defineProperty(response, 'url', { value: opts.url ?? '' });
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('crawlPortal (unit, mocked)', () => {
  it('throws NoRecipeError when no recipe matches the URL', async () => {
    await expect(crawlPortal('https://example.com/')).rejects.toBeInstanceOf(
      NoRecipeError
    );
  });

  it('uses the karmika recipe and returns PDF children for karmika URLs', async () => {
    const html = `<body><table>
      <tr><td>1 08-08-2019 THE CODE ON WAGES, 2019 <a href="https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts and Rules/Code on wages.pdf">View</a></td></tr>
      <tr><td>2 30-12-2025 THE CODE ON WAGES, 2019(Central Draft Rules) <a href="https://karmikaspandana.karnataka.gov.in/uploads/media_to_upload1769232287.pdf">View</a></td></tr>
      <tr><td>3 01-01-2020 Help Page (HTML) <a href="https://karmikaspandana.karnataka.gov.in/help.html">View</a></td></tr>
    </table></body>`;
    const fetcher = mockFetcher({
      url: 'https://karmikaspandana.karnataka.gov.in/16/listing/en',
      body: html,
    });

    const result = await crawlPortal(
      'https://karmikaspandana.karnataka.gov.in/16/listing/en',
      { fetcher }
    );

    expect(result.recipeName).toBe('karmika-spandana-ka');
    expect(result.children).toHaveLength(2);
    expect(result.children[0]!.title).toBe('THE CODE ON WAGES, 2019');
  });
});

// Real-network smoke test. Skipped unless RUN_NET_TESTS=1 (the same gate
// already used by the Acquire example.com test). Verifies that the karmika
// listing page actually returns a reasonable number of PDF children when
// crawled against the live site.
const runNet = process.env.RUN_NET_TESTS === '1';
describe.skipIf(!runNet)('crawlPortal (network smoke, karmika)', () => {
  it(
    'returns at least 5 PDF children from the karmika labour-rules listing',
    async () => {
      const result = await crawlPortal(
        'https://karmikaspandana.karnataka.gov.in/16/new-labour-rules-and-bills/en'
      );
      // eslint-disable-next-line no-console
      console.log(
        '\nkarmika crawl returned',
        result.children.length,
        'PDFs. First 5:'
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          result.children.slice(0, 5).map((c) => ({ title: c.title, url: c.url })),
          null,
          2
        )
      );
      expect(result.children.length).toBeGreaterThanOrEqual(5);
      for (const c of result.children) {
        expect(c.url).toMatch(/\.pdf/i);
        expect(c.title.length).toBeGreaterThan(0);
      }
    },
    30_000
  );
});
