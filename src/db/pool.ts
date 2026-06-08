import { Pool } from 'pg';

// Lazy singleton connection pool. Reads DATABASE_URL on first call so the
// module can be imported in environments where the DB is not configured
// (typecheck, unit tests that don't touch the DB).
let _pool: Pool | undefined;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. See .env.example for the expected format.'
    );
  }
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
