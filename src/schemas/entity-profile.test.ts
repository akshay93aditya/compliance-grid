import { describe, expect, it } from 'vitest';
import { EntityProfile } from './entity-profile';

describe('EntityProfile', () => {
  const base = {
    entity_id: 'e1',
    org_id: 'o1',
    entity_type: 'pvt-ltd',
    sector: 'manufacturing',
    jurisdictions: ['IN-KA'],
    headcount: 25,
    annual_turnover_inr: 50_000_000,
  };

  it('accepts a minimal valid profile', () => {
    const parsed = EntityProfile.parse(base);
    expect(parsed.entity_type).toBe('pvt-ltd');
  });

  it('accepts all optional fields when valid', () => {
    const parsed = EntityProfile.parse({
      ...base,
      incorporation_date: '2020-06-01',
      registered_state: 'IN-KA',
      pan: 'ABCDE1234F',
      gstin: '29ABCDE1234F1Z5',
    });
    expect(parsed.pan).toBe('ABCDE1234F');
    expect(parsed.gstin).toBe('29ABCDE1234F1Z5');
  });

  it('rejects unknown entity_type', () => {
    expect(() =>
      EntityProfile.parse({ ...base, entity_type: 'corporation' })
    ).toThrow();
  });

  it('rejects an empty jurisdictions array', () => {
    expect(() =>
      EntityProfile.parse({ ...base, jurisdictions: [] })
    ).toThrow();
  });

  it('rejects negative headcount', () => {
    expect(() => EntityProfile.parse({ ...base, headcount: -1 })).toThrow();
  });

  it('rejects non-integer headcount', () => {
    expect(() => EntityProfile.parse({ ...base, headcount: 25.5 })).toThrow();
  });

  it('rejects an invalid PAN (lowercase)', () => {
    expect(() =>
      EntityProfile.parse({ ...base, pan: 'abcde1234f' })
    ).toThrow();
  });

  it('rejects an invalid PAN (wrong length)', () => {
    expect(() =>
      EntityProfile.parse({ ...base, pan: 'ABCDE1234' })
    ).toThrow();
  });

  it('rejects an invalid GSTIN (wrong length)', () => {
    expect(() =>
      EntityProfile.parse({ ...base, gstin: '29ABCDE1234F1Z' })
    ).toThrow();
  });
});
