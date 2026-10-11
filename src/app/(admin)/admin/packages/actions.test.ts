import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/admin/packages', () => ({
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
  deletePackage: vi.fn(),
  validateOutreachScheduleForPackage: vi.fn().mockResolvedValue([]),
}));

import { redirect } from 'next/navigation';

import {
  createPackage,
  updatePackage,
  validateOutreachScheduleForPackage,
} from '@/lib/data/admin/packages';
import { createPackageAction, updatePackageAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});
// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

const FIELDS = {
  name: 'חבילת זהב',
  tier: 'gold',
  category: 'wedding',
  description: '',
  price_with_vat: '1000',
  includes: '[]',
  active: 'on',
  sort_order: '1',
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('createPackageAction — campaign-enabled gating of template validation ', () => {
  it('skips template validation for a non-campaign package (no quota) even when touchpoints exist', async () => {
    await createPackageAction(
      null,
      fd({
        ...FIELDS,
        outreach_schedule_json: JSON.stringify([
          { days_before: 3, channel: 'whatsapp', message_key: 'not_yet_created' },
        ]),
      }),
    );

    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    expect(createPackage).toHaveBeenCalledTimes(1);
    // Success path is a redirect (mocked to a no-throw spy here), not a notice.
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/admin/packages');
  });

  it('runs template validation when the package is campaign-enabled (a quota is set)', async () => {
    await createPackageAction(
      null,
      fd({
        ...FIELDS,
        contact_quota: '40',
        channels: 'whatsapp',
        outreach_schedule_json: JSON.stringify([
          { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
        ]),
      }),
    );

    expect(validateOutreachScheduleForPackage).toHaveBeenCalledWith([
      { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
    ]);
    expect(createPackage).toHaveBeenCalledTimes(1);
  });
});

describe('updatePackageAction — campaign-enabled gating of template validation ', () => {
  it('skips template validation for a non-campaign package (no quota) even when touchpoints exist', async () => {
    const result = await updatePackageAction(
      'p-1',
      null,
      fd({
        ...FIELDS,
        outreach_schedule_json: JSON.stringify([
          { days_before: 3, channel: 'whatsapp', message_key: 'not_yet_created' },
        ]),
      }),
    );

    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ notice: 'החבילה נשמרה' });
  });

  it('runs template validation when the package is campaign-enabled (a quota is set)', async () => {
    const f = fd({
      ...FIELDS,
      contact_quota: '40',
      channels: 'whatsapp',
      outreach_schedule_json: JSON.stringify([
        { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
      ]),
    });

    const result = await updatePackageAction('p-1', null, f);

    expect(validateOutreachScheduleForPackage).toHaveBeenCalledWith([
      { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
    ]);
    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ notice: 'החבילה נשמרה' });
  });
});

describe('updatePackageAction — an invalid quota is rejected before the data layer', () => {
  it('returns a contact_quota field error for "-1" and never calls updatePackage', async () => {
    const result = await updatePackageAction('p-1', null, fd({ ...FIELDS, contact_quota: '-1' }));

    expect(result?.fieldErrors?.contact_quota).toEqual(['נא להזין מכסה תקינה (מספר שלם, 1 ומעלה)']);
    // Zod rejects before any DB work: neither the write nor the template-validation query is ever reached.
    expect(updatePackage).not.toHaveBeenCalled();
    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
  });
});

describe('updatePackageAction — Next.js control-flow signals (requireAdmin / getPackage 404)', () => {
  it('propagates a NEXT_REDIRECT from updatePackage (requireAdmin) instead of returning { error }', async () => {
    vi.mocked(updatePackage).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updatePackageAction('p-1', null, fd(FIELDS)),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from updatePackage (missing package) instead of returning { error }', async () => {
    vi.mocked(updatePackage).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      updatePackageAction('p-1', null, fd(FIELDS)),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updatePackage).mockRejectedValue(new Error('db down'));

    const result = await updatePackageAction('p-1', null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון החבילה נכשל. נסו שוב.' });
  });
});

describe('fixed-price package with a contact quota', () => {
  // The earlier suites leave a rejected updatePackage behind (clearAllMocks keeps implementations).
  beforeEach(() => {
    vi.mocked(createPackage).mockResolvedValue({ id: 'new-id' });
    vi.mocked(updatePackage).mockResolvedValue(undefined);
  });

  const quota = {
    contact_quota: '40',
    channels: 'whatsapp',
    outreach_schedule_json: JSON.stringify([
      { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
    ]),
  };

  it('is campaign-enabled: its schedule is validated, and the quota is saved', async () => {
    await createPackageAction(null, fd({ ...FIELDS, ...quota }));

    expect(validateOutreachScheduleForPackage).toHaveBeenCalledWith([
      { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
    ]);
    expect(createPackage).toHaveBeenCalledWith(
      expect.objectContaining({ price_with_vat: 1000 }),
      expect.objectContaining({ contact_quota: 40 }),
    );
    const operational = vi.mocked(createPackage).mock.calls[0][1] as Record<string, unknown>;
    for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
      expect(operational, old).not.toHaveProperty(old);
    }
  });

  it('the same on update', async () => {
    const result = await updatePackageAction('p-1', null, fd({ ...FIELDS, ...quota }));

    expect(updatePackage).toHaveBeenCalledWith(
      'p-1',
      expect.anything(),
      expect.objectContaining({ contact_quota: 40 }),
    );
    expect(result).toEqual({ notice: 'החבילה נשמרה' });
  });

  it.each([['create'], ['update']])('%s: a fixed price must be positive — a free quota package is refused', async (which) => {
    const form = fd({ ...FIELDS, ...quota, price_with_vat: '0' });
    const result =
      which === 'create'
        ? await createPackageAction(null, form)
        : await updatePackageAction('p-1', null, form);

    expect(result?.fieldErrors?.price_with_vat).toEqual(['בחבילה במחיר קבוע המחיר חייב להיות חיובי']);
    expect(createPackage).not.toHaveBeenCalled();
    expect(updatePackage).not.toHaveBeenCalled();
  });

  it('a submitted per-result price or hold field never reaches the data layer', async () => {
    await createPackageAction(
      null,
      fd({ ...FIELDS, ...quota, price_per_reached: '5', base_price: '200', min_hold_floor: '50', hold_buffer_pct: '10' }),
    );

    const operational = vi.mocked(createPackage).mock.calls[0][1] as Record<string, unknown>;
    for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
      expect(operational, old).not.toHaveProperty(old);
    }
  });

  it('a package without a quota still skips template validation (nothing changed for it)', async () => {
    await createPackageAction(null, fd({ ...FIELDS, ...{ outreach_schedule_json: quota.outreach_schedule_json } }));

    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    expect(createPackage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contact_quota: null }));
  });
});
