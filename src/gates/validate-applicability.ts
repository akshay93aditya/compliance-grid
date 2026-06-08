import { z } from 'zod';
import type { ApplicabilityCondition } from '../schemas/applicability-condition';
import { EntityType } from '../schemas/entity-profile';
import { Jurisdiction } from '../schemas/jurisdiction';

// Per D32: semantic validation of an extracted ObligationCandidate's
// applicability_conditions against the EntityProfile field vocabulary.
//
// The schema layer (ApplicabilityCondition in src/schemas/) intentionally
// keeps `value: z.unknown()` so the AI is free to put whatever it returns.
// This gate is where we check that the field name and the value type
// actually make sense against the entity model. Any failure routes the
// candidate to the review queue (D32) rather than auto-committing.
//
// This is the fix for the "factory-occupier" class of issue surfaced by the
// Phase 1.4.3 live test (the AI used a string value not in EntityType).

export interface ValidationIssue {
  index: number;
  field: string;
  op: string;
  reason: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const ALLOWED_FIELDS = new Set([
  'sector',
  'entity_type',
  'jurisdictions',
  'headcount',
  'annual_turnover_inr',
  'incorporation_date',
  'registered_state',
]);

const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);

// Fields that support numeric comparison ops. incorporation_date is
// represented as an ISO string but is ordered, so we allow numeric ops on it.
const NUMERIC_OP_COMPATIBLE_FIELDS = new Set([
  'headcount',
  'annual_turnover_inr',
  'incorporation_date',
]);

function checkValue(
  field: string,
  op: string,
  value: unknown
): string | null {
  switch (field) {
    case 'entity_type': {
      const schema = op === 'in' ? z.array(EntityType) : EntityType;
      const parsed = schema.safeParse(value);
      return parsed.success
        ? null
        : 'value must match the EntityType enum';
    }
    case 'jurisdictions':
    case 'registered_state': {
      const schema = op === 'in' ? z.array(Jurisdiction) : Jurisdiction;
      const parsed = schema.safeParse(value);
      return parsed.success
        ? null
        : 'value must match the Jurisdiction shape (IN or IN-XX)';
    }
    case 'sector': {
      const schema = op === 'in' ? z.array(z.string().min(1)) : z.string().min(1);
      const parsed = schema.safeParse(value);
      return parsed.success ? null : 'value must be a non-empty string';
    }
    case 'headcount':
    case 'annual_turnover_inr': {
      const schema = op === 'in' ? z.array(z.number()) : z.number();
      const parsed = schema.safeParse(value);
      return parsed.success ? null : 'value must be a number';
    }
    case 'incorporation_date': {
      const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const schema = op === 'in' ? z.array(isoDate) : isoDate;
      const parsed = schema.safeParse(value);
      return parsed.success
        ? null
        : 'value must be an ISO date string (YYYY-MM-DD)';
    }
    default:
      return null;
  }
}

export function validateApplicabilityConditions(
  conditions: ApplicabilityCondition[]
): ValidationResult {
  const issues: ValidationIssue[] = [];

  conditions.forEach((c, index) => {
    if (!ALLOWED_FIELDS.has(c.field)) {
      issues.push({
        index,
        field: c.field,
        op: c.op,
        reason: `unknown field "${c.field}"; allowed: ${[...ALLOWED_FIELDS].join(', ')}`,
      });
      return;
    }

    if (NUMERIC_OPS.has(c.op) && !NUMERIC_OP_COMPATIBLE_FIELDS.has(c.field)) {
      issues.push({
        index,
        field: c.field,
        op: c.op,
        reason: `op "${c.op}" requires a numeric or date field; "${c.field}" is not`,
      });
      return;
    }

    const valueIssue = checkValue(c.field, c.op, c.value);
    if (valueIssue) {
      issues.push({ index, field: c.field, op: c.op, reason: valueIssue });
    }
  });

  return { ok: issues.length === 0, issues };
}
