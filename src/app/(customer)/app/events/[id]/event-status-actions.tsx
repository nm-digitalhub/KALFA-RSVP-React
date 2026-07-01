'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { EventStatus } from '@/lib/data/events';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

// Mirrors campaign/[campaignId]/manage-client.tsx's ActionButton, plus a
// disabled state with an explanatory hint (R7's "close blocked" case).
function ActionButton({
  action,
  label,
  confirm,
  variant = 'default',
  disabled,
  disabledHint,
}: {
  action: BoundAction;
  label: string;
  confirm?: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const cls =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:opacity-90'
      : variant === 'danger'
        ? 'border border-destructive/40 text-destructive hover:bg-destructive/10'
        : 'border border-border hover:bg-accent/40';
  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={disabled}
        onClick={
          confirm
            ? (e) => {
                if (!window.confirm(confirm)) e.preventDefault();
              }
            : undefined
        }
        className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
      >
        {label}
      </button>
      {disabled && disabledHint ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// R6: status changes only through these two explicit transitions — never a
// free dropdown. `closed` is terminal (R6) — no actions once closed.
export function EventStatusActions({
  status,
  canPublish,
  hasBlockingCampaign,
  publishAction,
  closeAction,
}: {
  status: EventStatus;
  canPublish: boolean;
  hasBlockingCampaign: boolean;
  publishAction: BoundAction;
  closeAction: BoundAction;
}) {
  if (status === 'closed') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'draft' ? (
        <ActionButton
          action={publishAction}
          label="פרסום האירוע"
          variant="primary"
          disabled={!canPublish}
          disabledHint={!canPublish ? 'יש להגדיר תאריך אירוע עתידי לפני הפרסום' : undefined}
        />
      ) : null}
      {status === 'active' ? (
        <ActionButton
          action={closeAction}
          label="סגירת האירוע"
          variant="danger"
          confirm="לסגור את האירוע? לא ניתן לבטל פעולה זו."
          disabled={hasBlockingCampaign}
          disabledHint={
            hasBlockingCampaign
              ? 'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע'
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
