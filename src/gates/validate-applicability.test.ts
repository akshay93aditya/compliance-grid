import { describe, expect, it } from 'vitest';
import { validateApplicabilityConditions } from './validate-applicability';

describe('validateApplicabilityConditions', () => {
  it('accepts an empty conditions list', () => {
    expect(validateApplicabilityConditions([])).toEqual({ ok: true, issues: [] });
  });

  it('accepts a valid entity_type eq predicate', () => {
    const result = validateApplicabilityConditions([
      { field: 'entity_type', op: 'eq', value: 'pvt-ltd' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects entity_type eq with a value outside the EntityType enum (the "factory-occupier" case from Phase 1.4.3)', () => {
    const result = validateApplicabilityConditions([
      { field: 'entity_type', op: 'eq', value: 'factory-occupier' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.field).toBe('entity_type');
    expect(result.issues[0]!.reason).toContain('EntityType');
  });

  it('accepts entity_type "in" with a valid array', () => {
    const result = validateApplicabilityConditions([
      { field: 'entity_type', op: 'in', value: ['pvt-ltd', 'public-ltd', 'llp'] },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects entity_type "in" with one invalid item', () => {
    const result = validateApplicabilityConditions([
      { field: 'entity_type', op: 'in', value: ['pvt-ltd', 'bogus-type'] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('accepts jurisdictions "in" with valid Jurisdiction shapes', () => {
    const result = validateApplicabilityConditions([
      { field: 'jurisdictions', op: 'in', value: ['IN-KA', 'IN-AP'] },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects jurisdictions with a bad shape', () => {
    const result = validateApplicabilityConditions([
      { field: 'jurisdictions', op: 'in', value: ['us-ca'] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.reason).toContain('Jurisdiction');
  });

  it('accepts headcount with a numeric op', () => {
    const result = validateApplicabilityConditions([
      { field: 'headcount', op: 'gte', value: 20 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects headcount with a string value', () => {
    const result = validateApplicabilityConditions([
      { field: 'headcount', op: 'gte', value: 'twenty' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects a numeric op on a non-numeric field', () => {
    const result = validateApplicabilityConditions([
      { field: 'sector', op: 'gte', value: 'manufacturing' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.reason).toContain('numeric');
  });

  it('rejects an unknown field', () => {
    const result = validateApplicabilityConditions([
      { field: 'made_up_field', op: 'eq', value: 'x' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.reason).toContain('unknown field');
  });

  it('accepts incorporation_date with an ISO date and gte op', () => {
    const result = validateApplicabilityConditions([
      { field: 'incorporation_date', op: 'gte', value: '2020-01-01' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects incorporation_date with a malformed string', () => {
    const result = validateApplicabilityConditions([
      { field: 'incorporation_date', op: 'gte', value: '01/01/2020' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('accepts sector as a free string', () => {
    const result = validateApplicabilityConditions([
      { field: 'sector', op: 'eq', value: 'manufacturing' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('reports issues per offending condition (index preserved)', () => {
    const result = validateApplicabilityConditions([
      { field: 'sector', op: 'eq', value: 'manufacturing' }, // ok
      { field: 'entity_type', op: 'eq', value: 'factory-occupier' }, // bad
      { field: 'headcount', op: 'gte', value: 'many' }, // bad
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.index)).toEqual([1, 2]);
  });
});
