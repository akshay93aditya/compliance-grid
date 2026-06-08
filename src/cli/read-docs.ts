import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { normalizePdfWithOcr } from '../acquire/pdf-handler';

// Reads every supported business doc under a folder and returns a flat
// list of { path, text } pairs. Supports PDF (text-layer with OCR
// fallback for scans), plain text (.txt, .md). Skips DOCX/XLSX for the
// CLI MVP — those need additional handlers we haven't shipped yet.
//
// One walk, depth-first; symlinks are not followed. PDFs that fail to
// parse are skipped with a logged warning rather than aborting the
// whole run.

export interface DocReadResult {
  path: string;
  text: string;
  bytes: number;
  pages?: number;
  format: 'pdf' | 'text' | 'markdown';
}

const SUPPORTED_TEXT_EXT = new Set(['.txt', '.md', '.markdown']);
const SUPPORTED_PDF_EXT = new Set(['.pdf']);

export async function readBusinessDocs(
  rootDir: string
): Promise<DocReadResult[]> {
  const out: DocReadResult[] = [];
  for await (const file of walk(rootDir)) {
    const ext = extname(file).toLowerCase();
    try {
      if (SUPPORTED_TEXT_EXT.has(ext)) {
        const text = await readFile(file, 'utf-8');
        out.push({
          path: file,
          text,
          bytes: text.length,
          format: ext === '.txt' ? 'text' : 'markdown',
        });
      } else if (SUPPORTED_PDF_EXT.has(ext)) {
        const buf = await readFile(file);
        const norm = await normalizePdfWithOcr(new Uint8Array(buf));
        out.push({
          path: file,
          text: norm.text,
          bytes: buf.length,
          pages: norm.pageCount,
          format: 'pdf',
        });
      }
      // Silently skip unsupported formats — users see the per-file
      // status in the CLI output.
    } catch (err) {
      console.warn(
        `[read-docs] skipped ${file} — ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      yield* walk(full);
    } else if (d.isFile()) {
      const s = await stat(full);
      if (s.size > 0) yield full;
    }
  }
}
