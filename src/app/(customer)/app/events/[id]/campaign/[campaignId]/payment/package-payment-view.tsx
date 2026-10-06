import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { PACKAGE_NO_CONTACTS_ERROR } from '@/lib/data/package-activation-errors';
import type { PackagePaymentScreen } from '@/lib/payments/package-payment-screen';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';

import { formatAmount } from '@/lib/format';

import type { FormState } from '@/lib/validation/result';

import { ActivateNowForm } from './activate-now-form';
import { CampaignHoldForm } from './hold-form';

// The payment step of a fixed-price package campaign. Presentational: the page decides WHICH screen
// (packagePaymentScreen, from the ledger) and this only draws it. It never renders the legacy hold summary or the hold
// form wording — a package campaign has no hold. The only start control is the "activate now" fallback for a paid
// campaign whose automatic start was refused.

const UNAVAILABLE_MESSAGE = {
  ledger: PURCHASE_ERROR_MESSAGES.purchase_failed,
  bad_state: PURCHASE_ERROR_MESSAGES.bad_state,
  past: PURCHASE_ERROR_MESSAGES.event_past,
  not_active: PURCHASE_ERROR_MESSAGES.event_not_active,
  disabled: PURCHASE_ERROR_MESSAGES.purchase_disabled,
} as const;

const NOTICE_CLASS = 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning';

export function PackagePaymentView({
  screen,
  errorMessage,
  eventId,
  campaignId,
  formConfig,
  signerName,
  activateAction,
  activateReason = null,
}: {
  screen: PackagePaymentScreen;
  // The sentence for `?error=` (purchaseErrorMessage), shown only above the form.
  errorMessage: string | null;
  eventId: string;
  campaignId: string;
  // The provider's public (non-secret) tokenization configuration. The screen decision already requires it for the
  // form; it is checked again here so a missing one can only ever show a message, never a broken form.
  formConfig: { companyId: number; apiPublicKey: string } | null;
  signerName: string;
  // Starts the campaign from here: the fallback for a payment whose automatic start was refused (the same Server Action
  // as the manage page). Only used when the campaign can be started from this screen.
  activateAction?: (prev: FormState, formData: FormData) => Promise<FormState>;
  // Why the automatic start after the payment was refused (the purchase route's `?activate=`); null = it was not.
  activateReason?: 'no_contacts' | 'failed' | null;
}) {
  switch (screen.kind) {
    case 'paid':
      return (
        <section className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6 text-center">
          <p className="text-2xl font-bold text-success">התשלום התקבל</p>
          <p className="text-sm">שולם {formatAmount(screen.amount)} עבור החבילה.</p>
          {screen.activation === 'active' ? (
            <p className="text-sm">הקמפיין פעיל. הפניות לאורחים יישלחו לפי לוח הזמנים.</p>
          ) : null}
          {screen.activation === 'ready' && activateAction ? (
            <div className="space-y-3 text-start">
              {activateReason ? (
                <p role="alert" className={NOTICE_CLASS}>
                  {activateReason === 'no_contacts'
                    ? PACKAGE_NO_CONTACTS_ERROR
                    : 'הקמפיין עוד לא הופעל אוטומטית. אפשר להפעיל אותו כעת.'}
                </p>
              ) : null}
              <ActivateNowForm action={activateAction} />
            </div>
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
      if (!formConfig) {
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
            <CampaignHoldForm
              purpose="purchase"
              campaignId={campaignId}
              companyId={formConfig.companyId}
              apiPublicKey={formConfig.apiPublicKey}
              amount={screen.amount}
              signerName={signerName}
            />
          </section>
        </div>
      );
  }
}
