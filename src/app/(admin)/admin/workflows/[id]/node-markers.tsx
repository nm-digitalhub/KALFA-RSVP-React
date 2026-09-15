'use client';

// Ported from the reference app's components/execution/node-markers.tsx and its
// plugin.ts — the small badge that sits inside a node showing what that node did.
//
// It reaches the inside of a node the only way the SDK allows: the
// `OptionalNodeContent` slot, via `registerComponentDecorator`. The slot hands
// the component `props.nodeId`, which is what lets a marker know which node it
// is drawn in.
import { Icon, registerComponentDecorator } from '@workflowbuilder/sdk';

// ⚠️ DateTime, NOT `formatIsraelTime`. That one renders the clock alone, and a
// `logic.wait` deadline is routinely days out — "ממתין עד 14:30" on a node that
// wakes on Thursday reads as "in a few hours".
import { formatIsraelDateTime } from '@/lib/date';

import { setLogCollapsed, useExecutionStore } from './use-execution-store';

type Props = {
  props?: { nodeId: string };
};

export function ExecutionNodeMarkers({ props }: Props) {
  const nodeId = props?.nodeId ?? '';
  const nodeState = useExecutionStore((s) => s.nodeStates[nodeId]);

  if (!nodeState || nodeState.status === 'idle') return null;

  const isClickable =
    nodeState.status === 'completed' ||
    nodeState.status === 'failed' ||
    nodeState.status === 'skipped' ||
    // Clickable too, and this is the badge where it matters most: the log line
    // is the only place that says WHEN it wakes.
    nodeState.status === 'waiting';

  // ⚠️ THE SAME DATE MEANS TWO THINGS, so the sentence follows the KIND.
  //
  //   timer    the run RESUMES then    → "ממתין עד …"
  //   event    the run GIVES UP then   → "ממתין לתוצאה · פג ב-…"
  //   neither  say nothing about time  → "ממתין"
  //
  // ⚠️ AND BOTH ARE TESTED EXPLICITLY, never by falling out of the other. An
  // event row written before `waitKind` shipped carries a `resumeAt` and no
  // kind; reading that as a timer would make an old correlated wait announce a
  // resume time it never had. The neutral word is the honest answer — the
  // reader learns the node is parked, and learns nothing false about when.
  const waitingLabel =
    nodeState.resumeAt && nodeState.waitKind === 'event'
      ? `ממתין לתוצאה · פג ב-${formatIsraelDateTime(nodeState.resumeAt)}`
      : nodeState.resumeAt && nodeState.waitKind === 'timer'
        ? `ממתין עד ${formatIsraelDateTime(nodeState.resumeAt)}`
        : 'ממתין';

  // Clicking also selects the node on the canvas, which is what drives the log
  // panel's highlight and scroll-into-view — so the badge is the way from "this
  // node looks wrong" to "here is the line that says why".
  return (
    <div
      className={`pointer-events-auto absolute end-1 top-1 ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={isClickable ? () => setLogCollapsed(false) : undefined}
    >
      {nodeState.status === 'running' && (
        <span
          className="inline-block animate-spin text-[color:var(--kalfa-wf-edge-color--active)]"
          aria-label="רץ"
        >
          <Icon name="CircleNotch" />
        </span>
      )}
      {nodeState.status === 'waiting' && (
        // NOT the spinner. A parked node is not working — it is a row with a
        // deadline and a job that has not fired — and an animation says the
        // opposite of that to anyone glancing at the canvas.
        <span
          className="text-[color:var(--kalfa-wf-edge-color--active)]"
          aria-label={waitingLabel}
          title={waitingLabel}
        >
          <Icon name="ClockCountdown" />
        </span>
      )}
      {nodeState.status === 'completed' && (
        <span
          className="text-[color:var(--kalfa-wf-status-color--completed)]"
          aria-label="הושלם"
        >
          <Icon name="FlagBannerFold" />
        </span>
      )}
      {nodeState.status === 'failed' && (
        <span className="text-[color:var(--kalfa-wf-status-color--failed)]" aria-label="נכשל">
          <Icon name="WarningDiamond" />
        </span>
      )}
      {nodeState.status === 'skipped' && (
        <span className="text-muted-foreground" aria-label="דולג">
          <Icon name="SkipForward" />
        </span>
      )}
    </div>
  );
}

// ⚠️ NOT DONE HERE, ON PURPOSE. Upstream's own execution-visualisation guidance
// asks a node badge for six things; this shows two of them — state, and what a
// waiting node waits on. The two still missing are UX follow-ups rather than
// contract gaps, and both were left out of the `node_waiting` fix deliberately
// so it stayed one change:
//
//   Time elapsed  — needs no engine work. Every event already carries a
//                   `timestamp`, and the store keeps them all, so
//                   node_started → node_completed is a client-side subtraction.
//   Retry count   — partial. The vendored runner flattens a throw to
//                   `{ message, code, attempt }`, so `error.attempt` reaches us
//                   on `node_failed`. A run redelivered by pg-boss emits no node
//                   event at all, so that half would need an engine change.

/**
 * The plugin that mounts the markers.
 *
 * `name` is passed deliberately: the registries are module-global singletons and
 * `registerComponentDecorator` is side-effecting, so under Fast Refresh a
 * nameless registration accumulates one copy per edit — three badges on every
 * node in dev. The name is the only thing that deduplicates it.
 */
export function executionMarkersPlugin(): void {
  registerComponentDecorator('OptionalNodeContent', {
    content: ExecutionNodeMarkers,
    name: 'kalfa-execution-markers',
  });
}
