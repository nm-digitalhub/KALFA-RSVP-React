'use client';

import { useActionState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// Shared create/edit form for a package. The parent binds the correct Server
// Action (create, or update with the id pre-bound) and passes initial values
// for edit mode. `includes` (a JSON string[]) is edited as one item per line.

export interface PackageFormInitial {
  name: string;
  tier: string;
  category: string;
  description: string;
  price_with_vat: number | '';
  includes: string[];
  active: boolean;
  sort_order: number | '';
}

const EMPTY: PackageFormInitial = {
  name: '',
  tier: '',
  category: '',
  description: '',
  price_with_vat: '',
  includes: [],
  active: true,
  sort_order: '',
};

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const labelClass = 'block text-sm font-medium';
const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

export function PackageForm({
  action,
  initial = EMPTY,
  submitLabel,
}: {
  action: FormAction;
  initial?: PackageFormInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="space-y-1">
        <label htmlFor="name" className={labelClass}>
          שם החבילה
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={initial.name}
          className={inputClass}
          required
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="tier" className={labelClass}>
            דרגה
          </label>
          <input
            id="tier"
            name="tier"
            type="text"
            defaultValue={initial.tier}
            className={inputClass}
            required
          />
          <FieldError errors={state?.fieldErrors?.tier} />
        </div>

        <div className="space-y-1">
          <label htmlFor="category" className={labelClass}>
            קטגוריה
          </label>
          <input
            id="category"
            name="category"
            type="text"
            defaultValue={initial.category}
            className={inputClass}
            required
          />
          <FieldError errors={state?.fieldErrors?.category} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="price_with_vat" className={labelClass}>
          מחיר כולל מע&quot;מ (₪)
        </label>
        <input
          id="price_with_vat"
          name="price_with_vat"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          dir="ltr"
          defaultValue={initial.price_with_vat}
          className={inputClass}
          required
        />
        <FieldError errors={state?.fieldErrors?.price_with_vat} />
      </div>

      <div className="space-y-1">
        <label htmlFor="description" className={labelClass}>
          תיאור
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial.description}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.description} />
      </div>

      <div className="space-y-1">
        <label htmlFor="includes" className={labelClass}>
          כלול בחבילה (שורה לכל פריט)
        </label>
        <textarea
          id="includes"
          name="includes"
          rows={5}
          defaultValue={initial.includes.join('\n')}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.includes} />
      </div>

      <div className="space-y-1">
        <label htmlFor="sort_order" className={labelClass}>
          סדר תצוגה
        </label>
        <input
          id="sort_order"
          name="sort_order"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          dir="ltr"
          defaultValue={initial.sort_order}
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          מספר נמוך מוצג קודם בקטלוג הלקוחות. ברירת מחדל: 0.
        </p>
        <FieldError errors={state?.fieldErrors?.sort_order} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={initial.active}
          className="size-4 rounded border-border"
        />
        <label htmlFor="active" className="text-sm font-medium">
          חבילה פעילה (מוצגת ללקוחות)
        </label>
        <FieldError errors={state?.fieldErrors?.active} />
      </div>

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
