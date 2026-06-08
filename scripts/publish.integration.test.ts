import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closePool, getPool } from '../src/db/pool';

// Phase 3.3 (D51) end-to-end smoke for the cg publish runner. Spins up a
// local bare git repo as the "companion," seeds one fixture obligation,
// invokes the runner in dry-run mode (so no gh pr create is attempted),
// and asserts that the JSONL files were written into the bare repo.
//
// Heavy: spawns the runner as a subprocess + creates two temp git repos.
// Gated on RUN_PUBLISH_INTEGRATION=1 so the normal vitest run stays fast.

const runLive = process.env.RUN_PUBLISH_INTEGRATION === '1';
const hasDb = !!process.env.DATABASE_URL;

const FIXTURE = {
  instrumentId: 'IN-XX/publish-integration-instrument',
  sourceId: 'src_publish_integ_fixt000001',
  canonicalId: 'IN-XX/publish-integration-instrument|publish-test|filing',
};

describe.skipIf(!runLive || !hasDb)(
  'cg publish runner (integration, local bare remote)',
  () => {
    let tmpRoot: string;
    let bareRemote: string;
    let workspace: string;

    beforeAll(async () => {
      tmpRoot = await mkdtemp(join(tmpdir(), 'cg-publish-'));
      bareRemote = join(tmpRoot, 'compliance-grid-data.git');
      workspace = join(tmpRoot, 'workspace');

      // Bare remote.
      await mkdir(bareRemote, { recursive: true });
      const init = spawnSync('git', ['init', '--bare', '-b', 'main'], {
        cwd: bareRemote,
        encoding: 'utf-8',
      });
      if (init.status !== 0) {
        throw new Error(`git init --bare failed: ${init.stderr}`);
      }

      // Initial commit on the bare repo's main so ensureWorkspace's
      // checkout-and-reset path works. Done via a one-shot working clone.
      const seedDir = join(tmpRoot, 'seed-init');
      await mkdir(seedDir, { recursive: true });
      const seedInit = spawnSync('git', ['init', '-b', 'main'], {
        cwd: seedDir,
        encoding: 'utf-8',
      });
      if (seedInit.status !== 0) {
        throw new Error(`git init seed failed: ${seedInit.stderr}`);
      }
      spawnSync('git', ['config', 'user.email', 'test@test.local'], {
        cwd: seedDir,
      });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: seedDir });
      spawnSync(
        'bash',
        ['-c', 'echo "# compliance-grid-data" > README.md'],
        { cwd: seedDir }
      );
      spawnSync('git', ['add', '-A'], { cwd: seedDir });
      const commit = spawnSync('git', ['commit', '-m', 'initial'], {
        cwd: seedDir,
        encoding: 'utf-8',
      });
      if (commit.status !== 0) {
        throw new Error(`seed commit failed: ${commit.stderr}`);
      }
      const push = spawnSync(
        'git',
        ['push', bareRemote, 'main:main'],
        { cwd: seedDir, encoding: 'utf-8' }
      );
      if (push.status !== 0) {
        throw new Error(`seed push failed: ${push.stderr}`);
      }

      // Cleanup any leftovers from a prior failed run.
      await getPool().query(
        `DELETE FROM change_events WHERE obligation_canonical_id = $1`,
        [FIXTURE.canonicalId]
      );
      await getPool().query(`DELETE FROM obligations WHERE canonical_id = $1`, [
        FIXTURE.canonicalId,
      ]);
      await getPool().query(`DELETE FROM sources WHERE id = $1`, [FIXTURE.sourceId]);
      await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
        FIXTURE.instrumentId,
      ]);

      // Insert the fixture: one instrument, one source, one obligation.
      await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, 'Rule', 'Publish Integration Instrument', 'IN-XX', 'PII')`,
        [FIXTURE.instrumentId]
      );
      await getPool().query(
        `INSERT INTO sources (id, jurisdiction, domain, url, fetch_recipe,
                              trust_tier, last_seen, content_hash)
         VALUES ($1, 'IN-XX', 'publish-test', $2,
                 '{"kind":"static-url"}'::jsonb, 'unverified', NOW(),
                 'integration-hash')`,
        [
          FIXTURE.sourceId,
          'https://publish-integration.fixture.example/doc.pdf',
        ]
      );
      await getPool().query(
        `INSERT INTO obligations
           (canonical_id, instrument_id, section, type, summary,
            applicability_conditions, frequency, deadline_rule,
            proof_types, penalty, source_refs, version, confidence)
         VALUES ($1, $2, 'publish-test', 'filing', 'Integration fixture',
                 '[]'::jsonb, 'annual',
                 '{"kind":"fixed-date","month":3,"day":31}'::jsonb,
                 '[]'::jsonb, '{"has_imprisonment":false}'::jsonb,
                 $3::jsonb, '1', 0.95)`,
        [
          FIXTURE.canonicalId,
          FIXTURE.instrumentId,
          JSON.stringify([
            { source_id: FIXTURE.sourceId, citation_span: 'span' },
          ]),
        ]
      );
    });

    afterAll(async () => {
      await getPool().query(
        `DELETE FROM change_events WHERE obligation_canonical_id = $1`,
        [FIXTURE.canonicalId]
      );
      await getPool().query(`DELETE FROM obligations WHERE canonical_id = $1`, [
        FIXTURE.canonicalId,
      ]);
      await getPool().query(`DELETE FROM sources WHERE id = $1`, [FIXTURE.sourceId]);
      await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
        FIXTURE.instrumentId,
      ]);
      await closePool();
      await rm(tmpRoot, { recursive: true, force: true });
    });

    it(
      'writes JSONL into the bare remote and leaves the fixture unpublished in dry-run',
      { timeout: 60_000 },
      async () => {
        const runner = spawnSync(
          'npx',
          ['tsx', 'scripts/publish.ts'],
          {
            cwd: process.cwd(),
            encoding: 'utf-8',
            env: {
              ...process.env,
              COMPLIANCE_GRID_DATA_REMOTE: bareRemote,
              COMPLIANCE_GRID_DATA_WORKSPACE: workspace,
              PUBLISH_EXTRACTED_BY: 'integration-test',
              PUBLISH_DRY_RUN: '1',
            },
          }
        );
        if (runner.status !== 0) {
          throw new Error(
            `publish runner failed: stdout=${runner.stdout}\nstderr=${runner.stderr}`
          );
        }
        const out = JSON.parse(runner.stdout) as {
          result: string;
          summary: { obligations: number };
        };
        expect(out.result).toBe('dry-run-success');
        expect(out.summary.obligations).toBeGreaterThanOrEqual(1);

        // The workspace clone should now have the JSONL files at the
        // expected bucket path.
        const obsPath = join(
          workspace,
          'IN-XX/publish-test/obligations.jsonl'
        );
        const srcPath = join(workspace, 'IN-XX/publish-test/sources.jsonl');
        const instPath = join(
          workspace,
          'IN-XX/publish-test/instruments.jsonl'
        );
        expect(existsSync(obsPath)).toBe(true);
        expect(existsSync(srcPath)).toBe(true);
        expect(existsSync(instPath)).toBe(true);

        const obsLines = readFileSync(obsPath, 'utf-8')
          .trim()
          .split('\n')
          .filter(Boolean);
        expect(obsLines.some((l) => l.includes(FIXTURE.canonicalId))).toBe(true);

        // Dry-run must NOT have marked the fixture as published.
        const { rows } = await getPool().query<{ published_at: Date | null }>(
          `SELECT published_at FROM obligations WHERE canonical_id = $1`,
          [FIXTURE.canonicalId]
        );
        expect(rows[0]!.published_at).toBeNull();

        // The bare remote should carry the new branch.
        const branches = spawnSync(
          'git',
          ['branch', '-r'],
          { cwd: workspace, encoding: 'utf-8' }
        );
        expect(branches.stdout).toContain('publish/integration-test/');
      }
    );
  }
);

describe('cg publish runner (module presence)', () => {
  it('scripts/publish.ts exists and is referenced from package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.publish).toBe('tsx scripts/publish.ts');
  });
});
