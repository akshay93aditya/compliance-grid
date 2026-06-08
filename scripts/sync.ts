// Phase 3.6 — cadenced sync orchestrator. Runs `cg pull` then
// `cg patrol` so a single scheduled invocation keeps the local CKG
// current with both federation incoming and re-fetched-source changes.
//
// Pull and patrol are intentionally independent: pull failure does not
// block patrol (federation network blips shouldn't stop hash-diff work),
// and patrol failure does not roll back a successful pull. Both step
// exit codes are reported; the sync exits non-zero if either step did.
//
// Pull is skipped when COMPLIANCE_GRID_DATA_REMOTE is not set. This
// makes the sync safe to default-on in GitHub Actions even before the
// companion data repo exists. Patrol runs in either case.
//
// Required env (for the steps that run):
//   DATABASE_URL                        — both steps
//   ANTHROPIC_API_KEY                   — patrol only; required when a
//                                         re-fetched source's content
//                                         hash changed and re-extraction
//                                         is needed (D47/D48)
//   COMPLIANCE_GRID_DATA_REMOTE         — pull only; presence toggles it
//   COMPLIANCE_GRID_DATA_WORKSPACE      — pull only
// Optional env: passed through to the individual scripts unchanged.

import { spawn } from 'node:child_process';

interface StepResult {
  name: string;
  ran: boolean;
  exit_code: number | null;
  duration_ms: number;
  reason?: string;
}

async function runStep(name: string, args: string[]): Promise<StepResult> {
  const startedAt = Date.now();
  console.log(`[sync] ▶ ${name}`);
  return new Promise<StepResult>((resolve) => {
    const proc = spawn('npx', args, { stdio: 'inherit' });
    proc.on('error', (err) => {
      console.error(`[sync] step '${name}' spawn error: ${err.message}`);
      resolve({
        name,
        ran: true,
        exit_code: -1,
        duration_ms: Date.now() - startedAt,
        reason: err.message,
      });
    });
    proc.on('close', (code) => {
      const exit_code = code ?? -1;
      console.log(`[sync] ◀ ${name} exit ${exit_code}`);
      resolve({
        name,
        ran: true,
        exit_code,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps: StepResult[] = [];

  if (process.env.COMPLIANCE_GRID_DATA_REMOTE) {
    steps.push(await runStep('pull', ['tsx', 'scripts/pull.ts']));
  } else {
    steps.push({
      name: 'pull',
      ran: false,
      exit_code: null,
      duration_ms: 0,
      reason: 'COMPLIANCE_GRID_DATA_REMOTE is not set; skipped',
    });
    console.log(
      '[sync] skipping pull (COMPLIANCE_GRID_DATA_REMOTE is not set)'
    );
  }

  steps.push(await runStep('patrol', ['tsx', 'scripts/patrol.ts']));

  const overallExit = steps.some((s) => s.ran && s.exit_code !== 0) ? 1 : 0;

  console.log('');
  console.log(
    JSON.stringify(
      {
        started_at: startedAt,
        elapsed_ms: Date.now() - t0,
        overall: overallExit === 0 ? 'success' : 'partial-failure',
        steps,
      },
      null,
      2
    )
  );
  return overallExit;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
