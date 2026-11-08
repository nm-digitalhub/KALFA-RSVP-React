'use server';

import { z } from 'zod';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import {
  createCampaign,
  changeCampaignPackage,
  acceptCampaignBenefit,
  pauseCampaign,
  closeCampaign,
  cancelCampaign,
  getCampaignRef,
  getCampaignForEvent,
  updateThankyouSchedule,
} from '@/lib/data/campaigns';
import { requireOwnedEvent, publishEvent, closeEvent, getEvent } from '@/lib/data/events';
import { logActivity } from '@/lib/data/activity';
import { missingEventPrerequisites } from '@/lib/data/setup-steps';
import { syncEventToExchange, markEventExchangeCancelled } from '@/lib/data/event-exchange-sync';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import { recordPackageApproval } from '@/lib/data/agreements';
import {
  SETUP_ACKNOWLEDGMENT_KEYS,
  approveCampaignSchema,
  choosePackageSchema,
  rescheduleEventSchema,
  setupAcknowledgmentsSchema,
  thankyouScheduleSchema,
} from '@/lib/validation/campaigns';
import { rescheduleEventForAdmin } from '@/lib/data/admin/events';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { socketClientIp } from '@/lib/security/client-ip';
import { zfd } from 'zod-form-data';

// A form whose fields this file does not read: the one-button forms (pause, close, cancel, the three sends, the event
// close, the benefit) post nothing but the bound ids. It accepts any FormData and never fails.
const buttonForm = zfd.formData({});

// "אישור פרטי האירוע והמשך" — ONE owner decision that (audit §2 / recommended
// flow step 5): confirms the event details (the former "publish" — moves
// draft → active so R9 lets a campaign exist; the dates stay editable until the
// first message is sent, R5), then returns to the setup flow, where the owner chooses a package — that choice creates
// the campaign. eventId is bound on the client.
//
// ON A DRAFT EVENT the owner must first acknowledge three things (the date and
// time, the venue, the lock) and nothing may be missing from the details. BOTH
// are enforced HERE, on the server: the confirm form disables its button until
// the boxes are ticked and the details step lists what is missing, but neither
// is a control. The acknowledgment is recorded on the activity log (keys only,
// never the wording or any personal data). On an already-confirmed event this is
// a plain continue and needs neither.
//
// The acknowledgments are checked in the body, after the ownership gate and only on a draft, so the input schema takes
// the form as it is and never fails.
//
// publishEvent throws only our own safe Hebrew messages, which reach the customer as they are (src/lib/safe-action.ts).
export const setupCampaignAction = actionClient
  .inputSchema(zfd.formData(z.record(z.string(), z.unknown())))
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId] }) => {
    const event = await requireOwnedEvent(eventId);
    if (event.status === 'draft') {
      if (!setupAcknowledgmentsSchema.safeParse(parsedInput).success) {
        returnUserError('יש לאשר את כל הסעיפים כדי להמשיך.');
      }
      // Ownership is already proven above; the prerequisites need the venue and
      // celebrant columns that the ownership gate does not select.
      const missing = missingEventPrerequisites(await getEvent(eventId));
      if (missing.length > 0) {
        returnUserError(`יש להשלים לפני האישור: ${missing.join(', ')}`);
      }
      await publishEvent(eventId);
      await logActivity({
        eventId,
        action: 'event.setup_confirmed',
        meta: { acknowledged: [...SETUP_ACKNOWLEDGMENT_KEYS], event_date: event.event_date },
      });
      // Best-effort Exchange calendar sync (Layer 2) — syncEventToExchange never
      // throws (see its own module note), so a mailbox/connection failure here
      // must never surface as a confirm failure to the customer.
      await syncEventToExchange(eventId);
    }
    // The campaign is created in the next step, when the owner chooses a package; its price and quota are the ones
    // chosen.

    revalidatePath(`/app/events/${eventId}`);
    revalidatePath(`/app/events/${eventId}/campaign`);
    redirect(`/app/events/${eventId}/setup`);
  });

// The setup flow's "בחירת חבילה" step: the owner picks one of the fixed-price packages on offer, and the campaign is
// created from it. The browser submits only the package id; createCampaign re-checks everything on the server —
// ownership, that the event is open and in the future, that the package is an offer (the package switch is on), and that
// the package contract (its own agreement document) is approved — and throws only its own safe Hebrew messages.
export const choosePackageAction = actionClient
  .inputSchema(zfd.formData({ package_id: zfd.text(choosePackageSchema.shape.package_id) }))
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput: { package_id }, bindArgsParsedInputs: [eventId] }) => {
    // A pending campaign already exists → this is a PACKAGE CHANGE (personal-coupons task 5.3,
    // D5/D17): one DB transaction moves the campaign, the price and the bound benefit to the new
    // package. Any other state keeps createCampaign's create-or-continue contract (an approved or
    // later campaign is returned unchanged — no silent price change past approval).
    const existing = await getCampaignForEvent(eventId);
    if (existing && existing.status === 'pending_approval') {
      const changed = await changeCampaignPackage(eventId, package_id);
      if (changed.changed) {
        await logActivity({
          eventId,
          action: 'campaign.package_chosen',
          meta: { campaignId: changed.id, packageId: package_id, changedExisting: true },
        });
      }
    } else {
      const campaign = await createCampaign(eventId, package_id);
      await logActivity({
        eventId,
        action: 'campaign.package_chosen',
        meta: { campaignId: campaign.id, packageId: package_id },
      });
    }

    revalidatePath(`/app/events/${eventId}`);
    revalidatePath(`/app/events/${eventId}/campaign`);
    redirect(`/app/events/${eventId}/setup`);
  });


// The fixed-price package is APPROVED, not signed: the customer reads the terms and ticks two boxes (the terms and
// the privacy policy). No drawn signature and no phone code. The browser sends which version of the terms it showed
// (`terms_version`); recordPackageApproval compares it with the approved package document, derives everything else on the
// server, and records who, when, from where and which version. The approval is the step right before paying, so the
// customer lands straight on the payment page, not back on the setup steps.
// The acceptance flow (task 5.5, ש5/D21): the banner's "יש לך הטבה — לחץ לקבל". Accepting
// supersedes the approved price with the benefit's discounted one and routes back to the approval
// step (the campaign is pending_approval again); ignoring the banner leaves the approved price
// payable as it is.
export const acceptBenefitAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    const result = await acceptCampaignBenefit(eventId, campaignId);
    if (result === 'none') {
      returnUserError('לא נמצאה הטבה זמינה לקבלת ההנחה. ייתכן שפג תוקפה.');
    }

    revalidatePath(`/app/events/${eventId}`);
    revalidatePath(`/app/events/${eventId}/campaign`);
    // Straight to approving the NEW terms at the discounted price.
    redirect(`/app/events/${eventId}/setup`);
  });

// The approval form as posted, read into approveCampaignSchema's own keys (the version shown is `terms_version` on the
// form, `tos_version` in the schema), so each message lands where the form shows it. The campaign id is the bound
// argument.
const approvePackageTermsForm = zfd.formData(
  z.preprocess(
    (form: Record<string, unknown>) => ({
      tos_version: form.terms_version ?? null,
      terms_accepted: form.terms_accepted === 'on',
      privacy_accepted: form.privacy_accepted === 'on',
    }),
    approveCampaignSchema.omit({ campaign_id: true }),
  ),
);

export const approvePackageTermsAction = actionClient
  .inputSchema(approvePackageTermsForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId, campaignId] }) => {
    const h = await headers();
    // Evidence on the signed agreement (PDF and approve_package_terms), so the address is the one nginx
    // saw on the socket, never the client-controlled x-forwarded-for. Unknown stays null.
    const ip = socketClientIp((name) => h.get(name));
    const userAgent = h.get('user-agent');

    let result: Awaited<ReturnType<typeof recordPackageApproval>>;
    try {
      result = await recordPackageApproval({
        campaignId,
        termsVersion: parsedInput.tos_version,
        ip,
        userAgent,
      });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שמירת האישור נכשלה. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.error);

    revalidatePath(`/app/events/${eventId}`);
    revalidatePath(`/app/events/${eventId}/campaign`);
    redirect(`/app/events/${eventId}/campaign/${campaignId}/payment`);
  });

// --- Campaign lifecycle (§9) ----------------------------------------------------
// Each binds (eventId, campaignId) on the client; authorization is enforced inside
// the data-layer transition (`campaigns.runstate` staff for pause/close). All
// revalidate the manage page. There is no customer start: a recorded payment
// starts a package (design D23, activate-paid-package.ts).

export const pauseCampaignAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    try {
      await pauseCampaign(campaignId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('השהיית הקמפיין נכשלה.');
    }
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    return { notice: 'הקמפיין הושהה — לא יישלחו פניות חדשות.' };
  });

export const closeCampaignAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    try {
      await closeCampaign(campaignId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('סגירת הקמפיין נכשלה.');
    }
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    return { notice: 'הקמפיין נסגר.' };
  });

// Manual gift-reminder send (message_key 'gift', kalfa_event_gift_v1).
// Ownership contract: resolve the campaign's event server-side, verify the
// CURRENT user owns it, only then send.
// sendCampaignWhatsApp re-checks every §8.3 gate (outreach enabled, campaign
// active, allowed channel, active template, consent) and fail-closes into the
// params_incomplete sink when the gift link is not configured.
//
// In the three sends below, `result` stays null when the campaign is not this event's: the "not found" message is
// raised after the try, since one raised inside it would be caught and replaced by the send's failure message.
export const sendGiftReminderAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    let result: { sent: number; skipped: number } | null = null;
    try {
      const campaign = await getCampaignRef(campaignId);
      if (campaign && campaign.event_id === eventId) {
        await requireOwnedEvent(campaign.event_id);
        result = await sendCampaignWhatsApp(campaignId, 'gift');
      }
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שליחת תזכורת המתנה נכשלה.');
    }
    if (!result) returnUserError('השירות לא נמצא.');
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    if (result.sent === 0) {
      returnUserError(
        'לא נשלחו תזכורות — ודאו שקישור המתנה מולא באירוע, שהשירות פעיל ושתבנית המתנה מאושרת ופעילה.',
      );
    }
    return {
      notice:
        result.skipped > 0
          ? `נשלחו ${result.sent} תזכורות מתנה (${result.skipped} דולגו).`
          : `נשלחו ${result.sent} תזכורות מתנה.`,
    };
  });

// Event-day reminder to CONFIRMED guests (guests.status='attending') + a Bit
// payment button. Manual, non-billable — same gate model as the gift send
// (sendCampaignWhatsApp re-checks outreach enabled + active campaign + approved
// template; the confirmed-only filter and the Bit token live in that batch).
export const sendEventDayReminderAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    let result: { sent: number; skipped: number } | null = null;
    try {
      const campaign = await getCampaignRef(campaignId);
      if (campaign && campaign.event_id === eventId) {
        await requireOwnedEvent(campaign.event_id);
        result = await sendCampaignWhatsApp(campaignId, 'event_day_pay');
      }
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שליחת תזכורת יום האירוע נכשלה.');
    }
    if (!result) returnUserError('השירות לא נמצא.');
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    if (result.sent === 0) {
      returnUserError(
        'לא נשלחו תזכורות — ודאו שקישור הביט מולא באירוע, שיש מאשרי הגעה, שהשירות פעיל ושתבנית יום האירוע מאושרת ופעילה.',
      );
    }
    return {
      notice:
        result.skipped > 0
          ? `נשלחו ${result.sent} תזכורות יום האירוע (${result.skipped} דולגו).`
          : `נשלחו ${result.sent} תזכורות יום האירוע.`,
    };
  });

// Post-event thank-you (message_key 'thankyou'). Manual, non-billable — same
// gate model as gift/event-day (sendCampaignWhatsApp re-checks outreach enabled +
// active campaign + approved template). This is the ONE message_key allowed past
// the L1 past-event gate (POST_EVENT_MESSAGE_KEYS in template-spec.ts). This is
// the manual, owner-driven path; the auto-thankyou sweep (worker) sends the same
// key headlessly.
export const sendThankyouAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    let result: { sent: number; skipped: number } | null = null;
    try {
      const campaign = await getCampaignRef(campaignId);
      if (campaign && campaign.event_id === eventId) {
        await requireOwnedEvent(campaign.event_id);
        result = await sendCampaignWhatsApp(campaignId, 'thankyou');
      }
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('שליחת הודעת התודה נכשלה.');
    }
    if (!result) returnUserError('השירות לא נמצא.');
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    if (result.sent === 0) {
      returnUserError('לא נשלחו הודעות תודה — ודאו שהשירות פעיל ושתבנית התודה מאושרת ופעילה.');
    }
    return {
      notice:
        result.skipped > 0
          ? `נשלחו ${result.sent} הודעות תודה (${result.skipped} דולגו).`
          : `נשלחו ${result.sent} הודעות תודה.`,
    };
  });

// --- Event lifecycle (R6/R7) — Close ----------------------------------------
// Confirming the details (draft → active, the former "publish") lives in
// setupCampaignAction above as the first step of the RSVP flow. The close is
// offered on the event page and inside setup (design D5). Who may close
// (`events.close` through can_access_event), the money rules and the atomic
// retire+close are all inside closeEvent (events.ts) and its database function;
// this is a thin wrapper: the data layer's own safe Hebrew message reaches the customer as it is.
// On success it lands on the event page, which shows the closed event's summary
// — wherever the close was pressed.

export const closeEventAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId] }) => {
    await closeEvent(eventId);
    // Best-effort cancellation marking on the already-synced Exchange
    // appointment(s) — same never-throws contract as syncEventToExchange.
    await markEventExchangeCancelled(eventId);
    revalidatePath('/app/events');
    revalidatePath(`/app/events/${eventId}`);
    redirect(`/app/events/${eventId}`);
  });

// R8 — minimal Cancel-campaign action. NOT an ownership check, despite living on
// a customer page: cancelCampaign (campaigns.ts) requires
// `campaigns.runstate` — staff only, never the event owner — BEFORE the RPC is
// ever called, and campaignId is never trusted from the browser to imply
// authorization. The button matches: manage-client.tsx renders it under
// `canCancel = viewerIsAdmin && …`.
export const cancelCampaignAction = actionClient
  .inputSchema(buttonForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, campaignId] }) => {
    await cancelCampaign(campaignId);
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    return { notice: 'הקמפיין בוטל' };
  });

// Auto-thankyou owner controls: opt-in toggle + editable schedule. Checkbox
// semantics: the input is always rendered, so key presence IS the checked
// state (matches updateEventAction's show_meal_pref convention). Authorization
// (the owner, or platform staff holding manage_billing) is re-verified inside
// updateThankyouSchedule; the "already sent" guard there surfaces as a plain
// error rather than a silent no-op.
const thankyouScheduleForm = zfd.formData(
  z.preprocess(
    (form: Record<string, unknown>) => ({
      auto_enabled: 'auto_enabled' in form,
      send_date: form.send_date ?? '',
      send_time: form.send_time ?? '',
    }),
    thankyouScheduleSchema,
  ),
);

export const updateThankyouScheduleAction = actionClient
  .inputSchema(thankyouScheduleForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput: { auto_enabled, send_date, send_time }, bindArgsParsedInputs: [eventId, campaignId] }) => {
    await updateThankyouSchedule(campaignId, {
      autoEnabled: auto_enabled,
      sendAt: send_date && send_time ? ilWallTimeToIso(send_date, send_time) : null,
    });
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    return { notice: 'לוח הזמנים לתודה עודכן' };
  });

// Staff-only: move a live event's date. Everything that authorizes this lives
// deeper — rescheduleEventForAdmin checks manage_billing and writes the audit
// row, and the database function beneath it re-checks the permission itself.
// This layer parses the form and turns the outcome into a message. The form's
// fields (new_event_date, new_event_time, reschedule_reason) are read into the
// schema's own keys, where the form shows their messages.
const rescheduleEventForm = zfd.formData(
  z.preprocess(
    (form: Record<string, unknown>) => ({
      event_date: form.new_event_date ?? '',
      event_time: form.new_event_time ?? '',
      reason: form.reschedule_reason ?? '',
    }),
    rescheduleEventSchema,
  ),
);

export const rescheduleEventAction = actionClient
  .inputSchema(rescheduleEventForm)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId, campaignId] }) => {
    // The owner's own date fields are stored as an Israel wall-clock instant; a
    // staff edit must produce the identical shape, or the same wall time would
    // land an hour out across a DST boundary.
    const iso = ilWallTimeToIso(parsedInput.event_date, parsedInput.event_time);

    const result = await rescheduleEventForAdmin(eventId, iso, parsedInput.reason);
    const clamped = result.deadlineClamped;

    // Both pages show the date; the campaign board also shows the billing window
    // that the database trigger has just moved with it.
    revalidatePath(`/app/events/${eventId}`);
    revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
    return {
      notice: clamped
        ? 'מועד האירוע עודכן. המועד האחרון לאישור הגעה הוצמד ליום האירוע החדש.'
        : 'מועד האירוע עודכן, וחלון החיוב של הקמפיין עודכן איתו.',
    };
  });
