import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/events', () => ({ createEvent: vi.fn() }));
vi.mock('@/lib/storage/event-media', () => ({
  INVITE_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  INVITE_IMAGE_TYPES: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  uploadInviteImage: vi.fn(),
  removeInviteImage: vi.fn(),
}));

import { createEvent } from '@/lib/data/events';
import { removeInviteImage, uploadInviteImage } from '@/lib/storage/event-media';
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

// The create form mirrors the edit form 1:1 (2.9.2026): the extra fields and
// the invitation image follow updateEventAction's contract exactly.
describe('createEventAction — the edit-form fields at create time', () => {
  beforeEach(() => {
    vi.mocked(createEvent).mockResolvedValue(
      { id: 'event-1' } as unknown as Awaited<ReturnType<typeof createEvent>>,
    );
    vi.mocked(uploadInviteImage).mockResolvedValue('11111111-1111-4111-8111-111111111111/invite.png');
  });

  it("forwards venue_address / rsvp_deadline / gift_payment_url ('' → null) and show_meal_pref from checkbox presence", async () => {
    await createEventAction(
      null,
      fd({
        ...FIELDS,
        venue_address: 'הרצל 1',
        rsvp_deadline: '',
        gift_payment_url: 'https://payboxapp.com/x',
        show_meal_pref: 'on',
      }),
    );

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_address: 'הרצל 1',
        rsvp_deadline: null,
        gift_payment_url: 'https://payboxapp.com/x',
        show_meal_pref: true,
        invite_image_path: null,
      }),
    );
  });

  it('an unchecked meal-pref box (key absent) → show_meal_pref: false', async () => {
    await createEventAction(null, fd(FIELDS));

    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ show_meal_pref: false }));
  });

  it('rejects a non-https gift link with a field error and creates nothing', async () => {
    const result = await createEventAction(
      null,
      fd({ ...FIELDS, gift_payment_url: 'http://payboxapp.com/x' }),
    );

    expect(result?.fieldErrors?.gift_payment_url).toBeDefined();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects an oversized invitation image BEFORE anything is uploaded or created', async () => {
    const f = fd(FIELDS);
    f.set(
      'invite_image',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
    );

    const result = await createEventAction(null, f);

    expect(result?.error).toBe('תמונת ההזמנה גדולה מדי (עד 5MB).');
    expect(uploadInviteImage).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image type before anything is uploaded or created', async () => {
    const f = fd(FIELDS);
    f.set('invite_image', new File([new Uint8Array(16)], 'a.gif', { type: 'image/gif' }));

    const result = await createEventAction(null, f);

    expect(result?.error).toBe('תמונת ההזמנה חייבת להיות JPG, PNG או WebP.');
    expect(uploadInviteImage).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('uploads the image under a server-generated id BEFORE the insert, and inserts with that id + path', async () => {
    const f = fd(FIELDS);
    f.set('invite_image', new File([new Uint8Array(16)], 'a.png', { type: 'image/png' }));

    await createEventAction(null, f);

    expect(uploadInviteImage).toHaveBeenCalledTimes(1);
    const [uploadedForId, , contentType] = vi.mocked(uploadInviteImage).mock.calls[0];
    expect(contentType).toBe('image/png');
    expect(uploadedForId).toMatch(/^[0-9a-f-]{36}$/);
    expect(vi.mocked(uploadInviteImage).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createEvent).mock.invocationCallOrder[0],
    );
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: uploadedForId,
        invite_image_path: '11111111-1111-4111-8111-111111111111/invite.png',
      }),
    );
  });

  it('a failed upload → error, and NO event is created', async () => {
    vi.mocked(uploadInviteImage).mockRejectedValue(new Error('העלאת תמונת ההזמנה נכשלה'));
    const f = fd(FIELDS);
    f.set('invite_image', new File([new Uint8Array(16)], 'a.png', { type: 'image/png' }));

    const result = await createEventAction(null, f);

    expect(result?.error).toBe('העלאת תמונת ההזמנה נכשלה. נסו שוב.');
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('a failed insert AFTER a successful upload removes the orphaned image', async () => {
    vi.mocked(createEvent).mockRejectedValue(new Error('db down'));
    const f = fd(FIELDS);
    f.set('invite_image', new File([new Uint8Array(16)], 'a.png', { type: 'image/png' }));

    const result = await createEventAction(null, f);

    expect(result).toEqual({ error: 'יצירת האירוע נכשלה. נסו שוב.' });
    expect(removeInviteImage).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111/invite.png');
  });

  it('without an image, createEvent is called with invite_image_path: null and no cleanup runs on failure', async () => {
    vi.mocked(createEvent).mockRejectedValue(new Error('db down'));

    await createEventAction(null, fd(FIELDS));

    expect(uploadInviteImage).not.toHaveBeenCalled();
    expect(removeInviteImage).not.toHaveBeenCalled();
  });
});
