import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetSourceIndexCache,
  computeCoverageReport,
  loadSourceIndex,
} from './coverage';
import type { EntityProfile } from '../schemas/entity-profile';

// Mock executor for unit tests — returns a fixed set of "covered hosts".
function mockExecutorWithHosts(hosts: string[]) {
  return {
    // Match the pg Executor type loosely; only `.query()` is used.
    query: async (sql: string) => {
      if (sql.includes('regexp_replace')) {
        return {
          rows: hosts.map((host) => ({ host })),
          rowCount: hosts.length,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Parameters<typeof computeCoverageReport>[0];
}

const ENTITY: EntityProfile = {
  entity_id: 'ent_test',
  org_id: 'org_test',
  entity_type: 'pvt-ltd',
  sector: 'manufacturing',
  jurisdictions: ['IN-KA'],
  headcount: 25,
  annual_turnover_inr: 10_000_000,
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'coverage-'));
  _resetSourceIndexCache();
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  _resetSourceIndexCache();
});

function writeYaml(
  relPath: string,
  body: { id: string; url: string; jurisdiction: string; domain: string }
): void {
  const full = join(tmp, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(
    full,
    `id: ${body.id}
url: ${body.url}
jurisdiction: ${body.jurisdiction}
domain: ${body.domain}
`,
    'utf-8'
  );
}

describe('loadSourceIndex', () => {
  it('returns [] for an empty dir', async () => {
    const entries = await loadSourceIndex(tmp);
    expect(entries).toEqual([]);
  });

  it('reads every yaml under nested subdirs', async () => {
    writeYaml('IN-KA/labour/x.yaml', {
      id: 'x',
      url: 'https://a.example/',
      jurisdiction: 'IN-KA',
      domain: 'labour',
    });
    writeYaml('IN/finance/y.yaml', {
      id: 'y',
      url: 'https://b.example/',
      jurisdiction: 'IN',
      domain: 'finance',
    });
    const entries = await loadSourceIndex(tmp);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id).sort()).toEqual(['x', 'y']);
  });

  it('skips yaml files missing required fields', async () => {
    writeYaml('valid.yaml', {
      id: 'v',
      url: 'https://a.example/',
      jurisdiction: 'IN',
      domain: 'tax',
    });
    writeFileSync(join(tmp, 'bad.yaml'), 'id: missing-url\n', 'utf-8');
    const entries = await loadSourceIndex(tmp);
    expect(entries.map((e) => e.id)).toEqual(['v']);
  });
});

describe('computeCoverageReport', () => {
  it('filters by jurisdiction (entity + central IN)', async () => {
    writeYaml('IN-KA/labour/a.yaml', {
      id: 'a',
      url: 'https://a.example/',
      jurisdiction: 'IN-KA',
      domain: 'labour',
    });
    writeYaml('IN-MH/labour/b.yaml', {
      id: 'b',
      url: 'https://b.example/',
      jurisdiction: 'IN-MH',
      domain: 'labour',
    });
    writeYaml('IN/finance/c.yaml', {
      id: 'c',
      url: 'https://c.example/',
      jurisdiction: 'IN',
      domain: 'finance',
    });
    const report = await computeCoverageReport(
      mockExecutorWithHosts([]),
      ENTITY,
      tmp
    );
    // IN-KA + IN apply; IN-MH does not.
    expect(report.applicable_regulators).toBe(2);
    expect(report.by_jurisdiction.map((b) => b.jurisdiction).sort()).toEqual([
      'IN',
      'IN-KA',
    ]);
  });

  it('marks regulators with extracted obligations as covered', async () => {
    writeYaml('IN-KA/labour/karmika.yaml', {
      id: 'karmika',
      url: 'https://karmikaspandana.karnataka.gov.in/listing/en',
      jurisdiction: 'IN-KA',
      domain: 'labour',
    });
    writeYaml('IN-KA/tax/gst.yaml', {
      id: 'gst',
      url: 'https://gst-ka.example/',
      jurisdiction: 'IN-KA',
      domain: 'tax',
    });
    const report = await computeCoverageReport(
      mockExecutorWithHosts(['karmikaspandana.karnataka.gov.in']),
      ENTITY,
      tmp
    );
    expect(report.applicable_regulators).toBe(2);
    expect(report.covered_regulators).toBe(1);
    expect(report.uncovered_regulators).toBe(1);
    expect(report.uncovered_sample.map((u) => u.id)).toEqual(['gst']);
  });

  it('uses hostname (not full URL) for the join', async () => {
    writeYaml('a.yaml', {
      id: 'a',
      url: 'https://example.gov.in/section/page',
      jurisdiction: 'IN',
      domain: 'tax',
    });
    // DB has obligations against a different path on the same host.
    const report = await computeCoverageReport(
      mockExecutorWithHosts(['example.gov.in']),
      ENTITY,
      tmp
    );
    expect(report.covered_regulators).toBe(1);
  });

  it('returns zero coverage when the CKG is empty', async () => {
    writeYaml('a.yaml', {
      id: 'a',
      url: 'https://x.example/',
      jurisdiction: 'IN-KA',
      domain: 'labour',
    });
    const report = await computeCoverageReport(
      mockExecutorWithHosts([]),
      ENTITY,
      tmp
    );
    expect(report.applicable_regulators).toBe(1);
    expect(report.covered_regulators).toBe(0);
    expect(report.uncovered_regulators).toBe(1);
  });

  it('caps uncovered_sample at 5', async () => {
    for (let i = 0; i < 10; i++) {
      writeYaml(`r${i}.yaml`, {
        id: `r${i}`,
        url: `https://r${i}.example/`,
        jurisdiction: 'IN-KA',
        domain: 'labour',
      });
    }
    const report = await computeCoverageReport(
      mockExecutorWithHosts([]),
      ENTITY,
      tmp
    );
    expect(report.uncovered_regulators).toBe(10);
    expect(report.uncovered_sample).toHaveLength(5);
  });
});
