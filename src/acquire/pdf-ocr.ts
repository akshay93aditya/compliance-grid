import { pdfToPng } from 'pdf-to-png-converter';
import { ocrImage } from './ocr-handler';

export interface OcrPdfPage {
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface OcrPdfResult {
  pageCount: number;
  pages: OcrPdfPage[];
  text: string;
}

export interface OcrPdfOptions {
  // 1-based page numbers to render+OCR. Omit to OCR every page.
  pages?: number[];
  // Render scale multiplier. 2 yields ~2x viewport pixels, good for OCR.
  // pdf-to-png-converter clamps above 100; we default to 2.
  viewportScale?: number;
  // Hard ceiling on number of pages to OCR in one call. Protects against
  // accidental whole-document OCR on a 300+ page scan. Default 50.
  maxPages?: number;
}

const DEFAULT_VIEWPORT_SCALE = 2;
const DEFAULT_MAX_PAGES = 50;

// Renders selected PDF pages to PNG (via pdf-to-png-converter, which bundles
// pdfjs-dist + @napi-rs/canvas) and runs tesseract.js OCR on each. Returns the
// same shape as normalizePdf so callers can swap implementations.
//
// Per D46 this is the OCR-of-PDF capability that was deferred from Phase 1.4.2.
// It is expensive (seconds per page) — callers must pick a page subset or
// accept the maxPages cap.
export async function ocrPdf(
  bytes: Uint8Array,
  options: OcrPdfOptions = {}
): Promise<OcrPdfResult> {
  const viewportScale = options.viewportScale ?? DEFAULT_VIEWPORT_SCALE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const requested = options.pages;
  const pagesToProcess =
    requested === undefined ? undefined : requested.slice(0, maxPages);
  if (requested !== undefined && requested.length === 0) {
    return { pageCount: 0, pages: [], text: '' };
  }

  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rendered = await pdfToPng(buf, {
    viewportScale,
    ...(pagesToProcess !== undefined ? { pagesToProcess } : {}),
  });

  const capped = pagesToProcess === undefined ? rendered.slice(0, maxPages) : rendered;

  const pages: OcrPdfPage[] = [];
  for (const page of capped) {
    if (!page.content) {
      pages.push({ pageNumber: page.pageNumber, text: '', confidence: 0 });
      continue;
    }
    const ocr = await ocrImage(page.content);
    pages.push({
      pageNumber: page.pageNumber,
      text: ocr.text,
      confidence: ocr.confidence,
    });
  }

  return {
    pageCount: pages.length,
    pages,
    text: pages.map((p) => p.text).join('\n\n'),
  };
}
