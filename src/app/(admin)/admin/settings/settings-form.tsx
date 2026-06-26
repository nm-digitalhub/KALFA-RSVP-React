'use client';

import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { updateSettingsAction } from './actions';

type Settings = {
  payments_enabled: boolean;
  sumit_company_id: string;
  sumit_api_public_key: string;
  sumit_api_key: string;
  sms_enabled: boolean;
  extra_sms_sender: string;
  extra_sms_token: string;
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  smtp_from: string;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 read-only:bg-muted read-only:text-muted-foreground';

// A value row with its own controls: an eye toggle (mask/reveal) for key fields,
// and an "ערוך" toggle that enables editing. The input is ALWAYS present in the
// form — readOnly fields still submit — so values aren't lost when untouched.
function EditableField({
  name,
  label,
  defaultValue,
  maskable = false,
  inputMode,
  placeholder,
  hint,
  errors,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  maskable?: boolean;
  inputMode?: 'numeric';
  placeholder?: string;
  hint?: string;
  errors?: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Masked by default; revealed (or being edited) shows plain text.
  const type = maskable && !revealed && !editing ? 'password' : 'text';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex items-center gap-3">
          {maskable ? (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-pressed={revealed}
            >
              {revealed ? (
                <EyeOff className="size-3.5" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
              {revealed ? 'הסתר' : 'הצג'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-xs text-primary hover:underline"
            aria-pressed={editing}
          >
            {editing ? 'נעילה' : 'ערוך'}
          </button>
        </div>
      </div>
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        readOnly={!editing}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState(updateSettingsAction, null);
  const fieldErrors = state?.fieldErrors;

  return (
    <form action={action} className="space-y-5">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      {/* Master switch — the checkbox itself is the edit affordance. */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="payments_enabled"
          defaultChecked={settings.payments_enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">הפעלת סליקה</span>
          <span className="block text-xs text-muted-foreground">
            כשכבוי — כפתור התשלום מוסתר מהלקוחות וה-endpoint דוחה כל ניסיון חיוב.
          </span>
        </span>
      </label>

      <EditableField
        name="sumit_company_id"
        label="מזהה חברה (SUMIT Company ID)"
        defaultValue={settings.sumit_company_id}
        inputMode="numeric"
        placeholder="לדוגמה 123456"
        errors={fieldErrors?.sumit_company_id}
      />

      <EditableField
        name="sumit_api_public_key"
        label="מפתח ציבורי לטוקניזציה (Public API Key)"
        defaultValue={settings.sumit_api_public_key}
        maskable
        placeholder="מפתח ציבורי מ-SUMIT"
        errors={fieldErrors?.sumit_api_public_key}
      />

      <EditableField
        name="sumit_api_key"
        label="מפתח API פרטי לחיוב (Secret API Key)"
        defaultValue={settings.sumit_api_key}
        maskable
        placeholder="לא מוגדר — הזן מפתח"
        hint="המפתח הסודי נשמר בצד-שרת. כאן הוא מוצג מוסכה כברירת מחדל; לחצו 'הצג' לחשיפה."
        errors={fieldErrors?.sumit_api_key}
      />

      <hr className="border-border" />

      {/* SMS (ExtrA) — for OTP identity verification at agreement signing. */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="sms_enabled"
          defaultChecked={settings.sms_enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">הפעלת SMS (ExtrA)</span>
          <span className="block text-xs text-muted-foreground">
            נדרש לאימות OTP בעת חתימה על ההסכם. כשכבוי — לא נשלחים קודים.
          </span>
        </span>
      </label>

      <EditableField
        name="extra_sms_sender"
        label="שם השולח (Sender) המאומת ב-ExtrA"
        defaultValue={settings.extra_sms_sender}
        placeholder="לדוגמה KALFA"
        hint="זהות שולח מאומתת מתוך לשונית 'verified identities' בחשבון ExtrA."
        errors={fieldErrors?.extra_sms_sender}
      />

      <EditableField
        name="extra_sms_token"
        label="מפתח API של ExtrA (Bearer Token)"
        defaultValue={settings.extra_sms_token}
        maskable
        placeholder="לא מוגדר — הזן טוקן"
        hint="הטוקן הסודי נשמר בצד-שרת ומוצג מוסכה כברירת מחדל; לחצו 'הצג' לחשיפה."
        errors={fieldErrors?.extra_sms_token}
      />

      <hr className="border-border" />

      {/* Email (SMTP / IONOS) — business emails: signed agreement, invoices. */}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="email_enabled"
          defaultChecked={settings.email_enabled}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">הפעלת דואר (SMTP)</span>
          <span className="block text-xs text-muted-foreground">
            נדרש לשליחת מיילים עסקיים (ההסכם החתום, חשבוניות). כשכבוי — לא נשלח דואר.
          </span>
        </span>
      </label>

      <EditableField
        name="smtp_host"
        label="שרת SMTP"
        defaultValue={settings.smtp_host}
        placeholder="exchange.ionos.com"
        errors={fieldErrors?.smtp_host}
      />
      <EditableField
        name="smtp_port"
        label="פורט"
        defaultValue={settings.smtp_port}
        inputMode="numeric"
        placeholder="587"
        hint="587 = STARTTLS · 465 = SSL"
        errors={fieldErrors?.smtp_port}
      />
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="smtp_secure"
          defaultChecked={settings.smtp_secure}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">חיבור מאובטח (SSL)</span>
          <span className="block text-xs text-muted-foreground">
            סמנו עבור פורט 465 (SSL). לפורט 587 (STARTTLS) — השאירו כבוי.
          </span>
        </span>
      </label>
      <EditableField
        name="smtp_user"
        label="שם משתמש (תיבת הדואר)"
        defaultValue={settings.smtp_user}
        placeholder="noreply@kalfa.me"
        errors={fieldErrors?.smtp_user}
      />
      <EditableField
        name="smtp_password"
        label="סיסמת SMTP"
        defaultValue={settings.smtp_password}
        maskable
        placeholder="לא מוגדר — הזן סיסמה"
        hint="הסיסמה נשמרת בצד-שרת ומוצגת מוסכה; לחצו 'הצג' לחשיפה."
        errors={fieldErrors?.smtp_password}
      />
      <EditableField
        name="smtp_from"
        label="כתובת השולח (From)"
        defaultValue={settings.smtp_from}
        placeholder="KALFA <noreply@kalfa.me>"
        hint="הכתובת שתופיע אצל הנמען."
        errors={fieldErrors?.smtp_from}
      />

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
