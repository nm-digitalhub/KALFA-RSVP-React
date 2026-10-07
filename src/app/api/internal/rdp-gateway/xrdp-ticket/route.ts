import { getXrdpTicketConfig } from '@/lib/rdp-access/config';
import { bearerOf, cameThroughProxy, jsonNoStore as json, notFoundResponse, withTimeout } from '@/lib/rdp-access/internal-route';
import { RDP_XRDP_TICKET_BODY_MAX_BYTES, RDP_XRDP_TICKET_TIMEOUT_MS } from '@/lib/rdp-access/policy';
import { decideXrdpLogin } from '@/lib/rdp-access/xrdp-login';
import { rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import { createAdminClient } from '@/lib/supabase/admin';
import { xrdpTicketCheckBodySchema } from '@/lib/validation/rdp-access';

// POST /api/internal/rdp-gateway/xrdp-ticket   called BY the desktop's login helper (a root-owned script run from
// the xrdp-sesman PAM stack through pam_exec) whenever the "password" of a desktop login looks like a ticket.
//
//   200 { allow: true }    the login may proceed as the configured account
//   anything else          the PAM line falls through to the ordinary password check, so the owner's own login
//                          keeps working and a refused ticket is not a lockout
//
// The helper never sends a real password: it forwards only a string shaped exactly like a ticket. What the ticket
// proves, and why a downloaded file stops working the moment its grant ends, is in lib/rdp-access/xrdp-ticket.ts
// and xrdp-login.ts. This route only authenticates the caller, bounds the input and answers.
//
// Same transport rules as tunnel-check (loopback only, 404 for anything that came through the public proxy,
// FAIL CLOSED, no reason in the answer), with its OWN Bearer secret, RDPGW_XRDP_CHECK_SECRET: the helper's
// credential can be used for nothing else, and the gateway's cannot be used here. Unsetting either ticket secret
// switches ticket login off: this route answers 503 and every file already downloaded stops logging in.
//
// The ticket is a credential until it expires. It is never logged, and never echoed back.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFUSED = { allow: false as const };
// Coarse flood guard only, NOT a security control (the call comes from one local process).
const RATE = { limit: 120, windowMs: 60_000 } as const;

export async function POST(request: Request) {
  if (cameThroughProxy(request)) return notFoundResponse();

  const config = getXrdpTicketConfig();
  if (!config.ok) return json(REFUSED, 503);

  const presented = bearerOf(request);
  if (presented === null || !safeTokenEqual(presented, sha256Hex(config.config.checkSecret))) {
    return json(REFUSED, 401);
  }

  if (!rateLimit('rdp-xrdp-ticket', RATE).allowed) return json(REFUSED, 429);

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > RDP_XRDP_TICKET_BODY_MAX_BYTES) return json(REFUSED, 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > RDP_XRDP_TICKET_BODY_MAX_BYTES) return json(REFUSED, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(REFUSED, 400);
  }
  const parsed = xrdpTicketCheckBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(REFUSED, 400);

  try {
    const decision = await withTimeout(
      decideXrdpLogin({ admin: createAdminClient(), now: new Date() }, config.config, parsed.data),
      RDP_XRDP_TICKET_TIMEOUT_MS,
    );
    if (!decision.allow) {
      // the reason is for the operator; the caller learns only allow:false. The ticket itself is never logged.
      console.warn(`rdp-access: desktop ticket login refused (${decision.reason})`);
      return json(REFUSED, 200);
    }
    console.info(`rdp-access: desktop ticket login allowed (grant ${decision.grantId})`);
    return json({ allow: true }, 200);
  } catch {
    // Database down or slow: no login by ticket right now. The ordinary password check still runs.
    console.error('rdp-access: desktop ticket login could not be decided');
    return json(REFUSED, 503);
  }
}
