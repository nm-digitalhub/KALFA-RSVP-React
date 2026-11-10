'use client';

import { useActionState } from 'react';

import { CALL_OUTCOMES } from '@/lib/validation/admin';
import { CALL_OUTCOME_LABELS } from '@/lib/data/admin/labels';
import { actionFormError } from '@/lib/action-result';
import { InlineSelectForm } from '../_form-fields';
import { updateCallOutcomeAction } from './actions';

// Records what happened when the owner actually made the call — a dimension
// fully separate from the request's scheduling status (see
// validation/admin.ts). Native <select> + submit (InlineSelectForm): small
// surface, no portal/RTL pitfalls.
export function CallOutcomeForm({
  id,
  currentOutcome,
}: {
  id: string;
  currentOutcome: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateCallOutcomeAction,
    {},
  );

  const isKnown = (CALL_OUTCOMES as readonly string[]).includes(currentOutcome);

  return (
    <InlineSelectForm
      id={id}
      selectId={`call-outcome-${id}`}
      label="תוצאת שיחה"
      name="callOutcome"
      defaultValue={currentOutcome}
      formAction={formAction}
      pending={pending}
      fieldErrors={state.validationErrors?.fieldErrors?.callOutcome}
      formError={actionFormError(state)}
      notice={state.data?.notice}
    >
      {!isKnown && <option value={currentOutcome}>{currentOutcome}</option>}
      {CALL_OUTCOMES.map((o) => (
        <option key={o} value={o}>
          {CALL_OUTCOME_LABELS[o]}
        </option>
      ))}
    </InlineSelectForm>
  );
}
