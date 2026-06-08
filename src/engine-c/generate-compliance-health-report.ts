import type { Pool, PoolClient } from 'pg';
import { loadObligations } from '../db/obligations';
import { evaluateApplicability } from '../gates/evaluate-applicability';
import type { EntityProfile } from '../schemas/entity-profile';
import {
  computeComplianceHealthScore,
  type ComplianceHealthScore,
  type ProofState,
} from './compute-compliance-health';

type Executor = Pool | PoolClient;

export interface GenerateComplianceHealthReportInput {
  entity: EntityProfile;
  // Optional restriction to a set of instruments.
  instrumentIds?: string[];
  // Optional proof state. When omitted, every applicable obligation is
  // treated as 'pending' (since the Org Vault that would hold proofs is a
  // later phase).
  proofState?: Map<string, ProofState>;
}

export interface ComplianceHealthReport {
  score: ComplianceHealthScore;
  loaded_obligation_count: number;
  applicable_obligation_count: number;
}

// Pure DB + pure computation, no AI. Loads obligations for the entity's
// jurisdiction, applies the Applicability Engine, computes the score.
// Cheap to run repeatedly; safe to call on every page load.
export async function generateComplianceHealthReport(
  executor: Executor,
  input: GenerateComplianceHealthReportInput
): Promise<ComplianceHealthReport> {
  const filter = input.instrumentIds
    ? { instrumentIds: input.instrumentIds }
    : { jurisdiction: input.entity.jurisdictions[0] };

  const allObligations = await loadObligations(executor, filter);
  const applicable = evaluateApplicability({
    entity: input.entity,
    obligations: allObligations,
  });
  const score = computeComplianceHealthScore({
    applicableObligations: applicable,
    ...(input.proofState ? { proofState: input.proofState } : {}),
  });

  return {
    score,
    loaded_obligation_count: allObligations.length,
    applicable_obligation_count: applicable.length,
  };
}
