import { describe, expect, it } from 'vitest';
import { extractListing } from '../acquire/listing-handler';
import { dpccDelhiRecipe } from './dpcc-delhi';

describe('dpccDelhiRecipe', () => {
  it('matches dpcc.delhi.gov.in', () => {
    expect(dpccDelhiRecipe.matches('https://dpcc.delhi.gov.in/')).toBe(true);
    expect(
      dpccDelhiRecipe.matches('https://dpcc.delhi.gov.in/notifications')
    ).toBe(true);
  });

  it('does not match other delhi.gov.in hosts', () => {
    expect(dpccDelhiRecipe.matches('https://labour.delhi.gov.in/')).toBe(false);
    expect(dpccDelhiRecipe.matches('https://industries.delhi.gov.in/')).toBe(
      false
    );
  });

  it('uses anchor text as the title', () => {
    const html = `<body>
      <a href="/sites/default/files/2026-01/national_ambient_air_quality_standards.pdf">
        National Ambient Air Quality Standards
      </a>
    </body>`;
    const [child] = extractListing(
      'https://dpcc.delhi.gov.in/notifications',
      html,
      dpccDelhiRecipe
    );
    expect(child!.title).toBe('National Ambient Air Quality Standards');
    expect(child!.url).toBe(
      'https://dpcc.delhi.gov.in/sites/default/files/2026-01/national_ambient_air_quality_standards.pdf'
    );
  });

  it('skips non-PDF anchors', () => {
    const html = `<body>
      <a href="/about">About</a>
      <a href="/sites/default/files/2026-01/stpstandards.pdf">STP Standard</a>
    </body>`;
    const children = extractListing(
      'https://dpcc.delhi.gov.in/',
      html,
      dpccDelhiRecipe
    );
    expect(children).toHaveLength(1);
    expect(children[0]!.title).toBe('STP Standard');
  });

  it('de-duplicates by URL', () => {
    const html = `<body>
      <a href="/files/a.pdf">First</a>
      <a href="/files/a.pdf">First again</a>
    </body>`;
    const children = extractListing(
      'https://dpcc.delhi.gov.in/',
      html,
      dpccDelhiRecipe
    );
    expect(children).toHaveLength(1);
  });
});
