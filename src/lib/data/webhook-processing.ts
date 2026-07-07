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
  // Unknown kind — nothing to do; caller marks it processed (no retry storm).
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
