import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { creditHeldCardSumit } from '@/lib/sumit/capture';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import { getAppOrigin } from '@/lib/url';
import { logActivity } from '@/lib/data/activity';
import type {
  createCancellationRequestSchema,
  resolveCancellationRequestSchema,
} from '@/lib/validation/event-cancellation';
import type { z } from 'zod';

type CreateInput = z.infer<typeof createCancellationRequestSchema>;
type ResolveInput = z.infer<typeof resolveCancellationRequestSchema>;

// Owner-initiated: request to cancel an active/closed event. Uses the
// owner-scoped cookie client (RLS-enforced ecr_owner_insert), NOT the admin
// client — mirrors how callback_requests customer-facing inserts work.
export async function createCancellationRequest(
  eventId: string,
  input: CreateInput,
): Promise<{ id: string; requestNumber: number }> {
  const event = await requireOwnedEvent(eventId);
  if (event.status === 'draft') {
    throw new Error('אירוע בטיוטה ניתן למחיקה ישירה — אין צורך בבקשת ביטול');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('נדרשת התחברות');

  const { data, error } = await supabase
    .from('event_cancellation_requests')
    .insert({
      event_id: eventId,
      owner_id: user.id,
      reason: input.reason,
      sms_consent: input.smsConsent,
    })
    .select('id, request_number')
    .single();

  if (error || !data) throw new Error('פתיחת בקשת הביטול נכשלה');

  await logActivity({
    eventId,
    action: 'event_cancellation.requested',
    meta: { requestId: data.id, requestNumber: data.request_number },
  });

  return { id: data.id, requestNumber: data.request_number };
}

// Owner-scoped read for the customer's own event page: the latest
// cancellation request for this event, if any (RLS-enforced ecr_owner_select
// — the cookie client only ever sees the caller's own rows regardless of the
// eventId filter here, so this can never leak another owner's request).
export type OwnCancellationRequest = {
  id: string;
  requestNumber: number;
  status: 'pending' | 'resolved';
  resolution: 'full_cancellation' | 'partial_charge' | 'declined' | null;
  resolutionNote: string | null;
};

export async function getCancellationRequestForEvent(
  eventId: string,
): Promise<OwnCancellationRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('event_cancellation_requests')
    .select('id, request_number, status, resolution, resolution_note')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    requestNumber: data.request_number,
    status: data.status as 'pending' | 'resolved',
    resolution: data.resolution as OwnCancellationRequest['resolution'],
    resolutionNote: data.resolution_note,
  };
}

export type CancellationRequestForAdmin = {
  id: string;
  requestNumber: number;
  eventId: string;
  eventName: string;
  eventStatus: string;
  reason: string;
  smsConsent: boolean;
  status: 'pending' | 'resolved';
  resolution: 'full_cancellation' | 'partial_charge' | 'declined' | null;
  resolutionAmount: number | null;
  captureOutcome: 'captured' | 'refunded' | 'manual_refund_required' | 'not_applicable' | null;
  sumitDocumentUrl: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

const ADMIN_SELECT =
  'id, request_number, event_id, reason, sms_consent, status, resolution, resolution_amount, ' +
  'capture_outcome, sumit_document_url, resolution_note, created_at, events(name, status)';

function mapAdminRow(r: {
  id: string;
  request_number: number;
  event_id: string;
  reason: string;
  sms_consent: boolean;
  status: string;
  resolution: string | null;
  resolution_amount: number | null;
  capture_outcome: string | null;
  sumit_document_url: string | null;
  resolution_note: string | null;
  created_at: string;
  events: { name: string; status: string } | null;
}): CancellationRequestForAdmin {
  return {
    id: r.id,
    requestNumber: r.request_number,
    eventId: r.event_id,
    eventName: r.events?.name ?? '',
    eventStatus: r.events?.status ?? '',
    reason: r.reason,
    smsConsent: r.sms_consent,
    status: r.status as 'pending' | 'resolved',
    resolution: r.resolution as CancellationRequestForAdmin['resolution'],
    resolutionAmount: r.resolution_amount,
    captureOutcome: r.capture_outcome as CancellationRequestForAdmin['captureOutcome'],
    sumitDocumentUrl: r.sumit_document_url,
    resolutionNote: r.resolution_note,
    createdAt: r.created_at,
  };
}

export async function listCancellationRequestsForAdmin(): Promise<CancellationRequestForAdmin[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('event_cancellation_requests')
    .select(ADMIN_SELECT)
    .order('status', { ascending: true }) // pending first (alphabetically before resolved)
    .order('created_at', { ascending: true });

  if (error) throw new Error('טעינת בקשות הביטול נכשלה');

  return (data ?? []).map((r) =>
    mapAdminRow(r as unknown as Parameters<typeof mapAdminRow>[0]),
  );
}

export async function getCancellationRequestForAdmin(
  id: string,
): Promise<CancellationRequestForAdmin | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('event_cancellation_requests')
    .select(ADMIN_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return mapAdminRow(data as unknown as Parameters<typeof mapAdminRow>[0]);
}

// Admin-scoped campaign lookup for the cancellation-request detail page —
// tells the admin UI whether resolving will CAPTURE (pre-charge) or CREDIT
// (post-charge) money, and feeds computeSuggestedCancellationAmount /
// getCampaignBillingSummary. No owner-scoping (admin cross-customer reach,
// same as every other function in this file gated by manage_billing).
export type CampaignForCancellationAdmin = {
  id: string;
  chargeStatus: string | null;
  maxChargeCeiling: number | null;
  // Whether resolveCancellationRequest can actually attempt a SUMIT
  // capture/credit for this campaign (same 4-field check it uses internally)
  // — lets the admin UI state the outcome definitively instead of hedging
  // with "if card details are on file".
  hasCardOnFile: boolean;
};

export async function getCampaignForEventAdmin(
  eventId: string,
): Promise<CampaignForCancellationAdmin | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, charge_status, max_charge_ceiling, card_token_ref, card_exp_month, card_exp_year, card_citizen_id')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    chargeStatus: data.charge_status,
    maxChargeCeiling: data.max_charge_ceiling,
    hasCardOnFile: !!(data.card_token_ref && data.card_exp_month && data.card_exp_year && data.card_citizen_id),
  };
}

// Admin-mediated close, twin of events.ts closeEvent but requirePlatformPermission
// instead of ownership — mirrors campaigns.ts cancelCampaign's admin-only
// wind-down pattern. Same R7 DB trigger applies (operational-campaign guard).
export async function adminCloseEvent(eventId: string): Promise<void> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { error } = await admin.from('events').update({ status: 'closed' }).eq('id', eventId);
  if (error) {
    throw new Error('סגירת האירוע נכשלה — ייתכן שיש קמפיין פעיל שיש לסגור קודם');
  }
  await logActivity({ eventId, action: 'event.closed_by_admin', meta: {} });
}

// Suggested amount ONLY — the admin UI shows this pre-filled but editable;
// the actual charged amount is whatever the admin confirms in
// resolveCancellationRequest's input, never this value directly. Deliberately
// EXCLUDES service-already-rendered (campaign_billing_summary.accrued) — the
// right to charge for it (14ה(ב1)) applies only to a "continuous transaction",
// not yet confirmed for KALFA campaigns (see the plan's legal-research note).
export async function computeSuggestedCancellationAmount(campaignId: string): Promise<number> {
  const admin = createAdminClient();
  const [settingsRes, campaignRes] = await Promise.all([
    admin
      .from('app_settings')
      .select('cancellation_fee_percent, cancellation_fee_cap')
      .eq('id', true)
      .maybeSingle(),
    admin.from('campaigns').select('max_charge_ceiling').eq('id', campaignId).single(),
  ]);
  const feePercent = settingsRes.data?.cancellation_fee_percent ?? 0;
  const feeCap = settingsRes.data?.cancellation_fee_cap ?? 0;
  const ceiling = campaignRes.data?.max_charge_ceiling ?? 0;
  const fee = Math.min((ceiling * feePercent) / 100, feeCap);
  return Math.min(fee, ceiling);
}

// Money is decided and MOVED here (when there's still something to move),
// then notified, then persisted. Three sub-cases per campaign.charge_status:
//   - pre-charge (null/charge_failed/charge_review/nothing_to_charge): calls
//     closeCampaignAndCharge with an override amount — a REAL SUMIT capture
//     for partial_charge, or the existing nothing_to_charge branch (no SUMIT
//     call at all) for full_cancellation/declined.
//   - post-charge ('charged'): calls creditHeldCardSumit — a REAL SUMIT
//     credit for the amount being refunded. Falls back to
//     capture_outcome='manual_refund_required' ONLY if the campaign is
//     missing the card fields needed to even attempt it (very old data) —
//     a declined/network error from the credit call itself PROPAGATES
//     instead, it does not silently downgrade to "manual" — staff sees the
//     real failure and decides what to do.
// EMAIL IS CHECKED FIRST, before any SUMIT call — same send-then-persist
// contract as sendInquiryReply (contacts.ts), extended so a broken mail
// server can't leave a charge/credit executed with no notification sent. SMS
// is best-effort AFTER a successful email/capture/credit — see
// sendNoContactSms (callback-scheduling.ts) for the "never block the core
// outcome" contract.
export async function resolveCancellationRequest(
  requestId: string,
  input: ResolveInput,
): Promise<void> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  // Supabase's typed client cannot infer a return shape for a 3-level-deep
  // embed (event_cancellation_requests → events → campaigns) — cast the
  // fetched row explicitly, same pattern already used for `reqRow.events`
  // elsewhere in this file/codebase for the same reason.
  type ResolveFetchRow = {
    id: string;
    request_number: number;
    event_id: string;
    sms_consent: boolean;
    status: string;
    events: {
      id: string;
      status: string;
      owner_id: string;
      campaigns: {
        id: string;
        charge_status: string | null;
        final_charge_amount: number | null;
        card_token_ref: string | null;
        card_exp_month: number | null;
        card_exp_year: number | null;
        card_citizen_id: string | null;
        auth_external_ref: string | null;
      }[];
    } | null;
  };

  const { data, error: fetchError } = await admin
    .from('event_cancellation_requests')
    .select(
      'id, request_number, event_id, sms_consent, status, ' +
        'events(id, status, owner_id, campaigns(id, charge_status, final_charge_amount, ' +
        'card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref))',
    )
    .eq('id', requestId)
    .single();

  if (fetchError || !data) throw new Error('בקשת הביטול לא נמצאה');
  const reqRow = data as unknown as ResolveFetchRow;
  if (reqRow.status !== 'pending') throw new Error('בקשה זו כבר טופלה');

  const event = reqRow.events;
  if (!event) throw new Error('האירוע המקושר לבקשה לא נמצא');
  // One-campaign-per-event (campaign-rework-constraint) — at most one row.
  const campaign = event.campaigns[0] ?? null;
  const hasCardOnFile = !!(
    campaign?.card_token_ref &&
    campaign.card_exp_month &&
    campaign.card_exp_year &&
    campaign.card_citizen_id
  );

  const { data: owner } = await admin.auth.admin.getUserById(event.owner_id);
  const { data: prof } = await admin
    .from('profiles')
    .select('full_name, phone')
    .eq('id', event.owner_id)
    .maybeSingle();
  const ownerEmail = owner?.user?.email ?? '';
  const ownerName = (prof?.full_name ?? '').trim() || ownerEmail;
  const ownerPhone = prof?.phone ?? null;
  if (!ownerEmail) throw new Error('לא נמצאה כתובת אימייל לבעל האירוע — לא ניתן לשלוח עדכון');

  // Decide WHICH BRANCH before sending anything (not the final amount yet for
  // the credit branch — that depends on what was actually charged, read from
  // `campaign.final_charge_amount`, already available here).
  let captureOutcome: 'captured' | 'refunded' | 'manual_refund_required' | 'not_applicable';
  let finalAmount = 0;
  let sumitDocumentId: number | null = null;
  let sumitDocumentUrl: string | null = null;

  const isPreCharge = campaign && campaign.charge_status !== 'charged';
  const isPostCharge = campaign?.charge_status === 'charged';

  if (input.resolution === 'declined') {
    captureOutcome = 'not_applicable';
  } else if (isPostCharge) {
    if (!hasCardOnFile) {
      captureOutcome = 'manual_refund_required';
      const charged = campaign?.final_charge_amount ?? 0;
      finalAmount =
        input.resolution === 'full_cancellation'
          ? charged
          : Math.max(0, charged - (input.resolutionAmount ?? 0));
    } else {
      captureOutcome = 'refunded'; // executed below, after the email send succeeds
    }
  } else if (isPreCharge) {
    captureOutcome = 'captured'; // executed below, after the email send succeeds
  } else {
    captureOutcome = 'not_applicable'; // no campaign was ever authorized — nothing to move
  }

  const { subject, html, text } = cancellationRequestResponseEmail({
    recipientName: ownerName,
    requestNumber: reqRow.request_number,
    resolution: input.resolution,
    resolutionAmount: captureOutcome === 'manual_refund_required' ? finalAmount : input.resolutionAmount,
    resolutionNote: input.resolutionNote,
    origin: await getAppOrigin(),
  });

  try {
    const sender = await getEmailSender();
    await sender.send({ to: ownerEmail, subject, html, text });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'EmailConfigError') {
      throw new Error('שירות הדואר אינו מוגדר — הגדירו SMTP במסך ההגדרות ונסו שוב.');
    }
    if (name === 'EmailSendError') {
      throw new Error('שליחת הדואר נכשלה — הבקשה לא עודכנה, שום חיוב/זיכוי לא בוצע; אפשר לנסות שוב.');
    }
    throw err;
  }

  // NOW execute the actual money movement. Any SumitDeclinedError/
  // SumitNetworkError propagates — the customer already got an email
  // promising an outcome the charge/credit then failed to deliver;
  // surfacing the error to the admin (rather than silently persisting a
  // mismatched resolution) is the least-bad option, matching close-charge.ts's
  // own "never silently settle a wrong amount" discipline.
  if (captureOutcome === 'captured') {
    const overrideAmount = input.resolution === 'full_cancellation' ? 0 : (input.resolutionAmount ?? 0);
    const result = await closeCampaignAndCharge(campaign!.id, {
      overrideAmount,
      overrideReason:
        input.resolution === 'full_cancellation' ? 'cancellation_full' : 'cancellation_partial_charge',
    });
    finalAmount = result.amount;
    if (result.outcome === 'charged') {
      sumitDocumentId = result.documentId ?? null;
      sumitDocumentUrl = result.documentUrl ?? null;
    }
  } else if (captureOutcome === 'refunded') {
    const charged = campaign!.final_charge_amount ?? 0;
    const creditAmount =
      input.resolution === 'full_cancellation'
        ? charged
        : Math.max(0, charged - (input.resolutionAmount ?? 0));
    finalAmount = creditAmount;
    if (creditAmount > 0) {
      const sumit = await getSumitServerConfig();
      if (!sumit) throw new Error('הגדרות SUMIT חסרות — לא ניתן לבצע זיכוי');
      const result = await creditHeldCardSumit({
        companyId: sumit.companyId,
        apiKey: sumit.apiKey,
        cardToken: campaign!.card_token_ref!,
        expMonth: campaign!.card_exp_month!,
        expYear: campaign!.card_exp_year!,
        citizenId: campaign!.card_citizen_id!,
        externalRef: campaign!.auth_external_ref ?? '',
        amount: creditAmount.toString(),
        customerEmail: ownerEmail,
        customerName: ownerName,
      });
      sumitDocumentId = result.documentId;
      sumitDocumentUrl = result.documentUrl;
    }
  }

  // Best-effort, never blocks: a failed/skipped SMS must not undo the email
  // (or capture) that already happened, and must not leave the request open.
  if (reqRow.sms_consent && ownerPhone) {
    try {
      const smsSender = await getSmsSender();
      const smsText = buildCancellationSmsText({
        fullName: ownerName,
        requestNumber: reqRow.request_number,
        resolution: input.resolution,
        resolutionAmount: finalAmount || undefined,
      });
      await smsSender.send({ to: ownerPhone, text: smsText });
    } catch {
      // Recorded via activity log only (no PII) — never rethrown.
    }
  }

  if (input.resolution !== 'declined' && event.status !== 'closed') {
    await adminCloseEvent(event.id);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from('event_cancellation_requests')
    .update({
      status: 'resolved',
      resolution: input.resolution,
      resolution_amount: finalAmount || null,
      capture_outcome: captureOutcome,
      sumit_document_id: sumitDocumentId,
      sumit_document_url: sumitDocumentUrl,
      resolution_note: input.resolutionNote,
      resolved_at: now,
    })
    .eq('id', requestId);

  if (updateError) {
    throw new Error(
      'העדכון נשלח ללקוח (והחיוב, אם היה, בוצע), אך שמירת הרשומה נכשלה — נא לרענן ולתעד ידנית לפני פעולה נוספת',
    );
  }

  await logActivity({
    eventId: event.id,
    action: 'event_cancellation.resolved',
    meta: { requestId, resolution: input.resolution, captureOutcome },
  });
}
