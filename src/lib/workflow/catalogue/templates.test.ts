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
import {
  CONDITION_BRANCH_HANDLES,
  SWITCH_CASE_HANDLES,
  SWITCH_DEFAULT_HANDLE,
} from './types';

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

// ---------------------------------------------------------------------------
// Template 4 — "אישור הגעה — כל התשובות"
// ---------------------------------------------------------------------------

// The defect it exists to remove: the three condition-based templates give the
// guest two routes and both mean "the test", so "אולי" and free text are both
// recorded as DECLINED. A wrong headcount nobody will question later is worse
// than no answer at all.

const full = DIAGRAM_TEMPLATES.find((t) => t.name === 'אישור הגעה — כל התשובות')!;
const FULL_IDS = [
  'tmpl-full-trigger',
  'tmpl-full-switch',
  'tmpl-full-attending',
  'tmpl-full-reply-yes',
  'tmpl-full-declined',
  'tmpl-full-reply-no',
  'tmpl-full-maybe',
  'tmpl-full-unknown',
];

const runFull = (buttonPayload: string, messageText = '') =>
  dryRunWorkflow({
    workflowId: 'wf-template',
    storedDefinition: asStored(full),
    allNodeIds: FULL_IDS,
    scenario: { messageText, buttonPayload, guestCase: 'one' },
  });

describe('the four-answer RSVP template', () => {
  it('is in the selector', () => {
    expect(full).toBeTruthy();
  });

  it('carries the React Flow types the palette would have computed', () => {
    const byId = new Map(full.value.diagram.nodes.map((n) => [n.id, n.type]));
    expect(byId.get('tmpl-full-trigger')).toBe('start-node');
    // 'node' here would render a body with no branch handles and every edge
    // below would point at a handle that is not on it.
    expect(byId.get('tmpl-full-switch')).toBe('decision-node');
    expect(byId.get('tmpl-full-attending')).toBe('node');
  });

  it('wires ALL FOUR switch ports — a missing one is a dead end', () => {
    const handles = full.value.diagram.edges
      .filter((e) => e.source === 'tmpl-full-switch')
      .map((e) => e.sourceHandle)
      .sort();
    expect(handles).toEqual([...SWITCH_CASE_HANDLES, SWITCH_DEFAULT_HANDLE].sort());
  });

  it('routes on the BUTTON PAYLOAD, not on the message text', () => {
    // The payload is machine-chosen and exact; the text is a label that changes
    // with the template's wording and language.
    const sw = full.value.diagram.nodes.find((n) => n.id === 'tmpl-full-switch');
    const props = sw?.data.properties as { left: string };
    expect(props.left).toBe('{{trigger.button_payload}}');
  });

  it('does not pin itself to one WhatsApp line', () => {
    // The phone_number_id differs per account; a starter carrying a stale one
    // would silently never fire.
    const trigger = full.value.diagram.nodes.find((n) => n.id === 'tmpl-full-trigger');
    expect((trigger?.data.properties as { phoneNumberId: string }).phoneNumberId).toBe('');
  });

  it('"מגיע" updates the status AND answers the guest', async () => {
    const r = await runFull('rsvp_attending');
    expect(r.outcome.status).toBe('completed');
    expect(r.steps.map((s) => s.nodeId)).toEqual([
      'tmpl-full-trigger',
      'tmpl-full-switch',
      'tmpl-full-attending',
      'tmpl-full-reply-yes',
    ]);
    expect(JSON.stringify(r.effects)).toContain('attending');
  });

  it('"לא מגיע" updates the status AND answers the guest', async () => {
    const r = await runFull('rsvp_declined');
    expect(r.outcome.status).toBe('completed');
    expect(r.steps.map((s) => s.nodeId)).toContain('tmpl-full-declined');
    expect(r.steps.map((s) => s.nodeId)).toContain('tmpl-full-reply-no');
    expect(JSON.stringify(r.effects)).toContain('declined');
  });

  it('"אולי" reaches a HUMAN and changes NO status', async () => {
    // The whole reason the template exists. Guessing a status from an uncertain
    // answer is the wrong headcount this avoids.
    const r = await runFull('rsvp_maybe');
    expect(r.outcome.status).toBe('completed');
    expect(r.steps.map((s) => s.nodeId)).toContain('tmpl-full-maybe');
    const effects = JSON.stringify(r.effects);
    expect(effects).not.toContain('attending');
    expect(effects).not.toContain('declined');
  });

  it('free text takes the DEFAULT route to a human, not the declined one', async () => {
    // A guest who types instead of tapping has an empty payload. Under the
    // condition-based templates this was recorded as declined.
    const r = await runFull('', 'מי זה?');
    expect(r.outcome.status).toBe('completed');
    expect(r.steps.map((s) => s.nodeId)).toContain('tmpl-full-unknown');
    expect(JSON.stringify(r.effects)).not.toContain('declined');
  });

  it('every route ends completed — none of the four is a dead end', async () => {
    for (const payload of ['rsvp_attending', 'rsvp_declined', 'rsvp_maybe', '']) {
      const r = await runFull(payload, 'טקסט כלשהו');
      expect(r.outcome.status, `payload "${payload}"`).toBe('completed');
    }
  });
});
