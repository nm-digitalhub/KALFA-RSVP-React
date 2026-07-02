import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/events', () => ({ createEvent: vi.fn() }));

import { createEvent } from '@/lib/data/events';
import { createEventAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = { name: 'חתונה', event_type: 'wedding', event_date: '', venue_name: '' };

beforeEach(() => vi.clearAllMocks());

describe('createEventAction — celebrants (בעלי שמחה)', () => {
  beforeEach(() => {
    // Success paths reach `redirect(...)` (mocked), which needs the new id.
    vi.mocked(createEvent).mockResolvedValue(
      { id: 'event-1' } as unknown as Awaited<ReturnType<typeof createEvent>>,
    );
  });

  it('passes the parsed celebrants of the submitted event type to createEvent', async () => {
    await createEventAction(
      null,
      fd({
        ...FIELDS,
        'celebrants.groom': 'יוסי',
        'celebrants.bride': 'דנה',
      }),
    );

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ celebrants: { groom: 'יוסי', bride: 'דנה' } }),
    );
  });

  it('maps an all-empty celebrant group to celebrants: null (never {})', async () => {
    await createEventAction(
      null,
      fd({ ...FIELDS, 'celebrants.groom': '', 'celebrants.bride': '' }),
    );

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ celebrants: null }),
    );
  });

  it('returns a DOTTED fieldErrors key for an invalid celebrant name and does not create', async () => {
    const result = await createEventAction(
      null,
      fd({ ...FIELDS, 'celebrants.groom': 'א'.repeat(121) }),
    );

    expect(result?.fieldErrors?.['celebrants.groom']).toEqual(['השם ארוך מדי']);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("keeps only the submitted event type's fields — a stale other-kind value never leaks", async () => {
    // A user picked wedding, typed a groom, then switched to birthday: the
    // browser may still post the stale wedding inputs alongside the new ones.
    await createEventAction(
      null,
      fd({
        ...FIELDS,
        event_type: 'birthday',
        'celebrants.groom': 'יוסי',
        'celebrants.name': 'איתי',
      }),
    );

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ celebrants: { name: 'איתי' } }),
    );
  });
});

describe('createEventAction — Next.js control-flow signals', () => {
  it('propagates a NEXT_REDIRECT from createEvent (requireUser) instead of returning { error }', async () => {
    vi.mocked(createEvent).mockRejectedValue(NEXT_REDIRECT);

    await expect(createEventAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(createEvent).mockRejectedValue(new Error('db down'));

    const result = await createEventAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'יצירת האירוע נכשלה. נסו שוב.' });
  });
});
