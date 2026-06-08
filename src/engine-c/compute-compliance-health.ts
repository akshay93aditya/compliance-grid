import type { Obligation } from '../schemas/obligation';

// Per D41: traffic-light Compliance Health Score per docs/specs/04-product-design-guidelines.md.
// Red if any jail-risk obligation is open (pending or overdue). Otherwise:
// amber if anything is open, green if all complied. Overall = worst color.
//
// Per D42: "domain" for the per-domain rollup is keyed by instrument_id at
// v1. When Module references are wired onto Obligation in a later phase,
// the rollup key moves to Module.coordinate.domain.

export type ProofState = 'complied' | 'pending' | 'overdue';
export type HealthColor = 'green' | 'amber' | 'red';

export interface DomainRollup {
  // Stable identifier for the rollup group. At v1: instrument_id.
  domain: string;
  total: number;
  complied: number;
  pending: number;
  overdue: number;
  // Pending or overdue obligations whose penalty.has_imprisonment is true.
  jail_risk_open: number;
  color: HealthColor;
}

export interface ComplianceHealthScore {
  per_domain: DomainRollup[];
  overall: HealthColor;
  total_applicable: number;
  total_complied: number;
  total_jail_risk_open: number;
}

export interface ComputeComplianceHealthInput {
  applicableObligations: Obligation[];
  // Optional map from canonical_id to proof state. Defaults all obligations
  // to 'pending' when omitted (since the Org Vault that would hold proofs
  // is a later phase).
  proofState?: Map<string, ProofState>;
}

function colorFromRollup(r: {
  jail_risk_open: number;
  pending: number;
  overdue: number;
}): HealthColor {
  if (r.jail_risk_open > 0) return 'red';
  if (r.overdue > 0) return 'red';
  if (r.pending > 0) return 'amber';
  return 'green';
}

function worstColor(colors: HealthColor[]): HealthColor {
  if (colors.includes('red')) return 'red';
  if (colors.includes('amber')) return 'amber';
  return 'green';
}

// Pure function. No I/O, no side effects. Same inputs always produce the
// same output, which makes the score auditable and unit-testable.
export function computeComplianceHealthScore(
  input: ComputeComplianceHealthInput
): ComplianceHealthScore {
  const proofState = input.proofState ?? new Map<string, ProofState>();

  // Group obligations by domain (instrument_id at v1).
  const byDomain = new Map<string, Obligation[]>();
  for (const obligation of input.applicableObligations) {
    const domain = obligation.instrument_ref.instrument_id;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(obligation);
  }

  const per_domain: DomainRollup[] = [];
  let totalComplied = 0;
  let totalJailRiskOpen = 0;

  for (const [domain, obligations] of byDomain.entries()) {
    let complied = 0;
    let pending = 0;
    let overdue = 0;
    let jail_risk_open = 0;

    for (const o of obligations) {
      const state = proofState.get(o.canonical_id) ?? 'pending';
      const open = state !== 'complied';
      if (state === 'complied') complied += 1;
      else if (state === 'pending') pending += 1;
      else overdue += 1;
      if (open && o.penalty.has_imprisonment) jail_risk_open += 1;
    }

    totalComplied += complied;
    totalJailRiskOpen += jail_risk_open;

    per_domain.push({
      domain,
      total: obligations.length,
      complied,
      pending,
      overdue,
      jail_risk_open,
      color: colorFromRollup({ jail_risk_open, pending, overdue }),
    });
  }

  // Stable sort: red domains first, then amber, then green; tie-break by total DESC.
  const colorRank: Record<HealthColor, number> = { red: 0, amber: 1, green: 2 };
  per_domain.sort((a, b) => {
    if (colorRank[a.color] !== colorRank[b.color]) {
      return colorRank[a.color] - colorRank[b.color];
    }
    return b.total - a.total;
  });

  return {
    per_domain,
    overall: worstColor(per_domain.map((d) => d.color)),
    total_applicable: input.applicableObligations.length,
    total_complied: totalComplied,
    total_jail_risk_open: totalJailRiskOpen,
  };
}
