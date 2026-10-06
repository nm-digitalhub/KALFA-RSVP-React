// The gate on the door this module opened.
//
// `startManualRun` is the first way to create a `workflow_runs` row that is not
// an inbound guest message, and the run it creates executes with the REAL ports
// — a `send_whatsapp` node sends, a `start_rsvp_ai_callback` node dials. So the
// two refusals that keep it pointed at the right person are worth a test each,
// and so is the one that keeps the payload shape identical to the inbound path.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn() }));
vi.mock('./enqueue', () => ({ enqueueWorkflowRun: vi.fn() }));
vi.mock('./store', () => ({ loadWorkflowForRun: vi.fn(), createRunIfNew: vi.fn() }));
vi.mock('./inbound', () => ({ resolveTriggerContext: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';

import { enqueueWorkflowRun } from './enqueue';
import { resolveTriggerContext } from './inbound';
import { startManualRun } from './manual-run';
import { createRunIfNew, loadWorkflowForRun } from './store';

const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const WORKFLOW = '44444444-4444-4444-8444-444444444444';

/** A stored diagram with exactly one trigger node, which is all `findTriggerNode` needs. */
const DIAGRAM = {
  name: 'w',
  layoutDirection: 'RIGHT',
  nodes: [
    {
      id: 'trigger',
      type: 'start-node',
      position: { x: 0, y: 0 },
      data: {
        segments: [],
        type: 'trigger.whatsapp_inbound',
        icon: 'WhatsappLogo',
        properties: { label: 'טריגר', description: 'ד', keyword: '' },
      },
    },
  ],
  edges: [],
};

function mockContactRow(eventId: string | null) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: eventId === null ? null : { event_id: eventId }, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
}

function baseInput() {
  return { workflowId: WORKFLOW, eventId: EVENT, contactId: CONTACT };
}

describe('startManualRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorkflowForRun).mockResolvedValue({
      id: WORKFLOW,
      eventId: null,
      definition: DIAGRAM,
    });
    vi.mocked(resolveTriggerContext).mockResolvedValue({});
    vi.mocked(createRunIfNew).mockResolvedValue('run-1');
    mockContactRow(EVENT);
  });

  it('creates a run and hands it to the worker', async () => {
    const result = await startManualRun(baseInput());

    expect(result).toEqual({ ok: true, runId: 'run-1' });
    expect(enqueueWorkflowRun).toHaveBeenCalledWith(undefined, 'run-1');
  });

  it('records the run as manual, with no dedupe key', async () => {
    await startManualRun(baseInput());

    const planned = vi.mocked(createRunIfNew).mock.calls[0]![0]!;
    expect(planned.triggerSource).toBe('manual');
    // Null on purpose: asking twice is two runs. Anything else would make the
    // second attempt after an edit silently return the first run's id.
    expect(planned.dedupeKey).toBeNull();
  });

  it('REFUSES a contact that belongs to another event', async () => {
    // The security assertion. Without it a crafted request could run a workflow
    // against a contact from an event the admin was not looking at, and the
    // first node that dials would call a stranger.
    mockContactRow(OTHER_EVENT);

    const result = await startManualRun(baseInput());

    expect(result).toEqual({ ok: false, reason: 'contact_not_in_event' });
    expect(createRunIfNew).not.toHaveBeenCalled();
    expect(enqueueWorkflowRun).not.toHaveBeenCalled();
  });

  it('refuses a contact that does not exist', async () => {
    mockContactRow(null);

    expect(await startManualRun(baseInput())).toEqual({
      ok: false,
      reason: 'contact_not_in_event',
    });
    expect(enqueueWorkflowRun).not.toHaveBeenCalled();
  });

  it('refuses a workflow pinned to a different event', async () => {
    vi.mocked(loadWorkflowForRun).mockResolvedValue({
      id: WORKFLOW,
      eventId: OTHER_EVENT,
      definition: DIAGRAM,
    });

    expect(await startManualRun(baseInput())).toEqual({
      ok: false,
      reason: 'workflow_scoped_to_other_event',
    });
    expect(createRunIfNew).not.toHaveBeenCalled();
  });

  it('runs a workflow pinned to THIS event', async () => {
    vi.mocked(loadWorkflowForRun).mockResolvedValue({
      id: WORKFLOW,
      eventId: EVENT,
      definition: DIAGRAM,
    });

    expect(await startManualRun(baseInput())).toEqual({ ok: true, runId: 'run-1' });
  });

  it('refuses a diagram without exactly one trigger node', async () => {
    vi.mocked(loadWorkflowForRun).mockResolvedValue({
      id: WORKFLOW,
      eventId: null,
      definition: { ...DIAGRAM, nodes: [] },
    });

    expect(await startManualRun(baseInput())).toEqual({ ok: false, reason: 'no_trigger_node' });
  });

  it('refuses a workflow that does not exist', async () => {
    vi.mocked(loadWorkflowForRun).mockResolvedValue(undefined);

    expect(await startManualRun(baseInput())).toEqual({ ok: false, reason: 'workflow_not_found' });
  });

  it('does NOT require the workflow to be armed', async () => {
    // `loadWorkflowForRun` has no `is_active` filter, unlike `listArmedWorkflows`.
    // Arming decides whether a GUEST may start a workflow; an admin asking is the
    // trigger. This asserts the loader is the unfiltered one.
    await startManualRun(baseInput());
    expect(loadWorkflowForRun).toHaveBeenCalledWith(WORKFLOW);
  });

  describe('the payload it freezes', () => {
    it('carries the stand-in message and button so a keyworded workflow behaves the same', async () => {
      await startManualRun({ ...baseInput(), messageText: 'כן', buttonPayload: 'yes_btn' });

      const planned = vi.mocked(createRunIfNew).mock.calls[0]![0]!;
      expect(planned.triggerPayload).toMatchObject({
        eventId: EVENT,
        contactId: CONTACT,
        message_text: 'כן',
        button_payload: 'yes_btn',
      });
    });

    it('OMITS unresolved context rather than emptying it', async () => {
      // The `| default:'…'` trap. A key present as '' or null is a REAL value to
      // the template resolver, so the fallback never fires and the guest is
      // greeted by an empty string.
      vi.mocked(resolveTriggerContext).mockResolvedValue({ eventName: 'חתונה' });

      await startManualRun(baseInput());

      const payload = vi.mocked(createRunIfNew).mock.calls[0]![0]!.triggerPayload;
      expect(payload.event_name).toBe('חתונה');
      expect('guest_name' in payload).toBe(false);
      expect('event_date' in payload).toBe(false);
    });
  });
});
