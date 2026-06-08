import { describe, expect, it } from 'vitest';
import {
  bucketize,
  mergeJsonl,
  summarize,
  type PayloadBucket,
} from './payload';
import type {
  PublishInstrumentRow,
  PublishObligationRow,
  PublishSourceRow,
} from '../db/publish';

function obligation(
  canonical: string,
  bucket: string,
  instrumentId: string,
  sourceId: string,
  confidence = 0.95
): PublishObligationRow {
  const [j, d] = bucket.split('/');
  return {
    canonical_id: canonical,
    instrument_id: instrumentId,
    section: null,
    type: 'filing',
    summary: 'test',
    applicability_conditions: [],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 3, day: 31 },
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: sourceId, citation_span: 'p.1' }],
    version: '1',
    confidence,
    extracted_at: '2026-06-05T00:00:00.000Z',
    bucket_jurisdiction: j!,
    bucket_domain: d!,
  };
}

function instrument(id: string, jurisdiction: string): PublishInstrumentRow {
  return {
    id,
    type: 'Rule',
    title: id,
    jurisdiction,
    citation: id,
  };
}

function source(id: string, bucket: string): PublishSourceRow {
  const [j, d] = bucket.split('/');
  return {
    id,
    jurisdiction: j!,
    domain: d!,
    url: `https://example.gov.in/${id}.pdf`,
    fetch_recipe: { kind: 'static-url' },
    trust_tier: 'govt-portal',
    last_seen: '2026-06-04T00:00:00.000Z',
    content_hash: 'h',
  };
}

describe('bucketize', () => {
  it('partitions obligations by (jurisdiction, domain) and pulls in referenced rows', () => {
    const obs = [
      obligation('IN-KA/x|s|filing', 'IN-KA/labour', 'IN-KA/x', 'src1'),
      obligation('IN-KA/x|t|filing', 'IN-KA/labour', 'IN-KA/x', 'src1'),
      obligation('IN-MH/y|s|filing', 'IN-MH/labour', 'IN-MH/y', 'src2'),
    ];
    const inst = [instrument('IN-KA/x', 'IN-KA'), instrument('IN-MH/y', 'IN-MH')];
    const srcs = [source('src1', 'IN-KA/labour'), source('src2', 'IN-MH/labour')];

    const buckets = bucketize(obs, inst, srcs);
    expect(buckets).toHaveLength(2);
    const ka = buckets.find((b) => b.jurisdiction === 'IN-KA')!;
    expect(ka.obligations).toHaveLength(2);
    expect(ka.instruments).toHaveLength(1);
    expect(ka.sources).toHaveLength(1);
  });

  it('returns an empty array when no obligations are passed', () => {
    expect(bucketize([], [], [])).toEqual([]);
  });
});

describe('mergeJsonl', () => {
  it('dedupes by id field and replaces existing rows', () => {
    const existing = `${JSON.stringify({ id: 'a', n: 1 })}\n${JSON.stringify({
      id: 'b',
      n: 2,
    })}\n`;
    const merged = mergeJsonl(
      existing,
      [
        { id: 'b', n: 22 },
        { id: 'c', n: 3 },
      ],
      'id'
    );
    const parsed = merged
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { id: string; n: number });
    expect(parsed).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 22 },
      { id: 'c', n: 3 },
    ]);
  });

  it('sorts the output by id for stable diffs', () => {
    const merged = mergeJsonl(
      '',
      [
        { id: 'z' },
        { id: 'a' },
        { id: 'm' },
      ],
      'id'
    );
    const ids = merged
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { id: string }).id);
    expect(ids).toEqual(['a', 'm', 'z']);
  });

  it('survives unparseable existing lines (skips them silently)', () => {
    const merged = mergeJsonl('not-json\n{"id":"a"}\nalso-not-json\n', [], 'id');
    expect(merged.trim()).toBe('{"id":"a"}');
  });
});

describe('summarize', () => {
  it('reports counts, jurisdictions, confidence range, and unique source URLs', () => {
    const buckets: PayloadBucket[] = [
      {
        jurisdiction: 'IN-KA',
        domain: 'labour',
        obligations: [
          obligation('IN-KA/x|a|filing', 'IN-KA/labour', 'IN-KA/x', 'src1', 0.9),
          obligation('IN-KA/x|b|filing', 'IN-KA/labour', 'IN-KA/x', 'src1', 0.95),
        ],
        instruments: [instrument('IN-KA/x', 'IN-KA')],
        sources: [source('src1', 'IN-KA/labour')],
      },
    ];
    const s = summarize(buckets);
    expect(s.buckets).toBe(1);
    expect(s.obligations).toBe(2);
    expect(s.instruments).toBe(1);
    expect(s.sources).toBe(1);
    expect(s.jurisdictions).toEqual(['IN-KA']);
    expect(s.domains).toEqual(['labour']);
    expect(s.confidence.min).toBe(0.9);
    expect(s.confidence.max).toBe(0.95);
    expect(s.confidence.avg).toBe(0.925);
    expect(s.source_urls).toEqual(['https://example.gov.in/src1.pdf']);
  });

  it('handles empty input', () => {
    const s = summarize([]);
    expect(s.obligations).toBe(0);
    expect(s.confidence).toEqual({ min: 0, max: 0, avg: 0 });
  });
});
