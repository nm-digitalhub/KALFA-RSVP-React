import 'server-only';

// Turns a callback request into a real appointment in the business mailbox.
//
// REQUEST-FREE by design (service-role only, no requireUser / no cookies), so
// the worker bundle can import it: the sweep runs unattended on a pg-boss tick,
// long after whoever submitted the form has gone. That is also why this module
// cannot reuse exchange-connections.ts's loadOwnedConnectionConfig — that one
// is deliberately gated on the signed-in user. The credential path here is the
// SAME (same columns, same resolveMailboxPassword, same fail-closed); only
// the ownership question differs: "the business connection" instead of "this
// user's connection".
//
// The deterministic-gateway rule (owner ruling 27.07 23:44) lives here: an
// autonomous agent may cause a callback to be scheduled, but every field of the
// resulting appointment is composed by this module from database columns. No
// caller-supplied or model-supplied string is ever passed through.

import type { PgBoss } from 'pg-boss';

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  archiveCallbackSubject,
  buildCallbackDraft,
  CALLBACK_CANCELLED_CATEGORY,
  CALLBACK_CATEGORY,
  CALLBACK_CLOSED_CATEGORY,
  CALLBACK_SUBJECT_PREFIX,
  type CallbackItemInput,
} from '@/lib/callbacks/calendar-item';
import { buildNoContactSmsText } from '@/lib/callbacks/no-contact-sms';
import { getSmsSender } from '@/lib/sms/sender';
import type { CallOutcome } from '@/lib/validation/admin';
import {
  DEFAULT_CALLBACK_POLICY,
  findCallbackSlot,
  localParts,
  preferenceToInstant,
  type BusyWindow,
  type CallbackPolicy,
  type CallerConstraints,
  type SlotRank,
} from '@/lib/callbacks/schedule-policy';
import {
  enqueueMeetingConfirmDispatch,
  meetingConfirmDispatchJobId,
} from '@/lib/data/meeting-confirm-dispatch';
import { enqueueSalesCallDispatch, salesCallDispatchJobId } from '@/lib/data/sales-call-dispatch';
import { getCallbackPolicy } from '@/lib/callbacks/policy-config';
import { QUEUES } from '@/lib/queue/queues';
import { resolveMailboxPassword } from '@/lib/exchange-ews/mailbox-credential';
import { calendarProvider } from '@/lib/exchange-ews/calendar-provider';
import type {
  AvailabilityWindow,
  ExchangeAppointment,
  ExchangeConnectionConfig,
} from '@/lib/exchange-ews/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatIsraelDate, formatIsraelTime } from '@/lib/date';
import { getAppOrigin } from '@/lib/url';

type AdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;

/**
 * How long a new request waits for triage before it is scheduled anyway.
 *
 * A ceiling on the delay, not a promise of one: when triage runs it finishes in
 * seconds and the request goes out immediately. This only bounds what happens
 * when it does NOT run — no role enabled, a run that died, an extraction that
 * kept failing. In every one of those the lead still gets a call.
 */
const TRIAGE_GRACE_MS = 15 * 60_000;

// ── The business connection ─────────────────────────────────────────────────

type LoadedConnection = { id: string; config: ExchangeConnectionConfig };

/**
 * The single verified connection the scheduler writes through.
 *
 * Unattended code must not guess between mailboxes, so this refuses rather than
 * picks when the answer is ambiguous: exactly one verified connection, or
 * nothing happens. If per-org mode ever puts several verified rows in the
 * table, this is the function that has to learn which one is "the business".
 */
async function loadBusinessConnection(
  admin: AdminClient,
): Promise<{ ok: true; connection: LoadedConnection } | { ok: false; reason: string }> {
  const { data, error } = await admin
    .from('exchange_connections')
    .select(
      'id, user_id, mailbox_email, auth_method, status, credential_ciphertext, credential_iv, credential_auth_tag, encryption_key_version',
    )
    .eq('status', 'verified')
    .limit(2);

  if (error) return { ok: false, reason: 'connection_lookup_failed' };
  if (!data || data.length === 0) return { ok: false, reason: 'no_verified_connection' };
  if (data.length > 1) return { ok: false, reason: 'ambiguous_connection' };

  const row = data[0];
  let password: string;
  try {
    password = resolveMailboxPassword();
  } catch {
    // Fail closed, exactly as the request-bound loader does.
    return { ok: false, reason: 'decrypt_failed' };
  }

  return {
    ok: true,
    connection: {
      id: row.id,
      config: {
        mailboxEmail: row.mailbox_email,
        password,
        // Narrowed, not cast: the column is plain text, and an unexpected value
        // must not reach the provider. NTLM is the only method IONOS offers.
        authMethod: row.auth_method === 'basic' ? 'basic' : 'ntlm',
      },
    },
  };
}

// ── Inputs to the slot search ───────────────────────────────────────────────

/**
 * Appointments already booked per Israel calendar day, for the daily cap.
 *
 * Counted from OUR table rather than from the mailbox: the cap is on callbacks
 * this system schedules, not on how busy the day is overall. A day packed with
 * the owner's own meetings is handled by the conflict check instead.
 */
async function countScheduledPerDay(
  admin: AdminClient,
  fromMs: number,
  toMs: number,
): Promise<Record<string, number>> {
  const { data } = await admin
    .from('callback_requests')
    .select('scheduled_at')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', new Date(fromMs).toISOString())
    .lte('scheduled_at', new Date(toMs).toISOString());

  const perDay: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.scheduled_at) continue;
    const key = localParts(Date.parse(row.scheduled_at)).date;
    perDay[key] = (perDay[key] ?? 0) + 1;
  }
  return perDay;
}

/**
 * Stops the sweep from silently retrying a request forever when the reason
 * it can't be scheduled is about the CALLER's own constraints, not a
 * transient system issue — see the two call sites in scheduleCallbackAppointment
 * for exactly which failures this applies to. Best-effort: a write failure
 * here just means the row keeps retrying automatically, which is the current
 * (safe) behaviour, not a new failure mode.
 */
async function markUnschedulable(
  admin: AdminClient,
  requestId: string,
  reason: string,
): Promise<void> {
  await admin
    .from('callback_requests')
    .update({ status: 'unschedulable', scheduling_failure_reason: reason })
    .eq('id', requestId);
}

// ── Scheduling one request ──────────────────────────────────────────────────

export type ScheduleOutcome =
  | { ok: true; appointmentId: string; startIso: string }
  | { ok: false; reason: string };

export type SchedulableCallback = {
  id: string;
  full_name: string;
  phone: string;
  topic: string | null;
  note: string | null;
  requested_at: string | null;
  created_at?: string;
  attempt_count: number;
  calendar_item_id: string | null;
  /** Triage output, when it ran. Absent on a row scheduled past the grace period. */
  not_before_min?: number | null;
  not_after_min?: number | null;
  excluded_dates?: string[] | null;
  /** How to use requested_at — see SlotRank. Absent behaves as 'earliest'. */
  requested_rank?: string | null;
};

/**
 * The database row as the calendar item sees it.
 *
 * Shared by scheduling and by the body repair below so the two can never drift:
 * a repaired description is byte-for-byte what a fresh create would have
 * written, not a second rendering of the same idea.
 */
async function toItemInput(
  request: SchedulableCallback,
  startMs: number,
  endMs: number,
): Promise<CallbackItemInput> {
  return {
    fullName: request.full_name,
    phone: request.phone,
    topic: request.topic,
    note: request.note,
    detailUrl: `${await getAppOrigin()}/admin/callbacks/${request.id}`,
    // "28.07.2026 בשעה 07:40" — the owner's wording, 28.07.
    ...(request.created_at
      ? {
          createdAtText: `${formatIsraelDate(request.created_at)} בשעה ${formatIsraelTime(request.created_at)}`,
        }
      : {}),
    attemptCount: request.attempt_count,
    startMs,
    endMs,
  };
}

/**
 * Places ONE callback in the calendar, or explains why it could not.
 *
 * Idempotent by construction: a request that already carries a calendar_item_id
 * returns early, and the partial unique index on that column is the backstop if
 * two workers reach the same row at once.
 */
export async function scheduleCallbackAppointment(
  request: SchedulableCallback,
  opts: { nowMs?: number; policy?: CallbackPolicy } = {},
): Promise<ScheduleOutcome> {
  if (request.calendar_item_id) return { ok: false, reason: 'already_scheduled' };

  const nowMs = opts.nowMs ?? Date.now();
  const policy = opts.policy ?? DEFAULT_CALLBACK_POLICY;
  const admin = createAdminClient();

  const loaded = await loadBusinessConnection(admin);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  // Where to start looking: the caller's stated preference, else now + notice.
  const preferredMs = request.requested_at
    ? Date.parse(request.requested_at)
    : preferenceToInstant('asap', nowMs, null, policy);
  if (preferredMs === null || Number.isNaN(preferredMs)) {
    await markUnschedulable(admin, request.id, 'unreadable_preference');
    return { ok: false, reason: 'unreadable_preference' };
  }

  // The real mailbox, not our own bookkeeping — this is what makes the item
  // land beside the owner's actual meetings instead of on top of them. Read
  // over the whole horizon in one call.
  const searchFromMs = Math.max(preferredMs, nowMs);
  const searchToMs = nowMs + policy.horizonMs;
  const availability = await calendarProvider.getAvailability(loaded.connection.config, {
    start: new Date(searchFromMs),
    end: new Date(searchToMs + DAY_MS),
  });
  if (!availability.ok) return { ok: false, reason: `availability_${availability.error}` };

  const busy: BusyWindow[] = availability.data.map((w: AvailabilityWindow) => ({
    start: w.start,
    end: w.end,
  }));
  const bookedPerDay = await countScheduledPerDay(admin, searchFromMs, searchToMs + DAY_MS);

  // What the caller said about when they can answer, if anyone has read it yet.
  // Absent for a request scheduled before triage finished — the search then
  // behaves exactly as it did before triage existed.
  const constraints: CallerConstraints = {
    ...(typeof request.not_before_min === 'number'
      ? { notBeforeMin: request.not_before_min }
      : {}),
    ...(typeof request.not_after_min === 'number' ? { notAfterMin: request.not_after_min } : {}),
    ...(request.excluded_dates?.length ? { excludeDates: request.excluded_dates } : {}),
  };

  // Narrowed, not cast: the column is plain text, and an unexpected value must
  // not reach the engine as a rank it does not implement.
  const rank: SlotRank =
    request.requested_rank === 'early' ||
    request.requested_rank === 'late' ||
    request.requested_rank === 'nearest'
      ? request.requested_rank
      : 'earliest';

  const slot = findCallbackSlot({
    preferredMs, nowMs, busy, bookedPerDay, policy, constraints, rank,
  });
  if (!slot.ok) {
    // These three all mean the same thing: given what the caller asked for,
    // there is nowhere to put them — not "try again next tick", which is why
    // this stops the automatic retries (excluded from the sweep's candidate
    // query below) rather than leaving it to fail silently forever. The
    // admin's reschedule action is the way back in — it clears this and
    // reopens the row.
    await markUnschedulable(admin, request.id, slot.reason);
    return { ok: false, reason: slot.reason };
  }

  const draft = buildCallbackDraft(await toItemInput(request, slot.startMs, slot.endMs));

  // The description is the whole point of the item: the number to tap, what the
  // caller asked for, the link to the request. An appointment without it is a
  // name and a time — worse than useless at the moment the owner opens it to
  // dial. Measured 28.07: one item reached the mailbox with a null body, from a
  // build that has since been overwritten and cannot be inspected. The cause is
  // therefore unknown, so this refuses instead of trusting the builder: a
  // skipped row is retried on the next tick and surfaces in the Slack warning,
  // where an empty one would look scheduled and be discovered by a person on
  // the phone with nothing to dial.
  if (!draft.body?.trim()) return { ok: false, reason: 'empty_body' };

  const created = await calendarProvider.createAppointment(loaded.connection.config, draft);
  if (!created.ok) return { ok: false, reason: `create_${created.error}` };

  const startIso = new Date(slot.startMs).toISOString();
  const { error: writeError } = await admin
    .from('callback_requests')
    .update({
      calendar_item_id: created.data.appointmentId,
      exchange_connection_id: loaded.connection.id,
      scheduled_at: startIso,
      status: 'scheduled',
      scheduling_failure_reason: null,
      // requested_at is deliberately NOT written here. It means "the time the
      // caller asked for"; filling it with the slot WE picked erases the only
      // distinction the column exists for, and a released row would then look
      // like it carries a preference for a time already past.
    })
    .eq('id', request.id)
    // Only if nobody else won the race; the partial unique index would reject
    // the write anyway, but losing quietly is better than surfacing a conflict.
    .is('calendar_item_id', null);

  if (writeError) {
    // The appointment exists but we could not record it — remove it rather than
    // leave an orphan the owner would see with no way to manage it.
    await calendarProvider.deleteAppointment(loaded.connection.config, created.data.appointmentId);
    return { ok: false, reason: 'link_write_failed' };
  }

  return { ok: true, appointmentId: created.data.appointmentId, startIso };
}

export type CallClosureReason = 'completed' | 'cancelled';

/**
 * scheduleCallbackAppointment's counterpart: retires the calendar appointment
 * for a request that no longer needs one — WITHOUT deleting it.
 *
 * Redesigned 2026-08-20: the original version called deleteAppointment,
 * which erased every trace that a call was ever scheduled, attempted, or how
 * it ended — an admin looking back later could not tell "this was handled"
 * from "nothing ever happened here". This now MUTES the appointment in place
 * instead: cancels its reminder (`isReminderOn: false` — verified against the
 * live Microsoft Graph Event resource docs; `reminderMinutesBeforeStart`
 * alone has no independent "disabled" meaning, and our own provider mapping
 * already sends isReminderOn:false whenever reminderMinutes is 0), frees the
 * slot (`showAs: 'free'` — no longer blocks scheduling or reads as an open
 * task), and marks the subject/category so it reads as archived at a glance
 * (archiveCallbackSubject). The appointment stays at its ORIGINAL time,
 * permanently, as a historical record — it is never deleted again.
 *
 * `calendar_item_id` is still cleared from the row after archiving: the
 * column means "the request's CURRENT active appointment", not a pointer to
 * history — the archived item's own subject/category IS the history, living
 * in the mailbox, not duplicated here. A row that later needs a fresh
 * appointment (e.g. a no-answer retry) gets one with a NEW id; nothing here
 * prevents that, because the row no longer references the archived one.
 *
 * Never throws on a calendar failure — the caller's actual intent (closing
 * the request) must still succeed regardless. On failure the row KEEPS its
 * calendar_item_id, deliberately: an appointment this could not archive must
 * stay linked, or countOrphanedCalendarAppointments would flag it the moment
 * the link were cleared without the appointment actually being muted.
 */
/**
 * The pure Exchange-side half of archiving — no DB read or write. Split out
 * of closeCallbackAppointment so applyCallOutcome below can archive with a
 * calendar_item_id it already has in hand, AFTER atomically claiming the DB
 * row itself — see that function's own comment for why the claim must
 * happen first, in one statement, rather than this function re-reading and
 * clearing the id itself.
 */
async function archiveInCalendar(
  connection: LoadedConnection,
  calendarItemId: string,
  reason: CallClosureReason,
): Promise<boolean> {
  const detail = await calendarProvider.getAppointment(connection.config, calendarItemId);
  if (!detail.ok) {
    // Already gone (the owner deleted it themselves) is the desired end
    // state. Any other read failure must not proceed to an update built on
    // stale/absent data.
    return detail.error === 'not_found';
  }
  const updated = await calendarProvider.updateAppointment(connection.config, calendarItemId, {
    start: detail.data.start,
    end: detail.data.end,
    subject: archiveCallbackSubject(detail.data.subject, reason),
    reminderMinutes: 0,
    showAs: 'free',
    category: reason === 'cancelled' ? CALLBACK_CANCELLED_CATEGORY : CALLBACK_CLOSED_CATEGORY,
  });
  return updated.ok;
}

export async function closeCallbackAppointment(
  requestId: string,
  opts: { reason?: CallClosureReason } = {},
): Promise<{ archived: boolean }> {
  const reason = opts.reason ?? 'completed';
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('callback_requests')
    .select('calendar_item_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!row?.calendar_item_id) return { archived: false };

  const loaded = await loadBusinessConnection(admin);
  if (!loaded.ok) return { archived: false };

  const ok = await archiveInCalendar(loaded.connection, row.calendar_item_id, reason);
  if (!ok) return { archived: false };

  await admin
    .from('callback_requests')
    .update({
      calendar_item_id: null,
      exchange_connection_id: null,
      scheduled_at: null,
      scheduling_failure_reason: null,
    })
    .eq('id', requestId);

  return { archived: true };
}

/**
 * Sends the one-time "we tried three times, couldn't reach you" SMS —
 * claimed BEFORE the provider is ever called, never after.
 *
 * Why claim-then-send, not send-then-record: if the process died between a
 * successful provider call and writing that down, the next run would see "no
 * record of sending" and send a second message — the customer receives the
 * same notice twice. Claiming first closes that window: the claim (`UPDATE
 * ... WHERE no_contact_sms_claimed_at IS NULL`) is a single, race-free
 * database statement, so at most one caller can ever win it, regardless of
 * how many times this runs concurrently or how it crashes afterward. A
 * caller that does NOT win the claim sends nothing — even if the earlier
 * winner's own send later fails, this is a deliberate "at most once" policy,
 * not "exactly once": a false negative (claimed, never actually sent,
 * because the process died mid-call) is judged less harmful than a customer
 * getting the same closing SMS twice.
 *
 * Never throws — a failed or skipped send must not block or reopen the
 * request's own closure, which is the caller's real intent.
 */
async function sendNoContactSms(
  admin: AdminClient,
  request: { id: string; full_name: string; phone: string },
): Promise<void> {
  const { data: claimed } = await admin
    .from('callback_requests')
    .update({ no_contact_sms_claimed_at: new Date().toISOString() })
    .eq('id', request.id)
    .is('no_contact_sms_claimed_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return; // another run already claimed (or completed) this send

  try {
    const sender = await getSmsSender();
    const text = buildNoContactSmsText({
      fullName: request.full_name,
      formUrl: `${await getAppOrigin()}/contact`,
    });
    const { id: providerId } = await sender.send({ to: request.phone, text });
    await admin
      .from('callback_requests')
      .update({ no_contact_sms_sent_at: new Date().toISOString(), no_contact_sms_provider_id: providerId })
      .eq('id', request.id);
  } catch (err) {
    // A certain failure (SMS disabled, bad destination, provider outage) —
    // recorded for visibility only. The request stays closed either way.
    await admin
      .from('callback_requests')
      .update({ no_contact_sms_error: err instanceof Error ? err.message : 'שגיאה לא ידועה' })
      .eq('id', request.id);
  }
}

export type CallOutcomeResult = {
  /** Whether the just-finished call's appointment was archived. */
  archived: boolean;
  /** Whether the REQUEST reached a terminal state (vs. re-entering scheduling). */
  requestClosed: boolean;
};

/**
 * The single place that decides what recording a call outcome actually DOES
 * — not just writes the column. Design settled 2026-08-20 (owner + friend's
 * CRM-informed review): `call_outcome` and `status` are separate axes (see
 * validation/admin.ts), and most outcomes affect BOTH — the call attempt
 * that just happened always gets archived (never deleted; see
 * closeCallbackAppointment), but whether the REQUEST itself is done depends
 * on which outcome:
 *
 *   completed / closed  → the request is done. No further scheduling.
 *   no_answer            → the request is NOT done — it re-enters the normal
 *                          scheduling queue (status: 'pending_schedule') for
 *                          another attempt, UNLESS this is the third
 *                          consecutive no-answer, in which case the request
 *                          closes itself as `no_contact` and a one-time SMS
 *                          tells the caller (see sendNoContactSms). Any
 *                          OTHER outcome resets the streak to zero — three
 *                          non-consecutive no-answers must never trigger the
 *                          auto-close.
 *   needs_followup       → the call happened and connected; a further call is
 *                          still needed. Re-enters scheduling exactly like
 *                          no_answer's non-terminal case (no calendar slot
 *                          exists yet) — the admin can immediately pick an
 *                          exact time via the existing reschedule form, or
 *                          let the ordinary sweep find the next slot, same
 *                          as any other pending request. Does NOT increment
 *                          attempt_count — that column tracks unreached
 *                          attempts specifically (see buildCallbackSubject's
 *                          own comment), and this call DID connect.
 */
/**
 * Everything ONE call outcome needs written, decided from the row alone —
 * pure, no DB or Exchange access, so applyCallOutcome's atomicity story below
 * is easy to verify by reading it next to this.
 */
function buildCallOutcomeUpdate(
  outcome: CallOutcome,
  row: { attempt_count: number; consecutive_no_answer_count: number },
): { fields: Record<string, unknown>; requestClosed: boolean; noContactClosure: boolean } {
  if (outcome === 'no_answer') {
    const consecutive = (row.consecutive_no_answer_count ?? 0) + 1;
    if (consecutive >= 3) {
      return {
        fields: { call_outcome: 'no_contact', status: 'closed', consecutive_no_answer_count: consecutive },
        requestClosed: true,
        noContactClosure: true,
      };
    }
    return {
      fields: {
        call_outcome: outcome,
        consecutive_no_answer_count: consecutive,
        attempt_count: (row.attempt_count ?? 0) + 1,
        status: 'pending_schedule',
      },
      requestClosed: false,
      noContactClosure: false,
    };
  }
  if (outcome === 'needs_followup') {
    return {
      fields: { call_outcome: outcome, consecutive_no_answer_count: 0, status: 'pending_schedule' },
      requestClosed: false,
      noContactClosure: false,
    };
  }
  // completed / closed: the request is fully done.
  return {
    fields: { call_outcome: outcome, consecutive_no_answer_count: 0, status: 'closed' },
    requestClosed: true,
    noContactClosure: false,
  };
}

export async function applyCallOutcome(
  requestId: string,
  outcome: CallOutcome,
): Promise<CallOutcomeResult> {
  const admin = createAdminClient();

  if (outcome === 'pending') return { archived: false, requestClosed: false };

  const { data: row } = await admin
    .from('callback_requests')
    .select('id, full_name, phone, attempt_count, consecutive_no_answer_count, calendar_item_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!row) return { archived: false, requestClosed: false };

  const { fields, requestClosed, noContactClosure } = buildCallOutcomeUpdate(outcome, row);

  // Claim, in ONE statement, before anything else touches this row.
  //
  // Folds what closeCallbackAppointment's own DB write does (clearing
  // calendar_item_id + the three columns that ride with it) into the SAME
  // update as the outcome fields, guarded on calendar_item_id still matching
  // what was just read above. Only the first caller to reach this while that
  // is still true can ever match — a duplicate submission for the SAME call
  // attempt (double-click, two open tabs, a retried request after a timeout)
  // reads the same starting row but loses the race: by the time its own
  // update runs, calendar_item_id no longer matches, so it affects zero rows
  // and is treated as already-handled below.
  //
  // This is deliberately ONE statement, not "clear the id here, count there":
  // splitting it across two would leave exactly the gap a duplicate could
  // still slip through in the deciding a plain `count = count + 1` SQL
  // increment cannot close on its own — that only prevents a LOST update
  // (two writers silently overwriting each other), not two writers both
  // legitimately incrementing for what was really one real event.
  let claim = admin
    .from('callback_requests')
    .update({
      ...fields,
      calendar_item_id: null,
      exchange_connection_id: null,
      scheduled_at: null,
      scheduling_failure_reason: null,
    })
    .eq('id', requestId);
  claim = row.calendar_item_id
    ? claim.eq('calendar_item_id', row.calendar_item_id)
    : claim.is('calendar_item_id', null);
  const { data: claimed } = await claim.select('id').maybeSingle();

  if (!claimed) return { archived: false, requestClosed: false }; // duplicate — already handled

  // Archive AFTER the claim, using the id already in hand — deliberately not
  // closeCallbackAppointment (which would re-read and re-clear the row,
  // reopening the exact window the claim above just closed). A calendar
  // failure here is never retried by keeping the row linked, unlike
  // closeCallbackAppointment's own contract: the claim already committed the
  // outcome, so a left-behind un-archived appointment is a cosmetic gap the
  // existing orphan detector (countOrphanedCalendarAppointments) already
  // catches — reopening the row here would risk double-counting the very
  // thing this claim exists to prevent.
  let archived = false;
  if (row.calendar_item_id) {
    const loaded = await loadBusinessConnection(admin);
    if (loaded.ok) archived = await archiveInCalendar(loaded.connection, row.calendar_item_id, 'completed');
  }

  if (noContactClosure) await sendNoContactSms(admin, row);

  return { archived, requestClosed };
}

export type RescheduleOutcome = { ok: true } | { ok: false; reason: string };

/**
 * The answered-but-not-resolved case: the caller picked up, and either asked
 * for a different time than what they originally requested, or asked to be
 * called again later (e.g. "let me think about it"). Both are the same
 * mechanical need — a fresh instant to search a slot from — so both go
 * through this one path rather than two.
 *
 * `exactIso` is deliberately an exact instant, not a part-of-day band like the
 * public form uses: the admin is relaying what a real person just said on the
 * phone, not guessing on a stranger's behalf (see CALLBACK_TIME_PREFERENCES'
 * own comment on why 'exact' is withheld from the public form — the reasoning
 * doesn't apply here). `requested_rank: 'nearest'` follows from the same
 * logic: search around the instant the caller named, not only forward from it.
 *
 * Reuses closeCallbackAppointment for the old slot rather than duplicating its
 * safety logic. If an existing appointment fails to delete, this refuses to
 * proceed — updating requested_at while calendar_item_id still points at a
 * live appointment would let the next sweep tick create a SECOND one for the
 * same request, the exact failure mode this whole feature exists to prevent.
 */
export async function rescheduleCallbackRequest(
  requestId: string,
  exactIso: string,
): Promise<RescheduleOutcome> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from('callback_requests')
    .select('calendar_item_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!row) return { ok: false, reason: 'not_found' };

  if (row.calendar_item_id) {
    // 'completed': the caller picked up and talked — this slot served its
    // purpose, it is being superseded by a new one, not cancelled.
    const closed = await closeCallbackAppointment(requestId, { reason: 'completed' });
    if (!closed.archived) return { ok: false, reason: 'old_appointment_not_removed' };
  }

  const { error } = await admin
    .from('callback_requests')
    .update({
      // Distinct from 'new': this row has already been through the pipeline
      // once (or the admin is redirecting a still-unscheduled one). The admin
      // list needs to be able to tell "never touched" from "was scheduled,
      // now needs a fresh time" — that distinction is the whole point of
      // tonight's redesign.
      status: 'needs_reschedule',
      requested_at: exactIso,
      requested_rank: 'nearest',
      scheduling_failure_reason: null,
    })
    .eq('id', requestId);
  if (error) return { ok: false, reason: 'update_failed' };

  return { ok: true };
}

// ── Self-healing against the calendar ───────────────────────────────────────

/**
 * The other direction of the sync, and the price of notify-not-ask: the owner's
 * undo IS deleting the appointment, and Exchange notifies us of nothing.
 *
 * A row still holding a calendar_item_id whose appointment is gone would be
 * stranded — the sweep only picks up rows where that column is NULL, so the
 * request would exist in neither the calendar nor the queue. Clearing the
 * column puts it back in line to be scheduled again.
 *
 * Same rule and same shape as reconcileBlocksWithCalendar in
 * exchange-availability.ts (measured 28.07): whatever the calendar says, wins.
 * Cheap — one range read, and a write only when something actually vanished.
 *
 * ALSO detects the appointment being MOVED rather than deleted (found
 * 2026-08-31: existence-only checking left `scheduled_at` stale after an
 * owner moved the appointment in Outlook/365, so the already-enqueued AI-call
 * job kept firing at the OLD instant — a real wrong-time call, not a
 * hypothetical). A >60s gap between the live item's `start` and the stored
 * `scheduled_at` is treated as a move — sub-minute drift is Graph/Postgres
 * serialization noise, not an owner-initiated change. On a move: the row's
 * `scheduled_at` is corrected to match the calendar (same "whatever the
 * calendar says, wins" rule as the delete case above), and — when a `boss`
 * instance is supplied — the stale dispatch job for the OLD instant is
 * cancelled and a fresh one enqueued for the NEW instant, through the exact
 * same enqueueMeetingConfirmDispatch/enqueueSalesCallDispatch functions
 * runCallbackSchedulingSweep already uses below for a newly-scheduled row —
 * never a second, parallel scheduling path. `boss` is optional (a tick with
 * none just corrects the DB; the NEXT tick, which will have one, re-enqueues)
 * so every existing caller/test of this function keeps working unchanged.
 */
export async function reconcileCallbacksWithCalendar(
  opts: { nowMs?: number; boss?: PgBoss; policy?: CallbackPolicy } = {},
): Promise<{ released: number; moved: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const policy = opts.policy ?? DEFAULT_CALLBACK_POLICY;
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from('callback_requests')
    .select('id, calendar_item_id, scheduled_at, topic')
    .not('calendar_item_id', 'is', null)
    .gte('scheduled_at', new Date(nowMs - DAY_MS).toISOString());

  if (!rows || rows.length === 0) return { released: 0, moved: 0 };

  const loaded = await loadBusinessConnection(admin);
  // Cannot see the calendar → assume nothing. Releasing rows on a failed read
  // would double-book every one of them on the next sweep.
  if (!loaded.ok) return { released: 0, moved: 0 };

  const scheduledTimes = rows
    .map((r) => (r.scheduled_at ? Date.parse(r.scheduled_at) : NaN))
    .filter((n) => !Number.isNaN(n));
  if (scheduledTimes.length === 0) return { released: 0, moved: 0 };

  const listed = await calendarProvider.listAppointments(loaded.connection.config, {
    start: new Date(Math.min(...scheduledTimes) - DAY_MS),
    end: new Date(Math.max(...scheduledTimes) + DAY_MS),
  });
  if (!listed.ok) return { released: 0, moved: 0 };

  const liveById = new Map(listed.data.map((item: ExchangeAppointment) => [item.id, item]));
  const stale = rows
    .filter((r) => r.calendar_item_id && !liveById.has(r.calendar_item_id))
    .map((r) => r.id);

  const MOVE_TOLERANCE_MS = 60_000;
  const moved = rows.flatMap((r) => {
    if (!r.calendar_item_id || !r.scheduled_at) return [];
    const live = liveById.get(r.calendar_item_id);
    if (!live) return []; // gone entirely — handled by `stale` above
    const storedMs = Date.parse(r.scheduled_at);
    if (Number.isNaN(storedMs)) return [];
    const liveMs = live.start.getTime();
    if (Math.abs(liveMs - storedMs) <= MOVE_TOLERANCE_MS) return [];
    return [
      { id: r.id, topic: r.topic, oldScheduledMs: storedMs, newStartIso: live.start.toISOString() },
    ];
  });

  if (stale.length > 0) {
    await admin
      .from('callback_requests')
      .update({
        calendar_item_id: null,
        exchange_connection_id: null,
        scheduled_at: null,
        // Was 'scheduled' (that's the only way it got a calendar_item_id in the
        // first place) — 'pending_schedule', not 'new': the system detected the
        // mismatch and is retrying on its own, which is a different admin-list
        // story than "nobody has looked at this yet". 'needs_reschedule' is
        // reserved for the admin's own explicit reschedule action.
        status: 'pending_schedule',
      })
      .in('id', stale);
  }

  for (const m of moved) {
    const { error: updateErr } = await admin
      .from('callback_requests')
      .update({ scheduled_at: m.newStartIso })
      .eq('id', m.id);
    if (updateErr) {
      console.error(
        '[callback-scheduling] moved-appointment scheduled_at update failed',
        m.id,
        updateErr.message,
      );
      continue; // did not correct the DB — do not touch pg-boss for this row
    }
    if (!opts.boss) continue; // next tick (which will have a boss) re-enqueues instead

    // Remove the stale job for the OLD instant, via the SAME id-derivation
    // each dispatch module exports for exactly this purpose — never a second
    // hand-typed copy of the `meeting-confirm:`/`sales-call-dispatch:` prefix.
    //
    // DELETE, not cancel(): the fresh enqueue below derives its job id from
    // (request id, NEW instant) via the exact same deterministic function —
    // and an appointment moved away and later moved BACK to a previously-used
    // instant (a realistic "undo the move" edit, confirmed live 2026-08-31 on
    // a real request) recomputes that SAME id. pg-boss's send() is a plain
    // `INSERT ... ON CONFLICT DO NOTHING`, so if the old row for that id is
    // merely cancelled (not gone), the re-enqueue silently inserts nothing —
    // the row is left cancelled forever and the corrected time never dials.
    // deleteJob() removes the row outright regardless of its state (unlike
    // cancel(), which only transitions a non-terminal job and leaves a
    // terminal one — 'completed', as this one had already fired and run —
    // untouched), so the id is free for the fresh insert to claim.
    const isSales = m.topic === 'מכירות';
    const oldId = isSales
      ? salesCallDispatchJobId(m.id, m.oldScheduledMs)
      : meetingConfirmDispatchJobId(m.id, m.oldScheduledMs);
    const oldQueue = isSales ? QUEUES.salesCallDispatch : QUEUES.meetingConfirmDispatch;
    try {
      await opts.boss.deleteJob(oldQueue, oldId);
    } catch (e) {
      // Not fatal — the dispatcher's own fresh-row-read + status/consent gates
      // (dispatchMeetingConfirmCall/dispatchSalesCall) still stand between a
      // stale job and an actual dial. A failed delete means the id-collision
      // risk above stays open for this row, not that the call is now
      // guaranteed to go out at the wrong time.
      console.error(
        '[callback-scheduling] stale dispatch-job delete failed',
        m.id,
        (e as Error)?.message,
      );
    }

    // Enqueue fresh for the NEW instant — through the same two functions
    // runCallbackSchedulingSweep calls below for a newly-scheduled row; each
    // no-ops by topic on its own, so calling both here (rather than
    // branching on `isSales`) matches that call site exactly.
    try {
      await enqueueMeetingConfirmDispatch(
        opts.boss,
        { id: m.id, topic: m.topic, scheduledAtIso: m.newStartIso },
        nowMs,
        policy,
      );
      await enqueueSalesCallDispatch(
        opts.boss,
        { id: m.id, topic: m.topic, scheduledAtIso: m.newStartIso },
        nowMs,
      );
    } catch (e) {
      console.error(
        '[callback-scheduling] moved-appointment re-enqueue failed',
        m.id,
        (e as Error)?.message,
      );
    }
  }

  return { released: stale.length, moved: moved.length };
}

/**
 * How many requests are STRANDED: holding a `calendar_item_id`, past their
 * slot, and not terminal.
 *
 * Such a row exists in neither the calendar nor the queue. The sweep skips it
 * (the id is set, so scheduling returns 'already_scheduled') and the reconciler
 * above cannot see it (its window is one day back). Neither reports what it
 * skipped, which is precisely how they stay invisible.
 *
 * MEASURED 2026-08-16: fourteen accumulated silently across the EWS→Graph
 * migration, the oldest from 28.07 — fourteen real customers who asked to be
 * called and were never scheduled, with nothing anywhere saying so. They were
 * released and re-created (all fourteen now resolve in Graph), but nothing
 * would have caught the next occurrence.
 *
 * Deliberately a DETECTOR, not a fixer. Releasing automatically would
 * double-book any row whose appointment does still exist — the release we ran
 * by hand was safe only because every one of the fourteen ids was checked
 * against Graph first and all fourteen came back 404. A human deciding beats a
 * heuristic guessing. Cheap: one counted query, no calendar read.
 */
export async function countStrandedCallbacks(
  opts: { nowMs?: number } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('callback_requests')
    .select('id', { count: 'exact', head: true })
    .not('calendar_item_id', 'is', null)
    // 'cancelled' only, not a closed list: the status vocabulary was
    // redesigned 2026-08-19/20 (see validation/admin.ts) into a real state
    // machine, and 'done'/'in_progress' — this line's ORIGINAL values —
    // don't exist as `status` anymore at all (that meaning moved to
    // call_outcome, a separate column). Hardcoding a closed list here once
    // already meant this filter silently excluded nothing (MEASURED
    // 2026-08-19: it checked for 'completed', which was never a valid value
    // for THIS column either — see git history). Exclude the one terminal
    // value instead of enumerating the rest, so a future vocabulary change
    // can't silently break this again.
    .not('status', 'eq', 'cancelled')
    .lt('scheduled_at', new Date(nowMs - DAY_MS).toISOString());
  // A failed read must never masquerade as "all clear" — but it must not raise
  // a false alarm either, so it reports zero and the sweep's own error handling
  // owns the failure.
  if (error) return 0;
  return count ?? 0;
}

/**
 * How many "שיחה חוזרת" calendar appointments exist with NO callback_requests
 * row pointing at them — the mirror image of countStrandedCallbacks.
 *
 * reconcileCallbacksWithCalendar only ever checks ONE direction: "my row says
 * an appointment exists — is that still true?". It never asks the reverse,
 * "does an appointment exist that no row claims?". MEASURED 2026-08-19: a
 * Graph immutable-id mismatch (fixed 2026-08-17, see graph-impl.ts) made that
 * one-directional check falsely release requests whose appointments were
 * still live; each false release rescheduled the SAME request into a new
 * appointment without ever removing the old one. 575 orphaned appointments
 * accumulated over about three weeks before anyone noticed, because nothing
 * anywhere ever asked this question. This is that question.
 *
 * Deliberately a DETECTOR, not a fixer — same reasoning as
 * countStrandedCallbacks: an appointment a human is looking at right now
 * (mid-edit, or one this system is about to correctly claim) must never be
 * auto-deleted by a background job. A human deciding beats a heuristic
 * guessing.
 */
export async function countOrphanedCalendarAppointments(
  opts: { nowMs?: number; policy?: CallbackPolicy } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
  const policy = opts.policy ?? DEFAULT_CALLBACK_POLICY;
  const admin = createAdminClient();

  const loaded = await loadBusinessConnection(admin);
  // Cannot see the calendar → cannot claim an orphan exists there.
  if (!loaded.ok) return 0;

  const { data: rows } = await admin
    .from('callback_requests')
    .select('calendar_item_id')
    .not('calendar_item_id', 'is', null);
  const knownIds = new Set((rows ?? []).map((r) => r.calendar_item_id).filter(Boolean));

  // The full range this feature could EVER have written into, both
  // directions — an orphan cannot exist outside it. DAY_MS margin on each
  // side covers timezone-boundary slop the same way reconcile's own window
  // does.
  const listed = await calendarProvider.listAppointments(loaded.connection.config, {
    start: new Date(nowMs - 31 * DAY_MS),
    end: new Date(nowMs + policy.horizonMs + DAY_MS),
  });
  if (!listed.ok) return 0;

  return listed.data.filter(
    (item: ExchangeAppointment) =>
      item.subject.startsWith(CALLBACK_SUBJECT_PREFIX) && !knownIds.has(item.id),
  ).length;
}

/**
 * Fills in the description of a scheduled callback whose body reached the
 * mailbox empty.
 *
 * Why this exists: on 28.07 an item was measured in the live mailbox with
 * `Body.text = null` — no number, no note, no link, just a name and a time. The
 * build that wrote it had already been replaced and could not be inspected, so
 * the cause is genuinely unknown; scheduleCallbackAppointment now refuses to
 * create such an item, but that guard does nothing for one already sitting in
 * the calendar.
 *
 * Narrow on purpose, in both directions:
 *   • Only a BLANK body is rewritten. Anything the owner typed in Outlook is
 *     content, and content is never overwritten — the same rule updateAppointment
 *     follows when a field arrives `undefined`.
 *   • Only future items of a request still awaiting a call. A past callback
 *     needs no description, and a done/cancelled one is not ours to touch.
 * Times are taken from the appointment as it stands, so a repair can never move
 * a slot the owner has already seen — it writes the description and nothing else.
 */
export async function repairBlankCallbackBodies(
  opts: { nowMs?: number; limit?: number } = {},
): Promise<{ repaired: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from('callback_requests')
    .select(
      'id, full_name, phone, topic, note, requested_at, created_at, attempt_count, calendar_item_id',
    )
    .not('calendar_item_id', 'is', null)
    // 'in_progress' was retired from this column in the 2026-08-19/20
    // redesign (see validation/admin.ts) — a row with calendar_item_id set
    // is 'scheduled' by construction, so exclude only the one status that
    // can coexist with a stale calendar_item_id mid-transition
    // ('cancelled', briefly, if closeCallbackAppointment's own write fails).
    .not('status', 'eq', 'cancelled')
    .gte('scheduled_at', new Date(nowMs).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(opts.limit ?? 25);

  if (!rows || rows.length === 0) return { repaired: 0 };

  const loaded = await loadBusinessConnection(admin);
  if (!loaded.ok) return { repaired: 0 };

  let repaired = 0;
  for (const row of rows) {
    if (!row.calendar_item_id) continue;

    const detail = await calendarProvider.getAppointment(
      loaded.connection.config,
      row.calendar_item_id,
    );
    // Gone or unreadable: reconcileCallbacksWithCalendar owns that case.
    if (!detail.ok) continue;
    if (detail.data.body.trim()) continue;

    const draft = buildCallbackDraft(
      await toItemInput(row, detail.data.start.getTime(), detail.data.end.getTime()),
    );
    if (!draft.body?.trim()) continue;

    const updated = await calendarProvider.updateAppointment(
      loaded.connection.config,
      row.calendar_item_id,
      {
        start: detail.data.start,
        end: detail.data.end,
        body: draft.body,
        bodyIsHtml: draft.bodyIsHtml,
      },
    );
    if (updated.ok) repaired += 1;
  }

  return { repaired };
}

// ── The sweep ───────────────────────────────────────────────────────────────

/**
 * Schedules every new request that has no appointment yet.
 *
 * notify-not-ask (owner ruling): items are created immediately and the owner is
 * told, rather than asked. Deleting the appointment is the undo.
 *
 * Reads fresh DB state on every tick and registers nothing pg-boss-side, so
 * changing a request's status or clearing its slot is just a DB write — the
 * next tick sees it. Same idiom as the auto-thankyou and callback re-dial
 * sweeps.
 */
export async function runCallbackSchedulingSweep(
  opts: { limit?: number; nowMs?: number; boss?: PgBoss } = {},
): Promise<{ scheduled: number; skipped: number; released: number; repaired: number; moved: number }> {
  const admin = createAdminClient();

  // Loaded once per tick and threaded everywhere below — every read of "the
  // policy" in this sweep must see the SAME admin-configured values, not a
  // second independent DB read that could race an admin's save mid-tick.
  const policy = await getCallbackPolicy();

  // Heal first: a request whose appointment the owner deleted is released back
  // into the queue and re-scheduled in THIS tick, not the next one. `boss` is
  // passed through so a MOVED (not deleted) appointment can also have its
  // stale dispatch job cancelled and a fresh one enqueued in this same tick —
  // see reconcileCallbacksWithCalendar's own doc comment.
  const healed = await reconcileCallbacksWithCalendar({ nowMs: opts.nowMs, boss: opts.boss, policy });
  // Then repair what survived but arrived blank. Runs before scheduling so an
  // item the owner is about to open is fixed at the earliest possible tick.
  const bodies = await repairBlankCallbackBodies({ nowMs: opts.nowMs });

  // Wait for triage — but not forever.
  //
  // A caller's stated availability lives in free text, and only the triage step
  // turns it into constraints this scheduler can honour. Scheduling before it
  // runs is what booked a caller for the one afternoon she had ruled out
  // (measured 28.07). So a request is held back while triage is still pending.
  //
  // NOT a gate, though: a hard "only schedule after triage" would mean that with
  // no triage role enabled — which is the state today — every new request waits
  // forever and no callback is ever booked. That is worse than the bug it
  // prevents. Past the grace period the request is scheduled with whatever is
  // known, which is exactly today's behaviour.
  //
  // Fifteen minutes: triage takes seconds when it runs, and the policy already
  // adds two hours of minimum notice on top, so the cost of waiting is a
  // fifteen-minute shift on a call that was never going to happen sooner.
  const nowMs = opts.nowMs ?? Date.now();
  const graceCutoffIso = new Date(nowMs - TRIAGE_GRACE_MS).toISOString();

  const { data, error } = await admin
    .from('callback_requests')
    .select(
      'id, full_name, phone, topic, note, requested_at, created_at, attempt_count, calendar_item_id, triage_status, not_before_min, not_after_min, excluded_dates, requested_rank',
    )
    .is('calendar_item_id', null)
    // Exclude, don't enumerate: candidates are 'new' / 'pending_schedule' /
    // 'needs_reschedule' — but naming them is exactly the mistake that once
    // stranded claim_callback_triage() (see that RPC's own migration
    // comment). 'scheduled'/'cancelled' can't structurally coexist with
    // calendar_item_id IS NULL, 'unschedulable' is what stops automatic
    // retries once a request's own constraints rule it out, and 'closed'
    // (2026-08-20) is a request applyCallOutcome already finished — but the
    // predicate names all four explicitly anyway, matching
    // callback_requests_unscheduled_idx's WHERE clause exactly (a partial
    // index only gets used when the query's predicate is provably no wider
    // than the index's — Postgres won't infer the calendar_item_id/status
    // relationship on its own).
    .not('status', 'in', '(scheduled,cancelled,unschedulable,closed)')
    // Triage finished, OR it has waited long enough that waiting costs more
    // than the constraints would have bought.
    .or(`triage_status.in.(completed,manual_review,failed),created_at.lte.${graceCutoffIso}`)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 25);

  if (error || !data || data.length === 0) {
    return {
      scheduled: 0,
      skipped: 0,
      released: healed.released,
      repaired: bodies.repaired,
      moved: healed.moved,
    };
  }

  let scheduled = 0;
  let skipped = 0;
  const failures = new Map<string, number>();

  for (const row of data) {
    const outcome = await scheduleCallbackAppointment(row, { nowMs: opts.nowMs, policy });
    if (outcome.ok) {
      scheduled += 1;
      // Best-effort trigger for the meeting-confirmation call, ~24h ahead of
      // this slot (SS2/11a). boss is optional so every existing caller/test
      // of this sweep keeps working unchanged; a real production tick always
      // has one. Never let an enqueue failure stop the row from having been
      // successfully booked — the stuck-row reconciler has no visibility into
      // pg-boss at all, so a swallowed error here would be silent, but a
      // thrown one would incorrectly fail an appointment that WAS booked.
      if (opts.boss) {
        try {
          await enqueueMeetingConfirmDispatch(opts.boss, {
            id: row.id,
            topic: row.topic,
            scheduledAtIso: outcome.startIso,
          }, opts.nowMs, policy);
        } catch (e) {
          console.error('[callback-scheduling] meeting-confirm enqueue failed', row.id, (e as Error)?.message);
        }
        // Sales-closing dispatch trigger — mutually exclusive with the
        // meeting-confirm one above (topic gates both; a row can only ever
        // match one). This is THE fix for the gap where dispatchSalesCall
        // had no caller anywhere in the codebase.
        try {
          await enqueueSalesCallDispatch(opts.boss, {
            id: row.id,
            topic: row.topic,
            scheduledAtIso: outcome.startIso,
          }, opts.nowMs);
        } catch (e) {
          console.error('[callback-scheduling] sales-call enqueue failed', row.id, (e as Error)?.message);
        }
      }
    } else {
      skipped += 1;
      failures.set(outcome.reason, (failures.get(outcome.reason) ?? 0) + 1);
      // A missing or ambiguous connection affects every row equally; retrying
      // the rest of the batch would just repeat the same failure.
      if (
        outcome.reason === 'no_verified_connection' ||
        outcome.reason === 'ambiguous_connection' ||
        outcome.reason === 'decrypt_failed'
      ) {
        break;
      }
    }
  }

  if (scheduled > 0) {
    await sendSlackAlert({
      level: 'info',
      category: 'customer_inquiry',
      title: 'שיחות חוזרות שובצו ביומן',
      source: 'callback-scheduling-sweep',
      // Counts only — no name, phone or note ever leaves the system in an alert.
      fields: { שובצו: scheduled, ...(skipped ? { נדחו: skipped } : {}) },
    });
  }
  if (skipped > 0 && scheduled === 0) {
    await sendSlackAlert({
      level: 'warn',
      category: 'customer_inquiry',
      title: 'שיבוץ שיחות חוזרות נכשל',
      source: 'callback-scheduling-sweep',
      fields: Object.fromEntries(failures),
    });
  }

  // Detection, not repair. A stranded row is invisible to both mechanisms above
  // by construction, so the only way it surfaces is by being counted and
  // reported — see countStrandedCallbacks. Runs last so it also sees anything
  // this tick failed to schedule. Silent at zero, which is the normal state.
  const stranded = await countStrandedCallbacks({ nowMs: opts.nowMs });
  if (stranded > 0) {
    await sendSlackAlert({
      level: 'warn',
      category: 'errors',
      title: 'בקשות שיחה חוזרת נטושות — מועד שחלף ופגישה שאינה בתור',
      source: 'callback-scheduling-sweep',
      // A count, never an id: this goes to a chat room, and the rows are
      // customer requests.
      fields: { נטושות: stranded },
    });
  }

  // The mirror check — see countOrphanedCalendarAppointments' own comment for
  // why this exists and what it catches that the reconcile above cannot.
  const orphaned = await countOrphanedCalendarAppointments({ nowMs: opts.nowMs, policy });
  if (orphaned > 0) {
    await sendSlackAlert({
      level: 'warn',
      category: 'errors',
      title: 'פגישות "שיחה חוזרת" ביומן בלי שורת בקשה תואמת',
      source: 'callback-scheduling-sweep',
      fields: { יתומות: orphaned },
    });
  }

  return { scheduled, skipped, released: healed.released, repaired: bodies.repaired, moved: healed.moved };
}

export { CALLBACK_CATEGORY };
