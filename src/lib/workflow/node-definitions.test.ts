// Every node folder's `definition.ts` is complete, and every registry reads it.
//
// Condition 5 of plans/node-folders-file-matrix.md §7. A node moved into
// `nodes/<name>/` without one of these facts would still compile — the
// registries would simply keep a literal of their own, and the folder would be a
// second source of truth instead of the only one. This walks EVERY folder on
// disk, so the 2nd…23rd node are checked the moment they land, with no edit here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCatalogueEntry } from './catalogue/nodes';
import { PALETTE_ITEMS } from './catalogue/schemas';
import {
  GUEST_SCOPED_NODE_TYPES,
  NODE_DEPLOYMENT_BINDINGS,
  NODE_NUMBER_RANGES,
  NODE_REQUIRED_FIELDS,
  NODE_TYPES,
  type KalfaNodeType,
} from './catalogue/types';
import { MAX_NODE_TIMEOUT_MS, NODE_ACTIVITY_PROFILES } from './engine/node-budgets';
import { nodeFolders } from './node-sources';
import { STEP_HANDLERS } from './steps';

type Definition = {
  deploymentBindings?: unknown;
  guestScoped?: unknown;
  type?: unknown;
  isTrigger?: unknown;
  requiredFields?: unknown;
  activityProfile?: unknown;
  outputFields?: unknown;
  numberRanges?: unknown;
};

const NODES_DIR = join(process.cwd(), 'src/lib/workflow/nodes');

/** `logic.set_value` → `logic-set-value`: the folder name the matrix fixes. */
const folderFor = (type: string) => type.replace(/[._]/g, '-');

const folders = nodeFolders();

describe('node definitions', () => {
  it('the scan found the node folders — not an empty directory', () => {
    // At least the nodes moved so far. Raise as nodes move; never lower.
    expect(folders.length).toBeGreaterThanOrEqual(23);
  });

  describe.each(folders)('%s/definition.ts', (folder) => {
    const path = join(NODES_DIR, folder, 'definition.ts');

    it('imports nothing at all — it is read by the worker and by types.ts', () => {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/^\s*import\b/m);
      expect(source).not.toMatch(/\brequire\s*\(/);
    });

    it('declares a known type, and lives in the folder named after it', async () => {
      const def = (await import(path)) as Definition;
      expect(typeof def.type).toBe('string');
      expect(NODE_TYPES as readonly string[]).toContain(def.type);
      expect(folderFor(def.type as string)).toBe(folder);
    });

    it('declares isTrigger, and the catalogue reads exactly that', async () => {
      const def = (await import(path)) as Definition;
      expect(typeof def.isTrigger).toBe('boolean');
      expect(findCatalogueEntry(def.type as string)?.isTrigger).toBe(def.isTrigger);
    });

    it('declares requiredFields, and NODE_REQUIRED_FIELDS is the SAME array', async () => {
      const def = (await import(path)) as Definition;
      expect(Array.isArray(def.requiredFields)).toBe(true);
      expect(def.requiredFields).toEqual(expect.arrayContaining(['label', 'description']));
      // Identity, not equality: a pasted copy would drift. Same rule arm-check.test.ts pins.
      expect(NODE_REQUIRED_FIELDS[def.type as KalfaNodeType]).toBe(def.requiredFields);
    });

    it('NODE_NUMBER_RANGES is the SAME object as numberRanges, or absent with it', async () => {
      const def = (await import(path)) as Definition;
      // Optional: only a node with a numeric bound declares it. The editor schema
      // spreads the definition while arm-check.ts reads the registry, so a pasted
      // copy here would let the form and the arming gate disagree silently.
      if ('numberRanges' in def) {
        expect(NODE_NUMBER_RANGES[def.type as KalfaNodeType]).toBe(def.numberRanges);
      } else {
        expect(NODE_NUMBER_RANGES[def.type as KalfaNodeType]).toBeUndefined();
      }
    });

    it('declares an activity profile explicitly, and the budget table reads it', async () => {
      const def = (await import(path)) as Definition;
      // `'default'` is the explicit way to say "the 120s default"; ABSENT is not
      // allowed — a missing entry defaulting silently is exactly what this closes.
      expect(def).toHaveProperty('activityProfile');
      if (def.activityProfile === 'default') {
        expect(NODE_ACTIVITY_PROFILES[def.type as KalfaNodeType]).toBeUndefined();
        return;
      }
      const profile = def.activityProfile as { timeoutMs?: unknown };
      expect(typeof profile.timeoutMs).toBe('number');
      expect(profile.timeoutMs as number).toBeGreaterThan(0);
      // Above the ceiling the resolver silently falls back to the default.
      expect(profile.timeoutMs as number).toBeLessThanOrEqual(MAX_NODE_TIMEOUT_MS);
      expect(NODE_ACTIVITY_PROFILES[def.type as KalfaNodeType]).toBe(def.activityProfile);
    });

    it('declares outputFields, each with a type and a label', async () => {
      const def = (await import(path)) as Definition;
      expect(def.outputFields).toBeTypeOf('object');
      expect(def.outputFields).not.toBeNull();
      for (const [key, field] of Object.entries(def.outputFields as Record<string, unknown>)) {
        const f = field as { type?: unknown; label?: unknown };
        expect(typeof f.type, key).toBe('string');
        expect(typeof f.label, key).toBe('string');
      }
    });

    it('the palette entry reads outputFields — the SAME object, not a copy', async () => {
      const def = (await import(path)) as Definition;
      const items = PALETTE_ITEMS.filter((item) => item.type === def.type);
      expect(items).toHaveLength(1);
      const outputSchema = items[0]!.outputSchema as { properties?: unknown } | undefined;
      expect(outputSchema?.properties).toBe(def.outputFields);
    });

    it('declares deploymentBindings — even `{}` — and the export table reads it', async () => {
      const def = (await import(path)) as Definition;
      // Present, not merely falsy-safe: an absent key could mean "nothing to
      // bind" or "forgot", and only an explicit `{}` says which.
      expect(def).toHaveProperty('deploymentBindings');
      expect(def.deploymentBindings).toBeTypeOf('object');
      for (const kind of Object.values(def.deploymentBindings as Record<string, unknown>)) {
        expect(['identifier', 'secret', 'catalogue']).toContain(kind);
      }
      expect(NODE_DEPLOYMENT_BINDINGS[def.type as KalfaNodeType]).toBe(def.deploymentBindings);
    });

    it('declares guestScoped: true exactly when GUEST_SCOPED_NODE_TYPES lists it', async () => {
      const def = (await import(path)) as Definition;
      // Present only on a guest-scoped node, and then only as `true`: the flag and
      // the arming list must say the same thing, so neither can be edited alone.
      if ('guestScoped' in def) expect(def.guestScoped).toBe(true);
      expect(def.guestScoped === true).toBe(GUEST_SCOPED_NODE_TYPES.includes(def.type as KalfaNodeType));
    });

    it('has a registered handler', async () => {
      const def = (await import(path)) as Definition;
      expect(typeof STEP_HANDLERS[def.type as KalfaNodeType]).toBe('function');
    });
  });
});
