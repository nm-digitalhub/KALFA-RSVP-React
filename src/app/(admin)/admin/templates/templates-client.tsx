'use client';

import { useActionState } from 'react';

import { HelpTip } from '@/components/help-tip';
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
  category: string | null;
  requested_category: string;
  quality_score: string | null;
  meta_status: string | null;
  rejected_reason: string | null;
  pending_category_change_at: string | null;
  pending_correct_category: string | null;
  last_synced_at: string | null;
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

const CATEGORY_LABELS: Record<string, string> = {
  UTILITY: 'Utility (זול)',
  MARKETING: 'Marketing (יקר)',
  AUTHENTICATION: 'Authentication',
};

const QUALITY_STYLE: Record<string, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-500',
  UNKNOWN: 'bg-muted-foreground/40',
};

function formatDateTimeIL(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TemplateHealth({ t }: { t: Template }) {
  const downgraded = !!t.category && t.category !== t.requested_category;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 font-medium ${
            !t.category
              ? 'border-border text-muted-foreground'
              : downgraded
                ? 'border-red-500/30 bg-red-500/10 text-red-600'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
          }`}
        >
          {t.category ? (CATEGORY_LABELS[t.category] ?? t.category) : 'טרם סונכרן'}
        </span>
        {t.quality_score ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span
              className={`size-2 rounded-full ${QUALITY_STYLE[t.quality_score] ?? 'bg-muted-foreground/40'}`}
            />
            איכות: {t.quality_score}
          </span>
        ) : null}
        {t.meta_status && t.meta_status !== 'APPROVED' ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600">
            {t.meta_status}
          </span>
        ) : null}
      </div>
      {downgraded ? (
        <p className="text-red-600">
          ⚠ ירדה בקטגוריה — התבקש {CATEGORY_LABELS[t.requested_category] ?? t.requested_category}
        </p>
      ) : null}
      {t.pending_category_change_at ? (
        <p className="text-amber-600">
          ⏳ צפויה לרדת ל-{t.pending_correct_category ?? '?'} סביב{' '}
          {formatDateTimeIL(t.pending_category_change_at)}
        </p>
      ) : null}
      {t.rejected_reason ? (
        <p className="text-muted-foreground">סיבת דחייה: {t.rejected_reason}</p>
      ) : null}
      {t.last_synced_at ? (
        <p className="text-muted-foreground">סונכרן לאחרונה: {formatDateTimeIL(t.last_synced_at)}</p>
      ) : null}
    </div>
  );
}

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

      {isCall ? null : <TemplateHealth t={template} />}

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
