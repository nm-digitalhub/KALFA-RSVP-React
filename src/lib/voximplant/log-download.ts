import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

// SSRF-hardened download of a Voximplant session-log file.
//
// The log_file_url comes from an EXTERNAL API response and is treated as
// untrusted input end-to-end. Gates, in order (every one fail-closed):
//   1. URL shape: https only, port 443 only, no credentials, host allowlist
//      (Voximplant storage-gateway patterns — same family recording-url.ts
//      verified empirically; a mismatch is recorded so a live run
//      (scripts/voximplant/fetch-session-log.ts) can reveal the real log host
//      and extend the allowlist DELIBERATELY).
//   2. DNS: resolve the host and reject if ANY address is private/reserved
//      (RFC1918, loopback, link-local/metadata, CGNAT, ULA, v4-mapped).
//   3. Fetch: redirect:'manual' — ANY 3xx is rejected; response size capped.
//   4. Auth: anonymous GET first; the Management JWT is attached ONLY on a
//      401/403 retry (docs require it only when the application has "Secure
//      storage of applications and logs" enabled — verify live with
//      scripts/voximplant/fetch-session-log.ts), and only to a URL that already
//      passed gates 1-2.
//
// Known limitation (documented): the resolved-IP check and the fetch are two
// steps (DNS TOCTOU). The primary gate is the strict host allowlist — only
// Voximplant-controlled hostnames ever reach fetch — so a rebinding attack
// requires control of Voximplant's own DNS. Accepted residual risk.

// Voximplant cloud storage gateways (same empirical base as recording-url.ts):
// storage-gw-<region>-<nn>.voximplant.com. Log files may ship from a different
// voximplant host — extend ONLY via LOG_HOST_EXTRA after a verified live run.
const LOG_HOST_PATTERN = /^storage-gw-[a-z]{2}-\d{2}\.voximplant\.com$/;
export const LOG_HOST_EXTRA: readonly string[] = [];

export const MAX_LOG_BYTES = 5 * 1024 * 1024; // >5MB → failed with reason

export type LogUrlRejection =
  | 'unparseable'
  | 'not_https'
  | 'bad_port'
  | 'has_credentials'
  | 'host_not_allowlisted'
  | 'private_ip'
  | 'dns_failed'
  | 'redirect'
  | 'too_large'
  | 'http_error'
  | 'transport';

export interface LogUrlCheck {
  ok: boolean;
  host?: string;
  reason?: LogUrlRejection;
}

// Gate 1 — pure URL validation (no IO).
export function validateLogUrl(raw: string, extraHosts: readonly string[] = LOG_HOST_EXTRA): LogUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, reason: 'bad_port' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'has_credentials' };
  const host = parsed.hostname.toLowerCase();
  const allowed = LOG_HOST_PATTERN.test(host) || extraHosts.some((h) => host === h.toLowerCase());
  if (!allowed) return { ok: false, reason: 'host_not_allowlisted' };
  return { ok: true, host };
}

// Gate 2 — private/reserved address detection for BOTH families, including
// IPv4-mapped IPv6 forms (::ffff:10.0.0.1).
export function isPrivateIp(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  // DNS results must be valid, globally routable addresses. process() also
  // normalizes hexadecimal and dotted IPv4-mapped IPv6 forms before checking.
  if (!ipaddr.isValid(a)) return true;
  return ipaddr.process(a).range() !== 'unicast';
}

export interface LogDownloadDeps {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string }>>;
  jwtProvider?: () => string; // Management JWT — used ONLY on a 401/403 retry
  maxBytes?: number;
  timeoutMs?: number;
}

export type LogDownloadResult =
  | { ok: true; bytes: Buffer; contentType: string; authUsed: boolean }
  | { ok: false; reason: LogUrlRejection; status?: number };

async function fetchOnce(
  url: string,
  auth: string | null,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Gates 1-4 composed. Every failure is a typed reason; nothing throws for a
// policy rejection (only truly unexpected programmer errors propagate).
export async function downloadLogFile(
  rawUrl: string,
  deps: LogDownloadDeps = {},
): Promise<LogDownloadResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupImpl =
    deps.lookupImpl ?? (async (h: string) => (await dnsLookup(h, { all: true })).map((r) => ({ address: r.address })));
  const maxBytes = deps.maxBytes ?? MAX_LOG_BYTES;
  const timeoutMs = deps.timeoutMs ?? 30_000;

  const urlCheck = validateLogUrl(rawUrl);
  if (!urlCheck.ok || !urlCheck.host) {
    return { ok: false, reason: urlCheck.reason ?? 'unparseable' };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupImpl(urlCheck.host);
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns_failed' };
  if (addresses.some((r) => isPrivateIp(r.address))) {
    return { ok: false, reason: 'private_ip' };
  }

  const attempt = async (auth: string | null): Promise<LogDownloadResult> => {
    let res: Response;
    try {
      res = await fetchOnce(rawUrl, auth, fetchImpl, timeoutMs);
    } catch {
      return { ok: false, reason: 'transport' };
    }
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, reason: 'redirect', status: res.status };
    }
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
    const declared = Number(res.headers?.get?.('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { ok: false, reason: 'too_large' };
    return {
      ok: true,
      bytes: buf,
      contentType: res.headers?.get?.('content-type') ?? '',
      authUsed: auth !== null,
    };
  };

  const anonymous = await attempt(null);
  if (
    !anonymous.ok &&
    anonymous.reason === 'http_error' &&
    (anonymous.status === 401 || anonymous.status === 403) &&
    deps.jwtProvider
  ) {
    return attempt(deps.jwtProvider());
  }
  return anonymous;
}
