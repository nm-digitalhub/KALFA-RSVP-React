'use client';

import { useState } from 'react';

import {
  FormControlWithLabel,
  Icon,
  getStoreNodes,
  optionIs,
  rankWith,
  setStoreNodes,
  useSingleSelectedElement,
  useStore,
  withJsonFormsLabelProps,
  type IconType,
  type JsonFormsRendererExtension,
  type PaletteItem,
  type PaletteItemOrGroup,
} from '@workflowbuilder/sdk';

import { Button } from '@/components/ui/button';
import { TRIGGER_SWITCH_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

// WHAT STARTS THIS FLOW — and the ability to change it without rebuilding the
// diagram.
//
// ⚠️ THE GAP THIS CLOSES WAS REPORTED, NOT INFERRED. The owner's words, 2026-09-22:
// "אין לי אפשרות באמת לקבוע את הטריגר שמפעיל". He was right. The vendor's own
// Trigger node opens with a `Trigger Type` select
// (`docs/workflowbuilder/nodes/trigger.md`, verified against the live page the
// same day — identical); ours ships THREE separate palette entries and no way to
// move between them. A template that arrives with a webhook trigger could not
// become a WhatsApp one: delete the node, drag another, rewire the edge — and
// nothing in the UI said so.
//
// ⚠️ WHY THIS REPLACES THE NODE INSTEAD OF UNIFYING THE THREE TYPES. Unifying
// them into one `trigger.*` with a discriminator is the vendor's shape, and it
// is the bigger change by an order of magnitude: `trigger.whatsapp_inbound` /
// `trigger.webhook` / `trigger.schedule` are what the ENGINE dispatches on, they
// appear in ~18 production files, and 8 trigger nodes across 7 saved workflows —
// 4 of them armed — carry the current shape (measured in the live DB, 22.9).
// That is a production-data migration, which CLAUDE.md does not let us perform
// without explicit approval. `plans/workflow-trigger-selection.md` writes it up.
// This control delivers the missing CAPABILITY with no engine change and no
// migration at all.
//
// ⚠️ WHY SWAPPING `data.type` IN PLACE IS SOUND — measured, not assumed:
//   1. `PaletteState.getNodeDefinition(nodeType) => PaletteItem | undefined`
//      (`dist/index.d.ts:1169`) — the SDK resolves a node's schema AND uischema
//      from `data.type` at lookup time. Change the type and the panel re-forms.
//   2. All three triggers already declare `templateType: NodeType.StartNode`, so
//      the React Flow node type does not change: no remount, no lost handles.
//   3. Edges reference the node `id`, which is preserved — so the outgoing edge
//      survives the swap. That is the whole reason this is done as an in-place
//      rewrite rather than a delete-and-add.
//
// ⚠️ NOT A FIELD, AND DELIBERATELY A `Label` — the same shape as
// node-run-control.tsx. There is nothing in `data.properties` for a control to
// bind to: the thing being edited is `data.type`, which is node data the editor
// owns. JsonForms has no scope for that, so the element is the closest thing the
// SDK's closed union has to "render something here", and the renderer replaces
// it wholesale.

/** The palette is a mixed array of items and labelled groups. Flatten it. */
function flattenPalette(entries: PaletteItemOrGroup[]): PaletteItem[] {
  return entries.flatMap((entry) =>
    'groupItems' in entry ? entry.groupItems : [entry],
  );
}

function TriggerSwitchControl() {
  const selection = useSingleSelectedElement();
  const node = selection?.node ?? null;

  // Derived from the PALETTE, not from a list passed through the uischema. A
  // fourth trigger added to `schemas.ts` therefore appears here with no edit,
  // and no catalogue data is duplicated across the three uischemas that declare
  // this element. The `trigger.` prefix is the contract — `catalogue.test.ts`
  // pins it.
  const paletteData = useStore((s) => s.data);
  const triggers = flattenPalette(paletteData).filter((item) =>
    item.type.startsWith('trigger.'),
  );

  const [pending, setPending] = useState<string | null>(null);

  const currentType = (node?.data as { type?: string } | undefined)?.type;
  if (!node || !currentType?.startsWith('trigger.')) return null;
  // One option is no choice. Render nothing rather than a select that cannot
  // change anything.
  if (triggers.length < 2) return null;

  const swap = (targetType: string) => {
    const target = triggers.find((t) => t.type === targetType);
    if (!target) return;

    const currentProps = (node.data as { properties?: Record<string, unknown> }).properties ?? {};
    const currentDefinition = triggers.find((t) => t.type === currentType);
    const currentDefaults = (currentDefinition?.defaultPropertiesData ?? {}) as Record<string, unknown>;

    // KEEP WHAT THE OWNER WROTE, DROP WHAT BELONGS TO THE OLD TRIGGER. A title
    // still says what this step is for after the mechanism changes; a keyword or
    // a token hash does not, and carrying one over would leave a field the new
    // schema never declares — exactly the defect the palette's own
    // `token`/`tokenHash` mismatch caused (palette-defaults.test.ts).
    const carried: Record<string, unknown> = {};
    for (const key of ['label', 'description'] as const) {
      const value = currentProps[key];
      if (typeof value === 'string' && value.trim() !== '' && value !== currentDefaults[key]) {
        carried[key] = value;
      }
    }

    setStoreNodes(
      getStoreNodes().map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                type: target.type,
                icon: target.icon,
                // Whole-object replacement, not a merge: a merge is how a field
                // from the old trigger survives into a node whose schema does
                // not declare it.
                properties: { ...target.defaultPropertiesData, ...carried },
              },
            }
          : candidate,
      ),
    );
    setPending(null);
  };

  const pendingItem = pending ? triggers.find((t) => t.type === pending) : undefined;

  return (
    <FormControlWithLabel label="מה מפעיל את התהליך">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {triggers.map((trigger) => {
            const isCurrent = trigger.type === currentType;
            return (
              <Button
                key={trigger.type}
                type="button"
                size="sm"
                variant={isCurrent ? 'default' : 'outline'}
                aria-pressed={isCurrent}
                onClick={() => (isCurrent ? setPending(null) : setPending(trigger.type))}
              >
                <Icon name={trigger.icon as IconType} />
                {trigger.label}
              </Button>
            );
          })}
        </div>

        {pendingItem && (
          // An inline confirm rather than a dialog: the swap DISCARDS the current
          // trigger's fields, so it must be deliberate — and a portalled dialog
          // inside this panel is the RTL failure this project already knows
          // (base-ui-rtl-direction-provider).
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <p className="text-sm">
              מעבר ל&quot;{pendingItem.label}&quot; ימחק את ההגדרות של הטריגר הנוכחי. הכותרת
              והתיאור יישמרו.
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => swap(pendingItem.type)}>
                החלפה
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPending(null)}>
                ביטול
              </Button>
            </div>
          </div>
        )}
      </div>
    </FormControlWithLabel>
  );
}

export const triggerSwitchRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5000, optionIs('format', TRIGGER_SWITCH_FORMAT)),
  renderer: withJsonFormsLabelProps(TriggerSwitchControl),
};
