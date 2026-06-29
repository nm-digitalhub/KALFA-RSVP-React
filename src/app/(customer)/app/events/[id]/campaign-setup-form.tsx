'use client';

import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The "הפעלת אישורי הגעה" CTA: a formless action (create-or-continue the event's
// single campaign). useActionState surfaces the server's safe Hebrew error
// (e.g. "add guests with a phone first") inline; on success the action redirects.
export function CampaignSetupForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <SubmitButton>הפעלת אישורי הגעה</SubmitButton>
    </form>
  );
}
