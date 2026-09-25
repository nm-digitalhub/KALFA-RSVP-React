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

// Both, and for different jobs. A row's own timestamp is always "just now" in
// the reader's session, so the clock alone is right there. A `resumeAt` is
// routinely days out, and the clock alone would read as "in a few hours".
import { formatIsraelDateTime, formatIsraelTime } from '@/lib/date';
import type { StreamEvent } from '@/lib/workflow/execution-events';

import { OutputJsonView } from './output-json-view';
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
  // Upstream declares `node_waiting` in its execution-event contract but its
  // reference runner does not emit it and its reference client does not project
  // it, so this table — ported from that client — arrived without the label and
  // the Hebrew log printed the raw string through the `?? event.type` fallback.
  // KALFA emits it for `logic.wait`.
  node_waiting: 'צעד ממתין',
  node_completed: 'צעד הושלם',
  node_failed: 'צעד נכשל',
  node_skipped: 'צעד דולג',
  // ⚠️ DECLARED BY UPSTREAM, EMITTED BY NOBODY — not by `graph-runner.ts` and
  // not by `run-workflow.ts`. Labelled anyway because a label is one line and
  // the alternative is an exemption list that rots. If the upstream runner ever
  // starts emitting them, the log reads Hebrew on the first run rather than on
  // the first bug report.
  branch_spawned: 'ענף נפתח',
  branches_joined: 'ענפים אוחדו',
};

/**
 * ⚠️ THE SAME VOCABULARY AS `RUN_STATUS_HE` IN `page.tsx`, and it had drifted.
 *
 * Two of them were missing here and present there: `waiting`, which is KALFA's
 * own status for a run parked on a `logic.wait` deadline, and `cancelling`,
 * which is the vendor's (`ExecutionStatus = 'pending' | 'running' |
 * 'cancelling' | TerminalExecutionStatus`). Both fell through the `?? status`
 * fallback and showed in English on a Hebrew panel — the exact defect the runs
 * table was fixed for, left standing one component over.
 *
 * `waiting` is not "בהמתנה": that is `pending`, a run queued and about to go.
 * A parked run may be days from waking, and conflating the two makes one look
 * like the other.
 */
const STATUS_LABEL: Record<string, string> = {
  idle: 'ממתין',
  pending: 'בהמתנה',
  running: 'רץ',
  waiting: 'בהמתנה מתוזמנת',
  cancelling: 'בביטול',
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
        resumeAt?: string;
        waitKind?: 'timer' | 'event';
      }
    | undefined;

  switch (event.type) {
    // A completed step's output is drawn as a tree by `EventRow`
    // (`OutputJsonView`), not as one JSON line — so it has no text detail here.
    case 'node_completed':
      return undefined;
    // ⚠️ THE FIELD THE ENGINE ATTACHED FOR THIS PANEL AND NOBODY READ.
    //
    // `run-workflow.ts` extends the vendor's `NodeWaitingPayload` with
    // `resumeAt`, saying so in a comment: "the log panel is ours, and 'waiting'
    // without 'until when' is not useful". It was right — and the field was
    // written to every parked run's event row and displayed nowhere.
    //
    // Absent for a vendored join-wait, which waits on other nodes rather than
    // on a clock; that row keeps its label and gets no detail line.
    //
    // ⚠️ AND THE SENTENCE DEPENDS ON `waitKind`. For a timer the date is when
    // the run continues; for a correlated wait it is when the run gives up, and
    // the callback may land long before it. "ממשיך ב-" on the second is a
    // statement the engine never made.
    case 'node_waiting':
      // ⚠️ EACH KIND TESTED EXPLICITLY. A row written before `waitKind` shipped
      // has a `resumeAt` and no kind; treating that as a timer would print
      // "continues at 14:30" for a wait that really ends when a callback lands.
      // No kind means no sentence about time — the label alone ("צעד ממתין")
      // still tells the reader the step is parked.
      if (!payload?.resumeAt) return undefined;
      if (payload.waitKind === 'event') {
        return `ממתין לתוצאה חיצונית. אם לא תגיע — פג ב-${formatIsraelDateTime(payload.resumeAt)}`;
      }
      if (payload.waitKind === 'timer') {
        return `ממשיך ב-${formatIsraelDateTime(payload.resumeAt)}`;
      }
      return undefined;
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
  // A completed step's output, drawn as a collapsible tree. It is NOT part of
  // the row's click-to-expand: the tree has its own arrows and field buttons,
  // and a click there must not collapse the row.
  const output =
    event.type === 'node_completed' ? (event.payload as { output?: unknown } | undefined)?.output : undefined;
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
      {detail && (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
          {isExpanded ? detail : truncated}
        </pre>
      )}
      {output !== undefined && isNode && (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
          <OutputJsonView nodeId={event.nodeId as string} value={output} />
        </div>
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
