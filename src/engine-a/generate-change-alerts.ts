import type { Pool, PoolClient } from 'pg';
import type { AgentRunnerClient } from '../agents/contract';
import { runProjection, type ProjectionCard } from '../agents/projection';
import { loadChangeEvents } from '../db/change-events';
import { loadObligationContexts } from '../db/obligations';
import { computeDueDate } from '../gates/compute-due-date';
import { evaluateApplicability } from '../gates/evaluate-applicability';
import type { EntityProfile } from '../schemas/entity-profile';
import type { ChangeStatus, ChangeType } from '../schemas/change-event';

type Executor = Pool | PoolClient;

// Per D40: alerts are sorted jail_risk DESC then by due_date ASC (nulls last)
// then by change_type ('amended' before 'new' so live amendments surface
// before initial ingest events).
function compareAlerts(a: ChangeAlert, b: ChangeAlert): number {
  if (a.card.jail_risk !== b.card.jail_risk) {
    return a.card.jail_risk ? -1 : 1;
  }
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  if (a.change_type !== b.change_type) {
    return a.change_type === 'amended' ? -1 : 1;
  }
  return 0;
}

export interface GenerateChangeAlertsInput {
  // Only alerts on events detected at or after this time. Default: 24 hours ago.
  since?: Date;
  // Restrict to these statuses. Default: ['detected', 'verification-pending', 'confirmed'].
  statuses?: ChangeStatus[];
  // Optional entity to filter alerts down to obligations that apply.
  // Without an entity, every change event surfaces.
  entity?: EntityProfile;
  // Reference date for due_date computation. Default: today.
  reference_date?: Date;
  // Hard cap on how many alerts to produce. Each alert is one Sonnet call.
  maxAlerts: number;
  client?: AgentRunnerClient;
}

export interface ChangeAlert {
  change_event_id: string;
  change_type: ChangeType;
  change_status: ChangeStatus;
  effective_date: string;
  detected_at: string;
  card: ProjectionCard;
  due_date: string | null;
}

export interface GenerateChangeAlertsResult {
  change_events_found: number;
  applicable_count: number;
  projected_count: number;
  skipped_due_to_cap: number;
  alerts: ChangeAlert[];
}

// Engine A. Given a time window (and optionally an entity), find recent
// ChangeEvents, project each affected obligation as an alert card, and
// return the cards sorted by jail risk + due date proximity.
//
// Composes the Phase 1.3 Applicability Engine (when entity is provided),
// `computeDueDate`, and the Phase 2.1 Projection Agent. Same explicit cost
// gate (`maxAlerts`) pattern as Engine C's `maxObligations` (D38).
export async function generateChangeAlerts(
  executor: Executor,
  input: GenerateChangeAlertsInput
): Promise<GenerateChangeAlertsResult> {
  const refDate = input.reference_date ?? new Date();
  const since =
    input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Load change events in the window.
  const changeEvents = await loadChangeEvents(executor, {
    since,
    statuses: input.statuses,
    limit: input.maxAlerts * 4,
  });

  // 2. Load context for each. Deduplicate by canonical_id (latest event wins
  //    since events come back DESC by detected_at).
  const seen = new Set<string>();
  const candidates: Array<{
    changeEventId: string;
    changeType: ChangeType;
    changeStatus: ChangeStatus;
    effectiveDate: string;
    detectedAt: string;
    canonicalId: string;
  }> = [];
  for (const event of changeEvents) {
    if (seen.has(event.obligation_ref)) continue;
    seen.add(event.obligation_ref);
    candidates.push({
      changeEventId: event.id,
      changeType: event.change_type,
      changeStatus: event.status,
      effectiveDate: event.effective_date,
      detectedAt: event.detected_at,
      canonicalId: event.obligation_ref,
    });
  }

  // 3. Batch-load every candidate's context in a single round trip,
  // then reuse the same map for applicability filtering AND projection.
  // Was: one loadObligationContext per candidate, then again per
  // projected alert (the classic N+1 the audit called out).
  const allContextById = await loadObligationContexts(
    executor,
    candidates.map((c) => c.canonicalId)
  );

  let applicableCanonicalIds = new Set(candidates.map((c) => c.canonicalId));
  if (input.entity) {
    const applicableSet = new Set<string>();
    for (const candidate of candidates) {
      const context = allContextById.get(candidate.canonicalId);
      if (!context) continue;
      const applies = evaluateApplicability({
        entity: input.entity,
        obligations: [context.obligation],
      });
      if (applies.length > 0) applicableSet.add(candidate.canonicalId);
    }
    applicableCanonicalIds = applicableSet;
  }
  const applicableCount = applicableCanonicalIds.size;
  const applicable = candidates.filter((c) =>
    applicableCanonicalIds.has(c.canonicalId)
  );

  // 4. Cap and project.
  const cap = Math.min(input.maxAlerts, applicable.length);
  const toProject = applicable.slice(0, cap);
  const skipped = Math.max(0, applicable.length - cap);

  const alerts: ChangeAlert[] = [];
  for (const candidate of toProject) {
    const context = allContextById.get(candidate.canonicalId);
    if (!context) continue;
    const dueDate = input.entity
      ? computeDueDate(context.obligation, input.entity, refDate)
      : null;
    const card = await runProjection(
      {
        obligation: context.obligation,
        instrument: context.instrument,
        source_verified_at: context.source_verified_at,
      },
      {
        ...(input.client ? { client: input.client } : {}),
        // Cache by default: every Engine A call reads from + writes to
        // the projection_cache table. Repeat /alerts loads are free.
        cacheExecutor: executor,
      }
    );
    alerts.push({
      change_event_id: candidate.changeEventId,
      change_type: candidate.changeType,
      change_status: candidate.changeStatus,
      effective_date: candidate.effectiveDate,
      detected_at: candidate.detectedAt,
      card,
      due_date: dueDate ? dueDate.toISOString().slice(0, 10) : null,
    });
  }

  alerts.sort(compareAlerts);

  return {
    change_events_found: changeEvents.length,
    applicable_count: applicableCount,
    projected_count: alerts.length,
    skipped_due_to_cap: skipped,
    alerts,
  };
}
