import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A table-aware Supabase double: each table resolves to its own `{ data }`.
const rows: Record<string, unknown> = {};
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/data/outreach-config', () => ({
  getWhatsAppConfig: vi.fn(),
  getWhatsAppConsentRequired: vi.fn(),
}));
vi.mock('@/lib/data/outreach', () => ({ sendOneWhatsApp: vi.fn() }));
vi.mock('@/lib/data/whatsapp-template-send', () => ({ resolveWhatsAppSend: vi.fn() }));
vi.mock('@/lib/data/outreach-engine', () => ({ terminalReasonFor: vi.fn() }));
vi.mock('@/lib/data/contact-quota', () => ({ checkContactSeat: vi.fn() }));
vi.mock('@/lib/whatsapp/template-spec', () => ({ deriveGuestFirstName: vi.fn(() => 'דנה') }));
vi.mock('@/lib/whatsapp/client', () => ({ BACKGROUND_SEND_RETRY_BUDGET_MS: 1000 }));

import { sendTemplateToContact } from './template-send';
import { getWhatsAppConfig, getWhatsAppConsentRequired } from '@/lib/data/outreach-config';
import { sendOneWhatsApp } from '@/lib/data/outreach';
import { resolveWhatsAppSend } from '@/lib/data/whatsapp-template-send';
import { terminalReasonFor } from '@/lib/data/outreach-engine';
import { checkContactSeat } from '@/lib/data/contact-quota';

const EID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CTID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INPUT = { eventId: EID, contactId: CTID, messageKey: 'thank_you' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(rows)) delete rows[k];
  rows.events = { id: EID, event_type: 'wedding', invite_image_path: null };
  rows.contacts = { id: CTID, normalized_phone: '+972501234567', removal_requested: false, whatsapp_consent_at: 'x' };
  rows.guests = { full_name: 'דנה כהן' };
  rows.campaigns = { id: CID, status: 'active' };

  vi.mocked(getWhatsAppConfig).mockResolvedValue({} as never);
  vi.mocked(getWhatsAppConsentRequired).mockResolvedValue(true);
  vi.mocked(terminalReasonFor).mockReturnValue(null);
  vi.mocked(resolveWhatsAppSend).mockResolvedValue({
    kind: 'ok',
    template: { name: 't' },
    bodyParams: [],
    extras: {},
  } as never);
  vi.mocked(sendOneWhatsApp).mockResolvedValue({ kind: 'accepted' } as never);
  vi.mocked(checkContactSeat).mockResolvedValue({ allowed: true });
});

describe('sendTemplateToContact — contact-quota seat gate', () => {
  it('the contact holds no seat → waiting_for_quota, nothing is sent', async () => {
    vi.mocked(checkContactSeat).mockResolvedValue({ allowed: false, reason: 'waiting_for_quota' });
    expect(await sendTemplateToContact(INPUT)).toEqual({ ok: false, reason: 'waiting_for_quota' });
    expect(checkContactSeat).toHaveBeenCalledWith(CID, CTID);
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
  });

  it('the contact holds a seat → sent, logged against the campaign', async () => {
    expect(await sendTemplateToContact(INPUT)).toEqual({ ok: true });
    expect(sendOneWhatsApp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendOneWhatsApp).mock.calls[0][1]).toEqual({ id: CID, event_id: EID });
  });

  it('the event has no campaign → the gate is not consulted and the send still happens', async () => {
    delete rows.campaigns;
    expect(await sendTemplateToContact(INPUT)).toEqual({ ok: true });
    expect(checkContactSeat).not.toHaveBeenCalled();
    expect(vi.mocked(sendOneWhatsApp).mock.calls[0][1]).toEqual({ id: '', event_id: EID });
  });

  it('only a cancelled campaign exists → it no longer constrains who may be messaged', async () => {
    rows.campaigns = { id: CID, status: 'cancelled' };
    expect(await sendTemplateToContact(INPUT)).toEqual({ ok: true });
    expect(checkContactSeat).not.toHaveBeenCalled();
  });

  it('consent and opt-out refusals still come first (the seat check is not reached)', async () => {
    vi.mocked(terminalReasonFor).mockReturnValue('removal_requested');
    expect(await sendTemplateToContact(INPUT)).toEqual({ ok: false, reason: 'removal_requested' });
    expect(checkContactSeat).not.toHaveBeenCalled();
  });

  it('a read error in the seat check propagates rather than sending or silently refusing', async () => {
    vi.mocked(checkContactSeat).mockRejectedValue(new Error('בדיקת מכסת אנשי הקשר נכשלה'));
    await expect(sendTemplateToContact(INPUT)).rejects.toThrow('בדיקת מכסת אנשי הקשר נכשלה');
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
  });
});
