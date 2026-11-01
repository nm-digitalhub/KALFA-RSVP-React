import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/admin/offers', async (importOriginal) => {
  // OfferFloorError must be the REAL class — the action maps it by instanceof.
  const actual = await importOriginal<typeof import('@/lib/data/admin/offers')>();
  return {
    OfferFloorError: actual.OfferFloorError,
    createOffer: vi.fn(),
    updateOffer: vi.fn(),
    deleteOffer: vi.fn(),
  };
});
vi.mock('server-only', () => ({}));

import { redirect } from 'next/navigation';

import { createOffer, updateOffer, deleteOffer, OfferFloorError } from '@/lib/data/admin/offers';
import { createOfferAction, updateOfferAction, deleteOfferAction } from './actions';

const FIELDS = {
  title: 'הנחה אחרי התנגדות מחיר',
  kind: 'percent',
  value: '5',
  validity_days: '14',
  allow_agent: 'on',
  allow_staff: 'on',
  agent_objections: 'מחיר יקר\nרוצה לחשוב',
  is_active: 'on',
  packages_json: JSON.stringify([{ package_id: '2b1e0c54-7b1f-4f58-9a3e-1c2d3e4f5a6b', value_override: null }]),
};

// The bound offer id is validated (bindArgsSchemas: z.uuid()).
const OFFER_ID = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('createOfferAction', () => {
  it('parses the form (objections one per line, checkboxes, packages JSON) and redirects', async () => {
    vi.mocked(createOffer).mockResolvedValue({ id: 'o-1' });

    await createOfferAction({}, fd(FIELDS));

    expect(createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'הנחה אחרי התנגדות מחיר',
        kind: 'percent',
        value: 5,
        validity_days: 14,
        allow_agent: true,
        allow_staff: true,
        agent_objections: ['מחיר יקר', 'רוצה לחשוב'],
        may_replace: false,
        is_active: true,
        packages: [
          { package_id: '2b1e0c54-7b1f-4f58-9a3e-1c2d3e4f5a6b', value_override: null },
        ],
      }),
    );
    expect(redirect).toHaveBeenCalledWith('/admin/offers');
  });

  it('refuses a form without packages (malformed JSON becomes an empty set)', async () => {
    const state = await createOfferAction({}, fd({ ...FIELDS, packages_json: 'not-json' }));

    expect(state.validationErrors?.fieldErrors?.packages).toBeTruthy();
    expect(createOffer).not.toHaveBeenCalled();
  });

  it('refuses a missing title with a field error', async () => {
    const state = await createOfferAction({}, fd({ ...FIELDS, title: ' ' }));

    expect(state.validationErrors?.fieldErrors?.title).toBeTruthy();
    expect(createOffer).not.toHaveBeenCalled();
  });

  it('maps the D14 floor refusal to a field error on the value', async () => {
    vi.mocked(createOffer).mockRejectedValue(new OfferFloorError('בסיס', 0));

    const state = await createOfferAction({}, fd(FIELDS));

    expect(state.validationErrors?.fieldErrors?.value?.[0]).toContain('בסיס');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateOfferAction', () => {
  it('saves and answers with a notice (no redirect)', async () => {
    vi.mocked(updateOffer).mockResolvedValue();

    const state = await updateOfferAction(OFFER_ID, {}, fd(FIELDS));

    expect(updateOffer).toHaveBeenCalledWith(OFFER_ID, expect.objectContaining({ value: 5 }));
    expect(state.data?.notice).toBe('ההצעה נשמרה');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('maps the floor refusal to a field error on the value', async () => {
    vi.mocked(updateOffer).mockRejectedValue(new OfferFloorError('בסיס', -10));

    const state = await updateOfferAction(OFFER_ID, {}, fd(FIELDS));

    expect(state.validationErrors?.fieldErrors?.value).toBeTruthy();
  });
});

describe('deleteOfferAction', () => {
  it('surfaces the data layer message (the RESTRICT deactivate-instead answer)', async () => {
    vi.mocked(deleteOffer).mockRejectedValue(
      new Error('לא ניתן למחוק הצעה שכבר הוקצו ממנה הטבות. אפשר לסמן אותה כלא פעילה.'),
    );

    const state = await deleteOfferAction(OFFER_ID, {});

    expect(state.serverError).toContain('לא ניתן למחוק');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to the list on success', async () => {
    vi.mocked(deleteOffer).mockResolvedValue();

    await deleteOfferAction(OFFER_ID, {});

    expect(redirect).toHaveBeenCalledWith('/admin/offers');
  });
});
