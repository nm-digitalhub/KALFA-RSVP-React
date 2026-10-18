import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { getCurrentPricing } from '@/lib/data/campaign-pricing';
import { createAdminClient } from '@/lib/supabase/admin';
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
import type { CancellationSearch } from '@/lib/data/cancellation-search';
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
// client, so the owner's own RLS decides what they may request.
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
  eventDate: string | null;
  // The customer who filed it (the event's owner): the detail page reads their name.
  ownerId: string;
  reason: string;
  smsConsent: boolean;
  status: 'pending' | 'resolved';
  resolution: 'full_cancellation' | 'partial_charge' | 'declined' | null;
  resolutionAmount: number | null;
  captureOutcome: 'captured' | 'refunded' | 'manual_refund_required' | 'not_applicable' | null;
  // The refund's credit document, whichever company issued it.
  refundDocumentUrl: string | null;
  resolutionNote: string | null;
  createdAt: string;
  // When staff resolved it. The resolve flow sends the customer's e-mail BEFORE it writes this, so a resolved request
  // was also e-mailed by then.
  resolvedAt: string | null;
};

const ADMIN_SELECT =
  'id, request_code, event_id, owner_id, reason, sms_consent, status, resolution, resolution_amount, ' +
  'capture_outcome, refund_document_url, resolution_note, created_at, resolved_at, events(name, status, event_date)';

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
  refund_document_url: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  owner_id: string;
  events: { name: string; status: string; event_date: string | null } | null;
}): CancellationRequestForAdmin {
  return {
    id: r.id,
    requestCode: r.request_code,
    eventId: r.event_id,
    eventName: r.events?.name ?? '',
    eventStatus: r.events?.status ?? '',
    eventDate: r.events?.event_date ?? null,
    ownerId: r.owner_id,
    reason: r.reason,
    smsConsent: r.sms_consent,
    status: r.status as 'pending' | 'resolved',
    resolution: r.resolution as CancellationRequestForAdmin['resolution'],
    resolutionAmount: r.resolution_amount,
    captureOutcome: r.capture_outcome as CancellationRequestForAdmin['captureOutcome'],
    refundDocumentUrl: r.refund_document_url,
    resolutionNote: r.resolution_note,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

// The admin list, optionally only one status — filtered in the database, never in the page.
// The list, optionally narrowed by status and by a search over the request's reference or its event's name (both
// matched in the database). The search text is never spliced into a filter expression: the reference goes through
// .ilike() and the event name through its own query whose ids are passed to .in() — so commas, dots or brackets typed
// by staff cannot change the filter. `search` is the parsed form of the box (cancellationSearch).
// The order of the list by submission time: oldest first (the default — the request that waited longest is the next to
// handle) or newest first. Pending requests come before resolved ones either way.
export type CancellationListSort = 'oldest' | 'newest';

export async function listCancellationRequestsForAdmin(
  status?: CancellationRequestForAdmin['status'],
  search?: CancellationSearch | null,
  sort: CancellationListSort = 'oldest',
): Promise<CancellationRequestForAdmin[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const base = () => {
    let q = admin
      .from('event_cancellation_requests')
      .select(ADMIN_SELECT)
      .order('status', { ascending: true }) // pending first (alphabetically before resolved)
      .order('created_at', { ascending: sort === 'oldest' });
    if (status) q = q.eq('status', status);
    return q;
  };

  let rows: unknown[];
  if (!search) {
    const { data, error } = await base();
    if (error) throw new Error('טעינת בקשות הביטול נכשלה');
    rows = data ?? [];
  } else {
    const { data: events, error: eventsError } = await admin
      .from('events')
      .select('id')
      .ilike('name', `%${search.likeText}%`)
      .limit(200);
    if (eventsError) throw new Error('טעינת בקשות הביטול נכשלה');
    const eventIds = (events ?? []).map((e) => e.id);
    const [byCode, byEvent] = await Promise.all([
      base().ilike('request_code', `%${search.likeCode}%`),
      eventIds.length > 0 ? base().in('event_id', eventIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (byCode.error || byEvent.error) throw new Error('טעינת בקשות הביטול נכשלה');
    const seen = new Set<string>();
    rows = [...((byCode.data ?? []) as unknown[]), ...((byEvent.data ?? []) as unknown[])].filter((r) => {
      const id = (r as { id: string }).id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    rows.sort((a, b) => {
      const x = a as { status: string; created_at: string };
      const y = b as { status: string; created_at: string };
      const byTime = x.created_at.localeCompare(y.created_at);
      return x.status.localeCompare(y.status) || (sort === 'oldest' ? byTime : -byTime);
    });
  }
  const data = rows;

  return data.map((r) => mapAdminRow(r as unknown as Parameters<typeof mapAdminRow>[0]));
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

// The name of the customer who filed a request (their profile), for the request page's header. Staff only. null when the
// profile has no name; THROWS on a failed read, like the request reader beside it.
export async function getCancellationRequesterNameForAdmin(ownerId: string): Promise<string | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin.from('profiles').select('full_name').eq('id', ownerId).maybeSingle();
  if (error) throw new Error('טעינת פרטי הלקוח נכשלה');
  return data?.full_name?.trim() || null;
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
// tells the admin UI what resolving does with the package payment, and feeds
// computeSuggestedCancellationAmount. No owner-scoping (admin cross-customer
// reach, same as every other function in this file gated by manage_billing).
export type CampaignForCancellationAdmin = {
  id: string;
  // How many contacts the package covers; null when the campaign has no quota (not a package).
  contactQuota: number | null;
  // A fixed-price package's money is in the payment ledger.
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
  // Whether the package's payment can be refunded by itself (a saved card and a cancellable document, from the ledger) —
  // lets the admin UI state the outcome definitively. False for a campaign without a package.
  hasCardOnFile: boolean;
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
      'id, contact_quota',
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

  // A package: the current pricing round says whether it IS one (the pricing module); the ledger decides what was
  // paid and whether a usable card is saved.
  const pricing = await getCurrentPricing(data.id);
  const isPackage = pricing !== null;
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
    isPackage,
    packagePaid,
    packageRefundable,
    packageRefundedForRequest,
    packageUnreadable,
    packageRefundDocument,
    packageRecord,
    hasCardOnFile: packageCard,
    contactQuota: data.contact_quota,
  };
}

// Admin-mediated close, twin of events.ts closeEvent but requirePlatformPermission
// instead of ownership — mirrors campaigns.ts cancelCampaign's admin-only
// wind-down pattern. Same R7 DB trigger applies (operational-campaign guard).
// Re-checks the LIVE status first (rather than trusting a caller-supplied
// snapshot) so a redundant call is a true no-op and logs no second
// 'event.closed_by_admin' entry.
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

// Suggested amount ONLY — the admin UI shows this pre-filled but editable; the amount that stays with us is whatever the
// admin confirms in resolveCancellationRequest's input, never this value directly. `base` is what the card paid for the
// package (0 when nothing was paid or there is no package).
export async function computeSuggestedCancellationAmount(base: number): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('cancellation_fee_percent, cancellation_fee_cap')
    .eq('id', true)
    .maybeSingle();
  const feePercent = data?.cancellation_fee_percent ?? 0;
  const feeCap = data?.cancellation_fee_cap ?? 0;
  const fee = Math.min((base * feePercent) / 100, feeCap);
  return Math.min(fee, base);
}

// Money is decided and MOVED here (when there's still something to move), then notified, then persisted.
//   - A fixed-price PACKAGE: paid once at purchase, so money only goes BACK, through the payment ledger
//     (refundPackagePayment, src/lib/payments/package-refund.ts) — all of what the card paid for full_cancellation, what
//     is beyond the amount that STAYS with us for partial_charge. It is checked first (checkPackageRefund): a refund that
//     cannot be made (no saved card or cancellable document, payments off, ledger unreadable) stops here and the customer
//     is told nothing. When nothing was paid (or it all went back already) there is no refund to make: the request is
//     approved and no money moves. A refund that CAN be made is made BEFORE the e-mail, and the e-mail says what went
//     back: a refund that does not go through is an error the admin sees, the request stays open and the customer is told
//     nothing. A refund already made for THIS request is resumed, never repeated — which is what makes refund-then-e-mail
//     safe: when the e-mail fails after the refund, approving again sends it without a second refund. The campaign and the
//     event are closed afterwards.
//   - A campaign without a package (created under the earlier pay-per-result model): no money moves here.
//   - A declined request moves no money.
// When no refund is made the e-mail is sent first, so a broken mail server leaves the request open and nothing changed.
// SMS is best-effort AFTER the e-mail — see sendNoContactSms (callback-scheduling.ts) for the "never block the core
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
      }[];
    } | null;
  };

  const { data, error: fetchError } = await admin
    .from('event_cancellation_requests')
    .select(
      'id, request_code, event_id, sms_consent, status, ' +
        'events(id, status, owner_id, campaigns(id, status, created_at))',
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
  // A fixed-price package was paid at purchase. Resolving its request means giving money BACK through the payment ledger
  // (package-refund.ts); the pieces for that are decided here, before any money moves or the customer is e-mailed.
  // Whether the live campaign IS a package comes from its pricing round (the pricing module).
  const isPackage = campaign !== null && (await getCurrentPricing(campaign.id)) !== null;

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
    const base = cancellationFeeBase({ packagePaid });
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

  // Which money outcome this resolve has, decided before anything is sent.
  let captureOutcome: 'refunded' | 'not_applicable';
  let finalAmount = 0;
  let refundDocumentId: number | null = null;
  let refundDocumentUrl: string | null = null;

  if (resolution !== 'declined' && isPackage && packagePlan && packagePlan.refund > 0) {
    captureOutcome = 'refunded';
  } else {
    captureOutcome = 'not_applicable';
  }

  const origin = await getAppOrigin();
  // The customer's e-mail, built and sent in one place for both orders below. `refundedAmount` is passed only when the
  // money ALREADY went back, so the e-mail can say so (and never "ללא חיוב" to a customer who paid).
  const emailCustomer = async (refundedAmount?: number): Promise<void> => {
    const { subject, html, text } = (await cancellationRequestResponseEmail({
      recipientName: ownerName,
      requestCode: reqRow.request_code,
      resolution,
      resolutionAmount,
      refundedAmount,
      resolutionNote: input.resolutionNote,
      origin,
    }));
    const sender = await getEmailSender();
    await sender.send({ to: ownerEmail, subject, html, text });
  };

  // A package refund goes FIRST and the e-mail after it: a package refund is made once per request (the ledger returns
  // an earlier refund of the same request instead of refunding again), so a refund followed by a failed e-mail is finished
  // by approving again, and the customer is never told of a refund that was declined or is in doubt.
  const refundFirst = captureOutcome === 'refunded';

  if (!refundFirst) {
    try {
      await emailCustomer();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'EmailConfigError') {
        throw new Error('שירות הדואר אינו מוגדר — הגדירו SMTP במסך ההגדרות ונסו שוב.');
      }
      if (name === 'EmailSendError') {
        throw new Error('שליחת הדואר נכשלה — הבקשה לא עודכנה, ושום כסף לא הועבר; אפשר לנסות שוב.');
      }
      throw err;
    }
  }

  // NOW the refund itself.
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
    refundDocumentId = refund.document?.id ?? null;
    refundDocumentUrl = refund.document?.url ?? null;
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
  }

  // Best-effort, never blocks: a failed/skipped SMS must not undo the email
  // (or capture) that already happened, and must not leave the request open.
  if (reqRow.sms_consent && ownerPhone) {
    try {
      const smsSender = await getSmsSender();
      // A package refund: the fee that stayed and what went back, as in the e-mail.
      const smsText = buildCancellationSmsText({
        fullName: ownerName,
        requestCode: reqRow.request_code,
        resolution,
        // With a refund, its credit document's link, as the ledger recorded it.
        ...(refundFirst
          ? { resolutionAmount, refundedAmount: finalAmount, documentUrl: refundDocumentUrl }
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
      refund_document_id: refundDocumentId,
      refund_document_url: refundDocumentUrl,
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
      'העדכון נשלח ללקוח (וההחזר, אם היה, בוצע), אך שמירת הרשומה נכשלה — נא לרענן ולתעד ידנית לפני פעולה נוספת',
    );
  }

  await logActivity({
    eventId: event.id,
    action: 'event_cancellation.resolved',
    meta: { requestId, resolution, captureOutcome },
  });
}
