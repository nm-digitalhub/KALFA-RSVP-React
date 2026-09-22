import { describe, expect, it, vi } from 'vitest';

import type { GuestActionsPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.start_voice_call` — the node that makes a NEW voice agent usable
// without a new dispatcher.
//
// ⚠️ WHAT A REFUSAL MEANS HERE, and why almost nothing throws. An agent switched
// off, a guest on the DNC list, a dial outside the permitted hours, Shabbat, no
// balance — in every one of those the rules worked exactly as written. Routing
// them to the error branch would send a workflow down a failure path BECAUSE the
// system behaved correctly. Only a misconfigured STEP throws.

const handler = STEP_HANDLERS['action.start_voice_call'];

function ctx(
  dial?: GuestActionsPort['startVoicePurposeCall'],
  trigger: Partial<StepContext['trigger']> = {},
) {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '', ...trigger },
    deps: {
      guests: { startVoicePurposeCall: dial } as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {} as StepContext['deps']['webhook'],
      integrations: {} as StepContext['deps']['integrations'],
      accounting: {} as StepContext['deps']['accounting'],
    },
  } satisfies StepContext;
}

describe('action.start_voice_call', () => {
  it('dials the chosen purpose for this run’s guest', async () => {
    const dial = vi.fn<NonNullable<GuestActionsPort['startVoicePurposeCall']>>(async () => ({
      ok: true,
      status: 'dialed',
      attemptId: 'a1',
    }));

    const r = await handler({ purposeKey: 'feedback' }, ctx(dial));

    expect(dial).toHaveBeenCalledWith({
      runId: 'run-1',
      nodeId: 'node-1',
      eventId: 'e1',
      contactId: 'c1',
      purposeKey: 'feedback',
    });
    expect(r.output).toMatchObject({ dialed: true, status: 'dialed', attemptId: 'a1' });
  });

  it('⚠️ passes the RUN and NODE, which are the replay guard', async () => {
    // `voice_purpose_attempts_step_uidx` is unique on (run_id, node_id,
    // contact_id). Drop either from the call and a replayed step — which the
    // step lease can cause — telephones the same person a second time.
    const dial = vi.fn<NonNullable<GuestActionsPort['startVoicePurposeCall']>>(async () => ({
      ok: true,
      status: 'dialed',
    }));
    await handler({ purposeKey: 'feedback' }, ctx(dial));
    const arg = dial.mock.calls[0]![0];
    expect(arg.runId).toBe('run-1');
    expect(arg.nodeId).toBe('node-1');
  });

  it('⚠️ a REFUSED dial is a completed step, not the error branch', async () => {
    for (const reason of ['purpose_disabled', 'dnc', 'shabbat', 'balance_below_reserve']) {
      const r = await handler(
        { purposeKey: 'feedback' },
        ctx(async () => ({ ok: false, status: 'skipped', reason })),
      );
      expect(r.nextPort).toBeUndefined();
      expect(r.output).toMatchObject({ dialed: false, reason });
    }
  });

  it('refuses a step with no purpose chosen', async () => {
    const dial = vi.fn<NonNullable<GuestActionsPort['startVoicePurposeCall']>>(async () => ({
      ok: true,
      status: 'dialed',
    }));
    await expect(handler({}, ctx(dial))).rejects.toThrow(/ייעוד/);
    await expect(handler({ purposeKey: '   ' }, ctx(dial))).rejects.toThrow(/ייעוד/);
    expect(dial).not.toHaveBeenCalled();
  });

  it('⚠️ fails CLOSED when the port predates the node', async () => {
    // Reporting a call that never happened as success is the outcome that must
    // not be possible — an owner would believe their guests were telephoned.
    await expect(handler({ purposeKey: 'feedback' }, ctx(undefined))).rejects.toThrow(/אינה זמינה/);
  });

  it('requires a guest — there is nobody to call without one', async () => {
    const dial = vi.fn<NonNullable<GuestActionsPort['startVoicePurposeCall']>>(async () => ({
      ok: true,
      status: 'dialed',
    }));
    await expect(handler({ purposeKey: 'feedback' }, ctx(dial, { contactId: undefined }))).rejects.toThrow(/אורח/);
  });
});
