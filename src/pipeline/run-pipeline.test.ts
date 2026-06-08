import { afterAll, describe, expect, it, vi } from 'vitest';
import { closePool, getPool } from '../db/pool';
import type { AgentRunnerClient } from '../agents/contract';
import { runPipeline } from './run-pipeline';

const hasKey = !!process.env.ANTHROPIC_API_KEY;
const hasDb = !!process.env.DATABASE_URL;
const runLive = process.env.RUN_PIPELINE_LIVE === '1';

const SMALL_HTML = `<!DOCTYPE html><html><head><title>X</title></head><body>
  <main>
    <h2>Section A</h2>
    <p>This is text.</p>
  </main>
</body></html>`;

function mockExtractionClient(): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_obligations',
            input: { obligations: [] },
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

describe.skipIf(!hasDb)('runPipeline (unit, mocked extraction)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('runs end-to-end against a local fixture and persists the Source', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SMALL_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}/`;

    const instId = `IN-KA/pipeline-mock-${Date.now()}`;
    try {
      const result = await runPipeline(getPool(), {
        url,
        instrument: {
          id: instId,
          title: 'Pipeline Mock Rules',
          type: 'Rule',
          jurisdiction: 'IN-KA',
          citation: 'test',
        },
        trustTier: 'unverified',
        fetchRecipeKind: 'static-url',
        client: mockExtractionClient(),
      });

      expect(result.acquired_kind).toBe('html');
      expect(result.total_segments).toBe(1);
      expect(result.processed_segments).toBe(1);
      expect(result.raw_candidates_count).toBe(0);
      expect(result.committed).toEqual([]);
      expect(result.queued).toEqual([]);
      expect(result.extraction_errors).toEqual([]);

      // The Instrument row should exist.
      const { rows: instRows } = await getPool().query(
        'SELECT id FROM instruments WHERE id = $1',
        [instId]
      );
      expect(instRows).toHaveLength(1);

      // The Source row should exist with the real content_hash.
      const { rows: srcRows } = await getPool().query(
        'SELECT id, content_hash FROM sources WHERE id = $1',
        [result.source_id]
      );
      expect(srcRows).toHaveLength(1);
      expect(srcRows[0]!.content_hash).toMatch(/^[a-f0-9]{64}$/);

      await getPool().query('DELETE FROM sources WHERE id = $1', [result.source_id]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// Live end-to-end pipeline. Heavily gated: requires ANTHROPIC_API_KEY,
// DATABASE_URL, AND RUN_PIPELINE_LIVE=1. Targets the Karmika Spandana
// (Karnataka Labour) PDF for "Occupational Safety, Health and Working
// Conditions (Karnataka) Rules, 2021". Processes the first 25 pages to
// stay within the $2 cap (estimated ~$0.20-0.30 in Sonnet calls).
//
// Does NOT clean up the obligations or source on success. The whole point
// of this run is to leave the first real CKG data behind for inspection.
const LIVE_URL =
  'https://karmikaspandana.karnataka.gov.in/uploads/media_to_upload1769512711.pdf';

const LIVE_INSTRUMENT = {
  id: 'IN-KA/osh-working-conditions-rules-2021',
  title:
    'Occupational Safety, Health and Working Conditions (Karnataka) Rules, 2021',
  type: 'Rule' as const,
  jurisdiction: 'IN-KA' as const,
  citation:
    'LD 245 LET 2021, Karnataka Government Notification dated 23/01/2026, under Central Act No. 37 of 2020',
};

describe.skipIf(!runLive || !hasKey || !hasDb)(
  'runPipeline (live e2e against Karmika Spandana KA labour PDF)',
  () => {
    afterAll(async () => {
      await closePool();
    });

    it(
      'processes the first 25 pages, commits / queues obligations',
      async () => {
        const result = await runPipeline(getPool(), {
          url: LIVE_URL,
          instrument: LIVE_INSTRUMENT,
          trustTier: 'gazette',
          fetchRecipeKind: 'static-url',
          maxSegments: 25,
          fetchOptions: { timeoutMs: 60_000 },
        });

        // eslint-disable-next-line no-console
        console.log('\n=== Pipeline live run summary ===');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
          source_id: result.source_id,
          acquired_kind: result.acquired_kind,
          total_segments: result.total_segments,
          processed_segments: result.processed_segments,
          raw_candidates_count: result.raw_candidates_count,
          committed_count: result.committed.length,
          queued_count: result.queued.length,
          extraction_errors_count: result.extraction_errors.length,
        }, null, 2));
        // eslint-disable-next-line no-console
        console.log('committed:', JSON.stringify(result.committed, null, 2));
        // eslint-disable-next-line no-console
        console.log('queued (first 5):', JSON.stringify(result.queued.slice(0, 5), null, 2));
        // eslint-disable-next-line no-console
        if (result.extraction_errors.length > 0) {
          console.log('extraction errors:', JSON.stringify(result.extraction_errors, null, 2));
        }

        expect(result.acquired_kind).toBe('pdf');
        expect(result.processed_segments).toBeGreaterThan(0);
        expect(result.processed_segments).toBeLessThanOrEqual(25);
        // We don't assert on committed count: some segments may yield 0
        // obligations (title pages, definitions). What matters is that the
        // pipeline ran cleanly.
      },
      // Generous timeout: 25 Sonnet calls + a 12MB PDF download + parse.
      10 * 60_000
    );
  }
);
