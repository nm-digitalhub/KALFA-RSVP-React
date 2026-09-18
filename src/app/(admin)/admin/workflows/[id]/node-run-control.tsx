'use client';

import {
  rankWith,
  optionIs,
  useSingleSelectedElement,
  withJsonFormsLabelProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { formatIsraelDateTime } from '@/lib/date';
import { NODE_RUN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

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

function NodeRunControl() {
  // ⚠️ THE NODE ID COMES FROM THE SDK, NOT FROM JSONFORMS. A control is handed
  // its own data and path; it is never told which node the form belongs to.
  // `useSingleSelectedElement` is the published hook for exactly that, and the
  // panel only ever renders for the selected node — the same value its own
  // container reads to decide what to show.
  const selection = useSingleSelectedElement();
  const nodeId = selection?.node?.id;

  const runId = useExecutionStore((s) => s.runId);
  const state = useExecutionStore((s) => (nodeId ? s.nodeStates[nodeId] : undefined));

  // ⚠️ NOTHING AT ALL WHEN NO RUN IS BEING WATCHED, which is most of the time.
  // A permanent "אין הרצה במעקב" line at the top of every node's settings would
  // be a placeholder that goes stale the moment someone stops reading it; the
  // panel should look exactly as it did before this control existed until there
  // is something real to report.
  if (!runId || !state || state.status === 'idle') return null;

  const output = formatOutput(state.output);
  const waiting = describeWait(state);

  return (
    <section className="mb-2 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">בהרצה שמוצגת</span>
        <span className={`font-medium ${STATUS_TONE[state.status]}`}>
          {STATUS_HE[state.status]}
        </span>
      </div>

      {waiting ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{waiting.label}</span>
          <span>{waiting.value}</span>
        </div>
      ) : null}

      {state.error ? (
        <div className="space-y-1">
          <span className="text-muted-foreground">שגיאה</span>
          <p className="rounded-md bg-destructive/10 p-2 text-destructive">
            {state.error.message || 'ללא פירוט'}
            {state.error.code ? (
              <span className="block text-xs opacity-70">{state.error.code}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {output ? (
        <div className="space-y-1">
          <span className="text-muted-foreground">פלט</span>
          {/*
            `wrap-anywhere` rather than a horizontal scroller: the panel is
            19rem and a JSON line is longer than that, so a scroller would hide
            the value behind a gesture nobody discovers. Same reasoning as the
            RTL repair in sdk-overrides.css — content that does not fit should
            wrap, not vanish.
          */}
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs wrap-anywhere whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      ) : null}

      {!state.error && !output ? (
        <p className="text-muted-foreground">הצעד רץ ולא החזיר פלט.</p>
      ) : null}
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
