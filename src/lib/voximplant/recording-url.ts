// Validate an untrusted `recording_url` from the Voximplant callback BEFORE
// storing it. We NEVER fetch it (no SSRF surface here) — this only decides
// whether the string is safe to persist as an admin-only reference.
//
// Recording host — EMPIRICALLY VERIFIED (2026-07-14): every one of 1,418 real
// recording URLs for this account (10694307, GetRecordStorages = cloud, no custom
// S3) resolved to `storage-gw-us-01.voximplant.com` (path `voxdata-us-rec-secure`,
// Voximplant US secure cloud storage). The `-us-01` is a NUMBERED regional
// gateway, so we allow the exact verified gateway PATTERN (tolerant of gateway
// renumbering / a region change) but NOT a bare `*.voximplant.com` wildcard.
// If the account is ever switched to custom S3 storage, add that host below.
//
// Checklist (OWASP SSRF Prevention Cheat Sheet): parse with new URL (not regex),
// require https, reject IP-literal / loopback / private / link-local hosts, and
// match host against a strict allowlist. We never fetch the URL.

// Strict pattern for Voximplant cloud storage gateways: storage-gw-<region>-<nn>.voximplant.com
const RECORDING_HOST_PATTERN = /^storage-gw-[a-z]{2}-\d{2}\.voximplant\.com$/;

// The private/loopback/link-local test moved to @/lib/net/private-host on
// 2026-09-13 when the outgoing-webhook node became a second caller. Behaviour is
// unchanged; this file's own tests still cover it through validateRecordingUrl.
import { isPrivateOrLocalHost } from '@/lib/net/private-host';

// Extra exact hosts (e.g. a custom S3 endpoint) — empty today (account uses cloud).
export const RECORDING_HOST_ALLOWLIST: readonly string[] = [];

export type RecordingUrlResult = { url: string | null; reason?: string };

// Returns { url } to store, or { url: null, reason } to drop. A null input is a
// valid "no recording" (not an error).
export function validateRecordingUrl(
  raw: string | null | undefined,
  allowlist: readonly string[] = RECORDING_HOST_ALLOWLIST,
): RecordingUrlResult {
  if (raw == null || raw === '') return { url: null };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, reason: 'unparseable' };
  }
  if (parsed.protocol !== 'https:') return { url: null, reason: 'not_https' };
  if (parsed.username || parsed.password) return { url: null, reason: 'has_credentials' };
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrLocalHost(host)) return { url: null, reason: 'private_host' };
  const allowed =
    RECORDING_HOST_PATTERN.test(host) ||
    allowlist.some((h) => host === h.toLowerCase());
  if (!allowed) return { url: null, reason: 'host_not_allowlisted' };
  return { url: raw };
}
