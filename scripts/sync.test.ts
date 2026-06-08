import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Phase 3.6 — sync orchestrator. The script is pure orchestration over
// `scripts/pull.ts` and `scripts/patrol.ts`; each underlying step has
// its own integration test. This file only verifies the script is
// present and wired into package.json so the contract that
// `.github/workflows/sync.yml` depends on can't drift unnoticed.

describe('cg sync runner (module presence)', () => {
  it('scripts/sync.ts exists', () => {
    expect(existsSync('scripts/sync.ts')).toBe(true);
  });

  it('npm run sync invokes scripts/sync.ts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.sync).toBe('tsx scripts/sync.ts');
  });

  it('the GitHub Actions workflow at sync.yml exists and runs the federation-pull half', () => {
    // Phase 3.6.1 split: sync.yml now invokes `npm run pull` only (not the
    // full sync), because patrol's source fetches need an Indian IP and
    // GitHub Actions runners are US-based. Patrol runs locally via launchd
    // (scripts/launchd/). The federation half stays in CI.
    expect(existsSync('.github/workflows/sync.yml')).toBe(true);
    const yaml = readFileSync('.github/workflows/sync.yml', 'utf-8');
    expect(yaml).toContain('npm run pull');
    expect(yaml).toContain('COMPLIANCE_GRID_DATA_REMOTE');
  });

  it('the old patrol.yml is removed (replaced by sync.yml)', () => {
    expect(existsSync('.github/workflows/patrol.yml')).toBe(false);
  });
});
