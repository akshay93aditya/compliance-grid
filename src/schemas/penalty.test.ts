import { describe, expect, it } from 'vitest';
import { Penalty } from './penalty';

describe('Penalty', () => {
  it('accepts a fine-only penalty', () => {
    const parsed = Penalty.parse({
      has_imprisonment: false,
      fine_inr: { min: 10_000, max: 50_000 },
    });
    expect(parsed.has_imprisonment).toBe(false);
    expect(parsed.fine_inr?.max).toBe(50_000);
  });

  it('accepts a penalty with both imprisonment and fine', () => {
    const parsed = Penalty.parse({
      has_imprisonment: true,
      imprisonment_months: { min: 6, max: 24 },
      fine_inr: { min: 0, max: 100_000 },
    });
    expect(parsed.has_imprisonment).toBe(true);
    expect(parsed.imprisonment_months?.min).toBe(6);
  });

  it('accepts has_imprisonment with no specified range', () => {
    const parsed = Penalty.parse({ has_imprisonment: true });
    expect(parsed.has_imprisonment).toBe(true);
    expect(parsed.imprisonment_months).toBeUndefined();
  });

  it('rejects max < min on fine_inr', () => {
    expect(() =>
      Penalty.parse({
        has_imprisonment: false,
        fine_inr: { min: 100, max: 50 },
      })
    ).toThrow();
  });

  it('rejects negative amounts', () => {
    expect(() =>
      Penalty.parse({
        has_imprisonment: false,
        fine_inr: { min: -1, max: 50 },
      })
    ).toThrow();
  });
});
