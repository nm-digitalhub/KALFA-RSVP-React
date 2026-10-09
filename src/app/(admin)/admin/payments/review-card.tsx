'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PaymentReviewProbe } from '@/lib/data/admin/payment-review';
import { TERMINAL_CONFLICT_NOTICE } from '@/lib/payments/terminal-conflict-copy';

import { probePaymentReviewAction, resolvePaymentReviewAction } from './actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

// What a CardCom payment adds to its card, as text (cardcomReviewFacts builds it). Present only for a CardCom row: a SUMIT row's
// card is the one it always was. A CardCom payment is checked in CardCom's own panel - there is no lookup to run from here.
export interface CardcomReviewFacts {
  // Opened on a no-money (test) terminal.
  isTest: boolean;
  // Said out loud when absent: "not recorded" / "not reported".
  terminalOpenedOn: string;
  terminalReported: string;
  // CardCom places the payment on another terminal than the one it was opened on: it cannot be approved as a collection from here.
  reportedConflicts: boolean;
  documentNumber: string | null;
  authRef: string | null;
  paymentId: string | null;
}

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
  cardcom?: CardcomReviewFacts;
}

// The words that name the clearing company's own screen. SUMIT's are the ones the card always had.
const COPY = {
  sumit: {
    verify:
      'לפני שמאשרים: לוודא במסך של SUMIT שהחיוב אכן בוצע (או שלא). הפעולה תקועה כי איש לא יודע — ואין ניסיון חוזר אוטומטי, כדי לא לחייב פעמיים.',
    documentLabel: 'מספר קבלה (מ-SUMIT)',
    noteLabel: 'מה נבדק ב-SUMIT (חובה, לפחות 10 תווים)',
  },
  cardcom: {
    verify:
      'לפני שמאשרים: לוודא בלוח של CardCom שהחיוב אכן בוצע (או שלא), לפי מספר העסקה, מספר האישור והמסמך שלמעלה. הפעולה תקועה כי איש לא יודע — ואין ניסיון חוזר אוטומטי, כדי לא לחייב פעמיים.',
    // On a card that offers no approval (CardCom places the payment on another terminal) the only decision left is "failed".
    verifyBeforeFailing:
      'לפני שמסמנים ככושלת: לבדוק בלוח של CardCom לאן הגיע הכסף, לפי מספר העסקה, מספר האישור והמסמך שלמעלה. הפעולה תקועה כי איש לא יודע — ואין ניסיון חוזר אוטומטי, כדי לא לחייב פעמיים.',
    documentLabel: 'מספר מסמך (מ-CardCom)',
    noteLabel: 'מה נבדק בלוח של CardCom (חובה, לפחות 10 תווים)',
  },
} as const;

function CardcomFacts({ facts }: { facts: CardcomReviewFacts }) {
  const rows: Array<[string, string]> = [
    ['מסוף שבו נפתח התשלום', facts.terminalOpenedOn],
    ['מסוף ש-CardCom דיווחה', facts.terminalReported],
    ['מספר עסקה', facts.paymentId ?? 'לא התקבל'],
    ['מספר אישור', facts.authRef ?? 'לא התקבל'],
    ['מספר מסמך', facts.documentNumber ?? 'לא התקבל'],
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            {/* bdi isolates the value, so a number and a Hebrew placeholder both start on the same side of the column */}
            <dd className="text-start"><bdi>{value}</bdi></dd>
          </div>
        ))}
      </dl>
      {facts.reportedConflicts ? (
        <p role="alert" className="text-sm text-destructive">
          {TERMINAL_CONFLICT_NOTICE}
        </p>
      ) : null}
    </div>
  );
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
  const cardcom = item.cardcom;
  const copy = cardcom ? COPY.cardcom : COPY.sumit;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {item.kindLabel} · {item.amountLabel}
          {item.cardcom?.isTest ? <Badge variant="neutral" className="ms-2 align-middle">תשלום בדיקה</Badge> : null}
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

      {cardcom ? (
        <CardcomFacts facts={cardcom} />
      ) : (
        <form action={probeAction} className="space-y-2">
          <input type="hidden" name="operationId" value={item.operationId} />
          <FormError message={probeState?.error} />
          <SubmitButton className="w-auto" size="sm">
            בדיקה ב-SUMIT
          </SubmitButton>
          {probeState?.probe ? <ProbeResultView probe={probeState.probe} /> : null}
        </form>
      )}

      <form action={resolveAction} className="space-y-3 border-t border-border pt-4">
        <input type="hidden" name="operationId" value={item.operationId} />
        <FormNotice message={state?.notice} />
        <FormError message={state?.error} />
        <p className="text-sm text-amber-700">{cardcom?.reportedConflicts ? COPY.cardcom.verifyBeforeFailing : copy.verify}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`doc-${item.operationId}`} className="mb-1 block text-sm font-medium">
              {copy.documentLabel}
            </label>
            <input
              id={`doc-${item.operationId}`}
              name="documentNumber"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              // CardCom's own answer may already have given the document: it is shown to be confirmed, not typed again.
              defaultValue={cardcom?.documentNumber ?? ''}
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
            {copy.noteLabel}
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
          {/* A payment CardCom places on another terminal cannot be approved as a collection: only "failed", after a look in its panel. */}
          {cardcom?.reportedConflicts ? null : (
            <DecisionButton value="succeeded" variant="default">
              אשר גבייה
            </DecisionButton>
          )}
          <DecisionButton value="failed" variant="outline">
            סמן ככושלת
          </DecisionButton>
        </div>
      </form>
    </section>
  );
}
