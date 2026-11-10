'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';

// Masked credential field with a reveal toggle — the house convention for admin
// secrets (owner ruling 2026-08-24: masked + reveal stays; do not re-propose a DTO or
// a taint wrapper).
//
// It is a CLIENT component (useState for the reveal), so it must not sit in
// _components.tsx — that module is imported by Server Components and putting a
// client component in it would drag the whole file across the boundary.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 read-only:bg-muted read-only:text-muted-foreground';

export function EditableField({
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

const helpFieldInputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

// A labelled input with a help (?) bubble beside the label — the field the
// agreement-config and callback-policy forms are built from. HelpTip is a Base UI
// Popover, RTL-correct via the admin shell's DirectionProvider.
export function HelpField({
  name,
  label,
  defaultValue,
  help,
  type = 'text',
  dir,
  inputMode,
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  help: string;
  type?: 'text' | 'number';
  dir?: 'rtl' | 'ltr';
  inputMode?: 'numeric' | 'text';
  errors?: string[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        <HelpTip text={help} />
      </div>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        dir={dir}
        inputMode={inputMode}
        autoComplete="off"
        className={helpFieldInputClass}
      />
      <FieldError errors={errors} />
    </div>
  );
}

// A table-row control: one native <select> and an "עדכון" button that submits it
// together with the row's id. Native select + submit on purpose — a small
// surface with no portal/RTL pitfalls. The caller owns the action state and the
// options (children); this renders the form around them.
export function InlineSelectForm({
  id,
  selectId,
  label,
  name,
  defaultValue,
  formAction,
  pending,
  fieldErrors,
  formError,
  notice,
  children,
}: {
  // The row's id, posted as the hidden `id` field.
  id: string;
  selectId: string;
  // Read by screen readers only.
  label: string;
  name: string;
  defaultValue: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
  fieldErrors?: string[];
  formError?: string;
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          {label}
        </label>
        <select
          id={selectId}
          name={name}
          defaultValue={defaultValue}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {children}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'שומר…' : 'עדכון'}
        </button>
      </div>
      <FieldError errors={fieldErrors} />
      <FormError message={formError} />
      <FormNotice message={notice} />
    </form>
  );
}
