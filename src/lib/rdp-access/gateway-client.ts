import 'server-only';

import { z } from 'zod';

import type { RdpGatewayConfig } from './config';

// Loopback client for the gateway's admin listener (rdpgw patched fork, 127.0.0.1 only).
//
// Everything that can go wrong is reported as a fixed `kind`, never as a response body, a header or the
// secret: the result is stored in a `last_cut_error` column and put in alerts. `redirect: 'manual'`
// keeps a compromised listener from bouncing the Bearer token to another host.

const ADMIN_TIMEOUT_MS = 4000;
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
