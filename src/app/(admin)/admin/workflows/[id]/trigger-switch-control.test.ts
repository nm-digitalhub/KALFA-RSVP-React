import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NodeType } from '@workflowbuilder/sdk';
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { TRIGGER_SWITCH_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { triggerSwitchRenderer } from './trigger-switch-control';

// "מה מפעיל את התהליך" — the control that lets an owner change WHICH trigger
// starts a flow.
//
// ⚠️ THE GAP WAS REPORTED BY THE OWNER, 2026-09-22: "אין לי אפשרות באמת לקבוע
// את הטריגר שמפעיל". Three separate trigger palette entries and no way to move
// between them — a template that shipped with a webhook trigger could not become
// a WhatsApp one without deleting the node and rewiring its edge.

const testerContext = { rootSchema: {}, config: {} };

const switchElement = {
  type: 'Label',
  text: '',
  options: { format: TRIGGER_SWITCH_FORMAT },
} as const;

const triggers = PALETTE_ITEMS.filter((item) => item.type.startsWith('trigger.'));

describe('the control is wired to the elements that ask for it', () => {
  it('claims the format, and nothing else', () => {
    expect(triggerSwitchRenderer.tester(switchElement as never, {}, testerContext)).toBe(5000);

    for (const other of [
      { type: 'Label', text: '' },
      { type: 'Text', scope: '#/properties/label' },
      { type: 'Label', text: '', options: { format: 'kalfa-node-run' } },
    ]) {
      expect(triggerSwitchRenderer.tester(other as never, {}, testerContext)).toBe(-1);
    }
  });

  it('⚠️ is registered in the editor — a renderer nobody lists never runs', () => {
    const editor = readFileSync(
      join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx'),
      'utf8',
    );
    const renderers = editor.slice(
      editor.indexOf('const JSON_FORM = {'),
      editor.indexOf('};', editor.indexOf('const JSON_FORM = {')),
    );
    expect(renderers).toContain('triggerSwitchRenderer');
  });
});

describe('every trigger offers the switch, and only triggers do', () => {
  it('the palette actually has triggers to switch between', () => {
    // Anti-no-op twice over: an empty list would make the next test vacuous, and
    // the control itself renders NOTHING when fewer than two triggers exist —
    // so one trigger would silently mean no switcher at all.
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  it('⚠️ every trigger carries it — a new trigger must not ship without a way in or out', () => {
    const without = triggers
      .filter((t) => !JSON.stringify(t.uischema).includes(TRIGGER_SWITCH_FORMAT))
      .map((t) => t.type);
    expect(without).toEqual([]);
  });

  it('no non-trigger node carries it', () => {
    // The control returns null for a non-trigger node anyway, but an element
    // that renders nothing is a blank row someone later "fixes".
    const strays = PALETTE_ITEMS.filter(
      (item) =>
        !item.type.startsWith('trigger.') &&
        JSON.stringify(item.uischema).includes(TRIGGER_SWITCH_FORMAT),
    ).map((item) => item.type);
    expect(strays).toEqual([]);
  });

  it('it is the FIRST element, as the vendor puts Trigger Type first', () => {
    for (const trigger of triggers) {
      const first = (trigger.uischema as { elements?: { options?: { format?: string } }[] })
        .elements?.[0];
      expect(first?.options?.format, `${trigger.type} buries the switcher`).toBe(
        TRIGGER_SWITCH_FORMAT,
      );
    }
  });
});

describe('⚠️ the two properties the in-place swap depends on', () => {
  it('every trigger renders as StartNode, so swapping data.type cannot remount the node', () => {
    // THIS IS WHAT KEEPS THE OUTGOING EDGE. The swap rewrites `data.type` on the
    // same node object; React Flow keys the node by its VISUAL template
    // (`templateType`). If a future trigger declared a different one, swapping
    // into it would change the node's template mid-flight — and an edge whose
    // endpoint remounts is an edge that can be dropped.
    for (const trigger of triggers) {
      expect(trigger.templateType, `${trigger.type}`).toBe(NodeType.StartNode);
    }
  });

  it('every trigger seeds the fields its own schema declares, so a swapped-in node is valid', () => {
    // The swap replaces `properties` wholesale with the target's
    // `defaultPropertiesData`. If those disagreed with the target's schema the
    // swap would produce exactly the defect the palette's `token`/`tokenHash`
    // mismatch produced — a node missing a required field, with the control
    // bound to nothing. palette-defaults.test.ts pins this for the whole
    // palette; it is asserted here too because THIS code depends on it.
    for (const trigger of triggers) {
      const declared = Object.keys(
        (trigger.schema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      const seeded = Object.keys(trigger.defaultPropertiesData ?? {});
      expect(seeded.filter((k) => !declared.includes(k)), `${trigger.type}`).toEqual([]);
      const required = ((trigger.schema as { required?: string[] }).required ?? []) as string[];
      expect(required.filter((k) => !seeded.includes(k)), `${trigger.type}`).toEqual([]);
    }
  });
});
