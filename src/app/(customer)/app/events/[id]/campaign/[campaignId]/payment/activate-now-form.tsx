'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The audit-§1 fallback: when auto-activation after the hold was refused (or a
// campaign was held before auto-activation existed), the owner activates HERE —
// on the page they are already on — instead of being sent back to the event
// page to discover one more button. Same Server Action as the manage page.
export function ActivateNowForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>הפעלת הקמפיין עכשיו</SubmitButton>
    </form>
  );
}
