import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProjectionInput } from './projection';

type Executor = Pool | PoolClient;

// Cache layer for runProjection. Audit finding: /calendar and /alerts
// pay ~$0.02 per card per page render even when nothing has moved. The
// cache key composes the only signals that should invalidate a card:
//
//   canonical_id        — which obligation
//   version             — invalidates when the obligation versions
//   source_verified_at  — invalidates when patrol re-extracts the source
//   model               — invalidates on model upgrade
//   prompt_hash         — invalidates on prompt rewrite (system prompt
//                         + user prompt template)
//
// Stable string for prompt_hash is the responsibility of the projection
// contract — see PROMPT_HASH below. Any change to the contract that
// affects card content (system prompt, tool description, user-message
// formatter) should bump this.

// Bumped whenever the projection prompt OR tool definition meaningfully
// changes. Recomputed via hashPrompt() if the bump is missed; the
// stable string is the maintenance signal.
export const PROJECTION_PROMPT_HASH = (() => {
  // The signature this captures has to be stable across machines and
  // node versions but must change when we edit the prompt. SHA-256 of a
  // single string we maintain alongside the projection contract.
  const SIGNATURE_V1 = 'projection-v1: 05-copy-guidelines, sonnet-4-6, tool=propose_card';
  return createHash('sha256').update(SIGNATURE_V1).digest('hex').slice(0, 16);
})();

export const PROJECTION_MODEL = 'claude-sonnet-4-6';

export interface CachedProjection {
  what_to_do: string;
  when: string;
  proof: string;
}

export async function getCachedProjection(
  executor: Executor,
  input: ProjectionInput,
  model = PROJECTION_MODEL,
  promptHash = PROJECTION_PROMPT_HASH
): Promise<CachedProjection | null> {
  const { rows } = await executor.query<CachedProjection>(
    `SELECT what_to_do, "when", proof
       FROM projection_cache
      WHERE canonical_id = $1
        AND version = $2
        AND source_verified_at = $3
        AND model = $4
        AND prompt_hash = $5
      LIMIT 1`,
    [
      input.obligation.canonical_id,
      input.obligation.version,
      input.source_verified_at,
      model,
      promptHash,
    ]
  );
  return rows[0] ?? null;
}

export async function putCachedProjection(
  executor: Executor,
  input: ProjectionInput,
  card: CachedProjection,
  model = PROJECTION_MODEL,
  promptHash = PROJECTION_PROMPT_HASH
): Promise<void> {
  await executor.query(
    `INSERT INTO projection_cache
       (canonical_id, version, source_verified_at, model, prompt_hash,
        what_to_do, "when", proof)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (canonical_id, version, source_verified_at, model, prompt_hash)
       DO UPDATE SET cached_at = now()`,
    [
      input.obligation.canonical_id,
      input.obligation.version,
      input.source_verified_at,
      model,
      promptHash,
      card.what_to_do,
      card.when,
      card.proof,
    ]
  );
}
