'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';

// SUMIT payments.js card form for order payment (J4). jQuery loads first, then
// payments.js binds form[data-og=form], tokenizes the card fields, injects a
// hidden `og-token`, and (with our ResponseCallback) hands control back so we
// submit natively to the Route Handler. Card fields carry no `name` (the library
// reads them via data-og and strips names before submit); CitizenID reaches SUMIT
// via the tokenize AJAX only — never given a `name`, so never POSTed to us.
type OgSettings = {
  CompanyID: number;
  APIPublicKey?: string;
  ResponseLanguage?: string;
  // Supplying ResponseCallback DISABLES the library's own auto-submit; the
  // integrator submits the form. Called on success (Status === 0, token injected)
  // and failure (Status !== 0, error already in .og-errors).
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
  // submitting: tokenization in flight after submit → "שולח…".
  const [submitting, setSubmitting] = useState(false);
  // loadError: jQuery or payments.js failed to load → show error, stay disabled.
  const [loadError, setLoadError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Bind once BOTH jQuery and payments.js are available. Driven from the
  // payments.js <Script onReady> — `onReady` fires on first load AND every
  // subsequent re-mount (unlike `onLoad`, once-only), so client-side navigation
  // back to this page re-binds reliably instead of leaving the button stuck on
  // "טוען…". BindFormSubmit is idempotent (the library's `og-initialized` guard);
  // load order isn't guaranteed, so poll briefly until both globals exist.
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
      {/* jQuery first; both afterInteractive, the bind() poll tolerates either
          load order. next/script dedupes by src — no manual <script> injection. */}
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
        action={`/api/orders/${orderId}/pay`}
        method="post"
        data-og="form"
        onSubmitCapture={() => setSubmitting(true)}
        className="space-y-4"
      >
        {/* payments.js writes tokenization errors here (.og-errors). Above the
            fields, matching the official SUMIT form. */}
        <div className="og-errors text-sm text-red-600" />

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
            maxLength={20}
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
              maxLength={2}
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
              maxLength={4}
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
            maxLength={4}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="citizenid" className="mb-1 block text-sm font-medium">
            תעודת זהות
          </label>
          {/* NO `name` — deliberate; keeps the ID out of the native POST to us.
              Do NOT add one (it would leak PII to our server). */}
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
            טעינת מערכת התשלום נכשלה. נסו לרענן את העמוד.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!ready || submitting}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {!ready ? 'טוען…' : submitting ? 'שולח…' : 'שלם עכשיו'}
        </button>
      </form>
    </>
  );
}
