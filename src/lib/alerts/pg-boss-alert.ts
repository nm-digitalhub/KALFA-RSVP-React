import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { describePgError, PG_ERROR_MEANING } from '@/lib/queue/pg-error';

// The Slack alert for a pg-boss `error` event, one per failure CLASS and PROCESS.
//
// sendSlackAlert de-duplicates on level|title|source, so putting the class in the
// title and the process in the source gives each (class, process) pair its own
// window: a read ETIMEDOUT in the worker no longer hides the connect timeout in
// the web tier that follows it, and neither is hidden by a burst of the other.
//
// What is sent: the class, what it means, the Node `code`/`syscall`, the queue
// name and the process name. Never the error's message — pg errors can quote a
// user, a host or a connection string — which stays in the process log. Never
// throws (sendSlackAlert is fail-safe), so the listener may call it un-awaited.
export async function reportPgBossError(err: unknown, processName: string): Promise<void> {
  const info = describePgError(err);
  await sendSlackAlert({
    level: 'error',
    title: `pg-boss error: ${info.class}`,
    source: `pgboss/${processName}`,
    detail: PG_ERROR_MEANING[info.class],
    fields: {
      process: processName,
      class: info.class,
      ...(info.code && { code: info.code }),
      ...(info.syscall && { syscall: info.syscall }),
      ...(info.queue && { queue: info.queue }),
    },
    category: 'errors',
  });
}
