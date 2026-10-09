import 'server-only';

import { z } from 'zod';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getSumitCustomerId } from '@/lib/data/sumit-customers';
import { terminalsConflict } from '@/lib/payments/cardcom-terminal-echo';
import { completeOperation, OperationStateError } from '@/lib/payments/ledger';
import { TERMINAL_CONFLICT_NOTICE } from '@/lib/payments/terminal-conflict-copy';
import { labelTestMoney } from '@/lib/payments/test-money-label';
import { probeSumitCharge, type ProbeResult } from '@/lib/sumit/probe';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

import { recordStaffAccess } from './access-log';

// Payment operations waiting for a PERSON. An operation lands in `review` when nobody can say whether the provider
// charged: the process died mid-call (the orphan sweep moves it there), or the provider's answer was unclear. Nothing
// retries it — a retry could charge twice — and while it sits in review the "pay once" lock stays closed. Only the
// functions below close it, only from `review`, and only after a staff member has checked the provider.
//
// Authority: `manage_billing` (written out at every gate — the admin coverage test pins it textually), the same key as
// every other payment surface. Looking at or deciding on one customer's
// payment records a staff-access audit row FIRST and fails closed — if the audit cannot be written, nothing is asked
// or changed. Not a break-glass permission, so no free-text reason is demanded for the LOOK; the DECISION carries its
// own mandatory note.

// A message that is safe to show to the staff member exactly as written: a fixed Hebrew sentence with no detail from the
// database or the provider. Anything that is NOT one of these (an unexpected failure) is shown only as a generic line.
export class PaymentReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentReviewError';
  }
}

const NOT_FOUND = 'פעולת התשלום לא נמצאה';
const NOT_IN_REVIEW = 'הפעולה אינה ממתינה להכרעה';
const ALREADY_DECIDED = 'הפעולה כבר הוכרעה על ידי מישהו אחר';
const LOAD_FAILED = 'טעינת פעולות התשלום נכשלה';
const AMOUNT_CONFLICTS_WITH_LINES = 'הסכום שהוזן שונה מפירוט הפעולה, ואת הפירוט אי אפשר לשנות. השאירו את שדה הסכום ריק.';

type Provider = 'sumit' | 'cardcom';

// Whose row it is. The column is authoritative; a CardCom payment recorded before the column was set carries the marker in its meta.
function providerOf(row: { provider?: unknown; meta?: Json }): Provider {
  if (row.provider === 'cardcom') return 'cardcom';
  const meta = row.meta;
  return meta !== null && meta !== undefined && typeof meta === 'object' && !Array.isArray(meta) && meta['provider'] === 'cardcom' ? 'cardcom' : 'sumit';
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// A CardCom payment whose terminal, as CardCom reported it, is not the terminal it was opened on. Nobody can say where that money is,
// so it can never be APPROVED as a collection from here - only marked failed, after someone looked in CardCom's own panel. (A row
// that has no recorded terminal, or one CardCom reported none for, has nothing to conflict with.)
export function reportedTerminalConflicts(row: { provider: Provider; terminalOpenedOn: number | null; terminalReported: number | null }): boolean {
  return row.provider === 'cardcom' && terminalsConflict(row.terminalOpenedOn, row.terminalReported);
}

export interface PaymentReviewItem {
  operationId: string;
  campaignId: string;
  eventId: string;
  eventName: string;
  kind: string;
  kindLabel: string;
  amount: number;
  recordedAt: string;
  note: string | null;
  // Which clearing company's row it is: a CardCom payment is checked in CardCom's own panel, never in SUMIT's.
  provider: Provider;
  // The database's class for the row: it was opened on a no-money (test) terminal.
  isTest: boolean;
  // CardCom rows: the terminal the payment was opened on, the terminal CardCom reported (null = it reported none), and the references a
  // person finds the payment by in CardCom's panel (the document, the approval, the transaction). All null for a row that has none.
  terminalOpenedOn: number | null;
  terminalReported: number | null;
  documentNumber: number | null;
  authRef: string | null;
  paymentId: number | null;
}

export async function listPaymentReviews(): Promise<PaymentReviewItem[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, campaign_id, event_id, kind, amount, recorded_at, note, meta, provider, provider_terminal, provider_terminal_echo, is_test, provider_document_number, provider_auth_ref, provider_payment_id, payment_operation_kinds!inner(label_he), events!inner(name)')
    .eq('outcome', 'review')
    .order('recorded_at', { ascending: true });
  // Thrown, not "nothing to review": an empty list that is really a failed read would hide a possibly-charged card.
  if (error) throw new PaymentReviewError(LOAD_FAILED);
  return (data ?? []).map((row) => ({
    operationId: row.id,
    campaignId: row.campaign_id,
    eventId: row.event_id,
    eventName: row.events?.name ?? '',
    kind: row.kind,
    kindLabel: row.payment_operation_kinds?.label_he ?? row.kind,
    amount: Number(row.amount),
    recordedAt: row.recorded_at,
    note: row.note,
    provider: providerOf(row),
    isTest: row.is_test === true,
    terminalOpenedOn: numberOrNull(row.provider_terminal),
    terminalReported: numberOrNull(row.provider_terminal_echo),
    documentNumber: numberOrNull(row.provider_document_number),
    authRef: row.provider_auth_ref ?? null,
    paymentId: numberOrNull(row.provider_payment_id),
  }));
}

type ReviewTarget = {
  id: string;
  campaignId: string;
  eventId: string;
  ownerId: string;
  kind: string;
  effect: string;
  amount: number;
  recordedAt: string;
  note: string | null;
  payerUserId: string | null;
  provider: Provider;
  terminalOpenedOn: number | null;
  terminalReported: number | null;
  // The document the row already holds (CardCom's answer keeps it when it parks a payment), and the class the database gave the row.
  documentNumber: number | null;
  isTest: boolean;
};

// Loads one operation and refuses anything that is not waiting for a decision. The admin client reads across tenants,
// so the permission check has already happened in the caller.
async function loadReviewTarget(operationId: string): Promise<ReviewTarget> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, campaign_id, event_id, kind, outcome, amount, recorded_at, note, meta, provider, provider_terminal, provider_terminal_echo, provider_document_number, is_test, payment_operation_kinds!inner(effect), events!inner(owner_id)')
    .eq('id', operationId)
    .maybeSingle();
  if (error) throw new PaymentReviewError(LOAD_FAILED);
  if (!data) throw new PaymentReviewError(NOT_FOUND);
  if (data.outcome !== 'review') throw new PaymentReviewError(NOT_IN_REVIEW);

  // Who paid: the customer number is looked up for THIS person (the one who entered the card), not for whoever is
  // viewing now — written on the row by the purchase route.
  const meta = data.meta;
  const payer =
    meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta['payerUserId'] : undefined;

  return {
    id: data.id,
    campaignId: data.campaign_id,
    eventId: data.event_id,
    ownerId: data.events?.owner_id ?? '',
    kind: data.kind,
    effect: data.payment_operation_kinds?.effect ?? '',
    amount: Number(data.amount),
    recordedAt: data.recorded_at,
    note: data.note,
    payerUserId: typeof payer === 'string' ? payer : null,
    provider: providerOf(data),
    terminalOpenedOn: numberOrNull(data.provider_terminal),
    terminalReported: numberOrNull(data.provider_terminal_echo),
    documentNumber: numberOrNull(data.provider_document_number),
    isTest: data.is_test === true,
  };
}

// The gate, the load and the audit in one place, so no caller can look at a customer's payment untraced (registered as a
// delegate in the admin coverage test). The row is loaded first because the audit needs the owning customer; a row
// that is not waiting for a decision is refused before anything is recorded.
async function auditedReviewAccess(
  operationId: string,
): Promise<{ staffId: string; target: ReviewTarget }> {
  const staff = await requirePlatformPermission('manage_billing');
  const target = await loadReviewTarget(operationId);
  await recordStaffAccess({
    staffId: staff.id,
    permission: 'manage_billing',
    subjectType: 'campaign',
    subjectId: target.campaignId,
    ownerId: target.ownerId,
    eventId: target.eventId,
  });
  return { staffId: staff.id, target };
}

export type PaymentReviewProbe = ProbeResult | { kind: 'unavailable'; reason: 'unsupported' };

// "Does the provider show a payment like this one?" — a SUGGESTION for the admin, never a decision (see probe.ts).
export async function probePaymentReview(operationId: string): Promise<PaymentReviewProbe> {
  await requirePlatformPermission('manage_billing');
  const { target } = await auditedReviewAccess(operationId);

  // A CardCom payment is never looked up in SUMIT's list: "not found" there would read as "no payment" about money that lives
  // somewhere else. Its row is checked in CardCom's own panel.
  if (target.provider === 'cardcom') return { kind: 'unavailable', reason: 'unsupported' };

  // The provider's payment list shows money TAKEN. Looking a refund or a hold up in it would answer a different
  // question, so those are left to the admin's own check in the provider's screen.
  if (target.effect !== 'collect') return { kind: 'unavailable', reason: 'unsupported' };

  const config = await getSumitServerConfig();
  if (!config) return { kind: 'unavailable', reason: 'credentials' };

  const customerId = target.payerUserId ? await getSumitCustomerId(target.payerUserId) : null;
  return probeSumitCharge({
    companyId: config.companyId,
    apiKey: config.apiKey,
    recordedAt: target.recordedAt,
    amount: target.amount,
    customerId,
  });
}

export const resolvePaymentReviewSchema = z
  .object({
    operationId: z.uuid({ error: 'מזהה הפעולה אינו תקין' }),
    outcome: z.enum(['succeeded', 'failed'], { error: 'יש לבחור אישור גבייה או סימון ככושלת' }),
    // The receipt (or document) number printed in the provider's screen. SUMIT's payment list does not return it, so it is typed by
    // hand; a CardCom row shows the one it already holds, to be confirmed.
    documentNumber: z
      .number({ error: 'מספר המסמך אינו תקין' })
      .int('מספר המסמך אינו תקין')
      .positive('מספר המסמך אינו תקין')
      .optional(),
    // What the provider actually charged, when it differs from what we intended.
    amount: z
      .number({ error: 'הסכום אינו תקין' })
      .min(0, 'הסכום אינו תקין')
      .max(1_000_000, 'הסכום אינו תקין')
      .optional(),
    note: z
      .string({ error: 'נדרש לציין מה נבדק אצל חברת הסליקה' })
      .trim()
      .min(10, 'נדרש לציין מה נבדק אצל חברת הסליקה (לפחות 10 תווים)')
      .max(500, 'ההערה ארוכה מדי (עד 500 תווים)'),
  })
  .refine((v) => v.outcome !== 'succeeded' || v.documentNumber !== undefined, {
    path: ['documentNumber'],
    message: 'לאישור גבייה נדרש מספר המסמך מחברת הסליקה',
  });

export type ResolvePaymentReviewInput = z.input<typeof resolvePaymentReviewSchema>;

// Closes an operation that is in review: `succeeded` (the provider did charge — with the receipt number) or `failed`
// (it did not). The ledger update is a compare-and-set FROM review, so a row that is still pending, or that another
// admin just decided, cannot be overwritten.
export async function resolvePaymentReview(input: ResolvePaymentReviewInput): Promise<{ outcome: 'succeeded' | 'failed' }> {
  // Gate first, then validate, then (inside the delegate) load and audit: an invalid decision never touches the audit
  // log or the ledger.
  await requirePlatformPermission('manage_billing');
  const parsed = resolvePaymentReviewSchema.parse(input);
  const { target } = await auditedReviewAccess(parsed.operationId);

  const admin = createAdminClient();

  // A CardCom payment that CardCom places on another terminal than the one it was opened on is not approved from here, whatever the
  // browser sent: the card does not offer the button, and this is the server saying it too.
  if (parsed.outcome === 'succeeded' && reportedTerminalConflicts(target)) throw new PaymentReviewError(TERMINAL_CONFLICT_NOTICE);

  // An operation whose price is itemised (payment_operation_lines) is closed only at the amount its lines add up to: the
  // database refuses anything else, and the lines are append-only. Say so here, in plain words, instead of letting the
  // admin meet a generic "try again" for a decision that can never succeed.
  if (parsed.outcome === 'succeeded' && parsed.amount !== undefined && Math.round(parsed.amount * 100) !== Math.round(target.amount * 100)) {
    const { count, error } = await admin
      .from('payment_operation_lines')
      .select('id', { count: 'exact', head: true })
      .eq('operation_id', target.id);
    if (error) throw new PaymentReviewError(LOAD_FAILED);
    if ((count ?? 0) > 0) throw new PaymentReviewError(AMOUNT_CONFLICTS_WITH_LINES);
  }

  // Confirming the number the row already holds leaves its document exactly as it is - id, number and the link CardCom gave. Only a
  // DIFFERENT number replaces it, and then without the old link, which belongs to the old document. (A completed row is frozen, so a
  // link written over here could never be put back.)
  const keepsStoredDocument = parsed.documentNumber !== undefined && parsed.documentNumber === target.documentNumber;
  try {
    await completeOperation(admin, target.id, {
      from: 'review',
      outcome: parsed.outcome,
      ...(parsed.outcome === 'succeeded'
        ? {
            amount: parsed.amount ?? target.amount,
            ...(keepsStoredDocument ? {} : { providerDocument: { id: null, number: parsed.documentNumber ?? null, url: null } }),
          }
        : {}),
      // Keep the earlier note (why it landed in review); the decision is added to it, never written over it.
      note: [target.note, `הוכרע ידנית: ${parsed.note}`].filter((part): part is string => Boolean(part)).join(' | '),
    });
  } catch (err) {
    if (err instanceof OperationStateError) throw new PaymentReviewError(ALREADY_DECIDED);
    throw err;
  }

  // The decision is committed. The trail below is best effort: failing it must not undo or hide the decision.
  try {
    await logActivity({
      eventId: target.eventId,
      action: 'payment.review_resolved',
      meta: { operationId: target.id, campaignId: target.campaignId, outcome: parsed.outcome, ...(target.isTest ? { testMoney: true } : {}) },
    });
  } catch (err) {
    console.error('[payment-review] logActivity failed (non-fatal)', { operationId: target.id, err });
  }
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'payment-review',
    title: labelTestMoney(
      parsed.outcome === 'succeeded'
        ? 'פעולת תשלום שנתקעה אושרה ידנית כחיוב שבוצע'
        : 'פעולת תשלום שנתקעה סומנה ידנית ככושלת',
      target.isTest,
    ),
    fields: {
      operation_id: target.id,
      campaign_id: target.campaignId,
      event_id: target.eventId,
      outcome: parsed.outcome,
    },
  });

  return { outcome: parsed.outcome };
}
