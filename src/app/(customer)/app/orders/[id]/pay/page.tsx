import { getOrder } from '@/lib/data/orders';
import { getPaymentsEnabled, getSumitPublicConfig } from '@/lib/data/payments';
import { formatCurrency } from '@/lib/format';
import { PaymentForm } from './payment-form';

// Fixed, privacy-safe messages for the known error codes the Route Handler may
// redirect back with. Raw SUMIT error text is never surfaced here. Unknown
// codes are ignored (lookup returns undefined). `already_paid` and
// `payment_review` are included for completeness even though those statuses
// render their own branch and never reach the pending/failed form.
const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  token_missing: 'פרטי התשלום חסרים או לא תקינים. נסו שוב.',
  already_paid: 'ההזמנה כבר שולמה.',
  not_payable: 'לא ניתן לשלם על הזמנה זו.',
  already_processing: 'תשלום זה כבר בעיבוד. נסו שוב בעוד רגע.',
  payment_declined: 'התשלום נדחה. בדקו את פרטי הכרטיס ונסו שוב.',
  payment_review: 'התשלום בבדיקה. נציג יחזור אליכם בהקדם.',
  payments_disabled: 'התשלומים אינם זמינים כרגע. נסו שוב מאוחר יותר.',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function PayPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  // getOrder is RLS-scoped to the current user and calls notFound() when the
  // order does not exist or is not owned. Do NOT wrap in try/catch — the
  // notFound()/redirect signals must propagate.
  const order = await getOrder(id);

  if (order.status === 'paid') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">תשלום</h1>
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          ההזמנה שולמה בהצלחה. תודה!
        </p>
      </div>
    );
  }

  if (order.status === 'payment_review') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">תשלום</h1>
        <p
          role="alert"
          className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800"
        >
          התשלום בבדיקה. נציג יחזור אליכם בהקדם. אין צורך לנסות שוב.
        </p>
      </div>
    );
  }

  if (order.status === 'pending' || order.status === 'failed') {
    // Master switch (admin) + non-secret provider config for tokenization.
    // When off or unconfigured, don't render the form — the Route Handler also
    // rejects, so this is just a friendlier surface. The secret key is never
    // read here; only the public company id + public key reach the client.
    const paymentsEnabled = await getPaymentsEnabled();
    const sumitConfig = paymentsEnabled ? await getSumitPublicConfig() : null;
    if (!sumitConfig) {
      return (
        <div className="space-y-6">
          <h1 className="text-2xl font-bold">תשלום</h1>
          <p
            role="status"
            className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
          >
            התשלומים אינם זמינים כרגע. נסו שוב מאוחר יותר.
          </p>
        </div>
      );
    }

    const errorMessage = error
      ? PAYMENT_ERROR_MESSAGES[error]
      : undefined;

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">תשלום</h1>

        <p className="text-lg font-semibold">
          {formatCurrency(order.total_with_vat)}
        </p>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        ) : null}

        <PaymentForm
          orderId={order.id}
          companyId={sumitConfig.companyId}
          apiPublicKey={sumitConfig.apiPublicKey}
        />
      </div>
    );
  }

  // Any other status (e.g. processing, demo) — neutral message, no form.
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">תשלום</h1>
      <p
        role="status"
        className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
      >
        לא ניתן לבצע תשלום על הזמנה זו כעת.
      </p>
    </div>
  );
}
