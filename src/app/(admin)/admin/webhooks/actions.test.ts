import { beforeEach, describe, expect, it, vi } from 'vitest';

// Re-queueing a webhook re-runs RSVP writes and billing, so the manage_settings gate runs BEFORE the id is even looked
// at (an action-level use() middleware); a malformed id writes nothing; a failed update keeps its fixed message.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { permMock, eqMock, logMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  eqMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ update: () => ({ eq: eqMock }) }) }),
}));

import { reprocessWebhookEventAction } from './actions';

const ID = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  permMock.mockReset().mockResolvedValue({ id: 'staff-1' });
  eqMock.mockReset().mockResolvedValue({ error: null });
  logMock.mockReset();
});

describe('reprocessWebhookEventAction', () => {
  it('demands manage_settings before the id is looked at', async () => {
    permMock.mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/login;307;' }),
    );

    await expect(reprocessWebhookEventAction(fd({ id: 'x' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(permMock).toHaveBeenCalledWith('manage_settings');
    expect(eqMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed id in Hebrew and writes nothing', async () => {
    const result = await reprocessWebhookEventAction(fd({ id: 'x' }));

    expect(result.validationErrors?.fieldErrors?.id).toEqual(['מזהה אירוע לא תקין']);
    expect(eqMock).not.toHaveBeenCalled();
  });

  it('re-queues the row and records the id only', async () => {
    const result = await reprocessWebhookEventAction(fd({ id: ID }));

    expect(eqMock).toHaveBeenCalledWith('id', ID);
    expect(logMock).toHaveBeenCalledWith({ action: 'webhook.reprocess', meta: { webhookId: ID } });
    expect(result).toEqual({});
  });

  it('keeps its fixed message when the update fails', async () => {
    eqMock.mockResolvedValue({ error: { message: 'boom' } });

    expect(await reprocessWebhookEventAction(fd({ id: ID }))).toEqual({ serverError: 'עיבוד מחדש של האירוע נכשל' });
    expect(logMock).not.toHaveBeenCalled();
  });
});
