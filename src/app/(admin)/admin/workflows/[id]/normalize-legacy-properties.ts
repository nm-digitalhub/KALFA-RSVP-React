import type { PaletteItem } from "@workflowbuilder/sdk";

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
 * Repair every node's legacy array values against the palette it will render in.
 *
 * A node whose type is not in the palette is returned untouched — an unknown
 * type is the converter's error to report, and guessing at its shape here would
 * be this function inventing a schema.
 */
export function normalizeLegacyProperties<T extends { data?: { type?: unknown; properties?: unknown } }>(
  nodes: readonly T[],
  paletteItems: readonly PaletteItem[],
): T[] {
  const fieldsByType = new Map<string, string[]>();
  for (const item of paletteItems) fieldsByType.set(item.type, objectArrayFields(item));

  return nodes.map((node) => {
    const fields = fieldsByType.get(String(node.data?.type ?? ""));
    if (!fields || fields.length === 0) return node;

    const properties = node.data?.properties as Properties | undefined;
    if (!properties) return node;

    let changed = false;
    const next: Properties = { ...properties };
    for (const field of fields) {
      if (!(field in properties)) continue;
      const normalized = normalizeEntries(properties[field]);
      if (normalized !== properties[field]) {
        next[field] = normalized;
        changed = true;
      }
    }

    return changed ? ({ ...node, data: { ...node.data, properties: next } } as T) : node;
  });
}
