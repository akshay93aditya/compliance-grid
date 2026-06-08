import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { createTableListingRecipe } from './factory';

describe('createTableListingRecipe', () => {
  it('reproduces the karmika behavior with the default leading/trailing strips', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: () => true,
    });
    const html = `<body><table>
      <tr><td>1 08-08-2019 THE CODE ON WAGES, 2019 <a href="https://example.com/code.pdf">View</a></td></tr>
    </table></body>`;
    const [child] = extractListing('https://example.com/', html, recipe);
    expect(child!.title).toBe('THE CODE ON WAGES, 2019');
    expect(child!.url).toBe('https://example.com/code.pdf');
  });

  it('only keeps PDF children by default', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: () => true,
    });
    const html = `<body><table>
      <tr><td>1 01-01-2020 A <a href="https://x/a.pdf">View</a></td></tr>
      <tr><td>2 02-01-2020 B <a href="https://x/b.html">View</a></td></tr>
    </table></body>`;
    const children = extractListing('https://x/', html, recipe);
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe('https://x/a.pdf');
  });

  it('accepts custom leading and trailing strips for portals with different row formats', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: () => true,
      leadingStrips: [/^Document:\s*/i],
      trailingStrips: [/\s*Download\s*$/i],
    });
    const html = `<body><table>
      <tr><td>Document: KA SHOPS RULES, 2018 <a href="https://x/a.pdf">Download</a></td></tr>
    </table></body>`;
    const [child] = extractListing('https://x/', html, recipe);
    expect(child!.title).toBe('KA SHOPS RULES, 2018');
  });

  it('accepts a custom childUrlFilter (e.g. for HTML sub-pages)', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: () => true,
      childUrlFilter: (url) => url.includes('/notification/'),
    });
    const html = `<body><table>
      <tr><td>1 X <a href="https://x/notification/1">View</a></td></tr>
      <tr><td>2 Y <a href="https://x/photo/1.jpg">View</a></td></tr>
    </table></body>`;
    const children = extractListing('https://x/', html, recipe);
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe('https://x/notification/1');
  });

  it('falls back to the anchor text when there is no enclosing row', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: () => true,
    });
    const html = `<body><a href="https://x/a.pdf">A Title</a></body>`;
    const [child] = extractListing('https://x/', html, recipe);
    expect(child!.title).toBe('A Title');
  });

  it('matches host via the supplied hostMatcher', () => {
    const recipe = createTableListingRecipe({
      name: 'test',
      hostMatcher: (url) => /example\.gov\.in/.test(url),
    });
    expect(recipe.matches('https://www.example.gov.in/listing')).toBe(true);
    expect(recipe.matches('https://other.gov.in/')).toBe(false);
  });
});
