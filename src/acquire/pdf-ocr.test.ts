import { describe, expect, it } from 'vitest';
import { ocrPdf } from './pdf-ocr';

// pdf-to-png-converter renders PDF pages via pdfjs + @napi-rs/canvas, then
// tesseract.js OCRs each PNG. Integration runs are expensive (~seconds per
// page) and need a real PDF fixture, so they live behind RUN_OCR_TESTS=1 in
// the same spirit as ocr-handler.test.ts.
describe('ocrPdf', () => {
  it('is a function', () => {
    expect(typeof ocrPdf).toBe('function');
  });

  it('rejects a non-PDF buffer', async () => {
    const garbage = new TextEncoder().encode('this is not a PDF');
    await expect(ocrPdf(garbage)).rejects.toThrow();
  });

  it('returns an empty result when pages is an empty array', async () => {
    // Should short-circuit before touching pdf-to-png-converter, so the
    // garbage bytes never get parsed.
    const garbage = new TextEncoder().encode('not a PDF either');
    const result = await ocrPdf(garbage, { pages: [] });
    expect(result).toEqual({ pageCount: 0, pages: [], text: '' });
  });
});
