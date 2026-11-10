'use client';

import { useActionState } from 'react';

import { CONTACT_STATUSES } from '@/lib/validation/admin';
import { CONTACT_STATUS_LABELS, contactStatusLabel } from '@/lib/data/admin/labels';
import { actionFormError } from '@/lib/action-result';
import { InlineSelectForm } from '../_form-fields';
import { updateContactStatusAction } from './actions';

// Status control for a contact message — a closed vocabulary and the same
// native-select pattern as CallOutcomeForm (no portal/RTL pitfalls).
export function ContactStatusForm({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateContactStatusAction,
    {},
  );

  const isKnown = (CONTACT_STATUSES as readonly string[]).includes(currentStatus);

  return (
    <InlineSelectForm
      id={id}
      selectId={`contact-status-${id}`}
      label="סטטוס פנייה"
      name="status"
      defaultValue={currentStatus}
      formAction={formAction}
      pending={pending}
      fieldErrors={state.validationErrors?.fieldErrors?.status}
      formError={actionFormError(state)}
      notice={state.data?.notice}
    >
      {!isKnown && (
        <option value={currentStatus}>{contactStatusLabel(currentStatus)}</option>
      )}
      {CONTACT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {CONTACT_STATUS_LABELS[s]}
        </option>
      ))}
    </InlineSelectForm>
  );
}
