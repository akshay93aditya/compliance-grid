import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonicalize';

describe('canonicalize', () => {
  it('mints a canonical_id for a whole-instrument obligation (no section)', () => {
    expect(
      canonicalize({
        instrument_id: 'IN/companies-act-2013',
        type: 'filing',
      })
    ).toBe('IN/companies-act-2013||filing');
  });

  it('mints a canonical_id for a section-specific obligation', () => {
    expect(
      canonicalize({
        instrument_id: 'IN-KA/factories-rules-1969',
        section: 'r.105',
        type: 'filing',
      })
    ).toBe('IN-KA/factories-rules-1969|r.105|filing');
  });

  it('treats explicit null section the same as undefined', () => {
    const withUndef = canonicalize({
      instrument_id: 'IN/x',
      section: undefined,
      type: 'registration',
    });
    const withNull = canonicalize({
      instrument_id: 'IN/x',
      section: null,
      type: 'registration',
    });
    expect(withUndef).toBe(withNull);
  });

  it('is deterministic across calls', () => {
    const input = {
      instrument_id: 'IN-AP/labour-rules',
      section: 's.5(a)',
      type: 'record-keeping' as const,
    };
    expect(canonicalize(input)).toBe(canonicalize(input));
  });

  it('distinguishes obligations that differ only in section', () => {
    const base = { instrument_id: 'IN/companies-act-2013', type: 'filing' as const };
    expect(canonicalize({ ...base, section: 's.134' })).not.toBe(
      canonicalize({ ...base, section: 's.135' })
    );
  });

  it('distinguishes obligations that differ only in type', () => {
    const base = {
      instrument_id: 'IN-KA/factories-rules-1969',
      section: 'r.105',
    };
    expect(canonicalize({ ...base, type: 'filing' })).not.toBe(
      canonicalize({ ...base, type: 'registration' })
    );
  });

  it('throws on empty instrument_id', () => {
    expect(() =>
      canonicalize({ instrument_id: '', type: 'filing' })
    ).toThrow();
  });
});
