import { describe, expect, it } from 'vitest';
import { ocrImage } from './ocr-handler';

// 1x1 transparent PNG (well-known minimal valid PNG, ~70 bytes). Used here
// purely to verify the OCR pipeline runs end-to-end without crashing; no
// text is expected in the output.
const TRANSPARENT_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// OCR is slow (~10s for worker spin-up + recognize on the first run, faster
// after the language data is cached). Default-skipped so the regular test
// suite stays fast and free. Run manually with RUN_OCR_TESTS=1.
const runOcr = process.env.RUN_OCR_TESTS === '1';

describe('ocrImage (module exports)', () => {
  it('is a function', () => {
    expect(typeof ocrImage).toBe('function');
  });
});

describe.skipIf(!runOcr)('ocrImage (integration, tesseract.js)', () => {
  it('returns the OcrResult shape on a tiny PNG', async () => {
    const bytes = Buffer.from(TRANSPARENT_PIXEL_PNG_BASE64, 'base64');
    const result = await ocrImage(bytes);
    expect(result).toMatchObject({
      text: expect.any(String),
      confidence: expect.any(Number),
    });
  }, 60_000);
});
