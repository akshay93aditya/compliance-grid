import { describe, expect, it, vi } from 'vitest';
import type { AgentRunnerClient } from './contract';
import { type ExtractionInput, runExtraction } from './extraction';

function mockClient(payload: unknown): AgentRunnerClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_obligations',
            input: payload,
          },
        ],
        stop_reason: 'tool_use',
      }),
    },
  } as unknown as AgentRunnerClient;
}

const baseInput: ExtractionInput = {
  source_id: 'src-1',
  instrument: {
    id: 'IN-KA/factories-rules-1969',
    title: 'The Karnataka Factories Rules, 1969',
    type: 'Rule',
    jurisdiction: 'IN-KA',
  },
  segment: {
    anchor: 'section:r-105',
    text: 'Section 105. Annual return. Every occupier of a factory shall submit, in Form 25, an annual return to the Chief Inspector by the 31st day of January each year.',
  },
};

function makeExtracted(overrides: Record<string, unknown> = {}) {
  return {
    section: 'r.105',
    type: 'filing',
    summary: 'File Form 25 annual return with the Chief Inspector by 31 January each year.',
    applicability_conditions: [
      { field: 'sector', op: 'eq', value: 'manufacturing' },
    ],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 1, day: 31 },
    proof_types: ['filed-form-25'],
    penalty: { has_imprisonment: false, fine_inr: { min: 0, max: 10_000 } },
    citation_span: 'section:r-105',
    confidence: 0.95,
    ...overrides,
  };
}

describe('runExtraction (unit, mocked)', () => {
  it('returns ObligationCandidates with wrapper-injected instrument_ref and source_refs', async () => {
    const client = mockClient({ obligations: [makeExtracted()] });
    const result = await runExtraction(baseInput, { client });

    expect(result.raw_count).toBe(1);
    expect(result.candidates).toHaveLength(1);
    const o = result.candidates[0]!;
    expect(o.instrument_ref.instrument_id).toBe('IN-KA/factories-rules-1969');
    expect(o.instrument_ref.section).toBe('r.105');
    expect(o.source_refs).toHaveLength(1);
    expect(o.source_refs[0]!.source_id).toBe('src-1');
    expect(o.source_refs[0]!.citation_span).toBe('section:r-105');
    expect(o.type).toBe('filing');
    expect(o.frequency).toBe('annual');
  });

  it('omits section in instrument_ref when AI returns no section', async () => {
    const client = mockClient({
      obligations: [makeExtracted({ section: undefined })],
    });
    const result = await runExtraction(baseInput, { client });
    expect(result.candidates[0]!.instrument_ref.section).toBeUndefined();
  });

  it('returns an empty candidates list when AI returns no obligations', async () => {
    const client = mockClient({ obligations: [] });
    const result = await runExtraction(baseInput, { client });
    expect(result.raw_count).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('rejects AI output with an unknown obligation type', async () => {
    const client = mockClient({
      obligations: [makeExtracted({ type: 'enforcement' })],
    });
    await expect(runExtraction(baseInput, { client })).rejects.toThrow();
  });

  it('rejects AI output with confidence out of range', async () => {
    const client = mockClient({
      obligations: [makeExtracted({ confidence: 1.5 })],
    });
    await expect(runExtraction(baseInput, { client })).rejects.toThrow();
  });

  it('rejects AI output with an empty citation_span', async () => {
    const client = mockClient({
      obligations: [makeExtracted({ citation_span: '' })],
    });
    await expect(runExtraction(baseInput, { client })).rejects.toThrow();
  });

  it('rejects AI output with an invalid deadline_rule discriminator', async () => {
    const client = mockClient({
      obligations: [
        makeExtracted({ deadline_rule: { kind: 'someday', days: 30 } }),
      ],
    });
    await expect(runExtraction(baseInput, { client })).rejects.toThrow();
  });

  it('returns multiple candidates from a multi-obligation segment', async () => {
    const client = mockClient({
      obligations: [
        makeExtracted({ citation_span: 'section:r-105(1)' }),
        makeExtracted({
          type: 'record-keeping',
          summary: 'Maintain attendance register.',
          frequency: 'monthly',
          citation_span: 'section:r-105(2)',
        }),
      ],
    });
    const result = await runExtraction(baseInput, { client });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.type)).toEqual(['filing', 'record-keeping']);
  });

  it('rejects malformed input (empty source_id)', async () => {
    const client = mockClient({ obligations: [] });
    await expect(
      runExtraction({ ...baseInput, source_id: '' }, { client })
    ).rejects.toThrow();
  });

  it('rejects malformed input (bad jurisdiction format)', async () => {
    const client = mockClient({ obligations: [] });
    await expect(
      runExtraction(
        { ...baseInput, instrument: { ...baseInput.instrument, jurisdiction: 'us-ca' as never } },
        { client }
      )
    ).rejects.toThrow();
  });
});

// Live integration. Skipped unless ANTHROPIC_API_KEY is set. One Sonnet 4.6
// call (~3k input + ~1.5k output tokens, well under a cent at v1 rates).
const hasKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasKey)('runExtraction (integration, live API)', () => {
  it(
    'extracts a filing obligation from a synthetic KA factories rule',
    async () => {
      const result = await runExtraction(baseInput);
      // eslint-disable-next-line no-console
      console.log(
        '\nExtraction (KA factories r.105) returned:',
        JSON.stringify(result, null, 2)
      );
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      const o = result.candidates[0]!;
      expect(o.instrument_ref.instrument_id).toBe('IN-KA/factories-rules-1969');
      expect(o.source_refs[0]!.source_id).toBe('src-1');
      expect(o.source_refs[0]!.citation_span).toMatch(/r[\.-]?105/i);
      // Filing is the obvious classification for "submit Form 25".
      expect(o.type).toBe('filing');
      // Annual is explicit in the text.
      expect(o.frequency).toBe('annual');
      // The text says "fine ... ten thousand rupees", no imprisonment.
      expect(o.penalty.has_imprisonment).toBe(false);
    },
    60_000
  );
});
