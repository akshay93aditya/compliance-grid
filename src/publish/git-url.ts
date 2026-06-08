// Parse GitHub git URLs and resolve fork-vs-upstream PR targets for cg publish.
//
// Supports the canonical-maintainer flow (push to upstream, PR within upstream)
// AND the external-contributor flow (push to fork, PR cross-repo to upstream).

export interface RepoRef {
  owner: string;
  name: string;
}

export interface GhPrTarget {
  // The repo the PR is created IN (--repo)
  repo: string;
  // The head ref (--head). For same-repo flows this is just <branch>.
  // For cross-fork it's <fork-owner>:<branch>.
  head: string;
}

const GITHUB_URL_PATTERNS: RegExp[] = [
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
];

export function parseRepoFromGitUrl(url: string): RepoRef {
  for (const re of GITHUB_URL_PATTERNS) {
    const m = url.match(re);
    if (m && m[1] && m[2]) return { owner: m[1], name: m[2] };
  }
  throw new Error(
    `cannot parse GitHub repo from url: ${url}` +
      ` (expected git@github.com:owner/name.git or https://github.com/owner/name.git)`
  );
}

const OWNER_REPO_RE = /^([^/]+)\/([^/]+)$/;

export function parseOwnerRepo(slug: string): RepoRef {
  const m = slug.match(OWNER_REPO_RE);
  if (!m || !m[1] || !m[2]) {
    throw new Error(
      `expected upstream as 'owner/name', got: ${JSON.stringify(slug)}`
    );
  }
  return { owner: m[1], name: m[2] };
}

// Decide where to open the PR and what --head to pass to `gh pr create`.
//
// `remote` is what the publisher pushed to (always required).
// `upstream` (owner/name slug) is where the PR should land. If omitted or
// identical to `remote`, we open the PR in the same repo we pushed to —
// the canonical-maintainer flow.
// If `upstream` differs (cross-fork), we open the PR cross-repo against
// upstream with --head <remote-owner>:<branch>.
export function resolveGhPrTarget(args: {
  remote: string;
  upstream?: string;
  branch: string;
}): GhPrTarget {
  const remoteRef = parseRepoFromGitUrl(args.remote);
  const remoteSlug = `${remoteRef.owner}/${remoteRef.name}`;

  if (!args.upstream || args.upstream === remoteSlug) {
    return { repo: remoteSlug, head: args.branch };
  }

  const upstreamRef = parseOwnerRepo(args.upstream);
  if (upstreamRef.name !== remoteRef.name) {
    throw new Error(
      `cg publish: upstream repo name (${upstreamRef.name}) does not match remote repo name (${remoteRef.name}). ` +
        `For cross-fork publishing, the fork must have the same repo name as upstream.`
    );
  }
  return {
    repo: `${upstreamRef.owner}/${upstreamRef.name}`,
    head: `${remoteRef.owner}:${args.branch}`,
  };
}
