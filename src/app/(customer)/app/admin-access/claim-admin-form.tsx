'use client';

import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import { claimFirstAdminAction } from './actions';

// Claim-first-admin button. On success the action redirects to /admin, so no
// success state is rendered here; the only visible state is a generic error
// (e.g. an admin already exists).
export function ClaimAdminForm() {
  const [state, formAction] = useActionState(claimFirstAdminAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <SubmitButton>תביעת גישת ניהול</SubmitButton>
    </form>
  );
}
