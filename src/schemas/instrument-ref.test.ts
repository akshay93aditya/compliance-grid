import { describe, expect, it } from 'vitest';
import { InstrumentRef } from './instrument-ref';

describe('InstrumentRef', () => {
  it('accepts a whole-instrument reference (no section)', () => {
    const parsed = InstrumentRef.parse({ instrument_id: 'IN/companies-act-2013' });
    expect(parsed.instrument_id).toBe('IN/companies-act-2013');
    expect(parsed.section).toBeUndefined();
  });

  it('accepts a section-level reference', () => {
    const parsed = InstrumentRef.parse({
      instrument_id: 'IN/companies-act-2013',
      section: 's.134',
    });
    expect(parsed.section).toBe('s.134');
  });

  it('rejects an empty instrument_id', () => {
    expect(() => InstrumentRef.parse({ instrument_id: '' })).toThrow();
  });

  it('rejects an empty section string when provided', () => {
    expect(() =>
      InstrumentRef.parse({ instrument_id: 'x', section: '' })
    ).toThrow();
  });
});
