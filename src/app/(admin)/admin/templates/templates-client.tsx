'use client';

import { useActionState } from 'react';

import { HelpTip } from '@/app/(admin)/admin/agreement/help-tip';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { updateTemplateAction } from './actions';

type Template = {
  id: string;
  message_key: string;
  channel: string;
  label: string | null;
  name: string;
  language: string;
  body: string | null;
  active: boolean;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

function TemplateForm({ template }: { template: Template }) {
  const [state, action] = useActionState(updateTemplateAction, null);
  const isCall = template.channel === 'call';

  return (
    <form
      action={action}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <input type="hidden" name="id" value={template.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{template.label || template.message_key}</h3>
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
            {template.message_key}
          </code>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {isCall ? 'שיחה' : 'WhatsApp'}
          </span>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            template.active
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
          }`}
        >
          {template.active ? 'פעיל' : 'כבוי'}
        </span>
      </div>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`name-${template.id}`} className={labelClass}>
            {isCall ? 'שם השיחה' : 'שם תבנית Meta'}
            <HelpTip
              text={
                isCall
                  ? 'שם קצר לזיהוי השיחה. תוכן השיחה נכתב בשדה "תוכן/סקריפט".'
                  : 'שם התבנית כפי שאושרה ב-Meta Business (חייב להתאים בדיוק לשם המאושר), אחרת השליחה תיכשל.'
              }
            />
          </label>
          <input
            id={`name-${template.id}`}
            name="name"
            defaultValue={template.name}
            autoComplete="off"
            className={inputClass}
            placeholder={isCall ? 'לדוגמה: אישור הגעה' : 'rsvp_invite_he'}
          />
          <FieldError errors={state?.fieldErrors?.name} />
        </div>
        <div>
          <label htmlFor={`language-${template.id}`} className={labelClass}>
            שפה
          </label>
          <input
            id={`language-${template.id}`}
            name="language"
            defaultValue={template.language}
            autoComplete="off"
            className={inputClass}
            placeholder="he"
          />
          <FieldError errors={state?.fieldErrors?.language} />
        </div>
      </div>

      <div>
        <label htmlFor={`body-${template.id}`} className={labelClass}>
          {isCall ? 'תוכן / סקריפט השיחה' : 'תוכן לעיון (לא נשלח)'}
          {isCall ? null : (
            <HelpTip text="ב-WhatsApp התוכן עצמו מנוהל ומאושר ב-Meta; שדה זה לעיון פנימי בלבד." />
          )}
        </label>
        <textarea
          id={`body-${template.id}`}
          name="body"
          defaultValue={template.body ?? ''}
          rows={isCall ? 4 : 2}
          className={inputClass}
          placeholder={
            isCall
              ? 'הטקסט שהסוכן יקריא, כולל גילוי שמדובר בשיחה אוטומטית.'
              : ''
          }
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="active"
            defaultChecked={template.active}
            className="size-4 accent-primary"
          />
          פעיל (זמין לשליחה)
        </label>
        <SubmitButton className="w-auto min-w-28 shrink-0">שמירה</SubmitButton>
      </div>
    </form>
  );
}

export function TemplatesClient({ templates }: { templates: Template[] }) {
  return (
    <div className="space-y-4">
      {templates.map((t) => (
        <TemplateForm key={t.id} template={t} />
      ))}
    </div>
  );
}
