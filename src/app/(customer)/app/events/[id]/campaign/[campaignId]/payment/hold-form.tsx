'use client';

import { useState } from 'react';
import Script from 'next/script';

// SUMIT payments.js card form for the route-A J5 hold. Mirrors the orders
// PaymentForm: jQuery loads first, then payments.js binds form[data-og=form],
// tokenizes the card fields, injects a hidden `og-token`, and submits natively to
// the authorize Route Handler. Card fields carry no `name` (the library reads
// them via data-og and strips names before submit). CitizenID is required by the
// gateway but never stored by us.
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

export function CampaignHoldForm({
  campaignId,
  companyId,
  apiPublicKey,
}: {
  campaignId: string;
  companyId: number;
  apiPublicKey: string;
}) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  return (
    <>
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
        action={`/api/campaigns/${campaignId}/authorize`}
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
          {ready ? 'אישור ותפיסת מסגרת' : 'טוען…'}
        </button>
      </form>
    </>
  );
}
