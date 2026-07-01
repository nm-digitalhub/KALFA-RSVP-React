'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';

// SUMIT payments.js card form for the route-A J5 hold. jQuery loads first, then
// payments.js binds form[data-og=form], tokenizes the card fields, injects a
// hidden `og-token`, and (with our ResponseCallback) hands control back to us so
// we submit natively to the authorize Route Handler. Card fields carry no `name`
// (the library reads them via data-og and strips names before submit); CitizenID
// is required by the gateway and reaches SUMIT via the tokenize AJAX only — it is
// NEVER given a `name`, so it is never POSTed to our server (do not add one).
type OgSettings = {
  CompanyID: number;
  APIPublicKey?: string;
  ResponseLanguage?: string;
  // Supplying ResponseCallback DISABLES the library's own auto-submit; the
  // integrator must submit the form. Called with the tokenize response on both
  // success (Status === 0, token already injected) and failure (Status !== 0,
  // error already written to .og-errors).
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

export function CampaignHoldForm({
  campaignId,
  companyId,
  apiPublicKey,
}: {
  campaignId: string;
  companyId: number;
  apiPublicKey: string;
}) {
  // ready: payments.js loaded + BindFormSubmit ran → submit enabled.
  const [ready, setReady] = useState(false);
  // submitting: tokenization is in flight after the user submitted → show "שולח…".
  const [submitting, setSubmitting] = useState(false);
  // loadError: jQuery or payments.js failed to load → show error, stay disabled.
  const [loadError, setLoadError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Bind once BOTH jQuery and payments.js are available. Driven from the
  // payments.js <Script onReady> — `onReady` (unlike `onLoad`) fires on first
  // load AND after every subsequent component re-mount, so a client-side
  // navigation back to this page re-binds reliably. (The previous onLoad-only
  // approach left the button stuck on "טוען…" on re-mount because setReady never
  // re-ran.) BindFormSubmit is idempotent — the library's own `og-initialized`
  // guard makes repeat calls safe. jQuery load order isn't guaranteed vs
  // payments.js, so poll briefly until both globals exist.
  const bind = useCallback(() => {
    let attempts = 0;
    function poll() {
      const bindFormSubmit = window.OfficeGuy?.Payments?.BindFormSubmit;
      if (window.jQuery && bindFormSubmit) {
        bindFormSubmit({
          CompanyID: companyId,
          APIPublicKey: apiPublicKey,
          ResponseLanguage: 'he-IL', // Content-Language → Hebrew tokenize errors
          ResponseCallback: (resp) => {
            // Mirror the library's own success test (`0 != e.Status`): a numeric
            // Status of 0 is success (the hidden og-token was already injected),
            // so submit natively — a clean POST that carries the token and does
            // NOT re-enter the OfficeGuy submit handler. Anything else is a
            // tokenization failure; the reason is already in .og-errors, so just
            // release the button for a fix + retry.
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
        // ~5s elapsed and jQuery/payments.js never both appeared.
        setLoadError(true);
        return;
      }
      window.setTimeout(poll, 100);
    }
    poll();
  }, [companyId, apiPublicKey]);

  return (
    <>
      {/* jQuery is not bundled by payments.js. Both load afterInteractive; the
          bind() poll tolerates either load order. next/script dedupes by src, so
          no manual <script> injection (the old code appended one to <head> on
          every render). */}
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
        action={`/api/campaigns/${campaignId}/authorize`}
        method="post"
        data-og="form"
        // Capture phase fires before the library's bubble-phase submit handler
        // (which stops propagation), so this reliably flips to "שולח…" for both a
        // button click and Enter-to-submit.
        onSubmitCapture={() => setSubmitting(true)}
        className="space-y-4"
      >
        {/* payments.js writes tokenization errors into this element (.og-errors).
            Placed above the fields, matching the official SUMIT form. */}
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
          {/* NO `name` attribute — deliberate. The library reads it via data-og
              and sends it to SUMIT in the tokenize AJAX only; without a `name` it
              is never included in the native POST to our server (PII stays out of
              our request). Do NOT add a `name` here. */}
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
          {!ready ? 'טוען…' : submitting ? 'שולח…' : 'אישור ותפיסת מסגרת'}
        </button>
      </form>
    </>
  );
}
