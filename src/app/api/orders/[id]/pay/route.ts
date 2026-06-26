import { type NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/dal';
import { getOrder } from '@/lib/data/orders';
import { getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import { chargeSumit, SumitDeclinedError } from '@/lib/sumit/charge';
import { payPendingOrderSchema } from '@/lib/validation/schemas';

const ERROR = {
  TOKEN_MISSING:      'token_missing',
  ALREADY_PAID:       'already_paid',
  NOT_PAYABLE:        'not_payable',
  ALREADY_PROCESSING: 'already_processing',
  PAYMENT_DECLINED:   'payment_declined',
  PAYMENT_REVIEW:     'payment_review',
  PAYMENTS_DISABLED:  'payments_disabled',
} as const;

// APP_ORIGIN is a server-only env var — never NEXT_PUBLIC_.
// No silent fallback: a missing security variable must be a hard error.
// localhost:3002 is added ONLY in development — never in production.
function isAllowedOrigin(request: NextRequest): boolean {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN env var is not configured');
  const allowed = new Set([appOrigin]);
  if (process.env.NODE_ENV === 'development') allowed.add('http://localhost:3002');

  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin);

  // Fallback: extract origin from Referer (browser sends this even without Origin).
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch { return false; }
  }

  // Both absent — deny. OWASP recommends fail-closed.
  return false;
}

function r303(url: URL) {
  return NextResponse.redirect(url, 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  // CSRF: fail-closed — no valid Origin or Referer → 403.
  if (!isAllowedOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Auth
  let user: Awaited<ReturnType<typeof requireUser>>;
  try { user = await requireUser(); }
  catch { return r303(new URL('/auth/login', request.url)); }

  // Validate og-token from SUMIT
  const formData = await request.formData();
  const parsed = payPendingOrderSchema.safeParse({
    order_id: orderId,
    'og-token': formData.get('og-token'),
  });
  if (!parsed.success) {
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.TOKEN_MISSING}`, request.url));
  }

  // Load order (user client, RLS-scoped)
  let order: Awaited<ReturnType<typeof getOrder>>;
  try { order = await getOrder(orderId); }
  catch { return r303(new URL('/app/orders', request.url)); }

  if (order.status === 'paid') {
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.ALREADY_PAID}`, request.url));
  }
  if (order.status !== 'pending' && order.status !== 'failed') {
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.NOT_PAYABLE}`, request.url));
  }

  // Master switch + provider config (admin-managed, server-side only). Enforced
  // here — never rely on the hidden "שלם עכשיו" button alone. Both checked
  // before the lock so a disabled/unconfigured feature leaves the order
  // untouched. The secret api key is read here and never leaves the server.
  if (!(await getPaymentsEnabled())) {
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.PAYMENTS_DISABLED}`, request.url));
  }
  const sumitConfig = await getSumitServerConfig();
  if (!sumitConfig) {
    console.error('[payment] enabled but SUMIT config missing', { orderId });
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.PAYMENTS_DISABLED}`, request.url));
  }

  // Atomic lock: (pending|failed) → processing.
  // Returns total_with_vat + vat_rate so the charge uses the locked row's values,
  // not the pre-loaded order (prevents TOCTOU on price between read and charge).
  const admin = createAdminClient();
  const { data: locked, error: lockErr } = await admin
    .from('orders')
    .update({
      status: 'processing',
      payment_attempt_ref: crypto.randomUUID(),
      payment_processing_started_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('user_id', user.id)
    .in('status', ['pending', 'failed'])
    .select('payment_attempt_ref, total_with_vat, vat_rate')
    .single();

  if (lockErr || !locked) {
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.ALREADY_PROCESSING}`, request.url));
  }

  const paymentAttemptRef = locked.payment_attempt_ref;

  // Validate amounts from locked row before calling SUMIT.
  const totalWithVat = parseFloat(String(locked.total_with_vat));
  const vatRate = parseFloat(String(locked.vat_rate));
  if (!Number.isFinite(totalWithVat) || totalWithVat <= 0 || !Number.isFinite(vatRate)) {
    console.error('[payment] invalid amount on locked order', { orderId, totalWithVat });
    await admin.from('orders')
      .update({ status: 'failed' })
      .eq('id', orderId).eq('user_id', user.id)
      .eq('status', 'processing').eq('payment_attempt_ref', paymentAttemptRef);
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.NOT_PAYABLE}`, request.url));
  }

  // Charge SUMIT.
  let documentId: number;
  try {
    ({ documentId } = await chargeSumit({
      companyId: sumitConfig.companyId,
      apiKey: sumitConfig.apiKey,
      ogToken: parsed.data['og-token'],
      totalWithVat: String(totalWithVat),  // validated float from locked row
      vatRate: String(vatRate),            // validated float from locked row
      paymentAttemptRef,
      customerEmail: user.email ?? '',
    }));
  } catch (err) {
    if (err instanceof SumitDeclinedError) {
      // Definitive decline from SUMIT (Status.IsError=true in 2xx) — safe to allow retry.
      console.error('[payment] charge declined', { orderId, paymentAttemptRef });
      await admin.from('orders')
        .update({ status: 'failed' })
        .eq('id', orderId).eq('user_id', user.id)
        .eq('status', 'processing').eq('payment_attempt_ref', paymentAttemptRef);
      return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.PAYMENT_DECLINED}`, request.url));
    }
    // Unknown outcome (SumitNetworkError, unexpected throw, parse failure, etc.) — block retry.
    // Only SumitDeclinedError is a verified decline; everything else is ambiguous.
    console.error('[payment] unknown charge outcome', { orderId, paymentAttemptRef, err });
    await admin.from('orders')
      .update({ status: 'payment_review' })
      .eq('id', orderId).eq('user_id', user.id)
      .eq('status', 'processing').eq('payment_attempt_ref', paymentAttemptRef);
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.PAYMENT_REVIEW}`, request.url));
  }

  // Mark paid — filter by payment_attempt_ref so we only update the exact attempt we locked.
  // Use .select('id').maybeSingle() to detect 0-row updates (SQL success ≠ row updated).
  const { data: paidRow, error: paidErr } = await admin.from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), sumit_document_id: documentId })
    .eq('id', orderId)
    .eq('user_id', user.id)
    .eq('status', 'processing')
    .eq('payment_attempt_ref', paymentAttemptRef)
    .select('id')
    .maybeSingle();

  if (paidErr || !paidRow) {
    // Charge succeeded but DB update failed or matched 0 rows (race condition).
    console.error('[payment] paid DB update failed after successful charge', {
      orderId, paymentAttemptRef, documentId, paidErr,
    });
    // Move to review — do NOT retry; charge already happened.
    // MUST save documentId here — reconciliation path A requires sumit_document_id to call
    // /billing/payments/get/. Without it, only manual reconciliation (path B) is possible.
    await admin.from('orders')
      .update({ status: 'payment_review', sumit_document_id: documentId })
      .eq('id', orderId)
      .eq('payment_attempt_ref', paymentAttemptRef);
    return r303(new URL(`/app/orders/${orderId}/pay?error=${ERROR.PAYMENT_REVIEW}`, request.url));
  }

  return r303(new URL('/app/orders?paid=1', request.url));
}
