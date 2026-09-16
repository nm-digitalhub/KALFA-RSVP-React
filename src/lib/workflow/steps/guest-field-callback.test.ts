import { describe, expect, it, vi } from 'vitest';

import { ACTION_BRANCH_HANDLES } from '@/lib/workflow/catalogue/types';
import type { GuestActionsPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.set_guest_field` and `action.create_callback_request`.
//
// Both write, and the two failure shapes they must NOT confuse are the point:
// a shared phone is "nothing unambiguous to do" (a completed step), while a
// second callback row is a second phone call to a real person (never allowed to
// happen twice).

type Guests = Partial<GuestActionsPort>;

function ctxWith(guests: Guests) {
  return {
    runId: 'run-1',
    workflowId: 'wf-self',
    nodeId: 'node-1',
    trigger: {
      eventId: 'e1',
      contactId: 'c1',
      message_text: 'בלי גלוטן בבקשה',
      button_payload: '',
    },
    deps: {
      guests: guests as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {
        post: async () => {
          throw new Error('these nodes must not make a request');
        },
      },
      integrations: {} as StepContext['deps']['integrations'],
    },
  } satisfies StepContext;
}

// ── action.set_guest_field ──────────────────────────────────────────────────

const setField = STEP_HANDLERS['action.set_guest_field'];

describe('action.set_guest_field', () => {
  it('writes the chosen field with the resolved value', async () => {
    const setGuestField = vi.fn<NonNullable<GuestActionsPort['setGuestField']>>(
      async () => ({ ok: true, guestId: 'g1' }),
    );
    const r = await setField(
      { field: 'meal_pref', value: 'בלי גלוטן' },
      ctxWith({ setGuestField }),
    );
    expect(setGuestField).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e1', contactId: 'c1', field: 'meal_pref', value: 'בלי גלוטן' }),
    );
    expect(r.output).toMatchObject({ updated: true, field: 'meal_pref', guestId: 'g1' });
  });

  it('a shared phone is a COMPLETED step, not a failure', async () => {
    // A phone may back several guests and "whose meal preference?" has no
    // answer. Nothing went wrong — the same refusal update_guest_status makes.
    const r = await setField(
      { field: 'meal_pref', value: 'x' },
      ctxWith({
        setGuestField: async () => ({ ok: false, reason: 'multiple_guests_for_contact' }),
      }),
    );
    expect(r.nextPort).toBeUndefined();
    expect(r.output).toMatchObject({ updated: false, skipped: true, reason: 'multiple_guests_for_contact' });
  });

  it('refuses a field that is not in the closed list', async () => {
    // `status` and the headcount columns belong to submit_rsvp. A diagram naming
    // one must fail permanently rather than be retried three times.
    const setGuestField = vi.fn();
    await expect(
      setField({ field: 'status', value: 'attending' }, ctxWith({ setGuestField })),
    ).rejects.toThrow(/לא חוקי/);
    expect(setGuestField).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the port predates the node', async () => {
    // Reporting a write that never happened as success is the one outcome that
    // must not be possible.
    await expect(setField({ field: 'note', value: 'x' }, ctxWith({}))).rejects.toThrow(
      /אינו זמין/,
    );
  });

  it('passes an empty value through — clearing is a real instruction', async () => {
    const setGuestField = vi.fn<NonNullable<GuestActionsPort['setGuestField']>>(
      async () => ({ ok: true, guestId: 'g1' }),
    );
    await setField({ field: 'note', value: '' }, ctxWith({ setGuestField }));
    expect(setGuestField.mock.calls[0][0].value).toBe('');
  });
});

// ── action.create_callback_request ──────────────────────────────────────────

const callback = STEP_HANDLERS['action.create_callback_request'];

describe('action.create_callback_request', () => {
  it('creates the request with the topic and note', async () => {
    const createCallbackRequest = vi.fn<
      NonNullable<GuestActionsPort['createCallbackRequest']>
    >(async () => ({ ok: true, created: true }));
    const r = await callback(
      { topic: 'שאלה על התפריט', note: 'רוצה לדבר' },
      ctxWith({ createCallbackRequest }),
    );
    expect(createCallbackRequest).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'שאלה על התפריט', note: 'רוצה לדבר' }),
    );
    expect(r.output).toMatchObject({ created: true });
  });

  it('an existing open request is a SUCCESS, not the error branch', async () => {
    // This is the dedupe working. Routing it to the error branch would send a
    // workflow down a failure path because the system behaved correctly.
    const r = await callback(
      { topic: 't', note: '' },
      ctxWith({ createCallbackRequest: async () => ({ ok: true, created: false }) }),
    );
    expect(r.nextPort).toBeUndefined();
    expect(r.output).toMatchObject({ created: false, skipped: true, reason: 'already_open' });
  });

  it('a real failure DOES take the error branch', async () => {
    const r = await callback(
      { topic: 't', note: '' },
      ctxWith({
        createCallbackRequest: async () => ({ ok: false, created: false, reason: 'no_phone' }),
      }),
    );
    expect(r.nextPort).toBe(ACTION_BRANCH_HANDLES.error);
    expect(r.output).toMatchObject({ created: false, reason: 'no_phone' });
  });

  it('an empty topic gets a default rather than an empty column', async () => {
    // `topic` is what a human reads when they pick the callback up. Blank is
    // worse than generic.
    const createCallbackRequest = vi.fn<
      NonNullable<GuestActionsPort['createCallbackRequest']>
    >(async () => ({ ok: true, created: true }));
    await callback({ topic: '   ', note: '' }, ctxWith({ createCallbackRequest }));
    expect(createCallbackRequest.mock.calls[0][0].topic).not.toBe('');
  });

  it('fails CLOSED when the port predates the node', async () => {
    await expect(callback({ topic: 't', note: '' }, ctxWith({}))).rejects.toThrow(
      /אינה זמינה/,
    );
  });
});
