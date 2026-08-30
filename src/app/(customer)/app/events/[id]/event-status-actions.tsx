'use client';

import { useActionState } from 'react';

import { Button, type buttonVariants } from '@/components/ui/button';
import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import type { EventStatus } from '@/lib/data/events';
import type { VariantProps } from 'class-variance-authority';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

// Shared Button/buttonVariants — same component the page's nav links (ניהול
// מוזמנים/סטטיסטיקות) already use — so every action on this page shares one
// height/radius/variant system instead of two subtly mismatched ones
// (verified gap, 2026-08-30: this used to hand-roll its own className,
// rounded-md instead of the shared rounded-lg, no fixed height). Plus a
// disabled state with an explanatory hint (R7's "close blocked" case).
function ActionButton({
  action,
  label,
  confirm,
  variant = 'outline',
  disabled,
  disabledHint,
}: {
  action: BoundAction;
  label: string;
  confirm?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-2">
      <Button
        type="submit"
        variant={variant}
        disabled={disabled}
        onClick={
          confirm
            ? (e) => {
                if (!window.confirm(confirm)) e.preventDefault();
              }
            : undefined
        }
      >
        {label}
      </Button>
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
          variant="default"
          disabled={!canPublish}
          disabledHint={!canPublish ? 'יש להגדיר תאריך אירוע עתידי לפני הפרסום' : undefined}
        />
      ) : null}
      {status === 'active' ? (
        <ActionButton
          action={closeAction}
          label="סגירת האירוע"
          variant="destructive"
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
