'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { EditableField } from '@/app/(admin)/admin/_form-fields';

import { updateCardcomConfigAction } from './actions';

export type CardcomConfigFormValues = {
  terminal_number: string;
  api_name: string;
  enabled: boolean;
  /** Whether a password is stored. The password itself is never sent to the form. */
  has_password: boolean;
};

// The CardCom connection: terminal, API name, the API password and the pilot switch.
//
// The password field starts EMPTY on purpose, and a blank submit keeps the stored one: it lives in the vault and is never
// read back into the page, so there is nothing to mask, reveal or leak. The switch is in the same form as the
// credentials (one save to configure one provider); the database refuses to switch the pilot on without a stored
// password, because a pilot that cannot refund must not run.
export function CardcomConfigForm({ values }: { values: CardcomConfigFormValues }) {
  const [state, action] = useActionState(updateCardcomConfigAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <EditableField
        name="terminal_number"
        label="מספר מסוף (TerminalNumber)"
        defaultValue={values.terminal_number}
        inputMode="numeric"
        placeholder="1000"
        hint="מספר שלם חיובי. 1000 הוא מסוף הבדיקות של CardCom — לא מחויב עליו כסף אמיתי."
        errors={e?.terminal_number}
      />

      <EditableField
        name="api_name"
        label="שם API (ApiName)"
        defaultValue={values.api_name}
        hint="נשמר בשרת בלבד ולעולם לא נשלח לדפדפן של הלקוח."
        errors={e?.api_name}
      />

      <EditableField
        name="api_password"
        label="סיסמת API (סודית)"
        defaultValue=""
        maskable
        hint={
          values.has_password
            ? 'שמורה במאגר הסודות. השאירו ריק כדי לשמור את הקיימת; הקלדה מחליפה אותה. משמשת רק להחזרים.'
            : 'עדיין לא נשמרה. משמשת רק להחזרים, ונדרשת כדי להפעיל את CardCom.'
        }
        errors={e?.api_password}
      />

      <label className="flex items-start gap-3">
        <input type="checkbox" name="enabled" defaultChecked={values.enabled} className="mt-1 size-4 accent-primary" />
        <span>
          <span className="block text-sm font-medium">רכישות חבילה עוברות ל-CardCom</span>
          <span className="block text-xs text-muted-foreground">
            כשכבוי — הרכישות נשארות אצל ספק הסליקה הקיים. מצריך סיסמת API שמורה. על מסוף הבדיקות (1000) רק מנהל פלטפורמה יכול לרכוש.
          </span>
        </span>
      </label>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
