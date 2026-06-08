import { describe, expect, it } from 'vitest';
import { ApplicabilityCondition } from './applicability-condition';

describe('ApplicabilityCondition', () => {
  it('accepts an equality predicate', () => {
    const parsed = ApplicabilityCondition.parse({
      field: 'entity_type',
      op: 'eq',
      value: 'pvt-ltd',
    });
    expect(parsed.op).toBe('eq');
  });

  it('accepts numeric comparison predicates', () => {
    for (const op of ['gte', 'lte', 'gt', 'lt'] as const) {
      const parsed = ApplicabilityCondition.parse({
        field: 'headcount',
        op,
        value: 20,
      });
      expect(parsed.op).toBe(op);
    }
  });

  it('accepts an "in" predicate with an array value', () => {
    const parsed = ApplicabilityCondition.parse({
      field: 'jurisdictions',
      op: 'in',
      value: ['IN-KA', 'IN-AP'],
    });
    expect(parsed.op).toBe('in');
  });

  it('rejects an unknown op', () => {
    expect(() =>
      ApplicabilityCondition.parse({
        field: 'x',
        op: 'matches',
        value: 'y',
      })
    ).toThrow();
  });

  it('rejects an empty field', () => {
    expect(() =>
      ApplicabilityCondition.parse({ field: '', op: 'eq', value: 'x' })
    ).toThrow();
  });
});
