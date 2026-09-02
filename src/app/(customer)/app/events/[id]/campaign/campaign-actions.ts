'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';

import {
  GA_FLAG_COOKIE_MAX_AGE_SECONDS,
  GA_FLAG_COOKIE_NAME,
  buildFlagCookieValue,
  buildPurchaseParams,
  type GaActionEvent,
} from '@/lib/analytics/ga-event-contracts';

import { requireUser } from '@/lib/auth/dal';
import {
  createCampaign,
  activateCampaign,
  pauseCampaign,
  closeCampaign,
  cancelCampaign,
  getCampaignForHold,
  updateThankyouSchedule,
} from '@/lib/data/campaigns';
import { requireOwnedEvent, publishEvent, closeEvent } from '@/lib/data/events';
import { syncEventToExchange, markEventExchangeCancelled } from '@/lib/data/event-exchange-sync';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { recordSignedAgreement } from '@/lib/data/agreements';
import { getProfile } from '@/lib/data/profiles';
import { requestOtp, verifyOtp } from '@/lib/data/otp';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import { approveCampaignSchema, thankyouScheduleSchema } from '@/lib/validation/campaigns';
import type { FormState } from '@/lib/validation/result';

const OTP_PURPOSE = 'agreement_signing';

// "אישור פרטי האירוע והמשך" — ONE owner decision that (audit §2 / recommended
// flow step 5): confirms the event details (the former "publish" — locks
// event_date/rsvp_deadline per R5, moves draft → active so R9 lets a campaign
// exist), then creates-or-continues the event's single campaign, then lands
// straight on the agreement. eventId is bound on the client; there is NO form
// input — the canonical template and the derived window are resolved
// server-side. On an already-confirmed event this is a plain continue.
// publishEvent/createCampaign throw only our own safe Hebrew messages, so
// surfacing err.message is safe and useful. If createCampaign refuses AFTER a
// successful confirm (its own gates: celebrants/venue/date), the event stays
// confirmed — the owner fixes the detail and clicks again (now a continue).
// The setup page (setup-steps.ts) shows those prerequisites up front so this
// is the rare path, not the normal one.
export async function setupCampaignAction(
  eventId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let created: Awaited<ReturnType<typeof createCampaign>>;
  try {
    const event = await requireOwnedEvent(eventId);
    if (event.status === 'draft') {
      await publishEvent(eventId);
      // Best-effort Exchange calendar sync (Layer 2) — syncEventToExchange never
      // throws (see its own module note), so a mailbox/connection failure here
      // must never surface as a confirm failure to the customer.
      await syncEventToExchange(eventId);
    }
    created = await createCampaign(eventId);
  } catch (err) {
    unstable_rethrow(err);
    return {
      error:
        err instanceof Error ? err.message : 'אישור פרטי האירוע נכשל. נסו שוב.',
    };
  }

  revalidatePath(`/app/events/${eventId}`);
  revalidatePath(`/app/events/${eventId}/campaign`);
  redirect(`/app/events/${eventId}/campaign/${created.id}/approve`);
}

// Step 1 of signing: send an OTP to the signer's phone (identity verification).
// Authenticated owner only; rate-limited inside requestOtp.
export async function requestSigningOtpAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _formData;
  let phone: string | null;
  try {
    await requireUser();
    const profile = await getProfile();
    phone = profile?.phone ?? null;
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'נדרשת התחברות.' };
  }

  if (!phone) {
    return { error: 'לא נמצא מספר טלפון בפרופיל. עדכנו טלפון בהגדרות החשבון.' };
  }
  const res = await requestOtp(phone, OTP_PURPOSE);
  if (!res.ok) {
    return { error: res.error ?? 'שליחת קוד האימות נכשלה.' };
  }
  return { notice: 'קוד אימות נשלח בהודעת SMS לטלפון שבפרופיל.' };
}

// FormState superset carrying the one extra bit the signing form needs: whether
// the code just checked out, so it can unlock the signature step. Structural
// superset (mirrors SettleFormState below) — generic FormState consumers
// (FormError/FieldError) keep working unchanged.
export type VerifyOtpFormState =
  | {
      error?: string;
      notice?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      verified?: boolean;
      // The exact code this result belongs to, so the client can derive
      // "still verified" purely from state (verified && code === current
      // field value) instead of tracking a mirrored copy separately.
      code?: string;
    }
  | null;

// Step 1.5: confirm the OTP code BEFORE the signature step unlocks, without
// spending it — a non-consuming check (verifyOtp's `consume:false`) against the
// SAME challenge signAgreementAction will authoritatively re-verify (and
// actually consume) at final submit. This is a UX gate only: the client-side
// "unlocked" state is never trusted on its own — a stale or expired code here
// still fails cleanly at the real, consuming check later.
export async function verifySigningOtpAction(
  _prevState: VerifyOtpFormState,
  formData: FormData,
): Promise<VerifyOtpFormState> {
  let phone: string | null;
  try {
    await requireUser();
    const profile = await getProfile();
    phone = profile?.phone ?? null;
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'נדרשת התחברות.' };
  }
  if (!phone) {
    return { error: 'לא נמצא מספר טלפון בפרופיל. עדכנו טלפון בהגדרות החשבון.' };
  }

  const code = String(formData.get('otp_code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { fieldErrors: { otp_code: ['יש להזין קוד בן 6 ספרות'] } };
  }

  const ok = await verifyOtp(phone, OTP_PURPOSE, code, { consume: false });
  if (!ok) {
    return { fieldErrors: { otp_code: ['קוד האימות שגוי או שפג תוקפו. שלחו קוד חדש.'] } };
  }
  return { verified: true, code, notice: 'הקוד אומת — ניתן לחתום.' };
}

// Step 2: verify OTP + sign the agreement + record consents, then approve the
// campaign. eventId and campaignId are bound on the client. Sensitive — the
// signature and code are never logged here.
export async function signAgreementAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  // tos_version is set server-side to the ACTIVE agreement document's version
  // (DB-managed) — never trusted from the client.
  const { version: agreementVersion } = await getActiveAgreementDoc();

  // Consents (the explicit affirmations). The billing authorization is NOT one
  // of them any more — it lives in §4 of the signed agreement itself.
  const consents = approveCampaignSchema.safeParse({
    campaign_id: campaignId,
    tos_version: agreementVersion,
    terms_accepted: formData.get('terms_accepted') === 'on',
    privacy_accepted: formData.get('privacy_accepted') === 'on',
  });
  if (!consents.success) {
    return { fieldErrors: consents.error.flatten().fieldErrors };
  }

  const signature = String(formData.get('signature') ?? '');
  if (!signature.startsWith('data:image/')) {
    return { fieldErrors: { signature: ['יש לחתום בתיבת החתימה'] } };
  }

  const otpCode = String(formData.get('otp_code') ?? '').trim();
  if (!/^\d{6}$/.test(otpCode)) {
    return { fieldErrors: { otp_code: ['יש להזין את קוד האימות (6 ספרות)'] } };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = h.get('user-agent');

  // signerName + phone are derived server-side from the profile in
  // recordSignedAgreement — never from the client.
  let result: Awaited<ReturnType<typeof recordSignedAgreement>>;
  try {
    result = await recordSignedAgreement({
      campaignId,
      otpCode,
      signatureDataUrl: signature,
      tosVersion: agreementVersion,
      ip,
      userAgent,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שמירת ההסכם נכשלה. נסו שוב.' };
  }
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath(`/app/events/${eventId}/campaign`);
  // Analytics flag (phase-1 events plan): one-shot cookie consumed exactly
  // once by GaFlagListener on the destination — queues `agreement_signed`.
  // Name-only (minimization ruling 27.7 afternoon): UUID context params are
  // HELD — no consumer exists (not custom dimensions, no BigQuery), so they
  // fail the necessity test. The validated id-carrying mechanism stays in
  // ga-event-contracts, dormant, pending the legal decision.
  (await cookies()).set(GA_FLAG_COOKIE_NAME, buildFlagCookieValue('agreement_signed'), {
    maxAge: GA_FLAG_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
  });
  // Route A: after signing, proceed to the card-capture (payment-method) step.
  redirect(`/app/events/${eventId}/campaign/${campaignId}/payment`);
}

// --- Campaign lifecycle (§9) — wires the previously-orphaned transitions. ------
// Each binds (eventId, campaignId) on the client; ownership is enforced inside
// the data-layer transition (requireOwnedEvent). All revalidate the manage page.

export async function activateCampaignAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await activateCampaign(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    // Surface our own safe Hebrew message (e.g. "האירוע כבר חלף") instead of a
    // fixed string, so the real reason reaches the user (mirrors setupCampaignAction).
    return {
      error:
        err instanceof Error
          ? err.message
          : 'הפעלת הקמפיין נכשלה — נדרשת תפיסת מסגרת מאושרת.',
    };
  }
  // The button lives on three screens (event setup page, payment page, manage
  // page) — refresh whichever one the owner clicked from.
  revalidatePath(`/app/events/${eventId}`);
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}/payment`);
  return { notice: 'הקמפיין הופעל — הפניות יחלו לפי לוח הזמנים.' };
}

export async function pauseCampaignAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await pauseCampaign(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'השהיית הקמפיין נכשלה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  return { notice: 'הקמפיין הושהה — לא יישלחו פניות חדשות.' };
}

export async function closeCampaignAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await closeCampaign(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'סגירת הקמפיין נכשלה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  return { notice: 'הקמפיין נסגר — אפשר לבצע גמר חשבון.' };
}

// Final settlement: close (if open) + charge the held card for the accrued total
// (gated by getCloseChargeEnabled inside the orchestrator). Ownership enforced
// via the close transition.
// Manual gift-reminder send (message_key 'gift', kalfa_event_gift_v1).
// Ownership contract mirrors cancelCampaign (R8): resolve the campaign's
// event server-side, verify the CURRENT user owns it, only then send.
// sendCampaignWhatsApp re-checks every §8.3 gate (outreach enabled, campaign
// active, allowed channel, active template, consent) and fail-closes into the
// params_incomplete sink when the gift link is not configured.
export async function sendGiftReminderAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let result: { sent: number; skipped: number };
  try {
    const campaign = await getCampaignForHold(campaignId);
    if (!campaign || campaign.event_id !== eventId) {
      return { error: 'הקמפיין לא נמצא.' };
    }
    await requireOwnedEvent(campaign.event_id);
    result = await sendCampaignWhatsApp(campaignId, 'gift');
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת תזכורת המתנה נכשלה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  if (result.sent === 0) {
    return {
      error:
        'לא נשלחו תזכורות — ודאו שקישור המתנה מולא באירוע, שהקמפיין פעיל ושתבנית המתנה מאושרת ופעילה.',
    };
  }
  return {
    notice:
      result.skipped > 0
        ? `נשלחו ${result.sent} תזכורות מתנה (${result.skipped} דולגו).`
        : `נשלחו ${result.sent} תזכורות מתנה.`,
  };
}

// Event-day reminder to CONFIRMED guests (guests.status='attending') + a Bit
// payment button. Manual, non-billable — same gate model as the gift send
// (sendCampaignWhatsApp re-checks outreach enabled + active campaign + approved
// template; the confirmed-only filter and the Bit token live in that batch).
export async function sendEventDayReminderAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let result: { sent: number; skipped: number };
  try {
    const campaign = await getCampaignForHold(campaignId);
    if (!campaign || campaign.event_id !== eventId) {
      return { error: 'הקמפיין לא נמצא.' };
    }
    await requireOwnedEvent(campaign.event_id);
    result = await sendCampaignWhatsApp(campaignId, 'event_day_pay');
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת תזכורת יום האירוע נכשלה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  if (result.sent === 0) {
    return {
      error:
        'לא נשלחו תזכורות — ודאו שקישור הביט מולא באירוע, שיש מאשרי הגעה, שהקמפיין פעיל ושתבנית יום האירוע מאושרת ופעילה.',
    };
  }
  return {
    notice:
      result.skipped > 0
        ? `נשלחו ${result.sent} תזכורות יום האירוע (${result.skipped} דולגו).`
        : `נשלחו ${result.sent} תזכורות יום האירוע.`,
  };
}

// Post-event thank-you (message_key 'thankyou'). Manual, non-billable — same
// gate model as gift/event-day (sendCampaignWhatsApp re-checks outreach enabled +
// active campaign + approved template). This is the ONE message_key allowed past
// the L1 past-event gate (POST_EVENT_MESSAGE_KEYS in template-spec.ts) — it can
// only run AFTER the event day, driven by the authenticated app (never headless).
export async function sendThankyouAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let result: { sent: number; skipped: number };
  try {
    const campaign = await getCampaignForHold(campaignId);
    if (!campaign || campaign.event_id !== eventId) {
      return { error: 'הקמפיין לא נמצא.' };
    }
    await requireOwnedEvent(campaign.event_id);
    result = await sendCampaignWhatsApp(campaignId, 'thankyou');
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'שליחת הודעת התודה נכשלה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  if (result.sent === 0) {
    return {
      error: 'לא נשלחו הודעות תודה — ודאו שהקמפיין פעיל ושתבנית התודה מאושרת ופעילה.',
    };
  }
  return {
    notice:
      result.skipped > 0
        ? `נשלחו ${result.sent} הודעות תודה (${result.skipped} דולגו).`
        : `נשלחו ${result.sent} הודעות תודה.`,
  };
}

// FormState + an optional analytics payload the client fires exactly once per
// returned state (useGaFromState in manage-client). Structural superset of
// FormState, so generic consumers keep working unchanged.
export type SettleFormState =
  | {
      error?: string;
      notice?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      ga?: GaActionEvent;
    }
  | null;

export async function settleCampaignAction(
  eventId: string,
  campaignId: string,
  _prevState: SettleFormState,
  _formData: FormData,
): Promise<SettleFormState> {
  // Authorization is enforced inside closeCampaignAndCharge (platform-admin
  // only, requireAdmin as its first statement) — settle no longer pre-checks
  // ownership here. It delegates straight to the self-gating data-layer call.
  let r: Awaited<ReturnType<typeof closeCampaignAndCharge>>;
  try {
    r = await closeCampaignAndCharge(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'גמר החשבון נכשל. נסו שוב או פנו לתמיכה.' };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  switch (r.outcome) {
    case 'charged':
      return {
        notice: `גמר חשבון הושלם — חויב ₪${r.amount}.`,
        // The revenue event (phase-1 plan): fired client-side once per state.
        // Plan label only — UUID context HELD per the minimization ruling
        // (transaction_id already uniquely keys the charge; the ids have no
        // consumer until they are dimensions or BigQuery exists).
        ga: {
          name: 'purchase',
          params: buildPurchaseParams(r.amount, r.paymentId, {
            billingModel: r.billingModel,
          }),
        },
      };
    case 'nothing_to_charge': {
      // amount===0 does not mean nobody was reached — credits may have fully
      // covered a nonzero reached total (close-charge.ts CloseChargeOutcome).
      const reached = r.reachedCount ?? 0;
      const credit = r.creditApplied ?? 0;
      if (reached === 0) {
        return { notice: 'גמר חשבון הושלם — אין אנשי קשר שהושגו, אין חיוב.' };
      }
      if (credit > 0) {
        return {
          notice: `גמר חשבון הושלם — ${reached} אנשי קשר הושגו, כוסו במלואם על ידי קרדיט קיים (₪${credit}). לא בוצע חיוב לכרטיס.`,
        };
      }
      return {
        notice: `גמר חשבון הושלם — ${reached} אנשי קשר הושגו, אין חיוב.`,
      };
    }
    case 'disabled':
      return { error: 'החיוב הסופי אינו מופעל עדיין במערכת.' };
    case 'declined':
      return { error: 'החיוב נדחה על ידי חברת האשראי. עדכנו אמצעי תשלום.' };
    case 'review':
      return { error: 'החיוב בבדיקה — נציג ייצור קשר. אין צורך לנסות שוב.' };
    default:
      return { error: 'לא ניתן לבצע גמר חשבון במצב הנוכחי.' };
  }
}

// --- Event lifecycle (R6/R7) — Close, S2.5a ---------------------------------
// Confirming the details (draft → active, the former "publish") lives in
// setupCampaignAction above as the first step of the RSVP flow. Ownership +
// every R1–R9 rule is enforced inside closeEvent (events.ts) and the DB
// triggers; this is a thin wrapper surfacing the data layer's own safe Hebrew
// error message.

export async function closeEventAction(
  eventId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await closeEvent(eventId);
  } catch (err) {
    unstable_rethrow(err);
    return {
      error: err instanceof Error ? err.message : 'סגירת האירוע נכשלה. נסו שוב.',
    };
  }
  // Best-effort cancellation marking on the already-synced Exchange
  // appointment(s) — same never-throws contract as syncEventToExchange.
  await markEventExchangeCancelled(eventId);
  revalidatePath(`/app/events/${eventId}`);
  return { notice: 'האירוע נסגר' };
}

// R8 — minimal Cancel-campaign action. Ownership is enforced inside
// cancelCampaign (campaigns.ts) via getCampaignForHold → requireOwnedEvent,
// BEFORE the RPC is ever called — campaignId is never trusted from the browser
// to imply authorization.
export async function cancelCampaignAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await cancelCampaign(campaignId);
  } catch (err) {
    unstable_rethrow(err);
    return {
      error: err instanceof Error ? err.message : 'ביטול הקמפיין נכשל. נסו שוב.',
    };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  return { notice: 'הקמפיין בוטל' };
}

// Auto-thankyou owner controls: opt-in toggle + editable schedule. Checkbox
// semantics: the input is always rendered, so key presence IS the checked
// state (matches updateEventAction's show_meal_pref convention). Ownership is
// re-verified inside updateThankyouSchedule; the "already sent" guard there
// surfaces as a plain error rather than a silent no-op.
export async function updateThankyouScheduleAction(
  eventId: string,
  campaignId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = thankyouScheduleSchema.safeParse({
    auto_enabled: formData.has('auto_enabled'),
    send_date: formData.get('send_date') ?? '',
    send_time: formData.get('send_time') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { auto_enabled, send_date, send_time } = parsed.data;

  try {
    await updateThankyouSchedule(campaignId, {
      autoEnabled: auto_enabled,
      sendAt: send_date && send_time ? ilWallTimeToIso(send_date, send_time) : null,
    });
  } catch (err) {
    unstable_rethrow(err);
    return {
      error: err instanceof Error ? err.message : 'עדכון לוח הזמנים נכשל. נסו שוב.',
    };
  }
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  return { notice: 'לוח הזמנים לתודה עודכן' };
}
