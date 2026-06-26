import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSumitServerConfig } from '@/lib/data/payments';

// Admin-only reconciliation for orders stuck in `payment_review` (DB update
// failed after a successful charge, or unknown SUMIT outcome) and for `processing`
// orders that never resolved (server crashed between lock and outcome handling).
//
// SUMIT exposes no search-by-ExternalIdentifier; the only programmatic lookup is
// /billing/payments/get/ keyed by PaymentID (= our sumit_document_id). Hence:
//   PATH A (auto)   — order is `payment_review` WITH sumit_document_id → query SUMIT,
//                     mark `paid` when the payment is valid, `failed` when explicitly invalid,
//                     and do NOTHING (reconciled:false) on any inconclusive response.
//   PATH B (manual) — admin verified the charge manually in SUMIT's UI and supplies the
//                     document id → mark `paid` directly (no SUMIT call here).
//   reset           — a stuck `processing` order → `failed`, so the user retries normally.
//                     NEVER processing→pending: the atomic pay lock accepts `failed` and
//                     rotates payment_attempt_ref.

const SUMIT_PAYMENT_GET_URL = 'https://api.sumit.co.il/billing/payments/get/';

const reconcileBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('auto') }),
  z.object({
    action: z.literal('manual'),
    sumit_document_id: z
      .number({ error: 'מזהה מסמך לא תקין' })
      .int({ error: 'מזהה מסמך לא תקין' })
      .positive({ error: 'מזהה מסמך לא תקין' }),
  }),
  z.object({ action: z.literal('reset') }),
]);

function isNextRedirect(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Query SUMIT for a single payment's validity. Mirrors charge.ts's
// decline-vs-unknown split: only an explicit boolean answer is conclusive.
// Returns true/false when SUMIT reports ValidPayment, or null when the outcome
// is inconclusive (network error, non-2xx, parse failure, or missing Payment).
async function fetchSumitPaymentValid(paymentId: number): Promise<boolean | null> {
  // Admin-managed SUMIT config (DB, server-only). Missing → inconclusive.
  const config = await getSumitServerConfig();
  if (!config) return null;
  const { companyId, apiKey } = config;

  let res: Response;
  try {
    res = await fetch(SUMIT_PAYMENT_GET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Credentials: { CompanyID: companyId, APIKey: apiKey },
        PaymentID: paymentId,
      }),
    });
  } catch {
    // Network error — inconclusive. Do not transition the order.
    return null;
  }

  if (!res.ok) {
    return null;
  }

  // [SW] /billing/payments/get/ response: Status, Data.Payment.ValidPayment (boolean).
  type PaymentGetResponse = {
    Data?: { Payment?: { ValidPayment?: boolean } | null } | null;
  };

  let json: PaymentGetResponse;
  try {
    json = (await res.json()) as PaymentGetResponse;
  } catch {
    return null;
  }

  const valid = json.Data?.Payment?.ValidPayment;
  if (typeof valid !== 'boolean') {
    // No definitive Payment record — inconclusive.
    return null;
  }
  return valid;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Admin gate. requireAdmin throws NEXT_REDIRECT when not authenticated/authorized;
  // for a JSON API we convert that into a 403 rather than following a redirect to HTML.
  try {
    await requireAdmin();
  } catch (err) {
    if (isNextRedirect(err)) {
      return jsonError('אין הרשאה', 403);
    }
    console.error('[reconcile] admin check failed');
    return jsonError('שגיאה בלתי צפויה', 500);
  }

  const { id: orderId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError('בקשה לא תקינה', 400);
  }

  const parsed = reconcileBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError('בקשה לא תקינה', 400);
  }
  const body = parsed.data;

  const admin = createAdminClient();

  // Load the order with the service-role client (the admin is not the owner, so
  // a user-scoped read would never find it). Read only the fields we need.
  const { data: order, error: loadErr } = await admin
    .from('orders')
    .select('id, status, sumit_document_id')
    .eq('id', orderId)
    .maybeSingle();

  if (loadErr) {
    console.error('[reconcile] order load failed', { orderId });
    return jsonError('טעינת ההזמנה נכשלה', 500);
  }
  if (!order) {
    return jsonError('ההזמנה לא נמצאה', 404);
  }

  // reset: a stuck `processing` order → `failed`. Never to `pending`.
  if (body.action === 'reset') {
    const { data: row, error: updErr } = await admin
      .from('orders')
      .update({ status: 'failed' })
      .eq('id', orderId)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle();
    if (updErr) {
      console.error('[reconcile] reset update failed', { orderId });
      return jsonError('איפוס ההזמנה נכשל', 500);
    }
    if (!row) {
      // Not in a resettable state (e.g. already resolved).
      return NextResponse.json({ reconciled: false, outcome: order.status });
    }
    return NextResponse.json({ reconciled: true, outcome: 'failed' });
  }

  // manual (PATH B): admin verified the charge in SUMIT and supplies the document id.
  // No SUMIT call here. Accept `payment_review` and stuck `processing` orders.
  if (body.action === 'manual') {
    const { data: row, error: updErr } = await admin
      .from('orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        sumit_document_id: body.sumit_document_id,
      })
      .eq('id', orderId)
      .in('status', ['payment_review', 'processing'])
      .select('id')
      .maybeSingle();
    if (updErr) {
      // A duplicate sumit_document_id violates orders_sumit_document_id_unique —
      // surface a generic message, never the DB error detail.
      console.error('[reconcile] manual mark-paid failed', { orderId });
      return jsonError('סימון ההזמנה כשולמה נכשל', 409);
    }
    if (!row) {
      return NextResponse.json({ reconciled: false, outcome: order.status });
    }
    return NextResponse.json({ reconciled: true, outcome: 'paid' });
  }

  // auto (PATH A): requires `payment_review` AND a sumit_document_id to query SUMIT.
  if (order.status !== 'payment_review' || order.sumit_document_id == null) {
    return NextResponse.json({ reconciled: false, outcome: order.status });
  }

  const valid = await fetchSumitPaymentValid(order.sumit_document_id);

  if (valid === null) {
    // Inconclusive — do NOT transition. Marking failed could re-enable a retry on a
    // charge that actually went through.
    console.error('[reconcile] inconclusive SUMIT lookup', { orderId });
    return NextResponse.json({ reconciled: false, outcome: order.status });
  }

  if (valid) {
    const { data: row, error: updErr } = await admin
      .from('orders')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'payment_review')
      .select('id')
      .maybeSingle();
    if (updErr) {
      console.error('[reconcile] auto mark-paid failed', { orderId });
      return jsonError('סימון ההזמנה כשולמה נכשל', 500);
    }
    if (!row) {
      return NextResponse.json({ reconciled: false, outcome: order.status });
    }
    return NextResponse.json({ reconciled: true, outcome: 'paid' });
  }

  // Explicitly invalid payment — safe to mark failed (allows a normal retry).
  const { data: row, error: updErr } = await admin
    .from('orders')
    .update({ status: 'failed' })
    .eq('id', orderId)
    .eq('status', 'payment_review')
    .select('id')
    .maybeSingle();
  if (updErr) {
    console.error('[reconcile] auto mark-failed failed', { orderId });
    return jsonError('עדכון ההזמנה נכשל', 500);
  }
  if (!row) {
    return NextResponse.json({ reconciled: false, outcome: order.status });
  }
  return NextResponse.json({ reconciled: true, outcome: 'failed' });
}
