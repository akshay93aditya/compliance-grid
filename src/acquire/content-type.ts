// Detect what kind of document we fetched. Uses the Content-Type header when
// trustworthy and falls back to magic-byte sniffing. Returns 'unknown' if we
// can't classify, which the orchestrator surfaces as an unsupported type.

export type DocType = 'html' | 'pdf' | 'image-png' | 'image-jpeg' | 'unknown';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // "\x89PNG"
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

export function detectContentType(
  contentTypeHeader: string | null,
  bytes: Uint8Array
): DocType {
  const header = (contentTypeHeader ?? '').toLowerCase();
  if (header.includes('text/html') || header.includes('application/xhtml+xml')) {
    return 'html';
  }
  if (header.includes('application/pdf')) return 'pdf';
  if (header.includes('image/png')) return 'image-png';
  if (header.includes('image/jpeg') || header.includes('image/jpg')) {
    return 'image-jpeg';
  }

  // Header was missing or wrong; sniff magic bytes.
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, PNG_MAGIC)) return 'image-png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'image-jpeg';

  // Loose HTML sniff on the first 1KB.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, 1024))
    .trim()
    .toLowerCase();
  if (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<html')
  ) {
    return 'html';
  }

  return 'unknown';
}
