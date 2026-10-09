'use client';

import { useActionState, useRef, useState } from 'react';
import { Ban, CircleAlert, Hourglass, LoaderCircle, Mail, Percent, RotateCcw, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';

import { FieldError, FormNotice } from '@/components/forms';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { feeFromPercent } from '@/lib/data/cancellation-fee';
import type { ResolveFormState, RetryAdvice } from '@/lib/data/package-cancellation';
import { cn } from '@/lib/utils';
import { formatCurrency } from '../../_components';
import { resolveCancellationRequestAction } from '../actions';

type Resolution = 'full_cancellation' | 'partial_charge' | 'declined';
type FeeMode = 'amount' | 'percent';
// What the server will do with the money when the request is approved — the page decides it from the same facts
// resolveCancellationRequest uses: 'capture' (pre-charge, a real charge), 'credit' (money was paid and it can go back to
// the card by itself), 'manual' (post-charge, no card on file — nothing automatic). A fixed-price package adds three:
// 'none' (nothing was paid, so no money moves), 'blocked' (something was paid but it cannot be refunded by itself, so the
// server refuses any approval that has money to return) and 'resume' (an earlier resolve of this request already sent
// money back and stopped at a later step: an approval finishes it without refunding again). 'no_campaign' is the event
// with no live campaign at all (it never had one, or every campaign was cancelled): no money moves.
export type MoneyOutcome = 'capture' | 'credit' | 'manual' | 'none' | 'blocked' | 'resume' | 'no_campaign';

const BLOCKED_TEXT =
  'לא ניתן להחזיר כסף אוטומטית בקמפיין הזה (אין כרטיס שמור, אין מסמך זיכוי אוטומטי לסוג המסמך, או שנתוני התשלום לא נקראו). אם יש סכום להחזרה — האישור ייכשל בהודעה ושום דבר לא ישתנה. להמשיך?';

const RESUME_TEXT =
  'כבר הוחזר כסף בבקשה הזו (טיפול קודם שנקטע) — האישור ישלים את הטיפול בלי להחזיר שוב, והלקוח יקבל הודעה לפי מה שהוחזר בפועל, לא לפי מה שהוזן כאן. להמשיך?';

const FULL_CANCELLATION_TEXT: Record<MoneyOutcome, string> = {
  capture: 'לאשר ביטול מלא? לא יבוצע חיוב על הכרטיס.',
  credit: 'לאשר ביטול מלא? יבוצע זיכוי אוטומטי מלא לכרטיס, והלקוח יקבל מייל אחרי שהזיכוי אושר.',
  manual: 'לאשר ביטול מלא? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית במסוף הסליקה.',
  none: 'לאשר ביטול מלא? לא שולם דבר בחבילה (או שהכול כבר הוחזר) — לא תהיה תנועה כספית. הקמפיין והאירוע ייסגרו.',
  blocked: BLOCKED_TEXT,
  resume: RESUME_TEXT,
  no_campaign: 'לאשר ביטול מלא? לאירוע אין קמפיין פעיל — לא תהיה תנועה כספית, והאירוע ייסגר.',
};

const PARTIAL_CHARGE_TEXT: Record<MoneyOutcome, string> = {
  capture: 'לאשר ביטול עם דמי ביטול? יבוצע חיוב אמיתי בסכום שהוזן.',
  credit: 'לאשר ביטול עם דמי ביטול? יבוצע זיכוי אוטומטי של ההפרש לכרטיס, והלקוח יקבל מייל אחרי שהזיכוי אושר.',
  manual: 'לאשר ביטול עם דמי ביטול? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית במסוף הסליקה.',
  none: 'לאשר ביטול עם דמי ביטול? לא שולם דבר בחבילה, ולכן אין סכום להשאיר אצלנו — האישור ייכשל בהודעה ושום דבר לא ישתנה.',
  blocked: BLOCKED_TEXT,
  resume: RESUME_TEXT,
  no_campaign: 'לאשר ביטול עם דמי ביטול? לאירוע אין קמפיין פעיל — לא יחויב דבר, אבל הלקוח יקבל הודעה על חיוב בסכום שהוזן. כדי לסגור בלי חיוב בחרו ביטול מלא.',
};

const CONFIRM_TEXT: Record<Resolution, (outcome: MoneyOutcome) => string> = {
  full_cancellation: (outcome) => FULL_CANCELLATION_TEXT[outcome],
  partial_charge: (outcome) => PARTIAL_CHARGE_TEXT[outcome],
  declined: () => 'לדחות את בקשת הביטול?',
};

// What each choice does, said next to it (linked with aria-describedby, so the radio's own name stays the choice).
const CHOICES: ReadonlyArray<{ value: Resolution; label: string; hint: string; Icon: LucideIcon }> = [
  { value: 'full_cancellation', label: 'ביטול מלא', hint: 'הבקשה מאושרת במלואה, והקמפיין והאירוע נסגרים.', Icon: RotateCcw },
  { value: 'partial_charge', label: 'ביטול עם דמי ביטול', hint: 'נגבים דמי ביטול בלבד; מה ששולם מעבר להם חוזר ללקוח.', Icon: Percent },
  { value: 'declined', label: 'דחיית הבקשה', hint: 'שום דבר לא משתנה. הלקוח מקבל את ההודעה שלכם.', Icon: Ban },
];

// The fee's three amounts beside the field — shown only where money goes BACK (a refund, or a credit of a charged
// campaign): what was paid, the fee that stays, and what returns to the card. For a pre-charge capture the typed amount is
// a charge, and "returns to the card" would be false, so they are not shown there.
function FeeCubes({ paid, fee }: { paid: number; fee: number | null }) {
  const refund = fee == null ? null : Math.round((paid - fee) * 100) / 100;
  return (
    <dl role="status" className="grid grid-cols-3 gap-2 text-sm">
      <div className="rounded-lg bg-card px-3 py-2.5">
        <dt className="text-muted-foreground">שולם</dt>
        <dd className="font-bold">{formatCurrency(paid)}</dd>
      </div>
      <div className="rounded-lg bg-card px-3 py-2.5">
        <dt className="text-muted-foreground">דמי ביטול</dt>
        <dd className="font-bold">{fee == null ? '—' : formatCurrency(fee)}</dd>
      </div>
      <div className="rounded-lg bg-card px-3 py-2.5 outline-2 outline-primary">
        <dt className="text-muted-foreground">יוחזר לכרטיס</dt>
        <dd className="font-bold text-primary">{refund == null ? 'הזינו סכום תקין' : formatCurrency(refund)}</dd>
      </div>
    </dl>
  );
}

// A failed resolve, shown above the form in the tone of what may be done next (RetryAdvice): approve again once the
// cause is fixed; do NOT approve again (the money may already be back); or wait for the attempt that is still running.
// Without advice (a validation or other failure) it is the plain error.
const RETRY_LOOK: Record<RetryAdvice, { title: string; className: string; Icon: typeof CircleAlert }> = {
  allowed: { title: 'לא בוצע — אפשר לנסות שוב', className: 'border-destructive/40 bg-destructive/10 text-destructive', Icon: CircleAlert },
  forbidden: { title: 'אל תאשרו שוב', className: 'border-warning/40 bg-warning/10 text-warning', Icon: TriangleAlert },
  wait: { title: 'ממתין לסיום ניסיון קודם', className: 'border-border bg-muted text-foreground', Icon: Hourglass },
};
function ResolveError({ message, retry }: { message: string; retry?: RetryAdvice }) {
  const look = RETRY_LOOK[retry ?? 'allowed'];
  return (
    <Alert className={cn('px-4 py-3', look.className)}>
      <look.Icon aria-hidden />
      {retry ? <AlertTitle className="font-semibold">{look.title}</AlertTitle> : null}
      <AlertDescription className="text-current">{message}</AlertDescription>
    </Alert>
  );
}

// The confirmation is a dialog, not window.confirm. It is portaled outside the form, so its confirm button submits the
// form explicitly (requestSubmit). Every other way the form can be submitted — Enter in the amount or percent field —
// goes through onSubmit, which opens the dialog instead: nothing reaches the server without the confirmation. While the
// server works (useActionState's `pending`) the button and the dialog's confirm are locked, so a second click cannot send
// a second resolve. The result is shown above the form.
export function ResolveForm({
  requestId,
  suggestedAmount,
  moneyOutcome,
  feeBase,
  feeBaseLabel,
}: {
  requestId: string;
  suggestedAmount: number;
  moneyOutcome: MoneyOutcome;
  // What a percentage fee is taken of — decided by the server (cancellationFeeBase), 0 when there is none, in which case
  // only an amount can be typed. The label says what the base is ("הסכום שחויב" / "תקרת הקמפיין").
  feeBase: number;
  feeBaseLabel: string;
}) {
  const action = resolveCancellationRequestAction.bind(null, requestId);
  const [state, formAction, pending] = useActionState<ResolveFormState, FormData>(action, null);
  const [resolution, setResolution] = useState<Resolution>('full_cancellation');
  const [feeMode, setFeeMode] = useState<FeeMode>('amount');
  const [percentText, setPercentText] = useState('');
  const [amountText, setAmountText] = useState(suggestedAmount.toFixed(2));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);

  const percentMode = feeMode === 'percent' && feeBase > 0;
  const percent = Number(percentText);
  const validPercent = percentText.trim() !== '' && Number.isFinite(percent) && percent > 0 && percent <= 100;
  // The same arithmetic the server uses to decide the real amount, so the preview cannot disagree with it. The browser
  // never sends this number — only the percentage.
  const percentFee = validPercent ? feeFromPercent(feeBase, percent) : null;
  const amount = Number(amountText);
  const validAmount = amountText.trim() !== '' && Number.isFinite(amount) && amount > 0;
  // Money goes back: the fee must leave something to return. The server decides for real; this only keeps a clearly
  // impossible fee from being sent.
  const refundsMoney = (moneyOutcome === 'credit' || moneyOutcome === 'resume') && feeBase > 0;
  const fee = percentMode ? percentFee : validAmount ? Math.round(amount * 100) / 100 : null;
  const feeImpossible =
    resolution === 'partial_charge' && moneyOutcome !== 'resume' && (fee == null || (refundsMoney && fee >= feeBase));

  function confirmText(): string {
    const base = CONFIRM_TEXT[resolution](moneyOutcome);
    // A resumed resolve ignores the fee typed now (the ledger decides), so the text must not repeat it as if it applied.
    if (resolution === 'partial_charge' && percentMode && percentFee != null && moneyOutcome !== 'resume') {
      return `${base}\nדמי הביטול: ${percent}% מתוך ${formatCurrency(feeBase)} = ${formatCurrency(percentFee)}.`;
    }
    return base;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-labelledby="resolve-heading"
      className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6"
      onSubmit={(e) => {
        if (confirmedRef.current) {
          confirmedRef.current = false;
          return;
        }
        e.preventDefault();
        if (!pending && !feeImpossible) setConfirmOpen(true);
      }}
    >
      {state?.error ? <ResolveError message={state.error} retry={state.retry} /> : null}
      <FormNotice message={state?.notice} />

      <h2 id="resolve-heading" className="text-lg font-semibold">
        ההחלטה
      </h2>

      <fieldset className="space-y-2.5">
        <legend className="mb-2.5 text-sm text-muted-foreground">מה עושים עם הבקשה?</legend>
        <RadioGroup
          name="resolution"
          value={resolution}
          onValueChange={(v) => setResolution(v as Resolution)}
          className="grid gap-2.5 md:grid-cols-3 lg:grid-cols-1"
        >
          {CHOICES.map((c) => {
            const hintId = `resolution-hint-${c.value}`;
            const selected = resolution === c.value;
            return (
              <div
                key={c.value}
                className={cn(
                  'rounded-[10px] border px-4 py-3.5 transition-colors',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/40',
                )}
              >
                {/* The label holds the choice's name only, so the radio is announced as the choice; the hint is linked to
                    it with aria-describedby. */}
                <label className="flex cursor-pointer items-center gap-3 text-[15px] font-semibold">
                  <RadioGroupItem value={c.value} aria-describedby={hintId} />
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-[9px]',
                      selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/80',
                    )}
                  >
                    <c.Icon className="size-[18px]" />
                  </span>
                  {c.label}
                </label>
                <p id={hintId} className="ms-[4.75rem] mt-1 text-sm leading-relaxed text-muted-foreground md:ms-0 md:mt-2 lg:ms-[4.75rem] lg:mt-1">
                  {c.hint}
                </p>
              </div>
            );
          })}
        </RadioGroup>
      </fieldset>

      {resolution === 'partial_charge' ? (
        <div className="space-y-3 rounded-lg bg-muted p-4">
          {feeBase > 0 ? (
            <RadioGroup
              value={feeMode}
              onValueChange={(v) => setFeeMode(v as FeeMode)}
              className="flex w-fit flex-wrap gap-1 rounded-[9px] bg-foreground/[0.06] p-1"
              aria-label="אופן קביעת הסכום"
            >
              {(
                [
                  ['amount', 'סכום בשקלים'],
                  ['percent', `אחוז מתוך ${feeBaseLabel} (${formatCurrency(feeBase)})`],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-[7px] px-3.5 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
                    feeMode === value ? 'bg-card font-semibold shadow-sm' : 'font-medium text-foreground/75',
                  )}
                >
                  <RadioGroupItem value={value} className="sr-only" />
                  {label}
                </label>
              ))}
            </RadioGroup>
          ) : null}

          {percentMode ? (
            <div>
              <label htmlFor="resolutionPercent" className="mb-1 block text-sm font-medium">
                אחוז (%)
              </label>
              <input
                id="resolutionPercent"
                name="resolutionPercent"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0.1"
                max="100"
                required
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                className="h-11 w-full max-w-56 rounded-md border border-input bg-background px-3 text-base"
              />
              {percentFee != null ? (
                <p role="status" className="mt-1 text-sm text-muted-foreground">
                  {`דמי ביטול: ${formatCurrency(percentFee)} (${percent}% מתוך ${formatCurrency(feeBase)})`}
                </p>
              ) : null}
              <FieldError errors={state?.fieldErrors?.resolutionPercent} />
            </div>
          ) : (
            <div>
              <label htmlFor="resolutionAmount" className="mb-1 block text-sm font-medium">
                {moneyOutcome === 'capture'
                  ? 'סכום לחיוב (₪) — מוצע לפי מדיניות דמי הביטול, ניתן לעריכה'
                  : 'סכום שנשאר אצלנו (₪) — ההפרש יוחזר ללקוח; מוצע לפי מדיניות דמי הביטול, ניתן לעריכה'}
              </label>
              <input
                id="resolutionAmount"
                name="resolutionAmount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="h-11 w-full max-w-56 rounded-md border border-input bg-background px-3 text-base"
              />
              <FieldError errors={state?.fieldErrors?.resolutionAmount} />
            </div>
          )}
          {refundsMoney && moneyOutcome !== 'resume' ? <FeeCubes paid={feeBase} fee={fee} /> : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="resolutionNote" className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <Mail aria-hidden className="size-4 shrink-0" />
          הודעה ללקוח (נשלחת במייל)
        </label>
        <textarea
          id="resolutionNote"
          name="resolutionNote"
          rows={3}
          placeholder="תישלח ללקוח במייל יחד עם ההחלטה"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
        />
        <FieldError errors={state?.fieldErrors?.resolutionNote} />
      </div>

      {/* On a phone the button stays in reach at the bottom of the screen while the form scrolls (the same single button). */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-5 max-sm:-mb-5 max-sm:rounded-b-xl max-sm:bg-card max-sm:px-5 max-sm:pb-5 max-sm:shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <Button type="submit" size="lg" disabled={pending || feeImpossible} className="h-12 w-full gap-2 sm:w-auto">
          {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <ShieldCheck aria-hidden className="size-[18px]" />}
          {pending ? 'מבצע את הטיפול…' : 'אישור הטיפול בבקשה'}
        </Button>
        <p className="text-xs text-muted-foreground max-sm:w-full max-sm:text-center" aria-live="polite">
          {pending
            ? 'הכפתור נעול עד שהטיפול יסתיים.'
            : feeImpossible
              ? refundsMoney
                ? 'דמי הביטול חייבים להיות גדולים מ-0 וקטנים ממה ששולם.'
                : 'הזינו סכום גדול מ-0.'
              : 'לפני הביצוע יוצג סיכום לאישור.'}
        </p>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* Below sm the same dialog sits at the bottom of the screen, full width, as a sheet (thumb reach); from sm up it is
            the centred dialog. Only classes on the existing component — no second component. */}
        <AlertDialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:data-[size=default]:max-w-none">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור הטיפול בבקשה</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{confirmText()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>חזרה לטופס</AlertDialogCancel>
            <AlertDialogAction
              variant={resolution === 'declined' ? 'default' : 'destructive'}
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                confirmedRef.current = true;
                formRef.current?.requestSubmit();
              }}
            >
              אישור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
