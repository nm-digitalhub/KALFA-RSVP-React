import { beforeEach, describe, expect, it, vi } from 'vitest';

// safe-action.ts (the action's client) imports the server-only guard, which throws outside a server bundle.
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getOutreachEnabled: vi.fn() }));
vi.mock('@/lib/data/contacts', () => ({ recordCallConsent: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { requireEventAccess } from '@/lib/data/events';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { recordCallConsent } from '@/lib/data/contacts';
import { logActivity } from '@/lib/data/activity';
import { grantCallConsentAction } from './consent-actions';

// Real v4 UUIDs (Zod 4 z.uuid() is version-strict — memory zod4-uuid-version-strict).
const EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutreachEnabled).mockResolvedValue(true);
});

describe('grantCallConsentAction', () => {
  it('rejects a non-UUID id without touching authz or the DB', async () => {
    const result = await grantCallConsentAction({ eventId: 'not-a-uuid', contactId: CONTACT });
    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { eventId: ['מזהה לא תקין'] } } });
    expect(requireEventAccess).not.toHaveBeenCalled();
    expect(recordCallConsent).not.toHaveBeenCalled();
  });

  it('no-ops (does not record) when outreach is disabled', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const result = await grantCallConsentAction({ eventId: EVENT, contactId: CONTACT });
    expect(result).toEqual({ serverError: 'פנייה לאורחים אינה מופעלת' });
    // authorized first, but no write
    expect(requireEventAccess).toHaveBeenCalledWith(EVENT, 'contacts', 'edit');
    expect(recordCallConsent).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('records consent + a PII-free audit row on the happy path', async () => {
    const result = await grantCallConsentAction({ eventId: EVENT, contactId: CONTACT });
    expect(result).toEqual({ data: { ok: true } });
    expect(requireEventAccess).toHaveBeenCalledWith(EVENT, 'contacts', 'edit');
    expect(recordCallConsent).toHaveBeenCalledWith(EVENT, CONTACT);
    expect(logActivity).toHaveBeenCalledWith({
      eventId: EVENT,
      action: 'consent.call.granted',
      meta: { contactId: CONTACT },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/events/${EVENT}/guests`);
  });

  it('returns a friendly error when the write throws', async () => {
    vi.mocked(recordCallConsent).mockRejectedValue(new Error('db down'));
    const result = await grantCallConsentAction({ eventId: EVENT, contactId: CONTACT });
    expect(result).toEqual({ serverError: 'שמירת ההסכמה נכשלה' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
