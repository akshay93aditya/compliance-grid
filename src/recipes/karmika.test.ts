import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { karmikaRecipe } from './karmika';

describe('karmikaRecipe', () => {
  it('matches the karmika.karnataka.gov.in domain', () => {
    expect(
      karmikaRecipe.matches('https://karmikaspandana.karnataka.gov.in/')
    ).toBe(true);
    expect(
      karmikaRecipe.matches('https://karmikaspandana.karnataka.gov.in/16/some-page/en')
    ).toBe(true);
  });

  it('does not match other domains', () => {
    expect(karmikaRecipe.matches('https://example.com/')).toBe(false);
    expect(
      karmikaRecipe.matches('https://labour.karnataka.gov.in/')
    ).toBe(false);
  });

  it('extracts only PDFs from a listing table', () => {
    const html = `<body><table>
      <tr><td>1</td><td>08-08-2019</td><td>THE CODE ON WAGES, 2019</td><td><a href="https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts and Rules/Code on wages.pdf">View</a></td></tr>
      <tr><td>2</td><td>30-12-2025</td><td>THE CODE ON WAGES, 2019(Central Draft Rules)</td><td><a href="https://karmikaspandana.karnataka.gov.in/uploads/media_to_upload1769232287.pdf">View</a></td></tr>
      <tr><td>3</td><td>02-03-2021</td><td>Other Doc</td><td><a href="https://karmikaspandana.karnataka.gov.in/help.html">View</a></td></tr>
    </table></body>`;
    const children = extractListing(
      'https://karmikaspandana.karnataka.gov.in/16/listing/en',
      html,
      karmikaRecipe
    );
    expect(children).toHaveLength(2);
    // URL constructor percent-encodes spaces; assertion reflects that.
    expect(children.map((c) => c.url)).toEqual([
      'https://karmikaspandana.karnataka.gov.in/storage/pdf-files/Acts%20and%20Rules/Code%20on%20wages.pdf',
      'https://karmikaspandana.karnataka.gov.in/uploads/media_to_upload1769232287.pdf',
    ]);
  });

  it('strips serial number, date, and trailing "View" from the title', () => {
    const html = `<body><table>
      <tr><td>1 08-08-2019 THE CODE ON WAGES, 2019 <a href="x.pdf">View</a></td></tr>
    </table></body>`;
    const [child] = extractListing(
      'https://karmikaspandana.karnataka.gov.in/16/listing/en',
      html,
      karmikaRecipe
    );
    expect(child!.title).toBe('THE CODE ON WAGES, 2019');
  });

  it('handles a row with date but no serial number', () => {
    const html = `<body><table>
      <tr><td>30-12-2025 THE CODE ON WAGES, 2019(Central Draft Rules) <a href="x.pdf">View</a></td></tr>
    </table></body>`;
    const [child] = extractListing(
      'https://karmikaspandana.karnataka.gov.in/16/listing/en',
      html,
      karmikaRecipe
    );
    expect(child!.title).toBe('THE CODE ON WAGES, 2019(Central Draft Rules)');
  });

  it('falls back to anchor text when there is no enclosing row', () => {
    const html = `<body><a href="x.pdf">The Title</a></body>`;
    const [child] = extractListing(
      'https://karmikaspandana.karnataka.gov.in/',
      html,
      karmikaRecipe
    );
    expect(child!.title).toBe('The Title');
  });
});
