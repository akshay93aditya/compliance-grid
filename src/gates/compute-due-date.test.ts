import { describe, expect, it } from 'vitest';
import type { EntityProfile } from '../schemas/entity-profile';
import type { Obligation } from '../schemas/obligation';
import { computeDueDate } from './compute-due-date';

function makeEntity(overrides: Partial<EntityProfile> = {}): EntityProfile {
  return {
    entity_id: 'e1',
    org_id: 'o1',
    entity_type: 'pvt-ltd',
    sector: 'manufacturing',
    jurisdictions: ['IN-KA'],
    headcount: 25,
    annual_turnover_inr: 50_000_000,
    ...overrides,
  };
}

function makeObligation(
  frequency: Obligation['frequency'],
  deadline_rule: Obligation['deadline_rule']
): Obligation {
  return {
    canonical_id: 'test',
    instrument_ref: { instrument_id: 'IN/x' },
    type: 'filing',
    summary: 'test',
    applicability_conditions: [],
    frequency,
    deadline_rule,
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: 's', citation_span: 'p.1' }],
    version: '1',
    confidence: 0.95,
  };
}

describe('computeDueDate', () => {
  it('returns the future occurrence for a fixed-date rule in the same year', () => {
    const o = makeObligation('annual', { kind: 'fixed-date', month: 4, day: 30 });
    const ref = new Date(2026, 2, 15); // March 15, 2026
    const due = computeDueDate(o, makeEntity(), ref);
    expect(due).toEqual(new Date(2026, 3, 30));
  });

  it('rolls a past fixed-date forward to next year', () => {
    const o = makeObligation('annual', { kind: 'fixed-date', month: 1, day: 15 });
    const ref = new Date(2026, 5, 1); // June 1, 2026 (already past Jan 15)
    const due = computeDueDate(o, makeEntity(), ref);
    expect(due).toEqual(new Date(2027, 0, 15));
  });

  it('computes a period-offset monthly deadline as end-of-month + days', () => {
    const o = makeObligation('monthly', { kind: 'period-offset', days: 10 });
    const ref = new Date(2026, 2, 15); // March 2026
    const due = computeDueDate(o, makeEntity(), ref);
    // End of March 2026 is March 31; +10 days = April 10.
    expect(due).toEqual(new Date(2026, 3, 10));
  });

  it('computes a period-offset quarterly deadline correctly', () => {
    const o = makeObligation('quarterly', { kind: 'period-offset', days: 30 });
    const ref = new Date(2026, 1, 15); // Feb 15, 2026 (Q1 = Jan-Mar)
    const due = computeDueDate(o, makeEntity(), ref);
    // Q1 ends March 31; +30 days = April 30.
    expect(due).toEqual(new Date(2026, 3, 30));
  });

  it('computes a period-offset annual deadline as Indian FY end + days', () => {
    const o = makeObligation('annual', { kind: 'period-offset', days: 30 });
    const ref = new Date(2026, 5, 15); // June 15, 2026 (FY 26-27 in progress)
    const due = computeDueDate(o, makeEntity(), ref);
    // Next FY-end after June 15, 2026 is March 31, 2027; +30 days = April 30, 2027.
    expect(due).toEqual(new Date(2027, 3, 30));
  });

  it('handles a period-offset annual where ref is before the FY-end of the calendar year', () => {
    const o = makeObligation('annual', { kind: 'period-offset', days: 30 });
    const ref = new Date(2026, 1, 1); // Feb 1, 2026 (FY 25-26 ends March 31, 2026)
    const due = computeDueDate(o, makeEntity(), ref);
    expect(due).toEqual(new Date(2026, 3, 30));
  });

  it('computes an event-offset deadline from a date string field on the entity', () => {
    const o = makeObligation('event-driven', {
      kind: 'event-offset',
      days: 30,
      event: 'incorporation_date',
    });
    const entity = makeEntity({ incorporation_date: '2020-06-01' });
    const ref = new Date(2026, 5, 1);
    const due = computeDueDate(o, entity, ref);
    // Event date 2020-06-01 + 30 days = 2020-07-01.
    expect(due?.toISOString().slice(0, 10)).toBe('2020-07-01');
  });

  it('returns null for event-offset when the named event is missing on the entity', () => {
    const o = makeObligation('event-driven', {
      kind: 'event-offset',
      days: 30,
      event: 'made_up_event',
    });
    const due = computeDueDate(o, makeEntity(), new Date());
    expect(due).toBeNull();
  });

  it('returns null for period-offset with one-time frequency', () => {
    const o = makeObligation('one-time', { kind: 'period-offset', days: 10 });
    const due = computeDueDate(o, makeEntity(), new Date());
    expect(due).toBeNull();
  });

  it('returns null for period-offset with event-driven frequency', () => {
    const o = makeObligation('event-driven', {
      kind: 'period-offset',
      days: 10,
    });
    const due = computeDueDate(o, makeEntity(), new Date());
    expect(due).toBeNull();
  });
});
