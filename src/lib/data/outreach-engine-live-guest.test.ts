import { beforeEach, describe, expect, it, vi } from 'vitest';

// prepareAndSendStep's skip paths.
// - no_live_guest (package-outreach-admission-safety D3): a contact kept on the list after its guest was removed receives
//   no new outreach. For a campaign with a package quota the skip runs whatever RECONCILE_AUTHORIZED_SET_ENABLED says; for
//   a campaign without one it stays switch-gated, as before.
// - a WhatsApp step whose message cannot be built never sends and is recorded durably (recordTemplateFailure).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
  getSendPolicy: vi.fn(),
}));
vi.mock('@/lib/data/reconcile-config', () => ({ isReconcileEnabled: vi.fn() }));
vi.mock('@/lib/data/whatsapp-template-send', () => ({ resolveWhatsAppSend: vi.fn() }));
vi.mock('@/lib/data/outreach', () => ({ recordTemplateFailure: vi.fn(), sendOneWhatsApp: vi.fn() }));

import type { PgBoss } from 'pg-boss';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { recordTemplateFailure, sendOneWhatsApp } from '@/lib/data/outreach';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';
import { resolveWhatsAppSend } from '@/lib/data/whatsapp-template-send';
import { prepareAndSendStep, type CampaignContext } from '@/lib/data/outreach-engine';

const ctx = (contactQuota: number | null): CampaignContext => ({
  status: 'active',
  event_id: 'e1',
  allowed_channels: ['whatsapp'],
  start_at: null,
  close_at: null,
  schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'invite' }],
  eventDate: '2999-01-01T00:00:00+00:00',
  eventStatus: 'active',
  rsvpDeadline: null,
  inviteImagePath: null,
  contactQuota,
  event: {
    name: 'אירוע',
    event_type: 'wedding',
    event_date: '2999-01-01T00:00:00+00:00',
    venue_name: null,
    venue_address: null,
    celebrants: null,
  },
});

// contacts: the contact, eligible; guests: no live guest left (count 0). Anything later stops at the WhatsApp config,
// mocked absent, so the answer names which check ended the step.
function mockDb() {
  const from = vi.fn((table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'maybeSingle', 'order', 'limit']) b[m] = vi.fn(() => b);
    const result =
      table === 'contacts'
        ? { data: { id: 'k1', normalized_phone: '+972500000001' }, error: null }
        : { data: null, error: null, count: 0 };
    (b as { then: unknown }).then = (f: (v: unknown) => unknown) => f(result);
    return b;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return from;
}

const boss = {} as PgBoss;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWhatsAppConfig).mockResolvedValue(null);
});

describe('prepareAndSendStep — no_live_guest', () => {
  it('switch off + a package campaign → the contact with no live guest is skipped', async () => {
    vi.mocked(isReconcileEnabled).mockReturnValue(false);
    const from = mockDb();

    await expect(prepareAndSendStep(boss, ctx(100), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({ kind: 'skip', reason: 'no_live_guest' });
    expect(from).toHaveBeenCalledWith('guests');
  });

  it('switch off + a campaign without a quota → today’s behavior: no live-guest check', async () => {
    vi.mocked(isReconcileEnabled).mockReturnValue(false);
    const from = mockDb();

    await expect(prepareAndSendStep(boss, ctx(null), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({
      kind: 'skip',
      reason: 'whatsapp_not_configured',
    });
    expect(from).not.toHaveBeenCalledWith('guests');
  });

  it('switch on → skipped for either campaign kind', async () => {
    vi.mocked(isReconcileEnabled).mockReturnValue(true);
    mockDb();

    await expect(prepareAndSendStep(boss, ctx(null), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({ kind: 'skip', reason: 'no_live_guest' });
    await expect(prepareAndSendStep(boss, ctx(100), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({ kind: 'skip', reason: 'no_live_guest' });
  });
});
describe('prepareAndSendStep — a message that cannot be built', () => {
  it.each(['template_missing', 'channel_mismatch'] as const)(
    '%s → no send; the failure is recorded for the step and the outcome names the reason',
    async (reason) => {
      vi.mocked(isReconcileEnabled).mockReturnValue(false);
      mockDb();
      vi.mocked(getWhatsAppConfig).mockResolvedValue({
        phoneNumberId: 'pn1',
        wabaId: null,
        accessToken: 'token',
        appSecret: null,
        verifyToken: null,
      });
      vi.mocked(resolveWhatsAppSend).mockResolvedValue({ kind: reason });

      await expect(prepareAndSendStep(boss, ctx(null), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({ kind: 'skip', reason });
      expect(sendOneWhatsApp).not.toHaveBeenCalled();
      expect(recordTemplateFailure).toHaveBeenCalledTimes(1);
      expect(recordTemplateFailure).toHaveBeenCalledWith(expect.anything(), 'camp1', 0, reason, 'invite', 'whatsapp');
    },
  );

  it('a missing WhatsApp config is the expected off state: skipped WITHOUT a failure record', async () => {
    vi.mocked(isReconcileEnabled).mockReturnValue(false);
    mockDb();

    await expect(prepareAndSendStep(boss, ctx(null), 'camp1', 'k1', 'e1', 0)).resolves.toEqual({
      kind: 'skip',
      reason: 'whatsapp_not_configured',
    });
    expect(resolveWhatsAppSend).not.toHaveBeenCalled();
    expect(recordTemplateFailure).not.toHaveBeenCalled();
  });
});
