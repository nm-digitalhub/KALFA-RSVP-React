'use client';

import { useActionState } from 'react';
import { RefreshCw } from 'lucide-react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// One button per provider. Read-only against the provider — one GET, nothing
// purchased, nothing bound, no message sent — so there is no confirmation dialog
// here on purpose; a dialog in front of a harmless read teaches people to click
// through the ones that matter.
//
// Each button owns its own action state, so a Meta failure does not blank the
// Voximplant result standing next to it.

function SyncButton({
  label,
  action,
  disabled,
  disabledHint,
}: {
  label: string;
  action: () => Promise<FormState>;
  disabled: boolean;
  disabledHint: string;
}) {
  const [state, formAction, pending] = useActionState<FormState>(
    async () => action(),
    null,
  );

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={disabled || pending}
          title={disabled ? disabledHint : undefined}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${pending ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {pending ? 'מסנכרן…' : label}
        </button>
      </form>
      {disabled ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </div>
  );
}

export function SyncButtons({
  syncMeta,
  syncVoximplant,
  metaConfigured,
  voximplantConfigured,
}: {
  syncMeta: () => Promise<FormState>;
  syncVoximplant: () => Promise<FormState>;
  // Passed from the server rather than inferred from an empty table: "no numbers
  // yet" and "this provider is not connected" look identical in a row count, and
  // only one of them is fixed by pressing sync.
  metaConfigured: boolean;
  voximplantConfigured: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <SyncButton
        label="סנכרון מ-Meta"
        action={syncMeta}
        disabled={!metaConfigured}
        disabledHint="חיבור ה-WhatsApp אינו מוגדר — אין מה לסנכרן"
      />
      <SyncButton
        label="סנכרון מ-Voximplant"
        action={syncVoximplant}
        disabled={!voximplantConfigured}
        disabledHint="חיבור ה-Voximplant אינו מוגדר — אין מה לסנכרן"
      />
    </div>
  );
}
