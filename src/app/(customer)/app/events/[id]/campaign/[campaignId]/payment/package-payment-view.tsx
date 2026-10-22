import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { type PackagePaymentScreen, SERVICE_STARTING } from '@/lib/payments/package-payment-screen';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';

import { formatAmount } from '@/lib/format';

import { CardcomOpenFieldsForm } from './cardcom-open-fields-form';
import { SumitCardForm } from './sumit-card-form';

// The payment step of a fixed-price package campaign. Presentational: the page decides WHICH screen
// (packagePaymentScreen, from the ledger) and this only draws it. It never offers a start control: a recorded payment
// starts the service by itself (design D23), so a paid service that is not running yet is said to be starting.

const UNAVAILABLE_MESSAGE = {
  ledger: PURCHASE_ERROR_MESSAGES.purchase_failed,
  bad_state: PURCHASE_ERROR_MESSAGES.bad_state,
  past: PURCHASE_ERROR_MESSAGES.event_past,
  not_active: PURCHASE_ERROR_MESSAGES.event_not_active,
  disabled: PURCHASE_ERROR_MESSAGES.purchase_disabled,
} as const;

const NOTICE_CLASS = 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning';

// Staff only in practice: a customer is never offered the test terminal, and test money exists only where it was paid.
const TEST_TERMINAL_NOTICE = 'מסוף בדיקה — לא יחויב כרטיס אמיתי.';
const TEST_MONEY_PAID_NOTICE = 'תשלום בדיקה — לא נגבה כסף ולא נספר בהכנסות.';

export function PackagePaymentView({
  screen,
  errorMessage,
  eventId,
  campaignId,
  formConfig,
  provider = 'sumit',
  googlePayTerminal = null,
  signerName,
  signerEmail = '',
  signerPhone = '',
}: {
  screen: PackagePaymentScreen;
  // The sentence for `?error=` (purchaseErrorMessage), shown only above the form.
  errorMessage: string | null;
  eventId: string;
  campaignId: string;
  // The provider's public (non-secret) tokenization configuration. The screen decision already requires it for the
  // form; it is checked again here so a missing one can only ever show a message, never a broken form.
  formConfig: { companyId: number; apiPublicKey: string } | null;
  // Which clearing company takes the purchase (resolvePurchaseProvider). CardCom's form needs no public configuration.
  provider?: 'sumit' | 'cardcom';
  // The CardCom terminal for the Google Pay frame, or null when Google Pay is not offered to this buyer (decided by the page).
  googlePayTerminal?: number | null;
  signerName: string;
  signerEmail?: string;
  signerPhone?: string;
}) {
  switch (screen.kind) {
    case 'paid':
      return (
        <section className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6 text-center">
          <p className="text-2xl font-bold text-success">התשלום התקבל</p>
          <p className="text-sm">שולם {formatAmount(screen.amount)} עבור החבילה.</p>
          {screen.testMoney ? (
            <p role="status" className={NOTICE_CLASS}>
              {TEST_MONEY_PAID_NOTICE}
            </p>
          ) : null}
          {screen.activation === 'active' ? (
            <p className="text-sm">הקמפיין פעיל. הפניות לאורחים יישלחו לפי לוח הזמנים.</p>
          ) : null}
          {screen.activation === 'starting' ? (
            <p role="status" className="text-sm">
              {SERVICE_STARTING}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href={`/app/events/${eventId}/guests`} className={buttonVariants()}>
              הוספת מוזמנים
            </Link>
            <Link
              href={`/app/events/${eventId}/campaign/${campaignId}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              מעבר לניהול הקמפיין
            </Link>
          </div>
        </section>
      );

    case 'in_progress':
      return (
        <p role="status" className={NOTICE_CLASS}>
          {PURCHASE_ERROR_MESSAGES.purchase_in_progress}
        </p>
      );

    case 'review':
      return (
        <p role="status" className={NOTICE_CLASS}>
          {PURCHASE_ERROR_MESSAGES.purchase_review}
        </p>
      );

    case 'unavailable':
      return (
        <p role="status" className={NOTICE_CLASS}>
          {UNAVAILABLE_MESSAGE[screen.reason]}
        </p>
      );

    case 'form':
      if (provider === 'sumit' && !formConfig) {
        return (
          <p role="status" className={NOTICE_CLASS}>
            {PURCHASE_ERROR_MESSAGES.purchase_disabled}
          </p>
        );
      }
      return (
        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold">פרטי התשלום</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">חבילה</dt>
              <dd>חבילת אישורי הגעה לאירוע</dd>
              <dt className="text-muted-foreground">מחיר</dt>
              <dd>
                <strong>{formatAmount(screen.amount)}</strong>
              </dd>
              <dt className="text-muted-foreground">מתי מתבצע החיוב</dt>
              <dd>עכשיו, בתשלום אחד</dd>
            </dl>
          </section>

          {errorMessage ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          <section className="space-y-4 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">פרטי כרטיס אשראי</h2>
            {screen.testTerminal ? (
              <p role="status" className={NOTICE_CLASS}>
                {TEST_TERMINAL_NOTICE}
              </p>
            ) : null}
            {provider === 'cardcom' ? (
              <CardcomOpenFieldsForm
                eventId={eventId}
                campaignId={campaignId}
                amount={screen.amount}
                defaultName={signerName}
                defaultEmail={signerEmail}
                defaultPhone={signerPhone}
                googlePayTerminal={googlePayTerminal}
              />
            ) : formConfig ? (
              <SumitCardForm
                campaignId={campaignId}
                companyId={formConfig.companyId}
                apiPublicKey={formConfig.apiPublicKey}
                amount={screen.amount}
              />
            ) : null}
          </section>
        </div>
      );
  }
}
