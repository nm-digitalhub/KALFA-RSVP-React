'use client';

import {
  rankWith,
  optionIs,
  useSingleSelectedElement,
  withJsonFormsLabelProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { useMemo } from 'react';

import { formatIsraelDateTime } from '@/lib/date';
import { NODE_RUN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { formatDuration, nodeAttempts, type AttemptStatus, type NodeAttempt } from './node-events';
import { OutputJsonView } from './output-json-view';
import { useExecutionStore, type NodeExecutionState } from './use-execution-store';

// What this node did on the run being watched — beside its settings, not in a
// log at the bottom of the page.
//
// ⚠️ THE DATA WAS ALREADY THERE AND NOTHING SHOWED IT. `use-execution-store`
// has held `{ status, output, error, resumeAt, waitKind }` per node id since the
// live stream landed, and two surfaces read it: `node-markers.tsx` draws a status
// icon on the node, and `log-panel.tsx` prints outputs in one chronological
// list for the whole run. Neither answers "what happened to THIS node" — the
// icon has no payload, and the log makes you scan a timeline to find one step.
//
// ⚠️ WHY A JSONFORMS CONTROL AND NOT THE PANEL'S `tabs` PROP, WHICH EXISTS.
// `PropertiesBarProps` does declare `tabs?: PropertiesBarTab[]`, and the panel
// does render a tab strip from it. A first attempt used it. It reached exactly
// ONE node type in the whole product, and the reason is in the vendor's source
// (packages/sdk/src/features/properties-bar/components/properties-bar/properties-bar.tsx):
//
//     when: () => isExpanded && !!selection?.node
//                 && selection.node.type === 'node' && hasCustomItems
//
// `node.type` there is the node's VISUAL TEMPLATE — `NodeType` is one of
// `node` / `start-node` / `ai-node` / `decision-node`, and the SDK's own doc for
// that enum says it "drives diagram validation rules …, the variable picker's
// traversal, and rendering choices in the default node template". Our palette
// declares `DecisionNode` for fifteen entries (they need the branch body and the
// OptionalNodeContent slot) and `StartNode` for three triggers, leaving
// `logic.set_value` as the only entry that falls to the default. So the strip
// rendered for one node and the pane was unreachable everywhere else — silently,
// because an absent strip is not an error.
//
// ⚠️ AND IT IS NOT A SEAM WE WERE MEANT TO USE. Nothing in the vendor's own repo
// passes `tabs` — not `PropertiesBarContainer`, not any of the ~13 demo plugins.
// The only way past that condition would have been to hand the panel a selection
// whose node type we had rewritten, which is a workaround, not an integration.
//
// ⚠️ SO THIS TAKES THE ROUTE THE SDK ACTUALLY DOCUMENTS. A custom JsonForms
// renderer is part of the published plugin API (`JsonFormsRendererExtension`),
// and the panel's content is exactly what the node's uischema says it is — no
// node-type condition anywhere in that path. `schemas.ts` puts the element on
// every palette entry in one place, so this is data, not nineteen edits.
//
// The shape is the vendor's own: their `globalControls` is a display-only
// element ("UISchema fragments rendered on every node's properties tab
// regardless of the node type") whose scope names a property that does not
// exist. We are not spreading THAT array — `schemas.ts` records at length why
// its single element can only ever print an untranslated key — but the shape it
// demonstrates is the one used here.

const STATUS_HE: Record<NodeExecutionState['status'], string> = {
  idle: 'לא הגיעה לכאן',
  running: 'רצה עכשיו',
  waiting: 'ממתינה',
  completed: 'הושלמה',
  failed: 'נכשלה',
  skipped: 'דולגה',
};

const STATUS_TONE: Record<NodeExecutionState['status'], string> = {
  idle: 'text-muted-foreground',
  running: 'text-[color:var(--kalfa-wf-status-color--running)]',
  waiting: 'text-[color:var(--kalfa-wf-status-color--waiting)]',
  completed: 'text-[color:var(--kalfa-wf-status-color--completed)]',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
};

/**
 * Render a step's output without pretending to know its shape.
 *
 * `output` is `unknown` by contract — every handler returns its own shape, and
 * the store carries it through untouched. So this stringifies rather than
 * reaching for fields: a node type added later shows its real output on the
 * first run instead of an empty panel nobody traces back to here.
 */
export function formatOutput(output: unknown): string | null {
  if (output === undefined || output === null) return null;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    // A cyclic or non-serialisable payload is still worth naming.
    return String(output);
  }
}

/**
 * How to describe a parked step, or `null` when saying nothing is the honest answer.
 *
 * ⚠️ A TIMER AND AN EVENT WAIT READ DIFFERENTLY, and conflating them is a
 * mistake this codebase already made once — `node-markers.tsx` records that the
 * canvas "said 'continues at 14:30' about a node really waiting for a phone call
 * to end". `resumeAt` is a RESUME time for a timer and a TIMEOUT for a
 * correlated wait: the callback may land long before it, or never.
 *
 * Both kinds are named explicitly rather than one falling out of the other, for
 * the reason given there: a row written before `waitKind` shipped carries a
 * `resumeAt` and no kind, and reading that as a timer would announce a resume
 * time it never had.
 */
export function describeWait(
  state: Pick<NodeExecutionState, 'resumeAt' | 'waitKind'>,
): { label: string; value: string } | null {
  if (!state.resumeAt) return null;
  if (state.waitKind === 'timer') {
    return { label: 'ממשיכה ב־', value: formatIsraelDateTime(state.resumeAt) };
  }
  if (state.waitKind === 'event') {
    return { label: 'ממתינה לתוצאה · פג ב־', value: formatIsraelDateTime(state.resumeAt) };
  }
  return null;
}

const ATTEMPT_STATUS_HE: Record<AttemptStatus, string> = {
  running: STATUS_HE.running,
  waiting: STATUS_HE.waiting,
  completed: STATUS_HE.completed,
  failed: STATUS_HE.failed,
  skipped: STATUS_HE.skipped,
};

const SKIP_REASON_HE: Record<string, string> = {
  branch_not_taken: 'הענף לא נבחר',
  upstream_skipped: 'הצעד שלפניו לא רץ',
  error_route_not_taken: 'ענף השגיאה לא נדרש',
};

/** One run of the step: when, how long, and what came of it. */
function AttemptDetails({ nodeId, attempt }: { nodeId: string; attempt: NodeAttempt }) {
  const waiting = describeWait(attempt);
  const output = formatOutput(attempt.output);
  const at = attempt.startedAt ?? attempt.endedAt;

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {at ? (
          <>
            <dt className="text-muted-foreground">{attempt.startedAt ? 'התחילה' : 'בשעה'}</dt>
            <dd>{formatIsraelDateTime(at)}</dd>
          </>
        ) : null}
        {attempt.startedAt && attempt.endedAt ? (
          <>
            <dt className="text-muted-foreground">הסתיימה</dt>
            <dd>{formatIsraelDateTime(attempt.endedAt)}</dd>
          </>
        ) : null}
        {attempt.durationMs !== undefined ? (
          <>
            <dt className="text-muted-foreground">משך</dt>
            <dd>{formatDuration(attempt.durationMs)}</dd>
          </>
        ) : null}
        {waiting ? (
          <>
            <dt className="text-muted-foreground">{waiting.label}</dt>
            <dd>{waiting.value}</dd>
          </>
        ) : null}
        {attempt.skipReason ? (
          <>
            <dt className="text-muted-foreground">סיבה</dt>
            <dd>{SKIP_REASON_HE[attempt.skipReason] ?? attempt.skipReason}</dd>
          </>
        ) : null}
      </dl>

      {attempt.error ? (
        <div className="space-y-1">
          <span className="text-muted-foreground">שגיאה</span>
          <p className="rounded-md bg-destructive/10 p-2 whitespace-pre-wrap text-destructive">
            {attempt.error.message || 'ללא פירוט'}
            {attempt.error.code ? (
              <span className="block text-xs opacity-70">{attempt.error.code}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {output ? (
        <div className="space-y-1">
          <span className="text-muted-foreground">פלט</span>
          {/* A tree, with each field name copying its `{{nodes.…}}` reference —
              see output-json-view.tsx. A primitive output still prints as text. */}
          <OutputJsonView nodeId={nodeId} value={attempt.output} />
        </div>
      ) : null}

      {attempt.status === 'completed' && !output ? (
        <p className="text-muted-foreground">הצעד רץ ולא החזיר פלט.</p>
      ) : null}
    </div>
  );
}

function NodeRunControl() {
  // ⚠️ THE NODE ID COMES FROM THE SDK, NOT FROM JSONFORMS. A control is handed
  // its own data and path; it is never told which node the form belongs to.
  // `useSingleSelectedElement` is the published hook for exactly that, and the
  // panel only ever renders for the selected node — the same value its own
  // container reads to decide what to show.
  const selection = useSingleSelectedElement();
  const nodeId = selection?.node?.id;

  const runId = useExecutionStore((s) => s.runId);
  const events = useExecutionStore((s) => s.events);

  // ⚠️ THE FULL EVENT LOG OF THIS STEP, not only its latest state. The vendor's
  // guidance puts exactly that here — "a side panel that opens when the user
  // clicks a node, with the full event log for that step" — and `nodeStates`
  // keeps one state per node, so a step that ran twice lost its first run.
  const attempts = useMemo(() => (nodeId ? nodeAttempts(events, nodeId) : []), [events, nodeId]);

  // ⚠️ NOTHING AT ALL WHEN NO RUN IS BEING WATCHED, which is most of the time.
  // A permanent "אין הרצה במעקב" line at the top of every node's settings would
  // be a placeholder that goes stale the moment someone stops reading it; the
  // panel should look exactly as it did before this control existed until there
  // is something real to report.
  if (!runId || !nodeId || attempts.length === 0) return null;

  const latest = attempts.at(-1) as NodeAttempt;

  return (
    <section className="mb-2 space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">בהרצה שמוצגת</span>
        <span className={`font-medium ${STATUS_TONE[latest.status]}`}>
          {ATTEMPT_STATUS_HE[latest.status]}
          {attempts.length > 1 ? ` · ${attempts.length} ריצות` : ''}
        </span>
      </div>

      {attempts.length === 1 ? (
        <AttemptDetails nodeId={nodeId} attempt={latest} />
      ) : (
        <ol className="space-y-3">
          {attempts.map((attempt, index) => (
            <li key={index} className="space-y-2 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">ריצה {index + 1}</span>
                <span className={STATUS_TONE[attempt.status]}>{ATTEMPT_STATUS_HE[attempt.status]}</span>
              </div>
              <AttemptDetails nodeId={nodeId} attempt={attempt} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ⚠️ `withJsonFormsLabelProps`, MATCHING THE ELEMENT. The other four renderers
// here wrap controls and take `withJsonFormsControlProps`; this one is bound to
// a `Label`, whose own HOC the SDK exports beside it. Rank 5000 is the house
// number — above every built-in, and `optionIs` keeps it from claiming any
// element that does not carry this exact format.
export const nodeRunRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5000, optionIs('format', NODE_RUN_FORMAT)),
  renderer: withJsonFormsLabelProps(NodeRunControl),
};
