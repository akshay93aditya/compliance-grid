import { describe, expect, it } from 'vitest';
import { version } from './version';

describe('version', () => {
  it('returns "1" for a brand new obligation (undefined input)', () => {
    expect(version(undefined)).toBe('1');
  });

  it('increments monotonically', () => {
    expect(version('1')).toBe('2');
    expect(version('2')).toBe('3');
    expect(version('99')).toBe('100');
  });

  it('rejects non-integer-string input', () => {
    expect(() => version('1.0')).toThrow();
    expect(() => version('v1')).toThrow();
    expect(() => version('abc')).toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => version('')).toThrow();
  });

  it('is pure: same input gives same output', () => {
    expect(version('5')).toBe(version('5'));
  });
});
