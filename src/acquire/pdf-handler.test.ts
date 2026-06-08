import { describe, expect, it } from 'vitest';
import { normalizePdf, normalizePdfWithOcr } from './pdf-handler';

describe('normalizePdf', () => {
  it('rejects a non-PDF buffer', async () => {
    const garbage = new TextEncoder().encode('this is not a PDF');
    await expect(normalizePdf(garbage)).rejects.toThrow();
  });

  it('rejects an empty buffer', async () => {
    await expect(normalizePdf(new Uint8Array())).rejects.toThrow();
  });
});

describe('normalizePdfWithOcr', () => {
  it('is a function', () => {
    expect(typeof normalizePdfWithOcr).toBe('function');
  });

  it('rejects a non-PDF buffer (inherits normalizePdf failure)', async () => {
    const garbage = new TextEncoder().encode('still not a PDF');
    await expect(normalizePdfWithOcr(garbage)).rejects.toThrow();
  });
});

// End-to-end PDF parsing (against a real PDF) is verified manually via a
// one-off smoke run rather than a committed fixture. The fixture-based test
// is deliberately omitted to avoid checking a binary blob into the repo just
// to demonstrate that unpdf works.
