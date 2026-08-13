import { NextResponse } from 'next/server';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  MANUAL_DIAL_MAX_LIVE_CALLS,
  consoleManualDialEnabled,
  countLiveConsoleCalls,
  createConsoleCall,
  mintDialToken,
  recordConsoleDialAudit,
  resolveDialTarget,
} from '@/lib/data/console-calls';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { dialIntentBodySchema } from '@/lib/validation/console-calls';

// POST /api/console-calls/dial-intent   Bearer   body: the two-variant
// consent-matrix union ONLY — {kind:'callback', id} | {kind:'guest_service',
// eventId, contactId}. Never a phone number: the browser can only ever name a
// SERVER-VERIFIED provenance for the dial, matching decide-consent's GO/NO-GO
// table and CLAUDE.md's "never trust submitted identifiers as authorization".
//
// Returns { dial: 'ct<token>' } — a one-time, 60s dial token the operator's
// SDK client dials as the destination (rule ConsoleOut → ConsoleDial.voxengine.js,
// outbound branch). The resolved phone NEVER reaches the browser.
//
// Gate order mirrors decide-consent's route-implementation note exactly:
//   1. requireConsoleAgent + manage_voice
//   2. body shape (union only)
//   3-6. resolveDialTarget: fresh DB load → DNC → opt-out → quiet-hours/Shabbat
//   7. voximplant_live_calls + env kill-switch
//   8. console_manual_dial_enabled flag
//   9. concurrency (live console_calls < 2)
//   10. create console_calls + pii row, mint dial token, audit log

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_BODY_BYTES = 2_048;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!(await callerHasPlatformPermission(ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return json({ error: 'בקשה גדולה מדי' }, 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }
  const parsed = dialIntentBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);

  // 3-6: fresh DB load + DNC + opt-out + quiet-hours/Shabbat, all fail-closed.
  const resolved = await resolveDialTarget(parsed.data);
  if (!resolved.ok) {
    // Generic, privacy-safe — never echo WHICH gate tripped in detail beyond
    // a stable reason code (no phone, no name, ever).
    return json({ error: 'לא ניתן לחייג כעת', reason: resolved.reason }, 403);
  }

  // 7: live-dial gate (admin DB toggle AND env not force-off).
  const vconfig = await getVoximplantConfig();
  if (!vconfig || !vconfig.liveCallsEnabled) {
    return json({ error: 'ערוץ השיחות אינו פעיל' }, 503);
  }

  // 8: manual-dial feature flag.
  if (!(await consoleManualDialEnabled())) {
    return json({ error: 'חיוג ידני אינו פעיל' }, 503);
  }

  // 9: concurrency.
  let live: number;
  try {
    live = await countLiveConsoleCalls();
  } catch {
    return json({ error: 'שגיאה בבדיקת עומס' }, 500);
  }
  if (live >= MANUAL_DIAL_MAX_LIVE_CALLS) {
    return json({ error: 'יותר מדי שיחות פעילות כעת' }, 429);
  }

  // 10: create the row + pii + token. Target-specific linkage only —
  // callback has no event/contact; guest_service has no callback_request_id.
  let callId: string;
  try {
    const created = await createConsoleCall({
      kind: 'manual',
      direction: 'outbound',
      agentId: ctx.userId,
      eventId: resolved.eventId,
      guestId: resolved.guestId,
      contactId: resolved.contactId,
      phoneE164: resolved.phone,
    });
    callId = created.id;
  } catch {
    return json({ error: 'יצירת השיחה נכשלה' }, 500);
  }

  let token: string;
  try {
    token = await mintDialToken(callId);
  } catch {
    return json({ error: 'הנפקת אסימון החיוג נכשלה' }, 500);
  }

  await recordConsoleDialAudit({ agentId: ctx.userId, consoleCallId: callId, target: parsed.data });

  return json({ dial: token }, 200);
}
