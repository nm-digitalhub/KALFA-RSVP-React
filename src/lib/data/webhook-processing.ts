import 'server-only';

import {
  classifyMessagePayload,
  type InboundMessagePayload,
} from '@/lib/whatsapp/inbound';
import {
  getGuestsForContact,
  insertInteraction,
  markContactRemovalRequested,
  recordRsvpFromWhatsapp,
  resolveByContextId,
  resolveInboundContact,
  setContactOpStatus,
  setDeliveryStatus,
} from '@/lib/data/interactions';
import { recordReached } from '@/lib/data/billing';
import {
  processCallDncRow,
  processCallResult,
  processCallRsvpRow,
  processOwnerNoteRow,
} from '@/lib/data/call-result-processing';
import { processMeetingOptOutRow } from '@/lib/data/callback-voice-processing';
import { processSalesOptOutRow } from '@/lib/data/sales-voice-processing';
import { intakeMailAsInquiry, REF_CODE_RE } from '@/lib/data/inquiry-mail-intake';
import {
  processTemplateStatusRow,
  processTemplateCategoryRow,
  processTemplateCategoryMisuseRow,
  processTemplateQualityRow,
} from '@/lib/data/template-health-processing';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { submitRsvp } from '@/lib/data/rsvp';
import { handleHeadcountReply, requestHeadcount } from '@/lib/data/headcount';
import { stageWhatsAppImport } from '@/lib/data/whatsapp-import';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
// RSVP quick-reply button.payload -> RsvpStatus. Single source of truth SHARED
// with the OUTBOUND send-time payload injection (client.ts via sendOneWhatsApp),
// so the ids we send and the ids we resolve can never drift. Only these three ids
// capture an RSVP; any other reply id is a normal billable reach that records none.
import { RSVP_BUTTON_MAP } from '@/lib/whatsapp/rsvp-buttons';

// Out-of-band processor for ONE persisted webhook_inbox row (run by the worker,
// not the HTTP request). The intake route only verifies + persists; ALL economic
// logic (billing, opt-out, op-status) lives here so it can be retried
// idempotently and never blocks Meta's webhook. Never log a payload.

// Meta delivery-failure codes we treat as a DEFINITIVE wrong-number signal.
//
// Conservative by design: 131026 ("Message undeliverable") is the only code we
// act on, and even it is imperfect — Meta bundles several causes under it
// (recipient not on WhatsApp, recipient on an old app version, recipient hasn't
// accepted the latest ToS). We accept that residual ambiguity ONLY because the
// raw delivery_error_code is ALWAYS persisted (below) regardless of this set, so
// a mislabel is fully auditable and reversible from the admin inspector. Tune
// this set there if the false-positive rate proves too high.
const WRONG_NUMBER_CODES = new Set(['131026']);

// The persisted status payload shape we read (subset of the provider status
// object). `errors[0].code` carries the Meta failure code on a `failed` status.
type StatusPayload = {
  status?: string;
  errors?: Array<{ code?: number | string }>;
};

export async function processWebhookEvent(row: WebhookInboxRow): Promise<void> {
  if (row.event_kind === 'message') {
    await processMessage(row);
    return;
  }
  if (row.event_kind === 'status') {
    await processStatus(row);
    return;
  }
  if (row.event_kind === 'call_result') {
    await processCallResult(row);
    return;
  }
  if (row.event_kind === 'call_rsvp') {
    await processCallRsvpRow(row);
    return;
  }
  if (row.event_kind === 'call_dnc') {
    await processCallDncRow(row);
    return;
  }
  if (row.event_kind === 'call_owner_note') {
    await processOwnerNoteRow(row);
    return;
  }
  // Meeting-booking agent's mark_opt_out (mtg/cb/dnc/[token]) — a SEPARATE
  // kind from call_dnc on purpose (plan §7: this surface must never enter the
  // call_attempts/RSVP/billing drain paths above). Its own dedicated
  // processing function; never processCallDncRow.
  if (row.event_kind === 'mtg_dnc') {
    await processMeetingOptOutRow(row);
    return;
  }
  // Sales-closing agent's mark_dnc (sls/tool/dnc/[token]) — its own kind,
  // same isolation reasoning as mtg_dnc above; never processCallDncRow.
  if (row.event_kind === 'sls_dnc') {
    await processSalesOptOutRow(row);
    return;
  }
  if (row.event_kind === 'graph_mail') {
    await processGraphMail(row);
    return;
  }
  if (row.event_kind === 'email_delivery') {
    await processEmailDelivery(row);
    return;
  }
  if (row.event_kind === 'template_status') {
    await processTemplateStatusRow(row);
    return;
  }
  if (row.event_kind === 'template_category') {
    await processTemplateCategoryRow(row);
    return;
  }
  if (row.event_kind === 'template_category_misuse') {
    await processTemplateCategoryMisuseRow(row);
    return;
  }
  if (row.event_kind === 'template_quality') {
    await processTemplateQualityRow(row);
    return;
  }
  // Unknown kind — nothing to do; caller marks it processed (no retry storm).
}

// An Outlook message filed into the intake folder. The notification carried
// only an id, so the message itself is fetched here — in the worker, which is
// the only place that may hold the mailbox certificate.
//
// Every outcome except a thrown error is terminal on purpose. 'gone' means the
// item was deleted between notification and fetch; 'duplicate' means Graph
// redelivered; 'skipped' means it was our own mail or a bounce. None of those
// improve by retrying, and leaving the row unprocessed would just re-run the
// same fetch forever. Only an unexpected throw reaches the retry budget.
async function processGraphMail(row: WebhookInboxRow): Promise<void> {
  if (!row.message_id) return;
  // The result is deliberately not logged: this module's rule is that nothing
  // touching a webhook payload is written to a log, and every outcome here is
  // already visible in durable state — a created inquiry as a contact_messages
  // row, anything else as a processed webhook_inbox row with no row behind it.
  await intakeMailAsInquiry(row.message_id);
}

// An inbound human message. Bills the reach when it is a billable type AND it
// resolves to a contact we targeted. Resolution prefers the precise Meta
// context.id binding (the reply quotes the exact outbound wamid we sent); it
// falls back to the sender phone when the reply carries no context — a plain
// typed-in reply (the common "כן אגיע" / "הסר" case, not a swipe/button) — so a
// billable reach AND any opt-out it carries are never silently dropped (this
// restores the pre-rework billing surface; the context.id path adds precision on
// top of it). Double-bill-safe either way: insertInteraction's
// UNIQUE(channel, provider_id) on this inbound message_id + the `fresh` gate bill
// at most once. Only when NEITHER context nor phone resolves is it recorded
// processed without billing.
async function processMessage(row: WebhookInboxRow): Promise<void> {
  const messageId = row.message_id;
  if (!messageId) return;

  const payload = (row.payload ?? {}) as InboundMessagePayload;
  // Owner-sent guest lists (CSV document / shared contact cards) are an
  // IMPORT, not a campaign interaction — consumed before any billing logic.
  if (await stageWhatsAppImport(row)) return;

  const { billable, removal, replyId } = classifyMessagePayload(payload);
  if (!billable) return;

  const contextId = row.context_message_id;
  const resolved =
    (contextId ? await resolveByContextId(contextId) : null) ??
    (payload.from ? await resolveInboundContact(payload.from) : null);
  if (!resolved) return;

  // Dedupe FIRST (UNIQUE(channel, provider_id)) so a re-processed/duplicate row
  // can't double-bill; recordReached then stays gated by `fresh`.
  const fresh = await insertInteraction({
    event_id: resolved.eventId,
    campaign_id: resolved.campaignId,
    contact_id: resolved.contactId,
    channel: 'whatsapp',
    direction: 'in',
    kind: 'message',
    provider_id: messageId,
    context_message_id: contextId,
    billable: true,
  });

  if (fresh) {
    await recordReached({
      eventId: resolved.eventId,
      campaignId: resolved.campaignId,
      contactId: resolved.contactId,
      channel: 'whatsapp',
      attemptId: messageId,
      evidence: removal
        ? 'whatsapp_inbound_removal'
        : 'whatsapp_inbound_message',
      providerRef: messageId,
    });
  }

  // D4: an opt-out reply BILLS (it is a human reach) and only THEN stops future
  // outreach — never the reverse, or the billing RPC's removal guard would block
  // the reach that carries the removal. Runs even on a deduped re-process
  // (idempotent) so an opt-out is never lost.
  if (removal) {
    await markContactRemovalRequested(resolved.contactId);
  }

  // C9: a recognized RSVP quick-reply BUTTON records the RSVP through the same
  // atomic submit_rsvp gate the public form uses — no RSVP rule is reimplemented
  // here. Gated on `fresh` (NOT just the RPC's data-idempotency) so a Meta retry
  // of the same inbound wamid cannot append duplicate audit rows. attending needs
  // >= 1 attendee (submit_rsvp rejects 0), so it defaults to a single adult and
  // the guest refines exact counts via the link; declined/maybe carry no counts
  // (the RPC zeroes them). A non-RSVP reply id leaves rsvpStatus undefined → no
  // submit. The token is resolved fresh from the single matched guest;
  // submit_rsvp gates a revoked/closed/expired one (outcome.ok === false → no
  // source marker).
  const rsvpStatus = replyId ? RSVP_BUTTON_MAP[replyId] : undefined;
  if (fresh && rsvpStatus) {
    // ריבוי-אורחים: contact אחד (טלפון) יכול לגבות כמה guests — ל-guests.contact_id
    // אין ייחודיות, ו-contacts ייחודי רק לפי (event_id, normalized_phone). לכן
    // לחיצת "מגיע" מטלפון משותף דו-משמעית לגבי איזה אורח התכוון. רושמים RSVP רק
    // כשיש בדיוק אורח אחד מאחורי ה-contact — לעולם לא מנחשים אורח שרירותי. אפס או
    // יותר מאחד → מדלגים על רישום ה-RSVP (ה-billing/opt-out למעלה הם ברמת contact
    // וממשיכים לרוץ). הפתרון העתידי לריבוי-אורחים הוא עמוד-RSVP ברמת ה-contact
    // שנותן לבחור את האורח הנכון.
    const guests = await getGuestsForContact(
      resolved.eventId,
      resolved.contactId,
    );
    if (guests.length === 1) {
      const guest = guests[0];
      const outcome = await submitRsvp(guest.rsvp_token, {
        status: rsvpStatus,
        adults: rsvpStatus === 'attending' ? 1 : 0,
        kids: 0,
      });
      if (outcome.ok) {
        await recordRsvpFromWhatsapp(resolved.eventId, guest.id, rsvpStatus);
        // Headcount flow: right after an ATTENDING press, ask "כמה תגיעו?"
        // inside the 24h window the press just opened. Fail-soft inside.
        if (rsvpStatus === 'attending') {
          await requestHeadcount(guest.id, resolved.contactId);
        }
      }
    }
  }

  // A plain-text inbound (not a button reply) may be the headcount answer
  // ("0".."10"). Gated on `fresh` like the RSVP path so a Meta retry can't
  // double-handle; non-numeric text is ignored inside.
  if (fresh && !rsvpStatus) {
    const textBody = (payload as { text?: { body?: string } }).text?.body;
    if (typeof textBody === 'string' && textBody.trim() !== '') {
      await handleHeadcountReply(resolved.eventId, resolved.contactId, textBody);
    }
  }
}

// A message-delivery status (sent/delivered/read/failed) for an OUTBOUND message
// we sent. Non-billing: it only advances delivery_status + the raw error code on
// that outbound interaction. A `failed` with a definitive wrong-number code also
// flips the contact's op_status (conservative — see WRONG_NUMBER_CODES).
async function processStatus(row: WebhookInboxRow): Promise<void> {
  const messageId = row.message_id;
  if (!messageId) return;

  const payload = (row.payload ?? {}) as StatusPayload;
  const status = typeof payload.status === 'string' ? payload.status : '';
  if (!status) return;

  if (status !== 'failed') {
    await setDeliveryStatus(messageId, status, null);
    return;
  }

  const rawCode = payload.errors?.[0]?.code;
  const errorCode = rawCode != null ? String(rawCode) : null;
  const { contactId } = await setDeliveryStatus(messageId, status, errorCode);

  if (errorCode && contactId && WRONG_NUMBER_CODES.has(errorCode)) {
    await setContactOpStatus(contactId, 'wrong_number');
  }
}

// ---------------------------------------------------------------------------
// Resend delivery outcomes.
//
// SCOPE, and why it is this small. MEASURED 2026-08-26: 10 inquiries exist in
// total, and the follow-up cascade has never fired once (0 reminders, 0
// warnings, 0 rating requests, 0 auto-closes). Google/Yahoo's bulk-sender rules
// begin at 5,000 messages a day — four orders of magnitude above us — and Resend
// already runs its own suppression list, so the deliverability-reputation work
// the industry guidance is about is both inapplicable at this volume and already
// done by the provider. What is NOT covered by any of that is the one thing that
// actually matters here: at ten inquiries, one customer who never received our
// reply is 10% of the book. So this alerts a human and does nothing else.
//
// Deliberately NOT built (revisit on real volume, not on speculation): stopping
// the cascade, an `email_undeliverable_at` column, per-address or per-person
// suppression, send-time tagging to join events back to an inquiry.
//
// `email.complained` is stored and otherwise IGNORED on purpose. Its payload
// carries no feedback type, no source, and nothing else that would show whether
// a person deliberately reported the mail or a filter classified it — and every
// mail in this flow concerns an inquiry the person opened themselves, so there
// is no unsolicited list to remove anyone from.
type BouncePayload = {
  type?: string;
  data?: {
    subject?: string;
    bounce?: { type?: string; subType?: string };
  };
};

// Resend's own docs disagree with each other on this vocabulary: the webhook
// payload reference gives `Permanent` / `Temporary` with subtypes `Suppressed`
// and `MessageRejected`, while the bounce reference gives `Permanent` /
// `Transient` / `Undetermined` with an entirely different subtype list. Neither
// page contains the other's values (both read 2026-08-26). So this does not
// match a closed list of "bad" values: it names only the types that are known to
// be non-actionable, and anything unrecognised still raises an alert. A soft
// bounce stays silent; a hard bounce, or a value the docs never mentioned, does
// not pass unnoticed.
const NON_ACTIONABLE_BOUNCE_TYPES = new Set(['Transient', 'Temporary', 'Undetermined']);

async function processEmailDelivery(row: WebhookInboxRow): Promise<void> {
  const payload = (row.payload ?? {}) as BouncePayload;
  // sent / delivered / delivery_delayed / complained are recorded by the route
  // and acted on by nobody. Only a bounce means a customer got nothing.
  if (payload.type !== 'email.bounced') return;

  const bounceType = payload.data?.bounce?.type;
  if (bounceType && NON_ACTIONABLE_BOUNCE_TYPES.has(bounceType)) return;

  // The [KLF-XXXXXXXX] token, never the recipient address: Slack alerts in this
  // codebase carry no personal data (inquiry-followup's sweep alert posts counts
  // only). The ref code is enough to find the inquiry in the admin, where the
  // address is already visible to an authorised operator. The SMTP
  // diagnosticCode is excluded for the same reason — it routinely quotes the
  // recipient address back verbatim.
  const refCode = payload.data?.subject?.match(REF_CODE_RE)?.[1] ?? null;
  const recognised = bounceType === 'Permanent';

  await sendSlackAlert({
    level: recognised ? 'warn' : 'info',
    category: 'customer_inquiry',
    source: 'resend-bounce',
    title: recognised
      ? 'מייל לפנייה לא נמסר — כתובת הלקוח דוחה'
      : 'דחיית מייל עם סוג שאינו מוכר',
    detail: recognised
      ? (refCode
          ? `הפנייה ${refCode}: המייל האחרון אליה נדחה סופית. הלקוח לא קיבל אותו — כדאי ליצור קשר בדרך אחרת.`
          : 'מייל יוצא נדחה סופית. אין קוד פנייה בנושא, אז יש לאתר אותו ב-/admin/webhooks.')
      : `סוג הדחייה שהתקבל (${bounceType ?? 'חסר'}) אינו מופיע בתיעוד של Resend. ` +
        'ההתראה נשלחת כדי שדחייה סופית לא תיבלע בגלל ערך שלא ציפינו לו.',
    fields: {
      ...(refCode ? { refCode } : {}),
      bounceType: bounceType ?? 'missing',
      ...(payload.data?.bounce?.subType ? { subType: payload.data.bounce.subType } : {}),
    },
  });
}
