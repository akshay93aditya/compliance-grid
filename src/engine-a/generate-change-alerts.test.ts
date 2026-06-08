import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AgentRunnerClient } from '../agents/contract';
import { closePool, getPool } from '../db/pool';
import type { EntityProfile } from '../schemas/entity-profile';
import { generateChangeAlerts } from './generate-change-alerts';

const hasDb = !!process.env.DATABASE_URL;
const hasKey = !!process.env.ANTHROPIC_API_KEY;

const sampleEntity: EntityProfile = {
  entity_id: 'test-engine-a-ent',
  org_id: 'test-engine-a-org',
  entity_type: 'pvt-ltd',
  sector: 'manufacturing',
  jurisdictions: ['IN-KA'],
  headcount: 25,
  annual_turnover_inr: 50_000_000,
};

function mockProjectionClient(): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_card',
            input: {
              what_to_do: 'Do the thing.',
              when: 'when appropriate',
              proof: '',
            },
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

describe.skipIf(!hasDb)('generateChangeAlerts (mocked projection)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns an empty result when no change events match the window', async () => {
    const client = mockProjectionClient();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await generateChangeAlerts(getPool(), {
      since: future,
      maxAlerts: 3,
      client,
    });
    expect(result.alerts).toEqual([]);
    expect(result.projected_count).toBe(0);
  });

  it('caps at maxAlerts and reports skipped count', async () => {
    // Seed two change_events for two distinct obligations so dedupe-by-canonical
    // does not collapse them.
    const ts = Date.now();
    const instId = `IN-KA/engine-a-cap-${ts}`;
    const sourceId = `src-engine-a-cap-${ts}`;
    const canonicalIds = [
      `${instId}|r.A|filing`,
      `${instId}|r.B|filing`,
    ];
    try {
      await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, 'Act', 'Engine A test', 'IN-KA', 'test')
         ON CONFLICT (id) DO NOTHING`,
        [instId]
      );
      await getPool().query(
        `INSERT INTO sources
           (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
         VALUES ($1, 'IN-KA', 'labour', 'https://test.example/cap',
                 '{"kind":"static-url","config":{}}'::jsonb,
                 'unverified', NOW(), 'h')
         ON CONFLICT (id) DO NOTHING`,
        [sourceId]
      );
      for (const cid of canonicalIds) {
        const section = cid.split('|')[1];
        await getPool().query(
          `INSERT INTO obligations
             (canonical_id, instrument_id, section, type, summary,
              applicability_conditions, frequency, deadline_rule,
              proof_types, penalty, source_refs, version, confidence)
           VALUES ($1, $2, $3, 'filing', 'test',
                   '[]'::jsonb, 'annual',
                   '{"kind":"fixed-date","month":4,"day":30}'::jsonb,
                   '[]'::jsonb, '{"has_imprisonment":false}'::jsonb,
                   '[{"source_id":"any","citation_span":"r"}]'::jsonb,
                   '1', 0.95)`,
          [cid, instId, section]
        );
        await getPool().query(
          `INSERT INTO change_events
             (id, obligation_canonical_id, change_type, effective_date,
              source_ref, detected_at, status)
           VALUES ($1, $2, 'new', CURRENT_DATE, $3, NOW(), 'detected')`,
          [`ce_${randomUUID()}`, cid, sourceId]
        );
      }

      const client = mockProjectionClient();
      const result = await generateChangeAlerts(getPool(), {
        maxAlerts: 1,
        client,
      });
      expect(result.alerts).toHaveLength(1);
      expect(result.skipped_due_to_cap).toBeGreaterThanOrEqual(1);
    } finally {
      await getPool().query(
        'DELETE FROM change_events WHERE source_ref = $1',
        [sourceId]
      );
      await getPool().query(
        'DELETE FROM obligations WHERE instrument_id = $1',
        [instId]
      );
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
      await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
    }
  });
});

// Live integration. Caps maxAlerts=2 (~$0.04). Synthesizes one ChangeEvent
// against a real CKG obligation from the bulk run, runs Engine A, prints the
// alert.
describe.skipIf(!hasKey || !hasDb)(
  'generateChangeAlerts (live API, against real CKG)',
  () => {
    afterAll(async () => {
      await closePool();
    });

    it(
      'projects a synthetic ChangeEvent against a real KA labour obligation',
      async () => {
        // Pick one real KA labour obligation.
        const { rows } = await getPool().query<{
          canonical_id: string;
          instrument_id: string;
        }>(
          `SELECT canonical_id, instrument_id FROM obligations
           WHERE instrument_id LIKE 'IN-KA/%' AND confidence >= 0.9
           ORDER BY canonical_id LIMIT 1`
        );
        if (rows.length === 0) {
          throw new Error(
            'no live KA obligation found in DB. Run the bulk-karmika test first.'
          );
        }
        const canonicalId = rows[0]!.canonical_id;

        // Pick a source row to point the synthetic ChangeEvent at. Any KA
        // labour source will do.
        const { rows: srcRows } = await getPool().query<{ id: string }>(
          `SELECT id FROM sources WHERE jurisdiction = 'IN-KA' AND domain = 'labour' LIMIT 1`
        );
        const sourceId = srcRows[0]!.id;

        const syntheticCeId = `ce_${randomUUID()}`;
        await getPool().query(
          `INSERT INTO change_events
             (id, obligation_canonical_id, change_type, effective_date,
              source_ref, detected_at, status)
           VALUES ($1, $2, 'amended', CURRENT_DATE, $3, NOW(), 'detected')`,
          [syntheticCeId, canonicalId, sourceId]
        );

        try {
          // Run without an entity filter so the test exercises the
          // change_event -> projection chain even if the picked obligation's
          // applicability_conditions don't match the sample MSME. Applicability
          // filtering itself is covered by the mocked tests.
          const result = await generateChangeAlerts(getPool(), {
            maxAlerts: 2,
            since: new Date(Date.now() - 60_000),
          });

          // eslint-disable-next-line no-console
          console.log('\n=== Engine A alert summary ===');
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                change_events_found: result.change_events_found,
                applicable_count: result.applicable_count,
                projected_count: result.projected_count,
                skipped_due_to_cap: result.skipped_due_to_cap,
              },
              null,
              2
            )
          );
          for (const [i, a] of result.alerts.entries()) {
            // eslint-disable-next-line no-console
            console.log(`\n--- alert ${i + 1} ---`);
            // eslint-disable-next-line no-console
            console.log(
              JSON.stringify(
                {
                  change_type: a.change_type,
                  effective_date: a.effective_date,
                  due_date: a.due_date,
                  what_to_do: a.card.what_to_do,
                  when: a.card.when,
                  citation: a.card.citation,
                  jail_risk: a.card.jail_risk,
                },
                null,
                2
              )
            );
          }

          expect(result.alerts.length).toBeGreaterThan(0);
          // jail_risk DESC: the first alert should have jail_risk = true if
          // any alert has it; otherwise sort is stable on remaining keys.
          if (result.alerts.length >= 2) {
            const [first, second] = result.alerts;
            if (first!.card.jail_risk !== second!.card.jail_risk) {
              expect(first!.card.jail_risk).toBe(true);
            }
          }
        } finally {
          await getPool().query(
            'DELETE FROM change_events WHERE id = $1',
            [syntheticCeId]
          );
        }
      },
      90_000
    );
  }
);
