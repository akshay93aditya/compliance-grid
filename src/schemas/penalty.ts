import { z } from 'zod';

// Per D19: penalty replaces the spec's single `range` field with two named
// optional ranges. has_imprisonment drives jail-risk flagging in the product
// (per docs/specs/04-product-design-guidelines.md).
const MinMax = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  })
  .refine((r) => r.max >= r.min, {
    message: 'max must be >= min',
  });

export const Penalty = z.object({
  has_imprisonment: z.boolean(),
  imprisonment_months: MinMax.optional(),
  fine_inr: MinMax.optional(),
});

export type Penalty = z.infer<typeof Penalty>;
