// Deterministic post-processing for AI-proposed URLs: verify that the URL
// is reachable. Discovery Agent (per docs/specs/07-agents.md): "Never invents
// a source; every source is a real, reachable URL it verified."
//
// We do that verification in deterministic code, not in the AI. The AI
// proposes; this function disposes.

export type ReachabilityResult =
  | { kind: 'reachable'; status: number }
  | { kind: 'unreachable'; reason: string };

export interface ReachabilityOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

// Tries HEAD first; falls back to a small GET if the server doesn't allow
// HEAD (status 405). 4xx/5xx other than 405-on-HEAD count as unreachable.
// Network failures and timeouts also count as unreachable.
export async function checkReachable(
  url: string,
  options: ReachabilityOptions = {}
): Promise<ReachabilityResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res = await fetcher(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (res.ok) return { kind: 'reachable', status: res.status };
    if (res.status === 405) {
      res = await fetcher(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (res.ok) return { kind: 'reachable', status: res.status };
    }
    return { kind: 'unreachable', reason: `http status ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'unreachable', reason: msg };
  } finally {
    clearTimeout(timeout);
  }
}
