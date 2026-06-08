import { z } from 'zod';

// India national + state-level jurisdictions, ISO 3166-2 format.
// "IN" is national. "IN-XX" is a state where XX is a two-letter region code.
// This validates shape only. Whether a given state is in v1 module scope is a
// separate concern (see D12: Karnataka IN-KA and Andhra Pradesh IN-AP).
const JURISDICTION_RE = /^IN(-[A-Z]{2})?$/;

export const Jurisdiction = z.string().regex(JURISDICTION_RE, {
  message: 'Jurisdiction must be "IN" (national) or "IN-XX" (state, ISO 3166-2 format)',
});

export type Jurisdiction = z.infer<typeof Jurisdiction>;
