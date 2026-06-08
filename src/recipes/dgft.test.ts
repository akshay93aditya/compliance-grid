import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { dgftRecipe } from './dgft';

describe('dgftRecipe', () => {
  it('matches www.dgft.gov.in and content.dgft.gov.in', () => {
    expect(dgftRecipe.matches('https://www.dgft.gov.in/CP/?opt=notification')).toBe(true);
    expect(dgftRecipe.matches('https://dgft.gov.in/CP/')).toBe(true);
    expect(
      dgftRecipe.matches('https://content.dgft.gov.in/Website/dgftprod/abc/x.pdf')
    ).toBe(true);
  });

  it('does not match other hosts', () => {
    expect(dgftRecipe.matches('https://example.com/')).toBe(false);
    expect(dgftRecipe.matches('https://gst.gov.in/')).toBe(false);
  });

  it('extracts the Description column (col 4) as the title', () => {
    const html = `<body><table>
      <tr>
        <td>2</td>
        <td>20/2026-27</td>
        <td>2026-2027</td>
        <td>Amendment in import policy condition of specific ITC HS Codes covered under Chapter 71 of ITC (HS), 2022, Schedule - I (Import Policy)-reg.</td>
        <td>02/06/2026</td>
        <td style="display:none">02/06/2026 16:10:34</td>
        <td>
          <a title="Download" class="attachmentBtn" href="https://content.dgft.gov.in/Website/dgftprod/b9d85c14/English_0002.pdf" target="_blank" download>
            Download <i class="fa fa-file-pdf-o">&nbsp;</i>(Type : PDF)
          </a>
        </td>
      </tr>
    </table></body>`;
    const [child] = extractListing(
      'https://www.dgft.gov.in/CP/?opt=notification',
      html,
      dgftRecipe
    );
    expect(child!.url).toBe(
      'https://content.dgft.gov.in/Website/dgftprod/b9d85c14/English_0002.pdf'
    );
    expect(child!.title).toBe(
      'Amendment in import policy condition of specific ITC HS Codes covered under Chapter 71 of ITC (HS), 2022, Schedule - I (Import Policy)-reg.'
    );
  });

  it('handles multiple rows and de-duplicates by URL', () => {
    const html = `<body><table>
      <tr>
        <td>1</td><td>20</td><td>2026-27</td>
        <td>First notification</td>
        <td>01/06/2026</td><td style="display:none">01/06/2026</td>
        <td><a class="attachmentBtn" href="https://content.dgft.gov.in/a.pdf">Download</a></td>
      </tr>
      <tr>
        <td>2</td><td>21</td><td>2026-27</td>
        <td>Second notification</td>
        <td>02/06/2026</td><td style="display:none">02/06/2026</td>
        <td><a class="attachmentBtn" href="https://content.dgft.gov.in/b.pdf">Download</a></td>
      </tr>
    </table></body>`;
    const children = extractListing(
      'https://www.dgft.gov.in/CP/?opt=notification',
      html,
      dgftRecipe
    );
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual([
      'First notification',
      'Second notification',
    ]);
  });

  it('skips non-PDF child URLs', () => {
    const html = `<body><table>
      <tr>
        <td>1</td><td>20</td><td>2026-27</td>
        <td>PDF row</td><td>01/06/2026</td>
        <td style="display:none">01/06/2026</td>
        <td><a class="attachmentBtn" href="https://content.dgft.gov.in/a.pdf">Download</a></td>
      </tr>
      <tr>
        <td>2</td><td>21</td><td>2026-27</td>
        <td>HTML row</td><td>02/06/2026</td>
        <td style="display:none">02/06/2026</td>
        <td><a class="attachmentBtn" href="https://content.dgft.gov.in/help.html">Download</a></td>
      </tr>
    </table></body>`;
    const children = extractListing(
      'https://www.dgft.gov.in/CP/?opt=notification',
      html,
      dgftRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.title).toBe('PDF row');
  });

  it('falls back to anchor text when there is no enclosing row', () => {
    const html = `<body><a class="attachmentBtn" href="https://content.dgft.gov.in/x.pdf">Bare PDF link</a></body>`;
    const [child] = extractListing(
      'https://www.dgft.gov.in/CP/',
      html,
      dgftRecipe
    );
    expect(child!.title).toBe('Bare PDF link');
  });
});
