'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { EditableField } from '@/app/(admin)/admin/_form-fields';
import type { GooglePayMode } from '@/lib/cardcom/google-pay-mode';

import { updateCardcomConfigAction } from './actions';

// The three positions of the Google Pay setting, in the order an operator moves through them: nobody, only people who may
// configure the integration (the real-money acceptance), everybody.
export const GOOGLE_PAY_OPTIONS: ReadonlyArray<{ value: GooglePayMode; label: string; hint: string }> = [
  { value: 'off', label: 'כבוי', hint: 'אף לקוח לא רואה Google Pay. טופס הכרטיס נשאר כפי שהוא.' },
  { value: 'admins', label: 'מנהלים בלבד', hint: 'רק מי שמורשה לנהל את האינטגרציה רואה Google Pay. כך מריצים את בדיקת ה-₪1 האמיתית בלי לחשוף לקוחות.' },
  { value: 'all', label: 'כולם', hint: 'כל קונה שהרכישה שלו עוברת ל-CardCom רואה Google Pay.' },
];

export type CardcomConfigFormValues = {
  terminal_number: string;
  api_name: string;
  enabled: boolean;
  save_card_on_purchase: boolean;
  /** Who is offered Google Pay on the payment form. */
  google_pay_mode: GooglePayMode;
  /** Whether a password is stored. The password itself is never sent to the form. */
  has_password: boolean;
  /** Whether the document report secret is stored. The secret itself is never sent to the form. */
  has_document_report_secret: boolean;
  /** The address to enter in CardCom's document report settings. */
  document_report_url: string;
};

// The CardCom connection: terminal, API name, the API password, the document report secret and the pilot switch.
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

      {/* CardCom posts every issued document to our webhook. The post is not signed: what proves it is CardCom's is this
          secret, which CardCom appends to each report. Same handling as the password: empty, and blank keeps it. */}
      <EditableField
        name="document_report_secret"
        label="סוד לדיווח מסמכים (סודי)"
        defaultValue=""
        maskable
        hint={`${
          values.has_document_report_secret
            ? 'שמור במאגר הסודות. השאירו ריק כדי לשמור את הקיים; הקלדה מחליפה אותו.'
            : 'עדיין לא נשמר. בלעדיו כל דיווח מסמך מ-CardCom נדחה.'
        } 24–128 אותיות באנגלית וספרות. ב-CardCom, תחת "הגדרות מסמכים בממשקים": כתובת URL לדיווח ${values.document_report_url}, ובמחרוזת תוספת לפנייה secret=<אותו סוד>.`}
        errors={e?.document_report_secret}
      />

      <label className="flex items-start gap-3">
        <input type="checkbox" name="enabled" defaultChecked={values.enabled} className="mt-1 size-4 accent-primary" />
        <span>
          <span className="block text-sm font-medium">רכישות חבילה עוברות ל-CardCom</span>
          <span className="block text-xs text-muted-foreground">
            כשכבוי — הרכישות נשארות אצל ספק הסליקה הקיים. מצריך סיסמת API שמורה. על מסוף הבדיקות (1000) רק מנהל פלטפורמה יכול לרכוש, חוץ משרת שמחובר למסד נתונים מקומי, שבו כל לקוח יכול.
          </span>
        </span>
      </label>

      {/* The save-card switch (12.10.2026): flips the purchase operation between ChargeOnly and ChargeAndCreateToken.
          Takes effect on the NEXT purchase opened — no deploy. The legal precondition is wording, not code, so it is
          stated in the hint and enforced by the operator. */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="save_card_on_purchase"
          defaultChecked={values.save_card_on_purchase}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">שמירת כרטיס ברכישה (לחיובי שדרוג)</span>
          <span className="block text-xs text-muted-foreground">
            כשדולק — הרכישה מבקשת מ-CardCom גם לשמור את הכרטיס (ChargeAndCreateToken) לטובת שדרוג חבילה עתידי.
            לפני ההדלקה חובה שתנאי ההסכם שהלקוח מאשר יגלו את שמירת אמצעי התשלום — נוסח של עורך הדין.
          </span>
        </span>
      </label>

      {/* Google Pay (add-google-pay-cardcom): who is offered it above the card fields. Takes effect on the NEXT page load — no
          deploy. It is also withheld while the save-card switch above is on (a wallet payment may not return the token that
          switch promises), and it needs the terminal enabled for Google Pay at CardCom before it is moved past "admins". */}
      <fieldset className="space-y-2" aria-describedby="google-pay-mode-hint">
        <legend className="text-sm font-medium">Google Pay בטופס התשלום</legend>
        <p id="google-pay-mode-hint" className="text-xs text-muted-foreground">
          מופיע מעל שדות הכרטיס, רק ברכישה שעוברת ל-CardCom, ולא כשהמתג &quot;שמירת כרטיס ברכישה&quot; דולק. לפני מעבר ל&quot;כולם&quot; יש לוודא מול
          CardCom שהמסוף מאופשר ל-Google Pay.
        </p>
        {/* The shared radio group (Base UI): it renders the hidden input that makes the chosen position part of the form's data. */}
        <RadioGroup name="google_pay_mode" defaultValue={values.google_pay_mode} aria-label="Google Pay בטופס התשלום">
          {GOOGLE_PAY_OPTIONS.map((option) => {
            const hintId = `google-pay-option-${option.value}`;
            return (
              <label key={option.value} className="flex cursor-pointer items-start gap-3">
                <RadioGroupItem value={option.value} aria-describedby={hintId} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span id={hintId} className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
        {e?.google_pay_mode ? (
          <p role="alert" className="text-sm text-destructive">
            {e.google_pay_mode[0]}
          </p>
        ) : null}
      </fieldset>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
