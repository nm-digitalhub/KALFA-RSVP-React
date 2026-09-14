import { describe, expect, it, vi } from 'vitest';

import { ACTION_BRANCH_HANDLES } from '@/lib/workflow/catalogue/types';
import type { GuestActionsPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.import_guest_list` — the step that made guest import a FLOW.
//
// Two properties this file exists to hold:
//
//   1. It runs in a run with NO CONTACT. The sender is the owner, not a guest,
//      so it must not go through `requireGuestContext` the way every other
//      writing node does — and it must still refuse when there is no event or no
//      message to read.
//   2. ALREADY STAGED IS SUCCESS. The hard-coded import path still runs beside
//      this one; whichever wins the race stages, and the loser must report the
//      same review link rather than taking the error branch because the system
//      behaved correctly.

const handler = STEP_HANDLERS['action.import_guest_list'];

type Guests = Partial<GuestActionsPort>;

/** A run started by an owner sending a list: an event, an inbox row, NO contact. */
function ownerCtx(guests: Guests, trigger: Partial<StepContext['trigger']> = {}) {
  return {
    runId: 'run-1',
    workflowId: 'wf-self',
    nodeId: 'node-1',
    trigger: {
      eventId: 'e1',
      inboxRowId: 'inbox-9',
      message_text: '',
      button_payload: '',
      ...trigger,
    },
    deps: {
      guests: guests as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {
        post: async () => {
          throw new Error('this node must not make a request');
        },
      },
    },
  } satisfies StepContext;
}

const ROWS = [
  { full_name: 'משפחת כהן', phone: '0501234567', expected_count: 4, group: 'משפחה' },
  { full_name: 'דנה לוי', phone: null, expected_count: null, group: '' },
];

const OK = {
  ok: true as const,
  created: true,
  rows: ROWS,
  rowCount: 2,
  errorCount: 1,
  fileName: 'guests.csv',
  reviewUrl: 'https://example.com/app/events/e1/guests/import?source=whatsapp',
};

describe('action.import_guest_list', () => {
  it('stages the list and reports what an owner needs to act', async () => {
    const importGuestList = vi.fn<NonNullable<GuestActionsPort['importGuestList']>>(
      async () => OK,
    );
    const r = await handler({}, ownerCtx({ importGuestList }));

    expect(importGuestList).toHaveBeenCalledWith({ inboxRowId: 'inbox-9', eventId: 'e1' });
    expect(r.output).toMatchObject({
      staged: true,
      created: true,
      rowCount: 2,
      errorCount: 1,
      fileName: 'guests.csv',
      reviewUrl: OK.reviewUrl,
    });
    expect(r.nextPort).toBeUndefined();
  });

  it('⚠️ the output carries THE ROWS — the run log is the record of what arrived', async () => {
    // OWNER RULING 2026-09-13. They were withheld at first, on the argument that
    // a node output is a second copy. It is not a second copy that outlives the
    // first: `guest_import_staging` is a WORK QUEUE and is wiped the moment the
    // owner confirms or discards, so without this nothing anywhere would say
    // what a list contained. A later step can also act on it —
    // `{{nodes.<id>.rows}}` — which is what makes the import a flow rather than
    // a black box that reports a number.
    const r = await handler({}, ownerCtx({ importGuestList: async () => OK }));
    expect((r.output as { rows: unknown }).rows).toEqual(ROWS);
  });

  it('ALREADY STAGED is success, not the error branch', async () => {
    // The hard-coded import path still runs beside this one. When it wins the
    // race, nothing went wrong — and routing the workflow down a failure path
    // because the system behaved correctly is the bug this pins.
    const r = await handler(
      {},
      ownerCtx({ importGuestList: async () => ({ ...OK, created: false }) }),
    );
    expect(r.nextPort).toBeUndefined();
    expect(r.output).toMatchObject({ staged: true, created: false });
  });

  it('a real failure DOES take the error branch, with a reason', async () => {
    const r = await handler(
      {},
      ownerCtx({
        importGuestList: async () => ({ ok: false, reason: 'bad_file', message: 'חסרה עמודת שם' }),
      }),
    );
    expect(r.nextPort).toBe(ACTION_BRANCH_HANDLES.error);
    expect(r.output).toMatchObject({ staged: false, reason: 'bad_file', message: 'חסרה עמודת שם' });
  });

  it('runs WITHOUT a contact — the sender is the owner, not a guest', async () => {
    // The property that separates this from every other writing node. Going
    // through `requireGuestContext` would make it permanently unusable in the
    // only kind of run it belongs to.
    const importGuestList = vi.fn<NonNullable<GuestActionsPort['importGuestList']>>(
      async () => OK,
    );
    const ctx = ownerCtx({ importGuestList });
    expect(ctx.trigger.contactId).toBeUndefined();
    await expect(handler({}, ctx)).resolves.toBeTruthy();
  });

  it('refuses a run with no inbox row — there is no list to read', async () => {
    // A webhook-started run has an event but no message. Failing PERMANENTLY is
    // right: no retry will attach a file to a run that never had one.
    await expect(
      handler({}, ownerCtx({ importGuestList: async () => OK }, { inboxRowId: undefined })),
    ).rejects.toThrow(/קובץ|אנשי קשר/);
  });

  it('refuses a run with no event — there is nowhere to stage', async () => {
    await expect(
      handler({}, ownerCtx({ importGuestList: async () => OK }, { eventId: undefined })),
    ).rejects.toThrow(/קובץ|אנשי קשר/);
  });

  it('fails CLOSED when the port predates the node', async () => {
    // Reporting a staging that never happened as success is the one outcome that
    // must not be possible — an owner would wait for a review link forever.
    await expect(handler({}, ownerCtx({}))).rejects.toThrow(/אינה זמינה/);
  });
});
