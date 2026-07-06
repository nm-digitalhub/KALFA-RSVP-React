'use client';

import { useActionState, useState, useTransition } from 'react';

import { FieldError, FormError, FormNotice } from '@/components/forms';
import { recoverFromVersionSkew } from '@/components/use-version-skew-reload';
import type { GuestGroup } from '@/lib/data/guests';
import type { FormState } from '@/lib/validation/result';

import {
  createGroupAction,
  updateGroupAction,
  deleteGroupAction,
} from './guests-actions';

// Groups management for the guests screen: create by free-text name, rename
// inline, delete (the DB FK is ON DELETE SET NULL — assigned guests simply
// move to "ללא קבוצה"). Pure screen wiring: all rules live in the existing
// actions/data layer (groupSchema validation, requireEventAccess, activity
// log); nothing is re-implemented here.

type BoundGroupAction = (
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

const fieldClass =
  'rounded-md border border-border bg-transparent px-3 py-2 text-sm';

function CreateGroupForm({ action }: { action: BoundGroupAction }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="new-group-name" className="sr-only">
          שם קבוצה חדשה
        </label>
        <input
          id="new-group-name"
          name="name"
          type="text"
          required
          placeholder="שם קבוצה חדשה (למשל: משפחה, עבודה)"
          className={`${fieldClass} min-w-56`}
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          הוספת קבוצה
        </button>
      </div>
      <FieldError errors={state?.fieldErrors?.name} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

function GroupRow({ eventId, group }: { eventId: string; group: GuestGroup }) {
  const [state, renameAction] = useActionState(
    updateGroupAction.bind(null, eventId, group.id),
    null,
  );
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onDelete() {
    if (
      !window.confirm(
        'למחוק את הקבוצה? האורחים המשויכים אליה יעברו ל"ללא קבוצה".',
      )
    ) {
      return;
    }
    setFailed(false);
    startTransition(async () => {
      try {
        await deleteGroupAction(eventId, group.id);
      } catch (err) {
        // A stale-deployment action id reloads the tab (shared recovery);
        // anything else keeps the inline "נכשל" indicator.
        if (!recoverFromVersionSkew(err)) setFailed(true);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <form action={renameAction} className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`group-name-${group.id}`}>
          שם הקבוצה
        </label>
        <input
          id={`group-name-${group.id}`}
          name="name"
          type="text"
          required
          defaultValue={group.name}
          className={`${fieldClass} min-w-56`}
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/40"
        >
          שמירת שם
        </button>
      </form>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
      >
        {pending ? 'מוחק…' : 'מחיקה'}
      </button>
      {failed ? <span className="text-xs text-destructive">נכשל</span> : null}
      <FieldError errors={state?.fieldErrors?.name} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </li>
  );
}

export function GroupsManager({
  eventId,
  groups,
}: {
  eventId: string;
  groups: GuestGroup[];
}) {
  return (
    <details className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        ניהול קבוצות ({groups.length})
      </summary>
      <div className="mt-3 space-y-4">
        {/* key: a successful create changes the count → the form remounts and
            clears itself; a validation error keeps the typed value. */}
        <CreateGroupForm
          key={groups.length}
          action={createGroupAction.bind(null, eventId)}
        />
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            אין קבוצות עדיין — צרו קבוצה כאן, או ייבאו קובץ עם עמודת
            &quot;קבוצה&quot;.
          </p>
        ) : (
          <ul className="space-y-2">
            {/* key includes the name: after a rename the row remounts, so the
                uncontrolled input reflects the saved value. */}
            {groups.map((g) => (
              <GroupRow key={`${g.id}:${g.name}`} eventId={eventId} group={g} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
