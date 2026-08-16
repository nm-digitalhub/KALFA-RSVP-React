'use client';

import { useActionState, useState } from 'react';

import { HelpTip } from '@/app/(admin)/admin/agreement/help-tip';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { AdminFaqItem } from '@/lib/data/admin/faq';
import {
  FAQ_CATEGORIES,
  FAQ_CATEGORY_TITLES,
  PROTECTED_FAQ_ITEM_KEY,
  type FaqCategory,
} from '@/lib/faq/page-model';
import {
  createFaqItemAction,
  deleteFaqItemAction,
  updateFaqItemAction,
} from './actions';

// Admin editor for the FAQ catalog — one form per row (channel-catalog-editor.tsx
// / templates-client.tsx pattern), grouped into the 4 fixed public-page
// sections, with an inline "+ שאלה חדשה" form at the bottom of each. `category`
// is deliberately not an editable field on an existing row (only set once, by
// which section's add-form was used) — like `channels.key`, moving a question
// between sections is a recreate, not an in-place edit.
//
// Two tiers of protected row, both UI-ONLY convenience — the actual guards
// live in the DAL (src/lib/data/admin/faq.ts), re-checked there by DB row id
// on every request, so a tampered request against this same action still
// cannot bypass either:
//   - Tier 1, `item_key === 'pricing_no_response'`: DIFFERENT form body — no
//     "תשובה" textarea (its mandatory sentence is code-owned, see
//     buildProtectedPricingMandatorySentence in src/lib/faq/page-model.ts), a
//     read-only live preview instead, a disabled "פורסם" checkbox.
//   - Tier 2, `is_structural` (a superset including Tier 1): the normal
//     editable form, PLUS a persistent warning banner and no delete button.
//     Every save on an is_structural row is written to activity_log by the
//     DAL, regardless of what changed.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 block text-sm font-medium';

function StatusPill({ published }: { published: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        published
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
      }`}
    >
      {published ? 'פורסם' : 'טיוטה'}
    </span>
  );
}

// Confirm-gated delete, same shape as
// src/app/(admin)/admin/packages/[id]/delete-package-form.tsx.
function DeleteFaqItemButton({ id, question }: { id: string; question: string }) {
  const action = deleteFaqItemAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`למחוק את השאלה "${question}"? פעולה זו אינה הפיכה.`)) {
          e.preventDefault();
        }
      }}
    >
      <FormError message={state?.error} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'מוחק…' : 'מחיקה'}
      </button>
    </form>
  );
}

function FaqItemRow({
  item,
  protectedMandatorySentence,
}: {
  item: AdminFaqItem;
  protectedMandatorySentence: string;
}) {
  const [state, formAction] = useActionState(updateFaqItemAction, null);
  const isProtected = item.item_key === PROTECTED_FAQ_ITEM_KEY;
  // Tier 2 that ISN'T also Tier 1 — is_structural rows keep a normal
  // editable form (unlike the protected row), just with the warning banner
  // and no delete.
  const isStructuralOnly = item.is_structural && !isProtected;
  // Live-typed supplement so the preview below updates as the admin types,
  // instead of only after saving.
  const [supplement, setSupplement] = useState(item.answer);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <input type="hidden" name="id" value={item.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{item.question}</h3>
        <StatusPill published={isProtected ? true : item.published} />
      </div>

      {isStructuralOnly ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800"
        >
          הניסוח של שאלה זו כולל גילוי מחויב על פי דין (סעיף 14ג לחוק הגנת הצרכן). ניתן לערוך את
          התוכן, אך כל שמירה נרשמת ביומן הפעילות, ואי אפשר למחוק את השאלה.
        </p>
      ) : null}

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      {isProtected ? (
        <>
          {/* The question itself is fixed (its precise wording is part of the
              legal disclosure); passed through unchanged so the update schema
              is satisfied — the DAL ignores this field for the protected row
              regardless of what is submitted. */}
          <input type="hidden" name="question" value={item.question} />

          <div>
            <span className={labelClass}>תצוגה מקדימה (כפי שתופיע בעמוד הציבורי כרגע)</span>
            <div
              dir="rtl"
              className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground"
            >
              {protectedMandatorySentence}
              {supplement.trim() ? ` ${supplement.trim()}` : ''}
            </div>
          </div>

          <div>
            <label htmlFor={`answer-${item.id}`} className={labelClass}>
              טקסט משלים (אופציונלי)
            </label>
            <textarea
              id={`answer-${item.id}`}
              name="answer"
              rows={2}
              value={supplement}
              onChange={(e) => setSupplement(e.target.value)}
              className={inputClass}
            />
            <FieldError errors={state?.fieldErrors?.answer} />
          </div>

          <div>
            <label htmlFor={`sort_order-${item.id}`} className={labelClass}>
              סדר בתוך הקטגוריה
            </label>
            <input
              id={`sort_order-${item.id}`}
              name="sort_order"
              type="number"
              min="0"
              step="1"
              dir="ltr"
              defaultValue={item.sort_order}
              className={`${inputClass} max-w-[8rem]`}
            />
            <FieldError errors={state?.fieldErrors?.sort_order} />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked
                disabled
                readOnly
                className="size-4 rounded border-border"
              />
              פורסם
            </label>
            <HelpTip text='גילוי מחויב על פי חוק הגנת הצרכן — לא ניתן להסתיר אותו כל עוד מוצג מידע על מחיר. המשפט המחייב נקבע בקוד ומתעדכן אוטומטית עם מודל התמחור החי (ראו הגדרות → מודל תמחור).' />
            {/* Submitted so the shared update schema is satisfied; the DAL
                forces `published = true` for this row regardless of the value. */}
            <input type="hidden" name="published" value="on" />
          </div>
        </>
      ) : (
        <>
          <div>
            <label htmlFor={`question-${item.id}`} className={labelClass}>
              שאלה
            </label>
            <input
              id={`question-${item.id}`}
              name="question"
              defaultValue={item.question}
              className={inputClass}
              autoComplete="off"
            />
            <FieldError errors={state?.fieldErrors?.question} />
          </div>

          <div>
            <label htmlFor={`answer-${item.id}`} className={labelClass}>
              תשובה
            </label>
            <textarea
              id={`answer-${item.id}`}
              name="answer"
              rows={4}
              defaultValue={item.answer}
              className={inputClass}
            />
            <FieldError errors={state?.fieldErrors?.answer} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div>
              <label htmlFor={`sort_order-${item.id}`} className={labelClass}>
                סדר
              </label>
              <input
                id={`sort_order-${item.id}`}
                name="sort_order"
                type="number"
                min="0"
                step="1"
                dir="ltr"
                defaultValue={item.sort_order}
                className={inputClass}
              />
              <FieldError errors={state?.fieldErrors?.sort_order} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                name="published"
                defaultChecked={item.published}
                className="size-4 rounded border-border"
              />
              פורסם (מוצג בעמוד הציבורי)
            </label>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <SubmitButton className="w-auto">שמירה</SubmitButton>
        {item.is_structural ? null : <DeleteFaqItemButton id={item.id} question={item.question} />}
      </div>
    </form>
  );
}

function NewFaqItemForm({ category }: { category: FaqCategory }) {
  const [state, formAction] = useActionState(createFaqItemAction, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-primary hover:underline"
      >
        + שאלה חדשה
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-dashed border-border p-4"
    >
      <input type="hidden" name="category" value={category} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div>
        <label htmlFor={`new-question-${category}`} className={labelClass}>
          שאלה
        </label>
        <input
          id={`new-question-${category}`}
          name="question"
          className={inputClass}
          autoComplete="off"
        />
        <FieldError errors={state?.fieldErrors?.question} />
      </div>

      <div>
        <label htmlFor={`new-answer-${category}`} className={labelClass}>
          תשובה
        </label>
        <textarea id={`new-answer-${category}`} name="answer" rows={4} className={inputClass} />
        <FieldError errors={state?.fieldErrors?.answer} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <label htmlFor={`new-sort_order-${category}`} className={labelClass}>
            סדר
          </label>
          <input
            id={`new-sort_order-${category}`}
            name="sort_order"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={0}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.sort_order} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="published"
            defaultChecked
            className="size-4 rounded border-border"
          />
          פורסם (מוצג בעמוד הציבורי)
        </label>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className="w-auto">הוספה</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

export function FaqCatalogEditor({
  items,
  protectedMandatorySentence,
}: {
  items: AdminFaqItem[];
  protectedMandatorySentence: string;
}) {
  return (
    <div className="space-y-8">
      {FAQ_CATEGORIES.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        return (
          <section key={category} className="space-y-4">
            <h2 className="text-lg font-semibold">{FAQ_CATEGORY_TITLES[category]}</h2>
            {categoryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין שאלות בקטגוריה זו עדיין.</p>
            ) : (
              <div className="space-y-4">
                {categoryItems.map((item) => (
                  <FaqItemRow
                    key={item.id}
                    item={item}
                    protectedMandatorySentence={protectedMandatorySentence}
                  />
                ))}
              </div>
            )}
            <NewFaqItemForm category={category} />
          </section>
        );
      })}
    </div>
  );
}
