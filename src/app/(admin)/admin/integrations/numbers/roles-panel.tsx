'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton, compactSelectClass } from '@/components/forms';
import type { ProviderNumber } from '@/lib/data/admin/integrations/provider-numbers';
import {
  NUMBER_ROLES,
  PROVIDER_LABELS,
  ROLE_LABELS,
  type NumberRole,
} from '@/lib/validation/provider-numbers';
import type { FormState } from '@/lib/validation/result';

// ONE ROW PER ROLE, not per number — and the shape follows the database rather than
// the other way round. provider_number_roles' PRIMARY KEY is `role` alone, so a role
// is held by exactly one number BY CONSTRUCTION, and "which number sends the RSVP
// invitations" has one answer. A per-number "add a role" menu would let someone build
// a mental model where a role can be in two places, which the table would then refuse.
//
// It also shows what the numbers table structurally cannot: a role held by NOBODY. An
// unassigned role resolves to null at runtime and the caller falls back to whatever it
// used before this table existed — silently. This list is where that becomes visible.
//
// Reassignment is a single change of the select: the action upserts on `role`, so
// there is no state in between where two numbers claim it and no cleanup to forget.

function numberLabel(n: ProviderNumber): string {
  const who = n.displayLabel ?? PROVIDER_LABELS[n.provider];
  return n.e164 ? `${n.e164} — ${who}` : `${who} (${n.providerRef ?? '—'})`;
}

function RoleRow({
  role,
  numbers,
  currentId,
  onAssign,
}: {
  role: NumberRole;
  numbers: ProviderNumber[];
  currentId: string | null;
  onAssign: (formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => onAssign(formData),
    null,
  );

  return (
    <div className="space-y-2 border-b border-border py-3 last:border-b-0">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="role" value={role} />
        <label htmlFor={`role-${role}`} className="min-w-52 text-sm font-medium">
          {ROLE_LABELS[role]}
        </label>
        <select
          id={`role-${role}`}
          name="numberId"
          defaultValue={currentId ?? ''}
          className={compactSelectClass}
          disabled={pending}
        >
          {/* An explicit "nobody" option rather than a separate delete button: the
              two operations are one decision — which number holds this role — and
              splitting them invites assigning without noticing what was displaced. */}
          <option value="">— ללא שיוך —</option>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>
              {numberLabel(n)}
            </option>
          ))}
        </select>
        <SubmitButton className="w-auto">שמירה</SubmitButton>
        {currentId === null ? (
          <span className="text-xs text-amber-600">
            לא משויך — הקריאה בזמן ריצה תיפול לברירת המחדל הישנה
          </span>
        ) : null}
      </form>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </div>
  );
}

export function RolesPanel({
  numbers,
  onAssign,
}: {
  numbers: ProviderNumber[];
  onAssign: (formData: FormData) => Promise<FormState>;
}) {
  // Built from the ROLE list, not from the assignments, so a role nobody holds still
  // gets a row. Deriving the rows from provider_number_roles would hide exactly the
  // case worth seeing.
  const holder = new Map<NumberRole, string>();
  for (const n of numbers) {
    for (const role of n.roles) holder.set(role, n.id);
  }

  return (
    <div className="divide-y divide-border">
      {NUMBER_ROLES.map((role) => (
        <RoleRow
          key={role}
          role={role}
          numbers={numbers}
          currentId={holder.get(role) ?? null}
          onAssign={onAssign}
        />
      ))}
    </div>
  );
}
