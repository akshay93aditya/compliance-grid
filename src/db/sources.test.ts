import { afterAll, describe, expect, it } from 'vitest';
import type { AcquireResult } from '../acquire/acquire';
import { closePool, getPool } from './pool';
import {
  applyContentHashUpdate,
  computeSourceId,
  loadPatrolSources,
  markSourceProcessed,
  persistSource,
} from './sources';

const hasDb = !!process.env.DATABASE_URL;

function makeAcquired(url: string, hash: string): AcquireResult {
  return {
    kind: 'html',
    url,
    bytes: new Uint8Array(),
    contentHash: hash,
    html: { title: 'X', text: 'body', sections: [] },
  };
}

describe('computeSourceId', () => {
  it('is deterministic and starts with src_', () => {
    const a = computeSourceId('https://example.com/page');
    const b = computeSourceId('https://example.com/page');
    expect(a).toBe(b);
    expect(a).toMatch(/^src_[a-f0-9]{24}$/);
  });

  it('produces distinct ids for distinct URLs', () => {
    expect(computeSourceId('https://example.com/a')).not.toBe(
      computeSourceId('https://example.com/b')
    );
  });
});

describe.skipIf(!hasDb)('persistSource (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('inserts a new source row and returns action: "inserted"', async () => {
    const url = `https://test.example/source-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      const result = await persistSource(getPool(), {
        acquired: makeAcquired(url, 'sha256:abcdef'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      expect(result.id).toBe(id);
      expect(result.action).toBe('inserted');

      const { rows } = await getPool().query(
        'SELECT id, url, jurisdiction, content_hash FROM sources WHERE id = $1',
        [id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.url).toBe(url);
      expect(rows[0]!.jurisdiction).toBe('IN-KA');
      expect(rows[0]!.content_hash).toBe('sha256:abcdef');
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('updates content_hash on re-persist (same URL) and returns action: "updated"', async () => {
    const url = `https://test.example/re-source-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      const first = await persistSource(getPool(), {
        acquired: makeAcquired(url, 'hash-1'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      expect(first.action).toBe('inserted');

      const second = await persistSource(getPool(), {
        acquired: makeAcquired(url, 'hash-2'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      expect(second.action).toBe('updated');
      expect(second.id).toBe(first.id);

      const { rows } = await getPool().query(
        'SELECT content_hash FROM sources WHERE id = $1',
        [id]
      );
      expect(rows[0]!.content_hash).toBe('hash-2');
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('rejects an unknown trust tier via the Zod re-parse', async () => {
    await expect(
      persistSource(getPool(), {
        acquired: makeAcquired('https://test.example/bad', 'h'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trustTier: 'rumor' as any,
        fetchRecipe: { kind: 'static-url' },
      })
    ).rejects.toThrow();
  });

  it('rejects a bad jurisdiction format via the Zod re-parse', async () => {
    await expect(
      persistSource(getPool(), {
        acquired: makeAcquired('https://test.example/bad-j', 'h'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jurisdiction: 'us-ca' as any,
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      })
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)('processed_at lifecycle (D47 patrol support)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('persistSource leaves processed_at NULL on initial insert; markSourceProcessed sets it', async () => {
    const url = `https://test.example/processed-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      await persistSource(getPool(), {
        acquired: makeAcquired(url, 'h-initial'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      const before = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      expect(before.rows[0]!.processed_at).toBeNull();

      await markSourceProcessed(getPool(), id);
      const after = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      expect(after.rows[0]!.processed_at).toBeInstanceOf(Date);
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('persistSource preserves processed_at when re-persisting the same URL', async () => {
    const url = `https://test.example/preserve-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      await persistSource(getPool(), {
        acquired: makeAcquired(url, 'h-1'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      await markSourceProcessed(getPool(), id);
      const marked = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      const firstProcessedAt = marked.rows[0]!.processed_at as Date;
      expect(firstProcessedAt).toBeInstanceOf(Date);

      // Re-persist with a new hash; processed_at should not be reset by
      // persistSource itself (clearing is the patrol's job via
      // applyContentHashUpdate).
      await persistSource(getPool(), {
        acquired: makeAcquired(url, 'h-2'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      const after = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      expect((after.rows[0]!.processed_at as Date).getTime()).toBe(
        firstProcessedAt.getTime()
      );
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('applyContentHashUpdate returns changed=false and preserves processed_at when content matches', async () => {
    const url = `https://test.example/diff-noop-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      await persistSource(getPool(), {
        acquired: makeAcquired(url, 'h-same'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      await markSourceProcessed(getPool(), id);
      const before = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      const processedBefore = before.rows[0]!.processed_at as Date;

      const diff = await applyContentHashUpdate(getPool(), id, 'h-same');
      expect(diff).toBeDefined();
      expect(diff!.changed).toBe(false);
      expect(diff!.oldHash).toBe('h-same');
      expect(diff!.newHash).toBe('h-same');

      const after = await getPool().query(
        'SELECT processed_at FROM sources WHERE id = $1',
        [id]
      );
      expect((after.rows[0]!.processed_at as Date).getTime()).toBe(
        processedBefore.getTime()
      );
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('applyContentHashUpdate returns changed=true, clears processed_at, and updates content_hash', async () => {
    const url = `https://test.example/diff-change-${Date.now()}`;
    const id = computeSourceId(url);
    try {
      await persistSource(getPool(), {
        acquired: makeAcquired(url, 'h-old'),
        jurisdiction: 'IN-KA',
        domain: 'labour',
        trustTier: 'govt-portal',
        fetchRecipe: { kind: 'static-url' },
      });
      await markSourceProcessed(getPool(), id);

      const diff = await applyContentHashUpdate(getPool(), id, 'h-new');
      expect(diff).toBeDefined();
      expect(diff!.changed).toBe(true);
      expect(diff!.oldHash).toBe('h-old');
      expect(diff!.newHash).toBe('h-new');

      const after = await getPool().query(
        'SELECT processed_at, content_hash FROM sources WHERE id = $1',
        [id]
      );
      expect(after.rows[0]!.processed_at).toBeNull();
      expect(after.rows[0]!.content_hash).toBe('h-new');
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
    }
  });

  it('applyContentHashUpdate returns undefined for an unknown source id', async () => {
    const diff = await applyContentHashUpdate(
      getPool(),
      'src_does_not_exist',
      'h-whatever'
    );
    expect(diff).toBeUndefined();
  });

  it('loadPatrolSources returns rows oldest-last_seen first with optional filters', async () => {
    const baseUrl = `https://test.example/patrol-${Date.now()}`;
    const ids: string[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const url = `${baseUrl}-${i}`;
        ids.push(computeSourceId(url));
        await persistSource(getPool(), {
          acquired: makeAcquired(url, `h-${i}`),
          jurisdiction: 'IN-KA',
          domain: 'patrol-test',
          trustTier: 'govt-portal',
          fetchRecipe: { kind: 'static-url' },
        });
      }
      const rows = await loadPatrolSources(getPool(), {
        domain: 'patrol-test',
      });
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const justOurs = rows.filter((r) => ids.includes(r.id));
      expect(justOurs).toHaveLength(3);

      // limit clamps the result.
      const limited = await loadPatrolSources(getPool(), {
        domain: 'patrol-test',
        limit: 2,
      });
      expect(limited).toHaveLength(2);
    } finally {
      for (const id of ids) {
        await getPool().query('DELETE FROM sources WHERE id = $1', [id]);
      }
    }
  });
});
