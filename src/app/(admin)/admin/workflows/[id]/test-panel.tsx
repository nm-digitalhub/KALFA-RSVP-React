'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DRY_RUN_GUEST_CASES,
  type DryRunGuestCase,
  type DryRunResult,
} from '@/lib/workflow/engine/dry-run';

import { testWorkflowAction } from '../actions';

import { applyDryRunTrace, resetExecution } from './use-execution-store';

// The controls the reference app puts on the canvas (Play / Stop / Reset), with
// the one difference that matters: theirs executes for real against a live
// backend, this executes against nothing.
//
// A workflow fires on a guest's message and changes their RSVP. "Arm it and see"
// is not an acceptable way to find out whether the graph is right, so this runs
// the SAVED definition through the same adapter, the same runGraph and the same
// step handlers, with only the three ports swapped — and reports what it WOULD
// have done instead of doing it.

const GUEST_CASE_LABEL: Record<DryRunGuestCase, string> = {
  one: 'אורח אחד מאחורי הטלפון',
  none: 'אין אורח מאחורי הטלפון',
  several: 'כמה אורחים מאחורי הטלפון',
};

const OUTCOME_LABEL: Record<string, string> = {
  completed: 'הושלם',
  incomplete: 'נגמר חלקית',
  failed: 'נכשל',
};

export function TestPanel({ workflowId }: { workflowId: string }) {
  const [messageText, setMessageText] = useState('כן');
  const [buttonPayload, setButtonPayload] = useState('');
  const [guestCase, setGuestCase] = useState<DryRunGuestCase>('one');
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    setResult(null);
    resetExecution();
    startTransition(async () => {
      try {
        const next = await testWorkflowAction(workflowId, {
          messageText,
          buttonPayload,
          guestCase,
        });
        setResult(next);
        // Feed the canvas. The trace goes into the same store the live stream
        // writes to, so highlighting, node markers and the log cannot tell a
        // test from a real run — and neither can a bug in one of them hide in
        // the other.
        applyDryRunTrace({
          outcome: next.outcome,
          steps: next.steps,
          skippedNodeIds: next.skippedNodeIds,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'הרצת הבדיקה נכשלה');
      }
    });
  };

  const clear = () => {
    setResult(null);
    setError(null);
    resetExecution();
  };

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">הרצת בדיקה</h2>
        <span className="text-sm text-muted-foreground">
          הבדיקה משתמשת בגרסה השמורה. שמרו את השינויים לפני הרצה. לא נשלחת הודעה ולא משתנים אורחים.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-sm text-muted-foreground">תוכן ההודעה</span>
          <input
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            maxLength={4096}
            className="min-h-11 w-64 max-w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-sm text-muted-foreground">כפתור שנלחץ</span>
          <input
            value={buttonPayload}
            onChange={(e) => setButtonPayload(e.target.value)}
            maxLength={256}
            placeholder="rsvp_attending"
            className="min-h-11 w-48 max-w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-sm text-muted-foreground">תרחיש</span>
          <select
            value={guestCase}
            onChange={(e) => setGuestCase(e.target.value as DryRunGuestCase)}
            className="min-h-11 w-64 max-w-full rounded-md border border-input bg-background px-3"
          >
            {DRY_RUN_GUEST_CASES.map((c) => (
              <option key={c} value={c}>
                {GUEST_CASE_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <Button type="button" onClick={run} disabled={pending}>
          {pending ? 'רץ…' : 'הרצה'}
        </Button>
        {result && (
          <Button type="button" variant="outline" onClick={clear} disabled={pending}>
            ניקוי
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium">תוצאה: </span>
            {OUTCOME_LABEL[result.outcome.status] ?? result.outcome.status}
            {result.outcome.status === 'failed' && ` — ${result.outcome.message}`}
          </p>

          {result.effects.length > 0 ? (
            <div>
              <p className="font-medium">מה היה קורה באמת:</p>
              <ul className="list-disc space-y-1 ps-5">
                {result.effects.map((effect, i) => (
                  <li key={i}>{effect.description}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              התהליך לא היה משנה שום אורח בתרחיש הזה.
            </p>
          )}

          {result.skippedNodeIds.length > 0 && (
            <p className="text-muted-foreground">
              צעדים שלא רצו: {result.skippedNodeIds.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
