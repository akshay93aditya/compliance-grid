import { describe, expect, it, vi } from 'vitest';
import type { Obligation } from '../schemas/obligation';
import type { Instrument } from '../schemas/instrument';
import type { AgentRunnerClient } from './contract';
import {
  buildCitation,
  buildConfidenceLabel,
  buildFreshnessLabel,
  type ProjectionInput,
  runProjection,
} from './projection';

function mockClient(payload: unknown): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_card',
            input: payload,
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

const sampleInstrument: Instrument = {
  id: 'IN-KA/factories-rules-1969',
  type: 'Rule',
  title: 'The Karnataka Factories Rules, 1969',
  jurisdiction: 'IN-KA',
  citation: 'Karnataka Notification 1969',
};

const sampleObligation: Obligation = {
  canonical_id: 'IN-KA/factories-rules-1969|r.105|filing',
  instrument_ref: {
    instrument_id: 'IN-KA/factories-rules-1969',
    section: 'r.105',
  },
  type: 'filing',
  summary:
    'Every occupier of a factory shall submit, in Form 25, an annual return to the Chief Inspector by the 31st day of January each year.',
  applicability_conditions: [
    { field: 'sector', op: 'eq', value: 'manufacturing' },
  ],
  frequency: 'annual',
  deadline_rule: { kind: 'fixed-date', month: 1, day: 31 },
  proof_types: ['filed-form-25'],
  penalty: { has_imprisonment: false, fine_inr: { min: 0, max: 10_000 } },
  source_refs: [{ source_id: 'src-1', citation_span: 'section:r-105' }],
  version: '1',
  confidence: 0.97,
};

function makeInput(
  overrides: Partial<ProjectionInput> = {}
): ProjectionInput {
  return {
    obligation: sampleObligation,
    instrument: sampleInstrument,
    source_verified_at: '2026-05-28T10:00:00Z',
    ...overrides,
  };
}

describe('buildCitation', () => {
  it('includes the section when provided', () => {
    expect(buildCitation(makeInput())).toBe(
      'Source: The Karnataka Factories Rules, 1969 (r.105)'
    );
  });

  it('omits the section parenthetical for whole-instrument obligations', () => {
    const input = makeInput({
      obligation: {
        ...sampleObligation,
        instrument_ref: { instrument_id: sampleObligation.instrument_ref.instrument_id },
      },
    });
    expect(buildCitation(input)).toBe(
      'Source: The Karnataka Factories Rules, 1969'
    );
  });
});

describe('buildFreshnessLabel', () => {
  it('extracts the YYYY-MM-DD date from an ISO datetime', () => {
    expect(buildFreshnessLabel('2026-05-28T10:00:00Z')).toBe(
      'Verified by the Compliance Grid pipeline on 2026-05-28'
    );
  });
});

describe('buildConfidenceLabel', () => {
  it('uses the >=0.95 band for high explicit confidence', () => {
    expect(buildConfidenceLabel(0.97)).toBe(
      'High confidence: explicit in the source'
    );
    expect(buildConfidenceLabel(0.95)).toBe(
      'High confidence: explicit in the source'
    );
  });

  it('uses the 0.9-0.95 band for high-with-inference', () => {
    expect(buildConfidenceLabel(0.93)).toBe(
      'High confidence, with minor inference'
    );
    expect(buildConfidenceLabel(0.9)).toBe(
      'High confidence, with minor inference'
    );
  });

  it('uses the 0.8-0.9 band for moderate confidence', () => {
    expect(buildConfidenceLabel(0.85)).toBe(
      'Moderate confidence, some inference required'
    );
  });

  it('flags the <0.8 band as under review', () => {
    expect(buildConfidenceLabel(0.5)).toBe(
      'Extracted with significant inference, under review'
    );
  });
});

describe('runProjection (unit, mocked)', () => {
  it('returns a card with AI fields plus wrapper-built deterministic fields', async () => {
    const client = mockClient({
      what_to_do: 'Submit Form 25 to the Chief Inspector.',
      when: 'by 31 January each year',
      proof: "Filed Form 25 with the inspectorate's acknowledgment receipt",
    });
    const card = await runProjection(makeInput(), { client });
    expect(card.obligation_canonical_id).toBe(sampleObligation.canonical_id);
    expect(card.what_to_do).toBe('Submit Form 25 to the Chief Inspector.');
    expect(card.when).toBe('by 31 January each year');
    expect(card.proof).toContain('Form 25');
    expect(card.citation).toBe(
      'Source: The Karnataka Factories Rules, 1969 (r.105)'
    );
    expect(card.freshness_label).toBe(
      'Verified by the Compliance Grid pipeline on 2026-05-28'
    );
    expect(card.confidence_label).toBe(
      'High confidence: explicit in the source'
    );
    expect(card.jail_risk).toBe(false);
  });

  it('flags jail_risk: true when the penalty includes imprisonment', async () => {
    const client = mockClient({
      what_to_do: 'x.',
      when: 'x',
      proof: '',
    });
    const card = await runProjection(
      makeInput({
        obligation: {
          ...sampleObligation,
          penalty: {
            has_imprisonment: true,
            imprisonment_months: { min: 6, max: 24 },
          },
        },
      }),
      { client }
    );
    expect(card.jail_risk).toBe(true);
  });

  it('rejects AI output with an empty what_to_do (schema enforced)', async () => {
    const client = mockClient({
      what_to_do: '',
      when: 'x',
      proof: '',
    });
    await expect(runProjection(makeInput(), { client })).rejects.toThrow();
  });

  it('rejects AI output with an empty when (schema enforced)', async () => {
    const client = mockClient({
      what_to_do: 'x.',
      when: '',
      proof: '',
    });
    await expect(runProjection(makeInput(), { client })).rejects.toThrow();
  });

  it('allows an empty proof string', async () => {
    const client = mockClient({
      what_to_do: 'Notify the registering officer.',
      when: 'within 7 days of any change',
      proof: '',
    });
    const card = await runProjection(makeInput(), { client });
    expect(card.proof).toBe('');
  });

  it('rejects malformed input (bad jurisdiction in instrument)', async () => {
    const client = mockClient({
      what_to_do: 'x.',
      when: 'x',
      proof: '',
    });
    await expect(
      runProjection(
        makeInput({
          instrument: { ...sampleInstrument, jurisdiction: 'us-ca' as never },
        }),
        { client }
      )
    ).rejects.toThrow();
  });
});

// Live integration. Pulls one real Obligation + Instrument + Source from
// the local CKG (the Phase 1.5.5 bulk run left real KA labour data behind)
// and runs Projection against it. Gated on ANTHROPIC_API_KEY + DATABASE_URL.
// One Sonnet call (~$0.02).
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasKey || !hasDb)(
  'runProjection (live API, against real CKG row)',
  () => {
    it(
      'projects a real KA labour obligation into a plain-language card',
      async () => {
        const { getPool, closePool } = await import('../db/pool.js');
        try {
          // Pick one substantive obligation from the bulk run. r.10(2)
          // ("registering officer must issue a Certificate") is a clean
          // imperative the wrapper has shown produces good output.
          const { rows: obligRows } = await getPool().query(
            `SELECT * FROM obligations
             WHERE instrument_id = $1 AND type = 'registration'
             ORDER BY canonical_id LIMIT 1`,
            ['IN-KA/the-occupational-safety-health-working-condition-code-2020-karnataka-rules-2021']
          );
          if (obligRows.length === 0) {
            // Fallback: any high-confidence obligation in the KA labour set.
            const { rows: fallback } = await getPool().query(
              `SELECT * FROM obligations
               WHERE instrument_id LIKE 'IN-KA/%' AND confidence >= 0.9
               ORDER BY confidence DESC LIMIT 1`
            );
            if (fallback.length === 0) {
              throw new Error(
                'no live KA obligation found in DB. Run the bulk-karmika test first.'
              );
            }
            obligRows.push(fallback[0]!);
          }
          const row = obligRows[0]!;
          const obligation = {
            canonical_id: row.canonical_id as string,
            instrument_ref: {
              instrument_id: row.instrument_id as string,
              ...(row.section ? { section: row.section as string } : {}),
            },
            type: row.type as string,
            summary: row.summary as string,
            applicability_conditions: row.applicability_conditions,
            frequency: row.frequency as string,
            deadline_rule: row.deadline_rule,
            proof_types: row.proof_types,
            penalty: row.penalty,
            source_refs: row.source_refs,
            version: row.version as string,
            confidence: row.confidence as number,
          };

          // Load the parent instrument.
          const { rows: instRows } = await getPool().query(
            `SELECT id, type, title, jurisdiction, citation
             FROM instruments WHERE id = $1`,
            [obligation.instrument_ref.instrument_id]
          );
          const instrument = instRows[0]!;

          // Load any matching source (just pick first; for freshness label).
          const { rows: srcRows } = await getPool().query(
            `SELECT last_seen::text AS last_seen
             FROM sources
             WHERE jurisdiction = 'IN-KA' AND domain = 'labour'
             ORDER BY last_seen DESC LIMIT 1`
          );
          const sourceVerifiedAt = (srcRows[0]?.last_seen ??
            '2026-05-28T00:00:00Z') as string;

          const card = await runProjection({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            obligation: obligation as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            instrument: instrument as any,
            source_verified_at: new Date(sourceVerifiedAt).toISOString(),
          });

          // eslint-disable-next-line no-console
          console.log('\n=== Projection card (real CKG row) ===');
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(card, null, 2));

          expect(card.obligation_canonical_id).toBe(obligation.canonical_id);
          expect(card.what_to_do.length).toBeGreaterThan(0);
          expect(card.when.length).toBeGreaterThan(0);
          expect(card.citation).toContain(instrument.title);
          expect(card.freshness_label).toMatch(/^Verified by the Compliance Grid pipeline on \d{4}-\d{2}-\d{2}$/);
          expect(typeof card.jail_risk).toBe('boolean');
          // Plain-language guard: no em-dash in AI fields.
          expect(card.what_to_do).not.toMatch(/—/);
          expect(card.when).not.toMatch(/—/);
          expect(card.proof).not.toMatch(/—/);
        } finally {
          await closePool();
        }
      },
      60_000
    );
  }
);
