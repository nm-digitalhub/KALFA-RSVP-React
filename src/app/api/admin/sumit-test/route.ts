import { type NextRequest, NextResponse } from 'next/server';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getSumitServerConfig } from '@/lib/data/payments';
import { escapeHtml as esc } from '@/lib/html';
import { isAllowedOrigin } from '@/lib/http/allowed-origin';
import { chargeRaw, type RawChargeLine } from '@/lib/sumit/raw-charge';
import { resolveSavedCardForCampaign } from '@/lib/data/admin/sumit-test';
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

// SUMIT's own HTTP status is 200 even for a declined/failed business outcome
// (verified live 2026-07-02) — it signals the real result via the JSON body's
// top-level Status (0=Success/1=BusinessError/2=TechnicalError) and
// Data.Payment.ValidPayment, not the HTTP status code. "HTTP status: 200" alone
// is misleading; this mirrors the same success check authorize.ts/capture.ts
// already use, so the page shows the real outcome unambiguously.
function isSumitSuccess(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  const data = r.Data as Record<string, unknown> | null | undefined;
  const payment = data?.Payment as Record<string, unknown> | null | undefined;
  return r.Status === 0 && payment?.ValidPayment === true;
}

// The Items rows the operator typed, synced into one hidden JSON field by the
// form (the same controlled-JSON bridge the package form uses — the admin never
// types raw JSON). Parsed defensively: anything malformed yields NO rows, which
// falls back to the single-line body rather than sending a half-built document.
//
// Deliberately NOT reconciled against the amount field. Production
// (captureHeldCardSumit) refuses a breakdown that does not sum to the computed
// charge; this screen exists to find out what SUMIT accepts, including bodies
// that guard would reject — a negative credit row being the case it was added
// for. SUMIT charges the sum of the rows, so the amount box is ignored whenever
// rows are present.
function parseLines(raw: FormDataEntryValue | null): RawChargeLine[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RawChargeLine[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const quantity = Number(e.quantity);
    const unitPrice = Number(e.unitPrice);
    // A row with no name would reach SUMIT as an item with no IncomeItem.Name,
    // which it rejects with "Missing Item details" — catch it here instead.
    if (!name) return [];
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return [];
    if (quantity <= 0) return [];
    out.push({ name, quantity, unitPrice });
  }
  return out;
}

// SUMIT's own payments.js shows a failure as
// `UserErrorMessage ?? TechnicalErrorDetails` (read from the live script). The
// same pair is what makes a rejection actionable here: the first live itemised
// charge returned Status 1 with every other field null, and the reason —
// "Invalid CreditCard_Token (Guid expected)" — was only findable in SUMIT's own
// request log. Surfaced in the banner rather than left inside the JSON dump,
// because the reason IS the result of a diagnostic run.
function failureReason(summarized: unknown): string | undefined {
  if (summarized === null || typeof summarized !== 'object') return undefined;
  const r = summarized as Record<string, unknown>;
  const user = typeof r.user_error_message === 'string' ? r.user_error_message : '';
  const tech =
    typeof r.technical_error_details === 'string' ? r.technical_error_details : '';
  return user || tech || undefined;
}

function resultPage(opts: {
  title: string;
  httpStatus?: number;
  sent?: unknown;
  response?: unknown;
  error?: string;
  outcome?: 'success' | 'failed';
  /** The provider's own reason for a failure, shown with the banner. */
  reason?: string;
}): NextResponse {
  const block = (label: string, value: unknown) =>
    `<h2 style="font-size:15px;margin:18px 0 6px">${esc(label)}</h2>
     <pre style="background:#0b0b0f;color:#d6e2ff;padding:14px;border-radius:8px;overflow:auto;direction:ltr;text-align:left;font-size:13px;line-height:1.5">${esc(
       typeof value === 'string' ? value : JSON.stringify(value, null, 2),
     )}</pre>`;
  const outcomeBanner =
    opts.outcome === 'success'
      ? '<p style="background:#e6f4ea;color:#1a7431;font-weight:600;padding:10px 14px;border-radius:8px">✅ עסקה אושרה (Status=0, ValidPayment=true)</p>'
      : opts.outcome === 'failed'
        ? `<div style="background:#fdecea;color:#b00020;padding:10px 14px;border-radius:8px">
             <p style="font-weight:600;margin:0">❌ עסקה נדחתה / נכשלה (HTTP status אינו משקף זאת)</p>
             ${
               opts.reason
                 ? `<p style="margin:8px 0 0"><strong>הסיבה מ-SUMIT:</strong> <span dir="ltr" style="display:inline-block;direction:ltr;text-align:left">${esc(opts.reason)}</span></p>`
                 : '<p style="margin:8px 0 0">SUMIT לא החזירה נימוק — ראו את הפרטים למטה.</p>'
             }
           </div>`
        : '';
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SUMIT POC — תוצאה</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:840px;margin:0 auto;padding:24px;color:#16181d">
<h1 style="font-size:20px">תוצאת בדיקת SUMIT</h1>
${opts.error ? `<p style="color:#b00020;font-weight:600">${esc(opts.error)}</p>` : ''}
${outcomeBanner}
${opts.httpStatus != null ? `<p>HTTP status: <strong>${opts.httpStatus}</strong> (סטטוס ה-HTTP של SUMIT — לא משקף בהכרח הצלחה עסקית, ראו את החיווי למעלה)</p>` : ''}
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
    await requirePlatformPermission('manage_billing');
  } catch (err) {
    if (isNextRedirect(err)) return new NextResponse('Forbidden', { status: 403 });
    return new NextResponse('Unexpected error', { status: 500 });
  }

  if (!isAllowedOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const form = await request.formData();
  const ogToken = String(form.get('og-token') ?? '');
  const lines = parseLines(form.get('items_json'));
  let savedToken = String(form.get('saved_token') ?? '').trim();
  let routeBExpMonth = String(form.get('route_b_exp_month') ?? '').trim();
  let routeBExpYear = String(form.get('route_b_exp_year') ?? '').trim();
  let routeBCitizenId = String(form.get('route_b_citizen_id') ?? '').trim();
  let pickedCustomerId: number | undefined;

  // Token PICKER path: the browser posts only a campaign id and the card is
  // resolved here. The token is never rendered, so it cannot be screenshotted,
  // copied out of the DOM or left in browser history — see the module header.
  // The read is audited (fail-closed) inside resolveSavedCardForCampaign.
  if (String(form.get('token_source') ?? '') === 'campaign') {
    const campaignId = String(form.get('campaign_id') ?? '').trim();
    if (!campaignId) {
      return resultPage({ title: 'error', error: 'לא נבחר קמפיין.' });
    }
    let card: Awaited<ReturnType<typeof resolveSavedCardForCampaign>>;
    try {
      card = await resolveSavedCardForCampaign(campaignId);
    } catch {
      // Includes the fail-closed audit path — an unaudited read must not charge.
      return resultPage({
        title: 'error',
        error: 'טעינת אמצעי התשלום של הקמפיין נכשלה — לא בוצעה קריאה ל-SUMIT.',
      });
    }
    if (!card) {
      return resultPage({
        title: 'error',
        error: 'לקמפיין שנבחר אין אמצעי תשלום שמור מלא (טוקן, תוקף ות״ז).',
      });
    }
    savedToken = card.cardToken;
    routeBExpMonth = String(card.expMonth);
    routeBExpYear = String(card.expYear);
    routeBCitizenId = card.citizenId;
    pickedCustomerId = card.sumitCustomerId ?? undefined;
  }
  const amount = String(form.get('amount') ?? '').trim();
  // Empty default, not 18: the business is an עוסק פטור and production sends no
  // VAT field at all. An operator who wants to test WITH a rate types one.
  const vatRate = String(form.get('vat_rate') ?? '').trim();
  // CreditCard_CVV — conditional per issuer (swagger). Never logged, never
  // echoed (safe-preview's allow-list does not read it).
  const routeBCvv = String(form.get('route_b_cvv') ?? '').trim();
  // Route B (saved-token) is a J4 charge by design — its form sends no
  // auto_capture field at all. Default to true when using a saved token;
  // preserve the existing false-default for the new-card path. Omitting this
  // defaulted to a J5 hold while SUMIT still tried to create a real document,
  // producing "mismatch between items sold and payments received" on every
  // live attempt (verified 2026-07-02). An explicit field value always wins.
  const autoCaptureField = form.get('auto_capture');
  const autoCapture =
    autoCaptureField != null
      ? String(autoCaptureField) === 'true'
      : Boolean(savedToken);
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
  // With rows present SUMIT charges their sum and the amount box is unused, so
  // requiring a valid amount there would block a legitimate itemised test.
  if (lines.length === 0) {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return resultPage({ title: 'error', error: 'סכום לא תקין.' });
    }
  } else {
    const sum = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
    if (Math.round(sum * 100) / 100 <= 0) {
      return resultPage({
        title: 'error',
        error: 'סכום השורות חייב להיות חיובי — SUMIT מחייב את סכום השורות, לא את שדה הסכום.',
      });
    }
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
      savedCardCvv: routeBCvv || undefined,
      amount,
      vatRate,
      autoCapture,
      authorizeAmount: authorizeAmount || undefined,
      // checkbox present (="true") → CardTokenNotNeeded:true; absent → omit (SUMIT default saves token)
      cardTokenNotNeeded: cardTokenRaw === 'true' ? true : undefined,
      preventDocumentCreation: preventDocRaw === 'true' ? true : undefined,
      customerEmail: email || undefined,
      externalId: `poc-${Date.now()}`,
      lines: lines.length > 0 ? lines : undefined,
      // Only set by the picker — reuses the hold's SUMIT customer instead of
      // creating a fresh one for every diagnostic charge.
      customerId: pickedCustomerId,
    });
    // Allow-list projection: the raw gateway request/response never reach the
    // browser DOM — only explicitly-approved fields, with token/CitizenID/
    // AuthNumber reduced to booleans (see safe-preview.ts). The outcome banner
    // is derived from result.raw (server-only, never itself displayed) since
    // SUMIT's HTTP status alone doesn't reflect business success/failure.
    const response = summarizeSumitResponse(result.raw);
    const ok = isSumitSuccess(result.raw);
    return resultPage({
      title: 'ok',
      httpStatus: result.httpStatus,
      sent: summarizeSumitRequest(result.sentBody),
      response,
      outcome: ok ? 'success' : 'failed',
      // Read off the ALREADY-projected response, not the raw body — the
      // redaction rules stay the single place that decides what may be shown.
      reason: ok ? undefined : failureReason(response),
    });
  } catch {
    return resultPage({ title: 'error', error: 'הקריאה ל-SUMIT נכשלה (שגיאת תקשורת).' });
  }
}
