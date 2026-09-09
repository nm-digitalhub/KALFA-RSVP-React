'use client';

// Ported from the reference app's components/execution/log-panel.tsx.
//
// Behaviour kept verbatim: collapsible header carrying the run status,
// per-event rows, click-to-expand detail, skip reasons spelled out, stick-to-
// bottom that yields the moment the reader scrolls up, and scroll-into-view when
// a node is selected on the canvas.
//
// Styling is Tailwind rather than CSS modules — that is this project's idiom,
// and the panel's own colours come from the same --kalfa-wf-status-* tokens the
// highlighting defines, so the log and the canvas agree on what "failed" looks
// like. Labels are Hebrew.
import { useSingleSelectedElement } from '@workflowbuilder/sdk';
import { useEffect, useRef, useState } from 'react';

import { formatIsraelTime } from '@/lib/date';
import type { StreamEvent } from '@/lib/workflow/execution-events';

import { toggleLog, useExecutionStore } from './use-execution-store';

const SKIP_REASON_LABEL: Record<string, string> = {
  branch_not_taken: 'הענף לא נבחר',
  upstream_skipped: 'הצעד שלפניו לא רץ',
  error_route_not_taken: 'ענף השגיאה לא נדרש',
};

const EVENT_LABEL: Record<string, string> = {
  execution_started: 'ההרצה התחילה',
  execution_completed: 'ההרצה הושלמה',
  execution_incomplete: 'ההרצה נגמרה חלקית',
  execution_failed: 'ההרצה נכשלה',
  execution_cancelled: 'ההרצה בוטלה',
  node_started: 'צעד התחיל',
  node_completed: 'צעד הושלם',
  node_failed: 'צעד נכשל',
  node_skipped: 'צעד דולג',
};

const STATUS_LABEL: Record<string, string> = {
  idle: 'ממתין',
  pending: 'בהמתנה',
  running: 'רץ',
  completed: 'הושלם',
  incomplete: 'חלקי',
  failed: 'נכשל',
  cancelled: 'בוטל',
  disconnected: 'החיבור אבד',
};

const DETAIL_PREVIEW_CHARS = 120;
const AT_BOTTOM_TOLERANCE_PX = 4;

/** The one line worth showing for an event, or nothing. */
function detailFor(event: StreamEvent): string | undefined {
  const payload = event.payload as
    | {
        output?: unknown;
        error?: { message?: string };
        deadEnds?: { nodeId: string; nodeLabel?: string; port: string }[];
        reason?: string;
      }
    | undefined;

  switch (event.type) {
    case 'node_completed':
      return payload?.output === undefined ? undefined : JSON.stringify(payload.output);
    case 'node_failed':
    case 'execution_failed':
      return payload?.error?.message;
    case 'execution_incomplete':
      // The most useful message in the whole log: a node promised a route and
      // nothing was wired to it. Without spelling that out, "incomplete" reads
      // as a mystery — and named by uuid it was still close to one, since the
      // owner has never seen that string. `nodeLabel` is attached upstream in
      // run-workflow.ts; a run recorded before that falls back to the id.
      return payload?.deadEnds
        ?.map(
          ({ nodeId, nodeLabel, port }) =>
            `הצעד "${nodeLabel ?? nodeId}" פנה למסלול "${port}" ואין אליו חיבור`,
        )
        .join('\n');
    default:
      return undefined;
  }
}

function EventRow({
  event,
  selectedNodeId,
}: {
  event: StreamEvent;
  selectedNodeId: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isNode = typeof event.nodeId === 'string' && event.nodeId.length > 0;
  const isHighlighted = isNode && event.nodeId === selectedNodeId;
  const skipReason =
    event.type === 'node_skipped'
      ? SKIP_REASON_LABEL[(event.payload as { reason?: string } | undefined)?.reason ?? '']
      : undefined;

  // The name the owner typed, falling back to the id. Both are shown: the label
  // reads, the id is what a bug report needs — so the id stays in the `title`
  // rather than being replaced by the label.
  const nodeLabel = (event.payload as { nodeLabel?: string } | undefined)?.nodeLabel;

  const detail = detailFor(event);
  const hasDetail = Boolean(detail);
  const truncated =
    detail && detail.length > DETAIL_PREVIEW_CHARS
      ? `${detail.slice(0, DETAIL_PREVIEW_CHARS)}…`
      : detail;

  const toggle = (e: React.MouseEvent) => {
    // Don't swallow a click meant for a link, and don't collapse the row out
    // from under someone selecting its text.
    const onInteractive = e.target instanceof Element && Boolean(e.target.closest('a, button'));
    const selecting = Boolean(globalThis.getSelection()?.toString());
    if (hasDetail && !onInteractive && !selecting) setIsExpanded((v) => !v);
  };

  return (
    <div
      data-node-id={isNode ? event.nodeId : undefined}
      onClick={toggle}
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      aria-expanded={hasDetail ? isExpanded : undefined}
      onKeyDown={(event) => {
        if (hasDetail && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setIsExpanded((value) => !value);
        }
      }}
      className={[
        'border-b border-border/60 px-3 py-2 text-xs',
        hasDetail ? 'cursor-pointer' : '',
        isHighlighted ? 'bg-muted' : '',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatIsraelTime(event.timestamp)}
        </span>
        <span className="font-medium">{EVENT_LABEL[event.type] ?? event.type}</span>
        {isNode && (
          <span className="truncate text-muted-foreground" title={event.nodeId}>
            {nodeLabel ?? event.nodeId}
          </span>
        )}
        {skipReason && <span className="text-muted-foreground">— {skipReason}</span>}
      </div>
      {hasDetail && (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
          {isExpanded ? detail : truncated}
        </pre>
      )}
    </div>
  );
}

export function ExecutionLogPanel() {
  const events = useExecutionStore((s) => s.events);
  const status = useExecutionStore((s) => s.status);
  const runId = useExecutionStore((s) => s.runId);
  const isCollapsed = useExecutionStore((s) => s.isLogCollapsed);

  // `SingleSelectedElement` is `{ node, edge }` — it has no `id` of its own.
  // An earlier version here tested `'id' in selected`, which is always false, so
  // the highlight and the scroll-into-view below silently never fired. tsc
  // accepts `in` on any object, so nothing caught it.
  const selected = useSingleSelectedElement();
  const selectedNodeId = selected?.node?.id ?? null;

  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // A new run starts pinned to the bottom again, however the reader had left
  // the previous one.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [runId]);

  useEffect(() => {
    if (!isCollapsed && stickToBottomRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events.length, isCollapsed]);

  useEffect(() => {
    if (!selectedNodeId || isCollapsed) return;
    bodyRef.current
      ?.querySelector(`[data-node-id="${CSS.escape(selectedNodeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedNodeId, isCollapsed]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) return;
    // Auto-scroll stops the moment the reader scrolls away, and resumes when
    // they come back to the bottom. A log that yanks itself down while someone
    // is reading it is unusable.
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    stickToBottomRef.current = distanceFromBottom < AT_BOTTOM_TOLERANCE_PX;
  }

  if (events.length === 0 && status === 'idle') return null;

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={toggleLog}
        aria-expanded={!isCollapsed}
        className="flex min-h-11 w-full items-center gap-3 px-3 text-start"
      >
        <span className="font-medium">יומן הרצה</span>
        <span className="text-sm text-muted-foreground">{STATUS_LABEL[status] ?? status}</span>
        <span className="ms-auto text-muted-foreground">{isCollapsed ? '▲' : '▼'}</span>
      </button>
      {!isCollapsed && (
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          data-log-body
          className="max-h-64 overflow-auto border-t border-border"
        >
          {events.map((event) => (
            <EventRow key={`${event.seq}`} event={event} selectedNodeId={selectedNodeId} />
          ))}
        </div>
      )}
    </section>
  );
}
