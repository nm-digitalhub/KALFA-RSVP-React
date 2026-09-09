// The starter template is a hand-written diagram, which means every id, handle
// and React Flow `type` in it was typed by a person and none of it is checked
// by the compiler: `DiagramModel` types the SHAPE, not whether the handles
// match the node bodies or whether the graph satisfies the conversion contract.
//
// A wrong `type` on the condition, or a branch handle off by one character,
// produces a template that loads and looks correct and then reports
// `execution_incomplete` on the owner's first run. That is precisely the defect
// this template exists to keep owners away from, so it gets run, not eyeballed.
import { describe, expect, it } from 'vitest';

import { toWorkflowDefinition } from '../adapter/to-definition';
import { dryRunWorkflow } from '../engine/dry-run';

import { DIAGRAM_TEMPLATES } from './templates';
import { CONDITION_BRANCH_HANDLES } from './types';

// What the editor stores after the template is loaded and saved. `DiagramModel`
// nests nodes and edges under `diagram`; the save format is flat. Flattening
// here is exactly what `setDiagramModel` does on load.
function asStored(template: (typeof DIAGRAM_TEMPLATES)[number]) {
  return {
    name: template.value.name,
    layoutDirection: template.value.layoutDirection,
    nodes: template.value.diagram.nodes,
    edges: template.value.diagram.edges,
  };
}

const rsvp = DIAGRAM_TEMPLATES[0]!;
const ALL = ['tmpl-rsvp-trigger', 'tmpl-rsvp-condition', 'tmpl-rsvp-attending', 'tmpl-rsvp-declined'];

describe('starter templates', () => {
  it('every template satisfies the conversion contract', () => {
    for (const template of DIAGRAM_TEMPLATES) {
      const result = toWorkflowDefinition('wf-template', asStored(template));
      // The whole error list, not just `ok`, so a failure names the rule broken
      // instead of only saying that one was.
      expect(result.ok ? [] : result.errors.map((e) => e.message)).toEqual([]);
    }
  });

  it('carries the React Flow types the palette would have computed', () => {
    // `setDiagramModel` never runs `jb`, so these are load-bearing. 'node' on
    // the condition would render a body with no branch handles at all.
    const byId = new Map(rsvp.value.diagram.nodes.map((n) => [n.id, n.type]));
    expect(byId.get('tmpl-rsvp-trigger')).toBe('start-node');
    expect(byId.get('tmpl-rsvp-condition')).toBe('decision-node');
    expect(byId.get('tmpl-rsvp-attending')).toBe('node');
  });

  it('draws its branches on handles the condition actually emits', () => {
    const handles = rsvp.value.diagram.edges
      .filter((e) => e.source === 'tmpl-rsvp-condition')
      .map((e) => e.sourceHandle)
      .sort();
    expect(handles).toEqual(
      [CONDITION_BRANCH_HANDLES.false, CONDITION_BRANCH_HANDLES.true].sort(),
    );
  });

  it('runs both halves — neither branch is a dead end', async () => {
    const yes = await dryRunWorkflow({
      workflowId: 'wf-template',
      storedDefinition: asStored(rsvp),
      allNodeIds: ALL,
      scenario: { messageText: 'כן אני מגיע', buttonPayload: '', guestCase: 'one' },
    });

    // `completed`, not `incomplete`: the untaken branch is wired, so the
    // condition's port always finds a live edge.
    expect(yes.outcome.status).toBe('completed');
    expect(yes.steps.map((s) => s.nodeId)).toEqual([
      'tmpl-rsvp-trigger',
      'tmpl-rsvp-condition',
      'tmpl-rsvp-attending',
    ]);
    expect(yes.skippedNodeIds).toEqual(['tmpl-rsvp-declined']);
    expect(yes.effects[0]?.description).toContain('attending');

    const no = await dryRunWorkflow({
      workflowId: 'wf-template',
      storedDefinition: asStored(rsvp),
      allNodeIds: ALL,
      scenario: { messageText: 'לא אוכל להגיע', buttonPayload: '', guestCase: 'one' },
    });

    expect(no.outcome.status).toBe('completed');
    expect(no.steps.map((s) => s.nodeId)).toEqual([
      'tmpl-rsvp-trigger',
      'tmpl-rsvp-condition',
      'tmpl-rsvp-declined',
    ]);
    expect(no.skippedNodeIds).toEqual(['tmpl-rsvp-attending']);
    expect(no.effects[0]?.description).toContain('declined');
  });
});
