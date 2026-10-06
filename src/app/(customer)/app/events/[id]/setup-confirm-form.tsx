'use client';

import type { ReactNode } from 'react';
import { useActionState, useState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The confirm step of the setup flow: the owner acknowledges, explicitly, what
// they are about to lock in before the event details are confirmed. Each item is
// a checkbox posted under its own name; the button stays disabled until every
// one is ticked.
//
// The disabled button is CONVENIENCE, not a control: `setupCampaignAction`
// refuses a missing acknowledgment on the server (and records the ones it gets),
// so a form edited in the browser cannot skip them. The warning renders ABOVE
// the button, where the audit (§2) requires the owner to see it before
// confirming. A failure (something still missing) surfaces inline; on success the
// action redirects.
export type SetupConfirmItem = { name: string; label: ReactNode };

export function SetupConfirmForm({
  action,
  items,
  warning,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  items: readonly SetupConfirmItem[];
  warning: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const allChecked = items.every((item) => checked.has(item.name));

  return (
    <form action={formAction} className="space-y-4">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.name}>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name={item.name}
                className="mt-1 size-5 shrink-0"
                onChange={(e) =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(item.name);
                    else next.delete(item.name);
                    return next;
                  })
                }
              />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
        {warning}
      </p>
      <FormError message={state?.error} />
      <SubmitButton disabled={!allChecked}>{submitLabel}</SubmitButton>
    </form>
  );
}
