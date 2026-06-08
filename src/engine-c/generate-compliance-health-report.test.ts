import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool';
import type { EntityProfile } from '../schemas/entity-profile';
import { generateComplianceHealthReport } from './generate-compliance-health-report';

const hasDb = !!process.env.DATABASE_URL;

const sampleEntity: EntityProfile = {
  entity_id: 'test-health-ent',
  org_id: 'test-health-org',
  entity_type: 'pvt-ltd',
  sector: 'manufacturing',
  jurisdictions: ['IN-KA'],
  headcount: 25,
  annual_turnover_inr: 50_000_000,
};

describe.skipIf(!hasDb)('generateComplianceHealthReport (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it(
    'produces a per-instrument rollup with sensible totals for the sample KA MSME',
    async () => {
      const report = await generateComplianceHealthReport(getPool(), {
        entity: sampleEntity,
      });

      // eslint-disable-next-line no-console
      console.log('\n=== Compliance health report (no proofs uploaded) ===');
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            loaded_obligation_count: report.loaded_obligation_count,
            applicable_obligation_count: report.applicable_obligation_count,
            overall: report.score.overall,
            total_applicable: report.score.total_applicable,
            total_complied: report.score.total_complied,
            total_jail_risk_open: report.score.total_jail_risk_open,
            per_domain_summary: report.score.per_domain
              .slice(0, 5)
              .map((d) => ({
                domain: d.domain,
                color: d.color,
                total: d.total,
                pending: d.pending,
                jail_risk_open: d.jail_risk_open,
              })),
          },
          null,
          2
        )
      );

      expect(report.loaded_obligation_count).toBeGreaterThan(0);
      // With no proofs and the bulk-run data in place, the overall color is
      // either amber (no jail-risk obligations among applicable) or red (some
      // jail-risk obligation is applicable and unsatisfied).
      expect(['amber', 'red']).toContain(report.score.overall);
      // Every applicable obligation defaults to 'pending'.
      expect(report.score.total_complied).toBe(0);
      // Per-domain rollups are sorted with red first.
      for (let i = 1; i < report.score.per_domain.length; i += 1) {
        const prev = report.score.per_domain[i - 1]!;
        const cur = report.score.per_domain[i]!;
        const rank = { red: 0, amber: 1, green: 2 } as const;
        expect(rank[prev.color]).toBeLessThanOrEqual(rank[cur.color]);
      }
    }
  );

  it(
    'returns green when all applicable obligations are marked complied',
    async () => {
      // First find what's applicable to the entity, then mark them all complied.
      const initial = await generateComplianceHealthReport(getPool(), {
        entity: sampleEntity,
      });
      if (initial.score.total_applicable === 0) return; // nothing to test

      // Build a proofState that says all complied.
      const proofState = new Map<string, 'complied'>();
      for (const domain of initial.score.per_domain) {
        // We need every canonical_id in the applicable set. Re-load to get them.
        // For this test we can construct the map from per_domain totals indirectly.
        // Simpler: just rerun and inject a Map<canonical_id, 'complied'>.
        // To keep it simple, load applicable obligations directly here.
        void domain;
      }
      // Re-load via the underlying APIs to get canonical_ids.
      const { loadObligations } = await import('../db/obligations.js');
      const { evaluateApplicability } = await import(
        '../gates/evaluate-applicability.js'
      );
      const all = await loadObligations(getPool(), {
        jurisdiction: sampleEntity.jurisdictions[0],
      });
      const applicable = evaluateApplicability({
        entity: sampleEntity,
        obligations: all,
      });
      const allComplied = new Map<string, 'complied'>();
      for (const o of applicable) allComplied.set(o.canonical_id, 'complied');

      const report = await generateComplianceHealthReport(getPool(), {
        entity: sampleEntity,
        proofState: allComplied,
      });
      expect(report.score.overall).toBe('green');
      expect(report.score.total_complied).toBe(
        report.score.total_applicable
      );
    }
  );
});
