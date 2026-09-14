import { describe, expect, it } from 'vitest';

import { isKnownNodeType } from './nodes';
import { DIAGRAM_TEMPLATES } from './templates';

import { findArmBlockers } from './arm-check';

// ⚠️ THE RULE THIS FILE DEFENDS, and the reason it is a SECOND gate rather than
// part of the converter: conversion asks "can this graph run", arming asks "is
// every step set up". A starter template must pass the first and may fail the
// second — that is what makes a template a draft instead of a broken workflow.

const node = (id: string, type: string, properties: Record<string, unknown>) => ({
  id,
  type: 'node',
  position: { x: 0, y: 0 },
  data: { segments: [], type, properties },
});

const wrap = (nodes: unknown[]) => ({ name: 'w', nodes, edges: [] });

describe('findArmBlockers', () => {
  it('⚠️ catches the blank that fails on Sunday at 10:00', () => {
    // `action.start_for_each_guest` converts fine with no target and then throws
    // at RUN time. Before this check, the owner pressed "arm", nothing objected,
    // and the failure arrived hours later in a run log.
    const blockers = findArmBlockers(
      wrap([
        node('fan', 'action.start_for_each_guest', {
          label: 'לכל אורח',
          description: 'd',
          targetWorkflowId: '',
          maxGuests: 10,
        }),
      ]),
    );
    expect(blockers).toEqual([
      'הצעד "לכל אורח": לא נבחר תהליך להרצה. צרו את תהליך-הבן (למשל מהתבנית "תזכורת לאורח אחד") והדביקו את המזהה שלו כאן.',
    ]);
  });

  it('⚠️ a PRESENT key with a blank value — the case `required` alone misses', () => {
    // JSON Schema `required` only asks whether the key exists. The editor form is
    // satisfied by `''`, and the handler still refuses it. That gap is the whole
    // reason this is not just an ajv call.
    expect(
      findArmBlockers(
        wrap([node('n', 'action.send_template', { label: 'שליחה', description: 'd', messageKey: '   ' })]),
      ),
    ).toEqual(['הצעד "שליחה": השדה "messageKey" ריק.']);
  });

  it('enforces a declared minimum — a cap of zero reaches nobody', () => {
    const blockers = findArmBlockers(
      wrap([
        node('fan', 'action.start_for_each_guest', {
          label: 'פיצול',
          description: 'd',
          targetWorkflowId: 'wf-child',
          maxGuests: 0,
        }),
      ]),
    );
    expect(blockers).toEqual(['הצעד "פיצול": "maxGuests" חייב להיות 1 לפחות.']);
  });

  it('⚠️ accepts the PRE-RENAME key, because the handler does', () => {
    // MEASURED AGAINST THE LIVE DATABASE. `rsvpStatus` was called `status` until
    // the SDK claimed `status` for the node's own lifecycle. A diagram saved
    // before that still RUNS — `updateGuestStatus` reads both — so refusing to
    // arm it would be this check inventing a rule the engine does not have.
    // The first version of this file did exactly that, against a real stored row.
    expect(
      findArmBlockers(
        wrap([node('s', 'action.update_guest_status', { label: 'סמן', description: 'd', status: 'attending' })]),
      ),
    ).toEqual([]);

    // …and the current key is of course still fine.
    expect(
      findArmBlockers(
        wrap([
          node('s', 'action.update_guest_status', {
            label: 'סמן',
            description: 'd',
            rsvpStatus: 'attending',
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it('a schedule with no day list arms — empty there means EVERY day', () => {
    // Pinned as BEHAVIOUR, not as proof of the array carve-out below it: `days`
    // is not in `trigger.schedule`'s `required`, so it never reaches that branch.
    // MEASURED: no schema in the catalogue declares a required array field today,
    // which is why the carve-out has no natural test — it is there so that the
    // first node to declare one is not refused for a deliberate "no filter".
    expect(
      findArmBlockers(
        wrap([
          {
            id: 't',
            type: 'start-node',
            position: { x: 0, y: 0 },
            data: {
              segments: [],
              type: 'trigger.schedule',
              properties: { label: 'שעון', description: 'd', time: '10:00', days: [] },
            },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('⚠️ a step left in DRAFT blocks arming — the rule NODE_STATUSES states', () => {
    // Until now this was documented and not implemented: a half-written step
    // armed silently and was skipped at run time with nobody told.
    const blockers = findArmBlockers(
      wrap([
        node('half', 'action.send_template', {
          label: 'טיוטה',
          description: 'd',
          messageKey: 'thankyou',
          status: 'draft',
        }),
      ]),
    );
    expect(blockers).toEqual([
      'הצעד "טיוטה": הצעד בטיוטה. סיימו אותו, או העבירו אותו ל"מושבת" כדי לדלג עליו במכוון.',
    ]);
  });

  it('⚠️ but DISABLED does not — that one is the owner’s decision', () => {
    // Both skip identically at run time. The difference is intent, and arming
    // must respect a step deliberately switched off.
    expect(
      findArmBlockers(
        wrap([
          node('off', 'action.send_template', {
            label: 'כבוי',
            description: 'd',
            messageKey: 'thankyou',
            status: 'disabled',
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it('a draft step reports ONLY that, not its empty fields too', () => {
    // A step nobody finished is expected to have blanks. Listing them as well
    // would bury the one line that says what to do.
    const blockers = findArmBlockers(
      wrap([node('half', 'action.send_template', { label: 'טיוטה', description: '', status: 'draft' })]),
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('בטיוטה');
  });

  it('⚠️ an UNRECOGNISED status is active, never a block', () => {
    // MEASURED in production 2026-09-14: two stored nodes carry
    // `status: 'attending'` / `'declined'` — the RSVP value from before that
    // field was renamed to `rsvpStatus`. Refusing to arm those would break
    // workflows that run correctly.
    for (const status of ['attending', 'declined', '', 'DRAFT', 'archived']) {
      expect(
        findArmBlockers(
          wrap([
            node('n', 'action.send_template', {
              label: 'צעד',
              description: 'd',
              messageKey: 'thankyou',
              status,
            }),
          ]),
        ),
        status,
      ).toEqual([]);
    }
  });

  it('⚠️ refuses to arm a fan-out that points at its own workflow', () => {
    // Static property of the diagram, so the cheapest place to catch it is before
    // anything runs. The handler refuses it again at run time, because arming is
    // not required to be a fan-out TARGET.
    const diagram = wrap([
      node('fan', 'action.start_for_each_guest', {
        label: 'פיצול',
        description: 'd',
        targetWorkflowId: 'wf-1',
        maxGuests: 10,
      }),
    ]);
    expect(findArmBlockers(diagram, 'wf-1')).toEqual([
      'הצעד "פיצול": הצעד מצביע על התהליך הזה עצמו. תהליך שמפעיל את עצמו לכל אורח אינו נעצר — בחרו תהליך אחר.',
    ]);
    // Pointing at a DIFFERENT workflow is the normal case and must pass.
    expect(findArmBlockers(diagram, 'wf-other')).toEqual([]);
    // And with no id to compare against, the check cannot run — it must not
    // guess, and the handler still refuses at run time.
    expect(findArmBlockers(diagram)).toEqual([]);
  });

  it('⚠️ refuses to arm a guest callback routed to the SALES agent', () => {
    // `topic` is the router: `enqueueSalesCallDispatch` gates on this exact
    // string, and this node is guest-scoped. Static, so it is refused before a
    // single guest is dialled.
    const blockers = findArmBlockers(
      wrap([
        node('cb', 'action.create_callback_request', {
          label: 'בקשת חזרה',
          description: 'd',
          topic: 'מכירות',
        }),
      ]),
      'wf-1',
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('סוכן המכירות');

    // Any offered topic arms normally.
    expect(
      findArmBlockers(
        wrap([
          node('cb', 'action.create_callback_request', {
            label: 'בקשת חזרה',
            description: 'd',
            topic: 'שאלה על האירוע',
          }),
        ]),
        'wf-1',
      ),
    ).toEqual([]);
  });

  it('says nothing about an unknown node type — that is the converter’s error', () => {
    expect(findArmBlockers(wrap([node('x', 'action.not_a_real_node', {})]))).toEqual([]);
  });

  it('names the step by its id when it has no label to show', () => {
    const blockers = findArmBlockers(
      wrap([node('fan-7', 'action.send_template', { description: 'd', label: '  ' })]),
    );
    expect(blockers.some((b) => b.includes('fan-7'))).toBe(true);
  });

  it('survives a definition it cannot parse rather than blocking on it', () => {
    // Disarming must always work and arming must fail for REAL reasons. A shape
    // this cannot read is the converter's to reject.
    expect(findArmBlockers(null)).toEqual([]);
    expect(findArmBlockers({ nodes: 'not an array' })).toEqual([]);
  });
});

describe('the starter templates against this gate', () => {
  it('⚠️ only the fan-out template is blocked, and only on its deliberate blank', () => {
    const results = DIAGRAM_TEMPLATES.map((t) => ({
      name: t.value.name,
      blockers: findArmBlockers({
        name: t.value.name,
        nodes: t.value.diagram.nodes,
        edges: t.value.diagram.edges,
      }),
    }));

    const blocked = results.filter((r) => r.blockers.length > 0);
    expect(blocked.map((b) => b.name)).toEqual(['תזכורת שבועית למי שטרם ענה']);
    // ⚠️ NAMES THE NEXT ACTION, not just the field. An owner who loaded this
    // template cannot act on "targetWorkflowId is empty" — the workflow it must
    // point at does not exist yet, and nothing on screen says so.
    expect(blocked[0]!.blockers).toEqual([
      'הצעד "לכל אורח שטרם ענה": לא נבחר תהליך להרצה. צרו את תהליך-הבן (למשל מהתבנית "תזכורת לאורח אחד") והדביקו את המזהה שלו כאן.',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------
//
// ⚠️ WHAT WENT WRONG, so it is written down where the next person will look.
//
// The first version of `arm-check.ts` read `PALETTE_ITEMS` from `./schemas`.
// `schemas.ts` imports runtime values from `@workflowbuilder/sdk` and is reached
// from a `'use client'` editor, so Next compiles it into the CLIENT graph. On the
// server the import does not yield the array — it yields a client REFERENCE:
//
//   registerClientReference(function(){ throw Error("Attempted to call
//     PALETTE_ITEMS() from the server but PALETTE_ITEMS is on the client…") })
//
// Every attempt to arm a workflow 500'd in production. `tsc` passed (the import
// is correctly typed), this suite passed (vitest does no Next bundling), and the
// dependency gate only cruised the worker. A `.dependency-cruiser` rule now
// covers the server path and fails on the import itself — that is the real
// protection. This test pins the DATA half of the same fix.

describe('the declarations the gate reads', () => {
  it('⚠️ cover every node type in the catalogue', async () => {
    // A node type with no entry silently requires nothing, so a missing target
    // or cap would arm cleanly again. The map is exhaustive by its
    // `Record<KalfaNodeType, …>` type — this pins it at runtime too, for the
    // types that arrive as strings out of stored JSON.
    const { NODE_REQUIRED_FIELDS } = await import('./types');
    const { NODE_TYPES } = await import('./types');

    for (const type of NODE_TYPES) {
      expect(NODE_REQUIRED_FIELDS[type], type).toBeDefined();
      // Every node is at minimum named and described — the two fields the editor
      // form shows for all of them.
      expect(NODE_REQUIRED_FIELDS[type]).toEqual(
        expect.arrayContaining(['label', 'description']),
      );
    }
  });

  it('⚠️ are the SAME objects the editor form is built from', async () => {
    // Not "equal to" — the SAME array. `schemas.ts` references these rather than
    // declaring its own copy, so a field required to arm is required in the form
    // by construction. An `toEqual` here would still pass if someone pasted a
    // second literal; identity will not.
    const { NODE_REQUIRED_FIELDS } = await import('./types');
    const { PALETTE_ITEMS } = await import('./schemas');

    for (const item of PALETTE_ITEMS) {
      // `PaletteItem.type` is a plain string in the SDK; the map is keyed by our
      // own union. `isKnownNodeType` is the narrowing the rest of the code uses,
      // so the test asserts through the same door rather than casting past it.
      expect(isKnownNodeType(item.type), item.type).toBe(true);
      if (!isKnownNodeType(item.type)) continue;
      expect(item.schema.required, item.type).toBe(NODE_REQUIRED_FIELDS[item.type]);
    }
  });
});
