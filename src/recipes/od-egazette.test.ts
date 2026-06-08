import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { odEGazetteRecipe } from './od-egazette';

describe('odEGazetteRecipe', () => {
  it('matches egazette.odisha.gov.in', () => {
    expect(odEGazetteRecipe.matches('https://egazette.odisha.gov.in/')).toBe(true);
    expect(
      odEGazetteRecipe.matches('https://egazette.odisha.gov.in/search_gazette/')
    ).toBe(true);
  });

  it('does not match other hosts', () => {
    expect(odEGazetteRecipe.matches('https://example.com/')).toBe(false);
    expect(odEGazetteRecipe.matches('https://gazettes.uk.gov.in/')).toBe(false);
  });

  it('builds a title from Subject + Department + date', () => {
    const html = `<body><table>
      <tr>
        <td>Name - Jayaram Das, Guardian Name - Mrutyunjaya Das</td>
        <td>Change of Name/Surname</td>
        <td>2026-06-07</td>
        <td><a href="./uploads/chang_of_name_surname/press_signed_pdf/c9a6f0f9.pdf">
          <img src="https://x/download.png"/>
        </a></td>
      </tr>
    </table></body>`;
    const [child] = extractListing(
      'https://egazette.odisha.gov.in/',
      html,
      odEGazetteRecipe
    );
    expect(child!.title).toBe(
      'Change of Name/Surname: Name - Jayaram Das, Guardian Name - Mrutyunjaya Das [2026-06-07]'
    );
    expect(child!.url).toBe(
      'https://egazette.odisha.gov.in/uploads/chang_of_name_surname/press_signed_pdf/c9a6f0f9.pdf'
    );
  });

  it('drops the manual.pdf help link', () => {
    const html = `<body>
      <a href="https://egazette.odisha.gov.in/manual/public/manual.pdf">User Manual</a>
      <table>
        <tr>
          <td>Some Dept</td><td>Subject Z</td><td>2026-05-01</td>
          <td><a href="./uploads/x/press_signed_pdf/abc.pdf">DL</a></td>
        </tr>
      </table>
    </body>`;
    const children = extractListing(
      'https://egazette.odisha.gov.in/',
      html,
      odEGazetteRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toContain('/uploads/x/press_signed_pdf/abc.pdf');
  });

  it('handles multiple rows', () => {
    const html = `<body><table>
      <tr><td>D1</td><td>S1</td><td>2026-06-01</td>
        <td><a href="./a.pdf">DL</a></td></tr>
      <tr><td>D2</td><td>S2</td><td>2026-06-02</td>
        <td><a href="./b.pdf">DL</a></td></tr>
    </table></body>`;
    const children = extractListing(
      'https://egazette.odisha.gov.in/',
      html,
      odEGazetteRecipe
    );
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual([
      'S1: D1 [2026-06-01]',
      'S2: D2 [2026-06-02]',
    ]);
  });

  it('falls back to anchor text for orphan PDFs', () => {
    const html = `<body><a href="https://egazette.odisha.gov.in/uploads/x.pdf">Some Gazette</a></body>`;
    const [child] = extractListing(
      'https://egazette.odisha.gov.in/',
      html,
      odEGazetteRecipe
    );
    expect(child!.title).toBe('Some Gazette');
  });
});
