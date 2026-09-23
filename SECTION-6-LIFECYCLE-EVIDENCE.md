# §6 — Lifecycle Evidence

Generated: 2026-09-15T22:09:49+03:00
HEAD: c0de7c82f29dc5873cfc932a698ae1fcd8e3ef41

## 1. Vitest configuration
```text
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run in a Node environment. Most testable logic is server-side
// (Zod schemas, ownership filtering, auth helpers); component tests can add a
// jsdom environment later if needed.
//
// TZ is pinned so a test suite full of dates gives the same answer on any
// machine. Without it the runner inherits the host, and a scheduling test that
// passes on a server set to Israel can fail in CI set to UTC — or, worse, pass
// in both while asserting different things. Asia/Jerusalem is the product's
// only timezone, so pinning it also means a test that quietly depends on local
// time is testing the behaviour users actually get.
// NODE_ENV is pinned for the same reason as TZ, and for a measured one:
// vitest defaults it to 'test' only when it is UNSET, so an inherited value
// wins. The fleet's qa-runner is spawned from a pm2 process whose environment
// declares NODE_ENV=production (ecosystem.config.cjs), and that leaked into
// the suite — src/lib/url.ts:50 deliberately throws when APP_ORIGIN is unset
// in production, so 2 tests in url.test.ts failed there and passed everywhere
// else. Isolated 2026-07-29: the same run with APP_ORIGIN supplied passes,
// which confirms the trigger is the environment, not the code under test.
// A test run must not depend on who invoked it.
//
// WHAT `test.env` IS, and what it deliberately is NOT
// ---------------------------------------------------
// Vitest defines `test.env` as "custom environment variables assigned to
// `process.env` before running tests" — so the two entries above are the whole
// contract between the runner and the suite. Everything else a test needs it
// must declare itself.
//
// Vitest does NOT read .env/.env.local into process.env. That is opt-in, and the
// documented way to opt in is Vite's loadEnv:
//
//   import { loadEnv } from 'vite'
//   export default defineConfig(({ mode }) => ({
//     test: { env: loadEnv(mode, process.cwd(), '') },
//   }))
//
// We deliberately do NOT do that. Loading .env.local would make the suite depend
// on one machine's deployment configuration — the exact failure this file exists
// to prevent — and would pull live secrets into unit tests.
//
// MEASURED 2026-08-26, which is how this was settled rather than assumed:
// contacts.test.ts's reconcile-guard case passed only because
// RECONCILE_AUTHORIZED_SET_ENABLED happened to be exported in the invoking
// shell. The same file, unchanged, failed once that shell was replaced. Running
// it with the variable set to true, set to false, and unset now gives 26/26 in
// all three, because the tests stub the flag themselves.
//
// THE RULE: a test that depends on an env var sets it with `vi.stubEnv(...)` and
// clears it with `afterEach(() => vi.unstubAllEnvs())`. Never add a product flag
// here to make a test pass — pinning one state in the config also means the
// other state is never tested, and a kill-switch has two real states.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'Asia/Jerusalem', NODE_ENV: 'test' },
    // @workflowbuilder/sdk is browser ESM and imports @xyflow/react's
    // stylesheet. Node's loader refuses a .css file outright
    // ("Unknown file extension .css"), and a package left EXTERNAL is loaded by
    // Node rather than transformed by Vite — so the import fails before any test
    // runs. Inlining hands it to Vite, which stubs CSS imports to an empty
    // module because `test.css` is off.
    //
    // Scoped to this one package on purpose: it is the only dependency a test
    // needs to import for browser-side code (catalogue/branch-handles.test.ts,
    // which pins the condition handle ids to the SDK's own getHandleId).
    server: { deps: { inline: ['@workflowbuilder/sdk'] } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

## 2. Existing workflow tests
```text
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts
```

## 3. Workflow-related tests across src
```text
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts
src/app/api/agents/sdk-auth/route.test.ts
src/lib/data/admin/workflows-arm-role.test.ts
src/lib/data/admin/workflows-cancel.test.ts
src/lib/data/admin/workflows-create.test.ts
src/lib/data/console-sdk-auth.test.ts
src/lib/workflow/adapter/to-definition.test.ts
src/lib/workflow/cas-model.test.ts
src/lib/workflow/catalogue/accordion-classification.test.ts
src/lib/workflow/catalogue/arm-check.test.ts
src/lib/workflow/catalogue/branch-handles.test.ts
src/lib/workflow/catalogue/conditional-required.test.ts
src/lib/workflow/catalogue/guest-context.test.ts
src/lib/workflow/catalogue/palette-defaults.test.ts
src/lib/workflow/catalogue/references.test.ts
src/lib/workflow/catalogue/required-fields-editable.test.ts
src/lib/workflow/catalogue/set-value.test.ts
src/lib/workflow/catalogue/templates.test.ts
src/lib/workflow/catalogue/unblocked.test.ts
src/lib/workflow/catalogue/voice-rule.test.ts
src/lib/workflow/console-inbound-channel.test.ts
src/lib/workflow/definition-snapshot.test.ts
src/lib/workflow/engine/contended.test.ts
src/lib/workflow/engine/dry-run.test.ts
src/lib/workflow/engine/run-workflow.test.ts
src/lib/workflow/engine/wait-cycle.test.ts
src/lib/workflow/guest-actions.test.ts
src/lib/workflow/handshake.test.ts
src/lib/workflow/i18n-he.test.ts
src/lib/workflow/inbound.test.ts
src/lib/workflow/keyword-reach.test.ts
src/lib/workflow/manual-run.test.ts
src/lib/workflow/outbound-webhook.test.ts
src/lib/workflow/run-store-status.test.ts
src/lib/workflow/schedule.test.ts
src/lib/workflow/sdk-integration-invariants.test.ts
src/lib/workflow/secrets.test.ts
src/lib/workflow/steps/callback-topic.test.ts
src/lib/workflow/steps/fan-out.test.ts
src/lib/workflow/steps/guest-field-callback.test.ts
src/lib/workflow/steps/import-guest-list.test.ts
src/lib/workflow/steps/switch.test.ts
src/lib/workflow/steps/voice-call-wait.test.ts
src/lib/workflow/steps/voice-call.test.ts
src/lib/workflow/steps/wait.test.ts
src/lib/workflow/steps/webhook.test.ts
src/lib/workflow/stream.test.ts
src/lib/workflow/stuck-runs.test.ts
src/lib/workflow/trigger-number.test.ts
src/lib/workflow/trigger.test.ts
src/lib/workflow/vendor/workflowbuilder/execution-core/templates/resolve-template.test.ts
src/lib/workflow/voice-outcome.test.ts
src/lib/workflow/wake.test.ts
src/lib/workflow/webhook-trigger.test.ts
src/lib/workflow/webhook-url.test.ts
src/lib/workflow/workflow-budgets.test.ts
```

## 4. Execution store — complete
```text
'use client';

// Ported from the reference app's stores/use-execution-store.ts, same shape and
// same reducer semantics. Two deliberate differences, both forced by where it
// runs rather than by taste:
//
//   * No `persist` to sessionStorage. The reference app persists only the log's
//     collapsed flag; here the panel lives inside an admin route whose state is
//     already per-visit, and a persisted key would outlive the workflow it
//     described.
//   * No `devtools`. It is a dev-only wrapper the reference app leaves on; this
//     ships to an admin in production.
import { create } from 'zustand';

import type { StreamEvent, StreamSnapshot } from '@/lib/workflow/execution-events';

export type NodeExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'skipped';

export type NodeExecutionState = {
  status: NodeExecutionStatus;
  output?: unknown;
  error?: { message: string; code?: string };
};

type ExecutionStore = {
  runId: string | undefined;
  status: string;
  nodeStates: Record<string, NodeExecutionState>;
  events: StreamEvent[];
  isLogCollapsed: boolean;
};

type DryRunOutcome =
  | { status: 'completed' }
  | { status: 'incomplete'; deadEnds: { nodeId: string; port: string }[] }
  /**
   * The run reached a `logic.wait` and parked. In a DRY run nothing is actually
   * scheduled — the trace simply ends here, which is the honest answer to "what
   * would this do": it would get this far and then wait.
   */
  | { status: 'waiting'; resumeAt: string; nodeId: string }
  /**
   * Present only because this type is fed from `RunWorkflowOutcome`, which a live
   * run shares. A DRY run cannot reach it: `contended` means a second delivery of
   * the same run holds a node, and a dry run is single-threaded, never queued and
   * never retried — dry-run.ts says the same about `in_flight`. Carried so the
   * canvas compiles against the full union rather than through a cast that would
   * also hide a real one.
   */
  | { status: 'contended'; nodeId: string }
  | { status: 'failed'; message: string };

const emptyStore: ExecutionStore = {
  runId: undefined,
  status: 'idle',
  nodeStates: {},
  events: [],
  isLogCollapsed: false,
};

export const useExecutionStore = create<ExecutionStore>()(() => ({ ...emptyStore }));

export function resetExecution() {
  useExecutionStore.setState((state) => ({
    ...emptyStore,
    isLogCollapsed: state.isLogCollapsed,
  }));
}

export function setExecutionStarted(runId: string) {
  useExecutionStore.setState({
    runId,
    status: 'pending',
    nodeStates: {},
    events: [],
    isLogCollapsed: false,
  });
}

export function applyConnectionLost() {
  useExecutionStore.setState({ status: 'disconnected' });
}

export function applySnapshot(snapshot: StreamSnapshot) {
  const nodeStates: Record<string, NodeExecutionState> = {};
  for (const event of snapshot.events) applyEventToNodeStates(event, nodeStates);

  useExecutionStore.setState({
    runId: snapshot.runId,
    status: snapshot.status,
    nodeStates,
    events: snapshot.events,
  });
}

export function applyEvent(event: StreamEvent) {
  useExecutionStore.setState((state) => {
    const nodeStates = { ...state.nodeStates };
    applyEventToNodeStates(event, nodeStates);
    return {
      nodeStates,
      events: [...state.events, event],
      status: eventToExecutionStatus(event) ?? state.status,
    };
  });
}

/**
 * Apply a dry run's trace as if it had arrived over the stream.
 *
 * A dry run produces the same per-node facts but returns them in one response
 * instead of streaming them, so this is the seam where the two paths converge:
 * everything downstream — highlighting, markers, the log — reads one store and
 * cannot tell which produced it.
 */
export function applyDryRunTrace(args: {
  outcome: DryRunOutcome;
  steps: { nodeId: string; status: 'completed' | 'failed'; output?: unknown; errorMessage?: string }[];
  skippedNodeIds: string[];
}) {
  const nodeStates: Record<string, NodeExecutionState> = {};
  for (const step of args.steps) {
    nodeStates[step.nodeId] =
      step.status === 'completed'
        ? { status: 'completed', output: step.output }
        : { status: 'failed', error: { message: step.errorMessage ?? '' } };
  }
  for (const nodeId of args.skippedNodeIds) {
    nodeStates[nodeId] ??= { status: 'skipped' };
  }

  useExecutionStore.setState({
    runId: 'dry-run',
    status: args.outcome.status,
    nodeStates,
    events: buildDryRunEvents(args),
    isLogCollapsed: false,
  });
}

function buildDryRunEvents(args: {
  outcome: DryRunOutcome;
  steps: { nodeId: string; status: 'completed' | 'failed'; output?: unknown; errorMessage?: string }[];
  skippedNodeIds: string[];
}): StreamEvent[] {
  let seq = 1;
  const timestamp = new Date().toISOString();
  const events: StreamEvent[] = [
    { seq: seq++, type: 'execution_started', timestamp },
  ];

  for (const step of args.steps) {
    events.push({
      seq: seq++,
      type: 'node_started',
      nodeId: step.nodeId,
      timestamp,
    });
    events.push({
      seq: seq++,
      type: step.status === 'completed' ? 'node_completed' : 'node_failed',
      nodeId: step.nodeId,
      timestamp,
      payload:
        step.status === 'completed'
          ? { output: step.output }
          : { error: { message: step.errorMessage ?? 'הצעד נכשל בהרצת הבדיקה' } },
    });
  }

  for (const nodeId of args.skippedNodeIds) {
    events.push({
      seq: seq++,
      type: 'node_skipped',
      nodeId,
      timestamp,
      payload: { reason: 'branch_not_taken' },
    });
  }

  switch (args.outcome.status) {
    case 'completed':
      events.push({ seq: seq++, type: 'execution_completed', timestamp });
      break;
    case 'incomplete':
      events.push({
        seq: seq++,
        type: 'execution_incomplete',
        timestamp,
        payload: { deadEnds: args.outcome.deadEnds },
      });
      break;
    case 'failed':
      events.push({
        seq: seq++,
        type: 'execution_failed',
        timestamp,
        payload: { error: { message: args.outcome.message } },
      });
      break;
  }

  return events;
}

function applyEventToNodeStates(
  event: StreamEvent,
  states: Record<string, NodeExecutionState>,
) {
  if (!event.nodeId) return;
  const payload = event.payload as
    | { output?: unknown; error?: { message: string; code?: string } }
    | undefined;

  switch (event.type) {
    case 'node_started': {
      states[event.nodeId] = { status: 'running' };
      break;
    }
    case 'node_completed': {
      states[event.nodeId] = { status: 'completed', output: payload?.output };
      break;
    }
    case 'node_failed': {
      states[event.nodeId] = {
        status: 'failed',
        ...(payload?.error ? { error: payload.error } : {}),
      };
      break;
    }
    case 'node_skipped': {
      states[event.nodeId] = { status: 'skipped' };
      break;
    }
  }
}

export function setLogCollapsed(isLogCollapsed: boolean) {
  useExecutionStore.setState({ isLogCollapsed });
}

export function toggleLog() {
  setLogCollapsed(!useExecutionStore.getState().isLogCollapsed);
}

function eventToExecutionStatus(event: StreamEvent): string | undefined {
  switch (event.type) {
    case 'execution_started':
      return 'running';
    case 'execution_completed':
      return 'completed';
    case 'execution_incomplete':
      return 'incomplete';
    case 'execution_failed':
      return 'failed';
    case 'execution_cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}
```

## 5. Panels store — complete
```text
'use client';

// Where the properties panel's open/closed flag lives, and why it is a module
// store rather than `useState` in the layout.
//
// The buttons that drive it are rendered by the SDK, not by us: they are
// injected into the app bar through `registerComponentDecorator`, which is
// registered at MODULE scope and mounted by the SDK's own tree. There is no
// props path from `WorkflowEditorLayout` down to a slot's content, so the two
// sides have to meet in a store.
//
// The palette's flag is NOT here — the SDK already owns that one
// (`useStore(s => s.isSidebarExpanded)` / `toggleSidebar`), and duplicating it
// would give us two sources of truth for the same panel.
import { create } from 'zustand';

type PanelsStore = {
  /** Whether the properties panel is showing. Only meaningful with a selection. */
  isPropertiesOpen: boolean;
  /**
   * Whether the editor is narrow enough that the panels are overlays rather
   * than columns. Written by the layout's ResizeObserver, read by the app-bar
   * buttons so opening one panel closes the other only when they would overlap.
   */
  isCompact: boolean;
};

export const usePanelsStore = create<PanelsStore>()(() => ({
  isPropertiesOpen: false,
  isCompact: false,
}));

export function setPropertiesOpen(isPropertiesOpen: boolean) {
  usePanelsStore.setState({ isPropertiesOpen });
}

export function setEditorCompact(isCompact: boolean) {
  usePanelsStore.setState({ isCompact });
}

export function resetPanels() {
  usePanelsStore.setState({ isPropertiesOpen: false });
}
```

## 6. Run watcher — complete
```text
'use client';

// The client the live-execution stream never had.
//
// `execution-stream-adapter.ts` and the SSE route
// `/api/admin/workflows/runs/[runId]/stream` were both shipped in 31ba24f, whose
// message advertises "a live execution replay" — but nothing imported the
// adapter and `setExecutionStarted` was never called, so the server streamed to
// nobody. This is the missing half: a control on each row of "הרצות אחרונות"
// that points the canvas, the node markers and the log at that run.
//
// One stream at a time, deliberately. The execution store is a single global
// (the canvas can only show one run), so a second subscription would interleave
// two runs' events into one timeline. The module-level `disconnect` is what
// enforces that — switching rows closes the previous EventSource first.
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

import { connectExecutionStream } from './execution-stream-adapter';
import { resetExecution, setExecutionStarted, useExecutionStore } from './use-execution-store';

let disconnect: (() => void) | null = null;

function stopWatching() {
  disconnect?.();
  disconnect = null;
}

function watchRun(runId: string) {
  stopWatching();
  // Reset before subscribing: the snapshot that arrives first replaces the
  // store wholesale, but a failed connection would otherwise leave the previous
  // run's nodes lit under the new run's id.
  resetExecution();
  setExecutionStarted(runId);
  disconnect = connectExecutionStream(runId);
}

export function RunWatchButton({ runId }: { runId: string }) {
  const watchedRunId = useExecutionStore((s) => s.runId);
  const isWatching = watchedRunId === runId;

  // Leaving the page must close the socket. Without this the EventSource
  // survives client-side navigation inside /admin and keeps reconnecting to a
  // run nobody is looking at.
  useEffect(() => stopWatching, []);

  return (
    <Button
      type="button"
      size="sm"
      variant={isWatching ? 'secondary' : 'outline'}
      aria-pressed={isWatching}
      onClick={() => {
        if (isWatching) {
          stopWatching();
          resetExecution();
        } else {
          watchRun(runId);
        }
      }}
    >
      {isWatching ? 'עצירת מעקב' : 'הצגה על הקנבס'}
    </Button>
  );
}
```

## 7. WorkflowEditor effects and Root
```text
  // behalf to a workflow that is armed and firing. The false marker is gone when
  // they open the diagram, and the row converges the next time they save.
  //
  // `initialNodes` is only read by `<Root>` on first mount, so memoising on the
  // palette is enough — and the palette's live lists never change which fields
  // are arrays.
  const normalizedInitialNodes = useMemo(
    () => normalizeLegacyProperties(initialNodes, paletteItems),
    [initialNodes, paletteItems],
  );

  // ⚠️ RE-SNAPSHOT THE PALETTE, or the live lists never reach the form.
  //
  // MEASURED IN THE 2.3.0 BUNDLE, not assumed — and the assumption it replaces
  // was wrong. Passing a new `nodeTypes` array is NOT enough on its own:
  //
  //   • `<Root>` calls `kM(nodeTypes)` on every render, which writes a
  //     MODULE-LEVEL variable (`x1`). That part does update.
  //   • But the properties panel does not read that variable. It reads
  //     `getNodeDefinition(type)` off the Zustand store, and that reads
  //     `store.data` — a SNAPSHOT copied from the module variable by
  //     `fetchData()`.
  //   • `fetchData()` is called in exactly one place: the Palette sidebar's own
  //     `useEffect(() => { fetchData() }, [fetchData])`. `fetchData` is a stable
  //     store reference, so that effect runs ONCE, on mount.
  //
  // So without this, the agent and rule dropdowns would stay empty forever: the
  // definition the panel renders was frozen before the vendors answered.
  //
  // ⚠️ AND THE ORDER IS THE REASON THIS IS AN EFFECT. React renders the child
  // before running the parent's effects, so by the time this runs, `<Root>`'s
  // render has already written the new palette into the module variable and
  // `fetchData()` copies the CURRENT one. Calling it during render would copy
  // the previous.
  //
  // Harmless on mount, where it re-takes a snapshot the Palette just took.
  useEffect(() => {
    useStore.getState().fetchData();
  }, [paletteItems]);

  // Root 2.3.0 omits globalVariables from its props. Its child effects load
  // nodes/edges first; this parent effect restores the remaining persisted field.
  useEffect(() => {
    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
    resetExecution();
    resetPanels();
    return () => {
      resetExecution();
      resetPanels();
    };
  }, [workflowId, initialGlobalVariables]);

  // Published to a module store rather than passed down: the header control is
  // registered at module scope and mounted by the SDK's own tree, so there is no
  // props path to it. Same mechanism, same reason, as use-panels-store.
  //
  // `.join()` as the dependency, not the array: `secretNames` is a fresh array
  // on every server render, and depending on its identity would re-set the store
  // on every re-render for no change.
  const secretNamesKey = secretNames.join(",");
  useEffect(() => {
    setSecretNames(secretNamesKey === "" ? [] : secretNamesKey.split(","));
  }, [secretNamesKey]);

  return (
    <>
      {dialLists.errors.length > 0 && (
        // ⚠️ THE FAILURE IS SAID OUT LOUD, not folded into the dropdown.
        //
        // The tempting alternative — an option reading "טעינה נכשלה" — would put
        // a non-value in a list of values and be selectable. An owner who picked
        // it would be choosing the blank default while believing they had chosen
        // something. So the list stays honest (it holds only real rules and real
        // agents) and the reason it is short is stated here, next to a retry.
        //
        // ⚠️ ABOVE THE FRAME AND IN NORMAL FLOW, not floating inside it. It sat
        // `absolute top-2` within the editor frame for one revision, which put it
        // straight over the SDK's app bar — an alert covering the Save button is
        // a worse bug than the one it reports.
        //
        // `role="alert"` and not a toast: this is a persistent condition, not an
        // event, and it stays until the retry succeeds.
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <span>{dialLists.errors.join(" · ")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isLoadingDialLists}
            onClick={loadDialLists}
          >
            {isLoadingDialLists ? "טוען…" : "נסו שוב"}
          </Button>
        </div>
      )}
      {/*
        THE POSITIONING CONTEXT, and the whole reason this file was rewritten.
        The SDK's own root is
          ._container_ { position: absolute; height: 100%; width: 100% }
        so it fills its nearest POSITIONED ancestor. Without `relative` here it
        escapes to the viewport and covers the admin shell. The height must be
        explicit for the same reason: `height: 100%` against an auto-height
        parent resolves to nothing.
      */}
      <div className="kalfa-workflow-frame relative h-[calc(100dvh-14rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border">
        <WorkflowBuilder.Root
          key={workflowId}
          name={name}
          // Replaces the vendor's "Workflow Builder" wordmark, which is their
          // branding on our admin page. An element is rendered as-is (the prop
          // also takes an image URL or a { light, dark } pair, neither of which
          // we need), and an icon costs a quarter of the wordmark's width — which
          // is what the app bar runs out of first on a phone.
          logo={
            <Icon name="FlowArrow" size="large" aria-label="עורך התהליכים" />
          }
          layoutDirection={layoutDirection}
          nodeTypes={paletteItems}
          // Populates the "בחירת תבנית" modal, which offered only "קנבס ריק"
          // because this prop defaults to []. Module-scope array — upstream
          // requires a stable reference, same as nodeTypes.
          diagramTemplates={DIAGRAM_TEMPLATES}
          initialNodes={normalizedInitialNodes}
          initialEdges={initialEdges}
          isValidConnection={isValidConnection}
          // Mounts the per-node execution badges into the OptionalNodeContent slot.
          // Module-scope array: `plugins` is read once on first mount, and a fresh
          // array each render would be a new reference for no reason.
          plugins={PLUGINS}
          jsonForm={JSON_FORM}
          // MUST be passed. The default is { strategy: 'localStorage' } — omit it
          // and the workflow is written to the browser instead of to us, silently.
          // 'api' is not an option either: upstream documents that it "issues plain
          // fetch() calls with no auth headers", and this endpoint cannot be
          // unauthenticated. 'props' is the only candidate.
          integration={{
            strategy: "props",
            onDataSave: makeSaveHandler(workflowId, saveAction),
```

## 8. Existing SDK integration invariant test
```text
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The assumptions this app makes about @workflowbuilder/sdk, turned into checks.
//
// ⚠️ WHY THESE ARE TESTS AND NOT NOTES. Every one of them was established by
// reading the SDK's own docs and then the published artifact, and every one of
// them is invisible at the type level: the compiler cannot see a second `<Root>`
// on a page, a subpath import that reaches into internals, or an immer copy that
// became shared on the next `npm install`. A note records what was true in
// September; a test says so on the day it stops being true — which is the day a
// version bump lands, and the only day anyone can act on it cheaply.

const ROOT = process.cwd();
const SDK = join(ROOT, 'node_modules/@workflowbuilder/sdk');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = walk(join(ROOT, 'src'));

describe('SDK integration invariants', () => {
  it('mounts exactly one <WorkflowBuilder.Root>', () => {
    // ⚠️ "Mount only one <WorkflowBuilder.Root> per page. Multi-instance is not
    // supported: the plugin / decorator / JsonForms / i18n registries are
    // module-level singletons shared across mounts" — and the imperative
    // `useStore.{getState,setState,subscribe}` facade resolves through a
    // module-level "current" pointer, so a second Root would not merely render
    // twice: writes from one subtree would leak into the other.
    //
    // We call that facade directly (`useStore.setState({ globalVariables })`,
    // `useStore.getState().fetchData()`), so the leak would be ours to debug.
    // ⚠️ A MOUNT, NOT A MENTION. A plain `includes` counted three files on its
    // first run — two of them JSDoc blocks explaining the prop contract. A guard
    // that fails on its own documentation trains people to weaken it, so the
    // match is anchored: the line, trimmed, must OPEN with the element. A
    // comment line starts with `*` or `//`, a string with a quote.
    const mounts = SOURCES.filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => line.trimStart().startsWith('<WorkflowBuilder.Root')),
    );
    expect(mounts.map((f) => f.slice(ROOT.length + 1))).toHaveLength(1);
  });

  it('imports only the curated barrel, never a subpath', () => {
    // "@workflowbuilder/sdk/<subpath> ships raw .ts files and reaches into SDK
    // internals that may change without notice … Subpath imports are for
    // monorepo use only." The one sanctioned exception is the stylesheet.
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/['"]@workflowbuilder\/sdk\/([^'"]+)['"]/g)) {
        if (m[1] !== 'style.css') offenders.push(`${file.slice(ROOT.length + 1)} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the SDK still does not disable immer auto-freeze globally', () => {
    // ⚠️ THE DOCS SAY IT DOES, AND THE ARTIFACT DOES NOT. `get-started/
    // side-effects` states the SDK calls `setAutoFreeze(false)` on import and
    // warns that this "disables auto-freeze globally for the host app — any of
    // your own reducers, RTK slices … lose that protection". RTK IS in our
    // runtime (recharts pulls it), so that warning would land on us.
    //
    // In 2.3.0 the published dist contains ZERO occurrences of autoFreeze: the
    // bundle imports `produce` from immer and nothing else. If a future version
    // restores the call, this test fails and the immer-copy check below becomes
    // the thing that decides whether it reaches our reducers.
    const dist = join(SDK, 'dist');
    const hits = readdirSync(dist)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /autoFreeze/i.test(readFileSync(join(dist, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the SDK keeps its own immer copy, so any future freeze call cannot reach ours', () => {
    // The docs' warning rests on immer being "a shared, deduped dependency".
    // Here it is not: the SDK carries a nested copy at a different major version
    // from the root one that zustand and RTK resolve. That containment is what
    // makes the test above a warning rather than an incident, so it is pinned
    // too — an `npm install` that dedupes them would remove it silently.
    const nested = join(SDK, 'node_modules/immer/package.json');
    const hoisted = join(ROOT, 'node_modules/immer/package.json');
    expect(existsSync(nested), 'the SDK no longer carries its own immer copy').toBe(true);
    const major = (p: string) =>
      String((JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version).split('.')[0];
    expect(major(nested)).not.toBe(major(hoisted));
  });

  it('the palette is refreshed after its data changes, not merely re-passed', () => {
    // ⚠️ MEASURED IN THE BUNDLE: `<Root>` writes `nodeTypes` into a module-level
    // variable on every render, but the properties panel reads
    // `getNodeDefinition` off the STORE, and the store's copy is a snapshot taken
    // by `fetchData()` — which the Palette calls once, in a `useEffect` keyed on
    // the (stable) store function.
    //
    // So a new `nodeTypes` array alone never reaches an open form. The live
    // agent/rule dropdowns depend entirely on this refresh; without it they stay
    // empty forever and nothing errors.
    const editor = readFileSync(
      join(ROOT, 'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx'),
      'utf8',
    );
    expect(editor).toContain('fetchData()');
    // Keyed on the palette itself: keyed on anything narrower and a list that
    // arrives later would not trigger it.
    expect(editor).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[^}]*fetchData\(\)[^}]*\},\s*\[paletteItems\]\)/);
  });
});
```

## 9. Imports of execution/panel stores in tests
```text
```

## 10. revalidatePath actions affecting this page
```text
src/app/(admin)/admin/workflows/arm-toggle.tsx-1-'use client';
src/app/(admin)/admin/workflows/arm-toggle.tsx-2-
src/app/(admin)/admin/workflows/arm-toggle.tsx-3-import { useState, useTransition } from 'react';
src/app/(admin)/admin/workflows/arm-toggle.tsx-4-
src/app/(admin)/admin/workflows/arm-toggle.tsx-5-import { Button } from '@/components/ui/button';
src/app/(admin)/admin/workflows/arm-toggle.tsx-6-
src/app/(admin)/admin/workflows/arm-toggle.tsx:7:import { setWorkflowActiveAction } from './actions';
src/app/(admin)/admin/workflows/arm-toggle.tsx-8-
src/app/(admin)/admin/workflows/arm-toggle.tsx-9-/**
src/app/(admin)/admin/workflows/arm-toggle.tsx-10- * Arm / disarm, and the place the conversion errors become visible.
src/app/(admin)/admin/workflows/arm-toggle.tsx-11- *
src/app/(admin)/admin/workflows/arm-toggle.tsx-12- * Arming is refused when the graph fails the contract, and the reason has to
src/app/(admin)/admin/workflows/arm-toggle.tsx-13- * reach the owner — "nothing happened" would be the worst possible response to
src/app/(admin)/admin/workflows/arm-toggle.tsx-14- * pressing a switch. Disarming is never refused: a workflow that misbehaves must
src/app/(admin)/admin/workflows/arm-toggle.tsx-15- * always be switchable off, whatever state its graph is in.
src/app/(admin)/admin/workflows/arm-toggle.tsx-16- */
src/app/(admin)/admin/workflows/arm-toggle.tsx-17-export function ArmToggle({ id, isActive }: { id: string; isActive: boolean }) {
--
src/app/(admin)/admin/workflows/arm-toggle.tsx-19-  const [notice, setNotice] = useState<string | null>(null);
src/app/(admin)/admin/workflows/arm-toggle.tsx-20-  const [pending, startTransition] = useTransition();
src/app/(admin)/admin/workflows/arm-toggle.tsx-21-
src/app/(admin)/admin/workflows/arm-toggle.tsx-22-  const toggle = () => {
src/app/(admin)/admin/workflows/arm-toggle.tsx-23-    setErrors([]);
src/app/(admin)/admin/workflows/arm-toggle.tsx-24-    setNotice(null);
src/app/(admin)/admin/workflows/arm-toggle.tsx-25-    startTransition(async () => {
src/app/(admin)/admin/workflows/arm-toggle.tsx-26-      const formData = new FormData();
src/app/(admin)/admin/workflows/arm-toggle.tsx-27-      formData.set('id', id);
src/app/(admin)/admin/workflows/arm-toggle.tsx-28-      formData.set('isActive', String(!isActive));
src/app/(admin)/admin/workflows/arm-toggle.tsx:29:      const result = await setWorkflowActiveAction(formData);
src/app/(admin)/admin/workflows/arm-toggle.tsx-30-      if (!result.ok) setErrors(result.errors);
src/app/(admin)/admin/workflows/arm-toggle.tsx-31-      // Arming can do one thing BESIDES arming — claim the guest-list role for
src/app/(admin)/admin/workflows/arm-toggle.tsx-32-      // the number the trigger names — and that changes how every inbound
src/app/(admin)/admin/workflows/arm-toggle.tsx-33-      // message routes. It must not pass without a word.
src/app/(admin)/admin/workflows/arm-toggle.tsx-34-      else if (result.notice) setNotice(result.notice);
src/app/(admin)/admin/workflows/arm-toggle.tsx-35-    });
src/app/(admin)/admin/workflows/arm-toggle.tsx-36-  };
src/app/(admin)/admin/workflows/arm-toggle.tsx-37-
src/app/(admin)/admin/workflows/arm-toggle.tsx-38-  return (
src/app/(admin)/admin/workflows/arm-toggle.tsx-39-    <div className="flex flex-col items-start gap-2">
--
src/app/(admin)/admin/workflows/actions.ts-43-const manualRunSchema = z.object({
src/app/(admin)/admin/workflows/actions.ts-44-  eventId: z.uuid(),
src/app/(admin)/admin/workflows/actions.ts-45-  contactId: z.uuid(),
src/app/(admin)/admin/workflows/actions.ts-46-  messageText: z.string().max(4096).optional(),
src/app/(admin)/admin/workflows/actions.ts-47-  buttonPayload: z.string().max(256).optional(),
src/app/(admin)/admin/workflows/actions.ts-48-});
src/app/(admin)/admin/workflows/actions.ts-49-
src/app/(admin)/admin/workflows/actions.ts-50-export async function createWorkflowAction(formData: FormData): Promise<void> {
src/app/(admin)/admin/workflows/actions.ts-51-  const name = String(formData.get('name') ?? '');
src/app/(admin)/admin/workflows/actions.ts-52-  const id = await createWorkflow(name);
src/app/(admin)/admin/workflows/actions.ts:53:  revalidatePath('/admin/workflows');
src/app/(admin)/admin/workflows/actions.ts-54-  redirect(`/admin/workflows/${id}`);
src/app/(admin)/admin/workflows/actions.ts-55-}
src/app/(admin)/admin/workflows/actions.ts-56-
src/app/(admin)/admin/workflows/actions.ts-57-/**
src/app/(admin)/admin/workflows/actions.ts-58- * The editor's save callback.
src/app/(admin)/admin/workflows/actions.ts-59- *
src/app/(admin)/admin/workflows/actions.ts-60- * THROWS on failure and returns nothing on success. That is not incidental: the
src/app/(admin)/admin/workflows/actions.ts-61- * SDK's snackbar treats every non-empty resolution of `onDataSave` as success,
src/app/(admin)/admin/workflows/actions.ts-62- * including the literal string `'error'`, so the only way to tell the owner a
src/app/(admin)/admin/workflows/actions.ts-63- * save failed is to throw. See the comment in workflow-editor.tsx.
--
src/app/(admin)/admin/workflows/actions.ts-65-export async function saveWorkflowAction(
src/app/(admin)/admin/workflows/actions.ts-66-  workflowId: string,
src/app/(admin)/admin/workflows/actions.ts-67-  definition: unknown,
src/app/(admin)/admin/workflows/actions.ts-68-): Promise<void> {
src/app/(admin)/admin/workflows/actions.ts-69-  const id = idSchema.parse(workflowId);
src/app/(admin)/admin/workflows/actions.ts-70-  await saveWorkflowDefinition(id, definition);
src/app/(admin)/admin/workflows/actions.ts-71-  // Not revalidated. The editor holds the canvas state and a refresh mid-edit
src/app/(admin)/admin/workflows/actions.ts-72-  // would fight the auto-save; the list page re-reads on its own navigation.
src/app/(admin)/admin/workflows/actions.ts-73-}
src/app/(admin)/admin/workflows/actions.ts-74-
src/app/(admin)/admin/workflows/actions.ts:75:export async function setWorkflowActiveAction(
src/app/(admin)/admin/workflows/actions.ts-76-  formData: FormData,
src/app/(admin)/admin/workflows/actions.ts-77-): Promise<ArmResult> {
src/app/(admin)/admin/workflows/actions.ts-78-  const id = idSchema.parse(String(formData.get('id') ?? ''));
src/app/(admin)/admin/workflows/actions.ts-79-  const isActive = String(formData.get('isActive') ?? '') === 'true';
src/app/(admin)/admin/workflows/actions.ts-80-
src/app/(admin)/admin/workflows/actions.ts-81-  const result = await setWorkflowActive(id, isActive);
src/app/(admin)/admin/workflows/actions.ts:82:  revalidatePath('/admin/workflows');
src/app/(admin)/admin/workflows/actions.ts:83:  revalidatePath(`/admin/workflows/${id}`);
src/app/(admin)/admin/workflows/actions.ts-84-  return result;
src/app/(admin)/admin/workflows/actions.ts-85-}
src/app/(admin)/admin/workflows/actions.ts-86-
src/app/(admin)/admin/workflows/actions.ts-87-/**
src/app/(admin)/admin/workflows/actions.ts-88- * Delete a workflow.
src/app/(admin)/admin/workflows/actions.ts-89- *
src/app/(admin)/admin/workflows/actions.ts-90- * Returns the refusal rather than throwing it: "armed" and "has runs" are
src/app/(admin)/admin/workflows/actions.ts-91- * ordinary answers the owner needs to read, not failures. Only an unexpected
src/app/(admin)/admin/workflows/actions.ts-92- * database error throws.
src/app/(admin)/admin/workflows/actions.ts-93- */
src/app/(admin)/admin/workflows/actions.ts-94-export async function deleteWorkflowAction(formData: FormData): Promise<DeleteResult> {
src/app/(admin)/admin/workflows/actions.ts-95-  const id = idSchema.parse(String(formData.get('id') ?? ''));
src/app/(admin)/admin/workflows/actions.ts-96-  const result = await deleteWorkflow(id);
src/app/(admin)/admin/workflows/actions.ts:97:  if (result.ok) revalidatePath('/admin/workflows');
src/app/(admin)/admin/workflows/actions.ts-98-  return result;
src/app/(admin)/admin/workflows/actions.ts-99-}
src/app/(admin)/admin/workflows/actions.ts-100-
src/app/(admin)/admin/workflows/actions.ts-101-/** Cancel a run that has not been picked up yet. */
src/app/(admin)/admin/workflows/actions.ts:102:export async function cancelRunAction(formData: FormData): Promise<CancelRunResult> {
src/app/(admin)/admin/workflows/actions.ts-103-  const workflowId = idSchema.parse(String(formData.get('workflowId') ?? ''));
src/app/(admin)/admin/workflows/actions.ts-104-  const runId = idSchema.parse(String(formData.get('runId') ?? ''));
src/app/(admin)/admin/workflows/actions.ts-105-
src/app/(admin)/admin/workflows/actions.ts-106-  const result = await cancelRun(runId);
src/app/(admin)/admin/workflows/actions.ts-107-  // Revalidated even on refusal: a refusal means the row moved on without the
src/app/(admin)/admin/workflows/actions.ts-108-  // page noticing, so the table is stale either way.
src/app/(admin)/admin/workflows/actions.ts:109:  revalidatePath(`/admin/workflows/${workflowId}`);
src/app/(admin)/admin/workflows/actions.ts-110-  return result;
src/app/(admin)/admin/workflows/actions.ts-111-}
src/app/(admin)/admin/workflows/actions.ts-112-
src/app/(admin)/admin/workflows/actions.ts-113-const scenarioSchema = z.object({
src/app/(admin)/admin/workflows/actions.ts-114-  messageText: z.string().max(4096),
src/app/(admin)/admin/workflows/actions.ts-115-  buttonPayload: z.string().max(256),
src/app/(admin)/admin/workflows/actions.ts-116-  guestCase: z.enum(DRY_RUN_GUEST_CASES),
src/app/(admin)/admin/workflows/actions.ts-117-});
src/app/(admin)/admin/workflows/actions.ts-118-
src/app/(admin)/admin/workflows/actions.ts-119-/**
--
src/app/(admin)/admin/workflows/actions.ts-128- * The ONE action in this file that carries its own gate, and deliberately so.
src/app/(admin)/admin/workflows/actions.ts-129- * Everywhere else the rule holds — the data layer gates, the action is a thin
src/app/(admin)/admin/workflows/actions.ts-130- * wrapper — but `startManualRun` is domain logic in `src/lib/workflow/`, not a
src/app/(admin)/admin/workflows/actions.ts-131- * DAL function, so nothing below it would check anything.
src/app/(admin)/admin/workflows/actions.ts-132- *
src/app/(admin)/admin/workflows/actions.ts-133- * Unlike `testWorkflowAction` this DOES have side effects: the run is executed
src/app/(admin)/admin/workflows/actions.ts-134- * by the worker with the real ports, so a `send_whatsapp` node sends and a
src/app/(admin)/admin/workflows/actions.ts-135- * `start_rsvp_ai_callback` node dials. The panel that calls it says so, names
src/app/(admin)/admin/workflows/actions.ts-136- * the person, and asks for a confirmation first.
src/app/(admin)/admin/workflows/actions.ts-137- */
src/app/(admin)/admin/workflows/actions.ts:138:export async function startManualRunAction(
src/app/(admin)/admin/workflows/actions.ts-139-  workflowId: string,
src/app/(admin)/admin/workflows/actions.ts-140-  input: unknown,
src/app/(admin)/admin/workflows/actions.ts-141-): Promise<ManualRunResult> {
src/app/(admin)/admin/workflows/actions.ts-142-  const id = idSchema.parse(workflowId);
src/app/(admin)/admin/workflows/actions.ts-143-  const parsed = manualRunSchema.parse(input);
src/app/(admin)/admin/workflows/actions.ts-144-
src/app/(admin)/admin/workflows/actions.ts-145-  // BOTH permissions, and that is the point.
src/app/(admin)/admin/workflows/actions.ts-146-  //
src/app/(admin)/admin/workflows/actions.ts-147-  // This one action reads a guest's identity AND dials their phone, so neither
src/app/(admin)/admin/workflows/actions.ts-148-  // half should be enough on its own: `view_customer_data` without
--
src/app/(admin)/admin/workflows/actions.ts-176-        contactId: parsed.contactId,
src/app/(admin)/admin/workflows/actions.ts-177-        outcome: result.ok ? 'started' : result.reason,
src/app/(admin)/admin/workflows/actions.ts-178-        ...(result.ok ? { runId: result.runId } : {}),
src/app/(admin)/admin/workflows/actions.ts-179-      },
src/app/(admin)/admin/workflows/actions.ts-180-    });
src/app/(admin)/admin/workflows/actions.ts-181-  } catch {
src/app/(admin)/admin/workflows/actions.ts-182-    // Audit only — never fails a run the worker has already been handed.
src/app/(admin)/admin/workflows/actions.ts-183-  }
src/app/(admin)/admin/workflows/actions.ts-184-
src/app/(admin)/admin/workflows/actions.ts-185-  // The run row exists now; the runs list on the page is stale.
src/app/(admin)/admin/workflows/actions.ts:186:  revalidatePath(`/admin/workflows/${id}`);
src/app/(admin)/admin/workflows/actions.ts-187-  return result;
src/app/(admin)/admin/workflows/actions.ts-188-}
src/app/(admin)/admin/workflows/actions.ts-189-
src/app/(admin)/admin/workflows/actions.ts-190-/** Events a manual run may target. Thin wrapper; the loader carries the gate. */
src/app/(admin)/admin/workflows/actions.ts-191-export async function listManualRunEventsAction(): Promise<ManualRunEvent[]> {
src/app/(admin)/admin/workflows/actions.ts-192-  return listEventsForManualRun();
src/app/(admin)/admin/workflows/actions.ts-193-}
src/app/(admin)/admin/workflows/actions.ts-194-
src/app/(admin)/admin/workflows/actions.ts-195-/** Contacts of one event, with the guest names behind each phone. */
src/app/(admin)/admin/workflows/actions.ts-196-export async function listManualRunContactsAction(
--
src/app/(admin)/admin/workflows/row-actions.tsx-1-'use client';
src/app/(admin)/admin/workflows/row-actions.tsx-2-
src/app/(admin)/admin/workflows/row-actions.tsx-3-import { useState, useTransition } from 'react';
src/app/(admin)/admin/workflows/row-actions.tsx-4-
src/app/(admin)/admin/workflows/row-actions.tsx-5-import { Button } from '@/components/ui/button';
src/app/(admin)/admin/workflows/row-actions.tsx-6-
src/app/(admin)/admin/workflows/row-actions.tsx:7:import { cancelRunAction, deleteWorkflowAction } from './actions';
src/app/(admin)/admin/workflows/row-actions.tsx-8-
src/app/(admin)/admin/workflows/row-actions.tsx-9-/**
src/app/(admin)/admin/workflows/row-actions.tsx-10- * The two destructive controls, sharing one shape with `ArmToggle`: press,
src/app/(admin)/admin/workflows/row-actions.tsx-11- * transition, and render the server's refusal in place.
src/app/(admin)/admin/workflows/row-actions.tsx-12- *
src/app/(admin)/admin/workflows/row-actions.tsx-13- * Both refusals are ORDINARY answers rather than errors — "the workflow is
src/app/(admin)/admin/workflows/row-actions.tsx-14- * still armed", "the run already started" — so they arrive as a result and are
src/app/(admin)/admin/workflows/row-actions.tsx-15- * announced with `role="alert"`, because the press causes no navigation and the
src/app/(admin)/admin/workflows/row-actions.tsx-16- * reason would otherwise be invisible.
src/app/(admin)/admin/workflows/row-actions.tsx-17- */
--
src/app/(admin)/admin/workflows/row-actions.tsx-93-}) {
src/app/(admin)/admin/workflows/row-actions.tsx-94-  const [errors, setErrors] = useState<string[]>([]);
src/app/(admin)/admin/workflows/row-actions.tsx-95-  const [pending, startTransition] = useTransition();
src/app/(admin)/admin/workflows/row-actions.tsx-96-
src/app/(admin)/admin/workflows/row-actions.tsx-97-  const cancel = () => {
src/app/(admin)/admin/workflows/row-actions.tsx-98-    setErrors([]);
src/app/(admin)/admin/workflows/row-actions.tsx-99-    startTransition(async () => {
src/app/(admin)/admin/workflows/row-actions.tsx-100-      const formData = new FormData();
src/app/(admin)/admin/workflows/row-actions.tsx-101-      formData.set('workflowId', workflowId);
src/app/(admin)/admin/workflows/row-actions.tsx-102-      formData.set('runId', runId);
src/app/(admin)/admin/workflows/row-actions.tsx:103:      const result = await cancelRunAction(formData);
src/app/(admin)/admin/workflows/row-actions.tsx-104-      if (!result.ok) setErrors(result.errors);
src/app/(admin)/admin/workflows/row-actions.tsx-105-    });
src/app/(admin)/admin/workflows/row-actions.tsx-106-  };
src/app/(admin)/admin/workflows/row-actions.tsx-107-
src/app/(admin)/admin/workflows/row-actions.tsx-108-  return (
src/app/(admin)/admin/workflows/row-actions.tsx-109-    <div className="flex flex-col items-start gap-2">
src/app/(admin)/admin/workflows/row-actions.tsx-110-      <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
src/app/(admin)/admin/workflows/row-actions.tsx-111-        ביטול
src/app/(admin)/admin/workflows/row-actions.tsx-112-      </Button>
src/app/(admin)/admin/workflows/row-actions.tsx-113-      <Refusals errors={errors} />
--
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-14-// design below follows from that: the person is named before the button is
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-15-// armed, the button says what it will do, and it asks once more.
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-16-import { useEffect, useState, useTransition } from 'react';
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-17-
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-18-import { Button } from '@/components/ui/button';
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-19-import type { ManualRunContact, ManualRunEvent } from '@/lib/data/admin/workflows';
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-20-
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-21-import {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-22-  listManualRunContactsAction,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-23-  listManualRunEventsAction,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx:24:  startManualRunAction,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-25-} from '../actions';
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-26-
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-27-const REFUSAL_LABEL: Record<string, string> = {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-28-  workflow_not_found: 'התהליך לא נמצא.',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-29-  workflow_scoped_to_other_event: 'התהליך משויך לאירוע אחר ולא ירוץ על האירוע שנבחר.',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-30-  no_trigger_node: 'לתהליך אין צומת התחלה יחיד. פתחו את התרשים ותקנו לפני הרצה.',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-31-  contact_not_in_event: 'איש הקשר אינו שייך לאירוע שנבחר.',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-32-  run_not_created: 'יצירת ההרצה נכשלה.',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-33-};
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-34-
--
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-108-    setContactId('');
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-109-    setArmed(false);
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-110-  };
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-111-
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-112-  const chosen = contacts.find((c) => c.id === contactId);
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-113-
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-114-  const run = () => {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-115-    setNotice(null);
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-116-    startTransition(async () => {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-117-      try {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx:118:        const result = await startManualRunAction(workflowId, {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-119-          eventId,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-120-          contactId,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-121-          messageText,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-122-          buttonPayload,
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-123-        });
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-124-        if (result.ok) {
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-125-          setArmed(false);
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-126-          setNotice({
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-127-            kind: 'ok',
src/app/(admin)/admin/workflows/[id]/run-now-panel.tsx-128-            text: `ההרצה נוצרה ונשלחה לעובד. מזהה: ${result.runId.slice(0, 8)} — היא תופיע ברשימת ההרצות למטה.`,
```
