import { z } from 'zod';

// Per D14: an Obligation points at an Instrument plus an optional section.
// Whole-instrument obligations have section: undefined.
// Section participates in the canonical key (D8).
export const InstrumentRef = z.object({
  instrument_id: z.string().min(1),
  section: z.string().min(1).optional(),
});

export type InstrumentRef = z.infer<typeof InstrumentRef>;
