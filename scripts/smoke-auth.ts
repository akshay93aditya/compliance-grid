// End-to-end smoke for the auth + onboarding chain. Creates a test user
// + org + entity, mints a session token, then prints the cookie value so
// you can hit /health with it via curl.
//
// Usage:
//   npx tsx scripts/smoke-auth.ts [email]

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { closePool, getPool } from '../src/db/pool';
import {
  findUserByEmail,
  insertOrg,
  insertSession,
  insertUser,
  upsertEntityProfile,
} from '../src/auth/db';
import { newEntityId, newOrgId, newSessionToken, newUserId } from '../src/auth/ids';
import { hashPassword } from '../src/auth/password';

const email = process.argv[2] ?? `smoke-${Date.now()}@example.com`;
const password = 'smoke-password-123';

async function main(): Promise<number> {
  const pool = getPool();
  try {
    const existing = await findUserByEmail(pool, email);
    let userId: string;
    let orgId: string;
    if (existing) {
      console.log(`[smoke] reusing user ${existing.id}`);
      userId = existing.id;
      // Use the existing org for this user.
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM orgs WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [userId]
      );
      orgId = rows[0]?.id ?? newOrgId();
      if (!rows[0]) {
        await insertOrg(pool, { id: orgId, name: 'Smoke Org', ownerId: userId });
        console.log(`[smoke] created org ${orgId} for existing user`);
      }
    } else {
      userId = newUserId();
      orgId = newOrgId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertUser(client, {
          id: userId,
          email,
          passwordHash: hashPassword(password),
        });
        await insertOrg(client, { id: orgId, name: 'Smoke Org Pvt Ltd', ownerId: userId });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      console.log(`[smoke] created user ${userId}, org ${orgId}`);
    }

    // Save a Karnataka manufacturing MSME entity matching the seed data.
    const entityId = newEntityId();
    await upsertEntityProfile(pool, {
      id: entityId,
      orgId,
      entityType: 'pvt-ltd',
      sector: 'manufacturing',
      jurisdictions: ['IN-KA'],
      headcount: 75,
      annualTurnoverInr: 50_000_000,
    });
    console.log(`[smoke] saved entity profile ${entityId} (IN-KA pvt-ltd, 75 headcount)`);

    // Mint a session.
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await insertSession(pool, { token, userId, expiresAt });
    console.log(`[smoke] session token: ${token}`);
    console.log(`[smoke] cookie:        cg_session=${token}`);
    console.log('');
    console.log('To verify the personalised /health surface:');
    console.log(`  curl -s -b 'cg_session=${token}' http://localhost:3000/health | grep -oE 'manufacturing|IN-KA|Applicable obligations.{0,40}'`);
    return 0;
  } finally {
    await closePool();
  }
}

main().then((c) => process.exit(c)).catch((err) => {
  console.error(err);
  process.exit(1);
});
