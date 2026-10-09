'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { feeFromPercent } from '@/lib/data/cancellation-fee';
import type { FormState } from '@/lib/validation/result';
import { formatCurrency } from '../../_components';
import { resolveCancellationRequestAction } from '../actions';

type Resolution = 'full_cancellation' | 'partial_charge' | 'declined';
type FeeMode = 'amount' | 'percent';
// What the server will do with the money when the request is approved — the page decides it from the same facts
// resolveCancellationRequest uses: 'capture' (pre-charge, real SUMIT charge), 'credit' (money was paid and there is a card
// to send it back to, real SUMIT credit), 'manual' (post-charge, no card on file — nothing automatic). A fixed-price
// package adds three: 'none' (nothing was paid, so no money moves), 'blocked' (something was paid but it cannot be
// refunded by itself, so the server refuses any approval that has money to return) and 'resume' (an earlier resolve of
// this request already sent money back and stopped at a later step: an approval finishes it without refunding again).
// 'no_campaign' is the event with no live campaign at all (it never had one, or every campaign was cancelled): no money moves.
export type MoneyOutcome = 'capture' | 'credit' | 'manual' | 'none' | 'blocked' | 'resume' | 'no_campaign';

const BLOCKED_TEXT =
  'לא ניתן להחזיר כסף אוטומטית בקמפיין הזה (אין כרטיס שמור, או שנתוני התשלום לא נקראו). אם יש סכום להחזרה — האישור ייכשל בהודעה ושום דבר לא ישתנה. להמשיך?';

const RESUME_TEXT =
  'כבר הוחזר כסף בבקשה הזו (טיפול קודם שנקטע) — האישור ישלים את הטיפול בלי להחזיר שוב, והלקוח יקבל הודעה לפי מה שהוחזר בפועל, לא לפי מה שהוזן כאן. להמשיך?';

const FULL_CANCELLATION_TEXT: Record<MoneyOutcome, string> = {
  capture: 'לאשר ביטול מלא? לא יבוצע חיוב על הכרטיס.',
  credit: 'לאשר ביטול מלא? יבוצע זיכוי אוטומטי מלא לכרטיס.',
  manual: 'לאשר ביטול מלא? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית ב-SUMIT.',
  none: 'לאשר ביטול מלא? לא שולם דבר בחבילה (או שהכול כבר הוחזר) — לא תהיה תנועה כספית. הקמפיין והאירוע ייסגרו.',
  blocked: BLOCKED_TEXT,
  resume: RESUME_TEXT,
  no_campaign: 'לאשר ביטול מלא? לאירוע אין קמפיין פעיל — לא תהיה תנועה כספית, והאירוע ייסגר.',
};

const PARTIAL_CHARGE_TEXT: Record<MoneyOutcome, string> = {
  capture: 'לאשר חיוב חלקי? יבוצע חיוב אמיתי בסכום שהוזן.',
  credit: 'לאשר חיוב חלקי? יבוצע זיכוי אוטומטי של ההפרש לכרטיס.',
  manual: 'לאשר חיוב חלקי? אין פרטי כרטיס שמורים — לא יבוצע זיכוי אוטומטי, יש להחזיר ידנית ב-SUMIT.',
  none: 'לאשר חיוב חלקי? לא שולם דבר בחבילה, ולכן אין סכום להשאיר אצלנו — האישור ייכשל בהודעה ושום דבר לא ישתנה.',
  blocked: BLOCKED_TEXT,
  resume: RESUME_TEXT,
  no_campaign: 'לאשר חיוב חלקי? לאירוע אין קמפיין פעיל — לא יחויב דבר, אבל הלקוח יקבל הודעה על חיוב בסכום שהוזן. כדי לסגור בלי חיוב בחרו ביטול מלא.',
};

const CONFIRM_TEXT: Record<Resolution, (outcome: MoneyOutcome) => string> = {
  full_cancellation: (outcome) => FULL_CANCELLATION_TEXT[outcome],
  partial_charge: (outcome) => PARTIAL_CHARGE_TEXT[outcome],
  declined: () => 'לדחות את בקשת הביטול?',
};

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
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const [resolution, setResolution] = useState<Resolution>('full_cancellation');
  const [feeMode, setFeeMode] = useState<FeeMode>('amount');
  const [percentText, setPercentText] = useState('');

  const percentMode = feeMode === 'percent' && feeBase > 0;
  const percent = Number(percentText);
  const validPercent = percentText.trim() !== '' && Number.isFinite(percent) && percent > 0 && percent <= 100;
  // The same arithmetic the server uses to decide the real amount, so the preview cannot disagree with it. The browser
  // never sends this number — only the percentage.
  const percentFee = validPercent ? feeFromPercent(feeBase, percent) : null;

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
      action={formAction}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        if (!window.confirm(confirmText())) {
          e.preventDefault();
        }
      }}
    >
      <RadioGroup
        name="resolution"
        value={resolution}
        onValueChange={(v) => setResolution(v as Resolution)}
        className="space-y-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="full_cancellation" />
          ביטול מלא
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="partial_charge" />
          חיוב חלקי
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="declined" />
          דחיית הבקשה
        </label>
      </RadioGroup>

      {resolution === 'partial_charge' ? (
        <div className="space-y-3">
          {feeBase > 0 ? (
            <RadioGroup
              value={feeMode}
              onValueChange={(v) => setFeeMode(v as FeeMode)}
              className="space-y-2"
              aria-label="אופן קביעת הסכום"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="amount" />
                סכום בשקלים
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="percent" />
                {`אחוז מתוך ${feeBaseLabel} (${formatCurrency(feeBase)})`}
              </label>
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
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                step="0.01"
                min="0.01"
                defaultValue={suggestedAmount.toFixed(2)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <FieldError errors={state?.fieldErrors?.resolutionAmount} />
            </div>
          )}
        </div>
      ) : null}

      <div>
        <label htmlFor="resolutionNote" className="mb-1 block text-sm font-medium">
          הודעה ללקוח
        </label>
        <textarea
          id="resolutionNote"
          name="resolutionNote"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <FieldError errors={state?.fieldErrors?.resolutionNote} />
      </div>

      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        אישור הטיפול בבקשה
      </button>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
