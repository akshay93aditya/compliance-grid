import { z } from 'zod';

// Per D18.
export const ChangeType = z.enum([
  'new',
  'amended',
  'superseded',
  'repealed',
  'clarified',
]);
export type ChangeType = z.infer<typeof ChangeType>;

export const ChangeStatus = z.enum([
  'detected',
  'verification-pending',
  'confirmed',
  'propagated',
  'dismissed',
]);
export type ChangeStatus = z.infer<typeof ChangeStatus>;

// Per docs/specs/03-architecture.md "Object schemas":
//   ChangeEvent { id, obligation_ref, change_type, effective_date, source_ref, detected_at, status }
export const ChangeEvent = z.object({
  id: z.string().min(1),
  obligation_ref: z.string().min(1),
  change_type: ChangeType,
  effective_date: z.iso.date(),
  source_ref: z.string().min(1),
  detected_at: z.iso.datetime(),
  status: ChangeStatus,
});

export type ChangeEvent = z.infer<typeof ChangeEvent>;
