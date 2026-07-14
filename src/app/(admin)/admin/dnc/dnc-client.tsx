'use client';

import { useActionState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { formatIsraelDateTime } from '@/lib/date';
import { addToCallDncAction } from './actions';

type CallDncEntry = {
  normalized_phone: string;
  reason: string | null;
  created_at: string;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 block text-sm font-medium';

export function DncClient({ entries }: { entries: CallDncEntry[] }) {
  const [state, action] = useActionState(addToCallDncAction, null);
  const fieldErrors = state?.fieldErrors;

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />

        <div>
          <label htmlFor="phone" className={labelClass}>
            מספר טלפון
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="05x-xxxxxxx"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            המספר יישמר בצורתו התקנית (E.164) — כל שיחה למספר זה תיחסם.
          </p>
          <FieldError errors={fieldErrors?.phone} />
        </div>

        <div>
          <label htmlFor="reason" className={labelClass}>
            סיבה (רשות)
          </label>
          <input
            id="reason"
            name="reason"
            autoComplete="off"
            placeholder="בקשת הסרה, תלונה וכו׳"
            className={inputClass}
          />
          <FieldError errors={fieldErrors?.reason} />
        </div>

        <SubmitButton className="w-auto">הוספה לרשימת החסימה</SubmitButton>
      </form>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">מספרים חסומים אחרונים</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין מספרים חסומים.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">מספר</th>
                  <th className="px-3 py-2 text-start font-medium">סיבה</th>
                  <th className="px-3 py-2 text-start font-medium">נוסף בתאריך</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.normalized_phone}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono" dir="ltr">
                      {entry.normalized_phone}
                    </td>
                    <td className="px-3 py-2">
                      {entry.reason || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatIsraelDateTime(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
