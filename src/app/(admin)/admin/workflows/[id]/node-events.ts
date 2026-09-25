import { flatten } from 'flat';

import type { StreamEvent } from '@/lib/workflow/execution-events';

// Two readings of the run's event list, both driven by the DATA, never by the
// event type:
//
//   * `nodeAttempts` — everything one step did in the run, one entry per time it
//     ran. The vendor's execution-visualisation guidance puts this in "a side
//     panel that opens when the user clicks a node, with the full event log for
//     that step" (docs/workflowbuilder/workflowbuilder.io-md/blog/
//     live-workflow-execution-visualization.html.md). `nodeStates` in the store
//     keeps only the LATEST state per node, so a step that ran twice showed its
//     second run and lost its first.
//
//   * `measureInfo` — how much there is to show for a value, so the log can
//     print a short one inline and summarise a long one (owner, 25.9: by amount
//     of information, not by which event carried it).

export type AttemptStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'skipped';

export type NodeAttempt = {
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
  /** Only when both ends are known and the clock moved — see below. */
  durationMs?: number;
  output?: unknown;
  error?: { message: string; code?: string };
  resumeAt?: string;
  waitKind?: 'timer' | 'event';
  skipReason?: string;
};

type Payload = {
  output?: unknown;
  error?: { message: string; code?: string };
  resumeAt?: unknown;
  waitKind?: unknown;
  reason?: unknown;
};

const isOpen = (attempt: NodeAttempt | undefined) =>
  attempt !== undefined && (attempt.status === 'running' || attempt.status === 'waiting');

function close(attempt: NodeAttempt, event: StreamEvent) {
  attempt.endedAt = event.timestamp;
  if (attempt.startedAt) {
    const ms = Date.parse(event.timestamp) - Date.parse(attempt.startedAt);
    // ⚠️ ZERO IS NOT A DURATION HERE. A dry run stamps every event with one
    // timestamp (`buildDryRunEvents`), so 0 means "not measured", and printing
    // "0 שניות" would state something the engine never measured.
    if (Number.isFinite(ms) && ms > 0) attempt.durationMs = ms;
  }
}

/** Every run of `nodeId` in this event list, oldest first. */
export function nodeAttempts(events: readonly StreamEvent[], nodeId: string): NodeAttempt[] {
  const attempts: NodeAttempt[] = [];

  for (const event of events) {
    if (event.nodeId !== nodeId) continue;
    const payload = event.payload as Payload | undefined;
    const last = attempts.at(-1);
    // A terminal event with no open attempt — a row recorded without its start —
    // still becomes an entry of its own rather than being dropped.
    const current = (): NodeAttempt => {
      if (isOpen(last)) return last as NodeAttempt;
      const fresh: NodeAttempt = { status: 'running' };
      attempts.push(fresh);
      return fresh;
    };

    switch (event.type) {
      case 'node_started':
        attempts.push({ status: 'running', startedAt: event.timestamp });
        break;
      case 'node_waiting': {
        const attempt = current();
        attempt.status = 'waiting';
        if (typeof payload?.resumeAt === 'string') attempt.resumeAt = payload.resumeAt;
        if (payload?.waitKind === 'timer' || payload?.waitKind === 'event') {
          attempt.waitKind = payload.waitKind;
        }
        break;
      }
      case 'node_completed': {
        const attempt = current();
        attempt.status = 'completed';
        if (payload && 'output' in payload) attempt.output = payload.output;
        close(attempt, event);
        break;
      }
      case 'node_failed': {
        const attempt = current();
        attempt.status = 'failed';
        if (payload?.error) attempt.error = payload.error;
        close(attempt, event);
        break;
      }
      case 'node_skipped': {
        const attempt: NodeAttempt = { status: 'skipped', endedAt: event.timestamp };
        if (typeof payload?.reason === 'string') attempt.skipReason = payload.reason;
        attempts.push(attempt);
        break;
      }
    }
  }

  return attempts;
}

// ── amount of information ───────────────────────────────────────────────────

/** Past this many characters a value no longer fits on a log row. */
export const INLINE_MAX_CHARS = 120;

export type InfoAmount =
  | { kind: 'none' }
  | { kind: 'short'; text: string }
  | { kind: 'long'; summary: string };

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * How much there is to show for `value`, measured on the value itself.
 *
 * Nothing → `none`. Fits one row → `short` with the text to print. Longer →
 * `long` with a summary: the number of fields for an object, the opening of the
 * text for a string. The full value is in the step's panel.
 */
export function measureInfo(value: unknown): InfoAmount {
  if (value === undefined || value === null) return { kind: 'none' };
  if (typeof value === 'string' && value.trim() === '') return { kind: 'none' };
  if (typeof value === 'object' && Object.keys(value).length === 0) return { kind: 'none' };

  const text = textOf(value);
  if (text.length <= INLINE_MAX_CHARS) return { kind: 'short', text };

  if (typeof value === 'object') {
    const fields = Object.keys(flatten<unknown, Record<string, unknown>>(value)).length;
    return { kind: 'long', summary: fields === 1 ? 'שדה אחד' : `${fields} שדות` };
  }
  return { kind: 'long', summary: `${text.slice(0, INLINE_MAX_CHARS)}…` };
}

/** "3.2 שניות", "2 דקות ו-5 שניות" — for a step's duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return 'פחות משנייה';
  const totalSeconds = Math.round(ms / 100) / 10;
  if (totalSeconds < 60) return `${totalSeconds} שניות`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  const minutesText = minutes === 1 ? 'דקה' : `${minutes} דקות`;
  return seconds === 0 ? minutesText : `${minutesText} ו-${seconds} שניות`;
}
