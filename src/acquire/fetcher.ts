import * as crypto from 'node:crypto';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import { CONTACT_EMAIL, USER_AGENT } from './user-agent';

export interface FetchResult {
  status: number;
  url: string;
  contentType: string | null;
  bytes: Uint8Array;
}

export interface FetchOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

// Undici Agent that re-enables OpenSSL legacy renegotiation. A surprising
// number of Indian government portals (e.g. gazettes.uk.gov.in,
// observed 2026-06-07) run TLS stacks that require legacy renegotiation
// during the handshake. Node's default Undici dispatcher refuses this and
// throws ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED. `curl` happens to
// accept these handshakes by default, which is why a probe via curl
// returns 200 while a probe via Node's fetch throws — a confusing gap
// that wasted hours of investigation on the karmika pilot.
//
// This Agent is process-singleton so we don't re-create the TLS context
// per call. It is only injected when `options.fetcher` is undefined; tests
// supplying a mock fetcher are unaffected.
const legacyTlsAgent = new UndiciAgent({
  connect: {
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  },
});

// Fetches a source URL with a polite User-Agent, a timeout, and follow-redirects.
// No retries: failures surface immediately so the caller (orchestrator) can
// decide whether to retry, log, or proceed. Network errors and non-2xx
// responses both throw.
export async function fetchSource(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  // Default to undici with our legacy-TLS Agent. Tests injecting a mock
  // fetcher use the supplied implementation as-is (no Agent injection).
  const fetcher = options.fetcher ?? (undiciFetch as unknown as typeof fetch);
  const useLegacyTlsAgent = options.fetcher === undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: Parameters<typeof fetch>[1] = {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/pdf,image/png,image/jpeg,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        From: CONTACT_EMAIL,
      },
      signal: controller.signal,
    };
    if (useLegacyTlsAgent) {
      // Cast: dispatcher is an Undici-specific extension, not part of the
      // standard fetch RequestInit type.
      (init as { dispatcher?: unknown }).dispatcher = legacyTlsAgent;
    }
    const res = await fetcher(url, init);
    if (!res.ok) {
      throw new Error(`fetchSource(${url}): HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get('content-type'),
      bytes: new Uint8Array(arrayBuffer),
    };
  } finally {
    clearTimeout(timer);
  }
}
