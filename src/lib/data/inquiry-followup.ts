import 'server-only';

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { getEmailSender } from '@/lib/email/sender';
import {
  inquiryReminderEmail,
  inquiryClosingWarningEmail,
  inquiryRatingRequestEmail,
} from '@/lib/email/templates';
import { getAppOrigin } from '@/lib/url';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Silence-based follow-up cascade for an inquiry the admin already replied to
// (docs/admin-contacts-redesign-plan-2026-08-25.md §3). Same periodic-tick
// idiom as auto-thankyou.ts's sweep: a pg-boss cron job (worker/main.ts) calls
// runInquiryFollowupSweep() every 5 minutes — eligibility is re-read fresh from
// the DB on every tick, never a per-row delayed job, so there is nothing
// pg-boss-side to register or cancel when a reply lands or the admin flips the
// kill-switch.
//
//   admin reply (replied_at = T0, status stays in_progress)
//      │
//      ├─ T0 + 24h silence → reminder email
//      ├─ T0 + 72h silence → closing-warning email
//      └─ T0 + 96h silence → auto-close (status → done, auto_closed_at = now)
//                             + rating-request email (a fresh rating_token,
//                             /rate/[token] — the customer picks 😕/😐/😊 and
//                             may leave a comment; no self-service close link)
//
// "Silence" is read ONLY from `replied_at`, gated by status='in_progress' —
// not from `last_activity_at` (sendInquiryReply bumps that too, so it would
// never actually reveal silence). The gate is self-cleaning: any customer
// reply runs attachReplyToInquiry (inquiry-mail-intake.ts), which sets
// status='reopened' unconditionally — the row leaves 'in_progress' the
// instant the customer responds, so every query below already excludes it.

type AdminClient = ReturnType<typeof createAdminClient>;

const HOUR_MS = 3_600_000;
const REMINDER_AFTER_MS = 24 * HOUR_MS;
const WARNING_AFTER_MS = 72 * HOUR_MS;
const AUTO_CLOSE_AFTER_MS = 96 * HOUR_MS;

type DueRow = { id: string; email: string; name: string; ref_code: string; replied_at: string };

/** Kill-switch — false (and the sweep a no-op) unless an admin explicitly arms it. */
export async function getInquiryFollowupEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('inquiry_followup_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.inquiry_followup_enabled === true;
  } catch {
    return false;
  }
}

export async function listDueForReminder(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<DueRow[]> {
  const cutoff = new Date(nowMs - REMINDER_AFTER_MS).toISOString();
  const { data } = await admin
    .from('contact_messages')
    .select('id, email, name, ref_code, replied_at')
    .eq('status', 'in_progress')
    .not('email', 'is', null)
    .not('replied_at', 'is', null)
    .lte('replied_at', cutoff)
    .is('reminder_sent_at', null);
  return (data ?? []) as DueRow[];
}

export async function listDueForWarning(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<DueRow[]> {
  const cutoff = new Date(nowMs - WARNING_AFTER_MS).toISOString();
  const { data } = await admin
    .from('contact_messages')
    .select('id, email, name, ref_code, replied_at')
    .eq('status', 'in_progress')
    .not('email', 'is', null)
    .not('replied_at', 'is', null)
    .lte('replied_at', cutoff)
    .not('reminder_sent_at', 'is', null)
    .is('closing_warning_sent_at', null);
  return (data ?? []) as DueRow[];
}

export async function listDueForAutoClose(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<DueRow[]> {
  const cutoff = new Date(nowMs - AUTO_CLOSE_AFTER_MS).toISOString();
  const { data } = await admin
    .from('contact_messages')
    .select('id, email, name, ref_code, replied_at')
    .eq('status', 'in_progress')
    .not('email', 'is', null)
    .not('replied_at', 'is', null)
    .lte('replied_at', cutoff)
    .not('closing_warning_sent_at', 'is', null)
    .is('auto_closed_at', null);
  return (data ?? []) as DueRow[];
}

/**
 * Batched once per tier, outside the per-row loop — NOT a per-row lookup.
 * Mirrors listInquiryMessages's own batching precedent against this same
 * growing table ("a per-row read would be a classic N+1... The caller groups
 * by inquiry_id" — src/lib/data/admin/contacts.ts).
 */
async function lastInboundMessageIds(admin: AdminClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from('inquiry_messages')
    .select('inquiry_id, message_id')
    .eq('direction', 'inbound')
    .in('inquiry_id', ids)
    // Filtered at the query level, not left to ordering alone: message_id is
    // nullable (web-form-originated founding messages never had an email
    // Message-ID). Without this filter, "most recent inbound row" could pick a
    // null-message_id row even when an older row on the same thread has a real
    // one, silently dropping In-Reply-To for a thread that does have something
    // to reference.
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) {
    // Same non-fatal reasoning as sendInquiryReply's lookup — degrade to "no
    // In-Reply-To header this tick" for the whole batch rather than blocking
    // the tier.
    console.error('[lastInboundMessageIds] lookup failed', error);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    // row.message_id is still typed string | null by the generated schema
    // (the .not() filter above is a runtime guarantee, not a type-level one) —
    // the defensive check keeps the Map's value type honestly `string`.
    if (row.message_id && !map.has(row.inquiry_id)) map.set(row.inquiry_id, row.message_id);
  }
  return map;
}

async function sendStageEmail(
  row: DueRow,
  inReplyTo: string | undefined,
  stage: 'reminder' | 'warning',
  build: (input: { recipientName: string; origin: string; refCode: string }) => {
    subject: string;
    html: string;
    text: string;
  },
): Promise<void> {
  const origin = await getAppOrigin();
  const { subject, html, text } = build({ recipientName: row.name, origin, refCode: row.ref_code });
  const sender = await getEmailSender();
  await sender.send({
    to: row.email,
    subject,
    html,
    text,
    ...(inReplyTo ? { inReplyTo } : {}),
    // §2.6: closes the outbound duplicate-send gap when a crash lands between
    // this send and the stamp UPDATE below. replied_at is in the key
    // deliberately, not just row.id — a reopen resets the cascade stamps, so
    // the same contact_messages.id can go through this stage more than once
    // across its lifetime, each time with a fresh replied_at. Without it, a
    // second, legitimate cascade cycle would collide with the first cycle's
    // already-used key and be silently suppressed.
    idempotencyKey: `inquiry-${stage}/${row.id}/${row.replied_at}`,
  });
}

/**
 * Runs the three stages IN ORDER, oldest-eligibility-first is unnecessary —
 * each stage's own `.eq('status','in_progress')` + timestamp guards make a
 * row eligible for at most one stage per tick, so there's no double-send risk
 * from processing all three in one pass. Each row is independent: one
 * failing must not block the rest, matching auto-thankyou.ts's own per-row
 * try/catch discipline.
 */
export async function runInquiryFollowupSweep(nowMs: number = Date.now()): Promise<{
  reminded: number;
  warned: number;
  autoClosed: number;
  failed: number;
}> {
  const admin = createAdminClient();
  let reminded = 0;
  let warned = 0;
  let autoClosed = 0;
  let failed = 0;

  const reminderRows = await listDueForReminder(admin, nowMs);
  const reminderInReplyTo = await lastInboundMessageIds(admin, reminderRows.map((r) => r.id));
  for (const row of reminderRows) {
    try {
      await sendStageEmail(row, reminderInReplyTo.get(row.id), 'reminder', inquiryReminderEmail);
      const { error } = await admin
        .from('contact_messages')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'in_progress');
      if (error) throw new Error(error.message);
      reminded++;
    } catch (err) {
      failed++;
      console.error(
        '[inquiry-followup] reminder failed',
        row.id,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  const warningRows = await listDueForWarning(admin, nowMs);
  const warningInReplyTo = await lastInboundMessageIds(admin, warningRows.map((r) => r.id));
  for (const row of warningRows) {
    try {
      await sendStageEmail(row, warningInReplyTo.get(row.id), 'warning', inquiryClosingWarningEmail);
      const { error } = await admin
        .from('contact_messages')
        .update({ closing_warning_sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'in_progress');
      if (error) throw new Error(error.message);
      warned++;
    } catch (err) {
      failed++;
      console.error(
        '[inquiry-followup] closing warning failed',
        row.id,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  const autoCloseRows = await listDueForAutoClose(admin, nowMs);
  const autoCloseInReplyTo = await lastInboundMessageIds(admin, autoCloseRows.map((r) => r.id));
  for (const row of autoCloseRows) {
    try {
      // SEND-THEN-PERSIST for the auto-close itself, same discipline as
      // sendInquiryReply: the rating email is the primary effect of this
      // stage, so it goes out FIRST. If it throws, the row stays
      // 'in_progress' and the next tick retries — a row must never close
      // without ever having been asked for a rating.
      //
      // The rating_token itself is claimed BEFORE the send, not generated
      // fresh on every attempt — fixed defect, independent adversarial
      // verification 2026-08-25: a fresh randomBytes() token on every
      // attempt produced a DIFFERENT email payload each retry, while the
      // idempotencyKey below is stable across retries of the same cycle
      // (row.id + row.replied_at). Resend's documented behavior is to
      // REJECT a reused idempotency key when the payload differs (409
      // invalid_idempotent_request), not silently dedupe it — so exactly
      // the crash-between-send-and-persist case this idempotency key exists
      // to cover instead made every retry fail loudly, left rating_token
      // never persisted (the customer's actually-delivered email pointed at
      // a token that was never written to the DB — a permanently dead
      // /rate/[token] link), and eventually sent a second, differently-
      // tokened email once the 24h key window expired. Claiming the token
      // first — read the row's current rating_token fresh (not from
      // listDueForAutoClose's earlier read, which predates this claim), and
      // only generate+persist a new one if none exists yet — makes every
      // retry within the same cycle build the byte-identical payload Resend
      // requires, so a genuine retry is correctly deduped instead of
      // rejected.
      const { data: current, error: currentError } = await admin
        .from('contact_messages')
        .select('rating_token, rating_requested_at')
        .eq('id', row.id)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);

      let ratingToken: string;
      if (current?.rating_token && current.rating_requested_at) {
        ratingToken = current.rating_token;
      } else {
        ratingToken = randomBytes(16).toString('hex');
        const { error: claimError } = await admin
          .from('contact_messages')
          .update({ rating_token: ratingToken, rating_requested_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'in_progress');
        if (claimError) throw new Error(claimError.message);
      }

      const origin = await getAppOrigin();
      const { subject, html, text } = inquiryRatingRequestEmail({
        recipientName: row.name,
        ratingToken,
        origin,
        refCode: row.ref_code,
      });
      const sender = await getEmailSender();
      const inReplyTo = autoCloseInReplyTo.get(row.id);
      await sender.send({
        to: row.email,
        subject,
        html,
        text,
        ...(inReplyTo ? { inReplyTo } : {}),
        idempotencyKey: `inquiry-rating/${row.id}/${row.replied_at}`,
      });

      const now = new Date().toISOString();
      const { error } = await admin
        .from('contact_messages')
        .update({
          status: 'done',
          auto_closed_at: now,
          handled_at: now,
        })
        .eq('id', row.id)
        .eq('status', 'in_progress');
      if (error) throw new Error(error.message);
      autoClosed++;
    } catch (err) {
      failed++;
      console.error(
        '[inquiry-followup] auto-close failed',
        row.id,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  if (reminded > 0 || warned > 0 || autoClosed > 0 || failed > 0) {
    void sendSlackAlert({
      level: failed > 0 ? 'error' : 'info',
      category: 'send_health',
      source: 'inquiry-followup-sweep',
      title: 'סיכום מעקב שקט בפניות',
      // ids/counts only — NO PII (no names/emails).
      detail: `תזכורות ${reminded} · אזהרות ${warned} · נסגרו אוטומטית ${autoClosed} · כשלים ${failed}`,
      fields: { reminded, warned, autoClosed, failed },
    });
  }

  return { reminded, warned, autoClosed, failed };
}
