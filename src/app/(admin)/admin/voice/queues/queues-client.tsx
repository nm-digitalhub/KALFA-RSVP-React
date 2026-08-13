'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import type { ConsoleAgentOption, ConsoleQueue } from '@/lib/data/console-queues';
import { toggleQueueActiveAction, updateQueueMembersAction } from './actions';

function QueueToggleForm({ queue }: { queue: ConsoleQueue }) {
  const [state, action] = useActionState(toggleQueueActiveAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="queue_id" value={queue.id} />
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={queue.isActive}
          className="size-4 accent-primary"
        />
        פעילה
      </label>
      <SubmitButton className="w-auto">עדכון</SubmitButton>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

function QueueMembersForm({
  queue,
  agents,
  memberIds,
}: {
  queue: ConsoleQueue;
  agents: ConsoleAgentOption[];
  memberIds: string[];
}) {
  const [state, action] = useActionState(updateQueueMembersAction, null);
  const memberSet = new Set(memberIds);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="queue_id" value={queue.id} />
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין נציגי מוקד רשומים.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {agents.map((a) => (
            <li key={a.userId}>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="agent_id"
                  value={a.userId}
                  defaultChecked={memberSet.has(a.userId)}
                  className="size-4 accent-primary"
                />
                {a.displayName}
              </label>
            </li>
          ))}
        </ul>
      )}
      <SubmitButton className="w-auto">עדכון חברים</SubmitButton>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

export function QueuesClient({
  queues,
  agents,
  memberIdsByQueue,
}: {
  queues: ConsoleQueue[];
  agents: ConsoleAgentOption[];
  memberIdsByQueue: Record<string, string[]>;
}) {
  return (
    <div className="space-y-4">
      {queues.map((q) => (
        <section key={q.id} className="space-y-3 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{q.nameHe}</h2>
              <p className="text-xs text-muted-foreground" dir="ltr">
                {q.key}
              </p>
            </div>
            <QueueToggleForm queue={q} />
          </div>
          <div className="border-t border-border pt-3">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">חברי המחלקה</h3>
            <QueueMembersForm queue={q} agents={agents} memberIds={memberIdsByQueue[q.id] ?? []} />
          </div>
        </section>
      ))}
    </div>
  );
}
