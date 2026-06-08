import type { AcquireResult } from '../acquire/acquire';

export interface Segment {
  // Stable id for this segment within the source. Used as the citation anchor
  // by the Extraction Agent's source_refs[i].citation_span.
  id: string;
  // The kind of structural unit this segment represents.
  kind: 'section' | 'page' | 'image';
  // Human-readable anchor (e.g. "section:s-105", "page:3"). Stored on the
  // Obligation's source_refs so the user can trace the claim back to here.
  anchor: string;
  // The text the Extraction Agent reads.
  text: string;
}

// Turns a normalized AcquireResult into a flat list of segments suitable for
// the Extraction Agent's input. One segment per HTML heading, per PDF page,
// or per OCR'd image. Empty segments (no text) are filtered out.
export function segment(result: AcquireResult): Segment[] {
  if (result.kind === 'html') {
    return result.html.sections
      .filter((s) => s.text.length > 0 || s.heading.length > 0)
      .map((s) => ({
        id: s.id,
        kind: 'section' as const,
        anchor: `section:${s.id}`,
        text: s.heading ? `${s.heading}\n\n${s.text}` : s.text,
      }));
  }
  if (result.kind === 'pdf') {
    return result.pdf.pages
      .filter((p) => p.text.length > 0)
      .map((p) => ({
        id: `page-${p.pageNumber}`,
        kind: 'page' as const,
        anchor: `page:${p.pageNumber}`,
        text: p.text,
      }));
  }
  // image
  const text = result.ocr.text;
  if (!text) return [];
  return [
    {
      id: 'image',
      kind: 'image' as const,
      anchor: 'image:full',
      text,
    },
  ];
}
