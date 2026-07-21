import 'server-only';

import type { CommandEnvelope } from '@/lib/validation/agent-console';

// Server → live VoxEngine session command delivery.
//
// The session's "media access" URL is a CAPABILITY, not an identifier: whoever
// holds its path token can command the running call (including hanging up on the
// guest). StartScenarios returns two handles — an HTTPS one and a plain HTTP one
// (to a media node by raw IP). We PREFER the HTTPS handle so a control token that
// can terminate a live guest call never crosses the network in cleartext, and fall
// back to the plain one only when the provider omitted the secure sibling.
//
// The URL is read only from our own DB (recordDialConfirmed), never from a client.
// Even so we guard in depth: scheme must be http/https, obvious SSRF targets
// (loopback / link-local / cloud-metadata) are refused, redirects are never
// followed, and the URL is NEVER logged.

const POST_TIMEOUT_MS = 4000;

function blockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (h.startsWith('127.')) return true; // IPv4 loopback
  if (h.startsWith('169.254.')) return true; // link-local + cloud metadata (169.254.169.254)
  return false;
}

function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (blockedHost(u.hostname)) return null;
  return u;
}

/**
 * Choose the URL to command the live session with: the HTTPS handle when present
 * and valid, else the plain HTTP handle. Returns null when neither is usable.
 */
export function pickSessionUrl(
  secure: string | null | undefined,
  plain: string | null | undefined,
): URL | null {
  return safeUrl(secure) ?? safeUrl(plain);
}

export interface DeliveryResult {
  // The managing request reached the live session (AppEvents.HttpRequest fired).
  // This is NOT "the command was applied" — that acknowledgement is out-of-band.
  delivered: boolean;
  status?: number;
}

/**
 * POST a command envelope to the live session's managing URL. A 2xx response means
 * the managing request was delivered to the session; it does not prove the command
 * took effect (the applied ack returns out-of-band). Fails closed on any transport
 * error / non-2xx / timeout. Never logs the URL or the token it carries.
 */
export async function postCommandToSession(
  sessionUrl: URL,
  envelope: CommandEnvelope,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(sessionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      redirect: 'error',
      signal: controller.signal,
    });
    return { delivered: res.ok, status: res.status };
  } catch {
    return { delivered: false };
  } finally {
    clearTimeout(timer);
  }
}
