import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { lcKeralaRecipe } from './lc-kerala';

describe('lcKeralaRecipe', () => {
  it('matches lc.kerala.gov.in', () => {
    expect(lcKeralaRecipe.matches('https://lc.kerala.gov.in/')).toBe(true);
    expect(
      lcKeralaRecipe.matches('https://lc.kerala.gov.in/sites/default/files/inline-files/x.pdf')
    ).toBe(true);
  });

  it('does not match other hosts', () => {
    expect(lcKeralaRecipe.matches('https://example.com/')).toBe(false);
    expect(lcKeralaRecipe.matches('https://labour.kerala.gov.in/')).toBe(false);
  });

  it('extracts the anchor text as title with trailing "-reg" stripped', () => {
    const html = `<body>
      <a class="file file--mime-application-pdf"
         href="/sites/default/files/inline-files/wages.pdf">
        Minimum Wages Act-Inclusion of Automobile Industry sector-reg
      </a>
    </body>`;
    const [child] = extractListing(
      'https://lc.kerala.gov.in/',
      html,
      lcKeralaRecipe
    );
    expect(child!.title).toBe(
      'Minimum Wages Act-Inclusion of Automobile Industry sector'
    );
    expect(child!.url).toBe(
      'https://lc.kerala.gov.in/sites/default/files/inline-files/wages.pdf'
    );
  });

  it('preserves the title when there is no trailing "-reg"', () => {
    const html = `<body>
      <a href="/sites/default/files/inline-files/holiday.pdf">
        Kerala Legislative Assembly General Election 2026 - Order on granting paid holiday
      </a>
    </body>`;
    const [child] = extractListing(
      'https://lc.kerala.gov.in/',
      html,
      lcKeralaRecipe
    );
    expect(child!.title).toBe(
      'Kerala Legislative Assembly General Election 2026 - Order on granting paid holiday'
    );
  });

  it('drops non-PDF anchors (nav links, images, etc.)', () => {
    const html = `<body>
      <a href="/about">About</a>
      <a href="/contact.html">Contact</a>
      <a href="/sites/default/files/inline-files/circular.pdf">Real Circular</a>
    </body>`;
    const children = extractListing(
      'https://lc.kerala.gov.in/',
      html,
      lcKeralaRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.title).toBe('Real Circular');
  });

  it('handles many rows + de-duplicates by URL', () => {
    const html = `<body>
      <a href="/files/a.pdf">First</a>
      <a href="/files/b.pdf">Second</a>
      <a href="/files/a.pdf">First duplicate (dropped)</a>
    </body>`;
    const children = extractListing(
      'https://lc.kerala.gov.in/',
      html,
      lcKeralaRecipe
    );
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual(['First', 'Second']);
  });

  it('falls back to Untitled for an empty anchor', () => {
    const html = `<body><a href="/files/x.pdf"></a></body>`;
    const [child] = extractListing(
      'https://lc.kerala.gov.in/',
      html,
      lcKeralaRecipe
    );
    expect(child!.title).toBe('Untitled');
  });
});
