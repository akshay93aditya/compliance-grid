import { extractText, getDocumentProxy } from 'unpdf';
import { ocrPdf } from './pdf-ocr';

export interface PdfPage {
  pageNumber: number;
  text: string;
  // Where this page's text came from. 'text-layer' is the PDF's embedded text;
  // 'ocr' means tesseract was run on a rendered image of the page. Undefined
  // on normalizePdf() results that never invoked OCR.
  source?: 'text-layer' | 'ocr';
}

export interface NormalizedPdf {
  pageCount: number;
  pages: PdfPage[];
  text: string;
  // 'text-layer' when every page came from the embedded text layer; 'ocr'
  // when every page came from OCR; 'mixed' when the document had both.
  source?: 'text-layer' | 'ocr' | 'mixed';
}

// Extracts text from a PDF's text layer. Does not perform OCR on scanned
// (image-only) PDFs; those return a pages array with empty text and the
// caller can route to OCR or surface as unsupported.
//
// Per D29 we use `unpdf` (built on pdfjs-dist) for text extraction. The
// OCR-of-PDF fallback is in normalizePdfWithOcr below (D46).
export async function normalizePdf(bytes: Uint8Array): Promise<NormalizedPdf> {
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: false });
  const textArr = Array.isArray(result.text) ? result.text : [result.text];
  const pages: PdfPage[] = textArr.map((pageText, i) => ({
    pageNumber: i + 1,
    text: (pageText ?? '').trim(),
  }));
  return {
    pageCount: result.totalPages,
    pages,
    text: pages.map((p) => p.text).join('\n\n'),
  };
}

export interface NormalizePdfWithOcrOptions {
  // A page whose text-layer extraction yields fewer than this many
  // non-whitespace characters is treated as "empty" and OCR'd. Default 50.
  emptyTextThreshold?: number;
  // Hard cap on number of pages to OCR. Protects against accidentally
  // OCRing a 300-page scan when the threshold misclassifies every page.
  // Default 50; passed through to ocrPdf.
  maxOcrPages?: number;
  // Render scale for OCR. Default 2.
  viewportScale?: number;
}

const DEFAULT_EMPTY_TEXT_THRESHOLD = 50;

// Per D46: text-layer first, page-level OCR fallback. Pages that already
// have substantive text from the text layer are left alone; pages whose
// text-layer extraction is empty (or below emptyTextThreshold) are rendered
// to PNG and OCR'd. Mixed documents (some pages scanned, some born-digital)
// only pay OCR cost on the scanned pages.
export async function normalizePdfWithOcr(
  bytes: Uint8Array,
  options: NormalizePdfWithOcrOptions = {}
): Promise<NormalizedPdf> {
  const threshold = options.emptyTextThreshold ?? DEFAULT_EMPTY_TEXT_THRESHOLD;
  // Defensive copy: unpdf's pdfjs backend transfers the underlying
  // ArrayBuffer to a worker, leaving the original Uint8Array detached.
  // If we then pass the same `bytes` to ocrPdf (which also wraps pdfjs),
  // the second call throws "Cannot perform Construct on a detached
  // ArrayBuffer". We clone once here so each downstream call owns its
  // own buffer.
  const ocrBytes = bytes.slice();
  const base = await normalizePdf(bytes);

  const emptyPageNumbers = base.pages
    .filter((p) => nonWhitespaceLength(p.text) < threshold)
    .map((p) => p.pageNumber);

  if (emptyPageNumbers.length === 0) {
    return {
      ...base,
      pages: base.pages.map((p) => ({ ...p, source: 'text-layer' as const })),
      source: 'text-layer',
    };
  }

  const ocr = await ocrPdf(ocrBytes, {
    pages: emptyPageNumbers,
    ...(options.maxOcrPages !== undefined ? { maxPages: options.maxOcrPages } : {}),
    ...(options.viewportScale !== undefined
      ? { viewportScale: options.viewportScale }
      : {}),
  });
  const ocrByPage = new Map(ocr.pages.map((p) => [p.pageNumber, p.text]));

  let textLayerPages = 0;
  let ocrPages = 0;
  const merged: PdfPage[] = base.pages.map((p) => {
    const ocrText = ocrByPage.get(p.pageNumber);
    if (ocrText !== undefined && emptyPageNumbers.includes(p.pageNumber)) {
      ocrPages += 1;
      return { pageNumber: p.pageNumber, text: ocrText, source: 'ocr' };
    }
    textLayerPages += 1;
    return { pageNumber: p.pageNumber, text: p.text, source: 'text-layer' };
  });

  const source: NormalizedPdf['source'] =
    ocrPages === 0
      ? 'text-layer'
      : textLayerPages === 0
        ? 'ocr'
        : 'mixed';

  return {
    pageCount: merged.length,
    pages: merged,
    text: merged.map((p) => p.text).join('\n\n'),
    source,
  };
}

function nonWhitespaceLength(s: string): number {
  let n = 0;
  for (const ch of s) if (!/\s/.test(ch)) n += 1;
  return n;
}
