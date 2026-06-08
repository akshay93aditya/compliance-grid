import Tesseract from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
}

// Optical character recognition for image inputs (PNG, JPEG). Per D29 we
// use tesseract.js with English language data. Tesseract auto-downloads
// the lang data on first run (~2MB cached afterwards).
//
// Worker reuse (audit finding): the previous implementation called
// `createWorker('eng')` + `terminate()` on every image. For a scanned
// PDF with 50 pages that was 50 worker spawns — each ~2-4s init,
// turning a minute of OCR into 5+ minutes plus temp-file churn.
//
// The pool below holds a single English worker as a process-singleton.
// All `recognize()` calls share it. `closeOcrWorker()` is exposed for
// scripts/tests that want a clean exit; long-running processes can let
// it fall through to process exit. Tesseract's worker is serial (one
// recognize at a time), so concurrent `ocrImage` callers queue against
// the same worker — that's the correct behaviour: a single recognize
// already uses most of a CPU core.
let workerPromise: Promise<Tesseract.Worker> | null = null;
let pendingWork: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng');
  }
  return workerPromise;
}

export async function ocrImage(
  image: Uint8Array | Buffer | string
): Promise<OcrResult> {
  // tesseract.js' ImageLike type expects Buffer (Node), not generic Uint8Array.
  // Wrap Uint8Array in Buffer (zero-copy view) so the type matches.
  const buf: Buffer | string =
    typeof image === 'string'
      ? image
      : Buffer.isBuffer(image)
        ? image
        : Buffer.from(image.buffer, image.byteOffset, image.byteLength);

  // Serialize against any in-flight recognize on the same worker so
  // concurrent calls don't trample each other's state.
  const run = (async (): Promise<OcrResult> => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buf);
    return {
      text: (data.text ?? '').trim(),
      confidence: data.confidence ?? 0,
    };
  })();

  pendingWork = run.catch(() => undefined);
  return run;
}

// Closes the singleton worker. Idempotent. Tests use this to release
// resources cleanly; long-running processes can call it at SIGTERM. If
// `ocrImage` is invoked again afterwards a fresh worker is spawned.
export async function closeOcrWorker(): Promise<void> {
  // Wait for any in-flight work to finish so we don't terminate
  // mid-recognize and lose its result.
  await pendingWork.catch(() => undefined);
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // best-effort
  } finally {
    workerPromise = null;
  }
}
