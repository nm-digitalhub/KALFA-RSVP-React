'use client';

import { useActionState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { updateCompanyAction } from './actions';

type CompanySettings = {
  company_legal_name: string;
  company_legal_id: string;
  company_legal_address: string;
  company_contact_phone: string;
  company_contact_email: string;
  privacy_url: string;
  terms_url: string;
  warranty_text: string;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 block text-sm font-medium';

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  type = 'text',
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  type?: string;
  errors?: string[];
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

export function CompanyForm({ settings }: { settings: CompanySettings }) {
  const [state, action] = useActionState(updateCompanyAction, null);
  const e = state?.fieldErrors;

  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <Field
        name="company_legal_name"
        label="שם משפטי מלא"
        defaultValue={settings.company_legal_name}
        placeholder="לדוגמה: קאלפא בע״מ"
        hint="שם הישות המשפטית כפי שרשום (בע״מ / עוסק מורשה)."
        errors={e?.company_legal_name}
      />
      <Field
        name="company_legal_id"
        label="ח.פ. / מספר עוסק"
        defaultValue={settings.company_legal_id}
        placeholder="לדוגמה: 51-1234567"
        errors={e?.company_legal_id}
      />
      <Field
        name="company_legal_address"
        label="כתובת רשומה"
        defaultValue={settings.company_legal_address}
        placeholder="רחוב, מספר, עיר"
        errors={e?.company_legal_address}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="company_contact_phone"
          label="טלפון לפניות וביטול"
          defaultValue={settings.company_contact_phone}
          type="tel"
          placeholder="0X-XXXXXXX"
          errors={e?.company_contact_phone}
        />
        <Field
          name="company_contact_email"
          label="אימייל לפניות וביטול"
          defaultValue={settings.company_contact_email}
          type="email"
          placeholder="support@kalfa.me"
          errors={e?.company_contact_email}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="privacy_url"
          label="קישור למדיניות פרטיות"
          defaultValue={settings.privacy_url}
          type="url"
          placeholder="https://…"
          errors={e?.privacy_url}
        />
        <Field
          name="terms_url"
          label="קישור לתקנון / תנאי שירות"
          defaultValue={settings.terms_url}
          type="url"
          placeholder="https://…"
          errors={e?.terms_url}
        />
      </div>

      <div>
        <label htmlFor="warranty_text" className={labelClass}>
          תנאי אחריות (טקסט חופשי)
        </label>
        <textarea
          id="warranty_text"
          name="warranty_text"
          defaultValue={settings.warranty_text}
          rows={3}
          placeholder="לדוגמה: השירות ניתן כפי שהוא; KALFA אחראית לתקינות הפנייה הטכנית בלבד."
          className={inputClass}
        />
        <FieldError errors={e?.warranty_text} />
      </div>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}
