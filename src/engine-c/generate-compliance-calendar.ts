import type { Pool, PoolClient } from 'pg';
import type { AgentRunnerClient } from '../agents/contract';
import { runProjection, type ProjectionCard } from '../agents/projection';
import { loadObligationContexts, loadObligations } from '../db/obligations';
import { computeDueDate } from '../gates/compute-due-date';
import { evaluateApplicability } from '../gates/evaluate-applicability';
import type { EntityProfile } from '../schemas/entity-profile';

type Executor = Pool | PoolClient;

// Per D38 (locked in this PR): Engine C composes the Phase 1.3 Applicability
// Engine and computeDueDate with the Phase 2.1 Projection Agent. For each
// applicable obligation: load the parent instrument + a freshness timestamp,
// compute the due date deterministically, and call Projection for the
// plain-language card. Budget control via `maxObligations` because each
// projection is one Sonnet call (~$0.02).

export interface GenerateComplianceCalendarInput {
  entity: EntityProfile;
  // Date to evaluate "next deadline" against. Defaults to today.
  reference_date?: Date;
  // Optional restriction to a set of instruments. Default: any obligation
  // whose instrument's jurisdiction matches the entity's first jurisdiction.
  instrumentIds?: string[];
  // Hard cap on how many applicable obligations to project. Each projection
  // is one Sonnet call. Required for safe runs against large CKGs.
  maxObligations?: number;
  client?: AgentRunnerClient;
}

export interface ComplianceCalendarEntry {
  card: ProjectionCard;
  // ISO date (YYYY-MM-DD) of the computed due date, or null if not computable
  // (for example, an event-offset deadline whose event field is absent on
  // the EntityProfile).
  due_date: string | null;
}

export interface GenerateComplianceCalendarResult {
  loaded_obligation_count: number;
  applicable_obligation_count: number;
  projected_card_count: number;
  cards: ComplianceCalendarEntry[];
  skipped_due_to_cap: number;
}

export async function generateComplianceCalendar(
  executor: Executor,
  input: GenerateComplianceCalendarInput
): Promise<GenerateComplianceCalendarResult> {
  const refDate = input.reference_date ?? new Date();

  // 1. Load candidate obligations.
  const filter = input.instrumentIds
    ? { instrumentIds: input.instrumentIds }
    : { jurisdiction: input.entity.jurisdictions[0] };
  const allObligations = await loadObligations(executor, filter);

  // 2. Apply Applicability Engine.
  const applicable = evaluateApplicability({
    entity: input.entity,
    obligations: allObligations,
  });

  // 3. Apply cap. Skipped count is surfaced so callers know if they need
  //    to raise the cap or filter more aggressively.
  const cap = input.maxObligations ?? applicable.length;
  const toProject = applicable.slice(0, cap);
  const skipped = Math.max(0, applicable.length - cap);

  // 4. Batch-load every context the projection loop needs in one round
  // trip. Was: one loadObligationContext per card (N+1 per the audit).
  const contextById = await loadObligationContexts(
    executor,
    toProject.map((o) => o.canonical_id)
  );

  const cards: ComplianceCalendarEntry[] = [];
  for (const obligation of toProject) {
    const context = contextById.get(obligation.canonical_id);
    if (!context) continue;

    const dueDate = computeDueDate(obligation, input.entity, refDate);

    const card = await runProjection(
      {
        obligation,
        instrument: context.instrument,
        source_verified_at: context.source_verified_at,
      },
      {
        ...(input.client ? { client: input.client } : {}),
        // Cache by default — repeat /calendar loads are free.
        cacheExecutor: executor,
      }
    );

    cards.push({
      card,
      due_date: dueDate ? dueDate.toISOString().slice(0, 10) : null,
    });
  }

  return {
    loaded_obligation_count: allObligations.length,
    applicable_obligation_count: applicable.length,
    projected_card_count: cards.length,
    cards,
    skipped_due_to_cap: skipped,
  };
}
