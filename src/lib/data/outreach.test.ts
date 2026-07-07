import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/message-templates', () => ({ resolveTemplateForEvent: vi.fn() }));
vi.mock('@/lib/data/contacts', () => ({ listSendableContacts: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates';
import { listSendableContacts } from '@/lib/data/contacts';
import { sendWhatsAppTemplate } from '@/lib/whatsapp/client';
import { GUEST_FIRST_NAME_FALLBACK } from '@/lib/whatsapp/template-spec';
import {
  MANUAL_SEND_TOUCHPOINT_INDEX,
  recordTemplateFailure,
  sendCampaignWhatsApp,
} from '@/lib/data/outreach';

const config = {
  phoneNumberId: 'PNID',
  wabaId: null,
  accessToken: 'TKN',
  appSecret: null,
  verifyToken: null,
};

const activeCampaignRow = {
  id: 'c1',
  event_id: 'e1',
  status: 'active',
  allowed_channels: ['whatsapp'],
};

// 2999-01-07 19:00 UTC = Monday 21:00 in Israel (IST, UTC+2) — far future so
// the L1 past-event gate never trips as the calendar advances, with known
// Israel-local weekday/date/time strings for the positional params.
const FAR_FUTURE_MONDAY = '2999-01-07T19:00:00+00:00';

// A fully-bindable wedding event row, as the widened events select returns it.
const bindableEventRow = {
  event_date: FAR_FUTURE_MONDAY,
  status: 'active',
  name: 'החתונה של דוד ושרה',
  event_type: 'wedding',
  venue_name: 'אולמי הגן',
  venue_address: 'דרך השלום 10, תל אביב',
  celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
};

const genericTemplate = {
  name: 'kalfa_event_invite_v2',
  language: 'he',
  channel: 'whatsapp' as const,
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

// Sequence one sendCampaignWhatsApp run on the shared builder: await #1 is the
// campaign read, await #2 the events read, await #3 the BATCHED guest-names
// read (an array). Later awaits — the per-send interaction upserts — fall back
// to the builder's default result (data:null, error:null → logged OK).
function sequenceRun(
  builder: MockQueryBuilder<Row>,
  eventRow: Row,
  guestRows: Array<{ contact_id: string; full_name: string }>,
) {
  return vi
    .spyOn(builder, 'then')
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: activeCampaignRow, error: null }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: eventRow, error: null }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: guestRows, error: null }),
    );
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

  // S2.4 — R9: defense-in-depth on top of the DB trigger (campaigns_require_
  // active_event); campaign.status='active' structurally implies event.status
  // was 'active' at SOME point (R9's DB trigger), but R7 also guarantees the
  // event can't have moved to 'closed' while this campaign stayed 'active' — so
  // this check is genuinely redundant under normal DB operation. It exists
  // anyway, explicitly, per the plan's "ALL commercial paths" requirement.
  it('skips when the event itself is not active, even with an active campaign', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    // Wire the SAME happy-path deps as "sends the template..." below, so this
    // test fails for the right reason (the event-status guard) and not
    // because of an unrelated earlier guard (no template/contacts mocked).
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(genericTemplate);
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
    ]);
    const { builder } = mockAdmin(null);
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: activeCampaignRow, error: null }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: { ...bindableEventRow, status: 'closed' },
          error: null,
        }),
      );

    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');

    expect(r).toEqual({ sent: 0, skipped: 0 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('skips a past event — sent:0, no provider call, even with a valid template + contacts (L1)', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(genericTemplate);
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.x' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
    ]);
    mockAdmin({
      ...activeCampaignRow,
      // The combined-row mock serves both the campaign and events reads.
      event_date: '2020-01-01T00:00:00+00:00', // 6 years past
    });

    const r = await sendCampaignWhatsApp('c1', 'rsvp_invite');

    expect(r).toEqual({ sent: 0, skipped: 0 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('sends the template to each eligible contact with bound params and logs an outbound interaction', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(genericTemplate);
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.x' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
      { id: 'k2', normalized_phone: '+972502222222' },
    ]);
    const { client, builder } = mockAdmin(null);
    // k1 has TWO linked guests (family on one phone) — the oldest-first read
    // makes the FIRST row the deterministic pick; k2 has no guest at all.
    sequenceRun(builder, bindableEventRow, [
      { contact_id: 'k1', full_name: 'דנה כהן מזרחי' },
      { contact_id: 'k1', full_name: 'יוסי כהן' },
    ]);

    const r = await sendCampaignWhatsApp('c1', 'invite');

    expect(r).toEqual({ sent: 2, skipped: 0 });
    // Resolution is event-type-aware (the wedding variant swap happens there).
    expect(resolveTemplateForEvent).toHaveBeenCalledWith('invite', 'wedding');
    // ONE batched guest-names read for the whole set — not per contact.
    expect(builder.in).toHaveBeenCalledWith('contact_id', ['k1', 'k2']);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(2);
    // k1: {{1}} = first whitespace token of the OLDEST linked guest's name.
    expect(sendWhatsAppTemplate).toHaveBeenNthCalledWith(
      1,
      { phoneNumberId: 'PNID', accessToken: 'TKN', appSecret: null },
      {
        to: '+972501111111',
        templateName: 'kalfa_event_invite_v2',
        language: 'he',
        bodyParams: [
          'דנה',
          'חתונה',
          'דוד לוי ו־שרה כהן',
          'שני',
          'כ״ז בטבת תשנ״ט (07.01.2999)',
          '21:00',
          'אולמי הגן, דרך השלום 10, תל אביב',
        ],
      },
    );
    // k2 has no linked guest → the {{1}} greeting falls back, send still goes.
    const second = vi.mocked(sendWhatsAppTemplate).mock.calls[1][1];
    expect(second.bodyParams?.[0]).toBe(GUEST_FIRST_NAME_FALLBACK);
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
    // A fully-bound batch writes NO integrity-failure record.
    expect(client.from).not.toHaveBeenCalledWith('outreach_template_failures');
  });

  it('binds the WEDDING family (groom/bride in {{2}}/{{3}}) when resolution returns the variant name', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue({
      name: 'kalfa_wedding_invite_v1',
      language: 'he',
      channel: 'whatsapp',
    });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.w' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
    ]);
    const { builder } = mockAdmin(null);
    sequenceRun(builder, bindableEventRow, [
      { contact_id: 'k1', full_name: 'דנה כהן' },
    ]);

    const r = await sendCampaignWhatsApp('c1', 'invite');

    expect(r).toEqual({ sent: 1, skipped: 0 });
    expect(vi.mocked(sendWhatsAppTemplate).mock.calls[0][1].bodyParams).toEqual([
      'דנה',
      'דוד לוי',
      'שרה כהן',
      'שני',
      'כ״ז בטבת תשנ״ט (07.01.2999)',
      '21:00',
      'אולמי הגן, דרך השלום 10, תל אביב',
    ]);
  });

  it('fail-closed on incomplete event data: no venue → every contact skipped, ZERO provider calls, ONE params_incomplete sink record', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(genericTemplate);
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.x' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
      { id: 'k2', normalized_phone: '+972502222222' },
    ]);
    const { client, builder } = mockAdmin(null);
    sequenceRun(builder, { ...bindableEventRow, venue_name: null }, [
      { contact_id: 'k1', full_name: 'דנה כהן' },
    ]);

    const r = await sendCampaignWhatsApp('c1', 'invite');

    expect(r).toEqual({ sent: 0, skipped: 2 });
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
    // The §5.6 sink wiring on the MANUAL path (plan: "אותו חיווט גם במסלול
    // הידני"): the missing-params verdict is event-level, so one durable
    // record covers the whole batch — keyed by the manual-path sentinel index
    // (the sink has no real touchpoint here) and deduped by the same
    // UNIQUE(campaign_id, touchpoint_index, reason) contract as the engine.
    expect(client.from).toHaveBeenCalledWith('outreach_template_failures');
    expect(builder.upsert).toHaveBeenCalledTimes(1);
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        campaign_id: 'c1',
        touchpoint_index: MANUAL_SEND_TOUCHPOINT_INDEX,
        reason: 'params_incomplete',
        message_key: 'invite',
        channel: 'whatsapp',
      },
      { onConflict: 'campaign_id,touchpoint_index,reason', ignoreDuplicates: true },
    );
  });

  it('counts a failed send as skipped without aborting the batch', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(genericTemplate);
    vi.mocked(sendWhatsAppTemplate)
      .mockRejectedValueOnce(new Error('meta down'))
      .mockResolvedValue({ kind: 'accepted', providerId: 'wamid.ok' });
    vi.mocked(listSendableContacts).mockResolvedValue([
      { id: 'k1', normalized_phone: '+972501111111' },
      { id: 'k2', normalized_phone: '+972502222222' },
    ]);
    const { builder } = mockAdmin(null);
    sequenceRun(builder, bindableEventRow, [
      { contact_id: 'k1', full_name: 'דנה כהן' },
      { contact_id: 'k2', full_name: 'יוסי לוי' },
    ]);

    const r = await sendCampaignWhatsApp('c1', 'invite');
    expect(r).toEqual({ sent: 1, skipped: 1 });
  });
});

// §5.6 — the shared sink write (engine executeStep + manual batch path). The
// DB-level dedup contract lives HERE, once: ONE atomic upsert whose
// (campaign_id, touchpoint_index, reason) conflict key matches the sink's
// UNIQUE constraint — never select-then-insert, since concurrent workers can
// hit the same broken touchpoint for different contacts at once.
describe('recordTemplateFailure', () => {
  const asAdmin = (client: unknown) =>
    client as ReturnType<typeof createAdminClient>;

  it('writes one atomic upsert matching the sink UNIQUE constraint', async () => {
    const { client, builder } = createMockSupabase<Row>({ data: null, error: null });

    await recordTemplateFailure(
      asAdmin(client),
      'c1',
      2,
      'template_missing',
      'bogus_key',
      'whatsapp',
    );

    expect(client.from).toHaveBeenCalledWith('outreach_template_failures');
    expect(builder.upsert).toHaveBeenCalledTimes(1);
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        campaign_id: 'c1',
        touchpoint_index: 2,
        reason: 'template_missing',
        message_key: 'bogus_key',
        channel: 'whatsapp',
      },
      { onConflict: 'campaign_id,touchpoint_index,reason', ignoreDuplicates: true },
    );
  });

  it('a failing sink write logs code/message only and never throws (skip semantics unchanged)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { client } = createMockSupabase<Row>({
        data: null,
        error: { message: 'insert blocked' },
      });

      await expect(
        recordTemplateFailure(
          asAdmin(client),
          'c1',
          MANUAL_SEND_TOUCHPOINT_INDEX,
          'params_incomplete',
          'invite',
          'whatsapp',
        ),
      ).resolves.toBeUndefined();

      // Visible, but PII-free: the log carries only the provider error
      // code/message — never a guest name, phone, or token.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[outreach] template-failure sink write failed',
        undefined,
        'insert blocked',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
