import { describe, expect, it } from 'vitest';
import type { EntityProfile } from '../schemas/entity-profile';
import type { Obligation } from '../schemas/obligation';
import { evaluateApplicability } from './evaluate-applicability';

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
  canonical_id: string,
  conditions: Obligation['applicability_conditions']
): Obligation {
  return {
    canonical_id,
    instrument_ref: { instrument_id: 'IN/x' },
    type: 'filing',
    summary: 'test',
    applicability_conditions: conditions,
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: 's1', citation_span: 'p.1' }],
    version: '1',
    confidence: 0.95,
  };
}

describe('evaluateApplicability', () => {
  it('returns an obligation with no conditions as always applicable', () => {
    const entity = makeEntity();
    const obligations = [makeObligation('a', [])];
    expect(evaluateApplicability({ entity, obligations })).toHaveLength(1);
  });

  it('matches a single eq condition', () => {
    const entity = makeEntity({ sector: 'manufacturing' });
    const obligations = [
      makeObligation('a', [
        { field: 'sector', op: 'eq', value: 'manufacturing' },
      ]),
    ];
    expect(evaluateApplicability({ entity, obligations })).toHaveLength(1);
  });

  it('does not match when an eq condition fails', () => {
    const entity = makeEntity({ sector: 'services' });
    const obligations = [
      makeObligation('a', [
        { field: 'sector', op: 'eq', value: 'manufacturing' },
      ]),
    ];
    expect(evaluateApplicability({ entity, obligations })).toHaveLength(0);
  });

  it('AND-combines multiple conditions on a single obligation', () => {
    const entity = makeEntity({ sector: 'manufacturing', headcount: 50 });
    const all = [
      { field: 'sector', op: 'eq' as const, value: 'manufacturing' },
      { field: 'headcount', op: 'gte' as const, value: 20 },
    ];
    expect(
      evaluateApplicability({
        entity,
        obligations: [makeObligation('a', all)],
      })
    ).toHaveLength(1);

    const entitySmall = makeEntity({ sector: 'manufacturing', headcount: 5 });
    expect(
      evaluateApplicability({
        entity: entitySmall,
        obligations: [makeObligation('a', all)],
      })
    ).toHaveLength(0);
  });

  it('treats "in" against an array field as set-overlap', () => {
    const entity = makeEntity({ jurisdictions: ['IN-KA', 'IN-AP'] });
    const matches = makeObligation('a', [
      { field: 'jurisdictions', op: 'in', value: ['IN-KA', 'IN-MH'] },
    ]);
    const doesNot = makeObligation('b', [
      { field: 'jurisdictions', op: 'in', value: ['IN-TG', 'IN-MH'] },
    ]);
    const result = evaluateApplicability({
      entity,
      obligations: [matches, doesNot],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.canonical_id).toBe('a');
  });

  it('treats "in" against a scalar field as membership', () => {
    const entity = makeEntity({ entity_type: 'pvt-ltd' });
    const obligations = [
      makeObligation('a', [
        {
          field: 'entity_type',
          op: 'in',
          value: ['pvt-ltd', 'public-ltd', 'llp'],
        },
      ]),
    ];
    expect(evaluateApplicability({ entity, obligations })).toHaveLength(1);
  });

  it('evaluates numeric comparisons (gt, gte, lt, lte)', () => {
    const entity = makeEntity({ annual_turnover_inr: 50_000_000 });
    const obs = [
      makeObligation('gt', [
        { field: 'annual_turnover_inr', op: 'gt', value: 40_000_000 },
      ]),
      makeObligation('gte', [
        { field: 'annual_turnover_inr', op: 'gte', value: 50_000_000 },
      ]),
      makeObligation('lt', [
        { field: 'annual_turnover_inr', op: 'lt', value: 100_000_000 },
      ]),
      makeObligation('lte', [
        { field: 'annual_turnover_inr', op: 'lte', value: 50_000_000 },
      ]),
      makeObligation('miss', [
        { field: 'annual_turnover_inr', op: 'gt', value: 100_000_000 },
      ]),
    ];
    const result = evaluateApplicability({ entity, obligations: obs });
    expect(result.map((o) => o.canonical_id)).toEqual(['gt', 'gte', 'lt', 'lte']);
  });

  it('fails a condition referencing a missing field', () => {
    const entity = makeEntity();
    const obligations = [
      makeObligation('a', [
        { field: 'made_up_field', op: 'eq', value: 'x' },
      ]),
    ];
    expect(evaluateApplicability({ entity, obligations })).toHaveLength(0);
  });

  it('filters a mixed set deterministically', () => {
    const entity = makeEntity({
      sector: 'manufacturing',
      headcount: 30,
      jurisdictions: ['IN-KA'],
    });
    const obs = [
      makeObligation('factory-rule', [
        { field: 'sector', op: 'eq', value: 'manufacturing' },
        { field: 'headcount', op: 'gte', value: 10 },
        { field: 'jurisdictions', op: 'in', value: ['IN-KA'] },
      ]),
      makeObligation('big-only', [
        { field: 'annual_turnover_inr', op: 'gte', value: 100_000_000 },
      ]),
      makeObligation('services-only', [
        { field: 'sector', op: 'eq', value: 'services' },
      ]),
    ];
    const result = evaluateApplicability({ entity, obligations: obs });
    expect(result.map((o) => o.canonical_id)).toEqual(['factory-rule']);
  });
});
