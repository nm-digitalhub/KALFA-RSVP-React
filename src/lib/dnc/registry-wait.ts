import type { PgBoss } from 'pg-boss';

import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { CALL_RETRY } from '@/lib/queue/queues';

// Waiting out an unavailable Do-Not-Call registry (openspec/changes/dnc-registry-dial-gate, D5).
//
// A dispatcher that gets `registry_pending` has not created a call attempt and has not called the provider — the
// registry gate runs inside the consent gates, before both. The worker would otherwise complete the job and the call
// would be dropped for good (every skip completes the job: worker/main.ts). Instead the same payload is sent again
// after REGISTRY_WAIT_SECONDS, up to REGISTRY_MAX_WAITS times (one hour), and only then settles as skipped.
//
// No double dial is possible: nothing was dialled, and each re-send has its own deterministic id per wait, so a
// redelivered job cannot enqueue the same wait twice.

export const REGISTRY_WAIT_SECONDS = 600;
export const REGISTRY_MAX_WAITS = 6;

export type RegistryWaitable = { registryWaits?: number };

/** The next wait count, or null when the waits are used up. */
export function nextRegistryWait(waits: number | undefined): number | null {
  const done = waits ?? 0;
  return done >= REGISTRY_MAX_WAITS ? null : done + 1;
}

export function registryWaitJobId(queue: string, key: string, wait: number): string {
  return deterministicJobId(`registry-wait:${queue}:${key}:${wait}`);
}

/**
 * Re-sends `data` after the wait. Returns false when the waits are used up — the caller then lets the job complete as
 * a final skip.
 */
export async function deferForRegistry<T extends RegistryWaitable>(
  boss: Pick<PgBoss, 'send'>,
  queue: string,
  key: string,
  data: T,
): Promise<boolean> {
  const wait = nextRegistryWait(data.registryWaits);
  if (wait === null) return false;
  await boss.send(queue, { ...data, registryWaits: wait }, {
    id: registryWaitJobId(queue, key, wait),
    startAfter: REGISTRY_WAIT_SECONDS,
    ...CALL_RETRY,
  });
  return true;
}
