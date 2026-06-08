import { describe, expect, it } from 'vitest';
import { Instrument } from './instrument';

describe('Instrument', () => {
  it('accepts a valid national Act', () => {
    const parsed = Instrument.parse({
      id: 'IN/companies-act-2013',
      type: 'Act',
      title: 'The Companies Act, 2013',
      jurisdiction: 'IN',
      citation: 'Act No. 18 of 2013',
    });
    expect(parsed.type).toBe('Act');
    expect(parsed.jurisdiction).toBe('IN');
  });

  it('accepts Rule and Notification types', () => {
    const base = {
      id: 'IN-KA/test',
      title: 'Test',
      jurisdiction: 'IN-KA',
      citation: 'cit',
    };
    expect(Instrument.parse({ ...base, type: 'Rule' }).type).toBe('Rule');
    expect(Instrument.parse({ ...base, type: 'Notification' }).type).toBe('Notification');
  });

  it('rejects unknown instrument types', () => {
    expect(() =>
      Instrument.parse({
        id: 'x',
        type: 'Decree',
        title: 'x',
        jurisdiction: 'IN',
        citation: 'x',
      })
    ).toThrow();
  });

  it('rejects empty required strings', () => {
    expect(() =>
      Instrument.parse({
        id: '',
        type: 'Act',
        title: 'x',
        jurisdiction: 'IN',
        citation: 'x',
      })
    ).toThrow();
  });

  it('rejects invalid jurisdiction format', () => {
    expect(() =>
      Instrument.parse({
        id: 'x',
        type: 'Act',
        title: 'x',
        jurisdiction: 'us-ca',
        citation: 'x',
      })
    ).toThrow();
  });
});
