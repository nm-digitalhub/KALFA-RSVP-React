'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';

// Admin SUMIT POC form. Same payments.js loading/binding pattern as the
// production forms: jQuery first, payments.js binds form[data-og=form],
// tokenizes the card fields, injects og-token, and (with our ResponseCallback)
// hands control back so we submit natively. The extra POC parameter inputs keep
// their `name` (the library only blanks `[data-og]` fields), so they POST as-is.
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

export function SumitTestForm({
  companyId,
  apiPublicKey,
}: {
  companyId: number;
  apiPublicKey: string;
}) {
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
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

      <form
        ref={formRef}
        action="/api/admin/sumit-test"
        method="post"
        data-og="form"
        onSubmitCapture={() => setSubmitting(true)}
        className="max-w-xl space-y-5 rounded-lg border border-border p-4"
      >
        {/* payments.js writes tokenization errors here (.og-errors). */}
        <div className="og-errors text-sm text-red-600" />

        {/* ---- Parameters under test (keep their name → they POST) ---- */}
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
              <option value="false">J5 — אישור/תפיסה (AutoCapture=false)</option>
              <option value="true">J4 — חיוב מיידי (AutoCapture=true)</option>
            </select>
          </div>
          <div>
            <label htmlFor="amount" className={labelClass}>
              סכום (₪, כולל מע״מ)
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
          <div>
            <label htmlFor="vat_rate" className={labelClass}>
              VATRate (%)
            </label>
            <input
              id="vat_rate"
              name="vat_rate"
              type="text"
              inputMode="decimal"
              defaultValue="18"
              dir="ltr"
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="card_token_not_needed" value="true" />
          <span>
            CardTokenNotNeeded — אל תשמור טוקן כרטיס (ברירת מחדל: שמור, נדרש
            למסלול B)
          </span>
        </label>

        {/* ---- Route B: charge an EXISTING saved token, no new card entry ----
            These fields carry a `name` (unlike the citizenid data-og field below)
            because this is an admin-only diagnostic path re-testing a PAST,
            already-completed transaction — the server has no live SUMIT response
            to pull them from server-side (unlike the production flow, which
            reads CitizenID/expiry back from SUMIT's own authorize response, never
            from the browser). Filling these bypasses the card-entry fields below;
            leave them empty to tokenize a new card instead. */}
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <p className="text-sm font-medium">
            מסלול B — חיוב על טוקן שמור קיים (ללא כרטיס חדש)
          </p>
          <div>
            <label htmlFor="saved_token" className={labelClass}>
              Saved CreditCard_Token
            </label>
            <input
              id="saved_token"
              name="saved_token"
              type="text"
              dir="ltr"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="route_b_exp_month" className={labelClass}>
                חודש תפוגה (חובה)
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
                שנת תפוגה (חובה)
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
                ת״ז בעל הכרטיס (חובה — נדרש בישראל)
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
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="prevent_document_creation"
            value="true"
            defaultChecked
          />
          <span>
            PreventDocumentCreation — אל תיצור מסמך Order (נדרש ל-J5/hold; ב-J4
            בטלו כדי לקבל חשבונית)
          </span>
        </label>

        <div>
          <label htmlFor="email" className={labelClass}>
            אימייל לקוח (אופציונלי)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            className={inputClass}
          />
        </div>

        {/* ---- Card fields (data-og; payments.js tokenizes, strips name) ---- */}
        <hr className="border-border" />
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
          {/* NO `name` — reaches SUMIT via the tokenize AJAX only, never our POST. */}
          <input
            id="citizenid"
            data-og="citizenid"
            type="text"
            inputMode="numeric"
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
          {!ready ? 'טוען…' : submitting ? 'שולח…' : 'שלח ל-SUMIT והצג תגובה'}
        </button>
      </form>
    </>
  );
}
