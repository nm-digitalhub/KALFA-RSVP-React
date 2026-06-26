import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring tests for B1: every guest-write action must keep the contacts table
// (billing source-of-truth) in sync, and a sync failure must NOT fail the
// already-committed guest mutation (best-effort contract).

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/x;307;',
    });
  }),
}));
vi.mock('@/lib/data/guests', () => ({
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
  deleteGuest: vi.fn(),
  updateContactStatus: vi.fn(),
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({ linkGuestContact: vi.fn() }));

import { createGuest, updateGuest } from '@/lib/data/guests';
import { linkGuestContact } from '@/lib/data/contacts';
import { createGuestAction, updateGuestAction } from './guests-actions';

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
