import { z } from 'zod';

// Per D19: deadline_rule is structured so the deterministic Applicability
// Engine can compute due dates from an EntityProfile without AI re-parsing.
//
// fixed-date:      a calendar date every period, e.g. "April 30"
// period-offset:   N days after the period ends (month, quarter, year)
// event-offset:    N days after a named event in the EntityProfile

const FixedDate = z.object({
  kind: z.literal('fixed-date'),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

const PeriodOffset = z.object({
  kind: z.literal('period-offset'),
  days: z.number().int().nonnegative(),
});

const EventOffset = z.object({
  kind: z.literal('event-offset'),
  days: z.number().int().nonnegative(),
  event: z.string().min(1),
});

export const DeadlineRule = z.discriminatedUnion('kind', [
  FixedDate,
  PeriodOffset,
  EventOffset,
]);

export type DeadlineRule = z.infer<typeof DeadlineRule>;
