# §6 — RSC Boundary Evidence

Generated: 2026-09-15T22:11:11+03:00
HEAD: c0de7c82f29dc5873cfc932a698ae1fcd8e3ef41

## 1. Exact runtime versions
```text
next=16.3.4 react=19.2.8 react-dom=19.2.8 zustand=5.0.15
```

## 2. Complete workflow page
```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, formatDateTime } from "../../_components";

import { editorDiagramSchema } from "@/lib/workflow/adapter/editor-schema";
import { getWorkflow, listWorkflowRuns } from "@/lib/data/admin/workflows";
import { listProviderNumbers } from "@/lib/data/admin/integrations/provider-numbers";

import { saveWorkflowAction } from "../actions";

import { CancelRunButton } from "../row-actions";

import { RunNowPanel } from "./run-now-panel";
import { RunWatchButton } from "./run-watcher";
import { TestPanel } from "./test-panel";
import { listSecretNames } from "@/lib/workflow/secrets";

import { listDialableVoicePurposes } from "@/lib/data/voice-purposes";

import { WorkflowEditor } from "./workflow-editor";

export const metadata: Metadata = { title: "עריכת תהליך" };

/**
 * Run states, in the product's own language.
 *
 * The column printed the raw column value, so an owner reading a Hebrew screen
 * met `waiting` in English the day `logic.wait` shipped. Unknown values fall
 * through to the raw string rather than to a guess: a state nobody translated is
 * still more useful shown than hidden.
 */
const RUN_STATUS_HE: Record<string, string> = {
  pending: "ממתינה בתור",
  running: "רצה",
  // Not "waiting in queue" — this one is parked on a `logic.wait` deadline, and
  // conflating the two would make a run that sleeps for two days look stuck.
  waiting: "בהמתנה מתוזמנת",
  completed: "הושלמה",
  incomplete: "הסתיימה חלקית",
  failed: "נכשלה",
  cancelled: "בוטלה",
  cancelling: "בביטול",
};

export default async function AdminWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const runs = await listWorkflowRuns(id, 20);

  // The WhatsApp lines the trigger node may be pointed at.
  //
  // Read HERE and passed down because the palette is built in the browser and
  // the numbers are rows. No new permission: `getWorkflow` above already
  // requires `manage_settings`, which is exactly what this reader requires, so
  // anyone who can open this page could already see them.
  //
  // INACTIVE NUMBERS ARE NOT OFFERED — including one deleted at Meta, which the
  // sync now switches off. A workflow already pointing at such a number keeps
  // working: matching is against the stored phone_number_id, never against this
  // list. The list answers "what may be chosen today", not "what is still valid".
  // The voice agents that are actually configured, for the call node's dropdown.
  // Rows, not a constant: a purpose added today must appear without a deploy.
  //
  // ⚠️ `listDialable…`, not `listVoicePurposes`: a built-in or rule-less purpose
  // is refused by the dialler, so offering it here would let an owner arm a
  // workflow that cannot place its call. See the function's own note.
  const voicePurposes = (await listDialableVoicePurposes()).map((p) => ({
    key: p.key,
    displayName: p.displayName,
  }));

  // ONE READ, TWO LISTS. Both dropdowns are fed by `provider_numbers`, which is
  // the synced mirror of what each vendor says the account owns — so neither
  // costs a vendor round trip here.
  const providerNumbers = await listProviderNumbers();

  const whatsappNumbers = providerNumbers
    .filter(
      (n) =>
        n.provider === "meta_whatsapp" && n.providerRef !== null && n.isActive,
    )
    .map((n) => ({
      providerRef: n.providerRef as string,
      label: `${n.e164 ?? n.providerRef} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  // The numbers a call may go out FROM.
  //
  // ⚠️ KEYED ON `e164`, NOT ON `providerRef` — and the difference is load-bearing.
  // The WhatsApp list above matches on the provider's own id because that is what
  // an inbound webhook carries. This one is handed to `VoxEngine.callPSTN(to,
  // callerid)` as the caller id, and that argument is a NUMBER. A `phone_id`
  // there would present as an invalid CLI, so a row with no synced E.164 is not
  // offerable at all.
  //
  // Deactivated numbers are excluded for the same reason as there: the list says
  // what may be chosen today. A node already pointing at one keeps its stored
  // value — matching never consults this list.
  const voiceCallerIds = providerNumbers
    .filter((n) => n.provider === "voximplant" && n.e164 !== null && n.isActive)
    .map((n) => ({
      value: n.e164 as string,
      label: `${n.e164} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  // NAMES ONLY — `listSecretNames` strips the values, and this is a server
  // component, so the environment is read here and never shipped. An empty list
  // is a legitimate state (no secret has been configured yet) and the header
  // control says so with the instruction rather than showing nothing.
  const secretNames = listSecretNames();

  // The stored jsonb is parsed before it reaches the editor. A row that cannot
  // be parsed opens as an empty canvas rather than crashing the page — the
  // owner can always draw their way out, which is not true if the route throws.
  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  const nodes = parsed.success ? parsed.data.nodes : [];
  const edges = parsed.success ? parsed.data.edges : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/workflows"
          className="text-sm underline underline-offset-4"
        >
          ← כל התהליכים
        </Link>
        <h1 className="text-2xl font-bold">{workflow.name}</h1>
        <Badge variant={workflow.isActive ? "success" : "secondary"}>
          {workflow.isActive ? "פעיל" : "כבוי"}
        </Badge>
        {!parsed.success && (
          <span role="alert" className="text-sm text-destructive">
            התהליך השמור לא ניתן לקריאה ונפתח כקנבס ריק. שמירה תדרוס אותו.
          </span>
        )}
      </div>

      <WorkflowEditor
        key={workflow.id}
        workflowId={workflow.id}
        name={workflow.name}
        layoutDirection={
          parsed.success ? parsed.data.layoutDirection : undefined
        }
        initialGlobalVariables={
          parsed.success ? parsed.data.globalVariables : undefined
        }
        initialNodes={nodes as never}
        initialEdges={edges as never}
        whatsappNumbers={whatsappNumbers}
        voicePurposes={voicePurposes}
        voiceCallerIds={voiceCallerIds}
        secretNames={secretNames}
        saveAction={saveWorkflowAction}
      />

      <RunNowPanel workflowId={workflow.id} scopedEventId={workflow.eventId} />

      <TestPanel workflowId={workflow.id} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">הרצות אחרונות</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא רץ. תהליך כבוי לא רץ אף פעם — הפעילו אותו ברשימה.
          </p>
        ) : (
          <>
            {/*
              Cards on a phone, the table from `lg` up — the same shape as the
              workflow list, and for the reason recorded there: a `min-w` table
              on this page put "מעקב", and with it the cancel button, off-frame
              with no way to reach them.
            */}
            <ul className="space-y-3 lg:hidden">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="space-y-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {RUN_STATUS_HE[run.status] ?? run.status}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {run.triggerSource}
                    </span>
                  </div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>התחיל:</dt>
                      <dd>{formatDateTime(run.createdAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>הסתיים:</dt>
                      <dd>
                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                      </dd>
                    </div>
                  </dl>
                  {/* Only when there IS one — an empty "שגיאה:" label on every
                      successful run is noise on the screen with the least room. */}
                  {run.errorMessage ? (
                    <p className="text-sm text-destructive">
                      {run.errorMessage}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-start gap-2">
                    <RunWatchButton runId={run.id} />
                    {(run.status === "pending" || run.status === "waiting") && (
                      <CancelRunButton
                        workflowId={workflow.id}
                        runId={run.id}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
              <table className="w-full text-start text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-start font-medium">מצב</th>
                    <th className="p-3 text-start font-medium">מקור</th>
                    <th className="p-3 text-start font-medium">התחיל</th>
                    <th className="p-3 text-start font-medium">הסתיים</th>
                    <th className="p-3 text-start font-medium">שגיאה</th>
                    <th className="p-3 text-start font-medium">מעקב</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="p-3">
                        {RUN_STATUS_HE[run.status] ?? run.status}
                      </td>
                      <td className="p-3">{run.triggerSource}</td>
                      <td className="p-3">{formatDateTime(run.createdAt)}</td>
                      <td className="p-3">
                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                      </td>
                      <td className="p-3 text-destructive">
                        {run.errorMessage ?? ""}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <RunWatchButton runId={run.id} />
                          {/* Queued OR PARKED. `cancelRun` refuses anything else,
                              because the vendored runner cannot be interrupted
                              once it is inside runGraph — which is exactly why a
                              parked run CAN be cancelled: it is not inside it. It
                              is a row with a deadline and a job that has not
                              fired, and `logic.wait` allows up to a year of that. */}
                          {(run.status === "pending" ||
                            run.status === "waiting") && (
                            <CancelRunButton
                              workflowId={workflow.id}
                              runId={run.id}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
```

## 3. WorkflowEditor component declaration and props
```text
124-const isValidConnection: WorkflowBuilderIsValidConnection = ({ targetNode }) =>
125-  !isTriggerType(targetNode.data.type);
126-
127-const PLUGINS = [executionMarkersPlugin, appBarPlugin];
128-
129-// Custom JsonForms renderers. Module scope for the same reason as PLUGINS: the
130-// prop is read once, and a fresh object each render would re-register the
131-// registry on every keystroke in the properties panel.
132-//
133-// One entry so far — the HTTP node's header list, which has no built-in
134-// equivalent in the SDK's closed control union. See header-rows-control.tsx.
135-const JSON_FORM = { renderers: [headerRowsRenderer, checkboxListRenderer] };
136-
137-// Applied at module scope, which runs AFTER the SDK's own import has
138-// initialised i18next (the import above is evaluated first, in source order).
139-// `addResourceBundle` on an already-initialised instance needs no particular
140-// ordering — unlike the "configure i18next before importing the SDK" route
141-// upstream describes, which would depend on import order and be fragile here.
142-applyHebrewToSdk();
143-
144:export function WorkflowEditor({
145-  workflowId,
146-  name,
147-  initialNodes,
148-  initialEdges,
149-  layoutDirection,
150-  initialGlobalVariables,
151-  whatsappNumbers,
152-  voicePurposes,
153-  voiceCallerIds,
154-  secretNames,
155-  saveAction,
156-}: Props) {
157-  // ── the two live dial lists ────────────────────────────────────────────────
158-  //
159-  // ⚠️ FETCHED WHEN A CALL NODE IS FIRST SELECTED, never on mount. Opening a
160-  // workflow must not depend on Voximplant and ElevenLabs both being reachable,
161-  // and most workflows have no call node at all. Until the fetch lands the two
162-  // dropdowns offer only their blank default, which means "the rule configured
163-  // for the purpose" / "the agent configured in the scenario" — the behaviour
164-  // that shipped before these fields existed. A vendor outage therefore costs
--
404-/**
405- * Custom layout for the embedded admin editor.
406- *
407- * The SDK docs explicitly allow composing TopBar / Canvas / Palette /
408- * PropertiesPanel as children of Root, and that is what this is. What it does
409- * NOT do any more is replace the app bar.
410- *
411- * The reason it once did — "TopBar ships English controls" — stopped being true
412- * the moment `i18n-he.ts` landed: the bar renders entirely through `t(...)`, and
413- * that file now supplies Hebrew for every key it reaches. What the app bar is
414- * NOT is an overlay: `._container_` is a plain `display:flex; height:auto;
415- * width:100%` div in normal flow (verified in the shipped stylesheet), unlike
416- * Palette and PropertiesPanel, which the SDK sizes from its own row and which
417- * are the reason DefaultLayout could not simply be dropped into hand-rolled
418- * columns. So the bar composes here and the panels still do not.
419- *
420- * Mounting it back returns the SDK's auto-save and save-on-unload — both live
421- * inside its Save button — plus Settings, Import and Export, which existed in
422- * `useWorkflowBuilderActions` all along with nothing wired to them.
423- */
424:function WorkflowEditorLayout({
425-  /**
426-   * Called the first time a voice-call node is selected, so the editor can fetch
427-   * the two live dial lists then and not a moment earlier. Passed down rather
428-   * than watched by the parent because this component is inside `<Root>`, which
429-   * is where every other `useSingleSelectedElement` call on this page lives.
430-   */
431-  onVoiceCallNodeSelected,
432-  name,
433-  workflowId,
434-}: {
435-  onVoiceCallNodeSelected: () => void;
436-  /** Both only so the arm-blocker sync can rebuild the diagram it parses. */
437-  name: string;
438-  workflowId: string;
439-}) {
440-  const frameRef = useRef<HTMLDivElement>(null);
441-  const nodes = useStore((s) => s.nodes);
442-  const edges = useStore((s) => s.edges);
443-  const toggleSidebar = useStore((s) => s.toggleSidebar);
444-  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
```

## 4. Global variables parse/schema path
```text
src/app/(admin)/admin/workflows/[id]/page.tsx-1-import type { Metadata } from "next";
src/app/(admin)/admin/workflows/[id]/page.tsx-2-import Link from "next/link";
src/app/(admin)/admin/workflows/[id]/page.tsx-3-import { notFound } from "next/navigation";
src/app/(admin)/admin/workflows/[id]/page.tsx-4-
src/app/(admin)/admin/workflows/[id]/page.tsx-5-import { Badge, formatDateTime } from "../../_components";
src/app/(admin)/admin/workflows/[id]/page.tsx-6-
src/app/(admin)/admin/workflows/[id]/page.tsx:7:import { editorDiagramSchema } from "@/lib/workflow/adapter/editor-schema";
src/app/(admin)/admin/workflows/[id]/page.tsx-8-import { getWorkflow, listWorkflowRuns } from "@/lib/data/admin/workflows";
src/app/(admin)/admin/workflows/[id]/page.tsx-9-import { listProviderNumbers } from "@/lib/data/admin/integrations/provider-numbers";
src/app/(admin)/admin/workflows/[id]/page.tsx-10-
src/app/(admin)/admin/workflows/[id]/page.tsx-11-import { saveWorkflowAction } from "../actions";
src/app/(admin)/admin/workflows/[id]/page.tsx-12-
src/app/(admin)/admin/workflows/[id]/page.tsx-13-import { CancelRunButton } from "../row-actions";
src/app/(admin)/admin/workflows/[id]/page.tsx-14-
src/app/(admin)/admin/workflows/[id]/page.tsx-15-import { RunNowPanel } from "./run-now-panel";
--
src/app/(admin)/admin/workflows/[id]/page.tsx-116-  // component, so the environment is read here and never shipped. An empty list
src/app/(admin)/admin/workflows/[id]/page.tsx-117-  // is a legitimate state (no secret has been configured yet) and the header
src/app/(admin)/admin/workflows/[id]/page.tsx-118-  // control says so with the instruction rather than showing nothing.
src/app/(admin)/admin/workflows/[id]/page.tsx-119-  const secretNames = listSecretNames();
src/app/(admin)/admin/workflows/[id]/page.tsx-120-
src/app/(admin)/admin/workflows/[id]/page.tsx-121-  // The stored jsonb is parsed before it reaches the editor. A row that cannot
src/app/(admin)/admin/workflows/[id]/page.tsx-122-  // be parsed opens as an empty canvas rather than crashing the page — the
src/app/(admin)/admin/workflows/[id]/page.tsx-123-  // owner can always draw their way out, which is not true if the route throws.
src/app/(admin)/admin/workflows/[id]/page.tsx:124:  const parsed = editorDiagramSchema.safeParse(workflow.definition);
src/app/(admin)/admin/workflows/[id]/page.tsx-125-  const nodes = parsed.success ? parsed.data.nodes : [];
src/app/(admin)/admin/workflows/[id]/page.tsx-126-  const edges = parsed.success ? parsed.data.edges : [];
src/app/(admin)/admin/workflows/[id]/page.tsx-127-
src/app/(admin)/admin/workflows/[id]/page.tsx-128-  return (
src/app/(admin)/admin/workflows/[id]/page.tsx-129-    <div className="space-y-4">
src/app/(admin)/admin/workflows/[id]/page.tsx-130-      <div className="flex flex-wrap items-center gap-3">
src/app/(admin)/admin/workflows/[id]/page.tsx-131-        <Link
src/app/(admin)/admin/workflows/[id]/page.tsx-132-          href="/admin/workflows"
--
src/app/(admin)/admin/workflows/[id]/page.tsx-148-      <WorkflowEditor
src/app/(admin)/admin/workflows/[id]/page.tsx-149-        key={workflow.id}
src/app/(admin)/admin/workflows/[id]/page.tsx-150-        workflowId={workflow.id}
src/app/(admin)/admin/workflows/[id]/page.tsx-151-        name={workflow.name}
src/app/(admin)/admin/workflows/[id]/page.tsx-152-        layoutDirection={
src/app/(admin)/admin/workflows/[id]/page.tsx-153-          parsed.success ? parsed.data.layoutDirection : undefined
src/app/(admin)/admin/workflows/[id]/page.tsx-154-        }
src/app/(admin)/admin/workflows/[id]/page.tsx-155-        initialGlobalVariables={
src/app/(admin)/admin/workflows/[id]/page.tsx:156:          parsed.success ? parsed.data.globalVariables : undefined
src/app/(admin)/admin/workflows/[id]/page.tsx-157-        }
src/app/(admin)/admin/workflows/[id]/page.tsx-158-        initialNodes={nodes as never}
src/app/(admin)/admin/workflows/[id]/page.tsx-159-        initialEdges={edges as never}
src/app/(admin)/admin/workflows/[id]/page.tsx-160-        whatsappNumbers={whatsappNumbers}
src/app/(admin)/admin/workflows/[id]/page.tsx-161-        voicePurposes={voicePurposes}
src/app/(admin)/admin/workflows/[id]/page.tsx-162-        voiceCallerIds={voiceCallerIds}
src/app/(admin)/admin/workflows/[id]/page.tsx-163-        secretNames={secretNames}
src/app/(admin)/admin/workflows/[id]/page.tsx-164-        saveAction={saveWorkflowAction}
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-121- */
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-122-export function syncArmBlockerMarkers(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-123-  name: string,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-124-  edges: readonly WorkflowBuilderEdge[],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-125-  workflowId: string,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-126-): void {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-127-  const nodes = getStoreNodes();
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-128-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts:129:  // `findArmBlockersByNode` parses with `editorDiagramSchema` and returns []
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-130-  // for anything it cannot read — a half-built diagram mid-drag, for instance —
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-131-  // so this never invents a marker from a shape it did not understand.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-132-  const blockers = findArmBlockersByNode({ name, nodes, edges }, workflowId);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-133-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-134-  // ⚠️ `arm-only` ONLY, AND THIS FILTER IS THE POINT OF THE WHOLE PASS.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-135-  //
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-136-  // `findArmBlockersByNode` reports everything arming refuses, which includes
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-137-  // blank required fields, out-of-range numbers and the conditional body — and
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-188- * of twenty-two stored nodes already carry `properties.errors` — the save path
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-189- * is a verbatim pass-through and has never stripped anything. Schema errors are
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-190- * self-healing, because the SDK recomputes them on load; `customErrors` are not,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-191- * because nothing but this module computes them. Persisting one would show an
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-192- * owner a refusal that was fixed in another session and is no longer true.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-193- *
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-194- * ⚠️ AND IT IS STILL A PASS-THROUGH IN THE SENSE THAT MATTERS. The handler's own
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-195- * comment warns against rebuilding the payload from a chosen four fields — that
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts:196: * erased `globalVariables` once. This removes two keys BY NAME from inside each
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-197- * node's properties and copies everything else, so a field the vendor adds
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-198- * tomorrow still survives.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-199- */
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-200-export function stripComputedErrors<T extends { nodes?: unknown }>(data: T): T {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-201-  if (!Array.isArray(data.nodes)) return data;
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-202-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-203-  return {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.ts-204-    ...data,
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-38-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-39-    expect(properties).not.toHaveProperty('errors');
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-40-    expect(properties).not.toHaveProperty('customErrors');
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-41-    expect(properties.url).toBe('https://example.com');
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-42-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-43-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-44-  it('keeps every other field, including ones this code has never heard of', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-45-    // The trap the save handler's own comment records: rebuilding the payload
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:46:    // from a chosen set of fields erased `globalVariables` on every save. This
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-47-    // removes two keys by NAME and copies the rest.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-48-    const data = {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-49-      name: 'w',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:50:      globalVariables: { a: 1 },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-51-      layoutDirection: 'RIGHT',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-52-      nodes: [node('action.webhook', { url: 'u', somethingNew: 42, errors: [] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-53-      edges: [{ id: 'e' }],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-54-    };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-55-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-56-    const stripped = stripComputedErrors(data);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:57:    expect(stripped.globalVariables).toEqual({ a: 1 });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-58-    expect(stripped.layoutDirection).toBe('RIGHT');
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-59-    expect(stripped.edges).toEqual([{ id: 'e' }]);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-60-    expect(stripped.nodes[0]!.data.properties.somethingNew).toBe(42);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-61-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-62-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-63-  it('returns the same node objects when there is nothing to strip', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-64-    const clean = node('action.webhook', { url: 'u' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-65-    const data = { name: 'w', nodes: [clean] };
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-60-import { setSecretNames } from "./use-secrets-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-61-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-62-type Props = {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-63-  workflowId: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-64-  name: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-65-  initialNodes: IntegrationDataFormat["nodes"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-66-  initialEdges: IntegrationDataFormat["edges"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-67-  layoutDirection?: IntegrationDataFormat["layoutDirection"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:68:  initialGlobalVariables?: IntegrationDataFormat["globalVariables"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-69-  /**
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-70-   * A Server Action. It carries `requireAdmin` and the ownership check on its
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-71-   * own side — nothing here is authorization, and the browser's copy of the id
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-72-   * is not trusted by it.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-73-   *
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-74-   * It THROWS on failure rather than returning a falsy value. See the comment on
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-75-   * `handleSave`.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-76-   */
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-282-  // `fetchData()` copies the CURRENT one. Calling it during render would copy
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-283-  // the previous.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-284-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-285-  // Harmless on mount, where it re-takes a snapshot the Palette just took.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-286-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-287-    useStore.getState().fetchData();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-288-  }, [paletteItems]);
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-289-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:290:  // Root 2.3.0 omits globalVariables from its props. Its child effects load
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-291-  // nodes/edges first; this parent effect restores the remaining persisted field.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-292-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:293:    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-294-    resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-295-    resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-296-    return () => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-297-      resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-298-      resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-299-    };
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-300-  }, [workflowId, initialGlobalVariables]);
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-301-
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-643-    // so the action can tell a deliberate save from a background one and the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-644-    // snackbar stays off for the latter (the runtime already suppresses it).
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-645-    void params?.isAutoSave;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-646-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-647-    // The WHOLE payload, not a chosen four fields.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-648-    //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-649-    // This used to rebuild `{ name, layoutDirection, nodes, edges }` — the shape
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-650-    // the docs site documents for IntegrationDataFormat. The installed
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:651:    // `dist/index.d.ts` declares a fifth, `globalVariables: VariablesIndex`,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-652-    // which appears nowhere in their published docs. Cherry-picking therefore
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-653-    // silently erased the diagram's global variables on every save, including
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-654-    // every background auto-save.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-655-    //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-656-    // Passing `data` straight through also means the next field they add
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-657-    // survives instead of being dropped until someone notices. The column stores
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-658-    // the editor's format verbatim precisely so this can be a pass-through.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-659-    // ⚠️ MINUS THE EDITOR'S OWN VALIDATION STATE. `properties.errors` is written
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-120-        ? { ...n, data: { ...n.data, type: 'trigger.whatsapp_inbound' } }
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-121-        : n,
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-122-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-123-    syncArmBlockerMarkers('w', edges, 'wf-1');
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-124-    expect(setStoreNodes).not.toHaveBeenCalled();
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-125-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-126-
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-127-  it('a diagram the parser cannot read produces no markers, not a crash', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts:128:    // A shape `editorDiagramSchema` rejects outright — mid-drag, or from a
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-129-    // future version. `findArmBlockersByNode` returns [] rather than throwing,
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-130-    // so nothing is marked and nothing is written.
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-131-    store.nodes = [{ nonsense: true }];
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-132-    expect(() => syncArmBlockerMarkers('w', [], 'wf-1')).not.toThrow();
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-133-    expect(setStoreNodes).not.toHaveBeenCalled();
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-134-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-135-
src/app/(admin)/admin/workflows/[id]/arm-blocker-sync.test.ts-136-  it('⚠️ a node whose only faults are SCHEMA faults gets no marker', () => {
--
src/lib/workflow/inbound.ts-18-import { normalizePhone } from '@/lib/phone';
src/lib/workflow/inbound.ts-19-import { createAdminClient } from '@/lib/supabase/admin';
src/lib/workflow/inbound.ts-20-import { deriveGuestFirstName } from '@/lib/whatsapp/template-spec';
src/lib/workflow/inbound.ts-21-import type { WebhookInboxRow } from '@/lib/data/webhooks';
src/lib/workflow/inbound.ts-22-import { classifyMessagePayload } from '@/lib/whatsapp/inbound';
src/lib/workflow/inbound.ts-23-import type { InboundMessagePayload } from '@/lib/whatsapp/inbound';
src/lib/workflow/inbound.ts-24-
src/lib/workflow/inbound.ts-25-import { listArmedWorkflows, createRunIfNew } from './store';
src/lib/workflow/inbound.ts:26:import { editorDiagramSchema } from './adapter/editor-schema';
src/lib/workflow/inbound.ts-27-import { OWNER_WHATSAPP_MESSAGE_KINDS } from './catalogue/types';
src/lib/workflow/inbound.ts-28-import { type TriggerContext, matchesKind, planRuns } from './trigger';
src/lib/workflow/inbound.ts-29-
src/lib/workflow/inbound.ts-30-/**
src/lib/workflow/inbound.ts-31- * Create a run row for every armed workflow this message starts, and return the
src/lib/workflow/inbound.ts-32- * ids that were newly created.
src/lib/workflow/inbound.ts-33- *
src/lib/workflow/inbound.ts-34- * Nothing is enqueued here — the caller (the worker, which holds `boss`) does
--
src/lib/workflow/inbound.ts-135- * the receiving-number filters. This exists only so a message no workflow wants
src/lib/workflow/inbound.ts-136- * costs no database round-trip.
src/lib/workflow/inbound.ts-137- *
src/lib/workflow/inbound.ts-138- * A workflow whose definition will not parse, or whose trigger is not the
src/lib/workflow/inbound.ts-139- * inbound-WhatsApp one, is counted as NOT accepting — the same answer `planRuns`
src/lib/workflow/inbound.ts-140- * would reach, so the pre-filter can never hide a run the real matcher wanted.
src/lib/workflow/inbound.ts-141- */
src/lib/workflow/inbound.ts-142-function acceptsKind(workflow: { definition: unknown }, kind: string): boolean {
src/lib/workflow/inbound.ts:143:  const parsed = editorDiagramSchema.safeParse(workflow.definition);
src/lib/workflow/inbound.ts-144-  if (!parsed.success) return false;
src/lib/workflow/inbound.ts-145-  const trigger = parsed.data.nodes.find((n) => n.data.type === 'trigger.whatsapp_inbound');
src/lib/workflow/inbound.ts-146-  return trigger ? matchesKind(trigger.data.properties?.messageKinds, kind) : false;
src/lib/workflow/inbound.ts-147-}
src/lib/workflow/inbound.ts-148-
src/lib/workflow/inbound.ts-149-/** A guest speaking to us: an event AND a contact. */
src/lib/workflow/inbound.ts-150-async function resolveGuestSender(
src/lib/workflow/inbound.ts-151-  row: WebhookInboxRow,
--
src/lib/workflow/catalogue/references.test.ts-20-
src/lib/workflow/catalogue/references.test.ts-21-function edge(id: string, source: string, target: string) {
src/lib/workflow/catalogue/references.test.ts-22-  return { id, source, target, sourceHandle: null };
src/lib/workflow/catalogue/references.test.ts-23-}
src/lib/workflow/catalogue/references.test.ts-24-
src/lib/workflow/catalogue/references.test.ts-25-/** A trigger and a send that quotes `value`. */
src/lib/workflow/catalogue/references.test.ts-26-function quoting(
src/lib/workflow/catalogue/references.test.ts-27-  value: string,
src/lib/workflow/catalogue/references.test.ts:28:  opts: { globalVariables?: Record<string, unknown>; errorPolicy?: string } = {},
src/lib/workflow/catalogue/references.test.ts-29-) {
src/lib/workflow/catalogue/references.test.ts-30-  return {
src/lib/workflow/catalogue/references.test.ts-31-    name: 'בדיקה',
src/lib/workflow/catalogue/references.test.ts-32-    layoutDirection: 'DOWN',
src/lib/workflow/catalogue/references.test.ts:33:    ...(opts.globalVariables ? { globalVariables: opts.globalVariables } : {}),
src/lib/workflow/catalogue/references.test.ts-34-    nodes: [
src/lib/workflow/catalogue/references.test.ts-35-      node('t', 'trigger.whatsapp_inbound'),
src/lib/workflow/catalogue/references.test.ts-36-      node('say', 'action.send_whatsapp', {
src/lib/workflow/catalogue/references.test.ts-37-        body: value,
src/lib/workflow/catalogue/references.test.ts-38-        // 'continue' by default so a resolution result is what the assertion
src/lib/workflow/catalogue/references.test.ts-39-        // sees. The failure cases below ask for 'fail' explicitly — otherwise
src/lib/workflow/catalogue/references.test.ts-40-        // the policy absorbs the throw and the run reports completed, which is
src/lib/workflow/catalogue/references.test.ts-41-        // correct behaviour and useless as a test of the throw.
--
src/lib/workflow/catalogue/references.test.ts-45-    edges: [edge('e1', 't', 'say')],
src/lib/workflow/catalogue/references.test.ts-46-  };
src/lib/workflow/catalogue/references.test.ts-47-}
src/lib/workflow/catalogue/references.test.ts-48-
src/lib/workflow/catalogue/references.test.ts-49-/**
src/lib/workflow/catalogue/references.test.ts-50- * One entry of the editor's variables panel, in the shape it actually persists.
src/lib/workflow/catalogue/references.test.ts-51- *
src/lib/workflow/catalogue/references.test.ts-52- * Spelled out rather than abbreviated because the first version of this test
src/lib/workflow/catalogue/references.test.ts:53: * passed `{ name, value }` and the diagram failed to parse — `editorDiagramSchema`
src/lib/workflow/catalogue/references.test.ts-54- * requires all five fields, and the value an owner types lands in
src/lib/workflow/catalogue/references.test.ts-55- * `defaultValue`, not `value`.
src/lib/workflow/catalogue/references.test.ts-56- */
src/lib/workflow/catalogue/references.test.ts-57-function globalVar(id: string, name: string, defaultValue: string) {
src/lib/workflow/catalogue/references.test.ts-58-  return { [id]: { id, name, type: 'string', defaultValue, description: '' } };
src/lib/workflow/catalogue/references.test.ts-59-}
src/lib/workflow/catalogue/references.test.ts-60-
src/lib/workflow/catalogue/references.test.ts-61-function run(definition: unknown) {
--
src/lib/workflow/catalogue/references.test.ts-92-        }),
src/lib/workflow/catalogue/references.test.ts-93-      ],
src/lib/workflow/catalogue/references.test.ts-94-      edges: [edge('e1', 't', 'v'), edge('e2', 'v', 'say')],
src/lib/workflow/catalogue/references.test.ts-95-    });
src/lib/workflow/catalogue/references.test.ts-96-    expect(sentBody(result.effects)).toBe('קיבלנו ערך-מחושב');
src/lib/workflow/catalogue/references.test.ts-97-  });
src/lib/workflow/catalogue/references.test.ts-98-
src/lib/workflow/catalogue/references.test.ts-99-  it('global — the owner’s variables panel reaches the runner', async () => {
src/lib/workflow/catalogue/references.test.ts:100:    // The panel persists `globalVariables` keyed by an internal id; the adapter
src/lib/workflow/catalogue/references.test.ts-101-    // re-keys by NAME, because `{{global.<name>}}` is how a reference spells it
src/lib/workflow/catalogue/references.test.ts-102-    // and the panel's own id never appears in a template.
src/lib/workflow/catalogue/references.test.ts-103-    const result = await run(
src/lib/workflow/catalogue/references.test.ts-104-      quoting('נתראה ב{{global.venue}}', {
src/lib/workflow/catalogue/references.test.ts:105:        globalVariables: globalVar('var-1', 'venue', 'אולמי הגן'),
src/lib/workflow/catalogue/references.test.ts-106-      }),
src/lib/workflow/catalogue/references.test.ts-107-    );
src/lib/workflow/catalogue/references.test.ts-108-    expect(sentBody(result.effects)).toBe('נתראה באולמי הגן');
src/lib/workflow/catalogue/references.test.ts-109-  });
src/lib/workflow/catalogue/references.test.ts-110-
src/lib/workflow/catalogue/references.test.ts-111-  it('variables — the server-injected bag, which used to be empty', async () => {
src/lib/workflow/catalogue/references.test.ts-112-    // The finding that prompted this file: `variables` was hard-coded to `{}`,
src/lib/workflow/catalogue/references.test.ts-113-    // so the one namespace an owner CANNOT forge carried nothing.
--
src/lib/workflow/sdk-integration-invariants.test.ts-33-  it('mounts exactly one <WorkflowBuilder.Root>', () => {
src/lib/workflow/sdk-integration-invariants.test.ts-34-    // ⚠️ "Mount only one <WorkflowBuilder.Root> per page. Multi-instance is not
src/lib/workflow/sdk-integration-invariants.test.ts-35-    // supported: the plugin / decorator / JsonForms / i18n registries are
src/lib/workflow/sdk-integration-invariants.test.ts-36-    // module-level singletons shared across mounts" — and the imperative
src/lib/workflow/sdk-integration-invariants.test.ts-37-    // `useStore.{getState,setState,subscribe}` facade resolves through a
src/lib/workflow/sdk-integration-invariants.test.ts-38-    // module-level "current" pointer, so a second Root would not merely render
src/lib/workflow/sdk-integration-invariants.test.ts-39-    // twice: writes from one subtree would leak into the other.
src/lib/workflow/sdk-integration-invariants.test.ts-40-    //
src/lib/workflow/sdk-integration-invariants.test.ts:41:    // We call that facade directly (`useStore.setState({ globalVariables })`,
src/lib/workflow/sdk-integration-invariants.test.ts-42-    // `useStore.getState().fetchData()`), so the leak would be ours to debug.
src/lib/workflow/sdk-integration-invariants.test.ts-43-    // ⚠️ A MOUNT, NOT A MENTION. A plain `includes` counted three files on its
src/lib/workflow/sdk-integration-invariants.test.ts-44-    // first run — two of them JSDoc blocks explaining the prop contract. A guard
src/lib/workflow/sdk-integration-invariants.test.ts-45-    // that fails on its own documentation trains people to weaken it, so the
src/lib/workflow/sdk-integration-invariants.test.ts-46-    // match is anchored: the line, trimmed, must OPEN with the element. A
src/lib/workflow/sdk-integration-invariants.test.ts-47-    // comment line starts with `*` or `//`, a string with a quote.
src/lib/workflow/sdk-integration-invariants.test.ts-48-    const mounts = SOURCES.filter((f) =>
src/lib/workflow/sdk-integration-invariants.test.ts-49-      readFileSync(f, 'utf8')
--
src/lib/workflow/i18n-he.ts-222-    // Unreachable until the app bar was restored: the modal opens from
src/lib/workflow/i18n-he.ts-223-    // `ProjectSelection`'s kebab, and the previous hand-rolled toolbar had no
src/lib/workflow/i18n-he.ts-224-    // route to `openSettings` at all.
src/lib/workflow/i18n-he.ts-225-    modalTitle: 'הגדרות',
src/lib/workflow/i18n-he.ts-226-    modalDescription: 'ניהול מאפייני התהליך',
src/lib/workflow/i18n-he.ts-227-    tab: {
src/lib/workflow/i18n-he.ts-228-      general: 'כללי',
src/lib/workflow/i18n-he.ts-229-      generalDescription: 'הגדרות כלליות',
src/lib/workflow/i18n-he.ts:230:      globalVariables: 'משתנים גלובליים',
src/lib/workflow/i18n-he.ts:231:      globalVariablesDescription: 'ניהול משתנים לשימוש חוזר בתהליך',
src/lib/workflow/i18n-he.ts-232-      addVariable: 'הוספת משתנה',
src/lib/workflow/i18n-he.ts-233-      editVariable: 'עריכת משתנה',
src/lib/workflow/i18n-he.ts-234-      removeVariable: 'מחיקת משתנה',
src/lib/workflow/i18n-he.ts-235-      emptyVariablesList: 'לא הוגדרו משתנים.',
src/lib/workflow/i18n-he.ts-236-    },
src/lib/workflow/i18n-he.ts-237-  },
src/lib/workflow/i18n-he.ts-238-  validation: {
src/lib/workflow/i18n-he.ts-239-    // Surfaced by the import modal, which reached the UI for the first time
--
src/lib/workflow/catalogue/arm-check.ts:1:import { editorDiagramSchema } from '../adapter/editor-schema';
src/lib/workflow/catalogue/arm-check.ts-2-import { isKnownNodeType, isTriggerType } from './nodes';
src/lib/workflow/catalogue/arm-check.ts-3-import {
src/lib/workflow/catalogue/arm-check.ts-4-  activeConditionalRequirements,
src/lib/workflow/catalogue/arm-check.ts-5-  GUEST_SCOPED_NODE_TYPES,
src/lib/workflow/catalogue/arm-check.ts-6-  LEGACY_PROPERTY_ALIASES,
src/lib/workflow/catalogue/arm-check.ts-7-  NODE_STATUSES,
src/lib/workflow/catalogue/arm-check.ts-8-  NODE_NUMBER_RANGES,
src/lib/workflow/catalogue/arm-check.ts-9-  NODE_REQUIRED_FIELDS,
--
src/lib/workflow/catalogue/arm-check.ts-121-   * The workflow being armed.
src/lib/workflow/catalogue/arm-check.ts-122-   *
src/lib/workflow/catalogue/arm-check.ts-123-   * Optional so every existing caller compiles, but WITHOUT it the self-fan-out
src/lib/workflow/catalogue/arm-check.ts-124-   * check cannot run — a node pointing at its own workflow is only recognisable
src/lib/workflow/catalogue/arm-check.ts-125-   * against that id. `setWorkflowActive` always passes it.
src/lib/workflow/catalogue/arm-check.ts-126-   */
src/lib/workflow/catalogue/arm-check.ts-127-  workflowId?: string,
src/lib/workflow/catalogue/arm-check.ts-128-): ArmBlocker[] {
src/lib/workflow/catalogue/arm-check.ts:129:  const parsed = editorDiagramSchema.safeParse(storedDefinition);
src/lib/workflow/catalogue/arm-check.ts-130-  if (!parsed.success) return [];
src/lib/workflow/catalogue/arm-check.ts-131-
src/lib/workflow/catalogue/arm-check.ts-132-  const blockers: ArmBlocker[] = [];
src/lib/workflow/catalogue/arm-check.ts-133-
src/lib/workflow/catalogue/arm-check.ts-134-  // ⚠️ THE ONE CROSS-NODE QUESTION, ANSWERED ONCE FOR THE WHOLE GRAPH.
src/lib/workflow/catalogue/arm-check.ts-135-  //
src/lib/workflow/catalogue/arm-check.ts-136-  // Seven action types call `requireGuestContext` and throw without a contact.
src/lib/workflow/catalogue/arm-check.ts-137-  // Whether the run HAS one is decided by the trigger at the other end of the
--
src/lib/workflow/engine/dry-run.test.ts-192-      }),
src/lib/workflow/engine/dry-run.test.ts-193-    );
src/lib/workflow/engine/dry-run.test.ts-194-    personalised.edges.push({ id: 'e4', source: 'a', target: 'r', sourceHandle: 'source' });
src/lib/workflow/engine/dry-run.test.ts-195-
src/lib/workflow/engine/dry-run.test.ts-196-    const result = await dryRunWorkflow({
src/lib/workflow/engine/dry-run.test.ts-197-      workflowId: 'wf-1',
src/lib/workflow/engine/dry-run.test.ts-198-      storedDefinition: {
src/lib/workflow/engine/dry-run.test.ts-199-        ...personalised,
src/lib/workflow/engine/dry-run.test.ts:200:        globalVariables: {
src/lib/workflow/engine/dry-run.test.ts-201-          v1: {
src/lib/workflow/engine/dry-run.test.ts-202-            id: 'v1',
src/lib/workflow/engine/dry-run.test.ts-203-            name: 'eventName',
src/lib/workflow/engine/dry-run.test.ts-204-            type: 'string',
src/lib/workflow/engine/dry-run.test.ts-205-            defaultValue: 'החתונה של דנה ויוסי',
src/lib/workflow/engine/dry-run.test.ts-206-            description: '',
src/lib/workflow/engine/dry-run.test.ts-207-          },
src/lib/workflow/engine/dry-run.test.ts-208-        },
--
src/lib/workflow/schedule.ts-8-// ⚠️ EVERYTHING HERE IS IN ISRAEL TIME. "כל יום ב-09:00" means nine in the
src/lib/workflow/schedule.ts-9-// morning where the owner and the guests are, not where the server happens to
src/lib/workflow/schedule.ts-10-// run — and it has to keep meaning that across both DST transitions. The slot is
src/lib/workflow/schedule.ts-11-// therefore computed by FORMATTING the instant into Asia/Jerusalem rather than
src/lib/workflow/schedule.ts-12-// by arithmetic on a UTC offset, which is the one approach that does not drift
src/lib/workflow/schedule.ts-13-// twice a year.
src/lib/workflow/schedule.ts-14-import { ISRAEL_TIME_ZONE } from '@/lib/date';
src/lib/workflow/schedule.ts-15-
src/lib/workflow/schedule.ts:16:import { editorDiagramSchema } from './adapter/editor-schema';
src/lib/workflow/schedule.ts-17-import type { ArmedWorkflow, PlannedRun } from './trigger';
src/lib/workflow/schedule.ts-18-
src/lib/workflow/schedule.ts-19-/**
src/lib/workflow/schedule.ts-20- * `HH:MM`, 24-hour. The one shape a time may take in a schedule config.
src/lib/workflow/schedule.ts-21- *
src/lib/workflow/schedule.ts-22- * Deliberately not a cron string. A cron expression is a programmer's tool — it
src/lib/workflow/schedule.ts-23- * has five fields, two of which mean different things depending on each other —
src/lib/workflow/schedule.ts-24- * and an owner who mistypes one gets an automation that fires at a time nobody
--
src/lib/workflow/schedule.ts-115- * function per trigger source, each owning its own "which workflows does this
src/lib/workflow/schedule.ts-116- * event start" rule, so adding a third source never edits a second one.
src/lib/workflow/schedule.ts-117- */
src/lib/workflow/schedule.ts-118-export function planScheduledRuns(armed: readonly ArmedWorkflow[], now: Date): PlannedRun[] {
src/lib/workflow/schedule.ts-119-  const slot = israelSlot(now);
src/lib/workflow/schedule.ts-120-  const planned: PlannedRun[] = [];
src/lib/workflow/schedule.ts-121-
src/lib/workflow/schedule.ts-122-  for (const workflow of armed) {
src/lib/workflow/schedule.ts:123:    const parsed = editorDiagramSchema.safeParse(workflow.definition);
src/lib/workflow/schedule.ts-124-    if (!parsed.success) continue;
src/lib/workflow/schedule.ts-125-
src/lib/workflow/schedule.ts-126-    // The CATALOGUE decides what may start a flow, never the stored JSON —
src/lib/workflow/schedule.ts-127-    // rule 1, same as every other trigger path. An equality rather than "is a
src/lib/workflow/schedule.ts-128-    // trigger": a WhatsApp trigger must not be woken by a clock.
src/lib/workflow/schedule.ts-129-    const trigger = parsed.data.nodes.find((n) => n.data.type === 'trigger.schedule');
src/lib/workflow/schedule.ts-130-    if (!trigger) continue;
src/lib/workflow/schedule.ts-131-
--
src/lib/workflow/trigger.ts-1-// Which armed workflows an inbound WhatsApp message starts, and under what key.
src/lib/workflow/trigger.ts-2-//
src/lib/workflow/trigger.ts-3-// Pure: takes the message and the armed workflows, returns the runs to create.
src/lib/workflow/trigger.ts-4-// The drain performs the I/O. Written this way because the decision "does this
src/lib/workflow/trigger.ts-5-// message start this workflow?" is the one place a mistake is expensive in both
src/lib/workflow/trigger.ts-6-// directions — a missed run is an automation that silently does nothing, an
src/lib/workflow/trigger.ts-7-// extra run is a duplicate action on a guest — and it is worth being able to
src/lib/workflow/trigger.ts-8-// test exhaustively without a database.
src/lib/workflow/trigger.ts:9:import { editorDiagramSchema } from './adapter/editor-schema';
src/lib/workflow/trigger.ts-10-import { isTriggerType } from './catalogue/nodes';
src/lib/workflow/trigger.ts-11-import { DEFAULT_WHATSAPP_MESSAGE_KINDS } from './catalogue/types';
src/lib/workflow/trigger.ts-12-
src/lib/workflow/trigger.ts-13-export type ArmedWorkflow = {
src/lib/workflow/trigger.ts-14-  id: string;
src/lib/workflow/trigger.ts-15-  /** null = global; otherwise the workflow only runs for this event. */
src/lib/workflow/trigger.ts-16-  eventId: string | null;
src/lib/workflow/trigger.ts-17-  definition: unknown;
--
src/lib/workflow/trigger.ts-295- * stored JSON's. This reads `data.type` and asks `isTriggerType` — it does not
src/lib/workflow/trigger.ts-296- * look for a `role` or an `isStartNode` key, because a stored value would be
src/lib/workflow/trigger.ts-297- * discarded by the adapter moments later anyway, and reading one here would
src/lib/workflow/trigger.ts-298- * make THIS the place a crafted row could choose an entry point.
src/lib/workflow/trigger.ts-299- */
src/lib/workflow/trigger.ts-300-export function findTriggerNode(
src/lib/workflow/trigger.ts-301-  storedDefinition: unknown,
src/lib/workflow/trigger.ts-302-): { type: string; properties: Record<string, unknown> } | undefined {
src/lib/workflow/trigger.ts:303:  const parsed = editorDiagramSchema.safeParse(storedDefinition);
src/lib/workflow/trigger.ts-304-  if (!parsed.success) return undefined;
src/lib/workflow/trigger.ts-305-
src/lib/workflow/trigger.ts-306-  const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
src/lib/workflow/trigger.ts-307-  // Zero or several is a contract violation the adapter will report with a
src/lib/workflow/trigger.ts-308-  // named error when the run is attempted. Not starting a run on an ambiguous
src/lib/workflow/trigger.ts-309-  // graph is the conservative half of that; the owner still sees the error the
src/lib/workflow/trigger.ts-310-  // next time they open or save the workflow.
src/lib/workflow/trigger.ts-311-  if (triggers.length !== 1) return undefined;
--
src/lib/workflow/webhook-trigger.ts-1-import 'server-only';
src/lib/workflow/webhook-trigger.ts-2-
src/lib/workflow/webhook-trigger.ts-3-import { timingSafeEqual } from 'node:crypto';
src/lib/workflow/webhook-trigger.ts-4-
src/lib/workflow/webhook-trigger.ts:5:import { editorDiagramSchema } from './adapter/editor-schema';
src/lib/workflow/webhook-trigger.ts-6-import { isTriggerType } from './catalogue/nodes';
src/lib/workflow/webhook-trigger.ts-7-import { createRunIfNew, listArmedWorkflows } from './store';
src/lib/workflow/webhook-trigger.ts-8-
src/lib/workflow/webhook-trigger.ts-9-import type { WorkflowTriggerPayload } from './steps';
src/lib/workflow/webhook-trigger.ts-10-
src/lib/workflow/webhook-trigger.ts-11-// The inbound half of `trigger.webhook`: an external system POSTs, a run starts.
src/lib/workflow/webhook-trigger.ts-12-//
src/lib/workflow/webhook-trigger.ts-13-// THE DYNAMIC TRIGGER. Nothing here knows or cares what the caller sends — the
--
src/lib/workflow/webhook-trigger.ts-55- * and it reuses `findTriggerNode`'s own rule (the CATALOGUE decides what may
src/lib/workflow/webhook-trigger.ts-56- * start a flow, never the stored JSON) instead of writing a second, looser
src/lib/workflow/webhook-trigger.ts-57- * matcher in SQL.
src/lib/workflow/webhook-trigger.ts-58- */
src/lib/workflow/webhook-trigger.ts-59-async function findWorkflowForToken(token: string) {
src/lib/workflow/webhook-trigger.ts-60-  if (token.trim() === '') return null;
src/lib/workflow/webhook-trigger.ts-61-
src/lib/workflow/webhook-trigger.ts-62-  for (const workflow of await listArmedWorkflows()) {
src/lib/workflow/webhook-trigger.ts:63:    const parsed = editorDiagramSchema.safeParse(workflow.definition);
src/lib/workflow/webhook-trigger.ts-64-    if (!parsed.success) continue;
src/lib/workflow/webhook-trigger.ts-65-
src/lib/workflow/webhook-trigger.ts-66-    const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
src/lib/workflow/webhook-trigger.ts-67-    // Exactly one trigger, the same rule the adapter enforces. A diagram with
src/lib/workflow/webhook-trigger.ts-68-    // two is invalid and must not be reachable by either of its tokens.
src/lib/workflow/webhook-trigger.ts-69-    if (triggers.length !== 1) continue;
src/lib/workflow/webhook-trigger.ts-70-
src/lib/workflow/webhook-trigger.ts-71-    const trigger = triggers[0]!;
--
src/lib/workflow/adapter/to-definition.test.ts-270-    );
src/lib/workflow/adapter/to-definition.test.ts-271-
src/lib/workflow/adapter/to-definition.test.ts-272-    expect(codes(result)).toEqual([]);
src/lib/workflow/adapter/to-definition.test.ts-273-  });
src/lib/workflow/adapter/to-definition.test.ts-274-
src/lib/workflow/adapter/to-definition.test.ts-275-  it('carries the variables panel through as ExecutionContext.global', () => {
src/lib/workflow/adapter/to-definition.test.ts-276-    const withVariables = {
src/lib/workflow/adapter/to-definition.test.ts-277-      ...diagram([node('t', TRIGGER), node('a', ACTION, { status: 'attending' })], [edge('t', 'a')]),
src/lib/workflow/adapter/to-definition.test.ts:278:      globalVariables: {
src/lib/workflow/adapter/to-definition.test.ts-279-        'var-1': {
src/lib/workflow/adapter/to-definition.test.ts-280-          id: 'var-1',
src/lib/workflow/adapter/to-definition.test.ts-281-          name: 'eventName',
src/lib/workflow/adapter/to-definition.test.ts-282-          type: 'string',
src/lib/workflow/adapter/to-definition.test.ts-283-          defaultValue: 'החתונה של דנה ויוסי',
src/lib/workflow/adapter/to-definition.test.ts-284-          description: '',
src/lib/workflow/adapter/to-definition.test.ts-285-        },
src/lib/workflow/adapter/to-definition.test.ts-286-        // Nameless: unreachable by any reference, so it must not reach the map.
--
src/lib/workflow/adapter/to-definition.ts-34-  ACTION_BRANCH_HANDLES,
src/lib/workflow/adapter/to-definition.ts-35-  ERROR_POLICIES,
src/lib/workflow/adapter/to-definition.ts-36-  NODE_STATUSES,
```

## 5. RunWatchButton placement
```text
4-
5-import { Badge, formatDateTime } from "../../_components";
6-
7-import { editorDiagramSchema } from "@/lib/workflow/adapter/editor-schema";
8-import { getWorkflow, listWorkflowRuns } from "@/lib/data/admin/workflows";
9-import { listProviderNumbers } from "@/lib/data/admin/integrations/provider-numbers";
10-
11-import { saveWorkflowAction } from "../actions";
12-
13-import { CancelRunButton } from "../row-actions";
14-
15-import { RunNowPanel } from "./run-now-panel";
16:import { RunWatchButton } from "./run-watcher";
17-import { TestPanel } from "./test-panel";
18-import { listSecretNames } from "@/lib/workflow/secrets";
19-
20-import { listDialableVoicePurposes } from "@/lib/data/voice-purposes";
21-
22-import { WorkflowEditor } from "./workflow-editor";
23-
24-export const metadata: Metadata = { title: "עריכת תהליך" };
25-
26-/**
27- * Run states, in the product's own language.
28- *
--
207-                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
208-                      </dd>
209-                    </div>
210-                  </dl>
211-                  {/* Only when there IS one — an empty "שגיאה:" label on every
212-                      successful run is noise on the screen with the least room. */}
213-                  {run.errorMessage ? (
214-                    <p className="text-sm text-destructive">
215-                      {run.errorMessage}
216-                    </p>
217-                  ) : null}
218-                  <div className="flex flex-wrap items-start gap-2">
219:                    <RunWatchButton runId={run.id} />
220-                    {(run.status === "pending" || run.status === "waiting") && (
221-                      <CancelRunButton
222-                        workflowId={workflow.id}
223-                        runId={run.id}
224-                      />
225-                    )}
226-                  </div>
227-                </li>
228-              ))}
229-            </ul>
230-
231-            <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
--
247-                        {RUN_STATUS_HE[run.status] ?? run.status}
248-                      </td>
249-                      <td className="p-3">{run.triggerSource}</td>
250-                      <td className="p-3">{formatDateTime(run.createdAt)}</td>
251-                      <td className="p-3">
252-                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
253-                      </td>
254-                      <td className="p-3 text-destructive">
255-                        {run.errorMessage ?? ""}
256-                      </td>
257-                      <td className="p-3">
258-                        <div className="flex flex-wrap items-start gap-2">
259:                          <RunWatchButton runId={run.id} />
260-                          {/* Queued OR PARKED. `cancelRun` refuses anything else,
261-                              because the vendored runner cannot be interrupted
262-                              once it is inside runGraph — which is exactly why a
263-                              parked run CAN be cancelled: it is not inside it. It
264-                              is a row with a deadline and a job that has not
265-                              fired, and `logic.wait` allows up to a year of that. */}
266-                          {(run.status === "pending" ||
267-                            run.status === "waiting") && (
268-                            <CancelRunButton
269-                              workflowId={workflow.id}
270-                              runId={run.id}
271-                            />
```
