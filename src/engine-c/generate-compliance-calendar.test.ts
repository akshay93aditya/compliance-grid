import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AgentRunnerClient } from '../agents/contract';
import { closePool, getPool } from '../db/pool';
import type { EntityProfile } from '../schemas/entity-profile';
import { generateComplianceCalendar } from './generate-compliance-calendar';

const hasDb = !!process.env.DATABASE_URL;
const hasKey = !!process.env.ANTHROPIC_API_KEY;

const sampleEntity: EntityProfile = {
  entity_id: 'test-ent-1',
  org_id: 'test-org-1',
  entity_type: 'pvt-ltd',
  sector: 'manufacturing',
  jurisdictions: ['IN-KA'],
  headcount: 25,
  annual_turnover_inr: 50_000_000,
  incorporation_date: '2020-06-01',
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
              when: 'at the appropriate time',
              proof: '',
            },
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

describe.skipIf(!hasDb)('generateComplianceCalendar (mocked projection)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns a summary including cap-skipped count', async () => {
    const client = mockProjectionClient();
    const result = await generateComplianceCalendar(getPool(), {
      entity: sampleEntity,
      maxObligations: 2,
      client,
    });
    expect(result.loaded_obligation_count).toBeGreaterThanOrEqual(
      result.applicable_obligation_count
    );
    expect(result.applicable_obligation_count).toBeGreaterThanOrEqual(
      result.projected_card_count
    );
    expect(result.cards.length).toBeLessThanOrEqual(2);
    expect(result.cards.length).toBe(result.projected_card_count);
    // Every card carries a due_date string-or-null.
    for (const entry of result.cards) {
      expect(entry.card.what_to_do).toBe('Do the thing.');
      expect(
        entry.due_date === null || /^\d{4}-\d{2}-\d{2}$/.test(entry.due_date)
      ).toBe(true);
    }
  });

  it('returns empty cards when there are no applicable obligations', async () => {
    // A wildly mismatched entity that no real KA obligation will apply to.
    const noMatch: EntityProfile = {
      ...sampleEntity,
      sector: 'a-sector-that-no-applicability-condition-matches',
    };
    const client = mockProjectionClient();
    const result = await generateComplianceCalendar(getPool(), {
      entity: noMatch,
      instrumentIds: ['IN-KA/this-instrument-does-not-exist'],
      client,
    });
    expect(result.loaded_obligation_count).toBe(0);
    expect(result.cards).toEqual([]);
  });
});

// Live integration. Requires API key + DB. Caps at maxObligations=5 (≈$0.10).
describe.skipIf(!hasKey || !hasDb)(
  'generateComplianceCalendar (live API, real CKG)',
  () => {
    afterAll(async () => {
      await closePool();
    });

    it(
      'generates a compliance calendar for a synthetic KA manufacturing MSME',
      async () => {
        const result = await generateComplianceCalendar(getPool(), {
          entity: sampleEntity,
          maxObligations: 5,
          reference_date: new Date('2026-06-01T00:00:00Z'),
        });

        // eslint-disable-next-line no-console
        console.log('\n=== Compliance calendar for sample MSME ===');
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              loaded_obligation_count: result.loaded_obligation_count,
              applicable_obligation_count: result.applicable_obligation_count,
              projected_card_count: result.projected_card_count,
              skipped_due_to_cap: result.skipped_due_to_cap,
            },
            null,
            2
          )
        );
        for (const [i, entry] of result.cards.entries()) {
          // eslint-disable-next-line no-console
          console.log(`\n--- card ${i + 1} ---`);
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                due_date: entry.due_date,
                what_to_do: entry.card.what_to_do,
                when: entry.card.when,
                proof: entry.card.proof,
                citation: entry.card.citation,
                confidence_label: entry.card.confidence_label,
                jail_risk: entry.card.jail_risk,
              },
              null,
              2
            )
          );
        }

        expect(result.projected_card_count).toBeGreaterThan(0);
        expect(result.projected_card_count).toBeLessThanOrEqual(5);
        for (const entry of result.cards) {
          expect(entry.card.what_to_do.length).toBeGreaterThan(0);
          expect(entry.card.citation.startsWith('Source: ')).toBe(true);
          expect(entry.card.what_to_do).not.toMatch(/—/);
        }
      },
      120_000
    );
  }
);
