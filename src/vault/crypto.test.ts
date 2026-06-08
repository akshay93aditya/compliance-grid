import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VaultError,
  _resetKeyForTests,
  decryptField,
  encryptField,
} from './crypto';

const TEST_KEY =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('vault crypto', () => {
  beforeEach(() => {
    process.env.COMPLIANCE_GRID_VAULT_KEY = TEST_KEY;
    _resetKeyForTests();
  });
  afterEach(() => {
    delete process.env.COMPLIANCE_GRID_VAULT_KEY;
    _resetKeyForTests();
  });

  it('throws when no key is set', () => {
    delete process.env.COMPLIANCE_GRID_VAULT_KEY;
    _resetKeyForTests();
    expect(() => encryptField('x', 'org_1', 'pan')).toThrow(VaultError);
  });

  it('round-trips a plaintext through encrypt/decrypt', () => {
    const ct = encryptField('AAAAA1234A', 'org_1', 'pan');
    expect(ct).not.toContain('AAAAA1234A');
    const pt = decryptField(ct, 'org_1', 'pan');
    expect(pt).toBe('AAAAA1234A');
  });

  it('produces different ciphertext for the same input (IV is random)', () => {
    const a = encryptField('SAMEINPUT', 'org_1', 'pan');
    const b = encryptField('SAMEINPUT', 'org_1', 'pan');
    expect(a).not.toBe(b);
    expect(decryptField(a, 'org_1', 'pan')).toBe('SAMEINPUT');
    expect(decryptField(b, 'org_1', 'pan')).toBe('SAMEINPUT');
  });

  it('refuses to decrypt with mismatched tenantId (AAD bound)', () => {
    const ct = encryptField('PII', 'org_1', 'pan');
    expect(() => decryptField(ct, 'org_2', 'pan')).toThrow(VaultError);
  });

  it('refuses to decrypt with mismatched field name (AAD bound)', () => {
    const ct = encryptField('PII', 'org_1', 'pan');
    expect(() => decryptField(ct, 'org_1', 'gstin')).toThrow(VaultError);
  });

  it('refuses to decrypt corrupted ciphertext', () => {
    const ct = encryptField('PII', 'org_1', 'pan');
    // Flip a byte in the auth-tag region (last 16 bytes).
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const corrupted = buf.toString('base64');
    expect(() => decryptField(corrupted, 'org_1', 'pan')).toThrow(VaultError);
  });

  it('refuses empty / too-short ciphertext', () => {
    expect(() => decryptField('', 'org_1', 'pan')).toThrow(VaultError);
    expect(() => decryptField('AAAA', 'org_1', 'pan')).toThrow(VaultError);
  });

  it('accepts a passphrase KEK (non-hex) as well as a raw hex key', () => {
    process.env.COMPLIANCE_GRID_VAULT_KEY = 'a-rotatable-passphrase-with-enough-entropy';
    _resetKeyForTests();
    const ct = encryptField('PII', 'org_1', 'pan');
    expect(decryptField(ct, 'org_1', 'pan')).toBe('PII');
  });
});
