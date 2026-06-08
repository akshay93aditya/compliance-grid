// `cg` — Compliance Grid CLI MVP.
//
// One-shot orchestrator (no sub-verbs in v1):
//   1. Walk ./input-docs/ for business documents.
//   2. Concatenate the text into a transcript.
//   3. Run the profile-builder agent → company-profile.md.
//   4. Rank Source Index regulators against the profile → applicable-sources.md.
//   5. Print the next-steps summary.
//
// File-based; no Postgres dep. Requires `ANTHROPIC_API_KEY` only.
//
// Per the MVP framing (D50 community-extending model), this CLI is the
// path for external operators to surface their compliance landscape
// from their docs. Extraction + federation push-back use the existing
// patrol/publish primitives in a follow-up.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Local .env shim so npm-script invocations work without preset env.
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { readBusinessDocs } from '../src/cli/read-docs';
import { runProfileBuilder } from '../src/agents/profile-builder';
import { rankApplicableSources } from '../src/cli/applicability-matcher';
import { renderApplicableSources, renderCompanyProfile } from '../src/cli/render';

const INPUT_DIR = process.env.CG_INPUT_DIR ?? join(process.cwd(), 'input-docs');
const OUTPUT_DIR = process.env.CG_OUTPUT_DIR ?? join(process.cwd(), 'output');

// Sonnet's context window is large but we cap the transcript at a
// conservative 200 KB to keep cost predictable and the response fast.
const MAX_TRANSCRIPT_BYTES = 200_000;

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function err(s: string): void {
  process.stderr.write(`${s}\n`);
}

function buildTranscript(
  docs: Array<{ path: string; text: string; format: string; pages?: number }>,
  rootDir: string
): { transcript: string; truncated: boolean; included: number } {
  let bytesUsed = 0;
  let included = 0;
  const parts: string[] = [];
  for (const d of docs) {
    const header = `\n\n===== FILE: ${d.path.replace(rootDir, '').replace(/^\//, '')} (${d.format}${d.pages ? `, ${d.pages} pages` : ''}) =====\n`;
    const candidateLen = header.length + d.text.length;
    if (bytesUsed + candidateLen > MAX_TRANSCRIPT_BYTES) {
      const remaining = MAX_TRANSCRIPT_BYTES - bytesUsed - header.length;
      if (remaining > 500) {
        parts.push(header + d.text.slice(0, remaining) + '\n[…truncated]');
        bytesUsed += header.length + remaining;
        included += 1;
      }
      return { transcript: parts.join(''), truncated: true, included };
    }
    parts.push(header + d.text);
    bytesUsed += candidateLen;
    included += 1;
  }
  return { transcript: parts.join(''), truncated: false, included };
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    err('error: ANTHROPIC_API_KEY is not set. Add it to .env and try again.');
    return 2;
  }

  log(`cg — Compliance Grid`);
  log(`  input dir : ${INPUT_DIR}`);
  log(`  output dir: ${OUTPUT_DIR}`);
  log('');

  if (!existsSync(INPUT_DIR)) {
    err(
      `error: ${INPUT_DIR} does not exist.\n` +
        '       Create it and add your business documents (PDFs, .md, .txt).'
    );
    return 2;
  }

  log('Step 1/3: Reading business documents …');
  const docs = await readBusinessDocs(INPUT_DIR);
  const totalBytes = docs.reduce((n, d) => n + d.bytes, 0);
  if (docs.length === 0) {
    err(
      `error: No supported documents found in ${INPUT_DIR}.\n` +
        '       Supported: .pdf, .txt, .md.'
    );
    return 2;
  }
  log(`        Found ${docs.length} files (${(totalBytes / 1024).toFixed(1)} KB).`);
  for (const d of docs) {
    log(`        - ${d.path.replace(INPUT_DIR, '').replace(/^\//, '')} (${d.format})`);
  }
  log('');

  log('Step 2/3: Generating company profile via Sonnet …');
  const { transcript, truncated, included } = buildTranscript(docs, INPUT_DIR);
  if (truncated) {
    log(
      `        Transcript capped at ${(MAX_TRANSCRIPT_BYTES / 1024).toFixed(0)} KB; ${included}/${docs.length} files included (rest truncated).`
    );
  }
  const profile = await runProfileBuilder({ doc_transcript: transcript });
  log(`        Company: ${profile.company_name}`);
  log(
    `        Entity type: ${profile.entity_type} · Sector: ${profile.sector} · Primary jurisdiction: ${profile.primary_jurisdiction}`
  );
  log('');

  log('Step 3/3: Ranking Source Index regulators against your profile …');
  const matches = await rankApplicableSources({ profile });
  log(`        ${matches.length} regulators apply to your profile.`);
  if (matches.length > 0) {
    log(`        Top 3 by score:`);
    for (const m of matches.slice(0, 3)) {
      log(
        `         - [${m.score}] ${m.entry.id} (${m.entry.jurisdiction}/${m.entry.domain})`
      );
    }
  }
  log('');

  // Write outputs.
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const profilePath = join(OUTPUT_DIR, 'company-profile.md');
  const sourcesPath = join(OUTPUT_DIR, 'applicable-sources.md');
  writeFileSync(profilePath, renderCompanyProfile(profile, docs.length, totalBytes), 'utf-8');
  writeFileSync(sourcesPath, renderApplicableSources(matches), 'utf-8');

  log(`Wrote:`);
  log(`  ${profilePath}`);
  log(`  ${sourcesPath}`);
  log('');
  log('Next steps:');
  log('  1. Review company-profile.md. Edit anything the model misread.');
  log('  2. Skim applicable-sources.md — these are the regulators the system');
  log('     thinks apply to you, ranked.');
  log('  3. To extract obligations from the top-ranked regulators, see');
  log('     the patrol + crawlAndPipeline docs in README.md (Postgres-backed,');
  log("     costs ~\\$0.02 per obligation extracted via Sonnet).");
  log('  4. (Future) Push extracted obligations to the public Commons via');
  log('     `npm run publish`. Pull updates from other operators via');
  log('     `npm run pull`. See docs/specs/08-federation.md.');
  log('');
  log('Done.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  });
