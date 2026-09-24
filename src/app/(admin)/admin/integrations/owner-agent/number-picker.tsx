'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Badge } from '@/components/ui/badge';
import type { OwnerAgentNumber } from '@/lib/data/admin/owner-agent';
import { ROLE_LABELS, type NumberRole } from '@/lib/validation/provider-numbers';

import { setOwnerAgentNumberAction } from './actions';

// Which of OUR Meta numbers the agent answers on (plan §3.3). Every ACTIVE number on
// the WABA is offered, guest-serving ones included — owner decisions 2026-09-24 — and
// each says what it already does, so choosing the RSVP sender is an informed choice
// rather than a surprise. An inactive number appears only when it is the saved choice
// (the DAL filters), marked, so the owner sees the agent is bound to a dead number.
//
// Radios, not a <select>: an <option> cannot hold the role and "inactive" tags, and a
// native radio group is keyboard-operable (arrow keys) with no portal to get wrong in
// RTL. The value is Meta's phone_number_id; the number itself is shown masked only.

// The roles a person choosing a number needs to hear about in plain words. Anything
// else keeps its catalogue label rather than going unmentioned.
const ROLE_TAGS: Partial<Record<NumberRole, string>> = {
  whatsapp_rsvp_sender: 'משמש גם לאורחים',
  whatsapp_import_sender: 'משמש גם לקליטת רשימות אורחים',
};

function roleTag(role: NumberRole): string {
  return ROLE_TAGS[role] ?? ROLE_LABELS[role];
}

/** The consequence of the current choice, in the words of plan §3.3 and decision 9.15. */
function ChoiceNote({ chosen }: { chosen: OwnerAgentNumber | null }) {
  if (!chosen) return null;
  const lines: string[] = [];
  if (chosen.roles.includes('whatsapp_rsvp_sender')) {
    lines.push('הודעות מהטלפונים ברשימת ההיתר למספר הזה יגיעו לסוכן. אורחים אחרים לא מושפעים.');
    lines.push(
      'טלפון שברשימת ההיתר וגם מוזמן לאירוע לא יוכל לאשר הגעה בוואטסאפ במספר הזה, רק דרך הקישור.',
    );
  } else if (chosen.roles.length > 0) {
    lines.push(
      'המספר משמש גם לתפקיד אחר. הודעות מהטלפונים ברשימת ההיתר למספר הזה יגיעו לסוכן; הודעות של כל שולח אחר ימשיכו כמו היום.',
    );
  }
  if (!chosen.isActive) {
    lines.push('המספר השמור כבר לא פעיל, והודעות אליו לא יגיעו לסוכן. יש לבחור מספר פעיל או "ללא".');
  }
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

const optionClass =
  'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2';

export function NumberPicker({
  numbers,
  selected,
}: {
  numbers: OwnerAgentNumber[];
  selected: string | null;
}) {
  const [state, action] = useActionState(setOwnerAgentNumberAction, null);
  const [choice, setChoice] = useState<string>(selected ?? '');
  const chosen = numbers.find((n) => n.providerRef === choice) ?? null;
  // A saved id that no longer matches any row (the number was removed from the
  // table). Offered as its own option so the form never silently posts "none".
  const orphanId =
    selected !== null && !numbers.some((n) => n.providerRef === selected) ? selected : null;

  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">המספר שהסוכן עונה בו</legend>

        <label className={optionClass}>
          <input
            type="radio"
            name="phoneNumberId"
            value=""
            checked={choice === ''}
            onChange={() => setChoice('')}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">ללא</span>
            <span className="block text-xs text-muted-foreground">
              אין הסטה לסוכן בכלל. ה-webhook מתנהג בדיוק כמו לפני הפיצ&apos;ר.
            </span>
          </span>
        </label>

        {numbers.map((n) => (
          <label key={n.providerRef} className={optionClass}>
            <input
              type="radio"
              name="phoneNumberId"
              value={n.providerRef}
              checked={choice === n.providerRef}
              onChange={() => setChoice(n.providerRef)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium wrap-anywhere">{n.label ?? 'ללא שם'}</span>
                {/* An LTR token inside a Hebrew line: without dir the mask's digits
                    reorder around the asterisks. */}
                <span dir="ltr" className="text-sm tabular-nums text-muted-foreground">
                  {n.maskedNumber}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {n.roles.map((role) => (
                  <Badge key={role} variant="info">
                    {roleTag(role)}
                  </Badge>
                ))}
                {!n.isActive ? <Badge variant="warning">לא פעיל</Badge> : null}
              </span>
            </span>
          </label>
        ))}

        {orphanId !== null ? (
          <label className={optionClass}>
            <input
              type="radio"
              name="phoneNumberId"
              value={orphanId}
              checked={choice === orphanId}
              onChange={() => setChoice(orphanId)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">המספר השמור</span>
              <span className="block text-xs text-destructive">
                אינו מופיע עוד ברשימת מספרי ה-WhatsApp. יש לבחור מספר אחר או &quot;ללא&quot;.
              </span>
            </span>
          </label>
        ) : null}
      </fieldset>

      {numbers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          אין מספרי WhatsApp רשומים. אפשר לסנכרן אותם מ-Meta בעמוד המספרים.
        </p>
      ) : null}

      <div aria-live="polite">
        <ChoiceNote chosen={chosen} />
      </div>

      <FieldError errors={state?.fieldErrors?.phoneNumberId} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton className="w-auto">שמירת הבחירה</SubmitButton>
    </form>
  );
}
