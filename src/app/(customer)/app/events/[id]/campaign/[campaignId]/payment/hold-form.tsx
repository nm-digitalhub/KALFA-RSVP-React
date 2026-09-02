'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';
import { Check, Clock3, LoaderCircle } from 'lucide-react';
import { getCardType, PaymentIcon, type PaymentType } from 'react-svg-credit-card-payment-icons';
import { CreditCard, type Focused } from 'react-credit-cards-library';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

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

// Real embossed cards keep the first and last name in full and abbreviate any
// middle name(s) — issuers vary on how many letters (commonly a single
// initial; some use more, matching the 3-letter middle abbreviation on the
// actual card the KALFA owner checked this against). Display-only: this
// never touches what SUMIT tokenizes or what reaches our server.
export function formatCardholderName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ').toUpperCase();
  const [first, ...rest] = parts;
  const last = rest.pop() as string;
  const middles = rest.map((m) => m.slice(0, 3));
  return [first, ...middles, last].join(' ').toUpperCase();
}

// Two REAL, event-driven stages — never a fake timer. 'verifying' starts the
// instant the form is submitted (tokenization AJAX to SUMIT is in flight);
// 'placing' starts the instant we call formRef.current.submit() — the browser
// is now genuinely sending that native POST. There is no third client-visible
// stage: the actual hold placement happens server-side during that POST, and
// the page navigates away (redirect) before any further client state could
// ever observe it completing — showing it as "done" here would be a lie.
type HoldStage = 'idle' | 'verifying' | 'placing';

function StageRow({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'current' | 'pending';
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 py-2 text-sm',
        state === 'pending' && 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          state === 'done' && 'bg-success/15 text-success',
          state === 'current' && 'bg-primary/10 text-primary',
          state === 'pending' && 'bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' && <Check className="size-4" aria-hidden="true" />}
        {state === 'current' && (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        )}
        {state === 'pending' && <Clock3 className="size-4" aria-hidden="true" />}
      </span>
      <span>{label}</span>
    </li>
  );
}

export function CampaignHoldForm({
  campaignId,
  companyId,
  apiPublicKey,
  holdAmount,
  signerName,
}: {
  campaignId: string;
  companyId: number;
  apiPublicKey: string;
  // The J5 amount that will actually be held (previewCampaignHoldSizing) — NOT
  // the charge ceiling, which can be larger once the list exceeds coverage.
  holdAmount: number;
  // Read-only, for the card preview only — SUMIT never needs a name-on-card
  // field (customerName is sent server-side from the profile), so this adds
  // no new input and collects nothing new from the user.
  signerName: string;
}) {
  // ready: payments.js loaded + BindFormSubmit ran → submit enabled.
  const [ready, setReady] = useState(false);
  // submitting: tokenization is in flight after the user submitted → show "שולח…".
  const [submitting, setSubmitting] = useState(false);
  // loadError: jQuery or payments.js failed to load → show error, stay disabled.
  const [loadError, setLoadError] = useState(false);
  // cardType: live-detected brand from the (uncontrolled) card number field, for
  // the inline icon only — reading the DOM value on change never touches what
  // payments.js itself reads via data-og, so it can't affect tokenization.
  const [cardType, setCardType] = useState<PaymentType>('Generic');
  const [stage, setStage] = useState<HoldStage>('idle');
  // Live visual preview (react-credit-cards-library) — reads the same
  // uncontrolled fields via onChange/onFocus, same as cardType above: no
  // value= on the underlying inputs, so payments.js's data-og read is
  // unaffected. expMonth/expYear are ours to combine — SUMIT still gets them
  // as two separate fields exactly as before, this is display-only.
  const [previewNumber, setPreviewNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [previewCvc, setPreviewCvc] = useState('');
  const [previewFocus, setPreviewFocus] = useState<Focused>('');
  const previewExpiry = expMonth && expYear ? `${expMonth.padStart(2, '0')}/${expYear.slice(-2)}` : '';
  const formRef = useRef<HTMLFormElement>(null);
  const formattedHold = holdAmount.toLocaleString('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  });

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
              setStage('idle');
            } else {
              // Genuinely true the instant this fires — the browser is now
              // actually sending the real hold-placement request, not a guess.
              setStage('placing');
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

      {/* dir="ltr" is required here — the card's internal number/expiry rows
          are flex layouts, and flex-direction:row visually reverses under an
          inherited RTL context, flipping the digit-group ORDER (each group's
          own digits stayed correct — verified against the raw input value —
          only the group order flipped, the signature of RTL flex reversal,
          not a data bug). A card face is always read LTR regardless of the
          page language, so this is the correct fix, not a workaround. */}
      <div dir="ltr" className="mb-5 hidden justify-center sm:flex">
        <CreditCard
          number={previewNumber}
          name={formatCardholderName(signerName)}
          expiry={previewExpiry}
          cvc={previewCvc}
          focus={previewFocus}
        />
      </div>

      <form
        ref={formRef}
        action={`/api/campaigns/${campaignId}/authorize`}
        method="post"
        data-og="form"
        // Capture phase fires before the library's bubble-phase submit handler
        // (which stops propagation), so this reliably flips to "שולח…" for both a
        // button click and Enter-to-submit.
        onSubmitCapture={() => {
          setSubmitting(true);
          setStage('verifying');
        }}
        className="space-y-4"
      >
        {/* payments.js writes tokenization errors into this element (.og-errors).
            Placed above the fields, matching the official SUMIT form. */}
        <div className="og-errors text-sm text-red-600" />

        <div>
          <label htmlFor="cardnumber" className="mb-1 block text-sm font-medium">
            מספר כרטיס
          </label>
          <div className="relative">
            <input
              id="cardnumber"
              data-og="cardnumber"
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              maxLength={20}
              className={`${inputClass} pe-14`}
              onChange={(e) => {
                setCardType(getCardType(e.target.value));
                setPreviewNumber(e.target.value);
              }}
              onFocus={() => setPreviewFocus('number')}
            />
            <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center">
              <PaymentIcon type={cardType} format="flatRounded" width={32} aria-hidden="true" />
            </span>
          </div>
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
              onChange={(e) => setExpMonth(e.target.value)}
              onFocus={() => setPreviewFocus('expiry')}
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
              onChange={(e) => setExpYear(e.target.value)}
              onFocus={() => setPreviewFocus('expiry')}
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
            onChange={(e) => setPreviewCvc(e.target.value)}
            onFocus={() => setPreviewFocus('cvc')}
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

      {/* Non-dismissible while a stage is active — driven ONLY by `stage`
          (never by the Dialog's own open/close), and disablePointerDismissal
          blocks an outside click; onOpenChange is intentionally omitted so an
          escape-key attempt is simply ignored. */}
      <Dialog open={stage !== 'idle'} disablePointerDismissal modal>
        <DialogContent showCloseButton={false} dir="rtl" className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          </div>
          <DialogHeader className="items-center text-center">
            <DialogTitle>מאשרים ותופסים את המסגרת</DialogTitle>
            <DialogDescription>הפעולה עשויה להימשך מספר שניות</DialogDescription>
          </DialogHeader>
          <Progress value={null} aria-label="התקדמות אישור ותפיסת המסגרת" />
          <ol className="divide-y text-start">
            <StageRow
              label="מאמתים פרטי כרטיס מול חברת האשראי"
              state={stage === 'verifying' ? 'current' : 'done'}
            />
            <StageRow
              label={`תופסים מסגרת אשראי בסך ${formattedHold}`}
              state={stage === 'placing' ? 'current' : 'pending'}
            />
          </ol>
          <p className="text-xs text-muted-foreground">
            אין לרענן או לסגור את העמוד עד לסיום הפעולה.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
