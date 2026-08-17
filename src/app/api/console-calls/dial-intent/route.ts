import { NextResponse } from 'next/server';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  MANUAL_DIAL_MAX_LIVE_CALLS,
  consoleManualDialEnabled,
  closeStaleInitiatedCalls,
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
  //
  // confirm_outside_hours waives the daily business-hours window ONLY, and only
  // because the agent was shown it and said yes. Every other gate here is
  // unreachable by it — DNC, opt-out, Shabbat/Yom-Tov and the caller's own stated
  // hours all return before the window is evaluated. An agent returning a missed
  // call at 20:15 is a judgement they may make; calling someone who asked never to
  // be called is not.
  const resolved = await resolveDialTarget(parsed.data, Date.now(), {
    allowOutsideHours: parsed.data.confirm_outside_hours === true,
  });
  if (!resolved.ok) {
    // Privacy-safe — no phone, no name, ever. But the REASON is stable and
    // machine-readable, and `vox_code` carries the platform's own error number
    // when the refusal came from there.
    //
    // The code travels because for the faults an agent cannot fix — a rejected
    // service account, a malformed upstream query, a platform outage — the number
    // is the entire diagnosis. Without it the screen can only say "something went
    // wrong", and whoever reads the report has to reproduce the failure to learn
    // what it was. It identifies a class of error, never a person.
    return json(
      {
        error: 'לא ניתן לחייג כעת',
        reason: resolved.reason,
        ...(resolved.code !== undefined ? { vox_code: resolved.code } : {}),
      },
      403,
    );
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
    // Sweep first, then count. A dial that died before it rang leaves an
    // 'initiated' row nothing else will ever close, and two of them once filled
    // the cap and refused every subsequent dial for ninety minutes. Repairing on
    // the dial path means the fix runs exactly when it matters and needs no cron
    // to be remembered; it is best-effort, and the counter is bounded by age
    // regardless, so a failed sweep cannot refuse a legitimate call.
    await closeStaleInitiatedCalls();
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

  await recordConsoleDialAudit({
    agentId: ctx.userId,
    consoleCallId: callId,
    target: parsed.data,
    outsideHoursOverride: parsed.data.confirm_outside_hours === true,
  });

  // THE TARGET, stated by the side that decided it.
  //
  // The response used to be the token alone, so the app had to source the number
  // it displayed from somewhere else — the history row it was tapped from, or the
  // digits the agent typed. That is two sources of truth for one call: the server
  // decides which number to RING, the device decided which number to SHOW, and a
  // stale row or a resolution the server did differently means an agent watches
  // one number while another is dialled. On a call to a customer that is not a
  // cosmetic defect.
  //
  // `target_phone` is the number this call WILL ring — the same value the token
  // authorises, taken from the resolution rather than from the request. The app
  // displays this and nothing else.
  //
  // It is safe to return: it is the number the agent just asked to call, on a
  // staff-gated route that has already run the full consent chain. What the
  // device still cannot do is CHOOSE it — dial-intent has no shape that accepts a
  // number to ring, and this field is an answer, never an input.
  return json(
    {
      dial: token,
      console_call_id: callId,
      target_phone: resolved.phone,
      call_kind: 'manual',
    },
    200,
  );
}
