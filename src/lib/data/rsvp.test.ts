import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The RPC arguments are the contract with submit_rsvp (migration 20261108080252):
// a count → `_headcount` (the answer, final for the WhatsApp "how many" question);
// no count (WhatsApp button, call digit) → the adults/kids shape, unchanged until
// the contract step.
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    // The fire-and-forget audit lookup finds no guest and stops there.
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

import { submitRsvp } from './rsvp';

const TOKEN = 'rsvp-token-abc123';

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { ok: true, status: 'attending' }, error: null });
});

describe('submitRsvp — what reaches submit_rsvp', () => {
  it('a count is sent as _headcount, never as adults/kids', async () => {
    await submitRsvp(TOKEN, { status: 'attending', headcount: 15, meal_pref: 'צמחוני' });

    const [, args] = rpc.mock.calls[0];
    expect(rpc).toHaveBeenCalledWith('submit_rsvp', expect.objectContaining({ _token: TOKEN, _status: 'attending', _headcount: 15 }));
    expect(args).not.toHaveProperty('_adults');
    expect(args).not.toHaveProperty('_kids');
  });

  it('declining from the page sends a zero count', async () => {
    await submitRsvp(TOKEN, { status: 'declined', headcount: 0 });

    expect(rpc).toHaveBeenCalledWith('submit_rsvp', expect.objectContaining({ _status: 'declined', _headcount: 0 }));
  });

  it.each([
    ['attending', 1],
    ['declined', 0],
    ['maybe', 0],
  ] as const)('no count (%s) keeps the adults/kids shape: adults %i, kids 0, no _headcount', async (status, adults) => {
    await submitRsvp(TOKEN, { status, headcount: null });

    const [, args] = rpc.mock.calls[0];
    expect(args).toMatchObject({ _status: status, _adults: adults, _kids: 0 });
    expect(args).not.toHaveProperty('_headcount');
  });
});
