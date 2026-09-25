'use client';

// Ported from the reference app's components/execution/log-panel.tsx.
//
// Behaviour kept verbatim: collapsible header carrying the run status,
// per-event rows, click-to-expand detail (run-level rows; a step's row opens
// its panel instead), skip reasons spelled out, stick-to-
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

import { focusNodeOnCanvas } from './focus-node';
import { measureInfo } from './node-events';
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

// ── resizing the log body ────────────────────────────────────────────────────
// The body's default height lives in sdk-overrides.css (`[data-log-body]`). A
// height the owner drags to replaces it inline and is remembered per browser.
// The log sits under the canvas in a column whose canvas is `flex: 1`, so a
// taller log takes its room from the canvas, never from the page.
const LOG_HEIGHT_KEY = 'kalfa.workflowLog.height';
const MIN_LOG_HEIGHT_PX = 64;
const MAX_LOG_SHARE = 0.75; // of the editor frame — the canvas keeps a quarter
const KEY_STEP_PX = 24;

function readStoredHeight(): number | null {
  try {
    const value = Number(globalThis.localStorage?.getItem(LOG_HEIGHT_KEY));
    return Number.isFinite(value) && value >= MIN_LOG_HEIGHT_PX ? value : null;
  } catch {
    return null; // private window / blocked storage: fall back to the CSS height
  }
}

function storeHeight(value: number): void {
  try {
    globalThis.localStorage?.setItem(LOG_HEIGHT_KEY, String(Math.round(value)));
  } catch {
    // a convenience only
  }
}
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
    // A completed step's output is measured and shown by `EventRow` on its own
    // line, and in full in the step's panel — so it has no text detail here.
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
  onFocusNode,
}: {
  event: StreamEvent;
  selectedNodeId: string | null;
  onFocusNode: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMissing, setIsMissing] = useState(false);

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

  // ⚠️ WHAT THE ROW SHOWS IS DECIDED BY HOW MUCH THERE IS, not by the event type
  // (owner, 25.9): nothing → the bare row; short → inline; long → a summary.
  // A step's full detail — every run of it, times, the output tree — is in its
  // properties panel, which a click on the row opens (`focusNodeOnCanvas`), as
  // the vendor's guidance places it. A run-level row has no step to open, so its
  // long text expands in place, as before.
  const detail = measureInfo(detailFor(event));
  const output = measureInfo(
    event.type === 'node_completed' ? (event.payload as { output?: unknown } | undefined)?.output : undefined,
  );
  const hasLong = detail.kind === 'long' || output.kind === 'long';
  const canExpand = !isNode && detail.kind === 'long';
  const interactive = isNode || canExpand;

  const activate = () => {
    if (isNode) {
      onFocusNode();
      setIsMissing(!focusNodeOnCanvas(event.nodeId as string));
    } else if (canExpand) {
      setIsExpanded((value) => !value);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    // Don't swallow a click meant for a link, and don't act under someone
    // selecting the row's text.
    const onInteractive = e.target instanceof Element && Boolean(e.target.closest('a, button'));
    const selecting = Boolean(globalThis.getSelection()?.toString());
    if (!onInteractive && !selecting) activate();
  };

  return (
    <div
      data-node-id={isNode ? event.nodeId : undefined}
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={canExpand ? isExpanded : undefined}
      title={isNode ? 'פתיחת פרטי הצעד' : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          activate();
        }
      }}
      className={[
        'border-b border-border/60 px-3 py-2 text-xs',
        interactive ? 'cursor-pointer hover:bg-muted/60' : '',
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
        {isNode && hasLong && <span className="ms-auto shrink-0 text-muted-foreground">פרטים ‹</span>}
      </div>
      {detail.kind !== 'none' && (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
          {detail.kind === 'short' ? detail.text : isExpanded ? detailFor(event) : detail.summary}
        </pre>
      )}
      {output.kind !== 'none' && (
        <p className="mt-1 text-muted-foreground">
          {output.kind === 'short' ? (
            <>
              פלט: <code dir="ltr" className="break-all">{output.text}</code>
            </>
          ) : (
            `פלט: ${output.summary}`
          )}
        </p>
      )}
      {isMissing && (
        <p className="mt-1 text-muted-foreground" role="status">
          הצעד הזה כבר לא נמצא בתהליך.
        </p>
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
  // `null` = the CSS default. Read lazily: safe for hydration because the
  // server never renders the body — with no events the panel returns null.
  const [height, setHeight] = useState<number | null>(readStoredHeight);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  // Set when the selection came from a click on a row here: the reader is
  // already looking at that row, and scrolling to the step's FIRST row (a step
  // has several) would move the log out from under the one they clicked.
  const selectedFromLogRef = useRef(false);

  const clampHeight = (value: number): number => {
    const frame = bodyRef.current?.closest('.kalfa-workflow-frame') as HTMLElement | null;
    const max = Math.max(MIN_LOG_HEIGHT_PX, (frame?.clientHeight ?? globalThis.innerHeight) * MAX_LOG_SHARE);
    return Math.min(max, Math.max(MIN_LOG_HEIGHT_PX, value));
  };
  const currentHeight = () => height ?? bodyRef.current?.clientHeight ?? 192;
  const applyHeight = (value: number) => {
    const next = clampHeight(value);
    setHeight(next);
    storeHeight(next);
  };

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
    if (selectedFromLogRef.current) {
      selectedFromLogRef.current = false;
      return;
    }
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
        // The drag handle. Up = taller (the log grows into the canvas), down =
        // shorter. Pointer events with capture, so a drag that leaves the strip
        // keeps tracking; keyboard: arrows resize by 24px, for a keyboard user.
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="שינוי גובה יומן ההרצה"
          aria-valuenow={Math.round(height ?? 0) || undefined}
          aria-valuemin={MIN_LOG_HEIGHT_PX}
          tabIndex={0}
          className="group flex h-3 cursor-row-resize touch-none items-center justify-center border-t border-border focus-visible:outline-2 focus-visible:outline-ring"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { startY: e.clientY, startHeight: currentHeight() };
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag) return;
            setHeight(clampHeight(drag.startHeight + (drag.startY - e.clientY)));
          }}
          onPointerUp={(e) => {
            if (!dragRef.current) return;
            dragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (height !== null) storeHeight(height);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              applyHeight(currentHeight() + KEY_STEP_PX);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              applyHeight(currentHeight() - KEY_STEP_PX);
            }
          }}
        >
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border group-hover:bg-muted-foreground" />
        </div>
      )}
      {!isCollapsed && (
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          data-log-body
          className="overflow-auto"
          // Inline beats the stylesheet's max-height, so a dragged height wins.
          style={height === null ? undefined : { height, maxHeight: 'none' }}
        >
          {events.map((event) => (
            <EventRow
              key={`${event.seq}`}
              event={event}
              selectedNodeId={selectedNodeId}
              onFocusNode={() => {
                // Only when the selection will actually change — otherwise the
                // effect does not run and the flag would swallow the next
                // selection made on the canvas.
                selectedFromLogRef.current = event.nodeId !== selectedNodeId;
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
