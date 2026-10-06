import { beforeEach, describe, expect, it, vi } from 'vitest';

// The action must tell "key absent from FormData" (a disabled, non-draft input
// — never POSTed by the browser) from "key present with an empty value" (a
// draft owner explicitly clearing the field). Collapsing both into the same
// `null` is exactly the ambiguity updateEvent's key-presence contract exists to
// prevent. FormData.has(...) is the only reliable signal.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/storage/event-media', () => ({
  INVITE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  INVITE_IMAGE_TYPES: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  uploadInviteImage: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Keep the real unstable_rethrow (via importOriginal) so it genuinely
// recognizes NEXT_REDIRECT/NEXT_HTTP_ERROR_FALLBACK digests exactly as it
// would in production.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/events', () => ({
  updateEvent: vi.fn(),
  getEvent: vi.fn(),
  // Real values re-declared in the factory (hoisted above imports, so it cannot
  // reference the actual module): the action compares err.message against these.
  DATES_LOCKED_ERROR: 'לא ניתן לשנות תאריך ושעה לאחר שנשלחה ההודעה הראשונה לאורחים',
  CELEBRANTS_LOCKED_ERROR:
    'לא ניתן להשאיר את פרטי בעלי השמחה חסרים כל עוד קיים קמפיין אישורי הגעה בתהליך — הם מופיעים בהזמנות ובתזכורות. השלימו את השדות המסומנים ונסו שוב.',
  EVENT_TYPE_LOCKED_ERROR: 'לא ניתן לשנות את סוג האירוע כל עוד קיים קמפיין אישורי הגעה בתהליך.',
  VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR:
    'לא ניתן להשאיר את המיקום ריק כל עוד קיים קמפיין אישורי הגעה בתהליך — המיקום מופיע בהזמנות ובתזכורות.',
}));
vi.mock('@/lib/data/event-exchange-sync', () => ({ rescheduleEventExchangeAppointment: vi.fn() }));
vi.mock('@/lib/data/event-cancellation', () => ({
  createCancellationRequest: vi.fn(),
}));

import {
  CELEBRANTS_LOCKED_ERROR,
  DATES_LOCKED_ERROR,
  EVENT_TYPE_LOCKED_ERROR,
  getEvent,
  updateEvent,
  VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR,
} from '@/lib/data/events';
import { createCancellationRequest } from '@/lib/data/event-cancellation';
import { rescheduleEventExchangeAppointment } from '@/lib/data/event-exchange-sync';
import { updateEventAction, createCancellationRequestAction, setupSaveEventAction } from './actions';

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

describe('updateEventAction — the calendar entry follows a date change', () => {
  it('moves the Exchange appointment after a save that carried a date', async () => {
    await updateEventAction('e1', null, fd({ ...BASE, event_date: '2999-01-01' }));
    expect(rescheduleEventExchangeAppointment).toHaveBeenCalledWith('e1');
  });

  it('leaves the calendar alone when the save carried no date key (the common save)', async () => {
    await updateEventAction('e1', null, fd(BASE));
    expect(rescheduleEventExchangeAppointment).not.toHaveBeenCalled();
  });

  it('does not touch the calendar when the save was refused', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error(DATES_LOCKED_ERROR));
    await updateEventAction('e1', null, fd({ ...BASE, event_date: '2999-01-01' }));
    expect(rescheduleEventExchangeAppointment).not.toHaveBeenCalled();
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

  it('surfaces the celebrants-lock guard message verbatim (a guard reachable via enabled UI)', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error(CELEBRANTS_LOCKED_ERROR));

    const result = await updateEventAction('e-1', null, fd({ ...BASE }));

    expect(result).toEqual({ error: CELEBRANTS_LOCKED_ERROR });
  });

  it('surfaces the dates-locked message verbatim (the first send has gone out)', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error(DATES_LOCKED_ERROR));

    const result = await updateEventAction('e1', null, fd({ ...BASE, event_date: '2999-01-01' }));

    expect(result).toEqual({ error: DATES_LOCKED_ERROR });
  });

  it('surfaces the event_type-lock guard message verbatim', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error(EVENT_TYPE_LOCKED_ERROR));

    const result = await updateEventAction('e-1', null, fd({ ...BASE }));

    expect(result).toEqual({ error: EVENT_TYPE_LOCKED_ERROR });
  });

  it('surfaces the venue-required-while-campaign guard message verbatim', async () => {
    vi.mocked(updateEvent).mockRejectedValue(
      new Error(VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR),
    );

    const result = await updateEventAction('e-1', null, fd({ ...BASE }));

    expect(result).toEqual({ error: VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR });
  });
});

describe('createCancellationRequestAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a notice with the request number on success', async () => {
    vi.mocked(createCancellationRequest).mockResolvedValue({ id: 'r1', requestNumber: 42 });
    const result = await createCancellationRequestAction(
      'e1',
      null,
      fd({ reason: 'שינוי תוכניות משפחתיות', smsConsent: 'on' }),
    );
    expect(result?.notice).toContain('42');
  });

  it('surfaces a validation error for a too-short reason', async () => {
    const result = await createCancellationRequestAction('e1', null, fd({ reason: 'קצר' }));
    expect(result?.fieldErrors?.reason).toBeDefined();
    expect(createCancellationRequest).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal instead of swallowing it', async () => {
    vi.mocked(createCancellationRequest).mockRejectedValue(NEXT_REDIRECT);
    await expect(
      createCancellationRequestAction('e1', null, fd({ reason: 'שינוי תוכניות משפחתיות' })),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('surfaces the data-layer error message on failure', async () => {
    vi.mocked(createCancellationRequest).mockRejectedValue(new Error('פתיחת בקשת הביטול נכשלה'));
    const result = await createCancellationRequestAction(
      'e1',
      null,
      fd({ reason: 'שינוי תוכניות משפחתיות' }),
    );
    expect(result?.error).toBe('פתיחת בקשת הביטול נכשלה');
  });
});

describe('setupSaveEventAction — "שמירה והמשך" (the details step of the setup flow)', () => {
  const complete = {
    status: 'draft',
    event_type: 'wedding',
    event_date: '2999-01-01T16:00:00+00:00',
    venue_name: 'אולם',
    venue_address: 'הרצל 1, תל אביב',
    celebrants: { groom: 'דני', bride: 'דנה' },
  };

  it('saves, and when nothing is missing moves on to the setup flow', async () => {
    vi.mocked(getEvent).mockResolvedValue(complete as never);

    await expect(setupSaveEventAction('e1', null, fd(BASE))).rejects.toMatchObject({
      digest: expect.stringContaining('/app/events/e1/setup'),
    });
    expect(updateEvent).toHaveBeenCalled();
  });

  it('saves but stays put, naming what is still missing', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...complete, venue_address: null } as never);

    const result = await setupSaveEventAction('e1', null, fd(BASE));

    expect(updateEvent).toHaveBeenCalled();
    expect(result?.error).toBe('נשמר. כדי להמשיך יש להשלים: כתובת המקום');
    // …and the field itself is marked, so the owner does not have to hunt for it.
    expect(result?.fieldErrors).toEqual({ venue_address: ['שדה חובה כדי להמשיך'] });
  });

  it('does not move on when the save itself failed, and does not even look at the prerequisites', async () => {
    vi.mocked(updateEvent).mockRejectedValue(new Error('boom'));

    const result = await setupSaveEventAction('e1', null, fd(BASE));

    expect(result?.error).toBe('עדכון האירוע נכשל. נסו שוב.');
    expect(getEvent).not.toHaveBeenCalled();
  });

  it('does not move on when the form is invalid', async () => {
    const result = await setupSaveEventAction('e1', null, fd({ ...BASE, name: '' }));

    expect(result?.fieldErrors).toBeDefined();
    expect(updateEvent).not.toHaveBeenCalled();
    expect(getEvent).not.toHaveBeenCalled();
  });
});
