import { NextResponse } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { safeTokenEqual, sha256Hex } from '@/lib/security/token-compare';
import {
  consoleWakeEnabled,
  findRoutableAgentVoxUsernames,
  recordConsoleWakeRetryAudit,
} from '@/lib/data/console-calls';
import { routeInboundRetryBodySchema } from '@/lib/validation/console-calls';

// POST /api/voximplant/console/route-inbound-retry   called BY
// ConsoleInbound.voxengine.js's ringNext, ONCE, only after the original
// server-computed ring_order is exhausted (see the scenario's ringNext for
// the call site). The "written but not deployed" caveat that used to live
// here is stale: a read-only fetch of the DEPLOYED scenario text (#919510,
// `npm run voximplant -- scenario --id 919510`, console audit 12.8)
// confirmed this exact HTTP call is present in what is live on Voximplant.
// That only proves the scenario SOURCE reached the platform — this audit did
// NOT confirm the rule binding is live, that consoleWakeEnabled is on (it
// gates this route to always-empty when off), or that a retry has actually
// fired on a real call. Re-verify those separately before relying on this
// path in a live test.
//
// WHY THIS EXISTS (wake-and-answer research, 12.8): route-inbound computes
// ring_order ONCE, before Call.answer(). ConsoleInbound then walks that
// static array — an agent who connects via a push-wake AFTER the original
// ring was computed is architecturally invisible to the in-progress call no
// matter how fast they arrive, unless something re-checks for newly-routable
// agents before the call gives up. This route is that re-check.
//
// Deliberately NOT a second admission decision: the call is already
// admitted (route-inbound's caps already ran), so this does not re-evaluate
// flagEnabled/liveCallsEnabled/balance/concurrency — only whether MORE
// agents are routable NOW than were at the original ring's computation.
// Fails CLOSED on consoleWakeEnabled: if the capability is off, this always
// returns an empty ring_order (a harmless no-op — the scenario's retry wave
// simply finds nobody and falls through to the existing NO_AGENT_LINE_HE
// path, byte-identical to today's behaviour).
//
// Always 200 with a possibly-empty ring_order — like /event, there is no
// reply channel inside a live VoxEngine session for the scenario to branch
// on beyond parsing this body, so refusal states are distinguished by an
// empty array, never a non-200 the scenario would have to special-case.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 1_024;
// Same coarse per-IP flood guard shape as route-inbound — at most one retry
// call per in-progress inbound call, so this is far looser than needed in
// practice.
const RATE = { limit: 120, windowMs: 60_000 } as const;

const EMPTY = { ring_order: [] as string[] };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const ip = getClientIp(request.headers.get.bind(request.headers));
  if (!rateLimit(`vox-console-route-inbound-retry:${ip}`, RATE).allowed) {
    return json(EMPTY, 200);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json(EMPTY, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(EMPTY, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(EMPTY, 400);
  }
  const parsed = routeInboundRetryBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(EMPTY, 400);
  const body = parsed.data;

  const expected = process.env.KALFA_CONSOLE_SECRET;
  if (!expected) return json(EMPTY, 503);
  if (!safeTokenEqual(body.secret, sha256Hex(expected))) {
    return json(EMPTY, 401);
  }

  if (!(await consoleWakeEnabled())) return json(EMPTY, 200);

  let ringOrder: string[];
  try {
    const alreadyTried = new Set(body.already_tried);
    const routable = await findRoutableAgentVoxUsernames();
    ringOrder = routable.filter((u) => !alreadyTried.has(u));
  } catch {
    return json(EMPTY, 200); // fail toward "nobody new", never a hard error the scenario must handle
  }

  void recordConsoleWakeRetryAudit({ consoleCallId: body.call_id, foundCount: ringOrder.length });

  return json({ ring_order: ringOrder }, 200);
}
