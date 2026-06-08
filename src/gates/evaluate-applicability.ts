import type { ApplicabilityCondition } from '../schemas/applicability-condition';
import type { EntityProfile } from '../schemas/entity-profile';
import type { Obligation } from '../schemas/obligation';

// Per docs/specs/03-architecture.md: "Applicability Engine (deterministic):
// given an Entity profile + obligations in relevant live modules, computes
// exactly what applies. Same input + same graph version = same output."
//
// AI extracts applicability conditions into structured form upstream; this
// gate evaluates them against the EntityProfile with no AI involvement.
// Multiple conditions on a single obligation are AND-combined.
export function evaluateApplicability(input: {
  entity: EntityProfile;
  obligations: Obligation[];
}): Obligation[] {
  return input.obligations.filter((o) =>
    o.applicability_conditions.every((c) =>
      evaluateCondition(input.entity, c)
    )
  );
}

function evaluateCondition(
  entity: EntityProfile,
  c: ApplicabilityCondition
): boolean {
  const value = lookupField(entity, c.field);
  switch (c.op) {
    case 'eq':
      return value === c.value;
    case 'in': {
      if (!Array.isArray(c.value)) return false;
      const allowed = c.value as unknown[];
      if (Array.isArray(value)) {
        return (value as unknown[]).some((v) => allowed.includes(v));
      }
      return allowed.includes(value);
    }
    case 'gt':
      return (
        typeof value === 'number' &&
        typeof c.value === 'number' &&
        value > c.value
      );
    case 'gte':
      return (
        typeof value === 'number' &&
        typeof c.value === 'number' &&
        value >= c.value
      );
    case 'lt':
      return (
        typeof value === 'number' &&
        typeof c.value === 'number' &&
        value < c.value
      );
    case 'lte':
      return (
        typeof value === 'number' &&
        typeof c.value === 'number' &&
        value <= c.value
      );
  }
}

function lookupField(entity: EntityProfile, field: string): unknown {
  return (entity as unknown as Record<string, unknown>)[field];
}
