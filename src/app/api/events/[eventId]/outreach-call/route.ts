import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { recordDispatchAccepted, settleDispatchFailure } from '@/lib/data/call-dispatch-status';
import { isContactReached } from '@/lib/data/outreach-engine';
import { CALL_RETRY, QUEUES, type OutreachCallRequest } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/events/{eventId}/outreach-call   body: { guest_id }
//
// ENQUEUE-ONLY, with exactly ONE gate. The console asks to place ONE outbound
// AI call to an EXISTING guest. This route never dials: it runs the
// already-reached PREFLIGHT (a synchronous 409 with a typed domain code, so the
// app never gets a 202 for a dial the worker is certain to refuse) and then
// only enqueues an `outreach-call-request` job. Every OTHER gate — consent /
// DNC / campaign-active / concurrency / hourly-cap / balance / event-closed =
// Gate 4b — stays in the worker's dispatchOutreachCall, which re-checks
// already-reached too as race protection (src/lib/data/outreach-calls.ts).
// Mirrors exactly how the outreach engine enqueues a call touchpoint
// (src/lib/data/outreach-engine.ts:726-737).
//
// Auth: requireConsoleAgent (Bearer + staff-gated is_console_agent) +
// has_platform_permission('manage_voice') — same authority gate as the live-call
// command routes.
//
// ── DECISIONS ────────────────────────────────────────────────────────────────
// [D3]   CLOSED (2026-07-22): already_reached has NO manual bypass. The
//        preflight answers 409 code='already_reached'; the worker's own check
//        stays as race protection; the SOLE exemption is a guest-requested
//        callback (isCallback), which is enqueued by the callback sweep and
//        never passes through this route.
// ── OPEN DECISIONS ───────────────────────────────────────────────────────────
// [ARCH] The web tier has NO pg-boss instance elsewhere — every other
//        boss.send() lives in the worker. Enqueuing from a route therefore
//        opens a SEND-ONLY PgBoss (below). 'pg-boss' is already in
//        next.config serverExternalPackages, so it is not bundled into the
//        server build.
// [D1]   scriptKey — dispatchOutreachCall forwards it as the touchpoint script.
//        'manual_console_call' must be a script the ctx/scenario understands, or
//        reuse the campaign's call script key.
// [D2]   touchpointIndex uniqueness — a fixed index makes getCallAttemptByTouchpoint
//        return `already_dispatched` on a re-dial. A manual dial uses a unique lane
//        (below) so re-dialling the same guest is allowed.
// [D4]   which campaign — an event may have >1 campaign; picking the right one
//        (active?) is a product decision (see the .limit(1) TODO below).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuid = z.string().uuid();
const bodySchema = z.strictObject({ guest_id: z.string().uuid() });

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// [ARCH] Send-only pg-boss for the web tier. Same connection as the worker
// (worker/main.ts:373-388) but with supervise+schedule OFF so a route never runs
// maintenance or cron — it only calls .send(). Module singleton: connect once.
let sender: PgBoss | null = null;
async function getSender(): Promise<PgBoss> {
  if (sender) return sender;
  const boss = new PgBoss({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    schema: 'pgboss',
    application_name: 'kalfa-web-sender',
    max: 2,
    supervise: false,
    schedule: false,
    // The load-bearing flag. pg-boss defaults migrate to TRUE, and start()
    // branches on it: migrate -> contractor.start() (creates the schema if
    // absent, migrates it if older), otherwise contractor.check() (verifies
    // only, and THROWS on a missing or mismatched schema).
    //
    // Without this the web tier would attempt a pg-boss schema migration on
    // every cold start, racing the worker that owns it. With it, a deployment
    // whose web bundle expects a different schema version fails loudly at
    // boss.start() instead of sending jobs against a schema it does not match.
    //
    // createSchema (also defaulting to true) is deliberately NOT set: it is
    // only read inside contractor.create(), which check() never reaches. Adding
    // it would document the wrong mechanism — the gate is migrate.
    migrate: false,
  });
  await boss.start();
  sender = boss;
  return boss;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!(await callerHasPlatformPermission(auth.ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { eventId } = await params;
  if (!uuid.safeParse(eventId).success) return json({ error: 'מזהה אירוע לא תקין' }, 400);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);

  // Resolve the dial target from OUR data only (never a client-supplied phone):
  // event → its campaign; guest → contact → dialable phone. Service-role read.
  const admin = createAdminClient();

  // Exactly one ACTIVE campaign, or refuse. Status is not optional here: every
  // campaign is created as 'draft', and dispatchOutreachCall hard-refuses a
  // non-active one — so a .limit(1) that happened to pick a draft would answer
  // 202 and then silently never dial. Observed live on 2026-07-21.
  //
  // Ambiguity is refused rather than resolved. There is no DB constraint making
  // one-campaign-per-event true (only the PK), so picking "the first" of several
  // would mean dialling on behalf of a campaign nobody chose.
  const { data: campaigns, error: cErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'active');
  if (cErr) return json({ error: 'טעינת הקמפיין נכשלה' }, 500);
  if (!campaigns || campaigns.length === 0) {
    return json({ error: 'לאירוע אין קמפיין פעיל' }, 409);
  }
  if (campaigns.length > 1) {
    return json({ error: 'לאירוע יותר מקמפיין פעיל אחד — לא ניתן לקבוע לאיזה לחייג' }, 409);
  }
  const campaign = campaigns[0];

  const { data: guest } = await admin
    .from('guests')
    .select('contact_id, event_id')
    .eq('id', parsed.data.guest_id)
    .maybeSingle();
  if (!guest || guest.event_id !== eventId || !guest.contact_id) {
    return json({ error: 'אורח לא נמצא' }, 404);
  }

  const { data: contact } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', guest.contact_id)
    .maybeSingle();
  if (!contact?.normalized_phone) return json({ error: 'לאורח אין מספר חיוג' }, 422);

  // PREFLIGHT — the ONE gate this route runs ([D3] CLOSED): a contact already
  // billed as reached for THIS event is refused synchronously with a typed
  // domain code, and no job is created — instead of a 202 for a dial the worker
  // is certain to refuse. Same source of truth the worker re-checks as race
  // protection (billed_results UNIQUE(event_id, contact_id)). The app branches
  // on `code`, never on the Hebrew string. No manual bypass exists; the sole
  // exemption is a guest-requested callback (isCallback), which the callback
  // sweep enqueues directly — it never passes through this route.
  if (await isContactReached(eventId, guest.contact_id)) {
    return json({ error: 'כבר נוצר קשר באירוע זה', code: 'already_reached' }, 409);
  }

  // The index is allocated ATOMICALLY by the dispatcher (next_manual_touchpoint,
  // under an advisory lock on campaign+contact), NOT here. Any value computed in
  // this process races: two operators tapping the same guest would derive the
  // same index, and because createCallAttempt is ON CONFLICT DO NOTHING the
  // loser inserts nothing, returns null, and is reported 'already_dispatched' —
  // correct data, silently missing call. This placeholder is never used for a
  // manual dial; isManual is what routes allocation into the database.
  const dispatchId = randomUUID();
  const job: OutreachCallRequest = {
    campaignId: campaign.id,
    eventId,
    contactId: guest.contact_id,
    normalizedPhone: contact.normalized_phone,
    // scriptKey is inert: three call sites write it, none read it (verified
    // across src/ and worker/). Kept consistent with the callback sweep rather
    // than inventing a value that means nothing.
    scriptKey: 'rsvp_v1',
    touchpointIndex: 0,
    isManual: true,
    dispatchId,
  };

  // The status contract (call_dispatch_status): INSERT the 'accepted' row
  // BEFORE boss.send, so every 202 has a row the app can watch. A request whose
  // status cannot be recorded is refused (500) rather than dialled blind — the
  // worker settles rows by dispatch_id, and a dial with no row would resolve
  // into silence, the exact ambiguity this table exists to kill.
  if (!(await recordDispatchAccepted({ dispatchId, eventId, contactId: guest.contact_id }))) {
    return json({ error: 'רישום הבקשה נכשל' }, 500);
  }

  // A fresh job id per manual dial (each tap is a distinct intent). The worker's
  // dispatch stays idempotent per attempt row; CALL_RETRY only retries the pre-dial
  // transport check, never a placed call.
  try {
    const boss = await getSender();
    await boss.send(QUEUES.callRequest, job, { id: dispatchId, ...CALL_RETRY });
  } catch {
    // No job exists, so no worker will ever settle this row — settle it here
    // with the public failure reason so it cannot stay 'accepted' forever.
    // settleDispatchFailure is STRICT (throws on failure); here the 502 must
    // still reach the app — no 202 was given, so no contract is broken by a
    // stale 'accepted' row (logged inside; the retention sweep clears it).
    await settleDispatchFailure({ dispatchId, eventId, contactId: guest.contact_id }).catch(
      () => {},
    );
    return json({ error: 'הוספת השיחה לתור נכשלה' }, 502);
  }

  // 'accepted', not 'queued'. The job still has ten more gates to pass in the
  // worker, so claiming it is queued to dial would promise more than is known —
  // the same false-confidence shape save_rsvp's three-state contract exists to
  // kill.
  //
  // dispatch_id, not attempt_id: the attempt row does not exist yet. It is
  // created inside dispatchOutreachCall (outreach-calls.ts), in the worker,
  // after this response is already sent. The truth channel is the
  // call_dispatch_status row keyed by this id: the worker settles it with the
  // final outcome (dispatched / skipped / blocked / failed / unknown) and the
  // app receives it over Realtime — or polls it after a reconnect. On
  // 'dispatched' the app hops to the console_call_feed row via call_attempt_id.
  // (call_attempts itself was never app-readable — its only authenticated
  // policy is admin-read.)
  return json({ status: 'accepted', dispatch_id: dispatchId, event_id: eventId }, 202);
}
