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
  ACTION_BRANCH_HANDLES,
  CONDITION_BRANCH_HANDLES,
  switchBranchHandle,
  SWITCH_DEFAULT_BRANCH_ID,
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

  it('wires EVERY branch the switch declares — a missing one is a dead end', () => {
    // Read off the node rather than off a fixed list: the switch now carries N
    // owner-defined branches, so "all of them" is whatever this template built.
    // `propagate` returns a dead end when a node names a port no edge carries,
    // and a dead end ends the run `execution_incomplete` — so a template with
    // three of four drawn would teach the wrong shape by reporting incomplete on
    // the answer it forgot.
    const sw = full.value.diagram.nodes.find((n) => n.id === 'tmpl-full-switch');
    const branches = (sw?.data.properties as { decisionBranches: Array<{ sourceHandle: string }> })
      .decisionBranches;
    const wired = full.value.diagram.edges
      .filter((e) => e.source === 'tmpl-full-switch')
      .map((e) => e.sourceHandle)
      .sort();
    expect(wired).toEqual(branches.map((b) => b.sourceHandle).sort());
    // And the default is among them, so an unrecognised answer has somewhere to go.
    expect(wired).toContain(SWITCH_DEFAULT_HANDLE);
  });

  it('every seeded branch carries the conditions that select it', () => {
    // The switch routes on `conditions`, not on the old `case1/2/3` fields. A
    // template whose branches were seeded with empty rows would load, look
    // right, and send EVERY answer to the default — the exact defect this file
    // exists to catch.
    const sw = full.value.diagram.nodes.find((n) => n.id === 'tmpl-full-switch');
    const branches = (
      sw?.data.properties as {
        decisionBranches: Array<{ id: string; conditions?: unknown[] }>;
      }
    ).decisionBranches;

    for (const b of branches) {
      if (b.id === SWITCH_DEFAULT_BRANCH_ID) {
        // The default is reached by ELIMINATION and must carry none — with
        // conditions it would be evaluated in order and could shadow a branch
        // below it.
        expect(b.conditions ?? []).toHaveLength(0);
      } else {
        expect(b.conditions ?? []).not.toHaveLength(0);
      }
    }
  });

  it('each branch handle is the one the SDK would mint for its id', () => {
    // The join between the seeded branch card and the edge drawn from it. Off by
    // one character and the card renders, the edge renders, and nothing connects.
    const sw = full.value.diagram.nodes.find((n) => n.id === 'tmpl-full-switch');
    const branches = (
      sw?.data.properties as { decisionBranches: Array<{ id: string; sourceHandle: string }> }
    ).decisionBranches;
    for (const b of branches) {
      expect(b.sourceHandle).toBe(switchBranchHandle(b.id));
    }
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

describe('קליטת רשימת אורחים מוואטסאפ — the import as a drawn flow', () => {
  // ⚠️ THE TEMPLATE THAT PROVES GUEST IMPORT IS NO LONGER HARD-CODED.
  //
  // It is the first one that does NOT start from a guest answering, and the
  // first whose trigger fires on a message kind that was unreachable from a
  // workflow until `messageKinds` existed. Three things can each silently break
  // it while every other test in this file stays green.

  const tmpl = DIAGRAM_TEMPLATES.find((t) => t.name === 'קליטת רשימת אורחים מוואטסאפ')!;

  it('exists in the selector', () => {
    expect(tmpl).toBeDefined();
  });

  it('⚠️ its trigger TICKS the file and contact kinds', () => {
    // Without this the template loads, looks right, and never fires once: the
    // trigger falls back to the guest-message kinds, and a CSV is not one.
    const trigger = tmpl.value.diagram.nodes.find((n) => n.id === 'tmpl-import-trigger');
    const kinds = (trigger?.data.properties as { messageKinds?: { value: string }[] }).messageKinds;
    // `{ value }` OBJECTS — the shape the node schema declares. Shipping bare
    // strings here put a validation error on the trigger of every workflow
    // created from this template, and showed a "!" the owner could not act on.
    expect(kinds).toEqual([{ value: 'document' }, { value: 'contacts' }]);
  });

  it('uses NO guest-touching node — the sender is the owner, not a guest', () => {
    // A run started by an owner sending a list carries no contact, so
    // update_guest_status / send_whatsapp / set_guest_field / the callback node
    // all refuse inside it. One of them in this template would be a step that
    // can only ever fail.
    const guestNodes = new Set([
      'action.update_guest_status',
      'action.send_whatsapp',
      'action.set_guest_field',
      'action.create_callback_request',
      'action.start_rsvp_ai_callback',
    ]);
    for (const n of tmpl.value.diagram.nodes) {
      expect(guestNodes.has(n.data.type)).toBe(false);
    }
  });

  it('wires BOTH branches of the import step — a bad file is not a dead end', () => {
    const handles = tmpl.value.diagram.edges
      .filter((e) => e.source === 'tmpl-import-stage')
      .map((e) => e.sourceHandle)
      .sort();
    expect(handles).toEqual([ACTION_BRANCH_HANDLES.error, ACTION_BRANCH_HANDLES.ok].sort());
  });

  it('carries the React Flow types the palette would have computed', () => {
    const byId = new Map(tmpl.value.diagram.nodes.map((n) => [n.id, n.type]));
    expect(byId.get('tmpl-import-trigger')).toBe('start-node');
    // 'node' here would render a body with no branch handles, and both edges
    // above would point at handles that are not on it.
    expect(byId.get('tmpl-import-stage')).toBe('decision-node');
    expect(byId.get('tmpl-import-alert')).toBe('node');
  });

  it('its alert references only outputs the import step actually declares', () => {
    // A `{{nodes.x.y}}` naming a field the node never returns fails the run at
    // the moment a real list arrives — the worst time to discover a typo.
    const declared = new Set(['rows', 'rowCount', 'errorCount', 'fileName', 'reviewUrl', 'created', 'staged', 'reason', 'message']);
    const text = JSON.stringify(tmpl.value.diagram.nodes);
    for (const [, field] of text.matchAll(/\{\{nodes\.tmpl-import-stage\.([\w]+)/g)) {
      expect(declared.has(field!)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The three clock/wait/fan-out templates
// ---------------------------------------------------------------------------
//
// These carry a rule the compiler cannot express and a reviewer cannot see: a
// flow NOT started by a guest's own message may not send free text, because the
// 24-hour service window that makes free text legal was never opened. Get it
// wrong and the template converts, arms, fires, and is refused by Meta for most
// recipients — a failure that only shows up in production, per-guest.

const nudge = DIAGRAM_TEMPLATES.find((t) => t.value.name.includes('אחזור אליכם'))!;
const sweep = DIAGRAM_TEMPLATES.find((t) => t.value.name === 'תזכורת שבועית למי שטרם ענה')!;
const child = DIAGRAM_TEMPLATES.find((t) => t.value.name.includes('תהליך-בן'))!;

const typesOf = (t: (typeof DIAGRAM_TEMPLATES)[number]) =>
  t.value.diagram.nodes.map((n) => n.data.type);

describe('clock, wait and fan-out templates', () => {
  it('all three are in the selector', () => {
    expect([nudge, sweep, child].every(Boolean)).toBe(true);
  });

  it('⚠️ no flow that a CLOCK or a fan-out starts sends free text', () => {
    // THE RULE THESE TEMPLATES EXIST TO DEMONSTRATE. `action.send_whatsapp` is
    // free text and needs the guest's own message to have opened the window;
    // `action.send_template` is an approved template and does not.
    for (const t of [nudge, sweep, child]) {
      expect(typesOf(t)).not.toContain('action.send_whatsapp');
    }
  });

  it('the wait template really waits, and then sends a TEMPLATE', () => {
    expect(typesOf(nudge)).toEqual([
      'trigger.whatsapp_inbound',
      'logic.wait',
      'action.send_template',
    ]);
    // Two days is past the 24-hour window by design — that is why the node after
    // it cannot be the free-text one.
    const wait = nudge.value.diagram.nodes.find((n) => n.data.type === 'logic.wait')!;
    expect(wait.data.properties).toMatchObject({ amount: 2, unit: 'days' });
  });

  it('⚠️ the fan-out wires BOTH branches — an unwired port ends the run', () => {
    const node = sweep.value.diagram.nodes.find(
      (n) => n.data.type === 'action.start_for_each_guest',
    )!;
    const declared = (
      node.data.properties.decisionBranches as { sourceHandle: string }[]
    ).map((b) => b.sourceHandle);
    const wired = sweep.value.diagram.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.sourceHandle);

    expect(declared.sort()).toEqual([ACTION_BRANCH_HANDLES.error, ACTION_BRANCH_HANDLES.ok].sort());
    expect(wired.sort()).toEqual(declared.sort());
  });

  it('⚠️ the fan-out ships with a ceiling — a template must not reach everybody', () => {
    // A missing cap makes the node THROW rather than fan out to the whole list,
    // but a template is something an owner arms quickly. It ships low.
    const node = sweep.value.diagram.nodes.find(
      (n) => n.data.type === 'action.start_for_each_guest',
    )!;
    expect(node.data.properties.maxGuests).toBe(10);
    // And deliberately blank, because only the owner knows the child workflow.
    expect(node.data.properties.targetWorkflowId).toBe('');
  });

  it('⚠️ the child template is NOT reachable from the public endpoint', () => {
    // Its trigger exists only to satisfy "exactly one start node". An empty
    // token is refused by `findWorkflowForToken` on both sides, so arming it
    // opens nothing — but a fan-out can still start it.
    const trigger = child.value.diagram.nodes.find((n) => n.type === 'start-node')!;
    expect(trigger.data.type).toBe('trigger.webhook');
    expect(trigger.data.properties.token).toBe('');
  });

  it('every new template still declares exactly one start node', () => {
    for (const t of [nudge, sweep, child]) {
      expect(t.value.diagram.nodes.filter((n) => n.type === 'start-node')).toHaveLength(1);
    }
  });
  it('⚠️ the scheduled sweep targets a filter that EMPTIES ITSELF', async () => {
    // THE RULE THAT KEEPS THIS TEMPLATE FROM BECOMING A SPAM MACHINE.
    //
    // A scheduled fan-out re-fires on every tick: child runs dedupe on
    // `fanout:${parentRunId}:${nodeId}:${contactId}` and the parent run id is new
    // each firing, so nothing remembers yesterday. The only safe target is a
    // filter a guest LEAVES by responding — `pending` is that filter.
    //
    // `attending` is the dangerous one: thanking someone does not stop them
    // attending, so the same guests would be messaged every week forever.
    const node = sweep.value.diagram.nodes.find(
      (n) => n.data.type === 'action.start_for_each_guest',
    )!;
    expect(node.data.properties.statuses).toEqual([{ value: 'pending' }]);

    // And weekly, not daily: `days: []` means EVERY day.
    const trigger = sweep.value.diagram.nodes.find((n) => n.data.type === 'trigger.schedule')!;
    expect(trigger.data.properties.days).toEqual([0]);
  });

  it('⚠️ the sweep does not duplicate the thank-you the worker already sends', () => {
    // `campaign-thankyou-sweep` runs every 15 minutes in worker/main.ts and sends
    // `thankyou` after an event. A workflow template sending the same key is a
    // second path to one message, and a guest would get both.
    for (const t of [nudge, sweep, child]) {
      const keys = t.value.diagram.nodes
        .filter((n) => n.data.type === 'action.send_template')
        .map((n) => n.data.properties.messageKey);
      expect(keys).not.toContain('thankyou');
    }
  });

  it('a dry run of the wait template REPORTS the limit instead of crashing', async () => {
    // MEASURED, not assumed: `dryRunWorkflow` calls `runWorkflow` directly and so
    // never passes the wait interceptor that `run-workflow.ts` installs. Pressing
    // "dry run" on this template therefore cannot simulate the pause — it stops
    // at the wait and names it. Pinned because the acceptable failure here is a
    // NAMED one; an unhandled throw would look like a broken template.
    const r = await dryRunWorkflow({
      workflowId: 'wf-dry',
      storedDefinition: asStored(nudge),
      allNodeIds: nudge.value.diagram.nodes.map((n) => n.id),
      scenario: { guestCase: 'one' },
    } as Parameters<typeof dryRunWorkflow>[0]);

    // Narrowed, not cast: `RunWorkflowOutcome` is a union and only the failing
    // arm carries a message. Asserting the status first is what makes reading it
    // legal — and it also means a future `completed` here fails LOUDLY here
    // rather than silently skipping the message check.
    if (r.outcome.status !== 'failed') throw new Error(`expected failed, got ${r.outcome.status}`);
    expect(r.outcome.message).toContain('המתנה');
    // The trigger still ran, so the trace is useful up to the wait.
    expect(r.steps.map((s) => s.nodeId)).toEqual(['tmpl-nudge-trigger']);
  });
});
