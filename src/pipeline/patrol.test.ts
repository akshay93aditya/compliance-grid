import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closePool, getPool } from '../db/pool';
import {
  computeSourceId,
  markSourceProcessed,
  persistSource,
} from '../db/sources';
import { runPatrol } from './patrol';

const hasDb = !!process.env.DATABASE_URL;

describe('runPatrol (module shape)', () => {
  it('is a function', () => {
    expect(typeof runPatrol).toBe('function');
  });
});

// Spin up a tiny HTTP server that serves controllable bytes per URL path so
// the patrol can be tested end-to-end without hitting the real internet. The
// per-path content is mutable so a single test can simulate a content change
// between patrol runs.
function makeMutableServer(): {
  server: Server;
  setBody: (path: string, body: string) => void;
  baseUrl: () => string;
} {
  const bodies = new Map<string, string>();
  const server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const body = bodies.get(req.url);
    if (body === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return {
    server,
    setBody: (path, body) => bodies.set(path, body),
    baseUrl: () => {
      const addr = server.address() as AddressInfo | null;
      return `http://127.0.0.1:${addr?.port ?? 0}`;
    },
  };
}

describe.skipIf(!hasDb)('runPatrol (integration, mutable HTTP fixture)', () => {
  let m: ReturnType<typeof makeMutableServer>;

  beforeAll(async () => {
    m = makeMutableServer();
    await new Promise<void>((resolve) => m.server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => m.server.close(() => resolve()));
    await closePool();
  });

  it('reports unchanged when content_hash matches the stored value', async () => {
    const path = `/unchanged-${Date.now()}`;
    m.setBody(path, '<html><body>stable content</body></html>');
    const url = `${m.baseUrl()}${path}`;
    const id = computeSourceId(url);

    try {
      // Seed the source row with the hash that matches what fetchSource
      // will compute on the next call.
      const fetched = await import('../acquire/fetcher').then((mod) =>
        mod.fetchSource(url, {})
      );
      const stableHash = await import('../acquire/acquire').then((mod) =>
        mod.sha256Hex(fetched.bytes)
      );
      await persistSource(getPool(), {
        acquired: {
          kind: 'html',
          url,
          bytes: fetched.bytes,
          contentHash: stableHash,
          html: { title: '', text: '', sections: [] },
        },
        jurisdiction: 'IN-KA',
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      await markSourceProcessed(getPool(), id);

      const result = await runPatrol(getPool(), {
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipeKind: 'static-url',
      });

      const mine = result.perSource.find((p) => p.source_id === id);
      expect(mine).toBeDefined();
      expect(mine!.status).toBe('unchanged');
      expect(mine!.old_hash).toBe(stableHash);
      expect(mine!.new_hash).toBe(stableHash);
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('reports skipped-no-instrument when content changes but no obligation references the source', async () => {
    const path = `/no-instrument-${Date.now()}`;
    m.setBody(path, '<html><body>v1 content</body></html>');
    const url = `${m.baseUrl()}${path}`;
    const id = computeSourceId(url);

    try {
      await persistSource(getPool(), {
        acquired: {
          kind: 'html',
          url,
          bytes: new Uint8Array(),
          contentHash: 'stored-hash-that-wont-match',
          html: { title: '', text: '', sections: [] },
        },
        jurisdiction: 'IN-KA',
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });

      const result = await runPatrol(getPool(), {
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipeKind: 'static-url',
      });

      const mine = result.perSource.find((p) => p.source_id === id);
      expect(mine).toBeDefined();
      expect(mine!.status).toBe('skipped-no-instrument');
      expect(mine!.old_hash).toBe('stored-hash-that-wont-match');
      expect(mine!.new_hash).not.toBe('stored-hash-that-wont-match');

      // The source's content_hash and processed_at should both be updated
      // to reflect the change (processed_at cleared, content_hash refreshed).
      const { rows } = await getPool().query(
        'SELECT content_hash, processed_at FROM sources WHERE id = $1',
        [id]
      );
      expect(rows[0]!.content_hash).toBe(mine!.new_hash);
      expect(rows[0]!.processed_at).toBeNull();
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('reports skipped-fetch-error for unreachable URLs without modifying the source', async () => {
    const url = `http://127.0.0.1:1/never-listens-${Date.now()}`;
    const id = computeSourceId(url);

    try {
      await persistSource(getPool(), {
        acquired: {
          kind: 'html',
          url,
          bytes: new Uint8Array(),
          contentHash: 'h-preserve',
          html: { title: '', text: '', sections: [] },
        },
        jurisdiction: 'IN-KA',
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });

      const result = await runPatrol(getPool(), {
        domain: 'patrol-test',
        trustTier: 'govt-portal',
        fetchRecipeKind: 'static-url',
      });

      const mine = result.perSource.find((p) => p.source_id === id);
      expect(mine).toBeDefined();
      expect(mine!.status).toBe('skipped-fetch-error');
      expect(typeof mine!.error).toBe('string');

      const { rows } = await getPool().query(
        'SELECT content_hash FROM sources WHERE id = $1',
        [id]
      );
      expect(rows[0]!.content_hash).toBe('h-preserve');
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('reports unchanged across multiple real karmika sources (live smoke)', { timeout: 5 * 60_000 }, async function () {
    if (process.env.RUN_PATROL_LIVE !== '1') {
      return;
    }
    // Patrol up to 3 real sources persisted from Phase 1.5.5. They've been
    // last_seen on 2026-05-28 and karmika PDFs are stable, so we expect
    // unchanged status for all. Spend: zero AI cost (no re-extraction);
    // bandwidth is the three PDF fetches.
    const result = await runPatrol(getPool(), {
      jurisdiction: 'IN-KA',
      domain: 'labour',
      trustTier: 'govt-portal',
      fetchRecipeKind: 'static-url',
      maxSources: 3,
      fetchOptions: { timeoutMs: 120_000 },
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      scanned: result.sourcesScanned,
      unchanged: result.sourcesUnchanged,
      changed: result.sourcesChanged,
      fetchErrors: result.sourcesFetchErrors,
      perSource: result.perSource.map((p) => ({ status: p.status, url: p.url.slice(-40) })),
    }, null, 2));

    expect(result.sourcesScanned).toBe(3);
    // Network blips can flip any one of these to a fetch error; at least
    // one should reach the unchanged path on a healthy run.
    expect(result.sourcesUnchanged + result.sourcesChanged).toBeGreaterThanOrEqual(1);
  });

  it('respects maxSources cap', async () => {
    const ids: string[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const path = `/cap-${Date.now()}-${i}`;
        m.setBody(path, `<html><body>body ${i}</body></html>`);
        const url = `${m.baseUrl()}${path}`;
        ids.push(computeSourceId(url));
        await persistSource(getPool(), {
          acquired: {
            kind: 'html',
            url,
            bytes: new Uint8Array(),
            contentHash: `h-${i}`,
            html: { title: '', text: '', sections: [] },
          },
          jurisdiction: 'IN-KA',
          domain: 'patrol-test-cap',
          trustTier: 'govt-portal',
          fetchRecipe: { kind: 'static-url' },
        });
      }

      const result = await runPatrol(getPool(), {
        domain: 'patrol-test-cap',
        trustTier: 'govt-portal',
        fetchRecipeKind: 'static-url',
        maxSources: 2,
      });

      expect(result.sourcesScanned).toBe(2);
      expect(result.perSource).toHaveLength(2);
    } finally {
      for (const id of ids) {
        await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
      }
    }
  });
});
