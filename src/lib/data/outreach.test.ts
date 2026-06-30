import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/message-templates', () => ({ getTemplateByKey: vi.fn() }));
vi.mock('@/lib/data/contacts', () => ({ listSendableContacts: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import { getTemplateByKey } from '@/lib/data/message-templates';
import { listSendableContacts } from '@/lib/data/contacts';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/client';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';

const config = {
  phoneNumberId: 'PNID',
  wabaId: null,
  accessToken: 'TKN',
  appSecret: null,
  verifyToken: null,
};

type Row = Record<string, unknown>;
function mockAdmin(campaign: Row | null) {
  const { client, builder } = createMockSupabase<Row>({
    data: campaign,
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

beforeEach(() => vi.clearAllMocks());

describe('sendCampaignWhatsApp', () => {
  it('does nothing when outreach is disabled (fail-closed)', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');
    expect(r).toEqual({ sent: 0, skipped: 0 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('does nothing when WhatsApp is not configured', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(null);
    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');
    expect(r).toEqual({ sent: 0, skipped: 0 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('does nothing when the campaign is not active', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    mockAdmin({
      id: 'c1',
      event_id: 'e1',
      status: 'draft',
      allowed_channels: ['whatsapp'],
    });
    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');
    expect(r.sent).toBe(0);
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('skips a past event — sent:0, no provider call, even with a valid template + contacts (L1)', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(getTemplateByKey).mockResolvedValue({
      name: 'rsvp_invite',
      language: 'he',
      channel: 'whatsapp',
    });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerId: 'wamid.x' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
    ]);
    mockAdmin({
      id: 'c1',
      event_id: 'e1',
      status: 'active',
      allowed_channels: ['whatsapp'],
      event_date: '2020-01-01T00:00:00+00:00', // 6 years past
    });

    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');

    expect(r).toEqual({ sent: 0, skipped: 0 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('sends the template to each eligible contact and logs an outbound interaction', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(getTemplateByKey).mockResolvedValue({
      name: 'rsvp_invite',
      language: 'he',
      channel: 'whatsapp',
    });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerId: 'wamid.x' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
      { id: 'k2', normalized_phone: '+972502222222' },
    ]);
    const { builder } = mockAdmin({
      id: 'c1',
      event_id: 'e1',
      status: 'active',
      allowed_channels: ['whatsapp'],
    });

    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');

    expect(r).toEqual({ sent: 2, skipped: 0 });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(2);
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        direction: 'out',
        kind: 'template',
        billable: false,
        provider_id: 'wamid.x',
      }),
      { onConflict: 'channel,provider_id', ignoreDuplicates: true },
    );
  });

  it('counts a failed send as skipped without aborting the batch', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(getTemplateByKey).mockResolvedValue({
      name: 'rsvp_invite',
      language: 'he',
      channel: 'whatsapp',
    });
    vi.mocked(sendWhatsAppTemplate)
      .mockRejectedValueOnce(new Error('meta down'))
      .mockResolvedValue({ providerId: 'wamid.ok' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
      { id: 'k2', normalized_phone: '+972502222222' },
    ]);
    mockAdmin({
      id: 'c1',
      event_id: 'e1',
      status: 'active',
      allowed_channels: ['whatsapp'],
    });

    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');
    expect(r).toEqual({ sent: 1, skipped: 1 });
  });
});
