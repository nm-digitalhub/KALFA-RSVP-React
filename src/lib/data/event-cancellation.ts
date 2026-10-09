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
import { cancellationFeeBase, feeFromPercent } from '@/lib/data/cancellation-fee';
import {
  CancellationResolveError,
  packageRefundMessage,
  packageRefundRetry,
  planPackageRefund,
} from '@/lib/data/package-cancellation';
import { closeCampaign } from '@/lib/data/campaigns';
import { CLOSEABLE_CAMPAIGN_STATUSES, liveCampaignOf } from '@/lib/data/campaign-status';
import {
  checkPackageRefund,
  packagePaymentRecord,
  packageRefundSummary,
  refundPackagePayment,
  type PackagePaymentRecord,
} from '@/lib/payments/package-refund';
import type { ProviderDocument } from '@/lib/payments/ledger';
import { getAppOrigin } from '@/lib/url';
import { logActivity } from '@/lib/data/activity';
import type {
  createCancellationRequestSchema,
  resolveCancellationRequestSchema,
} from '@/lib/validation/event-cancellation';
import type { z } from 'zod';

type CreateInput = z.infer<typeof createCancellationRequestSchema>;
type ResolveInput = z.infer<typeof resolveCancellationRequestSchema>;

// One open request per event: the error a second one gets, from the check below or from the database's own
// unique index (event_cancellation_requests_one_pending) when two arrive at the same moment.
export const CANCELLATION_REQUEST_ALREADY_OPEN = 'כבר קיימת בקשת ביטול פתוחה לאירוע זה';

// The unique constraint on request_code (migration 20261009194139), and how many random draws an insert gets.
const REQUEST_CODE_CONSTRAINT = 'event_cancellation_requests_request_code_key';
const MAX_CODE_ATTEMPTS = 3;
const isCodeCollision = (error: { code?: string; message?: string } | null): boolean =>
  error?.code === '23505' && (error.message ?? '').includes(REQUEST_CODE_CONSTRAINT);

// Owner-initiated: request to cancel an active/closed event. Uses the
// owner-scoped cookie client (RLS-enforced ecr_owner_insert), NOT the admin
// client — mirrors how callback_requests customer-facing inserts work.
// Refuses while the event already has a pending request (a double click, a second tab).
export async function createCancellationRequest(
  eventId: string,
  input: CreateInput,
): Promise<{ id: string; requestCode: string }> {
  const event = await requireOwnedEvent(eventId);
  if (event.status === 'draft') {
    throw new Error('אירוע בטיוטה ניתן למחיקה ישירה — אין צורך בבקשת ביטול');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('נדרשת התחברות');

  // The friendly answer for the common case. It is not the guard: two requests sent at the same moment both pass it,
  // and the unique index below is what refuses the second.
  const { data: open, error: openError } = await supabase
    .from('event_cancellation_requests')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (openError) throw new Error('פתיחת בקשת הביטול נכשלה');
  if (open) throw new Error(CANCELLATION_REQUEST_ALREADY_OPEN);

  // The database draws request_code at random; two equal codes (about one in a trillion) are refused by its unique
  // constraint, so a collision is simply drawn again. Every other 23505 here is the one-open-request index.
  const insertOnce = () =>
    supabase
      .from('event_cancellation_requests')
      .insert({
        event_id: eventId,
        owner_id: user.id,
        reason: input.reason,
        sms_consent: input.smsConsent,
      })
      .select('id, request_code')
      .single();
  let result = await insertOnce();
  for (let attempt = 1; attempt < MAX_CODE_ATTEMPTS && isCodeCollision(result.error); attempt++) {
    result = await insertOnce();
  }
  const { data, error } = result;
  if (error?.code === '23505' && !isCodeCollision(error)) throw new Error(CANCELLATION_REQUEST_ALREADY_OPEN);
  if (error || !data) throw new Error('פתיחת בקשת הביטול נכשלה');

  await logActivity({
    eventId,
    action: 'event_cancellation.requested',
    meta: { requestId: data.id, requestCode: data.request_code },
  });

  return { id: data.id, requestCode: data.request_code };
}

// Owner-scoped read for the customer's own event page: the latest
// cancellation request for this event, if any (RLS-enforced ecr_owner_select
// — the cookie client only ever sees the caller's own rows regardless of the
// eventId filter here, so this can never leak another owner's request).
export type OwnCancellationRequest = {
  id: string;
  requestCode: string;
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
    .select('id, request_code, status, resolution, resolution_note')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    requestCode: data.request_code,
    status: data.status as 'pending' | 'resolved',
    resolution: data.resolution as OwnCancellationRequest['resolution'],
    resolutionNote: data.resolution_note,
  };
}

export type CancellationRequestForAdmin = {
  id: string;
  requestCode: string;
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
  'id, request_code, event_id, reason, sms_consent, status, resolution, resolution_amount, ' +
  'capture_outcome, sumit_document_url, resolution_note, created_at, events(name, status)';

function mapAdminRow(r: {
  id: string;
  request_code: string;
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
    requestCode: r.request_code,
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

// The admin list, optionally only one status — filtered in the database, never in the page.
export async function listCancellationRequestsForAdmin(
  status?: CancellationRequestForAdmin['status'],
): Promise<CancellationRequestForAdmin[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  let query = admin
    .from('event_cancellation_requests')
    .select(ADMIN_SELECT)
    .order('status', { ascending: true }) // pending first (alphabetically before resolved)
    .order('created_at', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;

  if (error) throw new Error('טעינת בקשות הביטול נכשלה');

  return (data ?? []).map((r) =>
    mapAdminRow(r as unknown as Parameters<typeof mapAdminRow>[0]),
  );
}

// How many requests wait and how many were handled, counted by the database (the list header and its filter).
export async function countCancellationRequestsForAdmin(): Promise<Record<CancellationRequestForAdmin['status'], number>> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const count = async (status: CancellationRequestForAdmin['status']) => {
    const { count: n, error } = await admin
      .from('event_cancellation_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    if (error) throw new Error('ספירת בקשות הביטול נכשלה');
    return n ?? 0;
  };
  const [pending, resolved] = await Promise.all([count('pending'), count('resolved')]);
  return { pending, resolved };
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

  // A failed read is an error (the admin area's error boundary offers a retry), never a "no such request" 404.
  if (error) throw new Error('טעינת בקשת הביטול נכשלה');
  if (!data) return null;
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
  // What the campaign was charged, net of credits already given back — the base of a percentage fee once charged.
  finalChargeAmount: number;
  // A fixed-price package keeps no charge status, ceiling or card on the campaign: its money is in the payment ledger.
  // `packagePaid` is what the card paid before THIS request refunded anything (the base of a percentage fee),
  // `packageRefundable` what can still go back now, `packageRefundedForRequest` what THIS request already sent back (above
  // zero means an earlier resolve stopped halfway and the next one resumes it). All three are null when it is not a
  // package, or when the ledger could not be read — and then `packageUnreadable` says so, so a screen never shows "paid
  // nothing" for a failed read.
  isPackage: boolean;
  packagePaid: number | null;
  packageRefundable: number | null;
  packageRefundedForRequest: number | null;
  packageUnreadable: boolean;
  // The credit document of THIS request's confirmed refund, from the ledger — the only place a CardCom credit document
  // number is kept (the request row has a SUMIT document id and url only). Null when nothing was refunded, when it is not a
  // package, or when the ledger could not be read.
  packageRefundDocument: ProviderDocument | null;
  // The purchase's document (the receipt a refund credits) and THIS request's latest refund attempt with the provider's own
  // answer — so a refused refund shows why. Null when it is not a package or the ledger could not be read.
  packageRecord: PackagePaymentRecord | null;
  // Whether resolveCancellationRequest can actually attempt a SUMIT
  // capture/credit for this campaign (same 4-field check it uses internally)
  // — lets the admin UI state the outcome definitively instead of hedging
  // with "if card details are on file".
  hasCardOnFile: boolean;
  // Signed/approved agreement version — an open-ceiling version (v5+) means the
  // accrued preview is not capped at maxChargeCeiling.
  tosVersion: string | null;
  // Needed to compute the live accrued preview with computeChargeAmount —
  // the campaign_billing_summary RPC's own `accrued` is base/overage-blind
  // (verified gap, 2026-08-28), so callers must fold these in themselves.
  basePrice: number;
  includedReached: number;
  pricePerReached: number;
};

export async function getCampaignForEventAdmin(
  eventId: string,
  cancellationRequestId?: string,
): Promise<CampaignForCancellationAdmin | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(
      'id, charge_status, max_charge_ceiling, final_charge_amount, package_price, tos_version, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, base_price, included_reached, price_per_reached',
    )
    .eq('event_id', eventId)
    // The LIVE campaign: the one resolveCancellationRequest acts on (liveCampaignOf), so the screen never promises what the resolver will
    // not do. A cancelled campaign - every reset test run leaves one - is not what a cancellation request is about, and an event whose
    // campaigns are all cancelled has none, exactly as the resolver sees it.
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // A failed read is an error, never "the event has no live campaign": the screen would then promise that no money moves.
  if (error) throw new Error('טעינת נתוני הקמפיין נכשלה');
  if (!data) return null;

  // A package: the ledger decides what was paid and whether a usable card is saved.
  const isPackage = data.package_price != null;
  let packagePaid: number | null = null;
  let packageRefundable: number | null = null;
  let packageRefundedForRequest: number | null = null;
  let packageCard = false;
  let packageUnreadable = false;
  let packageRefundDocument: ProviderDocument | null = null;
  let packageRecord: PackagePaymentRecord | null = null;
  if (isPackage) {
    try {
      const [summary, record] = await Promise.all([
        packageRefundSummary(data.id, cancellationRequestId),
        packagePaymentRecord(data.id, cancellationRequestId),
      ]);
      packageRecord = record;
      packageRefundable = summary.refundable;
      packageRefundedForRequest = summary.refundedForRequest;
      packagePaid = Math.round((summary.refundable + summary.refundedForRequest) * 100) / 100;
      packageCard = summary.hasCard;
      packageRefundDocument = summary.refundDocument;
    } catch {
      packageUnreadable = true;
    }
  }
  return {
    id: data.id,
    chargeStatus: data.charge_status,
    maxChargeCeiling: data.max_charge_ceiling,
    finalChargeAmount: Number(data.final_charge_amount ?? 0),
    isPackage,
    packagePaid,
    packageRefundable,
    packageRefundedForRequest,
    packageUnreadable,
    packageRefundDocument,
    packageRecord,
    tosVersion: data.tos_version,
    hasCardOnFile: isPackage
      ? packageCard
      : !!(data.card_token_ref && data.card_exp_month && data.card_exp_year && data.card_citizen_id),
    basePrice: Number(data.base_price ?? 0),
    includedReached: Number(data.included_reached ?? 0),
    pricePerReached: Number(data.price_per_reached ?? 0),
  };
}

// Admin-mediated close, twin of events.ts closeEvent but requirePlatformPermission
// instead of ownership — mirrors campaigns.ts cancelCampaign's admin-only
// wind-down pattern. Same R7 DB trigger applies (operational-campaign guard).
// Re-checks the LIVE status first (rather than trusting a caller-supplied
// snapshot) so a redundant call is a true no-op: the caller here
// (resolveCancellationRequest) reads the event once at the top of its run,
// then may call closeCampaignAndCharge — which, on a terminal settlement
// outcome, already closes the event itself. Without this check that stale
// snapshot would make this function re-write status='closed' (harmless — the
// DB trigger only validates real transitions) but ALSO log a second,
// misleading 'event.closed_by_admin' activity entry right after the real
// 'event.closed_by_settlement' one for the same closure.
export async function adminCloseEvent(eventId: string): Promise<void> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data: current } = await admin
    .from('events')
    .select('status')
    .eq('id', eventId)
    .maybeSingle();
  if (current?.status === 'closed') return;
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
export async function computeSuggestedCancellationAmount(campaignId: string, base?: number): Promise<number> {
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
  // `base` is handed in for a package (what the card paid): it has no ceiling to take the fee of.
  const ceiling = base ?? campaignRes.data?.max_charge_ceiling ?? 0;
  const fee = Math.min((ceiling * feePercent) / 100, feeCap);
  return Math.min(fee, ceiling);
}

// Money is decided and MOVED here (when there's still something to move),
// then notified, then persisted. Three sub-cases per campaign.charge_status
// (a fixed-price package is a fourth case of its own, below the three):
//   - pre-charge (null/charge_failed/charge_review/nothing_to_charge): calls
//     closeCampaignAndCharge with an override amount — a REAL SUMIT capture
//     for partial_charge, or the existing nothing_to_charge branch (no SUMIT
//     call at all) for full_cancellation. A declined request moves no money.
//   - post-charge ('charged'): calls creditHeldCardSumit — a REAL SUMIT
//     credit for the amount being refunded. Falls back to
//     capture_outcome='manual_refund_required' ONLY if the campaign is
//     missing the card fields needed to even attempt it (very old data) —
//     a declined/network error from the credit call itself PROPAGATES
//     instead, it does not silently downgrade to "manual" — staff sees the
//     real failure and decides what to do.
//   - fixed-price PACKAGE (campaigns.package_price set; it has no charge_status): paid once at purchase, so money only
//     goes BACK, through the payment ledger (refundPackagePayment, src/lib/payments/package-refund.ts) — all of what
//     the card paid for full_cancellation, what is beyond the amount that STAYS with us for partial_charge. It is
//     checked first (checkPackageRefund): a refund that cannot be made (no saved card or cancellable document, payments
//     off, ledger unreadable) stops here and the customer is told nothing. When nothing was paid (or it all went back
//     already) there is no refund to make: the request is approved and no money moves. A refund that CAN be made is made
//     BEFORE the e-mail, and the e-mail says what went back: a refund that does not go through is an error the admin
//     sees, the request stays open and the customer is told nothing. A refund already made for THIS request is resumed,
//     never repeated — which is what makes refund-then-e-mail safe: when the e-mail fails after the refund, approving
//     again sends it without a second refund. The campaign and the event are closed afterwards. A declined request moves
//     no money.
// For everything that is NOT a package refund the EMAIL IS CHECKED FIRST, before any SUMIT call — same send-then-persist
// contract as sendInquiryReply (contacts.ts), extended so a broken mail server can't leave a charge/credit executed with
// no notification sent (a per-result charge or credit has no once-per-request guard, so it must not be retried). SMS
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
  // fetched row explicitly.
  type ResolveFetchRow = {
    id: string;
    request_code: string;
    event_id: string;
    sms_consent: boolean;
    status: string;
    events: {
      id: string;
      status: string;
      owner_id: string;
      campaigns: {
        id: string;
        status: string;
        created_at: string;
        charge_status: string | null;
        final_charge_amount: number | null;
        max_charge_ceiling: number | null;
        card_token_ref: string | null;
        card_exp_month: number | null;
        card_exp_year: number | null;
        card_citizen_id: string | null;
        auth_external_ref: string | null;
        package_price: number | null;
      }[];
    } | null;
  };

  const { data, error: fetchError } = await admin
    .from('event_cancellation_requests')
    .select(
      'id, request_code, event_id, sms_consent, status, ' +
        'events(id, status, owner_id, campaigns(id, status, created_at, charge_status, final_charge_amount, max_charge_ceiling, ' +
        'card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref, package_price))',
    )
    .eq('id', requestId)
    .single();

  if (fetchError || !data) throw new Error('בקשת הביטול לא נמצאה');
  const reqRow = data as unknown as ResolveFetchRow;
  if (reqRow.status !== 'pending') throw new Error('בקשה זו כבר טופלה');

  const event = reqRow.events;
  if (!event) throw new Error('האירוע המקושר לבקשה לא נמצא');
  // At most one NON-CANCELLED campaign per event (campaigns_event_noncancelled_uidx) - but any number of cancelled ones (every reset
  // test run leaves one), and the embed promises no order. The campaign a cancellation request is about is the live one: money is
  // never refunded from, and a charge never taken on, a cancelled campaign. Newest first, then the live one.
  const campaign = liveCampaignOf([...event.campaigns].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')));
  // A fixed-price package was paid at purchase and has no settlement: neither money branch below fits it
  // (closeCampaignAndCharge refuses it). Resolving its request means giving money BACK through the payment ledger
  // (package-refund.ts); the pieces for that are decided here, before any money moves or the customer is e-mailed.
  const isPackage = campaign?.package_price != null;
  const hasCardOnFile = !!(
    campaign?.card_token_ref &&
    campaign.card_exp_month &&
    campaign.card_exp_year &&
    campaign.card_citizen_id
  );

  // A fixed-price package: what the card paid BEFORE this request refunded anything (the base of a percentage fee) comes
  // from the ledger, never from the old campaign columns (a package has none of them) — and so does what an earlier
  // attempt of THIS request already sent back. A refund that exists for this request means that attempt got as far as the
  // money and failed at a later step (closing the campaign, recording the request): this attempt RESUMES it. What the
  // customer is told and what is recorded is then what the ledger says went back — never what the admin types this time,
  // or the customer would be told numbers that never happened. (A resumed attempt e-mails again, like every retry here.)
  let packagePaid: number | null = null;
  let refundedBefore = 0;
  if (isPackage && campaign) {
    try {
      const summary = await packageRefundSummary(campaign.id, requestId);
      packagePaid = Math.round((summary.refundable + summary.refundedForRequest) * 100) / 100;
      refundedBefore = summary.refundedForRequest;
    } catch {
      // A decline moves no money, so an unreadable ledger does not stop it; anything that could move money does.
      if (input.resolution !== 'declined') throw new Error('קריאת נתוני התשלום של החבילה נכשלה — לא בוצעה פעולה');
    }
  }
  const resumed = refundedBefore > 0;
  if (resumed && input.resolution === 'declined') {
    throw new Error('כבר בוצע החזר כספי לבקשה הזו — אי אפשר לדחות אותה עכשיו. אשרו את הטיפול בה כדי להשלים אותו');
  }
  let resolution = input.resolution;
  let resolutionAmount = input.resolutionAmount;
  if (resumed) {
    const kept = (Math.round((packagePaid ?? 0) * 100) - Math.round(refundedBefore * 100)) / 100;
    resolution = kept > 0 ? 'partial_charge' : 'full_cancellation';
    resolutionAmount = kept > 0 ? kept : undefined;
  } else if (input.resolution === 'partial_charge' && input.resolutionPercent !== undefined) {
    // A fee chosen as a PERCENTAGE becomes an amount here, on the server, from a base the server decides
    // (cancellationFeeBase) — never from anything the browser computed. Refused BEFORE the customer email and before any
    // money moves; from here on the amount below is the only one used.
    const base = cancellationFeeBase({
      chargeStatus: campaign?.charge_status ?? null,
      finalChargeAmount: campaign?.final_charge_amount ?? null,
      maxChargeCeiling: campaign?.max_charge_ceiling ?? null,
      packagePaid,
    });
    if (base <= 0) throw new Error('אין סכום בסיס לחישוב אחוזים בקמפיין הזה — הזינו סכום בשקלים');
    resolutionAmount = feeFromPercent(base, input.resolutionPercent);
    if (resolutionAmount <= 0) throw new Error('הסכום שחושב מהאחוז קטן מדי — הזינו אחוז גבוה יותר או סכום בשקלים');
  }

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

  // A package: how much goes back, and whether the refund CAN go ahead — decided now, before anything is sent or moved,
  // so a refund that cannot be made stops the resolve with nothing changed. A request whose refund already went back (a
  // retry after a half-finished resolve) passes this check and resumes instead of refunding twice.
  let packagePlan: { kept: number; refund: number } | null = null;
  if (isPackage && campaign && resolution !== 'declined') {
    packagePlan = planPackageRefund({ paid: packagePaid ?? 0, resolution, resolutionAmount });
    if (packagePlan.refund > 0) {
      const blocked = await checkPackageRefund({
        campaignId: campaign.id,
        eventId: event.id,
        amount: packagePlan.refund,
        cancellationRequestId: requestId,
      });
      if (blocked && blocked.status !== 'refunded') throw new CancellationResolveError(packageRefundMessage(blocked), packageRefundRetry(blocked));
    }
  }

  // Decide WHICH BRANCH before sending anything (not the final amount yet for
  // the credit branch — that depends on what was actually charged, read from
  // `campaign.final_charge_amount`, already available here).
  let captureOutcome: 'captured' | 'refunded' | 'manual_refund_required' | 'not_applicable';
  let finalAmount = 0;
  let sumitDocumentId: number | null = null;
  let sumitDocumentUrl: string | null = null;

  const isPreCharge = campaign && campaign.charge_status !== 'charged';
  const isPostCharge = campaign?.charge_status === 'charged';

  if (resolution === 'declined') {
    captureOutcome = 'not_applicable';
  } else if (isPackage) {
    captureOutcome = packagePlan && packagePlan.refund > 0 ? 'refunded' : 'not_applicable';
  } else if (isPostCharge) {
    if (!hasCardOnFile) {
      captureOutcome = 'manual_refund_required';
      const charged = campaign?.final_charge_amount ?? 0;
      finalAmount =
        resolution === 'full_cancellation'
          ? charged
          : Math.max(0, charged - (resolutionAmount ?? 0));
    } else {
      captureOutcome = 'refunded'; // executed below, after the email send succeeds
    }
  } else if (isPreCharge) {
    captureOutcome = 'captured'; // executed below, after the email send succeeds
  } else {
    captureOutcome = 'not_applicable'; // no campaign was ever authorized — nothing to move
  }

  const origin = await getAppOrigin();
  // The customer's e-mail, built and sent in one place for both orders below. `refundedAmount` is passed only when the
  // money ALREADY went back, so the e-mail can say so (and never "ללא חיוב" to a customer who paid).
  const emailCustomer = async (refundedAmount?: number): Promise<void> => {
    const { subject, html, text } = cancellationRequestResponseEmail({
      recipientName: ownerName,
      requestCode: reqRow.request_code,
      resolution,
      resolutionAmount: captureOutcome === 'manual_refund_required' ? finalAmount : resolutionAmount,
      refundedAmount,
      resolutionNote: input.resolutionNote,
      origin,
    });
    const sender = await getEmailSender();
    await sender.send({ to: ownerEmail, subject, html, text });
  };

  // A package refund goes FIRST and the e-mail after it; everything else keeps the e-mail first. The difference is
  // whether a retry is safe: a package refund is made once per request (the ledger returns an earlier refund of the same
  // request instead of refunding again), so a refund followed by a failed e-mail is finished by approving again, and the
  // customer is never told of a refund that was declined or is in doubt. The per-result charge and credit below have no
  // such guard — a retry could charge or credit twice — so for them the e-mail stays the gate before any money moves.
  const refundFirst = !!(isPackage && campaign && packagePlan && packagePlan.refund > 0);

  if (!refundFirst) {
    try {
      await emailCustomer();
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
  }

  // NOW execute the actual money movement. For the per-result branches any SumitDeclinedError/SumitNetworkError
  // propagates — the customer already got an email promising an outcome the charge/credit then failed to deliver;
  // surfacing the error to the admin (rather than silently persisting a mismatched resolution) is the least-bad option,
  // matching close-charge.ts's own "never silently settle a wrong amount" discipline.
  if (refundFirst && campaign && packagePlan) {
    // The money goes back through the ledger: a pending row first, the clearing company second, the outcome recorded
    // third. Anything but a confirmed refund is an error the admin sees, with the request left open and NO e-mail sent —
    // the refund is made once per request, so trying again is safe where the module says so.
    const refund = await refundPackagePayment({
      campaignId: campaign.id,
      eventId: event.id,
      amount: packagePlan.refund,
      cancellationRequestId: requestId,
    });
    if (refund.status !== 'refunded') throw new CancellationResolveError(packageRefundMessage(refund), packageRefundRetry(refund));
    // What the ledger says went back is what is recorded — on a resumed request that is the earlier refund.
    finalAmount = refund.amount;
    sumitDocumentId = refund.document?.id ?? null;
    sumitDocumentUrl = refund.document?.url ?? null;
    // The customer is told only now, and of what really went back. If the e-mail fails the money is already back: the
    // request stays open, and approving it again resumes it (no second refund) and sends the e-mail.
    try {
      await emailCustomer(refund.amount);
    } catch (err) {
      console.error('[event-cancellation] refund confirmed but the customer e-mail failed; the request stays open', {
        requestId,
        error: err instanceof Error ? err.name : typeof err,
      });
      throw new CancellationResolveError(
        'הכסף הוחזר ללקוח, אך שליחת המייל נכשלה — הבקשה נשארה פתוחה. אשרו שוב כדי לשלוח את המייל; הכסף לא יוחזר פעמיים.',
        'allowed',
      );
    }
  } else if (captureOutcome === 'captured') {
    const overrideAmount = resolution === 'full_cancellation' ? 0 : (resolutionAmount ?? 0);
    const result = await closeCampaignAndCharge(campaign!.id, {
      overrideAmount,
      overrideReason:
        resolution === 'full_cancellation' ? 'cancellation_full' : 'cancellation_partial_charge',
    });
    finalAmount = result.amount;
    if (result.outcome === 'charged') {
      sumitDocumentId = result.documentId ?? null;
      sumitDocumentUrl = result.documentUrl ?? null;
    }
  } else if (captureOutcome === 'refunded') {
    const charged = campaign!.final_charge_amount ?? 0;
    const creditAmount =
      resolution === 'full_cancellation'
        ? charged
        : Math.max(0, charged - (resolutionAmount ?? 0));
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

      // The SUMIT credit above already moved real money back to the customer's
      // card — campaigns.final_charge_amount must reflect that net amount too,
      // or the customer's own campaign page and the admin campaigns list keep
      // showing the pre-refund gross forever (verified gap, 2026-08-28).
      // charge_status/credit_applied are deliberately left untouched: the
      // original charge is still a historical fact (charge_status stays
      // 'charged', preserving the settle-guard's terminal-state check), and
      // credit_applied is a distinct pre-charge concept (credit netted in at
      // the ORIGINAL charge, per close-charge.ts) — reusing it for a post-charge
      // refund would corrupt that figure.
      const { error: refundSyncError } = await admin
        .from('campaigns')
        .update({ final_charge_amount: charged - creditAmount })
        .eq('id', campaign!.id);
      if (refundSyncError) {
        throw new Error(
          'הזיכוי בוצע בפועל מול SUMIT, אך עדכון הסכום בכרטיס הקמפיין נכשל — נא לתעד ידנית ולבדוק שוב',
        );
      }
    }
  }

  // Best-effort, never blocks: a failed/skipped SMS must not undo the email
  // (or capture) that already happened, and must not leave the request open.
  if (reqRow.sms_consent && ownerPhone) {
    try {
      const smsSender = await getSmsSender();
      // A package refund: the fee that stayed and what went back, as in the e-mail. Everything else keeps its wording.
      const smsText = buildCancellationSmsText({
        fullName: ownerName,
        requestCode: reqRow.request_code,
        resolution,
        ...(refundFirst
          ? { resolutionAmount, refundedAmount: finalAmount }
          : { resolutionAmount: finalAmount || undefined }),
      });
      await smsSender.send({ to: ownerPhone, text: smsText });
    } catch {
      // Nothing is recorded here — never rethrown.
    }
  }

  // A cancelled package campaign is closed so it stops sending, before the event is (the event cannot close while a
  // campaign is still operational). An already closed or never-started one is left as it is.
  if (
    isPackage &&
    campaign &&
    resolution !== 'declined' &&
    (CLOSEABLE_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)
  ) {
    await closeCampaign(campaign.id);
  }

  if (resolution !== 'declined' && event.status !== 'closed') {
    await adminCloseEvent(event.id);
  }

  const now = new Date().toISOString();
  // Only a request that is STILL pending is resolved. Two resolves of the same request (a double click, two tabs) both pass
  // the check at the top; without this filter the second would reach the immutable-row trigger only after its e-mail and
  // money step. A filter that matches no row is not a database error, so the rows written are read back and counted.
  const { data: resolvedRows, error: updateError } = await admin
    .from('event_cancellation_requests')
    .update({
      status: 'resolved',
      resolution,
      resolution_amount: finalAmount || null,
      capture_outcome: captureOutcome,
      sumit_document_id: sumitDocumentId,
      sumit_document_url: sumitDocumentUrl,
      resolution_note: input.resolutionNote,
      resolved_at: now,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');

  if (!updateError && (resolvedRows ?? []).length === 0) {
    throw new CancellationResolveError('הבקשה כבר טופלה בניסיון אחר — רעננו את הדף לפני פעולה נוספת', 'forbidden');
  }
  if (updateError) {
    throw new Error(
      'העדכון נשלח ללקוח (והחיוב, אם היה, בוצע), אך שמירת הרשומה נכשלה — נא לרענן ולתעד ידנית לפני פעולה נוספת',
    );
  }

  await logActivity({
    eventId: event.id,
    action: 'event_cancellation.resolved',
    meta: { requestId, resolution, captureOutcome },
  });
}
