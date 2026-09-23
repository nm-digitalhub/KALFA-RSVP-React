# §9 — normalizer focus

## File location
```text
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts
```

## Definition + surrounding code
```text
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-79-/**
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-80- * Bare strings become `{ value }`; anything already an object is left alone.
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-81- *
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-82- * Returns the SAME array reference when nothing changed, so a diagram with no
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-83- * legacy values produces no new objects and the caller's identity checks hold.
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-84- */
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-85-function normalizeEntries(value: unknown): unknown {
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-86-  if (!Array.isArray(value)) return value;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-87-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-88-  let changed = false;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-89-  const next = value.map((entry) => {
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-90-    if (typeof entry !== "string") return entry;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-91-    changed = true;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-92-    return { value: entry };
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-93-  });
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-94-  return changed ? next : value;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-95-}
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-96-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-97-/**
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-98- * Repair every node's legacy array values against the palette it will render in.
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-99- *
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-100- * A node whose type is not in the palette is returned untouched — an unknown
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-101- * type is the converter's error to report, and guessing at its shape here would
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-102- * be this function inventing a schema.
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-103- */
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts:104:export function normalizeLegacyProperties<T extends { data?: { type?: unknown; properties?: unknown } }>(
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-105-  nodes: readonly T[],
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-106-  paletteItems: readonly PaletteItem[],
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-107-): T[] {
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-108-  const arrayFieldsByType = new Map<string, string[]>();
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-109-  const numberFieldsByType = new Map<string, string[]>();
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-110-  for (const item of paletteItems) {
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-111-    arrayFieldsByType.set(item.type, objectArrayFields(item));
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-112-    numberFieldsByType.set(item.type, numberFields(item));
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-113-  }
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-114-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-115-  return nodes.map((node) => {
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-116-    const type = String(node.data?.type ?? "");
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-117-    const arrayFields = arrayFieldsByType.get(type) ?? [];
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-118-    const numFields = numberFieldsByType.get(type) ?? [];
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-119-    if (arrayFields.length === 0 && numFields.length === 0) return node;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-120-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-121-    const properties = node.data?.properties as Properties | undefined;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-122-    if (!properties) return node;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-123-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-124-    let changed = false;
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-125-    const next: Properties = { ...properties };
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-126-
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-127-    for (const [fields, normalize] of [
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-128-      [arrayFields, normalizeEntries],
src/app/(admin)/admin/workflows/[id]/normalize-legacy-properties.ts-129-      [numFields, normalizeNumber],
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-22-  useTransition,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-23-} from "react";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-24-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-25-import "@workflowbuilder/sdk/style.css";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-26-// Immediately after, so its unlayered counters land on top of the SDK's reset.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-27-import "./sdk-overrides.css";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-28-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-29-import { Button } from "@/components/ui/button";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-30-import { isTriggerType } from "@/lib/workflow/catalogue/nodes";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-31-import {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-32-  buildPaletteItems,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-33-  type VoiceDialOption,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-34-  type VoicePurposeOption,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-35-  type WhatsAppNumberOption,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-36-} from "@/lib/workflow/catalogue/schemas";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-37-import { DIAGRAM_TEMPLATES } from "@/lib/workflow/catalogue/templates";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-38-import { applyHebrewToSdk } from "@/lib/workflow/i18n-he";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-39-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-40-import { loadVoiceDialListsAction } from "../actions";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-41-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-42-import { appBarPlugin } from "./app-bar";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-43-import {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-44-  stripComputedErrors,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-45-  syncArmBlockerMarkers,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-46-} from "./arm-blocker-markers";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:47:import { normalizeLegacyProperties } from "./normalize-legacy-properties";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-48-import { checkboxListRenderer } from "./checkbox-list-control";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-49-import { headerRowsRenderer } from "./header-rows-control";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-50-import { ExecutionHighlighting } from "./highlighting";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-51-import { ExecutionLogPanel } from "./log-panel";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-52-import { executionMarkersPlugin } from "./node-markers";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-53-import { resetExecution } from "./use-execution-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-54-import {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-55-  resetPanels,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-56-  setEditorCompact,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-57-  setPropertiesOpen,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-58-  usePanelsStore,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-59-} from "./use-panels-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-60-import { setSecretNames } from "./use-secrets-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-61-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-62-type Props = {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-63-  workflowId: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-64-  name: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-65-  initialNodes: IntegrationDataFormat["nodes"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-66-  initialEdges: IntegrationDataFormat["edges"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-67-  layoutDirection?: IntegrationDataFormat["layoutDirection"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-68-  initialGlobalVariables?: IntegrationDataFormat["globalVariables"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-69-  /**
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-70-   * A Server Action. It carries `requireAdmin` and the ownership check on its
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-71-   * own side — nothing here is authorization, and the browser's copy of the id
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-72-   * is not trusted by it.
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-232-    [
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-233-      whatsappNumbers,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-234-      voicePurposes,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-235-      voiceCallerIds,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-236-      dialLists.rules,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-237-      dialLists.agents,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-238-    ],
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-239-  );
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-240-  // ⚠️ REPAIR LEGACY ARRAY SHAPES BEFORE THE SCHEMA SEES THEM.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-241-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-242-  // An ARMED workflow is stored with `messageKinds: ['text', 'button']` — bare
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-243-  // strings, from before the control persisted objects — and the schema declares
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-244-  // `items: { type: 'object' }`. So the editor marked a workflow INVALID that
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-245-  // runs exactly as intended, because `matchesKind` accepts both shapes and the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-246-  // schema does not. `ArrayFieldSchema` cannot express "object or string", so
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-247-  // the shapes have to converge on the one the control writes.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-248-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-249-  // Done here rather than as a migration: nothing is written on the owner's
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-250-  // behalf to a workflow that is armed and firing. The false marker is gone when
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-251-  // they open the diagram, and the row converges the next time they save.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-252-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-253-  // `initialNodes` is only read by `<Root>` on first mount, so memoising on the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-254-  // palette is enough — and the palette's live lists never change which fields
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-255-  // are arrays.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-256-  const normalizedInitialNodes = useMemo(
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:257:    () => normalizeLegacyProperties(initialNodes, paletteItems),
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-258-    [initialNodes, paletteItems],
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-259-  );
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-260-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-261-  // ⚠️ RE-SNAPSHOT THE PALETTE, or the live lists never reach the form.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-262-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-263-  // MEASURED IN THE 2.3.0 BUNDLE, not assumed — and the assumption it replaces
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-264-  // was wrong. Passing a new `nodeTypes` array is NOT enough on its own:
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-265-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-266-  //   • `<Root>` calls `kM(nodeTypes)` on every render, which writes a
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-267-  //     MODULE-LEVEL variable (`x1`). That part does update.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-268-  //   • But the properties panel does not read that variable. It reads
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-269-  //     `getNodeDefinition(type)` off the Zustand store, and that reads
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-270-  //     `store.data` — a SNAPSHOT copied from the module variable by
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-271-  //     `fetchData()`.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-272-  //   • `fetchData()` is called in exactly one place: the Palette sidebar's own
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-273-  //     `useEffect(() => { fetchData() }, [fetchData])`. `fetchData` is a stable
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-274-  //     store reference, so that effect runs ONCE, on mount.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-275-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-276-  // So without this, the agent and rule dropdowns would stay empty forever: the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-277-  // definition the panel renders was frozen before the vendors answered.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-278-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-279-  // ⚠️ AND THE ORDER IS THE REASON THIS IS AN EFFECT. React renders the child
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-280-  // before running the parent's effects, so by the time this runs, `<Root>`'s
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-281-  // render has already written the new palette into the module variable and
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-282-  // `fetchData()` copies the CURRENT one. Calling it during render would copy
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-1-// The two pure halves of the editor's arm-blocker markers.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-2-//
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-3-// `syncArmBlockerMarkers` itself talks to the SDK store and is exercised through
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-4-// the editor; what is testable — and what carries the risk — is the save-time
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-5-// strip and the legacy-shape repair. Both are pure, both fix a MEASURED defect
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-6-// in stored data, and both would be silent if they regressed.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-7-import { Validator } from '@cfworker/json-schema';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-8-import { describe, expect, it } from 'vitest';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-9-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-10-import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-11-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-12-import { stripComputedErrors } from './arm-blocker-markers';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:13:import { normalizeLegacyProperties } from './normalize-legacy-properties';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-14-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-15-const node = (type: string, properties: Record<string, unknown>) => ({
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-16-  id: 'n1',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-17-  position: { x: 0, y: 0 },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-18-  data: { type, properties },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-19-});
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-20-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-21-describe('stripComputedErrors', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-22-  it('⚠️ removes the validation state the save path has been persisting', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-23-    // Measured 2026-09-15: 8 of 22 stored nodes carry `properties.errors`,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-24-    // because `makeSaveHandler` passes the payload through verbatim.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-25-    const data = {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-26-      name: 'w',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-27-      nodes: [
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-28-        node('action.webhook', {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-29-          url: 'https://example.com',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-30-          errors: [{ keyword: 'required', message: 'stale' }],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-31-          customErrors: [{ message: 'also stale' }],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-32-        }),
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-33-      ],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-34-    };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-35-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-36-    const stripped = stripComputedErrors(data);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-37-    const properties = stripped.nodes[0]!.data.properties;
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-38-
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-54-    };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-55-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-56-    const stripped = stripComputedErrors(data);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-57-    expect(stripped.globalVariables).toEqual({ a: 1 });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-58-    expect(stripped.layoutDirection).toBe('RIGHT');
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-59-    expect(stripped.edges).toEqual([{ id: 'e' }]);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-60-    expect(stripped.nodes[0]!.data.properties.somethingNew).toBe(42);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-61-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-62-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-63-  it('returns the same node objects when there is nothing to strip', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-64-    const clean = node('action.webhook', { url: 'u' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-65-    const data = { name: 'w', nodes: [clean] };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-66-    expect(stripComputedErrors(data).nodes[0]).toBe(clean);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-67-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-68-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-69-  it('tolerates a payload with no nodes at all', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-70-    // A diagram mid-load, and the shape `IntegrationDataFormat` allows.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-71-    const empty: { name: string; nodes?: unknown } = { name: 'w' };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-72-    expect(stripComputedErrors(empty)).toEqual({ name: 'w' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-73-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-74-    const undefinedNodes: { name: string; nodes?: unknown } = { name: 'w', nodes: undefined };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-75-    expect(stripComputedErrors(undefinedNodes)).toEqual({ name: 'w', nodes: undefined });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-76-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-77-});
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-78-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:79:describe('normalizeLegacyProperties', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-80-  it('⚠️ repairs the exact shape stored on the live ARMED workflow', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-81-    // "קליטת רשימת אורחים מוואטסאפ", is_active = true, stored with bare strings.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-82-    // Its stored `errors` reads: Instance type "string" is invalid. Expected
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-83-    // "object" — an armed workflow marked invalid while running correctly,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-84-    // because `matchesKind` accepts both shapes and the schema does not.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:85:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-86-      [node('trigger.whatsapp_inbound', { label: 't', messageKinds: ['text', 'button'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-87-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-88-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-89-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-90-    expect(repaired!.data.properties.messageKinds).toEqual([
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-91-      { value: 'text' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-92-      { value: 'button' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-93-    ]);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-94-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-95-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-96-  it('⚠️ the repaired value passes the schema the editor validates against', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-97-    // The whole point, asserted against the real schema rather than by eye.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-98-    const schema = PALETTE_ITEMS.find((i) => i.type === 'trigger.whatsapp_inbound')!.schema;
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-99-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-100-    const before = { label: 'ט', description: 'ת', messageKinds: ['text'] };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-101-    expect(new Validator(schema as object).validate(before).valid).toBe(false);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-102-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:103:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-104-      [node('trigger.whatsapp_inbound', before)],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-105-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-106-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-107-    expect(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-108-      new Validator(schema as object).validate(repaired!.data.properties).valid,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-109-    ).toBe(true);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-110-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-111-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-112-  it('leaves the current object shape untouched, by reference', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-113-    const current = node('trigger.whatsapp_inbound', {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-114-      messageKinds: [{ value: 'text' }],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-115-    });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:116:    expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-117-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-118-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-119-  it('repairs a mixed array without disturbing the objects in it', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:120:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-121-      [node('trigger.whatsapp_inbound', { messageKinds: [{ value: 'text' }, 'button'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-122-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-123-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-124-    expect(repaired!.data.properties.messageKinds).toEqual([
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-125-      { value: 'text' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-126-      { value: 'button' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-127-    ]);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-128-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-129-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-130-  it('covers every array-of-objects field, not a hardcoded list', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-131-    // `days` on the schedule trigger is the second one, and it was never named
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-132-    // in this module — the fields come from each node type's own schema.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:133:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-134-      [node('trigger.schedule', { time: '09:00', days: ['sunday', 'monday'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-135-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-136-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-137-    expect(repaired!.data.properties.days).toEqual([
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-138-      { value: 'sunday' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-139-      { value: 'monday' },
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-140-    ]);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-141-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-142-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-143-  it('⚠️ a numeric STRING becomes a number — the second schema-stricter case', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-144-    // `maxGuests: '25'` runs correctly: the handler reads `Number(rawMax)` and
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-145-    // `findArmBlockers` coerces the same way. Only the schema objects, because
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-146-    // it declares `type: 'number'`. A working node wearing an error badge.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:147:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-148-      [node('action.start_for_each_guest', { maxGuests: '25' })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-149-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-150-    );
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-151-    expect(repaired!.data.properties.maxGuests).toBe(25);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-152-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-153-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-154-  it('⚠️ the repaired number passes the schema, and the string did not', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-155-    const schema = PALETTE_ITEMS.find((i) => i.type === 'action.start_for_each_guest')!.schema;
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-156-    const check = (v: unknown) =>
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-157-      new Validator(schema as object).validate({
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-158-        label: 'לכל אורח',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-159-        description: 'ת',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-160-        targetWorkflowId: 'wf-child',
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-161-        maxGuests: v,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-162-      }).valid;
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-163-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-164-    expect(check('25')).toBe(false);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-165-    expect(check(25)).toBe(true);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-166-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-167-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-168-  it('leaves a blank string alone — the required check is what should speak', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-169-    const blank = node('action.start_for_each_guest', { maxGuests: '' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:170:    expect(normalizeLegacyProperties([blank], PALETTE_ITEMS)[0]).toBe(blank);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-171-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-172-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-173-  it('leaves a string that is not entirely a number — reading 25 out of it would invent intent', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-174-    const messy = node('action.start_for_each_guest', { maxGuests: '25 guests' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:175:    expect(normalizeLegacyProperties([messy], PALETTE_ITEMS)[0]).toBe(messy);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-176-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-177-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-178-  it('leaves a value that is already a number, by reference', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-179-    const fine = node('action.start_for_each_guest', { maxGuests: 25 });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:180:    expect(normalizeLegacyProperties([fine], PALETTE_ITEMS)[0]).toBe(fine);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-181-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-182-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-183-  it('leaves a node type the palette does not know', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-184-    const unknown = node('action.from_the_future', { messageKinds: ['text'] });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:185:    expect(normalizeLegacyProperties([unknown], PALETTE_ITEMS)[0]).toBe(unknown);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-186-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-187-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-188-  it('leaves a non-array value alone rather than guessing at it', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-189-    const odd = node('trigger.whatsapp_inbound', { messageKinds: 'text' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:190:    expect(normalizeLegacyProperties([odd], PALETTE_ITEMS)[0]).toBe(odd);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-191-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-192-});
```

## Call sites
```text
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-249-  // Done here rather than as a migration: nothing is written on the owner's
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-250-  // behalf to a workflow that is armed and firing. The false marker is gone when
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-251-  // they open the diagram, and the row converges the next time they save.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-252-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-253-  // `initialNodes` is only read by `<Root>` on first mount, so memoising on the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-254-  // palette is enough — and the palette's live lists never change which fields
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-255-  // are arrays.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-256-  const normalizedInitialNodes = useMemo(
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:257:    () => normalizeLegacyProperties(initialNodes, paletteItems),
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-258-    [initialNodes, paletteItems],
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-259-  );
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-260-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-261-  // ⚠️ RE-SNAPSHOT THE PALETTE, or the live lists never reach the form.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-262-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-263-  // MEASURED IN THE 2.3.0 BUNDLE, not assumed — and the assumption it replaces
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-264-  // was wrong. Passing a new `nodeTypes` array is NOT enough on its own:
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-265-  //
```

## Legacy alias exact block
```text
   * their visuals), but the adapter keeps asking `isTriggerType`.
   */
  isTrigger: boolean;
};

/**
 * Property keys that were RENAMED, and the older key still found in saved diagrams.
 *
 * ⚠️ WHY THIS EXISTS AS DATA RATHER THAN AN `if` INSIDE ONE HANDLER. `rsvpStatus`
 * was called `status` until the SDK claimed `status` for the node's own lifecycle
 * (Active / Draft / Disabled) in the same properties object. Every diagram saved
 * before that carries the old key and must keep working untouched.
 *
 * The handler honoured that from the start. The ARM CHECK did not, and the first
 * time it ran against the real database it refused to arm a stored workflow that
 * runs perfectly — a rule stricter than the code it was meant to describe.
 *
 * Both read this map now, so "which old names still count" is answered once.
 */
export const LEGACY_PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  rsvpStatus: 'status',
};

/**
 * Which properties each node type cannot run without.
 *
 * ⚠️ THIS LIVES HERE, NOT IN `schemas.ts`, AND THE REASON IS A PRODUCTION OUTAGE.
 *
 * `schemas.ts` imports runtime values from `@workflowbuilder/sdk` and is reached
 * from a `'use client'` editor, so Next puts it in the CLIENT module graph. A
 * server module that imports it does NOT get the values — it gets a client
 * reference stub, and `PALETTE_ITEMS.find` is then a function that throws.
 * Measured on 2026-09-14 in `.next/server/chunks`:
```

## Adapter lifecycle reader
```text
// with the offending token in the message.
//
// What is deliberately NOT re-added here: a save-time check that every
// reference resolves. It cannot be done honestly — `{{trigger.message_text}}`
// is valid and unresolvable at save time, because no message has arrived yet.

/**
 * The node's Active / Draft / Disabled switch.
 *
 * Anything unrecognised is treated as ABSENT, not as an error. That matters for
 * one concrete case: `action.update_guest_status` used to spell the guest's RSVP
 * value under this same key, so a diagram saved before the rename carries
 * `status: 'attending'` here. Rejecting it would break those diagrams; reading it
 * as a lifecycle value would silently disable a live node. Falling back to
 * `active` does neither.
 */
function readNodeStatus(value: unknown): NodeStatus | undefined {
  return typeof value === 'string' && (NODE_STATUSES as readonly string[]).includes(value)
    ? (value as NodeStatus)
    : undefined;
}

function readErrorPolicy(value: unknown): ErrorPolicy | undefined {
  return typeof value === 'string' && (ERROR_POLICIES as readonly string[]).includes(value)
    ? (value as ErrorPolicy)
    : undefined;
}


// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a stored editor diagram into a `WorkflowDefinition` the vendored
 * runner can execute, or into a list of named errors. Never throws on bad data:
 * a malformed diagram is a result, not an exception, because the caller is
 * usually rendering it back to the owner.
 */
export function toWorkflowDefinition(
  workflowId: string,
```

## Handler legacy reader
```text
// action.update_guest_status
// ---------------------------------------------------------------------------

// The first real side effect, and deliberately one that sends nothing outward:
// it changes a row we own. `send_whatsapp` is the next node, once this chain is
// proven end to end.
const updateGuestStatus: StepHandler = async (config, ctx) => {
  // `rsvpStatus` first, `status` second. The key was renamed when the SDK's own
  // node-lifecycle `status` — Active / Draft / Disabled — moved into the same
  // properties object; every diagram saved before that carries the old name and
  // has to keep working untouched.
  const status: RsvpStatus = readEnum(
    'rsvpStatus' in config
      ? config
      : { ...config, rsvpStatus: config[LEGACY_PROPERTY_ALIASES.rsvpStatus!] },
    'rsvpStatus',
    RSVP_STATUSES,
    'action.update_guest_status',
  );

  const { eventId, contactId } = requireGuestContext(ctx, 'action.update_guest_status');
  const guests = await ctx.deps.guests.getGuestsForContact(eventId, contactId);

  // ריבוי-אורחים: a phone may back several guests, and "who did this message
  // mean?" has no answer. The inbound webhook refuses to guess (C9 in
  // webhook-processing.ts) and so does this: the same rule, because it is a rule
  // about shared phones, not about which code path arrived at it. Reported as a
```
