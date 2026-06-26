'use client';

import { useState } from 'react';
import Script from 'next/script';

// Minimal typing for the OfficeGuy global injected by payments.js. Only the
// surface we call is declared. APIPublicKey is optional/string because the env
// var reads as string | undefined and the field is passed through as-is.
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

export function PaymentForm({
  orderId,
  companyId,
  apiPublicKey,
}: {
  orderId: string;
  companyId: number;
  apiPublicKey: string;
}) {
  // ready: payments.js loaded + BindFormSubmit ran → submit enabled.
  const [ready, setReady] = useState(false);
  // loadError: jQuery or payments.js failed to load → show error, stay disabled.
  const [loadError, setLoadError] = useState(false);

  return (
    <>
      {/* jQuery is not bundled by payments.js, and afterInteractive scripts have
          no guaranteed load order. So jQuery loads first, then its onLoad
          dynamically injects payments.js and binds the form once jQuery exists. */}
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

      {/* Native form: payments.js binds to form[data-og=form], tokenizes the
          card fields, injects a hidden og-token input, then submits natively to
          the Route Handler. Card fields carry no `name` attribute — the library
          reads them via data-og and removes any name before submit. */}
      <form
        action={`/api/orders/${orderId}/pay`}
        method="post"
        data-og="form"
        className="space-y-4"
      >
        <div>
          <label htmlFor="cardnumber" className="mb-1 block text-sm font-medium">
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
            <label
              htmlFor="expirationmonth"
              className="mb-1 block text-sm font-medium"
            >
              חודש תפוגה
            </label>
            <input
              id="expirationmonth"
              data-og="expirationmonth"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp-month"
              placeholder="MM"
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor="expirationyear"
              className="mb-1 block text-sm font-medium"
            >
              שנת תפוגה
            </label>
            <input
              id="expirationyear"
              data-og="expirationyear"
              type="text"
              inputMode="numeric"
              autoComplete="cc-exp-year"
              placeholder="YYYY"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="cvv" className="mb-1 block text-sm font-medium">
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

        <div>
          <label htmlFor="citizenid" className="mb-1 block text-sm font-medium">
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

        {/* payments.js writes tokenization errors into this element. */}
        <div className="og-errors text-sm text-red-600" />

        {loadError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            טעינת מערכת התשלום נכשלה. נסו לרענן את העמוד.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!ready}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {ready ? 'שלם עכשיו' : 'טוען…'}
        </button>
      </form>
    </>
  );
}
