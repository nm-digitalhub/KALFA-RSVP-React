import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/console-queues', () => ({ setQueueActive: vi.fn(), syncQueueMembers: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { setQueueActive, syncQueueMembers } from '@/lib/data/console-queues';
import { actionErrorMessage } from '@/lib/action-result';
import { toggleQueueActiveAction, updateQueueMembersAction } from './actions';

// Queue activation and membership are staff decisions (manage_voice). The gate runs BEFORE the form is read, so a
// refused caller is sent away whatever it posted, and every invalid field answers with the one form-level message.

const QUEUE = '11111111-1111-4111-8111-111111111111';
const AGENT_A = '22222222-2222-4222-8222-222222222222';
const AGENT_B = '33333333-3333-4333-8333-333333333333';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
});

function fd(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

// Reset, not just clear: a test that makes the gate or a write fail must not leak that into the next one. A reset
// requirePlatformPermission resolves (to undefined), which is all the actions need from it.
beforeEach(() => vi.resetAllMocks());

describe('toggleQueueActiveAction', () => {
  it('activates a queue on a checked box, audits it, and refreshes the page', async () => {
    const result = await toggleQueueActiveAction({}, fd([['queue_id', QUEUE], ['is_active', 'on']]));

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    expect(setQueueActive).toHaveBeenCalledWith(QUEUE, true);
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.voice.queue_toggle',
      meta: { queue_id: QUEUE, is_active: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/voice/queues');
    expect(result).toEqual({ data: { notice: 'המחלקה הופעלה.' } });
  });

  it('an absent checkbox deactivates', async () => {
    const result = await toggleQueueActiveAction({}, fd([['queue_id', QUEUE]]));

    expect(setQueueActive).toHaveBeenCalledWith(QUEUE, false);
    expect(result).toEqual({ data: { notice: 'המחלקה הושבתה.' } });
  });

  it.each([undefined, '', 'not-a-uuid'])(
    'refuses the queue id %j with the form-level message, writing nothing',
    async (queueId) => {
      const result = await toggleQueueActiveAction({}, fd(queueId === undefined ? [] : [['queue_id', queueId]]));

      expect(actionErrorMessage(result)).toBe('קלט לא תקין.');
      expect(setQueueActive).not.toHaveBeenCalled();
    },
  );

  it('runs the staff gate BEFORE validating: a refused caller is redirected even with invalid input', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValue(NEXT_REDIRECT);

    await expect(toggleQueueActiveAction({}, fd([['queue_id', 'not-a-uuid']]))).rejects.toBe(NEXT_REDIRECT);
    expect(setQueueActive).not.toHaveBeenCalled();
  });

  it('a write failure becomes the fixed message', async () => {
    vi.mocked(setQueueActive).mockRejectedValue(new Error('db down'));

    const result = await toggleQueueActiveAction({}, fd([['queue_id', QUEUE], ['is_active', 'on']]));

    expect(result).toEqual({ serverError: 'העדכון נכשל. נסו שוב.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateQueueMembersAction', () => {
  it('syncs every checked agent and audits the count', async () => {
    const result = await updateQueueMembersAction(
      {},
      fd([['queue_id', QUEUE], ['agent_id', AGENT_A], ['agent_id', AGENT_B]]),
    );

    expect(syncQueueMembers).toHaveBeenCalledWith(QUEUE, [AGENT_A, AGENT_B]);
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.voice.queue_members_update',
      meta: { queue_id: QUEUE, agent_count: 2 },
    });
    expect(result).toEqual({ data: { notice: 'חברי המחלקה עודכנו.' } });
  });

  it('one checked agent is still a list, and none checked empties the queue', async () => {
    await updateQueueMembersAction({}, fd([['queue_id', QUEUE], ['agent_id', AGENT_A]]));
    expect(syncQueueMembers).toHaveBeenLastCalledWith(QUEUE, [AGENT_A]);

    await updateQueueMembersAction({}, fd([['queue_id', QUEUE]]));
    expect(syncQueueMembers).toHaveBeenLastCalledWith(QUEUE, []);
  });

  it('refuses an invalid agent id with the form-level message — not an empty, silent result', async () => {
    const result = await updateQueueMembersAction(
      {},
      fd([['queue_id', QUEUE], ['agent_id', AGENT_A], ['agent_id', 'not-a-uuid']]),
    );

    expect(actionErrorMessage(result)).toBe('קלט לא תקין.');
    expect(syncQueueMembers).not.toHaveBeenCalled();
  });

  it('runs the staff gate BEFORE validating', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateQueueMembersAction({}, fd([['agent_id', 'x']]))).rejects.toBe(NEXT_REDIRECT);
    expect(syncQueueMembers).not.toHaveBeenCalled();
  });

  it('a write failure becomes the fixed message', async () => {
    vi.mocked(syncQueueMembers).mockRejectedValue(new Error('db down'));

    const result = await updateQueueMembersAction({}, fd([['queue_id', QUEUE]]));

    expect(result).toEqual({ serverError: 'עדכון החברים נכשל. נסו שוב.' });
  });
});
