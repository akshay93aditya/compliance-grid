import { describe, expect, it } from 'vitest';
import { Source } from './source';

describe('Source', () => {
  const base = {
    id: 's1',
    jurisdiction: 'IN-KA',
    domain: 'labour',
    url: 'https://labour.kar.nic.in/listing',
    fetch_recipe: { kind: 'listing-page', config: {} },
    trust_tier: 'govt-portal',
    last_seen: '2026-05-27T10:00:00Z',
    content_hash: 'sha256:abcdef',
  };

  it('accepts a fully-populated valid source', () => {
    const parsed = Source.parse(base);
    expect(parsed.trust_tier).toBe('govt-portal');
  });

  it('rejects a bad URL', () => {
    expect(() => Source.parse({ ...base, url: 'not-a-url' })).toThrow();
  });

  it('rejects an unknown trust tier', () => {
    expect(() => Source.parse({ ...base, trust_tier: 'rumor' })).toThrow();
  });

  it('rejects a bad jurisdiction format', () => {
    expect(() => Source.parse({ ...base, jurisdiction: 'in-ka' })).toThrow();
  });

  it('rejects a non-ISO last_seen', () => {
    expect(() => Source.parse({ ...base, last_seen: 'yesterday' })).toThrow();
  });

  it('rejects a fetch_recipe with an empty kind', () => {
    expect(() =>
      Source.parse({ ...base, fetch_recipe: { kind: '', config: {} } })
    ).toThrow();
  });

  it('accepts a fetch_recipe with no config (defaults to {})', () => {
    const { fetch_recipe: _, ...rest } = base;
    const parsed = Source.parse({
      ...rest,
      fetch_recipe: { kind: 'static-url' },
    });
    expect(parsed.fetch_recipe.config).toEqual({});
  });
});
