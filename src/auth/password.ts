import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Scrypt parameters. N=2^14 follows OWASP 2023 guidance for interactive
// logins on a v1 monolith. Raise N before adding a memory-bound load test
// (a future Gatekeeper pass).
const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const FORMAT_VERSION = 'scrypt';

// Stored format:
//   scrypt$<N>$<r>$<p>$<salt-hex>$<key-hex>
//
// We persist the cost parameters alongside the hash so a future tuning
// can raise N for new logins without invalidating old hashes — the
// verifier reads them out of the stored string.

export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword: password must be a non-empty string');
  }
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    FORMAT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    key.toString('hex'),
  ].join('$');
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  if (typeof stored !== 'string' || stored.length === 0) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT_VERSION) return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const N = Number.parseInt(nStr!, 10);
  const r = Number.parseInt(rStr!, 10);
  const p = Number.parseInt(pStr!, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const salt = Buffer.from(saltHex!, 'hex');
  const expected = Buffer.from(keyHex!, 'hex');
  const actual = scryptSync(plain, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  // Constant-time comparison so timing-attack patterns don't leak hash
  // length / content.
  return timingSafeEqual(actual, expected);
}
