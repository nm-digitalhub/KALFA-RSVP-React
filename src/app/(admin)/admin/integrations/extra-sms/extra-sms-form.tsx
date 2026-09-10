'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
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

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
