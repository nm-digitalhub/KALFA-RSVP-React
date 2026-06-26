'use client';

import { useActionState } from 'react';

import { Constants } from '@/lib/supabase/types';
import { FieldError, FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { GuestDetail, GuestGroup } from '@/lib/data/guests';
import { GUEST_STATUS_LABELS, CONTACT_STATUS_LABELS } from './labels';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';

type GuestAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

// Shared create/edit form. `initial` is undefined when creating. The bound
// server action (create or update) is passed in by the page so this component
// stays presentational.
export function GuestForm({
  action,
  groups,
  initial,
  submitLabel,
}: {
  action: GuestAction;
  groups: GuestGroup[];
  initial?: GuestDetail;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />

      <div>
        <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          required
          defaultValue={initial?.full_name ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.full_name} />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          טלפון
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          defaultValue={initial?.phone ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">
            סטטוס
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? 'pending'}
            className={inputClass}
          >
            {Constants.public.Enums.guest_status.map((s) => (
              <option key={s} value={s}>
                {GUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <FieldError errors={state?.fieldErrors?.status} />
        </div>

        <div>
          <label
            htmlFor="contact_status"
            className="mb-1 block text-sm font-medium"
          >
            יצירת קשר
          </label>
          <select
            id="contact_status"
            name="contact_status"
            defaultValue={initial?.contact_status ?? 'not_contacted'}
            className={inputClass}
          >
            {Constants.public.Enums.contact_status.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <FieldError errors={state?.fieldErrors?.contact_status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="group_id" className="mb-1 block text-sm font-medium">
            קבוצה
          </label>
          <select
            id="group_id"
            name="group_id"
            defaultValue={initial?.group_id ?? ''}
            className={inputClass}
          >
            <option value="">ללא קבוצה</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <FieldError errors={state?.fieldErrors?.group_id} />
        </div>

        <div>
          <label
            htmlFor="expected_count"
            className="mb-1 block text-sm font-medium"
          >
            מספר אורחים צפוי
          </label>
          <input
            id="expected_count"
            name="expected_count"
            type="number"
            min={0}
            dir="ltr"
            inputMode="numeric"
            defaultValue={initial?.expected_count ?? ''}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.expected_count} />
        </div>
      </div>

      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium">
          הערה
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          defaultValue={initial?.note ?? ''}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>

      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
