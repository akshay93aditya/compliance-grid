import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import { withTransaction } from './transaction';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('withTransaction (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('commits when the callback resolves', async () => {
    const id = `test-tx-commit-${Date.now()}`;
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO instruments (id, type, title, jurisdiction, citation)
           VALUES ($1, 'Act', 'TX commit test', 'IN', 'test')`,
          [id]
        );
      });
      const { rows } = await getPool().query(
        'SELECT id FROM instruments WHERE id = $1',
        [id]
      );
      expect(rows).toHaveLength(1);
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [id]);
    }
  });

  it('rolls back when the callback throws', async () => {
    const id = `test-tx-rollback-${Date.now()}`;
    await expect(
      withTransaction(async (client) => {
        await client.query(
          `INSERT INTO instruments (id, type, title, jurisdiction, citation)
           VALUES ($1, 'Act', 'TX rollback test', 'IN', 'test')`,
          [id]
        );
        throw new Error('intentional');
      })
    ).rejects.toThrow('intentional');

    const { rows } = await getPool().query(
      'SELECT id FROM instruments WHERE id = $1',
      [id]
    );
    expect(rows).toHaveLength(0);
  });
});
