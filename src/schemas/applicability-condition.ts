import { z } from 'zod';

// Per D19: applicability conditions are structured predicates so the
// deterministic Applicability Engine can evaluate them without AI re-parsing.
// Multiple conditions on an Obligation are AND-combined.
export const ApplicabilityOp = z.enum(['eq', 'in', 'gte', 'lte', 'gt', 'lt']);
export type ApplicabilityOp = z.infer<typeof ApplicabilityOp>;

export const ApplicabilityCondition = z.object({
  field: z.string().min(1),
  op: ApplicabilityOp,
  value: z.unknown(),
});

export type ApplicabilityCondition = z.infer<typeof ApplicabilityCondition>;
