import { describe, expect, it, vi } from 'vitest';

import { CALLBACK_TOPICS, SALES_CALLBACK_TOPIC } from '@/lib/workflow/catalogue/types';
import type { GuestActionsPort } from '@/lib/workflow/engine/ports';

import { STEP_HANDLERS, type StepContext } from './index';

// ⚠️ `topic` IS A ROUTER, NOT A LABEL — the whole point of this file.
//
// Traced end to end on 2026-09-14: the node writes `callback_requests.topic`;
// `runCallbackSchedulingSweep` books a slot and then enqueues BOTH voice
// dispatchers; `enqueueSalesCallDispatch` proceeds only on `topic === 'מכירות'`
// and `enqueueMeetingConfirmDispatch` only on anything else; the winner starts a
// Voximplant rule that bridges to an ElevenLabs agent.
//
// This node is guest-scoped — `requireGuestContext`, and the port reads
// `guests.full_name` / `guests.phone` — so 'מכירות' means the sales-closing
// agent ("עומר") telephones a wedding guest to sell them KALFA. As free text
// that was one ordinary Hebrew word away.

const handler = STEP_HANDLERS['action.create_callback_request'];

function ctx(create: GuestActionsPort['createCallbackRequest']) {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    deps: {
      guests: { createCallbackRequest: create } as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {} as StepContext['deps']['webhook'],
      integrations: {} as StepContext['deps']['integrations'],
    },
  } satisfies StepContext;
}


describe('action.create_callback_request — which agent ends up calling', () => {
  it('⚠️ REFUSES the sales topic, and never reaches the queue', async () => {
    const create = vi.fn<NonNullable<GuestActionsPort['createCallbackRequest']>>(async () => ({
      ok: true as const,
      created: true,
    }));
    await expect(
      handler({ topic: SALES_CALLBACK_TOPIC }, ctx(create)),
    ).rejects.toThrow(/סוכן המכירות/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses it with surrounding whitespace too — the row is jsonb', async () => {
    const create = vi.fn<NonNullable<GuestActionsPort['createCallbackRequest']>>(async () => ({
      ok: true as const,
      created: true,
    }));
    await expect(handler({ topic: `  ${SALES_CALLBACK_TOPIC} ` }, ctx(create))).rejects.toThrow(
      /סוכן המכירות/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('passes every offered topic straight through', async () => {
    for (const topic of CALLBACK_TOPICS) {
      const create = vi.fn<NonNullable<GuestActionsPort['createCallbackRequest']>>(async () => ({
      ok: true as const,
      created: true,
    }));
      await expect(handler({ topic }, ctx(create))).resolves.toBeTruthy();
      expect(create.mock.calls[0]![0].topic).toBe(topic);
    }
  });

  it('⚠️ an empty topic falls back to an offered value, not an internal label', async () => {
    // The team reads this column in the callback queue, and the agent is handed
    // it as `{{topic_he}}`. It used to default to 'פנייה מתהליך אוטומטי'.
    const create = vi.fn<NonNullable<GuestActionsPort['createCallbackRequest']>>(async () => ({
      ok: true as const,
      created: true,
    }));
    await handler({ topic: '' }, ctx(create));
    expect(create.mock.calls[0]![0].topic).toBe(CALLBACK_TOPICS[0]);
    expect(CALLBACK_TOPICS).not.toContain(SALES_CALLBACK_TOPIC);
  });

  it('a topic nobody offered is still allowed — the field is not an enum at rest', async () => {
    // Deliberate: only the SALES value is dangerous. An owner with an older saved
    // diagram, or a topic the list does not cover, must not be blocked from a
    // callback that routes to the confirm agent either way.
    const create = vi.fn<NonNullable<GuestActionsPort['createCallbackRequest']>>(async () => ({
      ok: true as const,
      created: true,
    }));
    await expect(handler({ topic: 'נושא משלי' }, ctx(create))).resolves.toBeTruthy();
    expect(create.mock.calls[0]![0].topic).toBe('נושא משלי');
  });
});
