'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The setup page's single CTA form: a formless Server Action (confirm the event
// details if still draft, then create-or-continue the event's single campaign).
// `children` renders ABOVE the button — the R5 lock warning the audit (§2)
// requires the owner to see BEFORE confirming. useActionState surfaces the
// server's safe Hebrew error inline; on success the action redirects.
export function CampaignSetupForm({
  action,
  label,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      {children}
      <FormError message={state?.error} />
      <SubmitButton>{label}</SubmitButton>
    </form>
  );
}
