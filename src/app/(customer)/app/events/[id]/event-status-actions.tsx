'use client';

import { useActionState, useRef, useState } from 'react';

import { Button, type buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      {confirm ? (
        // The dialog is portaled outside the form, so its confirm button
        // submits the form explicitly (same action as the plain submit below).
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger
            disabled={disabled}
            render={<Button type="button" variant={variant} />}
          >
            {label}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                onClick={() => {
                  setConfirmOpen(false);
                  formRef.current?.requestSubmit();
                }}
              >
                {label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button type="submit" variant={variant} disabled={disabled}>
          {label}
        </Button>
      )}
      {disabled && disabledHint ? (
        <p className="text-xs text-muted-foreground">{disabledHint}</p>
      ) : null}
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// R6: the owner's only direct status transition here is the close (destructive).
// Confirming the details (draft → active) lives in the setup steps above, as
// the first step of the RSVP flow. `closed` is terminal — no actions once closed.
export function EventStatusActions({
  status,
  hasBlockingCampaign,
  closeAction,
}: {
  status: EventStatus;
  hasBlockingCampaign: boolean;
  closeAction: BoundAction;
}) {
  if (status !== 'active') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        action={closeAction}
        label="סגירת האירוע"
        variant="destructive"
        confirm="לסגור את האירוע? לא ניתן לבטל פעולה זו."
        disabled={hasBlockingCampaign}
        disabledHint={
          hasBlockingCampaign ? 'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע' : undefined
        }
      />
    </div>
  );
}
