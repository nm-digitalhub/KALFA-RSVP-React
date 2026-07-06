'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FormError, FormNotice } from '@/components/forms';
import type {
  ImportMatch,
  MergeFieldDiff,
  MergeFieldKey,
} from '@/lib/data/guests';
import type { FormState } from '@/lib/validation/result';

type BoundAction = (prev: FormState, formData: FormData) => Promise<FormState>;

const FIELD_LABELS: Record<MergeFieldKey, string> = {
  full_name: 'שם',
  group: 'קבוצה',
  expected_count: 'כמות',
};

function SubmitButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        danger
          ? 'rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60'
          : 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60'
      }
    >
      {pending ? 'רגע…' : label}
    </button>
  );
}

// One per-field checkbox. Default follows the diff: fill-a-gap → checked,
// overwrite-an-existing-value → unchecked. The owner can always flip it.
function FieldChoice({ id, diff }: { id: string; diff: MergeFieldDiff }) {
  return (
    <label className="flex items-start gap-2 ps-6 text-xs">
      <input
        type="checkbox"
        name={`field_${id}_${diff.field}`}
        defaultChecked={diff.fill}
        className="mt-0.5"
      />
      <span>
        {FIELD_LABELS[diff.field]}:{' '}
        <bdi className="font-medium">{diff.incoming}</bdi>{' '}
        <span className="text-muted-foreground">
          (נוכחי: <bdi>{diff.existing || 'ריק'}</bdi>)
        </span>
      </span>
    </label>
  );
}

function MatchCard({ m }: { m: ImportMatch }) {
  const id = m.existingGuestId;

  if (m.direction === 'name') {
    // opt-OUT: checked by default → merge (adds the phone). Uncheck → import as
    // a new, separate guest.
    return (
      <div className="space-y-1.5">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name={`merge_${id}`}
            defaultChecked
            className="mt-1"
          />
          <span>
            לאחד את <bdi className="font-medium">{m.incomingName}</bdi> עם המוזמן
            הקיים <bdi className="font-medium">{m.existingName}</bdi>
            {m.addsPhone ? (
              <>
                {' '}— הוספת הטלפון{' '}
                <bdi dir="ltr" className="font-medium">
                  {m.addsPhone}
                </bdi>
              </>
            ) : null}{' '}
            (אחרת ייובא כמוזמן חדש)
          </span>
        </label>
        {m.fields.length > 0 ? (
          <div className="space-y-1">
            <p className="ps-6 text-xs text-muted-foreground">
              בחרו אילו פרטים לעדכן:
            </p>
            {m.fields.map((f) => (
              <FieldChoice key={f.field} id={id} diff={f} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // phone-match: the row can never be inserted (unique phone) → always dropped.
  // opt-IN per field; no field ticked ⇒ the row is simply skipped.
  return (
    <div className="space-y-1.5">
      <p>
        הטלפון של <bdi className="font-medium">{m.incomingName}</bdi> כבר שייך
        למוזמן <bdi className="font-medium">{m.existingName}</bdi>
        {m.fields.length === 0
          ? ' — כבר קיים, השורה תדולג.'
          : ' — בחרו אילו פרטים לעדכן (אחרת ידולג):'}
      </p>
      {m.fields.map((f) => (
        <FieldChoice key={f.field} id={id} diff={f} />
      ))}
    </div>
  );
}

export function StagingActions({
  confirm,
  discard,
  matches = [],
}: {
  confirm: BoundAction;
  discard: BoundAction;
  matches?: ImportMatch[];
}) {
  const [confirmState, confirmAction] = useActionState(confirm, null);
  const [discardState, discardAction] = useActionState(discard, null);
  const state = confirmState ?? discardState;

  return (
    <div className="space-y-2">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <div className="flex flex-wrap items-start gap-2">
        <form action={confirmAction} className="flex-1 space-y-3">
          {matches.length > 0 ? (
            <fieldset className="space-y-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <legend className="px-1 font-medium">
                נמצאו התאמות למוזמנים קיימים
              </legend>
              {matches.map((m) => (
                <MatchCard
                  key={`${m.direction}_${m.existingGuestId}_${m.rowIndex}`}
                  m={m}
                />
              ))}
            </fieldset>
          ) : null}
          <SubmitButton label="אישור ייבוא" />
        </form>
        <form action={discardAction}>
          <SubmitButton label="מחיקה" danger />
        </form>
      </div>
    </div>
  );
}
