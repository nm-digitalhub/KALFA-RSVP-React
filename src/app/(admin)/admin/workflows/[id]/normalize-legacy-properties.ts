import type { PaletteItem } from "@workflowbuilder/sdk";

import { RSVP_STATUSES } from "@/lib/constants";
import * as microsoftSendEmailDefinition from "@/lib/workflow/nodes/action-microsoft-send-email/definition";

// A stored value in a shape the schema no longer accepts, repaired on the way in.
//
// ⚠️ THE LIVE CASE, MEASURED 2026-09-15. The ARMED workflow
// "קליטת רשימת אורחים מוואטסאפ" carries `messageKinds: ['text', 'button']` —
// bare strings, the shape the control persisted before it stored objects. Its
// stored `properties.errors` reads:
//
//     Instance type "string" is invalid. Expected "object".  /messageKinds/0
//
// So the editor marks an armed workflow permanently invalid. And the mark is
// WRONG in the only sense that matters: `matchesKind` accepts both shapes, so
// the workflow runs exactly as its owner intended. The schema is stricter than
// the engine — the one mistake `arm-check.ts` warns about on nearly every rule.
//
// ⚠️ WHY NOT WIDEN THE SCHEMA INSTEAD. `ArrayFieldSchema` is
// `{ type:'array', items:{ type:'object', properties } }` — it cannot describe
// "an object OR a string", so there is no union to declare. The shapes have to
// converge, and the object shape is the one the control writes.
//
// ⚠️ AND WHY AT LOAD RATHER THAN AS A MIGRATION. A migration would rewrite rows
// under a workflow that is armed and firing. This repairs the copy the editor
// holds, so the false marker is gone the moment the owner opens the diagram and
// the row converges the next time they save. Nothing is written on their behalf.
//
// Driven by the PALETTE SCHEMA rather than by a list of field names: any
// array-of-objects property gets the same treatment, so the next checkbox field
// is covered without anyone remembering to add it here.

type Properties = Record<string, unknown>;

/** The property names a node type declares as an array of objects. */
function objectArrayFields(item: PaletteItem): string[] {
  const properties =
    (item.schema as { properties?: Record<string, unknown> }).properties ?? {};

  return Object.entries(properties)
    .filter(([, declared]) => {
      const field = declared as { type?: unknown; items?: { type?: unknown } };
      return field?.type === "array" && field.items?.type === "object";
    })
    .map(([name]) => name);
}

/** The property names a node type declares as a number. */
function numberFields(item: PaletteItem): string[] {
  const properties =
    (item.schema as { properties?: Record<string, unknown> }).properties ?? {};

  return Object.entries(properties)
    .filter(([, declared]) => (declared as { type?: unknown })?.type === "number")
    .map(([name]) => name);
}

/**
 * A numeric STRING becomes a number; everything else is left exactly as it is.
 *
 * ⚠️ THE SECOND CASE OF "THE SCHEMA IS STRICTER THAN THE ENGINE", and the same
 * repair as the array one above. `maxGuests: '25'` runs correctly — the handler
 * reads it as `Number(rawMax)` (`steps/index.ts`) and `findArmBlockers` coerces
 * the same way — while the schema declares `type: 'number'` and marks the node
 * invalid. A node that works, wearing an error badge.
 *
 * ⚠️ AND IT IS DELIBERATELY NARROW. Only a string that is ENTIRELY a finite
 * number converts. `''` stays `''` (it is an empty field, and the required
 * check is what should speak), `'25 guests'` stays a string (it is a mistake,
 * and silently reading 25 out of it would be this function inventing intent),
 * and a value that is already a number is returned untouched.
 */
function normalizeNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return value;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

/**
 * Bare strings become `{ value }`; anything already an object is left alone.
 *
 * Returns the SAME array reference when nothing changed, so a diagram with no
 * legacy values produces no new objects and the caller's identity checks hold.
 */
function normalizeEntries(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next = value.map((entry) => {
    if (typeof entry !== "string") return entry;
    changed = true;
    return { value: entry };
  });
  return changed ? next : value;
}

/**
 * Fill in the Microsoft mail options a diagram saved before they existed.
 *
 * ⚠️ THE ONLY BRANCH IN THIS FILE KEYED ON A NODE TYPE, AND THAT IS DELIBERATE.
 * Everything else here is derived from the palette schema, precisely so the next
 * field of a known KIND is covered without anyone editing this file. This one
 * cannot be, and the reason is worth stating rather than inferring.
 *
 * WHAT THE SDK DOES NOT DO, measured in 2.3.0 rather than assumed:
 *
 *   • `default` is not part of `FieldSchema` — the schema cannot declare one.
 *   • `defaultPropertiesData` appears ONCE in the shipped bundle, inside the
 *     node-creation path (`reactFlowInstance` / `onNodesChange`). It runs when a
 *     node is dropped from the palette, never when a diagram is loaded.
 *   • There is no migration or load-time transform hook: `migrat`, `upgrade`,
 *     `coerce` and `useDefaults` appear zero times in `index.d.ts`.
 *
 * So a node saved before these fields existed keeps its old shape forever, and
 * the editor and the runtime then disagree about it. Measured in the bundle:
 * the Switch renderer is `checked: data ?? false` and the Select renderer is
 * `value: data ?? null`, while the handler
 * (`nodes/action-microsoft-send-email/runtime.ts`) reads
 * `typeof config.saveToSentItems === 'boolean' ? … : true`. The panel therefore
 * shows "off" for a message the runtime does save — the UI stating the opposite
 * of what happens.
 *
 * ⚠️ DO NOT GENERALISE THIS TO "FILL EVERY MISSING PROPERTY FROM ITS DEFAULT".
 * Live data was checked before this was written: `action.update_guest_status`
 * is missing `rsvpStatus` on two stored nodes. A default there would invent an
 * RSVP decision the owner never made and write it to a real guest's flow — and
 * it would reach the row on its own, because the SDK auto-saves on
 * `beforeunload` with no condition. `normalize-legacy-properties.test.ts` pins
 * that case so a future tidy-up cannot quietly widen this.
 *
 * These three are safe for exactly one reason: each value equals what the
 * handler already sends when the field is absent, so backfilling changes what
 * the panel SHOWS and never what the run DOES.
 */
function microsoftMailBackfill(properties: Properties): Properties | undefined {
  const next: Properties = {};
  if (typeof properties.contentType !== "string") next.contentType = "Text";
  if (typeof properties.importance !== "string") next.importance = "normal";
  if (typeof properties.saveToSentItems !== "boolean") next.saveToSentItems = true;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Repair legacy property shapes as a workflow enters the editor.
 *
 * Array-of-object and numeric fields are discovered from the palette schema;
 * the pre-lifecycle RSVP `status` collision is a targeted compatibility repair
 * because `status` is now owned by the SDK node lifecycle.
 *
 * A node whose type is not in the palette is returned untouched — an unknown
 * type is the converter's error to report, and guessing at its shape here would
 * be this function inventing a schema.
 */
export function normalizeLegacyProperties<T extends { data?: { type?: unknown; properties?: unknown } }>(
  nodes: readonly T[],
  paletteItems: readonly PaletteItem[],
): T[] {
  const arrayFieldsByType = new Map<string, string[]>();
  const numberFieldsByType = new Map<string, string[]>();
  for (const item of paletteItems) {
    arrayFieldsByType.set(item.type, objectArrayFields(item));
    numberFieldsByType.set(item.type, numberFields(item));
  }

  return nodes.map((node) => {
    const type = String(node.data?.type ?? "");
    const arrayFields = arrayFieldsByType.get(type) ?? [];
    const numFields = numberFieldsByType.get(type) ?? [];

    const properties = node.data?.properties as Properties | undefined;
    if (!properties) return node;

    const legacyRsvpStatus =
      type === "action.update_guest_status" &&
      !("rsvpStatus" in properties) &&
      typeof properties.status === "string" &&
      (RSVP_STATUSES as readonly string[]).includes(properties.status)
        ? properties.status
        : undefined;

    const microsoftMail =
      type === microsoftSendEmailDefinition.type
        ? microsoftMailBackfill(properties)
        : undefined;

    if (
      arrayFields.length === 0 &&
      numFields.length === 0 &&
      legacyRsvpStatus === undefined &&
      microsoftMail === undefined
    ) {
      return node;
    }

    let changed = false;
    const next: Properties = { ...properties };

    if (legacyRsvpStatus !== undefined) {
      next.rsvpStatus = legacyRsvpStatus;
      next.status = "active";
      changed = true;
    }

    if (microsoftMail !== undefined) {
      Object.assign(next, microsoftMail);
      changed = true;
    }

    for (const [fields, normalize] of [
      [arrayFields, normalizeEntries],
      [numFields, normalizeNumber],
    ] as const) {
      for (const field of fields) {
        if (!(field in properties)) continue;
        const normalized = normalize(properties[field]);
        if (normalized !== properties[field]) {
          next[field] = normalized;
          changed = true;
        }
      }
    }

    return changed ? ({ ...node, data: { ...node.data, properties: next } } as T) : node;
  });
}
