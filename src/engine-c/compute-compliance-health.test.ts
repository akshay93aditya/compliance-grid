import { describe, expect, it } from 'vitest';
import type { Obligation } from '../schemas/obligation';
import {
  computeComplianceHealthScore,
  type ProofState,
} from './compute-compliance-health';

function makeObligation(
  canonical_id: string,
  instrument_id: string,
  overrides: Partial<Obligation> = {}
): Obligation {
  return {
    canonical_id,
    instrument_ref: { instrument_id },
    type: 'filing',
    summary: 'x',
    applicability_conditions: [],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: 's', citation_span: 'p' }],
    version: '1',
    confidence: 0.95,
    ...overrides,
  };
}

describe('computeComplianceHealthScore', () => {
  it('returns green for an empty obligations list', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [],
    });
    expect(result.overall).toBe('green');
    expect(result.per_domain).toEqual([]);
  });

  it('returns amber when all obligations are pending', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('a', 'IN-KA/inst-1'),
        makeObligation('b', 'IN-KA/inst-1'),
      ],
    });
    expect(result.overall).toBe('amber');
    expect(result.per_domain[0]!.color).toBe('amber');
    expect(result.per_domain[0]!.pending).toBe(2);
    expect(result.per_domain[0]!.complied).toBe(0);
  });

  it('returns green when all obligations are complied', () => {
    const proofs = new Map<string, ProofState>([
      ['a', 'complied'],
      ['b', 'complied'],
    ]);
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('a', 'IN-KA/inst-1'),
        makeObligation('b', 'IN-KA/inst-1'),
      ],
      proofState: proofs,
    });
    expect(result.overall).toBe('green');
    expect(result.per_domain[0]!.complied).toBe(2);
  });

  it('returns red when any obligation is overdue', () => {
    const proofs = new Map<string, ProofState>([['a', 'overdue']]);
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('a', 'IN-KA/inst-1'),
        makeObligation('b', 'IN-KA/inst-1', {
          // complied so the only red comes from "a" being overdue.
        }),
      ],
      proofState: new Map<string, ProofState>([
        ['a', 'overdue'],
        ['b', 'complied'],
      ]),
    });
    expect(result.overall).toBe('red');
    expect(result.per_domain[0]!.overdue).toBe(1);
  });

  it('returns red when any open obligation has jail_risk, even if not overdue', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('jail-risk', 'IN-KA/inst-1', {
          penalty: {
            has_imprisonment: true,
            imprisonment_months: { min: 6, max: 24 },
          },
        }),
        makeObligation('plain', 'IN-KA/inst-1'),
      ],
    });
    expect(result.overall).toBe('red');
    expect(result.per_domain[0]!.jail_risk_open).toBe(1);
  });

  it('does NOT mark jail_risk_open for obligations that are complied', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('jail-risk', 'IN-KA/inst-1', {
          penalty: {
            has_imprisonment: true,
            imprisonment_months: { min: 6, max: 24 },
          },
        }),
      ],
      proofState: new Map<string, ProofState>([['jail-risk', 'complied']]),
    });
    expect(result.per_domain[0]!.jail_risk_open).toBe(0);
    expect(result.overall).toBe('green');
  });

  it('rolls up per-instrument and reports overall worst color', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [
        // Instrument A: all complied → green
        makeObligation('a1', 'IN-KA/inst-A'),
        makeObligation('a2', 'IN-KA/inst-A'),
        // Instrument B: one pending → amber
        makeObligation('b1', 'IN-KA/inst-B'),
        // Instrument C: one jail-risk open → red
        makeObligation('c1', 'IN-KA/inst-C', {
          penalty: {
            has_imprisonment: true,
            imprisonment_months: { min: 1, max: 12 },
          },
        }),
      ],
      proofState: new Map<string, ProofState>([
        ['a1', 'complied'],
        ['a2', 'complied'],
        // b1 pending by default
        // c1 pending by default
      ]),
    });
    expect(result.overall).toBe('red');
    const byDomain = new Map(result.per_domain.map((d) => [d.domain, d.color]));
    expect(byDomain.get('IN-KA/inst-A')).toBe('green');
    expect(byDomain.get('IN-KA/inst-B')).toBe('amber');
    expect(byDomain.get('IN-KA/inst-C')).toBe('red');
    // Sort: red first.
    expect(result.per_domain[0]!.color).toBe('red');
  });

  it('reports correct totals', () => {
    const result = computeComplianceHealthScore({
      applicableObligations: [
        makeObligation('a', 'IN-KA/inst-A', {
          penalty: { has_imprisonment: true },
        }),
        makeObligation('b', 'IN-KA/inst-A'),
        makeObligation('c', 'IN-KA/inst-A'),
      ],
      proofState: new Map<string, ProofState>([['a', 'complied']]),
    });
    expect(result.total_applicable).toBe(3);
    expect(result.total_complied).toBe(1);
    expect(result.total_jail_risk_open).toBe(0); // a is jail-risk but complied
  });
});
