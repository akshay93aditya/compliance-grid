import { z } from 'zod';

// Per D19: how often the obligation recurs. Event-driven obligations have
// their cadence determined by EntityProfile events, not the calendar.
export const Frequency = z.enum([
  'one-time',
  'monthly',
  'quarterly',
  'half-yearly',
  'annual',
  'event-driven',
]);

export type Frequency = z.infer<typeof Frequency>;
