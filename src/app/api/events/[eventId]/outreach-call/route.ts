import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { CALL_RETRY, QUEUES, type OutreachCallRequest } from '@/lib/queue/queues';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/events/{eventId}/outreach-call   body: { guest_id }
//
// DRAFT — NOT wired to the app, NOT for merge until the flags below are resolved.
//
// ENQUEUE-ONLY. The console asks to place ONE outbound AI call to an EXISTING
// guest. This route NEVER dials and NEVER runs a gate: it only enqueues an
// `outreach-call-request` job. The worker's dispatchOutreachCall owns the whole
// gate chain (consent / DNC / already-reached / campaign-active / concurrency /
// hourly-cap / balance / event-closed = Gate 4b) AND StartScenarios — verified in
// src/lib/data/outreach-calls.ts:110-286. Mirrors exactly how the outreach engine
// enqueues a call touchpoint (src/lib/data/outreach-engine.ts:726-737).
//
// Auth: requireConsoleAgent (Bearer + staff-gated is_console_agent) +
// has_platform_permission('manage_voice') — same authority gate as the live-call
// command routes.
//
// ── OPEN DECISIONS (flagged; do not merge before these close) ────────────────
// [ARCH] The web tier has NO pg-boss instance today — every boss.send() lives in
//        the worker, and the WhatsApp send route stays synchronous "until the
//        pg-boss scheduler ships". Enqueuing from a route therefore opens a
//        SEND-ONLY PgBoss (below). This preempts an architectural decision that
//        belongs to the worker/boss owner — confirm the web→worker enqueue
//        channel (send-only boss vs a worker-polled intent row) before adopting.
//        Also: add 'pg-boss' to next.config serverExternalPackages so it is not
//        bundled into the server build.
// [D1]   scriptKey — dispatchOutreachCall forwards it as the touchpoint script.
//        'manual_console_call' must be a script the ctx/scenario understands, or
//        reuse the campaign's call script key.
// [D2]   touchpointIndex uniqueness — a fixed index makes getCallAttemptByTouchpoint
//        return `already_dispatched` on a re-dial. A manual dial uses a unique lane
//        (below) so re-dialling the same guest is allowed.
// [D3]   already_reached policy — if the guest was already reached the worker skips
//        the dial. A manual re-call may want to bypass that (product decision).
// [D4]   which campaign — an event may have >1 campaign; picking the right one
//        (active?) is a product decision (see the .limit(1) TODO below).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuid = z.string().uuid();
const bodySchema = z.strictObject({ guest_id: z.string().uuid() });

// A manual console dial lives in its own touchpoint lane so its attempt slot never
// collides with a campaign plan step (the engine uses 100000 + stepIndex).
const MANUAL_TOUCHPOINT_BASE = 900000;

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

  // [D4] one-campaign-per-event is the product norm; .limit(1) until "which
  // campaign" (active?) is decided.
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle();
  if (cErr) return json({ error: 'טעינת הקמפיין נכשלה' }, 500);
  if (!campaign) return json({ error: 'לאירוע אין קמפיין' }, 409);

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

  // [D2] unique lane per manual dial so a re-call is not deduped by
  // getCallAttemptByTouchpoint.
  const touchpointIndex = MANUAL_TOUCHPOINT_BASE + (Date.now() % 100000);
  const job: OutreachCallRequest = {
    campaignId: campaign.id,
    eventId,
    contactId: guest.contact_id,
    normalizedPhone: contact.normalized_phone,
    scriptKey: 'manual_console_call', // [D1]
    touchpointIndex,
  };

  // A fresh job id per manual dial (each tap is a distinct intent). The worker's
  // dispatch stays idempotent per attempt row; CALL_RETRY only retries the pre-dial
  // transport check, never a placed call.
  try {
    const boss = await getSender();
    await boss.send(QUEUES.callRequest, job, { id: randomUUID(), ...CALL_RETRY });
  } catch {
    return json({ error: 'הוספת השיחה לתור נכשלה' }, 502);
  }

  return json({ ok: true, status: 'queued', event_id: eventId }, 202);
}
