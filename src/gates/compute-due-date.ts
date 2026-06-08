import type { EntityProfile } from '../schemas/entity-profile';
import type { Obligation } from '../schemas/obligation';

// Computes the deadline for an obligation given an EntityProfile and a
// reference date. Returns null if the deadline is undefined for the input
// (e.g. event-offset deadline with no matching event on the entity).
//
// The semantics are intentionally simple for v1:
//   fixed-date:    next occurrence of (month, day) on or after the reference
//   event-offset:  entity_event_date + N days
//   period-offset: end of the current calendar period (per frequency) + N days
//
// Callers decide what to do with a deadline that is in the past relative to
// "today" (typically: flag as missed, surface in the Compliance Health Score).
// This gate does not roll forward.
export function computeDueDate(
  obligation: Obligation,
  entity: EntityProfile,
  reference: Date
): Date | null {
  const rule = obligation.deadline_rule;
  if (rule.kind === 'fixed-date') {
    const candidate = new Date(
      reference.getFullYear(),
      rule.month - 1,
      rule.day
    );
    if (candidate < reference) {
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
    return candidate;
  }
  if (rule.kind === 'event-offset') {
    const raw = (entity as unknown as Record<string, unknown>)[rule.event];
    if (typeof raw !== 'string') return null;
    const eventDate = new Date(raw);
    if (Number.isNaN(eventDate.getTime())) return null;
    return new Date(eventDate.getTime() + rule.days * 86_400_000);
  }
  if (rule.kind === 'period-offset') {
    const periodEnd = currentPeriodEnd(obligation.frequency, reference);
    if (!periodEnd) return null;
    return new Date(periodEnd.getTime() + rule.days * 86_400_000);
  }
  return null;
}

// Last day of the current period for the given frequency, evaluated at the
// reference date. Returns null for frequencies where "current period" is not
// meaningful with a period-offset deadline.
function currentPeriodEnd(
  frequency: Obligation['frequency'],
  reference: Date
): Date | null {
  switch (frequency) {
    case 'monthly':
      return new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
    case 'quarterly': {
      const m = reference.getMonth();
      const quarterEndMonth = m - (m % 3) + 2;
      return new Date(reference.getFullYear(), quarterEndMonth + 1, 0);
    }
    case 'half-yearly': {
      const halfEndMonth = reference.getMonth() < 6 ? 5 : 11;
      return new Date(reference.getFullYear(), halfEndMonth + 1, 0);
    }
    case 'annual': {
      // Indian fiscal year ends March 31.
      let fyEnd = new Date(reference.getFullYear(), 2, 31);
      if (reference > fyEnd) {
        fyEnd = new Date(reference.getFullYear() + 1, 2, 31);
      }
      return fyEnd;
    }
    case 'one-time':
    case 'event-driven':
      return null;
  }
}
