import { describe, expect, it } from 'vitest';
import { Obligation } from './obligation';

describe('Obligation', () => {
  const base = {
    canonical_id: 'IN-KA/labour/factories-form-25/v1',
    instrument_ref: {
      instrument_id: 'IN-KA/factories-rules-1969',
      section: 'r.105',
    },
    type: 'filing',
    summary:
      'File annual return in Form 25 with the Karnataka Factories Inspectorate.',
    applicability_conditions: [
      { field: 'sector', op: 'eq', value: 'manufacturing' },
      { field: 'jurisdictions', op: 'in', value: ['IN-KA'] },
    ],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 1, day: 15 },
    proof_types: ['filed-form-25', 'acknowledgment'],
    penalty: {
      has_imprisonment: false,
      fine_inr: { min: 0, max: 100_000 },
    },
    source_refs: [
      { source_id: 'src-1', citation_span: 'p.12 r.105(1)' },
    ],
    version: '1',
    confidence: 0.95,
  };

  it('accepts a valid Obligation', () => {
    const parsed = Obligation.parse(base);
    expect(parsed.type).toBe('filing');
  });

  it('rejects an Obligation with empty source_refs (anti-hallucination invariant)', () => {
    expect(() => Obligation.parse({ ...base, source_refs: [] })).toThrow();
  });

  it('rejects an unknown obligation type', () => {
    expect(() => Obligation.parse({ ...base, type: 'enforcement' })).toThrow();
  });

  it('rejects confidence above 1', () => {
    expect(() => Obligation.parse({ ...base, confidence: 1.1 })).toThrow();
  });

  it('rejects negative confidence', () => {
    expect(() => Obligation.parse({ ...base, confidence: -0.1 })).toThrow();
  });

  it('rejects an empty summary', () => {
    expect(() => Obligation.parse({ ...base, summary: '' })).toThrow();
  });

  it('accepts an Obligation that points at a whole instrument (no section)', () => {
    const parsed = Obligation.parse({
      ...base,
      instrument_ref: { instrument_id: 'IN/companies-act-2013' },
    });
    expect(parsed.instrument_ref.section).toBeUndefined();
  });

  it('accepts a jail-risk obligation with imprisonment range', () => {
    const parsed = Obligation.parse({
      ...base,
      penalty: {
        has_imprisonment: true,
        imprisonment_months: { min: 6, max: 24 },
        fine_inr: { min: 0, max: 1_000_000 },
      },
    });
    expect(parsed.penalty.has_imprisonment).toBe(true);
  });
});
