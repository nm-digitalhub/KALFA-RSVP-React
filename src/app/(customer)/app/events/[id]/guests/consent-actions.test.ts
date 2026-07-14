import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const result = await grantCallConsentAction('not-a-uuid', CONTACT);
    expect(result).toEqual({ ok: false, error: 'מזהה לא תקין' });
    expect(requireEventAccess).not.toHaveBeenCalled();
    expect(recordCallConsent).not.toHaveBeenCalled();
  });

  it('no-ops (does not record) when outreach is disabled', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const result = await grantCallConsentAction(EVENT, CONTACT);
    expect(result).toEqual({ ok: false, error: 'פנייה לאורחים אינה מופעלת' });
    // authorized first, but no write
    expect(requireEventAccess).toHaveBeenCalledWith(EVENT, 'contacts', 'edit');
    expect(recordCallConsent).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('records consent + a PII-free audit row on the happy path', async () => {
    const result = await grantCallConsentAction(EVENT, CONTACT);
    expect(result).toEqual({ ok: true });
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
    const result = await grantCallConsentAction(EVENT, CONTACT);
    expect(result).toEqual({ ok: false, error: 'שמירת ההסכמה נכשלה' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
