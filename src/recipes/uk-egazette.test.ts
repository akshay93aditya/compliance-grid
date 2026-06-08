import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { ukEGazetteRecipe } from './uk-egazette';

describe('ukEGazetteRecipe', () => {
  it('matches gazettes.uk.gov.in', () => {
    expect(ukEGazetteRecipe.matches('https://gazettes.uk.gov.in/')).toBe(true);
    expect(
      ukEGazetteRecipe.matches('https://gazettes.uk.gov.in/GazetteFile/PDF/x.pdf')
    ).toBe(true);
  });

  it('does not match other hosts', () => {
    expect(ukEGazetteRecipe.matches('https://example.com/')).toBe(false);
    expect(ukEGazetteRecipe.matches('https://gazettes.in/')).toBe(false);
  });

  it('builds a title from Department + Subject + GO Number', () => {
    const html = `<body><table>
      <tr>
        <td>1</td>
        <td>190/रा0नि0आ0-3/1379/2013 (2024)</td>
        <td>25-05-2026</td>
        <td>25-05-2026</td>
        <td><strong>UTTARAKHAND STATE ELECTION COMMISSION</strong></td>
        <td>NOTIFICATION</td>
        <td><a href="javascript:void(0)">Daily</a></td>
        <td>0</td>
        <td><a href="/GazetteFile/PDF\\4525-050626104338.pdf" onclick="downloadcount();">PDF File</a></td>
      </tr>
    </table></body>`;
    const [child] = extractListing(
      'https://gazettes.uk.gov.in/',
      html,
      ukEGazetteRecipe
    );
    expect(child!.title).toBe(
      'UTTARAKHAND STATE ELECTION COMMISSION — NOTIFICATION (GO 190/रा0नि0आ0-3/1379/2013 (2024))'
    );
    // URL constructor percent-encodes the backslash.
    expect(child!.url).toMatch(/gazettes\.uk\.gov\.in\/GazetteFile\/PDF.*\.pdf$/);
  });

  it('drops javascript:void anchors and keeps only the PDF', () => {
    const html = `<body><table>
      <tr>
        <td>1</td><td>g1</td><td>01-06-2026</td><td>01-06-2026</td>
        <td>Dept A</td><td>NOTIFICATION</td>
        <td><a href="javascript:void(0)">Daily</a></td>
        <td>0</td>
        <td><a href="/GazetteFile/PDF/one.pdf">PDF File</a></td>
      </tr>
    </table></body>`;
    const children = extractListing(
      'https://gazettes.uk.gov.in/',
      html,
      ukEGazetteRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe('https://gazettes.uk.gov.in/GazetteFile/PDF/one.pdf');
  });

  it('handles multiple rows with deduplication by URL', () => {
    const html = `<body><table>
      <tr>
        <td>1</td><td>g1</td><td>01-06-2026</td><td>01-06-2026</td>
        <td>Dept A</td><td>NOTIFICATION</td>
        <td>Daily</td><td>0</td>
        <td><a href="/GazetteFile/PDF/a.pdf">PDF File</a></td>
      </tr>
      <tr>
        <td>2</td><td>g2</td><td>02-06-2026</td><td>02-06-2026</td>
        <td>Dept B</td><td>ORDER</td>
        <td>Weekly</td><td>0</td>
        <td><a href="/GazetteFile/PDF/b.pdf">PDF File</a></td>
      </tr>
    </table></body>`;
    const children = extractListing(
      'https://gazettes.uk.gov.in/',
      html,
      ukEGazetteRecipe
    );
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual([
      'Dept A — NOTIFICATION (GO g1)',
      'Dept B — ORDER (GO g2)',
    ]);
  });

  it('falls back to anchor text when row has too few cells', () => {
    const html = `<body><a href="https://gazettes.uk.gov.in/x.pdf">Bare PDF link</a></body>`;
    const [child] = extractListing(
      'https://gazettes.uk.gov.in/',
      html,
      ukEGazetteRecipe
    );
    expect(child!.title).toBe('Bare PDF link');
  });
});
