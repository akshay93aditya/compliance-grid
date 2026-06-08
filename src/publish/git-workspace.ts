import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

// Phase 3.3 (D51) — git workspace primitives for the cg publish runner.
// Thin wrappers around git invocations so the runner reads top-to-bottom
// without splicing shell calls in the middle of business logic.

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  // When set, the command's stdout is returned as a string. Default true.
  capture?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function run(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf-8')));
    proc.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf-8')));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) =>
      resolve({ stdout, stderr, code: code ?? -1 })
    );
  });
}

export async function gitMustSucceed(
  args: string[],
  cwd: string
): Promise<RunResult> {
  const result = await run('git', args, { cwd });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (cwd=${cwd}): exit ${result.code}\n${
        result.stderr || result.stdout
      }`
    );
  }
  return result;
}

// Clones or pulls the companion repo into the configured workspace.
// On first call: clones from `remote` into `workspace`. Subsequent calls
// do `git fetch + reset --hard origin/<branch>` so the workspace is
// always at a known clean state matching upstream.
export async function ensureWorkspace(
  remote: string,
  workspace: string,
  baseBranch: string
): Promise<void> {
  if (!existsSync(workspace)) {
    await mkdir(dirname(workspace), { recursive: true });
    const clone = await run('git', ['clone', remote, workspace]);
    if (clone.code !== 0) {
      throw new Error(
        `cg publish: git clone failed: ${clone.stderr || clone.stdout}`
      );
    }
    return;
  }

  // Workspace exists. Confirm remote matches, then refresh.
  const remoteCheck = await gitMustSucceed(
    ['remote', 'get-url', 'origin'],
    workspace
  );
  if (remoteCheck.stdout.trim() !== remote) {
    throw new Error(
      `cg publish: workspace at ${workspace} has remote ${remoteCheck.stdout.trim()}, expected ${remote}. Resolve manually or delete the workspace.`
    );
  }
  await gitMustSucceed(['fetch', 'origin'], workspace);
  // Detect whether the base branch exists upstream yet — a freshly-created
  // companion repo may have no commits at all, in which case we just stay
  // on the default branch.
  const ref = await run(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`],
    { cwd: workspace }
  );
  if (ref.code === 0) {
    await gitMustSucceed(['checkout', baseBranch], workspace);
    await gitMustSucceed(['reset', '--hard', `origin/${baseBranch}`], workspace);
  }
}

// Writes a JSONL file at `workspace/relpath`, merging with anything already
// at that path. Receivers dedupe by `idField`. Idempotent in the sense
// that re-publishing the same rows produces no diff.
export async function writeMergedJsonl(
  workspace: string,
  relpath: string,
  newRows: Array<Record<string, unknown>>,
  idField: string,
  merge: (existing: string, rows: Array<Record<string, unknown>>, key: string) => string
): Promise<{ added: boolean; finalLines: number }> {
  const fullPath = join(workspace, relpath);
  await mkdir(dirname(fullPath), { recursive: true });
  let existing = '';
  if (existsSync(fullPath)) {
    existing = await readFile(fullPath, 'utf-8');
  }
  const merged = merge(existing, newRows, idField);
  if (merged === existing) {
    return { added: false, finalLines: existing.trim().split('\n').filter(Boolean).length };
  }
  await writeFile(fullPath, merged, 'utf-8');
  return {
    added: true,
    finalLines: merged.trim().split('\n').filter(Boolean).length,
  };
}

// Stages, commits, pushes. Returns the branch name + commit sha.
export async function commitAndPush(
  workspace: string,
  branch: string,
  message: string
): Promise<{ branch: string; sha: string }> {
  await gitMustSucceed(['checkout', '-b', branch], workspace);
  await gitMustSucceed(['add', '-A'], workspace);
  const status = await gitMustSucceed(['status', '--porcelain'], workspace);
  if (status.stdout.trim().length === 0) {
    throw new Error('cg publish: nothing to commit (working tree clean)');
  }
  await gitMustSucceed(['commit', '-m', message], workspace);
  const sha = (await gitMustSucceed(['rev-parse', 'HEAD'], workspace)).stdout.trim();
  await gitMustSucceed(['push', '-u', 'origin', branch], workspace);
  return { branch, sha };
}
