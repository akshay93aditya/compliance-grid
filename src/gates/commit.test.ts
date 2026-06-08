import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool';
import type { ObligationCandidate } from '../schemas/obligation';
import { commit } from './commit';

const hasDb = !!process.env.DATABASE_URL;

function makeCandidate(
  instrument_id: string,
  source_id: string,
  overrides: Partial<ObligationCandidate> = {}
): ObligationCandidate {
  return {
    instrument_ref: { instrument_id, section: 'r.105' },
    type: 'filing',
    summary: 'File the annual return.',
    applicability_conditions: [
      { field: 'sector', op: 'eq', value: 'manufacturing' },
    ],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: ['filed-form-x'],
    penalty: { has_imprisonment: false, fine_inr: { min: 0, max: 50_000 } },
    source_refs: [{ source_id, citation_span: 'p.1 r.105(1)' }],
    confidence: 0.95,
    ...overrides,
  };
}

async function ensureInstrumentAndSource(
  instrumentId: string,
  sourceId: string
): Promise<void> {
  await getPool().query(
    `INSERT INTO instruments (id, type, title, jurisdiction, citation)
     VALUES ($1, 'Act', 'Test', 'IN-KA', 'test')
     ON CONFLICT (id) DO NOTHING`,
    [instrumentId]
  );
  await getPool().query(
    `INSERT INTO sources
       (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
     VALUES ($1, 'IN-KA', 'labour', 'https://test.example/${'$1'}',
             '{"kind":"static-url","config":{}}'::jsonb,
             'unverified', NOW(), 'test-hash')
     ON CONFLICT (id) DO NOTHING`,
    [sourceId]
  );
}

async function cleanupCommitFixtures(
  instrumentId: string,
  sourceId: string
): Promise<void> {
  await getPool().query(
    'DELETE FROM change_events WHERE obligation_canonical_id IN (SELECT canonical_id FROM obligations WHERE instrument_id = $1)',
    [instrumentId]
  );
  await getPool().query('DELETE FROM obligations WHERE instrument_id = $1', [
    instrumentId,
  ]);
  await getPool().query('DELETE FROM instruments WHERE id = $1', [instrumentId]);
  await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

describe.skipIf(!hasDb)('commit (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('inserts a new obligation and returns action: "inserted" with version "1"', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-insert-${ts}`;
    const sourceId = `src-commit-insert-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);

      const result = await commit(getPool(), makeCandidate(instId, sourceId));
      expect(result.action).toBe('inserted');
      expect(result.version).toBe('1');
      expect(result.canonical_id).toBe(`${instId}|r.105|filing`);

      const { rows } = await getPool().query(
        'SELECT canonical_id, version FROM obligations WHERE canonical_id = $1',
        [result.canonical_id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version).toBe('1');
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });

  it('versions an existing obligation on re-commit', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-version-${ts}`;
    const sourceId = `src-commit-version-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);

      const first = await commit(getPool(), makeCandidate(instId, sourceId));
      expect(first.action).toBe('inserted');
      expect(first.version).toBe('1');

      const updated = makeCandidate(instId, sourceId, {
        summary: 'File the annual return. (Amended wording.)',
      });
      const second = await commit(getPool(), updated);
      expect(second.action).toBe('versioned');
      expect(second.version).toBe('2');
      expect(second.canonical_id).toBe(first.canonical_id);

      const { rows } = await getPool().query(
        'SELECT version, summary FROM obligations WHERE canonical_id = $1',
        [second.canonical_id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.version).toBe('2');
      expect(rows[0]!.summary).toContain('Amended');
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });

  it('emits a ChangeEvent on commit with change_type "new" for inserts (D39)', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-ce-new-${ts}`;
    const sourceId = `src-commit-ce-new-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);

      const result = await commit(getPool(), makeCandidate(instId, sourceId));
      expect(result.change_event_id).not.toBeNull();
      expect(result.change_event_id).toMatch(/^ce_/);

      const { rows } = await getPool().query(
        `SELECT change_type, status, source_ref
         FROM change_events WHERE id = $1`,
        [result.change_event_id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.change_type).toBe('new');
      expect(rows[0]!.status).toBe('detected');
      expect(rows[0]!.source_ref).toBe(sourceId);
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });

  it('emits a ChangeEvent with change_type "amended" for versioned commits (D39)', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-ce-amended-${ts}`;
    const sourceId = `src-commit-ce-amended-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);

      await commit(getPool(), makeCandidate(instId, sourceId));
      const second = await commit(getPool(), makeCandidate(instId, sourceId, {
        summary: 'Updated summary.',
      }));
      expect(second.action).toBe('versioned');
      expect(second.change_event_id).not.toBeNull();

      const { rows } = await getPool().query(
        'SELECT change_type FROM change_events WHERE id = $1',
        [second.change_event_id]
      );
      expect(rows[0]!.change_type).toBe('amended');
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });

  it('skips ChangeEvent emission when emitChangeEvent is false', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-no-ce-${ts}`;
    try {
      await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, 'Act', 'Test', 'IN-KA', 'test')`,
        [instId]
      );

      // No source row created; emitChangeEvent: false avoids the FK requirement.
      const result = await commit(
        getPool(),
        makeCandidate(instId, 'unset-source'),
        { emitChangeEvent: false }
      );
      expect(result.change_event_id).toBeNull();
    } finally {
      await getPool().query(
        'DELETE FROM obligations WHERE instrument_id = $1',
        [instId]
      );
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('rejects a candidate that fails Zod validation (empty source_refs)', async () => {
    const ts = Date.now();
    const instId = `test-inst-commit-invalid-${ts}`;
    await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, 'Act', 'Test', 'IN', 'test')`,
      [instId]
    );
    try {
      const bad = makeCandidate(instId, 'any-source', { source_refs: [] });
      await expect(commit(getPool(), bad)).rejects.toThrow();
      const { rows } = await getPool().query(
        'SELECT COUNT(*) AS c FROM obligations WHERE instrument_id = $1',
        [instId]
      );
      expect(Number(rows[0]!.c)).toBe(0);
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('rejects a candidate referencing a missing instrument (FK violation)', async () => {
    const missingInst = `test-missing-inst-${Date.now()}`;
    await expect(
      commit(getPool(), makeCandidate(missingInst, 'any-source'))
    ).rejects.toThrow();
  });

  it('records extractedBy on insert and leaves it untouched on subsequent versioned update (D52)', async () => {
    const ts = Date.now();
    const instId = `test-inst-extracted-by-${ts}`;
    const sourceId = `src-extracted-by-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);

      // First commit with extractedBy='alice' — federation path. Skip
      // change event because the test sources are test.example URLs;
      // the FK on change_events.source_ref still resolves but the
      // intent of D52 is that pulls don't emit events anyway.
      const first = await commit(
        getPool(),
        makeCandidate(instId, sourceId),
        { emitChangeEvent: false, extractedBy: 'alice' }
      );
      expect(first.action).toBe('inserted');

      const after1 = await getPool().query<{ extracted_by: string | null }>(
        `SELECT extracted_by FROM obligations WHERE canonical_id = $1`,
        [first.canonical_id]
      );
      expect(after1.rows[0]!.extracted_by).toBe('alice');

      // Second commit (versioned). Pretend it came from a different
      // extractor 'bob'. extracted_by should NOT change — local first
      // wins per the D52 design note.
      const second = await commit(
        getPool(),
        makeCandidate(instId, sourceId, { summary: 'Updated summary' }),
        { emitChangeEvent: false, extractedBy: 'bob' }
      );
      expect(second.action).toBe('versioned');
      expect(second.version).toBe('2');

      const after2 = await getPool().query<{
        extracted_by: string | null;
        summary: string;
      }>(
        `SELECT extracted_by, summary FROM obligations WHERE canonical_id = $1`,
        [first.canonical_id]
      );
      expect(after2.rows[0]!.extracted_by).toBe('alice');
      expect(after2.rows[0]!.summary).toBe('Updated summary');
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });

  it('leaves extracted_by NULL when extractedBy option is not provided (the locally-extracted path)', async () => {
    const ts = Date.now();
    const instId = `test-inst-local-extract-${ts}`;
    const sourceId = `src-local-extract-${ts}`;
    try {
      await ensureInstrumentAndSource(instId, sourceId);
      const result = await commit(
        getPool(),
        makeCandidate(instId, sourceId),
        { emitChangeEvent: false }
      );
      const { rows } = await getPool().query<{
        extracted_by: string | null;
      }>(
        `SELECT extracted_by FROM obligations WHERE canonical_id = $1`,
        [result.canonical_id]
      );
      expect(rows[0]!.extracted_by).toBeNull();
    } finally {
      await cleanupCommitFixtures(instId, sourceId);
    }
  });
});
