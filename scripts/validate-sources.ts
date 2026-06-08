// Phase 3.2 (D50) — Source Index validator. Walks `sources/**/*.yaml`,
// parses each file, validates against the SourceIndexEntry schema, and
// runs operational checks the audit (2026-06-08) called out:
//   - filename matches the entry's `id`
//   - path encodes the entry's jurisdiction + domain
//   - ids are unique across files (existing)
//   - **urls are unique across files (new)**
//   - **last_verified is fresh (warn if > 180 days old, new)**
//   - **access.status is consistent with fetch_recipe.requires_browser
//     (e.g. access.browser-required ⇒ requires_browser=true) (new)**
//
// Hard errors fail the run (exit 1); warnings are reported but don't
// fail. Run by CI on every PR via `npm run sources:validate`.

import { readFile, glob } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { SourceIndexEntry } from '../src/schemas/source-index';

const SOURCES_DIR = 'sources';
const STALE_VERIFICATION_DAYS = 180;

interface FileError {
  path: string;
  message: string;
}
interface FileWarning {
  path: string;
  message: string;
}

function normaliseUrl(u: string): string {
  // Trailing slash + lowercase host = same source; the index shouldn't
  // catalogue both 'https://example.gov.in/' and 'https://Example.gov.in'.
  try {
    const url = new URL(u);
    url.hostname = url.hostname.toLowerCase();
    let path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.hostname}${path}${url.search}`;
  } catch {
    return u.toLowerCase().replace(/\/+$/, '');
  }
}

async function main(): Promise<void> {
  const errors: FileError[] = [];
  const warnings: FileWarning[] = [];
  const seenIds = new Map<string, string>(); // id -> first path
  const seenUrls = new Map<string, string>(); // normalised url -> first path
  let count = 0;

  const now = new Date();
  const staleThreshold = new Date(
    now.getTime() - STALE_VERIFICATION_DAYS * 24 * 60 * 60 * 1000
  );

  for await (const path of glob(`${SOURCES_DIR}/**/*.yaml`)) {
    count += 1;
    const raw = await readFile(path, 'utf-8');

    let yaml: unknown;
    try {
      yaml = parseYaml(raw);
    } catch (err) {
      errors.push({
        path,
        message: `YAML parse error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    const parsed = SourceIndexEntry.safeParse(yaml);
    if (!parsed.success) {
      errors.push({
        path,
        message: `schema validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
      continue;
    }

    // Filename must match id.
    const expectedFilename = `${parsed.data.id}.yaml`;
    if (basename(path) !== expectedFilename) {
      errors.push({
        path,
        message: `filename mismatch: id is "${parsed.data.id}" but file is "${basename(path)}"`,
      });
    }

    // Path must encode jurisdiction + domain.
    const dir = dirname(path);
    const expectedDir = `${SOURCES_DIR}/${parsed.data.jurisdiction}/${parsed.data.domain}`;
    if (dir !== expectedDir) {
      errors.push({
        path,
        message: `path mismatch: expected ${expectedDir}/, got ${dir}/`,
      });
    }

    // Cross-file id uniqueness.
    const prevIdPath = seenIds.get(parsed.data.id);
    if (prevIdPath) {
      errors.push({
        path,
        message: `duplicate id "${parsed.data.id}" (also in ${prevIdPath})`,
      });
    } else {
      seenIds.set(parsed.data.id, path);
    }

    // Cross-file URL uniqueness (new). Same regulator under two yaml
    // entries is almost always a bug — different access patterns of
    // the same surface should live as one entry with a richer config.
    const normalised = normaliseUrl(parsed.data.url);
    const prevUrlPath = seenUrls.get(normalised);
    if (prevUrlPath) {
      errors.push({
        path,
        message: `duplicate url ${parsed.data.url} (also in ${prevUrlPath})`,
      });
    } else {
      seenUrls.set(normalised, path);
    }

    // last_verified freshness (warning, not error) (new).
    if (parsed.data.last_verified) {
      const lv = new Date(parsed.data.last_verified);
      if (Number.isFinite(lv.getTime()) && lv < staleThreshold) {
        const days = Math.floor((now.getTime() - lv.getTime()) / 86_400_000);
        warnings.push({
          path,
          message: `last_verified is ${days} days old (> ${STALE_VERIFICATION_DAYS}) — re-probe candidate`,
        });
      }
    }

    // access.status ↔ fetch_recipe.requires_browser consistency (new).
    // browser-required entries that *don't* set requires_browser=true on
    // the recipe will fall through to the cheap fetch path and silently
    // return shell HTML. Conversely, requires_browser=true on a verified
    // / static-html-needs-recipe entry is wasted Playwright cost.
    const access = parsed.data.access;
    const recipe = parsed.data.fetch_recipe;
    if (access) {
      const browserRequired = recipe.requires_browser === true;
      if (access.status === 'browser-required' && !browserRequired) {
        errors.push({
          path,
          message: `inconsistency: access.status='browser-required' but fetch_recipe.requires_browser is not true`,
        });
      }
      if (
        browserRequired &&
        (access.status === 'verified' || access.status === 'static-html-needs-recipe')
      ) {
        warnings.push({
          path,
          message: `inconsistency: fetch_recipe.requires_browser=true but access.status='${access.status}' (cheap path would suffice)`,
        });
      }
    }
  }

  // Report.
  if (warnings.length > 0) {
    console.warn(`⚠ ${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.warn(`  ${w.path}: ${w.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} error(s) in ${count} file(s):`);
    for (const e of errors) {
      console.error(`  ${e.path}: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ ${count} Source Index file(s) validate cleanly${
      warnings.length > 0 ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''
    }`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
