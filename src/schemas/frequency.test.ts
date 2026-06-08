import { describe, expect, it } from 'vitest';
import { Frequency } from './frequency';

describe('Frequency', () => {
  it('accepts all defined frequencies', () => {
    for (const f of [
      'one-time',
      'monthly',
      'quarterly',
      'half-yearly',
      'annual',
      'event-driven',
    ]) {
      expect(Frequency.parse(f)).toBe(f);
    }
  });

  it('rejects unknown frequencies', () => {
    expect(() => Frequency.parse('weekly')).toThrow();
    expect(() => Frequency.parse('fortnightly')).toThrow();
  });
});
