// The node-type catalogue: which types exist, and which may begin a flow.
//
// METADATA ONLY, and imports nothing at run time — this module is read by the
// pg-boss worker, which must never load @workflowbuilder/sdk. The editor's half
// (property schemas, labels, icons) lives in ./schemas.ts.
//
// Adding a step type is one entry here plus one in ./schemas.ts. No editor code
// changes, no adapter changes.
import { NODE_TYPES, type CatalogueEntry, type KalfaNodeType } from './types';

export const CATALOGUE: readonly CatalogueEntry[] = [
  { type: 'trigger.whatsapp_inbound', isTrigger: true },
  { type: 'logic.condition', isTrigger: false },
  { type: 'action.update_guest_status', isTrigger: false },
];

// Lookup by the string stored in the diagram. `undefined` is rule 5: an unknown
// type is a validation error, decided by the caller, not silently defaulted here.
const BY_TYPE = new Map<string, CatalogueEntry>(CATALOGUE.map((e) => [e.type, e]));

export function findCatalogueEntry(type: string): CatalogueEntry | undefined {
  return BY_TYPE.get(type);
}

export function isKnownNodeType(type: string): type is KalfaNodeType {
  return BY_TYPE.has(type);
}

/**
 * RULE 1, as a function. The only question the adapter asks about who may start.
 * A type absent from the catalogue is not a trigger and not anything else — it
 * fails validation before this is ever consulted.
 */
export function isTriggerType(type: string): boolean {
  return BY_TYPE.get(type)?.isTrigger === true;
}

// Guards the two lists against drifting apart: NODE_TYPES is what the rest of
// the codebase narrows on, CATALOGUE is what the editor and adapter read.
export const CATALOGUE_COVERS_ALL_TYPES: boolean =
  NODE_TYPES.every((t) => BY_TYPE.has(t)) && CATALOGUE.length === NODE_TYPES.length;
