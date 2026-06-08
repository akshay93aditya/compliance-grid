import { z } from 'zod';
import { Jurisdiction } from './jurisdiction';

// Per docs/specs/03-architecture.md "Object schemas":
//   Instrument { id, type(Act|Rule|Notification), title, jurisdiction, citation }

export const InstrumentType = z.enum(['Act', 'Rule', 'Notification']);
export type InstrumentType = z.infer<typeof InstrumentType>;

export const Instrument = z.object({
  id: z.string().min(1),
  type: InstrumentType,
  title: z.string().min(1),
  jurisdiction: Jurisdiction,
  citation: z.string().min(1),
});

export type Instrument = z.infer<typeof Instrument>;
