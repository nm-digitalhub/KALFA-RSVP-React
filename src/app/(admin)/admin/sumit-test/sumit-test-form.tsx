'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';

// ============================================================================
// /admin/sumit-test — the SUMIT diagnostic screen.
//
// THE PAGE IS TWO INDEPENDENT <form>s, and which one you want depends on WHERE
// THE CARD COMES FROM. They post to the same route (/api/admin/sumit-test) and
// end up in the same chargeRaw() call; what differs is how the card reaches it.
//
//   FORM 1 — "כרטיס חדש": the operator types a card number.
//     Card inputs carry `data-og="…"` and NO `name`. payments.js (SUMIT's own
//     script) binds `form[data-og=form]`, tokenises those fields IN THE BROWSER
//     against SUMIT, injects `og-token`, and only then do we submit natively.
//     The PAN/CVV therefore never touch our server. Everything else on the form
//     keeps its `name` and posts normally — payments.js only blanks `[data-og]`
//     fields.
//
//   FORM 2 — "טוקן קיים": no card is typed at all. A reusable
//     CreditCard_Token that a past J5 hold already stored is charged, either
//     picked by campaign (resolved server-side, never rendered) or pasted.
//     This form deliberately has NO `data-og="form"`, so payments.js never
//     binds it (its BindFormSubmit selects `form[data-og=form]` only, verified
//     against the live script) and it submits as a plain POST.
//
// WHY THE HEADINGS AND LABELS BELOW ARE WORDED SO LITERALLY. An earlier version
// left form 1 untitled while form 2 was headed "עסקת חיוב", and form 2's token
// field sat under a radio labelled "הזנה ידנית של פרטי החיוב". Someone wanting
// to charge a card they typed reasonably went to form 2 and pasted a REAL PAN
// into the token field; SUMIT answered `Invalid CreditCard_Token (Guid
// expected)` and the full card number landed in the provider's request log.
// Nothing here is decoration: each heading says which form takes a card, and
// each field says exactly what belongs in it.
// ============================================================================

type OgSettings = {
  CompanyID: number;
  APIPublicKey?: string;
  ResponseLanguage?: string;
  ResponseCallback?: (resp: { Status?: number | string }) => void;
};
declare global {
  interface Window {
    jQuery?: unknown;
    OfficeGuy?: {
      Payments?: { BindFormSubmit: (settings: OgSettings) => void };
    };
  }
}

const JQUERY_SRC = 'https://code.jquery.com/jquery-3.7.1.min.js';
const PAYMENTS_SRC = 'https://app.sumit.co.il/scripts/payments.js';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';
const labelClass = 'mb-1 block text-sm font-medium';
const formClass = 'max-w-xl space-y-5 rounded-lg border border-border p-4';
const hintClass = 'text-xs text-muted-foreground';

function FormHeading({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <div className="space-y-1 border-b border-border pb-3">
      <h2 className="text-sm font-semibold">
        טופס {n} · {title}
      </h2>
      <p className={hintClass}>{subtitle}</p>
    </div>
  );
}

type ChargeLine = { name: string; quantity: string; unitPrice: string };

// Items rows editor — shared by both forms.
//
// The operator edits a structured list; it is serialised into ONE hidden JSON
// field, the same controlled-JSON bridge the package form uses, so nobody
// hand-types JSON and the server parses a shape it defined (route.ts
// parseLines).
//
// `unitPrice` accepts a NEGATIVE value on purpose — a credit row is the case
// this editor exists to try against the live gateway. The per-row total and the
// sum are shown live because SUMIT CHARGES THE SUM OF THE ROWS and ignores the
// amount box: an operator who cannot see that sum does not know what the card
// is about to be charged.
//
// `idPrefix` only keeps the two instances' element ids unique. Each instance
// owns its own state; the hidden field is read from whichever form was
// submitted.
function LineItemsEditor({ idPrefix }: { idPrefix: string }) {
  const [lines, setLines] = useState<ChargeLine[]>([]);

  const parsed = lines.map((l) => ({
    name: l.name.trim(),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
  }));
  // Only fully-valid rows are submitted. A half-typed row is not an error to
  // block on — it simply is not sent, and the notice below says so.
  const complete = parsed.filter(
    (l) =>
      l.name !== '' &&
      Number.isFinite(l.quantity) &&
      l.quantity > 0 &&
      Number.isFinite(l.unitPrice),
  );
  const total =
    Math.round(complete.reduce((a, l) => a + l.quantity * l.unitPrice, 0) * 100) / 100;

  function update(i: number, patch: Partial<ChargeLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-2">
      <span className={labelClass}>שורות חיוב (Items) — אופציונלי</span>
      <p className={hintClass}>
        ריק = נשלחת שורה אחת לפי שדה הסכום שלמטה. כשיש שורות —{' '}
        <strong>SUMIT מחייב את סכום השורות ומתעלם משדה הסכום.</strong> מחיר שלילי
        מותר, וכך נבדקת שורת קרדיט.
      </p>

      {lines.map((line, i) => {
        const rowTotal = Number(line.quantity) * Number(line.unitPrice);
        return (
          <div
            key={i}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_5rem_7rem_auto_auto] sm:items-end"
          >
            <div>
              <label className={hintClass}>שם הפריט</label>
              <input
                type="text"
                value={line.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={hintClass}>כמות</label>
              <input
                type="number"
                min="1"
                step="1"
                dir="ltr"
                value={line.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={hintClass}>מחיר ליחידה (₪)</label>
              <input
                type="number"
                step="0.01"
                dir="ltr"
                value={line.unitPrice}
                onChange={(e) => update(i, { unitPrice: e.target.value })}
                className={inputClass}
              />
            </div>
            <span className="pb-2 text-sm tabular-nums" dir="ltr">
              {Number.isFinite(rowTotal) ? `₪${Math.round(rowTotal * 100) / 100}` : '—'}
            </span>
            <button
              type="button"
              onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
              className="pb-2 text-sm text-destructive hover:underline"
            >
              הסרה
            </button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() =>
            setLines((prev) => [...prev, { name: '', quantity: '1', unitPrice: '' }])
          }
          className="text-sm text-primary hover:underline"
        >
          + הוספת שורה
        </button>
        {/* ₪1 amounts on purpose — this hits the LIVE gateway, and the question
            being asked ("does SUMIT accept a negative row?") is answered just as
            well by ₪1 as by ₪200. */}
        <button
          type="button"
          onClick={() =>
            setLines([
              { name: 'דמי הפעלה', quantity: '1', unitPrice: '1' },
              { name: 'אנשי קשר שנענו מעבר לכמות הכלולה', quantity: '2', unitPrice: '1' },
              { name: 'קרדיט', quantity: '1', unitPrice: '-1' },
            ])
          }
          className="text-sm text-primary hover:underline"
        >
          מילוי לדוגמה (כולל שורת קרדיט)
        </button>
        {lines.length > 0 ? (
          <span className="text-sm font-medium" dir="ltr">
            Σ ₪{total}
          </span>
        ) : null}
      </div>

      {lines.length > 0 && complete.length !== lines.length ? (
        <p className="text-xs text-amber-600">
          יש שורה לא מלאה — היא לא תישלח, ואם אף שורה לא תקינה תישלח שורה אחת לפי
          שדה הסכום.
        </p>
      ) : null}
      {lines.length > 0 && complete.length === lines.length && total <= 0 ? (
        <p className="text-xs text-red-600">
          סכום השורות אינו חיובי — הקריאה תידחה אצלנו לפני השליחה ל-SUMIT.
        </p>
      ) : null}

      {/* The controlled JSON bridge — never typed by hand; route.ts parses it. */}
      <input
        type="hidden"
        name="items_json"
        id={`${idPrefix}_items_json`}
        value={JSON.stringify(complete)}
      />
    </div>
  );
}

export function SumitTestForm({
  companyId,
  apiPublicKey,
  chargeableCampaigns = [],
}: {
  companyId: number;
  apiPublicKey: string;
  /** Campaigns whose J5 hold stored a complete card. Labels + ids ONLY — the
   *  token itself is resolved server-side and never reaches this component. */
  chargeableCampaigns?: { campaignId: string; label: string }[];
}) {
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Form 2 only: where its token comes from. Default to the picker when there
  // is anything to pick — it is the path that never puts a live token on screen.
  const [tokenSource, setTokenSource] = useState<'campaign' | 'manual'>(
    chargeableCampaigns.length > 0 ? 'campaign' : 'manual',
  );
  const formRef = useRef<HTMLFormElement>(null);

  // onReady (not onLoad) so a re-mount re-binds; poll until jQuery + payments.js
  // both exist; BindFormSubmit is idempotent (og-initialized guard). See the
  // production hold-form for the full rationale.
  const bind = useCallback(() => {
    let attempts = 0;
    function poll() {
      const bindFormSubmit = window.OfficeGuy?.Payments?.BindFormSubmit;
      if (window.jQuery && bindFormSubmit) {
        bindFormSubmit({
          CompanyID: companyId,
          APIPublicKey: apiPublicKey,
          ResponseLanguage: 'he-IL',
          ResponseCallback: (resp) => {
            if (resp?.Status != 0) {
              setSubmitting(false);
            } else {
              formRef.current?.submit();
            }
          },
        });
        setReady(true);
        return;
      }
      if (++attempts >= 50) {
        setLoadError(true);
        return;
      }
      window.setTimeout(poll, 100);
    }
    poll();
  }, [companyId, apiPublicKey]);

  return (
    <>
      <Script
        src={JQUERY_SRC}
        strategy="afterInteractive"
        onError={() => setLoadError(true)}
      />
      <Script
        src={PAYMENTS_SRC}
        strategy="afterInteractive"
        onReady={() => bind()}
        onError={() => setLoadError(true)}
      />

      {/* ==================================================================
          FORM 1 — a card the operator types. data-og="form" is what makes
          payments.js tokenise it in the browser; without it the PAN would
          post to our server in the clear.
          ================================================================== */}
      <form
        ref={formRef}
        action="/api/admin/sumit-test"
        method="post"
        data-og="form"
        onSubmitCapture={() => setSubmitting(true)}
        className={formClass}
      >
        <FormHeading
          n={1}
          title="כרטיס חדש — הקלדת פרטי כרטיס"
          subtitle="כאן מקלידים מספר כרטיס, תוקף, CVV ות״ז. הכרטיס עובר טוקניזציה בדפדפן מול SUMIT ואינו מגיע לשרת שלנו. מתאים גם לתפיסת מסגרת (J5) וגם לחיוב מיידי (J4)."
        />

        {/* payments.js writes tokenization errors here (.og-errors). */}
        <div className="og-errors text-sm text-red-600" />

        {/* ---- The card itself, FIRST: it is what distinguishes this form.
                data-og fields carry NO `name` — payments.js strips them and
                sends them to SUMIT over its own tokenize AJAX, so nothing
                below ever reaches our POST body. ---- */}
        <div>
          <label htmlFor="cardnumber" className={labelClass}>
            מספר כרטיס
          </label>
          <input
            id="cardnumber"
            data-og="cardnumber"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            maxLength={20}
            className={inputClass}
          />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="expirationmonth" className={labelClass}>
              חודש
            </label>
            <input
              id="expirationmonth"
              data-og="expirationmonth"
              type="text"
              inputMode="numeric"
              placeholder="MM"
              maxLength={2}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="expirationyear" className={labelClass}>
              שנה
            </label>
            <input
              id="expirationyear"
              data-og="expirationyear"
              type="text"
              inputMode="numeric"
              placeholder="YYYY"
              maxLength={4}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="cvv" className={labelClass}>
              CVV
            </label>
            <input
              id="cvv"
              data-og="cvv"
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              maxLength={4}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="citizenid" className={labelClass}>
            תעודת זהות
          </label>
          <input
            id="citizenid"
            data-og="citizenid"
            type="text"
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        <hr className="border-border" />

        {/* ---- Parameters under test. These KEEP their `name`, so they post. ---- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="auto_capture" className={labelClass}>
              סוג עסקה
            </label>
            <select
              id="auto_capture"
              name="auto_capture"
              defaultValue="false"
              className={inputClass}
            >
              <option value="false">J5 — תפיסת מסגרת בלבד (AutoCapture=false)</option>
              <option value="true">J4 — חיוב מיידי (AutoCapture=true)</option>
            </select>
          </div>
          <div>
            <label htmlFor="amount" className={labelClass}>
              סכום (₪) — בשימוש רק כשאין שורות
            </label>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue="1"
              dir="ltr"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="authorize_amount" className={labelClass}>
              AuthorizeAmount (תקרת תפיסה, אופציונלי)
            </label>
            <input
              id="authorize_amount"
              name="authorize_amount"
              type="text"
              inputMode="decimal"
              placeholder="ריק = כסכום"
              dir="ltr"
              className={inputClass}
            />
          </div>
          {/* Blank by default ON PURPOSE. The business is an עוסק פטור and
              production (authorize.ts / capture.ts) sends no VAT field at all —
              a default of 18 made this screen produce a VAT-split document that
              production never produces, so a POC result did not predict
              production behaviour. Left empty, the field is omitted entirely. */}
          <div>
            <label htmlFor="vat_rate" className={labelClass}>
              VATRate (%) — ריק = לא נשלח
            </label>
            <input
              id="vat_rate"
              name="vat_rate"
              type="text"
              inputMode="decimal"
              placeholder="ריק — כמו בייצור (עוסק פטור)"
              dir="ltr"
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="card_token_not_needed" value="true" className="mt-1" />
          <span>
            CardTokenNotNeeded — אל תשמור טוקן כרטיס
            <span className={`block ${hintClass}`}>
              ברירת המחדל היא לשמור. הטוקן שנשמר כאן הוא מה שטופס 2 מחייב אחר כך.
            </span>
          </span>
        </label>

        {/* defaultChecked suits J5, where there is no payment to balance a
            document against. On J4 it must be UNCHECKED or the charge succeeds
            with no receipt — the note says so rather than leaving it to be
            discovered on a live charge. */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="prevent_document_creation"
            value="true"
            defaultChecked
            className="mt-1"
          />
          <span>
            PreventDocumentCreation — אל תיצור מסמך
            <span className={`block ${hintClass}`}>
              מסומן = מתאים ל-J5. <strong>ב-J4 יש לבטל את הסימון</strong>, אחרת
              החיוב יעבור בלי קבלה.
            </span>
          </span>
        </label>

        <LineItemsEditor idPrefix="new_card" />

        <div>
          <label htmlFor="email" className={labelClass}>
            אימייל לקוח (אופציונלי — SendDocumentByEmail)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            className={inputClass}
          />
        </div>

        {loadError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            טעינת מערכת התשלום נכשלה. רעננו את העמוד.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!ready || submitting}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {!ready ? 'טוען…' : submitting ? 'שולח…' : 'שלח כרטיס חדש ל-SUMIT'}
        </button>
      </form>

      {/* ==================================================================
          FORM 2 — an EXISTING token. Deliberately NO data-og="form":
          payments.js's BindFormSubmit selects `form[data-og=form]` only
          (verified against the live script), so this submits as a plain POST
          with no tokenisation step — charging a stored token needs no card
          entry at all.
          ================================================================== */}
      <form
        action="/api/admin/sumit-test"
        method="post"
        className={`mt-6 ${formClass}`}
      >
        <FormHeading
          n={2}
          title="טוקן קיים — בלי הקלדת כרטיס"
          subtitle="לחיוב (J4) של כרטיס שכבר נשמר בתפיסת מסגרת קודמת. אין כאן שדה מספר כרטיס — להקלדת כרטיס השתמשו בטופס 1."
        />

        {/* `token_source` is what route.ts branches on. On "campaign" the
            browser sends only a campaign id and the card is resolved
            server-side, so no live token is ever rendered into the DOM. */}
        <div className="space-y-2">
          <span className={labelClass}>מקור הטוקן</span>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="token_source"
              value="campaign"
              checked={tokenSource === 'campaign'}
              onChange={() => setTokenSource('campaign')}
              disabled={chargeableCampaigns.length === 0}
              className="mt-1"
            />
            <span>
              טוקן של קמפיין קיים (מומלץ)
              <span className={`block ${hintClass}`}>
                {chargeableCampaigns.length > 0
                  ? 'הטוקן נקרא בשרת ואינו מוצג בדפדפן. הקריאה נרשמת ביומן גישה.'
                  : 'אין כרגע קמפיין עם אמצעי תשלום שמור מלא.'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="token_source"
              value="manual"
              checked={tokenSource === 'manual'}
              onChange={() => setTokenSource('manual')}
              className="mt-1"
            />
            <span>
              הדבקת טוקן ידנית
              <span className={`block ${hintClass}`}>
                טוקן (GUID) שהגיע ממקור אחר — <strong>לא מספר כרטיס</strong>.
              </span>
            </span>
          </label>
        </div>

        {tokenSource === 'campaign' ? (
          <div>
            <label htmlFor="campaign_id" className={labelClass}>
              קמפיין
            </label>
            <select
              id="campaign_id"
              name="campaign_id"
              defaultValue=""
              className={inputClass}
            >
              <option value="" disabled>
                בחרו קמפיין…
              </option>
              {chargeableCampaigns.map((c) => (
                <option key={c.campaignId} value={c.campaignId}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Unmounted (not merely hidden) on the picker path, so empty strings
            cannot reach the route and shadow the server-resolved card. */}
        {tokenSource === 'manual' ? (
          <>
            <div>
              <label htmlFor="saved_token" className={labelClass}>
                טוקן שמור (CreditCard_Token)
              </label>
              <input
                id="saved_token"
                name="saved_token"
                type="text"
                dir="ltr"
                placeholder="00000000-0000-0000-0000-000000000000"
                className={inputClass}
              />
              {/* The exact mistake this screen produced once: a PAN pasted here
                  came back `Invalid CreditCard_Token (Guid expected)` — and the
                  full card number was then sitting in SUMIT's request log. */}
              <p className={`mt-1 ${hintClass}`}>
                טוקן בפורמט GUID בלבד. <strong>מספר כרטיס אינו טוקן</strong> —
                SUMIT ידחה אותו, והמספר יישמר בלוג של הספק.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="route_b_exp_month" className={labelClass}>
                  חודש תפוגה
                </label>
                <input
                  id="route_b_exp_month"
                  name="route_b_exp_month"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM"
                  maxLength={2}
                  dir="ltr"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="route_b_exp_year" className={labelClass}>
                  שנת תפוגה
                </label>
                <input
                  id="route_b_exp_year"
                  name="route_b_exp_year"
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY"
                  maxLength={4}
                  dir="ltr"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="route_b_citizen_id" className={labelClass}>
                  ת״ז בעל הכרטיס
                </label>
                <input
                  id="route_b_citizen_id"
                  name="route_b_citizen_id"
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  className={inputClass}
                />
              </div>
            </div>
            {/* CreditCard_CVV lives on the same PaymentMethod object as the
                token, so sending it WITH a token is structurally valid — the
                swagger marks it "Required when CVV is required by credit
                company", i.e. per-issuer. Production charges a stored token
                without it and is verified live, so it stays optional and is
                omitted entirely when blank. */}
            <div>
              <label htmlFor="route_b_cvv" className={labelClass}>
                CVV — רק אם חברת האשראי דורשת אותו יחד עם הטוקן
              </label>
              <input
                id="route_b_cvv"
                name="route_b_cvv"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                dir="ltr"
                className={inputClass}
              />
              <p className={`mt-1 ${hintClass}`}>
                ריק = לא נשלח כלל, כמו בייצור.
              </p>
            </div>
          </>
        ) : null}

        <LineItemsEditor idPrefix="route_b" />

        <div>
          <label htmlFor="route_b_amount" className={labelClass}>
            סכום לחיוב (₪) — בשימוש רק כשאין שורות
          </label>
          <input
            id="route_b_amount"
            name="amount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="route_b_email" className={labelClass}>
            אימייל לקוח (לשליחת המסמך — SendDocumentByEmail)
          </label>
          <input
            id="route_b_email"
            name="email"
            type="email"
            dir="ltr"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          חייב טוקן קיים
        </button>
      </form>
    </>
  );
}
