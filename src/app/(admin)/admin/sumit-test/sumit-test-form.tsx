'use client';

import { useState } from 'react';
import Script from 'next/script';

declare global {
  interface Window {
    OfficeGuy?: {
      Payments?: {
        BindFormSubmit: (settings: {
          CompanyID: number;
          APIPublicKey?: string;
        }) => void;
      };
    };
  }
}

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
  const [loadError, setLoadError] = useState(false);

  return (
    <>
      {/* jQuery first, then payments.js (same load order as the production
          PaymentForm). On submit payments.js tokenizes the data-og card fields,
          injects a hidden og-token, and submits the whole form (incl. params). */}
      <Script
        src="https://code.jquery.com/jquery-3.7.1.min.js"
        strategy="afterInteractive"
        onLoad={() => {
          const s = document.createElement('script');
          s.src = 'https://app.sumit.co.il/scripts/payments.js';
          s.onload = () => {
            window.OfficeGuy?.Payments?.BindFormSubmit({
              CompanyID: companyId,
              APIPublicKey: apiPublicKey,
            });
            setReady(true);
          };
          s.onerror = () => setLoadError(true);
          document.head.appendChild(s);
        }}
        onError={() => setLoadError(true)}
      />

      <form
        action="/api/admin/sumit-test"
        method="post"
        data-og="form"
        className="max-w-xl space-y-5 rounded-lg border border-border p-4"
      >
        {/* ---- Parameters under test ---- */}
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

        <div className="og-errors text-sm text-red-600" />
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
          disabled={!ready}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {ready ? 'שלח ל-SUMIT והצג תגובה' : 'טוען…'}
        </button>
      </form>
    </>
  );
}
