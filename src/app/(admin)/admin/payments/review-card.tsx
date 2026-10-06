'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PaymentReviewProbe } from '@/lib/data/admin/payment-review';

import { probePaymentReviewAction, resolvePaymentReviewAction } from './actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

// What the admin sees about one payment operation that is waiting for a decision (see payment-review.ts). Preformatted
// strings come from the page so this component stays a pure form.
export interface ReviewCardItem {
  operationId: string;
  kindLabel: string;
  amount: number;
  amountLabel: string;
  recordedAtLabel: string;
  eventName: string;
  eventHref: string;
  campaignHref: string;
  note: string | null;
}

// "Could not ask" must never read like "no payment": an unreachable provider is not evidence that a card was not charged.
const UNAVAILABLE: Record<string, string> = {
  credentials: 'אין גישה ל-SUMIT (פרטי החיבור חסרים או נדחו). זו אינה תשובה של "אין תשלום" — יש לבדוק במסך של SUMIT.',
  provider_error: 'SUMIT דיווחה על תקלה. זו אינה תשובה של "אין תשלום" — יש לבדוק במסך של SUMIT.',
  unexpected_response: 'SUMIT החזירה תשובה לא מוכרת. זו אינה תשובה של "אין תשלום" — יש לבדוק במסך של SUMIT.',
  unreachable: 'לא ניתן להגיע ל-SUMIT כרגע. זו אינה תשובה של "אין תשלום" — יש לבדוק במסך של SUMIT.',
  too_many_pages: 'יש יותר מדי תשלומים בטווח לבדיקה אוטומטית. יש לבדוק במסך של SUMIT.',
  unsupported: 'הבדיקה האוטומטית מתאימה רק לחיוב שנגבה. יש לבדוק במסך של SUMIT.',
};

export function ProbeResultView({ probe }: { probe: PaymentReviewProbe }) {
  return (
    <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1">
      {probe.kind === 'found' ? (
        <>
          <p className="font-medium">נמצא תשלום תואם ב-SUMIT ({probe.matches.length}):</p>
          <ul className="list-disc ps-5">
            {probe.matches.map((m, i) => (
              <li key={m.paymentId ?? i} dir="ltr" className="text-start">
                {m.amount.toFixed(2)} ₪ · {m.date ?? '—'} · אישור {m.authNumber ?? '—'}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            זו הצעה בלבד. מספר הקבלה אינו מוחזר מהחיפוש — יש לקרוא אותו במסך של SUMIT ולהקליד אותו למטה.
          </p>
        </>
      ) : probe.kind === 'not_found' ? (
        <p>
          לא נמצא תשלום תואם בטווח של יום לפני ויום אחרי. עדיין כדאי לאמת במסך של SUMIT לפני שמסמנים ככושלת.
        </p>
      ) : (
        <p>{UNAVAILABLE[probe.reason] ?? 'הבדיקה לא זמינה.'}</p>
      )}
    </div>
  );
}

// A submit button that carries the decision in its own name/value, so one form offers two outcomes.
function DecisionButton({
  value,
  variant,
  children,
}: {
  value: 'succeeded' | 'failed';
  variant: 'default' | 'outline';
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="outcome" value={value} variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

export function ReviewCard({ item }: { item: ReviewCardItem }) {
  const [probeState, probeAction] = useActionState(probePaymentReviewAction, null);
  const [state, resolveAction] = useActionState(resolvePaymentReviewAction, null);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {item.kindLabel} · {item.amountLabel}
        </h2>
        <p className="text-sm text-muted-foreground">
          {item.eventName} · נפתחה {item.recordedAtLabel}
        </p>
        {item.note ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
        <p className="flex gap-4 text-sm">
          <a href={item.eventHref} className="text-primary underline-offset-4 hover:underline">
            אירוע
          </a>
          <a href={item.campaignHref} className="text-primary underline-offset-4 hover:underline">
            קמפיין
          </a>
        </p>
      </header>

      <form action={probeAction} className="space-y-2">
        <input type="hidden" name="operationId" value={item.operationId} />
        <FormError message={probeState?.error} />
        <SubmitButton className="w-auto" size="sm">
          בדיקה ב-SUMIT
        </SubmitButton>
        {probeState?.probe ? <ProbeResultView probe={probeState.probe} /> : null}
      </form>

      <form action={resolveAction} className="space-y-3 border-t border-border pt-4">
        <input type="hidden" name="operationId" value={item.operationId} />
        <FormNotice message={state?.notice} />
        <FormError message={state?.error} />
        <p className="text-sm text-amber-700">
          לפני שמאשרים: לוודא במסך של SUMIT שהחיוב אכן בוצע (או שלא). הפעולה תקועה כי איש לא יודע — ואין ניסיון חוזר
          אוטומטי, כדי לא לחייב פעמיים.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`doc-${item.operationId}`} className="mb-1 block text-sm font-medium">
              מספר קבלה (מ-SUMIT)
            </label>
            <input
              id={`doc-${item.operationId}`}
              name="documentNumber"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              className={inputClass}
              aria-describedby={`doc-err-${item.operationId}`}
            />
            <FieldError id={`doc-err-${item.operationId}`} errors={state?.fieldErrors?.documentNumber} />
          </div>
          <div>
            <label htmlFor={`amt-${item.operationId}`} className="mb-1 block text-sm font-medium">
              סכום שנגבה בפועל (אם שונה)
            </label>
            <input
              id={`amt-${item.operationId}`}
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              placeholder={`${item.amount} — ריק פירושו כמתוכנן`}
              className={inputClass}
            />
            <FieldError errors={state?.fieldErrors?.amount} />
          </div>
        </div>

        <div>
          <label htmlFor={`note-${item.operationId}`} className="mb-1 block text-sm font-medium">
            מה נבדק ב-SUMIT (חובה, לפחות 10 תווים)
          </label>
          <Textarea
            id={`note-${item.operationId}`}
            name="note"
            required
            minLength={10}
            maxLength={500}
            rows={2}
          />
          <FieldError errors={state?.fieldErrors?.note} />
          <FieldError errors={state?.fieldErrors?.outcome} />
        </div>

        <div className="flex flex-wrap gap-2">
          <DecisionButton value="succeeded" variant="default">
            אשר גבייה
          </DecisionButton>
          <DecisionButton value="failed" variant="outline">
            סמן ככושלת
          </DecisionButton>
        </div>
      </form>
    </section>
  );
}
