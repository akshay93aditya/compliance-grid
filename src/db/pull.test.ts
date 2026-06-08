import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import {
  upsertPulledInstrument,
  upsertPulledSource,
} from './pull';

const hasDb = !!process.env.DATABASE_URL;

const FIXTURE = {
  instrumentId: 'IN-XX/pull-helper-instrument',
  sourceId: 'src_pull_helper_fixture00001',
};

describe.skipIf(!hasDb)('pull helpers (integration)', () => {
  beforeAll(async () => {
    await getPool().query(`DELETE FROM sources WHERE id = $1`, [
      FIXTURE.sourceId,
    ]);
    await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
      FIXTURE.instrumentId,
    ]);
  });

  afterAll(async () => {
    await getPool().query(`DELETE FROM sources WHERE id = $1`, [
      FIXTURE.sourceId,
    ]);
    await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
      FIXTURE.instrumentId,
    ]);
    await closePool();
  });

  it('upsertPulledInstrument inserts on first call and skips on second', async () => {
    const first = await upsertPulledInstrument(getPool(), {
      id: FIXTURE.instrumentId,
      type: 'Rule',
      title: 'Pull helper test',
      jurisdiction: 'IN-XX',
      citation: 'PH',
    });
    expect(first.inserted).toBe(true);

    const second = await upsertPulledInstrument(getPool(), {
      id: FIXTURE.instrumentId,
      type: 'Rule',
      // Note the different title — second call should NOT overwrite.
      title: 'A NEW title that should not stick',
      jurisdiction: 'IN-XX',
      citation: 'PH',
    });
    expect(second.inserted).toBe(false);

    const { rows } = await getPool().query<{ title: string }>(
      `SELECT title FROM instruments WHERE id = $1`,
      [FIXTURE.instrumentId]
    );
    expect(rows[0]!.title).toBe('Pull helper test');
  });

  it('upsertPulledSource inserts on first call and skips on second; processed_at is set to last_seen', async () => {
    const lastSeen = '2026-06-04T12:00:00.000Z';
    const first = await upsertPulledSource(getPool(), {
      id: FIXTURE.sourceId,
      jurisdiction: 'IN-XX',
      domain: 'pull-test',
      url: 'https://pull-helper.fixture.example/doc.pdf',
      fetch_recipe: { kind: 'static-url' },
      trust_tier: 'govt-portal',
      last_seen: lastSeen,
      content_hash: 'pull-hash',
    });
    expect(first.inserted).toBe(true);

    const { rows } = await getPool().query<{
      processed_at: Date | null;
      last_seen: Date;
    }>(
      `SELECT processed_at, last_seen FROM sources WHERE id = $1`,
      [FIXTURE.sourceId]
    );
    expect(rows[0]!.processed_at).toBeInstanceOf(Date);
    // processed_at should match last_seen so crawlAndPipeline's
    // skipExisting filter treats the federated source as already
    // processed (no need to re-extract).
    expect((rows[0]!.processed_at as Date).getTime()).toBe(
      rows[0]!.last_seen.getTime()
    );

    const second = await upsertPulledSource(getPool(), {
      id: FIXTURE.sourceId,
      jurisdiction: 'IN-XX',
      domain: 'pull-test',
      url: 'https://different.example/now.pdf',
      fetch_recipe: { kind: 'static-url' },
      trust_tier: 'unverified',
      last_seen: '2026-06-05T00:00:00.000Z',
      content_hash: 'different-hash',
    });
    expect(second.inserted).toBe(false);

    const { rows: rows2 } = await getPool().query<{
      url: string;
      content_hash: string;
    }>(
      `SELECT url, content_hash FROM sources WHERE id = $1`,
      [FIXTURE.sourceId]
    );
    expect(rows2[0]!.url).toBe('https://pull-helper.fixture.example/doc.pdf');
    expect(rows2[0]!.content_hash).toBe('pull-hash');
  });
});

describe('pull helpers (module shape)', () => {
  it('exports both upsert functions', () => {
    expect(typeof upsertPulledInstrument).toBe('function');
    expect(typeof upsertPulledSource).toBe('function');
  });
});
