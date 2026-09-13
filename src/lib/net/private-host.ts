// Is a hostname one that must never be reached from a server-side fetch?
//
// Extracted 2026-09-13 from `voximplant/recording-url.ts`, where it had lived
// since the recording-URL validator was written against the OWASP SSRF
// Prevention Cheat Sheet. It moved because a SECOND caller appeared — the
// outgoing-webhook workflow node, which unlike that one actually FETCHES the URL
// — and a copy would have meant two lists of private ranges drifting apart, with
// the copy that matters more being the newer and less reviewed one.
//
// Pure, and imports nothing: it is read by the pg-boss worker.
//
// ⚠️ NAME RESOLUTION IS NOT CHECKED HERE, and cannot be. This tests the STRING.
// A hostname that resolves to 127.0.0.1 (a DNS rebind, or simply an internal
// name on a public zone) passes and is a real residual risk for any caller that
// fetches. Closing it needs resolution + a pinned-IP connection at the socket
// layer, which Node's stock `fetch` does not expose. Callers that fetch must say
// so where they fetch, rather than reading this module as a guarantee it does
// not give.

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * True when the hostname is loopback, private, link-local, or a bare IP literal.
 *
 * BARE IPv4 IS ALWAYS TRUE, including public addresses. That is deliberate for
 * both callers: a recording CDN is never an IP literal, and an outgoing webhook
 * addressed by number rather than by name is either internal or something nobody
 * should be typing into an admin form. Requiring a hostname costs a legitimate
 * caller nothing and removes the whole "is this particular IP internal" question.
 *
 * `169.254.169.254` — the cloud instance-metadata address, the classic SSRF
 * target — is covered by the link-local branch, and again by the bare-IPv4 rule.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv6 loopback / unique-local / link-local
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
    return true;
  }
  if (IPV4_RE.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true; // loopback / private / this-host
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    return true; // any bare IPv4 literal — see the note above
  }
  return false;
}
