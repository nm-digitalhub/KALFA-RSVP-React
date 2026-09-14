import { describe, expect, it, vi } from 'vitest';

import { ACTION_BRANCH_HANDLES } from '@/lib/workflow/catalogue/types';
import type { GuestActionsPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.start_for_each_guest` and `action.send_template`.
//
// ⚠️ THE FAN-OUT IS THE MOST DANGEROUS NODE IN THE PALETTE. One press starts a
// run per guest, and each of those can reach a real person. Most of this file is
// about the ceilings and about what happens when the config is wrong — because a
// node whose blast radius depends on an unvalidated jsonb field is a node whose
// blast radius nobody chose.

const fanOut = STEP_HANDLERS['action.start_for_each_guest'];
const sendTemplate = STEP_HANDLERS['action.send_template'];

function ctx(guests: Partial<GuestActionsPort>, trigger: Partial<StepContext['trigger']> = {}) {
  return {
    runId: 'run-1',
    workflowId: 'wf-self',
    nodeId: 'node-1',
    trigger: {
      eventId: 'e1',
      contactId: 'c1',
      message_text: '',
      button_payload: '',
      ...trigger,
    },
    deps: {
      guests: guests as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {
        post: async () => {
          throw new Error('these nodes must not make a request');
        },
      },
    },
  } satisfies StepContext;
}

const OK = { ok: true as const, matched: 10, started: 10, capped: false };

describe('action.start_for_each_guest', () => {
  it('starts a run per guest and reports the counts', async () => {
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    const r = await fanOut(
      { targetWorkflowId: 'wf-child', maxGuests: 25 },
      ctx({ startRunsForGuests }),
    );

    expect(startRunsForGuests).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: 'run-1',
        nodeId: 'node-1',
        eventId: 'e1',
        targetWorkflowId: 'wf-child',
        maxGuests: 25,
      }),
    );
    expect(r.output).toMatchObject({ started: 10, matched: 10, capped: false });
  });

  it('⚠️ REFUSES when no ceiling is set', async () => {
    // THE GUARD THIS NODE EXISTS BEHIND. A missing cap must never read as "no
    // limit" — that is the one interpretation that reaches everybody.
    for (const config of [
      { targetWorkflowId: 'wf-child' },
      { targetWorkflowId: 'wf-child', maxGuests: 0 },
      { targetWorkflowId: 'wf-child', maxGuests: -5 },
      { targetWorkflowId: 'wf-child', maxGuests: 'lots' },
    ]) {
      const startRunsForGuests = vi.fn();
      await expect(fanOut(config, ctx({ startRunsForGuests }))).rejects.toThrow(/תקרה/);
      expect(startRunsForGuests).not.toHaveBeenCalled();
    }
  });

  it('reports capping — "everyone got one" and "the first 25 did" are different facts', async () => {
    const r = await fanOut(
      { targetWorkflowId: 'wf-child', maxGuests: 25 },
      ctx({ startRunsForGuests: async () => ({ ...OK, matched: 300, started: 25, capped: true }) }),
    );
    expect(r.output).toMatchObject({ started: 25, matched: 300, capped: true });
  });

  it('refuses without a target workflow', async () => {
    await expect(
      fanOut({ maxGuests: 25 }, ctx({ startRunsForGuests: async () => OK })),
    ).rejects.toThrow(/תהליך להרצה/);
  });

  it('⚠️ runs on the EVENT, not on a guest', async () => {
    // It must NOT go through `requireGuestContext`: it runs once about a whole
    // list, and the scheduled run it exists for carries no contact at all. The
    // children are what carry one.
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    const scheduled = ctx({ startRunsForGuests }, { contactId: undefined });
    await expect(
      fanOut({ targetWorkflowId: 'wf-child', maxGuests: 25 }, scheduled),
    ).resolves.toBeTruthy();
  });

  it('refuses a run with no event — there is no list to read', async () => {
    await expect(
      fanOut(
        { targetWorkflowId: 'wf-child', maxGuests: 25 },
        ctx({ startRunsForGuests: async () => OK }, { eventId: undefined }),
      ),
    ).rejects.toThrow(/אירוע/);
  });

  it('passes the status filter through, and drops junk', async () => {
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    await fanOut(
      { targetWorkflowId: 'wf-child', maxGuests: 5, statuses: ['attending', 7, null] },
      ctx({ startRunsForGuests }),
    );
    expect(startRunsForGuests.mock.calls[0]![0].statuses).toEqual(['attending']);
  });

  it('defaults to guests WITH a phone', async () => {
    // A run about someone we cannot reach is a job and a log line for nothing.
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    await fanOut({ targetWorkflowId: 'wf-child', maxGuests: 5 }, ctx({ startRunsForGuests }));
    expect(startRunsForGuests.mock.calls[0]![0].requirePhone).toBe(true);

    await fanOut(
      { targetWorkflowId: 'wf-child', maxGuests: 5, requirePhone: false },
      ctx({ startRunsForGuests }),
    );
    expect(startRunsForGuests.mock.calls[1]![0].requirePhone).toBe(false);
  });

  it('a failure takes the error branch', async () => {
    const r = await fanOut(
      { targetWorkflowId: 'wf-child', maxGuests: 5 },
      ctx({ startRunsForGuests: async () => ({ ok: false, reason: 'target_workflow_not_found' }) }),
    );
    expect(r.nextPort).toBe(ACTION_BRANCH_HANDLES.error);
    expect(r.output).toMatchObject({ started: 0, reason: 'target_workflow_not_found' });
  });

  it('fails CLOSED when the port predates the node', async () => {
    await expect(
      fanOut({ targetWorkflowId: 'wf-child', maxGuests: 5 }, ctx({})),
    ).rejects.toThrow(/אינה זמינה/);
  });
});

describe('action.send_template', () => {
  it('sends the chosen template to this run’s guest', async () => {
    const send = vi.fn<NonNullable<GuestActionsPort['sendWhatsAppTemplate']>>(async () => ({
      ok: true,
    }));
    const r = await sendTemplate({ messageKey: 'thankyou' }, ctx({ sendWhatsAppTemplate: send }));

    expect(send).toHaveBeenCalledWith({ eventId: 'e1', contactId: 'c1', messageKey: 'thankyou' });
    expect(r.output).toMatchObject({ sent: true, messageKey: 'thankyou' });
  });

  it('⚠️ a REFUSAL is a completed step, not the error branch', async () => {
    // An opted-out guest, a template not approved for this event type, a
    // household with no phone — in each the rules worked. Routing them to the
    // failure path would send a workflow down an error route because the system
    // behaved correctly.
    for (const reason of ['removal_requested', 'template_not_available', 'no_phone_for_contact']) {
      const r = await sendTemplate(
        { messageKey: 'thankyou' },
        ctx({ sendWhatsAppTemplate: async () => ({ ok: false, reason }) }),
      );
      expect(r.nextPort).toBeUndefined();
      expect(r.output).toMatchObject({ sent: false, skipped: true, reason });
    }
  });

  it('refuses without a template chosen', async () => {
    await expect(
      sendTemplate({}, ctx({ sendWhatsAppTemplate: async () => ({ ok: true }) })),
    ).rejects.toThrow(/תבנית לשליחה/);
  });

  it('⚠️ requires a guest — unlike the fan-out', async () => {
    // This node messages ONE person, so a run with no contact has nobody to send
    // to. The scheduled run that fans out is the one without a contact; its
    // children have one, and that is where this node belongs.
    await expect(
      sendTemplate(
        { messageKey: 'thankyou' },
        ctx({ sendWhatsAppTemplate: async () => ({ ok: true }) }, { contactId: undefined }),
      ),
    ).rejects.toThrow(/אורח/);
  });

  it('fails CLOSED when the port predates the node', async () => {
    // Reporting a send that never happened as success is the outcome that must
    // not be possible — an owner would believe their guests were thanked.
    await expect(sendTemplate({ messageKey: 'thankyou' }, ctx({}))).rejects.toThrow(/אינה זמינה/);
  });
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------
//
// ⚠️ WHAT WAS DOCUMENTED AND NOT IMPLEMENTED UNTIL 2026-09-14. The comment above
// this handler has always said "IT MUST NOT FAN OUT TO ITSELF … Refused
// permanently rather than capped". Nothing checked it, and nothing bounded the
// depth either.
//
// The arithmetic is why it matters. `FAN_OUT_HARD_CAP` bounds the WIDTH of one
// generation, never the number of generations, and the child dedupe key is
// `fanout:${parentRunId}:${nodeId}:${contactId}` — whose parent run id is NEW in
// every generation, so it does not stop the next one. With a cap of 10 that is
// 10 → 100 → 1,000 → 10,000 runs, each leaf able to message a real guest.

describe('the fan-out chain', () => {
  const config = { targetWorkflowId: 'wf-child', maxGuests: 10 };

  it('⚠️ REFUSES to start its own workflow', async () => {
    const startRunsForGuests = vi.fn();
    await expect(
      fanOut({ ...config, targetWorkflowId: 'wf-self' }, ctx({ startRunsForGuests })),
    ).rejects.toThrow(/עצמו/);
    expect(startRunsForGuests).not.toHaveBeenCalled();
  });

  it('tells the port which generation it is creating', async () => {
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    // A run nobody fanned out to is depth 0, so its children are generation 1.
    await fanOut(config, ctx({ startRunsForGuests }));
    expect(startRunsForGuests.mock.calls[0]![0].depth).toBe(1);

    // …and a run that IS a child counts from its own depth.
    await fanOut(config, ctx({ startRunsForGuests }, { fanoutDepth: 2 }));
    expect(startRunsForGuests.mock.calls[1]![0].depth).toBe(3);
  });

  it('⚠️ refuses the generation past the cap — the cycle W1→W2→W1 dies here', async () => {
    // `self` is only the shortest cycle. A ring of two workflows is the same
    // exponential and no single node in it points at its own workflow, so depth
    // is the property that actually bounds the tree.
    const startRunsForGuests = vi.fn();
    await expect(
      fanOut(config, ctx({ startRunsForGuests }, { fanoutDepth: 3 })),
    ).rejects.toThrow(/עומק/);
    expect(startRunsForGuests).not.toHaveBeenCalled();
  });

  it('permits exactly three generations, and no more', async () => {
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    for (const parentDepth of [0, 1, 2]) {
      await expect(
        fanOut(config, ctx({ startRunsForGuests }, { fanoutDepth: parentDepth })),
      ).resolves.toBeTruthy();
    }
    await expect(
      fanOut(config, ctx({ startRunsForGuests }, { fanoutDepth: 3 })),
    ).rejects.toThrow(/עומק/);
  });

  it('a junk depth on the payload does not become an unbounded chain', async () => {
    // `trigger_payload` is jsonb; nothing guarantees a number. A value that is
    // not one must not read as "shallow".
    const startRunsForGuests = vi.fn<NonNullable<GuestActionsPort['startRunsForGuests']>>(
      async () => OK,
    );
    await fanOut(config, ctx({ startRunsForGuests }, { fanoutDepth: 'lots' as unknown as number }));
    expect(startRunsForGuests.mock.calls[0]![0].depth).toBe(1);
  });
});
