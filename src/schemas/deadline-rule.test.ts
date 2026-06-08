import { describe, expect, it } from 'vitest';
import { DeadlineRule } from './deadline-rule';

describe('DeadlineRule', () => {
  it('accepts a fixed-date rule', () => {
    const parsed = DeadlineRule.parse({ kind: 'fixed-date', month: 4, day: 30 });
    expect(parsed.kind).toBe('fixed-date');
  });

  it('accepts a period-offset rule', () => {
    const parsed = DeadlineRule.parse({ kind: 'period-offset', days: 30 });
    expect(parsed.kind).toBe('period-offset');
  });

  it('accepts an event-offset rule with a named event', () => {
    const parsed = DeadlineRule.parse({
      kind: 'event-offset',
      days: 30,
      event: 'incorporation',
    });
    expect(parsed.kind).toBe('event-offset');
  });

  it('rejects fixed-date with month out of range', () => {
    expect(() =>
      DeadlineRule.parse({ kind: 'fixed-date', month: 13, day: 1 })
    ).toThrow();
  });

  it('rejects fixed-date with day out of range', () => {
    expect(() =>
      DeadlineRule.parse({ kind: 'fixed-date', month: 4, day: 32 })
    ).toThrow();
  });

  it('rejects negative day offsets', () => {
    expect(() =>
      DeadlineRule.parse({ kind: 'period-offset', days: -1 })
    ).toThrow();
  });

  it('rejects an event-offset without an event name', () => {
    expect(() =>
      DeadlineRule.parse({ kind: 'event-offset', days: 10, event: '' })
    ).toThrow();
  });

  it('rejects an unknown rule kind', () => {
    expect(() =>
      DeadlineRule.parse({ kind: 'someday', days: 30 })
    ).toThrow();
  });
});
