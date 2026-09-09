'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

import { cancelRunAction, deleteWorkflowAction } from './actions';

/**
 * The two destructive controls, sharing one shape with `ArmToggle`: press,
 * transition, and render the server's refusal in place.
 *
 * Both refusals are ORDINARY answers rather than errors — "the workflow is
 * still armed", "the run already started" — so they arrive as a result and are
 * announced with `role="alert"`, because the press causes no navigation and the
 * reason would otherwise be invisible.
 */
function Refusals({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul
      role="alert"
      className="max-w-md list-disc space-y-1 ps-5 text-sm text-destructive"
    >
      {errors.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/**
 * Delete a workflow.
 *
 * Two presses, not a `confirm()`. A native dialog is a modal the SDK's own
 * canvas cannot render behind and screen readers announce inconsistently; a
 * second press in the same place is unambiguous and keyboard-reachable. The
 * armed check and the run-count check both live on the server — this only
 * decides whether to ask twice.
 */
export function DeleteWorkflowButton({ id, name }: { id: string; name: string }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const press = () => {
    setErrors([]);
    if (!armed) {
      setArmed(true);
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', id);
      const result = await deleteWorkflowAction(formData);
      setArmed(false);
      if (!result.ok) setErrors(result.errors);
      // On success the row is gone; `revalidatePath` re-renders the table
      // without it, so there is nothing to update here.
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant={armed ? 'destructive' : 'outline'}
        onClick={press}
        onBlur={() => setArmed(false)}
        disabled={pending}
        aria-label={armed ? `אישור מחיקת "${name}"` : `מחיקת "${name}"`}
      >
        {armed ? 'לחצו שוב לאישור' : 'מחיקה'}
      </Button>
      <Refusals errors={errors} />
    </div>
  );
}

/**
 * Cancel a queued run.
 *
 * Rendered only for a `pending` row — see the comment on `cancelRun`: the
 * vendored runner has no cancellation seam, so a run already executing cannot
 * be stopped and must not be offered a button that implies otherwise.
 */
export function CancelRunButton({
  workflowId,
  runId,
}: {
  workflowId: string;
  runId: string;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    setErrors([]);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('workflowId', workflowId);
      formData.set('runId', runId);
      const result = await cancelRunAction(formData);
      if (!result.ok) setErrors(result.errors);
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
        ביטול
      </Button>
      <Refusals errors={errors} />
    </div>
  );
}
