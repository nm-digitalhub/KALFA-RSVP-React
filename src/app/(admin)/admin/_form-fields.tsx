'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { FieldError } from '@/components/forms';

// Masked credential field with a reveal toggle — the house convention for admin
// secrets (owner ruling 2026-08-24: masked + reveal stays; do not re-propose a DTO or
// a taint wrapper).
//
// It lived inside settings-form.tsx until Task 0.2 split the provider credentials out
// of that form. Moved here rather than deleted: the per-provider forms of Task 0.5 are
// its next callers, and it is a CLIENT component (useState for the reveal), so it must
// not sit in _components.tsx — that module is imported by Server Components and
// putting a client component in it would drag the whole file across the boundary.

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
