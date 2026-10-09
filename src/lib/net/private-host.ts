import ipaddr from 'ipaddr.js';

// Is a hostname one that must never be reached from a server-side fetch?
//
// Shared by `voximplant/recording-url.ts` (written against the OWASP SSRF
// Prevention Cheat Sheet) and the outgoing-webhook workflow node
// (`workflow/webhook-url.ts`), which unlike that one actually FETCHES the URL.
// It is one list rather than a copy per caller, because two lists of private
// ranges would drift apart.
//
// Pure; also used by the pg-boss worker.
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
  if (IPV4_RE.test(h)) return true; // Preserve the ban on every bare IPv4 literal.
  if (!ipaddr.isValid(h)) return false;
  const address = ipaddr.process(h); // Normalize IPv4-mapped IPv6 before classification.
  if (address.kind() === 'ipv4') return true;
  return address.range() !== 'unicast';
}
