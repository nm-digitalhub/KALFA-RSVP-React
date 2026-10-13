'use client';

import { useCallback, useRef, useState } from 'react';
import Script from 'next/script';
import { Check, Clock3, LoaderCircle } from 'lucide-react';
import { getCardType, PaymentIcon, type PaymentType } from 'react-svg-credit-card-payment-icons';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

// SUMIT payments.js card form for the package purchase (→ the purchase route).
// jQuery and payments.js both load (in either order — see bind() below), then
// payments.js binds form[data-og=form], tokenizes the card fields, injects a
// hidden `og-token`, and (with our ResponseCallback) hands control back to us so
// we submit natively to the purchase Route Handler. Card fields carry no `name`
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

// The words around the amount. Wording that touches what is charged is reviewed for compliance before it goes live.
export const PURCHASE_COPY = {
  action: (campaignId: string) => `/api/campaigns/${campaignId}/purchase`,
  submit: 'אישור ותשלום',
  dialogTitle: 'מאשרים ומשלמים',
  progressLabel: 'התקדמות התשלום',
  placing: (amount: string) => `מחייבים את הכרטיס בסך ${amount}`,
};

const JQUERY_SRC = 'https://code.jquery.com/jquery-3.7.1.min.js';
const PAYMENTS_SRC = 'https://app.sumit.co.il/scripts/payments.js';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

// Two REAL, event-driven stages — never a fake timer. 'verifying' starts the
// instant the form is submitted (tokenization AJAX to SUMIT is in flight);
// 'placing' starts the instant we call formRef.current.submit() — the browser
// is now genuinely sending that native POST. There is no third client-visible
// stage: the actual charge happens server-side during that POST, and
// the page navigates away (redirect) before any further client state could
// ever observe it completing — showing it as "done" here would be a lie.
type PaymentStage = 'idle' | 'verifying' | 'placing';

const STAGE_STATE_LABEL = {
  done: ' (הושלם)',
  current: ' (בתהליך)',
  pending: ' (ממתין)',
} as const;

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
      <span>
        {label}
        {/* The icons above carry the state visually only. */}
        <span className="sr-only">{STAGE_STATE_LABEL[state]}</span>
      </span>
    </li>
  );
}

export function SumitCardForm({
  campaignId,
  companyId,
  apiPublicKey,
  amount,
}: {
  campaignId: string;
  companyId: number;
  apiPublicKey: string;
  // Display only — the server never reads it: the campaign's fixed package price, which the purchase route reads itself.
  amount: number;
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
  const [stage, setStage] = useState<PaymentStage>('idle');
  const formRef = useRef<HTMLFormElement>(null);
  const copy = PURCHASE_COPY;
  const formattedAmount = formatAmount(amount);

  // Bind once BOTH jQuery and payments.js are available. Driven from the
  // payments.js <Script onReady> — `onReady` (unlike `onLoad`) fires on first
  // load AND after every subsequent component re-mount, so a client-side
  // navigation back to this page re-binds reliably. BindFormSubmit is
  // idempotent — the library's own `og-initialized` guard makes repeat calls
  // safe. jQuery load order isn't guaranteed vs payments.js, so poll briefly
  // until both globals exist.
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
              // actually sending the real charge request, not a guess.
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
          no manual <script> injection. */}
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
        action={copy.action(campaignId)}
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
        <div role="alert" className="og-errors text-sm text-red-600" />

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
              }}
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
          {!ready ? 'טוען…' : submitting ? 'שולח…' : copy.submit}
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
            <DialogTitle>{copy.dialogTitle}</DialogTitle>
            <DialogDescription>הפעולה עשויה להימשך מספר שניות</DialogDescription>
          </DialogHeader>
          <Progress value={null} aria-label={copy.progressLabel} />
          <ol className="divide-y text-start">
            <StageRow
              label="מאמתים פרטי כרטיס מול חברת האשראי"
              state={stage === 'verifying' ? 'current' : 'done'}
            />
            <StageRow
              label={copy.placing(formattedAmount)}
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
