// Phase 3.3 (D51) — cg publish runner. Walks the unpublished obligations
// in the local CKG, partitions them into per-(jurisdiction, domain)
// buckets, writes JSONL into a clone of the companion `compliance-grid-data`
// repository, commits, pushes a branch, and opens a PR via the gh CLI.
// On success it marks the obligations as published so the next run
// doesn't re-emit them.
//
// Required env:
//   DATABASE_URL                       — local CKG to read from
//   COMPLIANCE_GRID_DATA_REMOTE        — git URL the publisher pushes to
//                                        (upstream for maintainers, the
//                                        publisher's fork for external
//                                        contributors)
//   COMPLIANCE_GRID_DATA_WORKSPACE     — local path for the clone
//   PUBLISH_EXTRACTED_BY               — extractor identifier (e.g. GH handle)
// Optional env:
//   COMPLIANCE_GRID_DATA_BASE_BRANCH   — default 'main'
//   COMPLIANCE_GRID_DATA_UPSTREAM      — owner/name of the upstream repo
//                                        when the PR should land cross-fork
//                                        (default: same as REMOTE → same-repo PR)
//   PUBLISH_DRY_RUN=1                  — write JSONL + commit + push branch but skip gh pr create AND skip marking obligations published
//
// The dry-run mode is the integration-testable shape: it exercises every
// step that doesn't depend on GitHub being reachable.

import { spawnSync } from 'node:child_process';
import { closePool, getPool } from '../src/db/pool';
import {
  countUnpublishedObligations,
  loadInstrumentsForObligations,
  loadSourcesForObligations,
  loadUnpublishedObligations,
  markObligationsPublished,
} from '../src/db/publish';
import {
  bucketize,
  mergeJsonl,
  summarize,
  type PayloadBucket,
} from '../src/publish/payload';
import {
  commitAndPush,
  ensureWorkspace,
  writeMergedJsonl,
} from '../src/publish/git-workspace';
import { resolveGhPrTarget } from '../src/publish/git-url';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`cg publish: required env var ${name} is not set`);
    process.exit(2);
  }
  return v;
}

function buildPrBody(
  extractedBy: string,
  summary: ReturnType<typeof summarize>
): string {
  const lines: string[] = [];
  lines.push('## cg publish payload');
  lines.push('');
  lines.push(`- Extractor: \`${extractedBy}\``);
  lines.push(`- Buckets: ${summary.buckets}`);
  lines.push(
    `- Jurisdictions: ${summary.jurisdictions.map((j) => '`' + j + '`').join(', ')}`
  );
  lines.push(`- Domains: ${summary.domains.map((d) => '`' + d + '`').join(', ')}`);
  lines.push('');
  lines.push('| Counts | |');
  lines.push('|---|---|');
  lines.push(`| Obligations | ${summary.obligations} |`);
  lines.push(`| Instruments | ${summary.instruments} |`);
  lines.push(`| Sources | ${summary.sources} |`);
  lines.push('');
  lines.push(
    `Confidence: min ${summary.confidence.min}, max ${summary.confidence.max}, avg ${summary.confidence.avg}`
  );
  lines.push('');
  lines.push('### Source URLs');
  for (const u of summary.source_urls) lines.push(`- ${u}`);
  return lines.join('\n');
}

async function writeBucket(workspace: string, bucket: PayloadBucket): Promise<{
  obligations_added: number;
  instruments_added: number;
  sources_added: number;
}> {
  const relBase = `${bucket.jurisdiction}/${bucket.domain}`;

  // Sources are written first so a downstream operator pulling
  // mid-merge sees referenced rows before the referencing obligations.
  const srcsResult = await writeMergedJsonl(
    workspace,
    `${relBase}/sources.jsonl`,
    bucket.sources.map((r) => ({ ...r })),
    'id',
    mergeJsonl
  );
  const instResult = await writeMergedJsonl(
    workspace,
    `${relBase}/instruments.jsonl`,
    bucket.instruments.map((r) => ({ ...r })),
    'id',
    mergeJsonl
  );
  const obsResult = await writeMergedJsonl(
    workspace,
    `${relBase}/obligations.jsonl`,
    bucket.obligations.map((r) => {
      // bucket_jurisdiction + bucket_domain are derived locals; not part of the
      // canonical row shape. Strip them before writing.
      const { bucket_jurisdiction: _j, bucket_domain: _d, ...rest } = r;
      return rest;
    }),
    'canonical_id',
    mergeJsonl
  );

  return {
    obligations_added: obsResult.added ? obsResult.finalLines : 0,
    instruments_added: instResult.added ? instResult.finalLines : 0,
    sources_added: srcsResult.added ? srcsResult.finalLines : 0,
  };
}

async function main(): Promise<number> {
  const remote = envRequired('COMPLIANCE_GRID_DATA_REMOTE');
  const workspace = envRequired('COMPLIANCE_GRID_DATA_WORKSPACE');
  const extractedBy = envRequired('PUBLISH_EXTRACTED_BY');
  const baseBranch = process.env.COMPLIANCE_GRID_DATA_BASE_BRANCH ?? 'main';
  const upstream = process.env.COMPLIANCE_GRID_DATA_UPSTREAM;
  const dryRun = process.env.PUBLISH_DRY_RUN === '1';

  const pending = await countUnpublishedObligations(getPool());
  if (pending === 0) {
    console.log(
      JSON.stringify({ result: 'nothing-to-publish', pending: 0 }, null, 2)
    );
    return 0;
  }

  // Workspace + branch setup is destructive; do it before reading rows
  // so a misconfigured workspace fails fast and no DB rows get marked.
  await ensureWorkspace(remote, workspace, baseBranch);

  const obligations = await loadUnpublishedObligations(getPool());
  const canonicalIds = obligations.map((o) => o.canonical_id);
  const instruments = await loadInstrumentsForObligations(
    getPool(),
    canonicalIds
  );
  const sources = await loadSourcesForObligations(getPool(), canonicalIds);

  const buckets = bucketize(obligations, instruments, sources);
  const summary = summarize(buckets);

  // Branch name carries a timestamp + obligation count for at-a-glance
  // PR triage. Receivers don't depend on the name.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const branch = `publish/${extractedBy}/${timestamp}-${summary.obligations}`;

  const perBucketCounts: Record<string, unknown> = {};
  for (const b of buckets) {
    perBucketCounts[`${b.jurisdiction}/${b.domain}`] = await writeBucket(
      workspace,
      b
    );
  }

  const message = `publish: ${summary.obligations} obligations across ${summary.buckets} bucket(s) from ${extractedBy}`;
  const { sha } = await commitAndPush(workspace, branch, message);

  const prTitle = `cg publish: ${summary.obligations} obligations, ${
    summary.jurisdictions.join(' ')
  }`;
  const prBody = buildPrBody(extractedBy, summary);

  let prUrl: string | undefined;
  if (!dryRun) {
    const target = resolveGhPrTarget({ remote, upstream, branch });
    const gh = spawnSync(
      'gh',
      [
        'pr',
        'create',
        '--repo',
        target.repo,
        '--head',
        target.head,
        '--base',
        baseBranch,
        '--title',
        prTitle,
        '--body',
        prBody,
      ],
      { cwd: workspace, encoding: 'utf-8' }
    );
    if (gh.status !== 0) {
      throw new Error(`gh pr create failed: ${gh.stderr || gh.stdout}`);
    }
    prUrl = gh.stdout.trim();

    const marked = await markObligationsPublished(getPool(), canonicalIds);
    if (marked.updated !== canonicalIds.length) {
      console.error(
        `cg publish: WARNING — expected to mark ${canonicalIds.length} rows published, marked ${marked.updated}`
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        result: dryRun ? 'dry-run-success' : 'success',
        extractor: extractedBy,
        branch,
        commit: sha,
        pr_url: prUrl,
        summary,
        per_bucket: perBucketCounts,
      },
      null,
      2
    )
  );
  return 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    await closePool().catch(() => undefined);
    process.exit(1);
  });
