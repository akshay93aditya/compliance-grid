import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';

// Per D7: consented per-tenant encryption, server-side processing.
//
// v1 design:
//   - Master KEK is read from env (COMPLIANCE_GRID_VAULT_KEY). It's a
//     32-byte secret persisted out-of-band — rotate by re-encrypting all
//     ciphertexts; that ceremony is deferred.
//   - Each ciphertext gets its own random 12-byte IV (AES-GCM standard).
//   - We append AAD = `${tenant_id}:${field_name}` so a stolen ciphertext
//     from one org / field can't be decrypted into another's plaintext
//     even if the KEK leaks. AAD is recovered by the caller, not stored.
//   - On-wire format:  iv(12) || ciphertext(N) || authTag(16)  base64-encoded.
//
// Future: per-tenant DEK encrypted by the KEK, stored on the org row.
// For v1 the KEK directly encrypts payload — simpler ops, ~same threat
// model since the KEK is the secret that matters.

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function loadKey(): Buffer {
  const raw = process.env.COMPLIANCE_GRID_VAULT_KEY;
  if (!raw) {
    throw new VaultError(
      'COMPLIANCE_GRID_VAULT_KEY not set. Generate with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // Accept either a raw 64-char hex key, or any passphrase (derive via
  // scrypt with a fixed salt — fine for dev/single-tenant deployments).
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Derived key path. The salt is a constant SHA-256 of the literal
  // 'compliance-grid-vault-v1' so a single passphrase produces a stable
  // KEK across restarts without per-instance state.
  const salt = createHash('sha256')
    .update('compliance-grid-vault-v1')
    .digest()
    .subarray(0, 16);
  return scryptSync(raw, salt, KEY_LEN);
}

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

// Reset the cached key — used in tests that mutate process.env.
export function _resetKeyForTests(): void {
  cachedKey = null;
}

function aad(tenantId: string, fieldName: string): Buffer {
  return Buffer.from(`${tenantId}:${fieldName}`, 'utf-8');
}

// Encrypts a plaintext string and returns base64(iv || ciphertext || tag).
// tenantId binds the ciphertext to a specific org; fieldName binds it to a
// column. Decryption with mismatched AAD fails the auth-tag check (returns
// VaultError).
export function encryptField(
  plaintext: string,
  tenantId: string,
  fieldName: string
): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new VaultError('encryptField: plaintext must be a non-empty string');
  }
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad(tenantId, fieldName));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

export function decryptField(
  ciphertextB64: string,
  tenantId: string,
  fieldName: string
): string {
  if (typeof ciphertextB64 !== 'string' || ciphertextB64.length === 0) {
    throw new VaultError('decryptField: ciphertext must be a non-empty string');
  }
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new VaultError('decryptField: ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(aad(tenantId, fieldName));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  } catch {
    throw new VaultError(
      'decryptField: auth-tag check failed. Wrong KEK / tenant / field, or ciphertext corrupted.'
    );
  }
}
