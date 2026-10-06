import { NextResponse } from 'next/server';

import { rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRdpGatewayConfig } from '@/lib/rdp-access/config';
import { RDP_GATEWAY_CHECK_BODY_MAX_BYTES, RDP_GATEWAY_CHECK_TIMEOUT_MS } from '@/lib/rdp-access/policy';
import { checkRdpTunnel } from '@/lib/rdp-access/service';
import { rdpGatewayCheckBodySchema } from '@/lib/validation/rdp-access';

// POST /api/internal/rdp-gateway/tunnel-check   called BY the remote-desktop gateway (rdpgw, patched fork)
// for EVERY new tunnel, after it has validated the signed token in the .rdp file. The gateway is never
// trusted to decide on its own whether a tunnel may open: it only opens one when this route says so.
//
//   200 { allow: true, grantId, expiresAt }   open the tunnel (and close it at expiresAt)
//   anything else                              the gateway treats it as a REFUSAL
//
// FAIL CLOSED at every layer. The reason for a refusal stays in the audit log (rdp_access_events) and is never
// returned: the caller learns only allow:false.
//
// Called over loopback straight to the Next.js port. A request that came through the public vhost always
// carries X-Real-IP (beta-proxy.conf sets it on every proxied request) and is answered 404 as if the route did
// not exist. (nginx also denies /api/internal/rdp-gateway/ on the public host; this is the second layer for the
// day that rule is missing.) The x-forwarded-* headers can NOT be used for this: the Next.js server adds
// x-forwarded-for/-host/-proto/-port to EVERY incoming request itself (base-server.js), including the gateway's
// direct loopback call, so a guard on them refuses the gateway too. getClientIp is deliberately not used for any
// decision here: its first x-forwarded-for element is client-controlled.
//
// The Bearer secret is RDPGW_CHECK_SECRET. Removing it (or any other gateway variable) switches the whole
// feature off: this route answers 503 and no tunnel opens. That is the app-side kill switch.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const REFUSED = { allow: false as const };
// Coarse flood guard only, NOT a security control (the call comes from one local process).
const RATE = { limit: 600, windowMs: 60_000 } as const;

// Headers only a reverse proxy adds (Next.js never sets either). Their presence means the request did not come
// straight from the gateway. Do not add x-forwarded-*: Next sets those on every request.
const PROXY_HEADERS = ['x-real-ip', 'forwarded'] as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('failed'));
      },
    );
  });
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
}

export async function POST(request: Request) {
  if (PROXY_HEADERS.some((name) => request.headers.has(name))) {
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }

  const config = getRdpGatewayConfig();
  if (!config.ok) return json(REFUSED, 503);

  const presented = bearerOf(request);
  if (presented === null || !safeTokenEqual(presented, sha256Hex(config.config.checkSecret))) {
    return json(REFUSED, 401);
  }

  if (!rateLimit('rdp-gateway-check', RATE).allowed) return json(REFUSED, 429);

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > RDP_GATEWAY_CHECK_BODY_MAX_BYTES) {
    return json(REFUSED, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > RDP_GATEWAY_CHECK_BODY_MAX_BYTES) return json(REFUSED, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(REFUSED, 400);
  }
  const parsed = rdpGatewayCheckBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);
  const body = parsed.data;

  // The gateway identity IS the configured OS account. Any other value means the caller is not the gateway
  // this app is wired to, so the answer is a refusal without touching the database.
  if (body.user !== config.config.gatewayUser) return json(REFUSED, 200);

  try {
    const result = await withTimeout(
      checkRdpTunnel(createAdminClient(), {
        target: body.target,
        clientIp: body.clientIp,
        tunnelRef: body.tunnelId ?? body.rdgConnectionId ?? '',
      }),
      RDP_GATEWAY_CHECK_TIMEOUT_MS,
    );
    if (!result.allow || result.grantId === null || result.expiresAt === null) return json(REFUSED, 200);
    return json({ allow: true, grantId: result.grantId, expiresAt: result.expiresAt }, 200);
  } catch {
    // Database down, slow or erroring: the tunnel does not open. A tunnel that is already open stays open
    // until its own deadline; the gateway closes it at the grant's expiry by itself.
    return json(REFUSED, 503);
  }
}
