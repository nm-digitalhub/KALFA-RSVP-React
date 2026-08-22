import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  applyCallOutcome,
  closeCallbackAppointment,
  rescheduleCallbackRequest,
} from '@/lib/data/callback-scheduling';
import {
  cancelCallback,
  getCallbackRequestByCalendarItem,
  listCallbackRequests,
  rescheduleCallback,
  updateCallOutcome,
  CALLBACK_COLUMNS,
  type CallbackRequest,
} from './callbacks';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/callback-scheduling', () => ({
  applyCallOutcome: vi.fn(),
  closeCallbackAppointment: vi.fn(),
  rescheduleCallbackRequest: vi.fn(),
}));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<CallbackRequest> = {}): CallbackRequest {
  return {
    id: 'cb-1',
    full_name: 'יוסי',
    phone: '0521112222',
    topic: 'מחירים',
    note: null,
    status: 'new',
    call_outcome: 'pending',
    scheduled_at: null,
    created_at: '2026-06-20T10:00:00.000Z',
    updated_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
  vi.mocked(closeCallbackAppointment).mockResolvedValue({ archived: false });
  vi.mocked(applyCallOutcome).mockResolvedValue({ archived: false, requestClosed: false });
});

// The calendar dialog renders a dialable number and a working link from THIS
// lookup rather than from the appointment's description. If it silently
// returned nothing, the dialog would fall back to showing prose with dead
// links — the exact regression this replaced.
describe('getCallbackRequestByCalendarItem', () => {
  function mockClient(data: unknown, error: unknown = null) {
    const { client, builder } = createMockSupabase<unknown>({
      data: data as never,
      error: error as never,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('is gated on customer-data access before it reads anything', async () => {
    mockClient(null);
    await getCallbackRequestByCalendarItem('item-1');
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_customer_data');
  });

  it('looks the request up by the calendar item the owner clicked', async () => {
    const { client, builder } = mockClient(row());

    await getCallbackRequestByCalendarItem('item-1');

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.eq).toHaveBeenCalledWith('calendar_item_id', 'item-1');
    // maybeSingle, not single: an ordinary meeting matches no row at all.
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('returns null for an appointment this system never scheduled', async () => {
    mockClient(null);
    await expect(getCallbackRequestByCalendarItem('item-1')).resolves.toBeNull();
  });

  it('raises a safe Hebrew error instead of leaking the database one', async () => {
    mockClient(null, { message: 'relation "callback_requests" does not exist' });
    await expect(getCallbackRequestByCalendarItem('item-1')).rejects.toThrow(
      'טעינת בקשת החזרה נכשלה',
    );
  });
});

describe('listCallbackRequests', () => {
  it('requests the DTO columns from the right table with a count', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listCallbackRequests();

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.select).toHaveBeenCalledWith(CALLBACK_COLUMNS, {
      count: 'exact',
    });
    expect(result.total).toBe(1);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: [],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listCallbackRequests()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listCallbackRequests()).rejects.toThrow(
      'טעינת בקשות החזרה נכשלה',
    );
  });
});

// Redesigned 2026-08-19/20: this used to be updateCallbackStatus, setting
// `status` to any of new/in_progress/done/cancelled. Cancelling is now the
// ONLY status transition an admin makes directly — see validation/admin.ts.
describe('cancelCallback', () => {
  it('enforces the admin gate and cancels the matching row', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await cancelCallback('cb-1');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'cb-1');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'callback.cancelled' }),
    );
  });

  it('does NOT cancel when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error when the update fails', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: { message: 'nope' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).rejects.toThrow('ביטול הבקשה נכשל');
  });

  // Regression for a measured gap (2026-08-19): closing a request never used
  // to touch its calendar appointment at all, leaving it to sit there forever.
  // Redesigned 2026-08-20: the appointment is archived (never deleted) and
  // marked distinctly from a completed call — see closeCallbackAppointment.
  it('archives the calendar appointment as cancelled (not deleted)', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(closeCallbackAppointment).mockResolvedValue({ archived: true });

    await cancelCallback('cb-1');

    expect(closeCallbackAppointment).toHaveBeenCalledWith('cb-1', { reason: 'cancelled' });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ calendarAppointmentArchived: true }),
      }),
    );
  });
});

// A fully separate dimension from `status` — what the owner recorded after
// making the call. See validation/admin.ts. Redesigned 2026-08-20: the actual
// state machine (archive, retry-vs-close, three-strikes no-contact) now lives
// in applyCallOutcome (callback-scheduling.ts) — updateCallOutcome is a thin
// gate-then-delegate wrapper, same split as rescheduleCallback below wrapping
// rescheduleCallbackRequest. Its own coverage (retry logic, the atomic claim,
// the SMS) lives in callback-scheduling.test.ts.
describe('updateCallOutcome', () => {
  it('enforces the admin gate and delegates to applyCallOutcome', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(applyCallOutcome).mockResolvedValue({ archived: true, requestClosed: false });

    await updateCallOutcome('cb-1', 'completed');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(applyCallOutcome).toHaveBeenCalledWith('cb-1', 'completed');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'callback.outcome_updated',
        meta: expect.objectContaining({
          callbackRequestId: 'cb-1',
          callOutcome: 'completed',
          calendarAppointmentArchived: true,
          requestClosed: false,
        }),
      }),
    );
  });

  it('does NOT delegate when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );

    await expect(updateCallOutcome('cb-1', 'completed')).rejects.toThrow('NEXT_REDIRECT');
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('throws a safe error when reading the current outcome fails, without delegating', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: { message: 'nope' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(updateCallOutcome('cb-1', 'completed')).rejects.toThrow(
      'עדכון תוצאת השיחה נכשל',
    );
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('records the outcome BEFORE the change, from the row it read first', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row({ call_outcome: 'no_answer' }),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(applyCallOutcome).mockResolvedValue({ archived: true, requestClosed: true });

    await updateCallOutcome('cb-1', 'closed');

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ previousOutcome: 'no_answer', callOutcome: 'closed' }),
      }),
    );
  });
});

// Regression for the scenario raised 19.08: the caller answered and asked for
// a different time, or asked to be called again later. rescheduleCallback is
// the only path a browser request can reach rescheduleCallbackRequest through
// — that function lives in the REQUEST-FREE callback-scheduling.ts and
// carries no authorization of its own.
describe('rescheduleCallback', () => {
  const NEW_ISO = '2026-09-01T10:00:00.000Z';

  it('enforces the admin gate before delegating', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({ ok: true });

    await rescheduleCallback('cb-1', NEW_ISO);

    expect(requirePlatformPermission).toHaveBeenCalledWith('view_customer_data');
    expect(rescheduleCallbackRequest).toHaveBeenCalledWith('cb-1', NEW_ISO);
  });

  it('does NOT reschedule when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );

    await expect(rescheduleCallback('cb-1', NEW_ISO)).rejects.toThrow('NEXT_REDIRECT');
    expect(rescheduleCallbackRequest).not.toHaveBeenCalled();
  });

  it('logs the outcome either way', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({
      ok: false,
      reason: 'old_appointment_not_removed',
    });

    await rescheduleCallback('cb-1', NEW_ISO);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'callback.rescheduled',
        meta: expect.objectContaining({
          callbackRequestId: 'cb-1',
          ok: false,
          reason: 'old_appointment_not_removed',
        }),
      }),
    );
  });

  it('returns the outcome from rescheduleCallbackRequest unchanged', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({ ok: true });
    await expect(rescheduleCallback('cb-1', NEW_ISO)).resolves.toEqual({ ok: true });
  });
});
