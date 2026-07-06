import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring tests for B1: every guest-write action must keep the contacts table
// (billing source-of-truth) in sync, and a sync failure must NOT fail the
// already-committed guest mutation (best-effort contract).

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it.
// Keep the real `unstable_rethrow` (via importOriginal) so it still recognizes
// this fake NEXT_REDIRECT digest exactly as it would a real one.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/x;307;',
      });
    }),
  };
});
vi.mock('@/lib/data/guests', () => ({
  PHONE_TAKEN_ERROR: 'מספר הטלפון כבר קיים אצל מוזמן אחר באירוע',
  GROUP_NAME_TAKEN_ERROR: 'קבוצה בשם זה כבר קיימת באירוע',
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
  deleteGuest: vi.fn(),
  updateContactStatus: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({ linkGuestContact: vi.fn() }));
// rsvp.ts is `server-only`; mock it so importing the action module under test
// doesn't pull the server-only guard into the Node test env.
vi.mock('@/lib/data/rsvp', () => ({
  revokeRsvpToken: vi.fn(),
  regenerateRsvpToken: vi.fn(),
}));

import { createGuest, updateGuest } from '@/lib/data/guests';
import { linkGuestContact } from '@/lib/data/contacts';
import { createGuestAction, updateGuestAction, createGroupAction, updateGroupAction } from './guests-actions';
import { createGroup, updateGroup } from '@/lib/data/guests';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createGuestAction → contact sync', () => {
  it('links the newly created guest to its contact, then redirects', async () => {
    vi.mocked(createGuest).mockResolvedValue({
      id: 'g-1',
    } as unknown as Awaited<ReturnType<typeof createGuest>>);

    await expect(
      createGuestAction('e-1', null, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(createGuest).toHaveBeenCalled();
    expect(linkGuestContact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(linkGuestContact).mock.calls[0].slice(0, 2)).toEqual([
      'e-1',
      'g-1',
    ]);
  });

  it('still redirects when the contact sync fails (best-effort, no throw)', async () => {
    vi.mocked(createGuest).mockResolvedValue({
      id: 'g-2',
    } as unknown as Awaited<ReturnType<typeof createGuest>>);
    vi.mocked(linkGuestContact).mockRejectedValue(new Error('sync boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      createGuestAction('e-1', null, fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    errSpy.mockRestore();
  });
});

describe('updateGuestAction → contact sync', () => {
  it('re-links the contact when the phone is part of the update', async () => {
    vi.mocked(updateGuest).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof updateGuest>>,
    );

    await expect(
      updateGuestAction(
        'e-1',
        'g-9',
        null,
        fd({ full_name: 'דנה', phone: '0509999999', group_id: '', note: '' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(linkGuestContact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(linkGuestContact).mock.calls[0].slice(0, 2)).toEqual([
      'e-1',
      'g-9',
    ]);
  });
});

// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

describe('createGuestAction — Next.js control-flow signals from the ownership gate', () => {
  it('propagates a NEXT_NOT_FOUND from createGuest (requireOwnedEvent) instead of returning { error }', async () => {
    vi.mocked(createGuest).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      createGuestAction(
        'e-1',
        null,
        fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' }),
      ),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(linkGuestContact).not.toHaveBeenCalled();
  });

  it('converts a genuine (non-framework) error from createGuest into the existing friendly message, not a thrown error', async () => {
    vi.mocked(createGuest).mockRejectedValue(new Error('db down'));

    const result = await createGuestAction(
      'e-1',
      null,
      fd({ full_name: 'דנה', phone: '0501234567', group_id: '', note: '' }),
    );

    expect(result).toEqual({ error: 'הוספת המוזמן נכשלה. נסו שוב.' });
    expect(linkGuestContact).not.toHaveBeenCalled();
  });
});

describe('updateGroupAction', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';
  const GROUP_ID = '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c';

  function fd(name: string): FormData {
    const data = new FormData();
    data.set('name', name);
    return data;
  }

  it('renames the group and reports success', async () => {
    vi.mocked(updateGroup).mockResolvedValue({
      id: GROUP_ID,
      event_id: EVENT_ID,
      name: 'משפחה',
      color: null,
      created_at: '2026-07-06T00:00:00Z',
    });
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, null, fd('משפחה'));
    expect(updateGroup).toHaveBeenCalledWith(EVENT_ID, GROUP_ID, { name: 'משפחה' });
    expect(state?.notice).toBeDefined();
  });

  it('rejects an empty name with a field error and never hits the data layer', async () => {
    vi.mocked(updateGroup).mockClear();
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, null, fd('   '));
    expect(state?.fieldErrors?.name).toBeDefined();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it('maps a data-layer failure to a safe Hebrew error', async () => {
    vi.mocked(updateGroup).mockRejectedValue(new Error('boom'));
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, null, fd('חברים'));
    expect(state?.error).toBeDefined();
  });
});

describe('createGroupAction', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';

  it('creates a group from a name-only form (no color field posted)', async () => {
    // Regression: the groups-manager form has no color input, so
    // formData.get('color') is null — the action must not fail validation.
    vi.mocked(createGroup).mockResolvedValue({
      id: '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c',
      event_id: EVENT_ID,
      name: 'משפחה',
      color: null,
      created_at: '2026-07-06T00:00:00Z',
    });
    const data = new FormData();
    data.set('name', 'משפחה');
    const state = await createGroupAction(EVENT_ID, null, data);
    expect(state?.fieldErrors).toBeUndefined();
    expect(state?.notice).toBeDefined();
    expect(createGroup).toHaveBeenCalledWith(EVENT_ID, { name: 'משפחה', color: null });
  });
});

describe('friendly duplicate errors surface as field errors', () => {
  const EVENT_ID = '7b0c2d64-9f1e-4a7b-8c3d-2e5f6a7b8c9d';
  const GROUP_ID = '3f2a1b0c-8d7e-4f6a-9b5c-1d2e3f4a5b6c';

  it('createGroupAction maps a taken name to fieldErrors.name', async () => {
    vi.mocked(createGroup).mockRejectedValue(
      new Error('קבוצה בשם זה כבר קיימת באירוע'),
    );
    const data = new FormData();
    data.set('name', 'משפחת קלפה');
    const state = await createGroupAction(EVENT_ID, null, data);
    expect(state?.fieldErrors?.name?.[0]).toContain('כבר קיימת');
    expect(state?.error).toBeUndefined();
  });

  it('updateGroupAction maps a taken name to fieldErrors.name', async () => {
    vi.mocked(updateGroup).mockRejectedValue(
      new Error('קבוצה בשם זה כבר קיימת באירוע'),
    );
    const data = new FormData();
    data.set('name', 'משפחת קלפה');
    const state = await updateGroupAction(EVENT_ID, GROUP_ID, null, data);
    expect(state?.fieldErrors?.name?.[0]).toContain('כבר קיימת');
  });

  it('createGuestAction maps a taken phone to fieldErrors.phone', async () => {
    vi.mocked(createGuest).mockRejectedValue(
      new Error('מספר הטלפון כבר קיים אצל מוזמן אחר באירוע'),
    );
    const state = await createGuestAction(
      EVENT_ID,
      null,
      fd({ full_name: 'סיון קלפה', phone: '0501234567', group_id: '', note: '' }),
    );
    expect(state?.fieldErrors?.phone?.[0]).toContain('כבר קיים');
    expect(state?.error).toBeUndefined();
  });
});
