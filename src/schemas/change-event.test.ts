import { describe, expect, it } from 'vitest';
import { ChangeEvent } from './change-event';

describe('ChangeEvent', () => {
  const base = {
    id: 'ce-1',
    obligation_ref: 'IN-KA/labour/factories-form-25/v1',
    change_type: 'amended',
    effective_date: '2026-04-01',
    source_ref: 's-gazette-001',
    detected_at: '2026-03-15T08:30:00Z',
    status: 'detected',
  };

  it('accepts a valid ChangeEvent', () => {
    const parsed = ChangeEvent.parse(base);
    expect(parsed.change_type).toBe('amended');
    expect(parsed.status).toBe('detected');
  });

  it('accepts every defined change_type', () => {
    for (const ct of [
      'new',
      'amended',
      'superseded',
      'repealed',
      'clarified',
    ]) {
      const parsed = ChangeEvent.parse({ ...base, change_type: ct });
      expect(parsed.change_type).toBe(ct);
    }
  });

  it('accepts every defined status', () => {
    for (const s of [
      'detected',
      'verification-pending',
      'confirmed',
      'propagated',
      'dismissed',
    ]) {
      const parsed = ChangeEvent.parse({ ...base, status: s });
      expect(parsed.status).toBe(s);
    }
  });

  it('rejects unknown change_type', () => {
    expect(() =>
      ChangeEvent.parse({ ...base, change_type: 'rewritten' })
    ).toThrow();
  });

  it('rejects unknown status', () => {
    expect(() => ChangeEvent.parse({ ...base, status: 'reviewed' })).toThrow();
  });

  it('rejects an effective_date that is not ISO date format', () => {
    expect(() =>
      ChangeEvent.parse({ ...base, effective_date: '2026/04/01' })
    ).toThrow();
  });

  it('rejects a detected_at that is not ISO datetime format', () => {
    expect(() =>
      ChangeEvent.parse({ ...base, detected_at: '2026-03-15' })
    ).toThrow();
  });
});
