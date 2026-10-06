import 'server-only';

import { z } from 'zod';

import type { RdpGatewayConfig } from './config';
import { RDP_FILE_MAX_BYTES } from './policy';

// Loopback client for the gateway (rdpgw patched fork, 127.0.0.1 only): the admin listener (disconnect) and the
// /connect endpoint that issues the signed .rdp file.
//
// Everything that can go wrong is reported as a fixed `kind`, never as a response body, a header or the
// secret: the result is stored in a `last_cut_error` column and put in alerts. `redirect: 'manual'`
// keeps a compromised listener from bouncing the Bearer token to another host.

const ADMIN_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 4000;
const MAX_RESPONSE_BYTES = 65_536;

export type RdpGatewayFailureKind = 'unreachable' | 'timeout' | 'rejected' | 'bad_response';
export type RdpGatewayResult<T> = { ok: true; value: T } | { ok: false; kind: RdpGatewayFailureKind };

const disconnectResponseSchema = z.object({ closed: z.number().int().nonnegative() });

/** Which tunnels to close: every tunnel of the gateway identity, or one tunnel by id. */
export type RdpDisconnectSelector = { user: string } | { tunnelId: string };

export async function disconnectRdpTunnels(
  config: Pick<RdpGatewayConfig, 'adminOrigin' | 'adminSecret'>,
  selector: RdpDisconnectSelector,
): Promise<RdpGatewayResult<{ closed: number }>> {
  let response: Response;
  try {
    response = await fetch(`${config.adminOrigin}/admin/v1/disconnect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.adminSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(selector),
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, kind: timedOut ? 'timeout' : 'unreachable' };
  }

  if (!response.ok) return { ok: false, kind: 'rejected' };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, kind: 'bad_response' };
  }
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false, kind: 'bad_response' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'bad_response' };
  }
  const parsed = disconnectResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, kind: 'bad_response' };
  return { ok: true, value: { closed: parsed.data.closed } };
}

// ── /admin/v1/tunnels: who is connected right now ────────────────────────────────

// Go encodes an empty slice as `null`, so "nobody connected" is `{"tunnels":null}` as often as `[]`.
const tunnelsResponseSchema = z.object({
  tunnels: z
    .array(
      z.object({
        tunnelId: z.string().max(128),
        user: z.string().max(256),
        clientIp: z.string().max(64),
        target: z.string().max(300),
        connectedOn: z.string().max(64),
      }),
    )
    .nullable(),
});

export type RdpLiveTunnel = { tunnelId: string; user: string; clientIp: string; target: string; connectedOn: string };

/** The tunnels the gateway holds open right now (what the owner screen calls LIVE). Fixed failure kinds only. */
export async function listRdpTunnels(
  config: Pick<RdpGatewayConfig, 'adminOrigin' | 'adminSecret'>,
): Promise<RdpGatewayResult<{ tunnels: RdpLiveTunnel[] }>> {
  let response: Response;
  try {
    response = await fetch(`${config.adminOrigin}/admin/v1/tunnels`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.adminSecret}` },
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, kind: timedOut ? 'timeout' : 'unreachable' };
  }
  if (!response.ok) return { ok: false, kind: 'rejected' };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, kind: 'bad_response' };
  }
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false, kind: 'bad_response' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'bad_response' };
  }
  const parsed = tunnelsResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, kind: 'bad_response' };
  return { ok: true, value: { tunnels: parsed.data.tunnels ?? [] } };
}

// ── /connect: the signed .rdp file ───────────────────────────────────────────

const clientIpSchema = z.union([z.ipv4(), z.ipv6()]);

/**
 * Ask the gateway for the .rdp file of one staff member's connection.
 *
 * The gateway signs in as the OS account `gatewayUser` (header authentication, the identity every token carries)
 * and proves the caller is this app, not any local process, with the separate connect secret. `clientIp` is the
 * staff member's address as the PUBLIC proxy saw it: the token is bound to it, so a file that leaks is useless
 * from another address. Callers take it from x-real-ip (set by nginx), never from the first x-forwarded-for
 * element, which the client controls.
 *
 * The file is returned as text for rdp-file.ts to validate; it is never stored or logged here.
 */
export async function connectRdpFile(
  config: Pick<RdpGatewayConfig, 'gatewayOrigin' | 'connectSecret' | 'gatewayUser' | 'target'>,
  clientIp: string,
): Promise<RdpGatewayResult<{ text: string }>> {
  // A malformed address would put attacker-shaped text into a header. It is a caller bug, reported as a refusal.
  if (!clientIpSchema.safeParse(clientIp).success) return { ok: false, kind: 'rejected' };

  let response: Response;
  try {
    response = await fetch(`${config.gatewayOrigin}/connect?host=${encodeURIComponent(config.target)}`, {
      method: 'GET',
      headers: {
        'X-Kalfa-Staff-Id': config.gatewayUser,
        'X-Kalfa-Internal': config.connectSecret,
        'X-Forwarded-For': clientIp,
      },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, kind: timedOut ? 'timeout' : 'unreachable' };
  }

  if (response.status !== 200) return { ok: false, kind: 'rejected' };

  const contentType = response.headers.get('content-type') ?? '';
  if (!/^(application\/x-rdp|text\/plain)\b/i.test(contentType)) return { ok: false, kind: 'bad_response' };
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > RDP_FILE_MAX_BYTES) return { ok: false, kind: 'bad_response' };

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, kind: 'bad_response' };
  }
  if (text === '' || Buffer.byteLength(text, 'utf8') > RDP_FILE_MAX_BYTES) return { ok: false, kind: 'bad_response' };
  return { ok: true, value: { text } };
}
