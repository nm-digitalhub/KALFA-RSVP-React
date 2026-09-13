'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { FieldError, FormError, FormNotice, SubmitButton, compactSelectClass } from '@/components/forms';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProviderNumber } from '@/lib/data/admin/integrations/provider-numbers';
import { CONFIRM_WORD } from '@/lib/validation/whatsapp-numbers';
import type { FormState } from '@/lib/validation/result';

// Removing a number from the Cloud API. Deliberately NOT a button in the table row.
//
// The table is a Server Component with no client JavaScript at all, and the row is
// where someone's eye lands while scanning — which is the worst possible place for
// the one control on this page that stops an event's invitations mid-flight. Here it
// takes a deliberate choice from a list, a typed word, and a second look at what the
// number is currently FOR.
//
// ⚠️ DEREGISTERING SPENDS FROM THE SAME 72-HOUR BUDGET AS REGISTERING. Ten of either
// per number per 72 hours, then Meta blocks the number — so a register/deregister
// cycle burns the window twice as fast as it looks.
//
// Rendered only for the owner. That is the UI half; deregisterNumberAction calls
// requirePlatformOwner itself, because a Server Action is reachable without ever
// rendering this component.

export function MetaNumberManagement({
  numbers,
  deregisterAction,
}: {
  numbers: ProviderNumber[];
  deregisterAction: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [selected, setSelected] = useState('');
  const [state, formAction] = useActionState<FormState, FormData>(
    async (prev, fd) => deregisterAction(prev, fd),
    null,
  );

  // Only numbers Meta actually knows by an id can be deregistered — a backfill row
  // that never got a provider_ref has nothing to send.
  const candidates = numbers.filter(
    (n) => n.provider === 'meta_whatsapp' && n.providerRef !== null,
  );

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        אין מספרי WhatsApp מסונכרנים. לחצו על סנכרון כדי למשוך אותם מ-Meta.
      </p>
    );
  }

  const chosen = candidates.find((n) => n.providerRef === selected);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="deregister-number">המספר להסרה</Label>
        <select
          id="deregister-number"
          name="phoneNumberId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={`${compactSelectClass} w-full`}
        >
          <option value="">— בחרו מספר —</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.providerRef ?? ''}>
              {n.e164 ?? n.providerRef} — {n.displayLabel ?? 'ללא שם'}
            </option>
          ))}
        </select>
      </div>

      {chosen ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>מה ייפסק</AlertTitle>
          <AlertDescription>
            {chosen.roles.length > 0 ? (
              <>
                המספר הזה משמש כרגע ל
                {chosen.roles.length === 1 ? 'תפקיד' : 'תפקידים'}:{' '}
                <strong>{chosen.roles.join(', ')}</strong>. הסרת הרישום עוצרת שליחה
                דרכו מיידית, והתפקידים יישארו מוצמדים למספר שאינו יכול לשלוח.
              </>
            ) : (
              'למספר אין תפקיד פעיל, אך הסרת הרישום עדיין צורכת מהמכסה של 10 פעולות ב-72 שעות.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Label htmlFor="deregister-confirm">
          לאישור, כתבו <span dir="ltr">{CONFIRM_WORD}</span>
        </Label>
        <Input
          id="deregister-confirm"
          name="confirm"
          dir="ltr"
          autoComplete="off"
          aria-invalid={state?.fieldErrors?.confirm ? true : undefined}
        />
        <FieldError errors={state?.fieldErrors?.confirm} />
      </div>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton className="w-auto">הסרת הרישום</SubmitButton>
    </form>
  );
}
