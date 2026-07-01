import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/dal';
import { getSumitServerConfig } from '@/lib/data/payments';
import { chargeRaw } from '@/lib/sumit/raw-charge';
import {
  summarizeSumitRequest,
  summarizeSumitResponse,
} from '@/lib/sumit/safe-preview';

// Admin-only SUMIT POC: tokenize a card (payments.js, client) → POST a charge
// with admin-chosen params (J4/J5, AuthorizeAmount, CardTokenNotNeeded) → render
// a REDACTED safe preview of the request/response (allow-list projection via
// safe-preview.ts) so we can verify live behavior before building the production
// J5 / saved-token flow. The raw gateway body (token/CitizenID/AuthNumber) never
// reaches the browser DOM and is never logged.

function isNextRedirect(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function isAllowedOrigin(request: NextRequest): boolean {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN env var is not configured');
  const allowed = new Set([appOrigin]);
  if (process.env.NODE_ENV === 'development') allowed.add('http://localhost:3002');
  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin);
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resultPage(opts: {
  title: string;
  httpStatus?: number;
  sent?: unknown;
  response?: unknown;
  error?: string;
}): NextResponse {
  const block = (label: string, value: unknown) =>
    `<h2 style="font-size:15px;margin:18px 0 6px">${esc(label)}</h2>
     <pre style="background:#0b0b0f;color:#d6e2ff;padding:14px;border-radius:8px;overflow:auto;direction:ltr;text-align:left;font-size:13px;line-height:1.5">${esc(
       typeof value === 'string' ? value : JSON.stringify(value, null, 2),
     )}</pre>`;
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SUMIT POC — תוצאה</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:840px;margin:0 auto;padding:24px;color:#16181d">
<h1 style="font-size:20px">תוצאת בדיקת SUMIT</h1>
${opts.error ? `<p style="color:#b00020;font-weight:600">${esc(opts.error)}</p>` : ''}
${opts.httpStatus != null ? `<p>HTTP status: <strong>${opts.httpStatus}</strong></p>` : ''}
${opts.sent != null ? block('הבקשה שנשלחה (תצוגה בטוחה — טוקנים מוסתרים)', opts.sent) : ''}
${opts.response != null ? block('תגובת SUMIT (תצוגה בטוחה — טוקן/ת״ז/AuthNumber מוסתרים)', opts.response) : ''}
<p style="margin-top:24px"><a href="/admin/sumit-test" style="color:#4338ca">← חזרה לטופס</a></p>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    if (isNextRedirect(err)) return new NextResponse('Forbidden', { status: 403 });
    return new NextResponse('Unexpected error', { status: 500 });
  }

  if (!isAllowedOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const form = await request.formData();
  const ogToken = String(form.get('og-token') ?? '');
  const savedToken = String(form.get('saved_token') ?? '').trim();
  const routeBExpMonth = String(form.get('route_b_exp_month') ?? '').trim();
  const routeBExpYear = String(form.get('route_b_exp_year') ?? '').trim();
  const routeBCitizenId = String(form.get('route_b_citizen_id') ?? '').trim();
  const amount = String(form.get('amount') ?? '').trim();
  const vatRate = String(form.get('vat_rate') ?? '18').trim();
  const autoCapture = String(form.get('auto_capture') ?? 'false') === 'true';
  const authorizeAmount = String(form.get('authorize_amount') ?? '').trim();
  const cardTokenRaw = form.get('card_token_not_needed');
  const preventDocRaw = form.get('prevent_document_creation');
  const email = String(form.get('email') ?? '').trim();

  if (!ogToken && !savedToken) {
    return resultPage({
      title: 'error',
      error: 'חסר טוקן: הזינו פרטי כרטיס (og-token) או טוקן שמור.',
    });
  }
  // Route B (saved-token charge): CitizenID is mandatory for Israeli-issued
  // cards (verified live; swagger.json's own field description confirms it's
  // required per-issuer — true for Israel), and expiry accompanies the token
  // the same way capture.ts sends it. Reject BEFORE calling SUMIT with an
  // incomplete PaymentMethod, rather than surface its rejection.
  if (savedToken && !routeBCitizenId) {
    return resultPage({
      title: 'error',
      error: 'חיוב על טוקן שמור (מסלול B) דורש ת״ז בעל הכרטיס — שדה חובה בישראל.',
    });
  }
  if (savedToken && (!routeBExpMonth || !routeBExpYear)) {
    return resultPage({
      title: 'error',
      error: 'חיוב על טוקן שמור (מסלול B) דורש תוקף כרטיס (חודש ושנה) — שדה חובה.',
    });
  }
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return resultPage({ title: 'error', error: 'סכום לא תקין.' });
  }

  const config = await getSumitServerConfig();
  if (!config) {
    return resultPage({ title: 'error', error: 'הגדרות SUMIT חסרות (company id / api key) ב-app_settings.' });
  }

  try {
    const result = await chargeRaw({
      companyId: config.companyId,
      apiKey: config.apiKey,
      ogToken: ogToken || undefined,
      savedCardToken: savedToken || undefined,
      savedCardExpMonth: routeBExpMonth ? parseInt(routeBExpMonth, 10) : undefined,
      savedCardExpYear: routeBExpYear ? parseInt(routeBExpYear, 10) : undefined,
      savedCardCitizenId: routeBCitizenId || undefined,
      amount,
      vatRate,
      autoCapture,
      authorizeAmount: authorizeAmount || undefined,
      // checkbox present (="true") → CardTokenNotNeeded:true; absent → omit (SUMIT default saves token)
      cardTokenNotNeeded: cardTokenRaw === 'true' ? true : undefined,
      preventDocumentCreation: preventDocRaw === 'true' ? true : undefined,
      customerEmail: email || undefined,
      externalId: `poc-${Date.now()}`,
    });
    // Allow-list projection: the raw gateway request/response never reach the
    // browser DOM — only explicitly-approved fields, with token/CitizenID/
    // AuthNumber reduced to booleans (see safe-preview.ts).
    return resultPage({
      title: 'ok',
      httpStatus: result.httpStatus,
      sent: summarizeSumitRequest(result.sentBody),
      response: summarizeSumitResponse(result.raw),
    });
  } catch {
    return resultPage({ title: 'error', error: 'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת).' });
  }
}
