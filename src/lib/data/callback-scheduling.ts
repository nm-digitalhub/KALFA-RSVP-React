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

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  buildCallbackDraft,
  CALLBACK_CATEGORY,
  CALLBACK_SUBJECT_PREFIX,
  type CallbackItemInput,
} from '@/lib/callbacks/calendar-item';
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
  if (!slot.ok) return { ok: false, reason: slot.reason };

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
 */
export async function reconcileCallbacksWithCalendar(
  opts: { nowMs?: number } = {},
): Promise<{ released: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from('callback_requests')
    .select('id, calendar_item_id, scheduled_at')
    .not('calendar_item_id', 'is', null)
    .gte('scheduled_at', new Date(nowMs - DAY_MS).toISOString());

  if (!rows || rows.length === 0) return { released: 0 };

  const loaded = await loadBusinessConnection(admin);
  // Cannot see the calendar → assume nothing. Releasing rows on a failed read
  // would double-book every one of them on the next sweep.
  if (!loaded.ok) return { released: 0 };

  const scheduledTimes = rows
    .map((r) => (r.scheduled_at ? Date.parse(r.scheduled_at) : NaN))
    .filter((n) => !Number.isNaN(n));
  if (scheduledTimes.length === 0) return { released: 0 };

  const listed = await calendarProvider.listAppointments(loaded.connection.config, {
    start: new Date(Math.min(...scheduledTimes) - DAY_MS),
    end: new Date(Math.max(...scheduledTimes) + DAY_MS),
  });
  if (!listed.ok) return { released: 0 };

  const liveIds = new Set(listed.data.map((item: ExchangeAppointment) => item.id));
  const stale = rows
    .filter((r) => r.calendar_item_id && !liveIds.has(r.calendar_item_id))
    .map((r) => r.id);
  if (stale.length === 0) return { released: 0 };

  await admin
    .from('callback_requests')
    .update({ calendar_item_id: null, exchange_connection_id: null, scheduled_at: null })
    .in('id', stale);

  return { released: stale.length };
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
    .not('status', 'in', '(completed,cancelled)')
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
  opts: { nowMs?: number } = {},
): Promise<number> {
  const nowMs = opts.nowMs ?? Date.now();
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
    end: new Date(nowMs + DEFAULT_CALLBACK_POLICY.horizonMs + DAY_MS),
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
    .in('status', ['new', 'in_progress'])
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
  opts: { limit?: number; nowMs?: number } = {},
): Promise<{ scheduled: number; skipped: number; released: number; repaired: number }> {
  const admin = createAdminClient();

  // Heal first: a request whose appointment the owner deleted is released back
  // into the queue and re-scheduled in THIS tick, not the next one.
  const healed = await reconcileCallbacksWithCalendar({ nowMs: opts.nowMs });
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
    .eq('status', 'new')
    // Triage finished, OR it has waited long enough that waiting costs more
    // than the constraints would have bought.
    .or(`triage_status.in.(completed,manual_review,failed),created_at.lte.${graceCutoffIso}`)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 25);

  if (error || !data || data.length === 0) {
    return { scheduled: 0, skipped: 0, released: healed.released, repaired: bodies.repaired };
  }

  let scheduled = 0;
  let skipped = 0;
  const failures = new Map<string, number>();

  for (const row of data) {
    const outcome = await scheduleCallbackAppointment(row, { nowMs: opts.nowMs });
    if (outcome.ok) {
      scheduled += 1;
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
  const orphaned = await countOrphanedCalendarAppointments({ nowMs: opts.nowMs });
  if (orphaned > 0) {
    await sendSlackAlert({
      level: 'warn',
      category: 'errors',
      title: 'פגישות "שיחה חוזרת" ביומן בלי שורת בקשה תואמת',
      source: 'callback-scheduling-sweep',
      fields: { יתומות: orphaned },
    });
  }

  return { scheduled, skipped, released: healed.released, repaired: bodies.repaired };
}

export { CALLBACK_CATEGORY };
