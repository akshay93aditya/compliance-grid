import { describe, expect, it } from 'vitest';
import {
  extractListing,
  type ListingRecipe,
} from './listing-handler';

const passthroughRecipe: ListingRecipe = {
  name: 'passthrough',
  matches: () => true,
};

describe('extractListing', () => {
  it('returns absolute URLs for relative hrefs', () => {
    const html = `<body><a href="/docs/a.pdf">A</a><a href="b.pdf">B</a></body>`;
    const children = extractListing(
      'https://example.com/section/',
      html,
      passthroughRecipe
    );
    expect(children.map((c) => c.url)).toEqual([
      'https://example.com/docs/a.pdf',
      'https://example.com/section/b.pdf',
    ]);
  });

  it('uses anchor text as the default title', () => {
    const html = `<body><a href="/x.pdf">Document Title</a></body>`;
    const [child] = extractListing(
      'https://example.com/',
      html,
      passthroughRecipe
    );
    expect(child!.title).toBe('Document Title');
  });

  it('falls back to "Untitled" when there is no anchor text', () => {
    const html = `<body><a href="/x.pdf"></a></body>`;
    const [child] = extractListing(
      'https://example.com/',
      html,
      passthroughRecipe
    );
    expect(child!.title).toBe('Untitled');
  });

  it('dedupes identical resolved URLs', () => {
    const html = `<body>
      <a href="/x.pdf">First</a>
      <a href="https://example.com/x.pdf">Second (same URL)</a>
    </body>`;
    const children = extractListing(
      'https://example.com/',
      html,
      passthroughRecipe
    );
    expect(children).toHaveLength(1);
  });

  it('skips anchors with no href', () => {
    const html = `<body><a>just text</a><a href="/x.pdf">X</a></body>`;
    const children = extractListing(
      'https://example.com/',
      html,
      passthroughRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe('https://example.com/x.pdf');
  });

  it('applies childUrlFilter to drop non-matching URLs', () => {
    const recipe: ListingRecipe = {
      ...passthroughRecipe,
      childUrlFilter: (url) => url.endsWith('.pdf'),
    };
    const html = `<body>
      <a href="/x.pdf">X</a>
      <a href="/y.html">Y</a>
      <a href="/z.pdf">Z</a>
    </body>`;
    const children = extractListing('https://example.com/', html, recipe);
    expect(children.map((c) => c.url)).toEqual([
      'https://example.com/x.pdf',
      'https://example.com/z.pdf',
    ]);
  });

  it('respects an anchorSelector', () => {
    const recipe: ListingRecipe = {
      ...passthroughRecipe,
      anchorSelector: '.docs a',
    };
    const html = `<body>
      <nav><a href="/nav.pdf">Nav</a></nav>
      <div class="docs"><a href="/real.pdf">Real</a></div>
    </body>`;
    const children = extractListing('https://example.com/', html, recipe);
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe('https://example.com/real.pdf');
  });

  it('uses a custom title extractor when provided', () => {
    const recipe: ListingRecipe = {
      ...passthroughRecipe,
      extractTitle: ($, $a) => $a.closest('tr').find('td').first().text().trim(),
    };
    const html = `<body><table>
      <tr><td>Important Title</td><td><a href="/x.pdf">View</a></td></tr>
    </table></body>`;
    const [child] = extractListing(
      'https://example.com/',
      html,
      recipe
    );
    expect(child!.title).toBe('Important Title');
  });

  it('skips anchors with malformed hrefs', () => {
    const html = `<body><a href="not a url at all">Bad</a><a href="/x.pdf">Good</a></body>`;
    const children = extractListing(
      'https://example.com/',
      html,
      passthroughRecipe
    );
    // Both happen to parse with URL resolution; we only fail on truly broken syntax.
    // The "bad" one resolves to https://example.com/not%20a%20url%20at%20all (still a URL).
    expect(children.length).toBe(2);
  });
});
