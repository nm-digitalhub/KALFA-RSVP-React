'use client';

// Ported from the reference app's components/execution/node-markers.tsx and its
// plugin.ts — the small badge that sits inside a node showing what that node did.
//
// It reaches the inside of a node the only way the SDK allows: the
// `OptionalNodeContent` slot, via `registerComponentDecorator`. The slot hands
// the component `props.nodeId`, which is what lets a marker know which node it
// is drawn in.
import { Icon, registerComponentDecorator } from '@workflowbuilder/sdk';

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
    nodeState.status === 'skipped';

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
