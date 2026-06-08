import { describe, expect, it } from 'vitest';
import { Jurisdiction } from './jurisdiction';

describe('Jurisdiction', () => {
  it('accepts national IN', () => {
    expect(Jurisdiction.parse('IN')).toBe('IN');
  });

  it('accepts D12 pilot states IN-KA and IN-AP', () => {
    expect(Jurisdiction.parse('IN-KA')).toBe('IN-KA');
    expect(Jurisdiction.parse('IN-AP')).toBe('IN-AP');
  });

  it('accepts other valid ISO 3166-2 IN state-code shapes (e.g., IN-TG)', () => {
    expect(Jurisdiction.parse('IN-TG')).toBe('IN-TG');
  });

  it('rejects lowercase', () => {
    expect(() => Jurisdiction.parse('in-ka')).toThrow();
  });

  it('rejects non-IN prefixes', () => {
    expect(() => Jurisdiction.parse('US-CA')).toThrow();
  });

  it('rejects single-letter state codes', () => {
    expect(() => Jurisdiction.parse('IN-K')).toThrow();
  });

  it('rejects three-letter state codes', () => {
    expect(() => Jurisdiction.parse('IN-KAR')).toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => Jurisdiction.parse('')).toThrow();
  });
});
