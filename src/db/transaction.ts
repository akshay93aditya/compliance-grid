import type { PoolClient } from 'pg';
import { getPool } from './pool';

// Wrap a callback in a BEGIN/COMMIT/ROLLBACK transaction. The callback gets
// a PoolClient that must be used for all queries inside the transaction.
// Errors thrown from the callback roll the transaction back and rethrow.
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
