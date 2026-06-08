import { describe, expect, it } from 'vitest';
import { Module, formatModuleCoordinate } from './module';

describe('Module', () => {
  const base = {
    coordinate: { jurisdiction: 'IN-KA', domain: 'labour' },
    version: 'v1',
    depends_on: [
      { jurisdiction: 'IN', domain: 'labour', version: 'v3' },
    ],
    coverage_status: 'live',
  };

  it('accepts a valid live module', () => {
    const parsed = Module.parse(base);
    expect(parsed.coverage_status).toBe('live');
    expect(parsed.depends_on.length).toBe(1);
  });

  it('accepts every coverage_status from the state machine', () => {
    for (const cs of [
      'not_covered',
      'expanding',
      'live',
      'stale',
      'refreshing',
    ]) {
      const parsed = Module.parse({ ...base, coverage_status: cs });
      expect(parsed.coverage_status).toBe(cs);
    }
  });

  it('accepts a module with no dependencies', () => {
    const parsed = Module.parse({ ...base, depends_on: [] });
    expect(parsed.depends_on).toEqual([]);
  });

  it('rejects an unknown coverage_status', () => {
    expect(() =>
      Module.parse({ ...base, coverage_status: 'archived' })
    ).toThrow();
  });

  it('rejects a bad jurisdiction in coordinate', () => {
    expect(() =>
      Module.parse({
        ...base,
        coordinate: { jurisdiction: 'us-ca', domain: 'labour' },
      })
    ).toThrow();
  });

  it('rejects a bad jurisdiction in depends_on', () => {
    expect(() =>
      Module.parse({
        ...base,
        depends_on: [{ jurisdiction: 'us-ca', domain: 'labour', version: 'v1' }],
      })
    ).toThrow();
  });

  it('rejects an empty domain string', () => {
    expect(() =>
      Module.parse({
        ...base,
        coordinate: { jurisdiction: 'IN-KA', domain: '' },
      })
    ).toThrow();
  });
});

describe('formatModuleCoordinate', () => {
  it('renders as IN-KA/labour/v1', () => {
    expect(
      formatModuleCoordinate({
        jurisdiction: 'IN-KA',
        domain: 'labour',
        version: 'v1',
      })
    ).toBe('IN-KA/labour/v1');
  });

  it('renders national IN/labour/v3', () => {
    expect(
      formatModuleCoordinate({
        jurisdiction: 'IN',
        domain: 'labour',
        version: 'v3',
      })
    ).toBe('IN/labour/v3');
  });
});
