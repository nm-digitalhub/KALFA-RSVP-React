'use client';

// Admin client form for the 7 agreement-config values that the signed agreement
// reads live (close-charge windows, offer validity, liability cap, retention).
// Rendered as a section INSIDE the existing /admin/agreement page (not a separate
// route). Follows the established admin-form pattern (useActionState + FormState +
// FieldError/FormError/FormNotice/SubmitButton), mirroring company-form.tsx.
//
// Each field carries a help (?) icon with a detailed tooltip bubble explaining the
// parameter — Base UI Tooltip, RTL-correct via the admin-shell DirectionProvider.
//
// Field `name` attributes and the inline Zod keys in ./config-actions.ts are kept
// in camelCase, matching the prop keys returned by getAgreementConfigForAdmin().
// config-actions.ts maps those camelCase keys to the snake_case app_settings cols.

import { useActionState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { saveAgreementConfigAction } from './config-actions';
import { HelpTip } from './help-tip';

// The 7 raw string values, keyed exactly as getAgreementConfigForAdmin() returns
// them. All values are plain strings (form-friendly); validation/coercion lives
// server-side in config-actions.ts.
export type AgreementConfigValues = {
  serviceActivationWindow: string;
  offerValidityDays: string;
  chargeWindowDays: string;
  holdReleaseDays: string;
  liabilityCap: string;
  retentionDays: string;
  recordRetentionMonths: string;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'text-sm font-medium';

function Field({
  name,
  label,
  defaultValue,
  help,
  dir,
  inputMode,
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  help: string;
  dir?: 'rtl' | 'ltr';
  inputMode?: 'numeric' | 'text';
  errors?: string[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={name} className={labelClass}>
          {label}
        </label>
        <HelpTip text={help} />
      </div>
      <input
        id={name}
        name={name}
        type="text"
        defaultValue={defaultValue}
        dir={dir}
        inputMode={inputMode}
        autoComplete="off"
        className={inputClass}
      />
      <FieldError errors={errors} />
    </div>
  );
}

export function AgreementConfigForm({
  values,
}: {
  values: AgreementConfigValues;
}) {
  const [state, action] = useActionState(saveAgreementConfigAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />

        <Field
          name="serviceActivationWindow"
          label="חלון הפעלת שירות"
          defaultValue={values.serviceActivationWindow}
          help="כמה זמן אחרי שהלקוח מאשר וחותם על ההסכם הקמפיין מתחיל לפנות לאורחים — למשל ״5 ימי עסקים״. מופיע בהסכם כגילוי מועד תחילת אספקת השירות (חוק הגנת הצרכן §14ג)."
          errors={e?.serviceActivationWindow}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="offerValidityDays"
            label="תוקף הצעה (ימים)"
            defaultValue={values.offerValidityDays}
            help="כמה ימים תנאי ההצעה שהוצגו ללקוח (המחיר לאיש קשר, ההיקף והתקרה) נשארים בתוקף. בתום התקופה החברה רשאית לעדכן את ההצעה."
            dir="ltr"
            inputMode="numeric"
            errors={e?.offerValidityDays}
          />
          <Field
            name="chargeWindowDays"
            label="חלון גבייה (ימים)"
            defaultValue={values.chargeWindowDays}
            help="כמה ימים לאחר סגירת הקמפיין מתבצע החיוב בפועל (capture) על הכרטיס, לפי מספר אנשי הקשר שהושגו בפועל. ברירת מחדל מקובלת: 30."
            dir="ltr"
            inputMode="numeric"
            errors={e?.chargeWindowDays}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="holdReleaseDays"
            label="חלון שחרור מסגרת (ימים)"
            defaultValue={values.holdReleaseDays}
            help="כמה ימים עד שתפיסת המסגרת (ה‑hold) משוחררת כאשר אין חיוב, או כשהחיוב בפועל נמוך מהסכום שנתפס. השלמת השחרור בפועל תלויה גם בנהלי חברת האשראי של הלקוח."
            dir="ltr"
            inputMode="numeric"
            errors={e?.holdReleaseDays}
          />
          <Field
            name="liabilityCap"
            label="תקרת אחריות (₪)"
            defaultValue={values.liabilityCap}
            help="הסכום הכספי המרבי שבו תישא החברה באחריות כלפי הלקוח, בנוסף ל״סכום ששולם בפועל״. מופיע בסעיף הגבלת האחריות בהסכם (חוק החוזים האחידים)."
            dir="ltr"
            inputMode="numeric"
            errors={e?.liabilityCap}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="retentionDays"
            label="שמירת מידע"
            defaultValue={values.retentionDays}
            help="כמה זמן נשמרים הנתונים האישיים (פרטי אורחים ולקוח) לפני מחיקה או הנגשה. מדיניות שמירה לפי חוק הגנת הפרטיות ותיקון 13 — מומלץ ערך כמו ״24 חודשים״."
            errors={e?.retentionDays}
          />
          <Field
            name="recordRetentionMonths"
            label="שמירת ראיות (חודשים)"
            defaultValue={values.recordRetentionMonths}
            help="כמה זמן נשמרות ראיות החתימה (אימות OTP, כתובת IP, חתימה אלקטרונית, חותמת‑זמן ו‑hash) להוכחת ההסכמה. 84 חודשים = 7 שנים (תקופת התיישנות / שמירת מסמכים בישראל)."
            dir="ltr"
            inputMode="numeric"
            errors={e?.recordRetentionMonths}
          />
        </div>

        <SubmitButton>שמירה</SubmitButton>
      </form>
  );
}
