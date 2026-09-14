'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { EditableField } from '@/app/(admin)/admin/_form-fields';

import { updateExtraSmsAction } from './actions';

// Credentials + the SMS switch for ExtrA.
//
// This form is not a move — it is a RESTORATION. Task 0.2 split the provider
// credentials out of settings-form.tsx and built the DAL pair for them, but the
// "הודעות" tab went with it and nothing replaced the UI, so between 0.2 and this
// commit the ExtrA token and sender could not be edited from the panel at all.
//
// `sms_enabled` sits in the same form as the credentials on purpose: it is this
// provider's own switch, not the global outreach master, and separating them would
// mean two saves to configure one channel. The DAL keeps `configured` credentials-only
// regardless, so switching SMS off never makes the card read "not configured" — the
// display bug that motivated the split in the first place.

export type ExtraSmsFormValues = {
  sms_enabled: boolean;
  extra_sms_sender: string;
  extra_sms_token: string;
  callback_intake_sms_enabled: boolean;
  callback_intake_sms_daily_cap: number;
};

export function ExtraSmsForm({ values }: { values: ExtraSmsFormValues }) {
  const [state, action] = useActionState(updateExtraSmsAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="sms_enabled"
          defaultChecked={values.sms_enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">שליחת SMS מופעלת</span>
          <span className="block text-xs text-muted-foreground">
            כשכבוי — קוד ההתחברות (OTP), הודעת ביטול אירוע, תזמון חזרה וקישור ההרשמה
            למכירות אינם נשלחים. הפרטים נשמרים כפי שהם.
          </span>
        </span>
      </label>

      <EditableField
        name="extra_sms_sender"
        label="שולח (Sender ID)"
        defaultValue={values.extra_sms_sender}
        placeholder="03-3301505"
        hint="חייב להיות verified ID מאומת בחשבון ExtrA עם הרשאת sms_sender. אימות מתבצע בפורטל בלבד — אין לכך API."
        errors={e?.extra_sms_sender}
      />

      <EditableField
        name="extra_sms_token"
        label="מפתח API"
        defaultValue={values.extra_sms_token}
        maskable
        hint="נוצר ב-/my/api/ בפורטל ExtrA. המפתח פותח את כל החשבון — הוא נשמר בשרת בלבד ולעולם לא נרשם ללוג."
        errors={e?.extra_sms_token}
      />

      <fieldset className="space-y-3 rounded-lg border border-input p-3">
        <legend className="px-1 text-sm font-medium">טופס פרטים לשיחה שלא נענתה</legend>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="callback_intake_sms_enabled"
            defaultChecked={values.callback_intake_sms_enabled}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block text-sm font-medium">שליחת קישור לטופס אחרי שיחה שלא נענתה</span>
            <span className="block text-xs text-muted-foreground">
              כשמישהו מתקשר ואין נציג זמין, נשלח לו SMS עם קישור אישי למילוי שם וסיבת הפנייה.
              בלעדיו השיחה החוזרת יוצאת בלי שם ובלי נושא. כשכבוי — הבקשה עדיין נוצרת והשיחה
              החוזרת עדיין מתבצעת, רק ה-SMS לא נשלח.
            </span>
          </span>
        </label>

        <div className="grid gap-1.5">
          <label htmlFor="callback_intake_sms_daily_cap" className="text-sm font-medium">
            תקרה יומית
          </label>
          <input
            id="callback_intake_sms_daily_cap"
            name="callback_intake_sms_daily_cap"
            type="number"
            min={0}
            max={10000}
            step={1}
            defaultValue={values.callback_intake_sms_daily_cap}
            className="min-h-11 w-32 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            מספר ההודעות המרבי ליום (לפי היום האזרחי בישראל). כל שיחה שלא נענתה עולה שליחה
            אחת, ולכן מבול שיחות נכנסות הוא הוצאה — התקרה הופכת את המקרה הגרוע למספר ידוע.
            0 עוצר את השליחה כמו כיבוי המתג.
          </p>
          <FieldError errors={e?.callback_intake_sms_daily_cap} />
        </div>
      </fieldset>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
