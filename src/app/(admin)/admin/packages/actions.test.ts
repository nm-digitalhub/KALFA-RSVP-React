import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
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
vi.mock('@/lib/auth/platform-ability', () => ({ requirePlatformAction: vi.fn() }));

import { redirect } from 'next/navigation';

import {
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
} from '@/lib/data/admin/packages';
import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { createPackageAction, deletePackageAction, updatePackageAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});
// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

// The bound package id is validated (bindArgsSchemas: z.uuid()).
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAction).mockResolvedValue({ id: 'staff-1' } as Awaited<ReturnType<typeof requirePlatformAction>>);
});

describe('createPackageAction — campaign-enabled gating of template validation ', () => {
  it('skips template validation for a non-campaign package (no quota) even when touchpoints exist', async () => {
    await createPackageAction(
      {},
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
      {},
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
      PACKAGE_ID,
      {},
      fd({
        ...FIELDS,
        outreach_schedule_json: JSON.stringify([
          { days_before: 3, channel: 'whatsapp', message_key: 'not_yet_created' },
        ]),
      }),
    );

    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { notice: 'החבילה נשמרה' } });
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

    const result = await updatePackageAction(PACKAGE_ID, {}, f);

    expect(validateOutreachScheduleForPackage).toHaveBeenCalledWith([
      { days_before: 3, channel: 'whatsapp', message_key: 'rsvp_reminder' },
    ]);
    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { notice: 'החבילה נשמרה' } });
  });
});

describe('updatePackageAction — an invalid quota is rejected before the data layer', () => {
  it('returns a contact_quota field error for "-1" and never calls updatePackage', async () => {
    const result = await updatePackageAction(PACKAGE_ID, {}, fd({ ...FIELDS, contact_quota: '-1' }));

    expect(result.validationErrors?.fieldErrors.contact_quota).toEqual(['נא להזין מכסה תקינה (מספר שלם, 1 ומעלה)']);
    // Zod rejects before any DB work: neither the write nor the template-validation query is ever reached.
    expect(updatePackage).not.toHaveBeenCalled();
    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
  });
});

describe('updatePackageAction — Next.js control-flow signals (requirePlatformPermission / getPackage 404)', () => {
  it('propagates a NEXT_REDIRECT from updatePackage (requirePlatformPermission) instead of returning { error }', async () => {
    vi.mocked(updatePackage).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      updatePackageAction(PACKAGE_ID, {}, fd(FIELDS)),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from updatePackage (missing package) instead of returning { error }', async () => {
    vi.mocked(updatePackage).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      updatePackageAction(PACKAGE_ID, {}, fd(FIELDS)),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updatePackage).mockRejectedValue(new Error('db down'));

    const result = await updatePackageAction(PACKAGE_ID, {}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'עדכון החבילה נכשל. נסו שוב.' });
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
    await createPackageAction({}, fd({ ...FIELDS, ...quota }));

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
    const result = await updatePackageAction(PACKAGE_ID, {}, fd({ ...FIELDS, ...quota }));

    expect(updatePackage).toHaveBeenCalledWith(
      PACKAGE_ID,
      expect.anything(),
      expect.objectContaining({ contact_quota: 40 }),
    );
    expect(result).toEqual({ data: { notice: 'החבילה נשמרה' } });
  });

  it.each([['create'], ['update']])('%s: a fixed price must be positive — a free quota package is refused', async (which) => {
    const form = fd({ ...FIELDS, ...quota, price_with_vat: '0' });
    const result =
      which === 'create'
        ? await createPackageAction({}, form)
        : await updatePackageAction(PACKAGE_ID, {}, form);

    expect(result.validationErrors?.fieldErrors.price_with_vat).toEqual(['בחבילה במחיר קבוע המחיר חייב להיות חיובי']);
    expect(createPackage).not.toHaveBeenCalled();
    expect(updatePackage).not.toHaveBeenCalled();
  });

  it('a submitted per-result price or hold field never reaches the data layer', async () => {
    await createPackageAction(
      {},
      fd({ ...FIELDS, ...quota, price_per_reached: '5', base_price: '200', min_hold_floor: '50', hold_buffer_pct: '10' }),
    );

    const operational = vi.mocked(createPackage).mock.calls[0][1] as Record<string, unknown>;
    for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
      expect(operational, old).not.toHaveProperty(old);
    }
  });

  it('a package without a quota still skips template validation (nothing changed for it)', async () => {
    await createPackageAction({}, fd({ ...FIELDS, ...{ outreach_schedule_json: quota.outreach_schedule_json } }));

    expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    expect(createPackage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contact_quota: null }));
  });
});

// The form finds the touchpoint an error belongs to by the field's dotted path, so a touchpoint's error must come back
// under that path — from the schema and from the template check alike — never flattened away.
describe('a touchpoint error comes back under its dotted path', () => {
  beforeEach(() => {
    vi.mocked(updatePackage).mockResolvedValue(undefined);
  });

  const quota = { contact_quota: '40', channels: 'whatsapp' };

  it('the schema’s: a touchpoint on a channel the package does not use', async () => {
    const result = await updatePackageAction(
      PACKAGE_ID,
      {},
      fd({
        ...FIELDS,
        ...quota,
        outreach_schedule_json: JSON.stringify([{ days_before: 3, channel: 'call', message_key: 'rsvp_reminder' }]),
      }),
    );

    expect(result.validationErrors?.fieldErrors['outreach_schedule.0.channel']).toEqual(['הערוץ אינו נכלל בערוצי החבילה']);
    expect(updatePackage).not.toHaveBeenCalled();
  });

  it('the template check’s: a message that does not exist', async () => {
    vi.mocked(validateOutreachScheduleForPackage).mockResolvedValueOnce([{ index: 0, message: 'התבנית לא נמצאה' }]);

    const result = await updatePackageAction(
      PACKAGE_ID,
      {},
      fd({
        ...FIELDS,
        ...quota,
        outreach_schedule_json: JSON.stringify([{ days_before: 3, channel: 'whatsapp', message_key: 'missing' }]),
      }),
    );

    expect(result.validationErrors?.fieldErrors['outreach_schedule.0.message_key']).toEqual(['התבנית לא נמצאה']);
    expect(updatePackage).not.toHaveBeenCalled();
  });
});

// pilot-casl-package-permissions, task 3.3: a Server Action is reachable by direct POST, so each one checks the caller's
// right to its action FIRST — before it parses the form, and so before any field error could be returned.
describe('every package Server Action checks its action before anything else', () => {
  const ACCESS_DENIED = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
  });
  const INVALID = fd({ name: '', price_with_vat: 'not a number' });
  const CASES = [
    { name: 'createPackageAction', action: 'create', run: () => createPackageAction({}, INVALID) },
    { name: 'updatePackageAction', action: 'update', run: () => updatePackageAction(PACKAGE_ID, {}, INVALID) },
    { name: 'deletePackageAction', action: 'delete', run: () => deletePackageAction(PACKAGE_ID, {}, INVALID) },
  ] as const;

  for (const c of CASES) {
    it(`${c.name} asks for ${c.action} Package`, async () => {
      await c.run();
      expect(requirePlatformAction).toHaveBeenCalledWith(c.action, 'Package');
    });

    it(`${c.name} called without the right lets the redirect through and returns nothing, even for invalid input`, async () => {
      vi.mocked(requirePlatformAction).mockRejectedValue(ACCESS_DENIED);
      await expect(c.run()).rejects.toMatchObject({ digest: expect.stringContaining('/access-denied') });
      expect(createPackage).not.toHaveBeenCalled();
      expect(updatePackage).not.toHaveBeenCalled();
      expect(deletePackage).not.toHaveBeenCalled();
      expect(validateOutreachScheduleForPackage).not.toHaveBeenCalled();
    });
  }
});
