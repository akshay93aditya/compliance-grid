import { z } from 'zod';
import { Jurisdiction } from './jurisdiction';

// Per D20: Indian entity types relevant to applicability.
export const EntityType = z.enum([
  'proprietorship',
  'partnership',
  'llp',
  'pvt-ltd',
  'public-ltd',
  'opc',
  'huf',
  'trust',
  'society',
]);
export type EntityType = z.infer<typeof EntityType>;

// PAN: ten characters, structure AAAAA9999A (five uppercase letters,
// four digits, one uppercase letter).
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// GSTIN: fifteen characters; two-digit state code, ten-character PAN,
// entity number (1-9 or A-Z), the letter Z, then a checksum character.
// Checksum logic is not validated here; this is shape only.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Per docs/specs/03-architecture.md "Object schemas":
//   EntityProfile { entity_id, org_id, sector, jurisdictions[], headcount,
//                   turnover, entity_type, ... }
// Per D20, the `...` resolves to incorporation_date, registered_state, PAN, GSTIN.
// The turnover field is named annual_turnover_inr to make the unit explicit.
// PAN and GSTIN are sensitive; they live in the Org Vault and are encrypted
// per D7. The Org Vault layer (later phase) owns at-rest encryption.
export const EntityProfile = z.object({
  entity_id: z.string().min(1),
  org_id: z.string().min(1),
  entity_type: EntityType,
  sector: z.string().min(1),
  jurisdictions: z.array(Jurisdiction).min(1),
  headcount: z.number().int().nonnegative(),
  annual_turnover_inr: z.number().nonnegative(),
  incorporation_date: z.iso.date().optional(),
  registered_state: Jurisdiction.optional(),
  pan: z.string().regex(PAN_RE).optional(),
  gstin: z.string().regex(GSTIN_RE).optional(),
});

export type EntityProfile = z.infer<typeof EntityProfile>;
