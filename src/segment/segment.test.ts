import { describe, expect, it } from 'vitest';
import type { AcquireResult } from '../acquire/acquire';
import { segment } from './segment';

describe('segment', () => {
  it('produces one segment per HTML section', () => {
    const result: AcquireResult = {
      kind: 'html',
      url: 'https://example.com/',
      bytes: new Uint8Array(),
      contentHash: 'x',
      html: {
        title: 'X',
        text: 'all text',
        sections: [
          { id: 'sec-a', heading: 'A', level: 2, text: 'alpha' },
          { id: 'sec-b', heading: 'B', level: 2, text: 'beta' },
        ],
      },
    };
    const segments = segment(result);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      id: 'sec-a',
      kind: 'section',
      anchor: 'section:sec-a',
    });
    expect(segments[0]!.text).toContain('A');
    expect(segments[0]!.text).toContain('alpha');
  });

  it('produces one segment per non-empty PDF page', () => {
    const result: AcquireResult = {
      kind: 'pdf',
      url: 'https://example.com/x.pdf',
      bytes: new Uint8Array(),
      contentHash: 'x',
      pdf: {
        pageCount: 3,
        pages: [
          { pageNumber: 1, text: 'page one' },
          { pageNumber: 2, text: '' }, // blank, filtered out
          { pageNumber: 3, text: 'page three' },
        ],
        text: 'page one\n\n\n\npage three',
      },
    };
    const segments = segment(result);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.anchor)).toEqual(['page:1', 'page:3']);
  });

  it('produces one segment from an OCR result', () => {
    const result: AcquireResult = {
      kind: 'image',
      url: 'https://example.com/scan.png',
      bytes: new Uint8Array(),
      contentHash: 'x',
      ocr: { text: 'recognized text', confidence: 87.5 },
    };
    const segments = segment(result);
    expect(segments).toEqual([
      {
        id: 'image',
        kind: 'image',
        anchor: 'image:full',
        text: 'recognized text',
      },
    ]);
  });

  it('returns an empty list when an OCR result has no text', () => {
    const result: AcquireResult = {
      kind: 'image',
      url: 'https://example.com/blank.png',
      bytes: new Uint8Array(),
      contentHash: 'x',
      ocr: { text: '', confidence: 0 },
    };
    expect(segment(result)).toEqual([]);
  });

  it('returns an empty list when HTML has no sections', () => {
    const result: AcquireResult = {
      kind: 'html',
      url: 'https://example.com/',
      bytes: new Uint8Array(),
      contentHash: 'x',
      html: { title: '', text: '', sections: [] },
    };
    expect(segment(result)).toEqual([]);
  });
});
