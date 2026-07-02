import { beforeEach, describe, expect, it, vi } from 'vitest';

// S2.3a — the bug this fixes: the old `event_date: event_date ? event_date :
// null` mapping collapsed "key absent from FormData" (a disabled, non-draft
// input — never POSTed by the browser) and "key present with an empty value"
// (a draft owner explicitly clearing the field) into the same `null`, which is
// exactly the ambiguity updateEvent's key-presence contract (S2.3) exists to
// prevent. FormData.has(...) is the only reliable signal.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Keep the real unstable_rethrow (via importOriginal) so it genuinely
// recognizes NEXT_REDIRECT/NEXT_HTTP_ERROR_FALLACK digests exactly as it
// would in production.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/events', () => ({
  updateEvent: vi.fn(),
  // Real value re-declared in the factory (hoisted above imports, so it cannot
  // reference the actual module): the action compares err.message against it.
  CELEBRANTS_LOCKED_ERROR:
    'לא ניתן למחוק את פרטי בעלי השמחה כשקיים קמפיין אישורי הגעה פעיל',
}));

import { CELEBRANTS_LOCKED_ERROR, updateEvent } from '@/lib/data/events';
import { updateEventAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});
// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BASE = {
  name: 'חתונה',
  event_type: 'wedding',
  venue_name: '',
  venue_address: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateEvent).mockResolvedValue(
    {} as unknown as Awaited<ReturnType<typeof updateEvent>>,
  );
});

describe('updateEventAction — FormData.has() presence mapping', () => {
  it('omits the event_date key entirely when the field is absent from FormData (disabled, non-draft input)', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE })); // no event_date entry at all

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('event_date' in input).toBe(false);
  });

  it('includes the event_date key (as null) when FormData has it as an empty string (draft owner clearing it)', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE, event_date: '' }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('event_date' in input).toBe(true);
    expect(input.event_date).toBeNull();
  });

  it('omits the rsvp_deadline key entirely when the field is absent from FormData', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('rsvp_deadline' in input).toBe(false);
  });

  it('includes a present, non-empty date value trimmed', async () => {
    await updateEventAction(
      'e-1',
      null,
      fd({ ...BASE, event_date: '2026-12-01 ' }),
    );

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(input.event_date).toBe('2026-12-01');
  });

  it('never forwards a status key, even if a stale client posts one', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE, status: 'active' }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(Object.hasOwn(input, 'status')).toBe(false);
  });
});

describe('updateEventAction — celebrants (בעלי שמחה)', () => {
  it('passes the parsed celebrants of the submitted event type to updateEvent', async () => {
    await updateEventAction(
      'e-1',
      null,
      fd({ ...BASE, 'celebrants.groom': 'יוסי', 'celebrants.bride': 'דנה' }),
    );

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(input.celebrants).toEqual({ groom: 'יוסי', bride: 'דנה' });
  });

  it('maps an all-empty celebrant group to celebrants: null (clears the column)', async () => {
    await updateEventAction(
      'e-1',
      null,
      fd({ ...BASE, 'celebrants.groom': '', 'celebrants.bride': '' }),
    );

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(input.celebrants).toBeNull();
  });

  it('returns a DOTTED fieldErrors key for an invalid celebrant name and does not update', async () => {
    const result = await updateEventAction(
      'e-1',
      null,
      fd({ ...BASE, 'celebrants.bride': 'א'.repeat(121) }),
    );

    expect(result?.fieldErrors?.['celebrants.bride']).toEqual(['השם ארוך מדי']);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("an event_type change takes the NEW type's fields — the old kind's inputs never leak", async () => {
    // The event was a wedding (stale groom input still posted); the owner
    // switched the type to birthday and filled the new kind's field.
    await updateEventAction(
      'e-1',
      null,
      fd({
        ...BASE,
        event_type: 'birthday',
        'celebrants.groom': 'יוסי',
        'celebrants.name': 'איתי',
      }),
    );

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(input.celebrants).toEqual({ name: 'איתי' });
  });
});

describe('updateEventAction — Next.js control-flow signals from the ownership gate', () => {
  it('propagates a NEXT_REDIRECT from updateEvent instead of returning { error }', async () => {
    vi.mocked(updateEvent).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updateEventAction('e-1', null, fd({ ...BASE })),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from the ownership gate instead of returning { error }', async () => {
    vi.mocked(updateEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      updateEventAction('e-1', null, fd({ ...BASE })),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error('db down'));

    const result = await updateEventAction('e-1', null, fd({ ...BASE }));

    expect(result).toEqual({ error: 'עדכון האירוע נכשל. נסו שוב.' });
  });

  it('surfaces the celebrants-lock guard message verbatim (the one guard reachable via enabled UI)', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error(CELEBRANTS_LOCKED_ERROR));

    const result = await updateEventAction('e-1', null, fd({ ...BASE }));

    expect(result).toEqual({ error: CELEBRANTS_LOCKED_ERROR });
  });
});
