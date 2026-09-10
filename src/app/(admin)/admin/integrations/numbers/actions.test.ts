import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { assignMock, clearMock, syncMetaMock, syncVoxMock, logMock, revalidateMock } =
  vi.hoisted(() => ({
    assignMock: vi.fn(),
    clearMock: vi.fn(),
    syncMetaMock: vi.fn(),
    syncVoxMock: vi.fn(),
    logMock: vi.fn(),
    revalidateMock: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));
vi.mock('@/lib/data/admin/integrations/provider-numbers', () => ({
  assignRole: assignMock,
  clearRole: clearMock,
  syncMetaNumbers: syncMetaMock,
  syncVoximplantNumbers: syncVoxMock,
}));

import {
  assignRoleAction,
  syncMetaNumbersAction,
  syncVoximplantNumbersAction,
} from './actions';

const NUMBER_ID = '11111111-1111-4111-8111-111111111111';

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
});

describe('assignRoleAction', () => {
  it('assigns a role to a number', async () => {
    assignMock.mockResolvedValue(undefined);
    const state = await assignRoleAction(
      form({ role: 'whatsapp_import_sender', numberId: NUMBER_ID }),
    );
    expect(assignMock).toHaveBeenCalledWith('whatsapp_import_sender', NUMBER_ID);
    expect(state).toEqual({ notice: 'השיוך נשמר' });
  });

  it('treats an EMPTY select as "nobody", not as an invalid id', async () => {
    // The two are different things: one is a choice, the other a bug in the form.
    clearMock.mockResolvedValue(undefined);
    const state = await assignRoleAction(form({ role: 'sms_sender', numberId: '' }));
    expect(clearMock).toHaveBeenCalledWith('sms_sender');
    expect(assignMock).not.toHaveBeenCalled();
    expect(state).toEqual({ notice: 'השיוך בוטל' });
  });

  it('refuses a role that is not in the database vocabulary', async () => {
    const state = await assignRoleAction(form({ role: 'not_a_role', numberId: NUMBER_ID }));
    expect(state).toEqual({ error: 'תפקיד לא מוכר' });
    expect(assignMock).not.toHaveBeenCalled();
    expect(clearMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed number id without calling the DAL', async () => {
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: 'not-a-uuid' }),
    );
    expect(state).toEqual({ error: 'מזהה מספר לא תקין' });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('passes through the one failure a caller can act on', async () => {
    assignMock.mockRejectedValue(new Error('המספר שנבחר אינו קיים'));
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: NUMBER_ID }),
    );
    expect(state).toEqual({ error: 'המספר שנבחר אינו קיים' });
  });

  it('does not leak an internal error message to the form', async () => {
    assignMock.mockRejectedValue(new Error('permission denied for table provider_numbers'));
    const state = await assignRoleAction(
      form({ role: 'sms_sender', numberId: NUMBER_ID }),
    );
    expect(state).toEqual({ error: 'שמירת השיוך נכשלה' });
  });

  it('refreshes the webhook inbox too — it names the number from these rows', async () => {
    assignMock.mockResolvedValue(undefined);
    await assignRoleAction(form({ role: 'whatsapp_import_sender', numberId: NUMBER_ID }));
    const paths = revalidateMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/admin/integrations/numbers');
    expect(paths).toContain('/admin/integrations');
    expect(paths).toContain('/admin/webhooks');
  });

  it('does not log or revalidate when the write failed', async () => {
    assignMock.mockRejectedValue(new Error('boom'));
    await assignRoleAction(form({ role: 'sms_sender', numberId: NUMBER_ID }));
    expect(logMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('records the role but never a phone number in the activity log', async () => {
    assignMock.mockResolvedValue(undefined);
    await assignRoleAction(form({ role: 'voice_inbound_did', numberId: NUMBER_ID }));
    expect(logMock).toHaveBeenCalledWith({
      action: 'admin.integrations.number_role_assigned',
      meta: { role: 'voice_inbound_did', cleared: false },
    });
  });
});

describe('sync actions', () => {
  it('reports a degraded Meta read rather than swallowing it', async () => {
    syncMetaMock.mockResolvedValue({ count: 2, degraded: true });
    const state = await syncMetaNumbersAction();
    expect(state?.notice).toContain('2');
    expect(state?.notice).toContain('לא הוחזרו מ-Meta');
  });

  it('passes the DAL\'s "not configured" message through, and nothing else', async () => {
    syncMetaMock.mockRejectedValue(new Error('חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)'));
    expect(await syncMetaNumbersAction()).toEqual({
      error: 'חסרים פרטי חיבור ל-Meta (WABA ID או טוקן)',
    });

    syncMetaMock.mockRejectedValue(new Error('Meta phone_numbers fetch failed: HTTP 401'));
    expect(await syncMetaNumbersAction()).toEqual({ error: 'סנכרון המספרים מ-Meta נכשל' });
  });

  it('counts what Voximplant returned', async () => {
    syncVoxMock.mockResolvedValue({ count: 1, degraded: false });
    expect((await syncVoximplantNumbersAction())?.notice).toContain('1');
  });
});
