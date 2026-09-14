'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

import { setWorkflowActiveAction } from './actions';

/**
 * Arm / disarm, and the place the conversion errors become visible.
 *
 * Arming is refused when the graph fails the contract, and the reason has to
 * reach the owner — "nothing happened" would be the worst possible response to
 * pressing a switch. Disarming is never refused: a workflow that misbehaves must
 * always be switchable off, whatever state its graph is in.
 */
export function ArmToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    setErrors([]);
    setNotice(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', id);
      formData.set('isActive', String(!isActive));
      const result = await setWorkflowActiveAction(formData);
      if (!result.ok) setErrors(result.errors);
      // Arming can do one thing BESIDES arming — claim the guest-list role for
      // the number the trigger names — and that changes how every inbound
      // message routes. It must not pass without a word.
      else if (result.notice) setNotice(result.notice);
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant={isActive ? 'outline' : 'default'}
        onClick={toggle}
        disabled={pending}
      >
        {isActive ? 'כיבוי' : 'הפעלה'}
      </Button>

      {notice && (
        <p
          // Announced for the same reason as the error list: it arrives after
          // the press, with no navigation to signal it.
          role="status"
          className="max-w-md text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}

      {errors.length > 0 && (
        <ul
          // Announced, because the failure arrives after the press with no
          // navigation to signal it.
          role="alert"
          className="max-w-md list-disc space-y-1 ps-5 text-sm text-destructive"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
