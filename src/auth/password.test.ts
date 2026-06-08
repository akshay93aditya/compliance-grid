import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('hashPassword + verifyPassword', () => {
  it('rejects empty inputs', () => {
    expect(() => hashPassword('')).toThrow();
    expect(verifyPassword('', 'anything')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });

  it('produces a different hash for the same password each call', () => {
    const a = hashPassword('correct horse battery staple');
    const b = hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    // Both must still verify.
    expect(verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(verifyPassword('correct horse battery staple', b)).toBe(true);
  });

  it('verifies the correct password', () => {
    const stored = hashPassword('s3cret-pass!');
    expect(verifyPassword('s3cret-pass!', stored)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const stored = hashPassword('s3cret-pass!');
    expect(verifyPassword('s3cret-pass', stored)).toBe(false);
    expect(verifyPassword('S3cret-pass!', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPassword('x', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$x$y$z')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$14$8$1$abc$def')).toBe(false);
  });

  it('stored format encodes scrypt parameters', () => {
    const stored = hashPassword('x');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number.parseInt(parts[1]!, 10)).toBeGreaterThan(1);
  });
});
