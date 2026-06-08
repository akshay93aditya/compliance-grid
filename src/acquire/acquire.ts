import { createHash } from 'node:crypto';
import {
  fetchWithBrowser,
  type BrowserFetchOptions,
} from './browser-fetcher';
import { detectContentType } from './content-type';
import { fetchSource, type FetchOptions } from './fetcher';
import { normalizeHtml, type NormalizedHtml } from './html-handler';
import { normalizePdfWithOcr, type NormalizedPdf } from './pdf-handler';
import { ocrImage, type OcrResult } from './ocr-handler';

export type AcquireResult =
  | {
      kind: 'html';
      url: string;
      bytes: Uint8Array;
      contentHash: string;
      html: NormalizedHtml;
    }
  | {
      kind: 'pdf';
      url: string;
      bytes: Uint8Array;
      contentHash: string;
      pdf: NormalizedPdf;
    }
  | {
      kind: 'image';
      url: string;
      bytes: Uint8Array;
      contentHash: string;
      ocr: OcrResult;
    };

export interface AcquireOptions extends FetchOptions {
  // Phase 1.5.3b (D49): when true, fetch via headless Chromium so SPA
  // portals can render their JS-driven content before HTML extraction.
  // ~1-3s slower than a plain fetch; only use when the static path
  // returns a shell rather than real content.
  useBrowser?: boolean;
  browser?: BrowserFetchOptions;
}

// Fetch a URL and normalize its content. Dispatch by detected content type:
//   html        -> normalizeHtml (cheerio)
//   pdf         -> normalizePdfWithOcr (unpdf text layer; OCR-of-PDF
//                   fallback for scanned pages — a surprising number of
//                   Indian govt notifications are scanned image PDFs,
//                   e.g. DGFT notifications served from content.dgft.gov.in
//                   have an empty text layer and require OCR per page)
//   image-*     -> ocrImage      (tesseract.js)
//   unknown     -> throw
//
// content_hash is sha256 of the raw bytes, which becomes the persisted
// Source.content_hash via persistSource (src/db/sources.ts).
export async function acquire(
  url: string,
  options: AcquireOptions = {}
): Promise<AcquireResult> {
  const fetched = options.useBrowser
    ? await fetchWithBrowser(url, options.browser ?? {})
    : await fetchSource(url, options);
  const docType = detectContentType(fetched.contentType, fetched.bytes);
  const contentHash = sha256Hex(fetched.bytes);

  switch (docType) {
    case 'html': {
      const html = normalizeHtml(
        new TextDecoder('utf-8', { fatal: false }).decode(fetched.bytes)
      );
      return { kind: 'html', url: fetched.url, bytes: fetched.bytes, contentHash, html };
    }
    case 'pdf': {
      const pdf = await normalizePdfWithOcr(fetched.bytes);
      return { kind: 'pdf', url: fetched.url, bytes: fetched.bytes, contentHash, pdf };
    }
    case 'image-png':
    case 'image-jpeg': {
      const ocr = await ocrImage(fetched.bytes);
      return { kind: 'image', url: fetched.url, bytes: fetched.bytes, contentHash, ocr };
    }
    case 'unknown':
      throw new Error(
        `acquire(${url}): unsupported content type. Header was ${JSON.stringify(
          fetched.contentType
        )}; magic-byte sniff yielded "unknown".`
      );
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
