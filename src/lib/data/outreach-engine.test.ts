import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/message-templates', () => ({ resolveTemplateForEvent: vi.fn() }));
vi.mock('@/lib/data/outreach', () => ({
  resolveTemplateMedia: vi.fn(async (template) => ({ template })),
  sendOneWhatsApp: vi.fn(),
  recordTemplateFailure: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({ setContactOpStatus: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
  type WhatsAppConfig,
} from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates';
import { recordTemplateFailure, sendOneWhatsApp } from '@/lib/data/outreach';
import { recordReached } from '@/lib/data/billing';
import { GUEST_FIRST_NAME_FALLBACK } from '@/lib/whatsapp/template-spec';
import {
  stepGate,
  claimStep,
  executeStep,
  writeReach,
  type CampaignContext,
} from '@/lib/data/outreach-engine';

beforeEach(() => vi.clearAllMocks());

const reachArgs = {
  eventId: 'e1',
  campaignId: 'c1',
  contactId: 'k1',
  channel: 'whatsapp' as const,
  attemptId: 'a1',
  evidence: 'inbound_message',
  providerRef: 'wamid.1',
};

describe('stepGate (fail-closed)', () => {
  it('returns paused when outreach is globally disabled — no send', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const r = await stepGate('c1', 'k1', 'e1');
    expect(r.reason).toBe('paused');
    expect(r.ctx).toBeUndefined();
  });
});

describe('stepGate — L1 past-event stop (live event_date)', () => {
  it('stops an active campaign once the event day is past in Israel', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    // One combined row serves both getCampaignContext reads (campaigns + events);
    // the mock ignores the table name and returns the same result per await.
    const ctxRow = {
      status: 'active',
      event_id: 'e1',
      allowed_channels: ['whatsapp'],
      start_at: null,
      close_at: null, // close_at gate must NOT be what stops it — event_date does
      outreach_schedule: [],
      event_date: '2026-06-22T00:00:00+00:00', // 8 days before NOW
    };
    const { client } = createMockSupabase<typeof ctxRow>({
      data: ctxRow,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const NOW = Date.parse('2026-06-30T08:00:00Z');
    const r = await stepGate('c1', 'k1', 'e1', NOW);
    expect(r.reason).toBe('stopped');
  });
});

// S2.4 — R9: defense-in-depth on top of the DB trigger
// (campaigns_require_active_event) + R7's structural guarantee. Genuinely
// redundant under normal DB operation but required explicitly per the plan's
// "ALL commercial paths" list.
describe('stepGate — R9 active-event stop', () => {
  it('stops an active campaign whose event is not active', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: {
            status: 'active',
            event_id: 'e1',
            allowed_channels: ['whatsapp'],
            start_at: null,
            close_at: null,
            outreach_schedule: [],
          },
          error: null,
        }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: { event_date: '2999-01-01T00:00:00+00:00', status: 'closed' },
          error: null,
        }),
      );

    const r = await stepGate('c1', 'k1', 'e1');

    expect(r.reason).toBe('stopped');
  });
});

describe('claimStep (compare-and-advance)', () => {
  it('wins (true) when the guarded update advances the cursor', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'os1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const won = await claimStep('c1', 'k1', 2);
    expect(builder.update).toHaveBeenCalledWith({ current_step_index: 3 });
    expect(builder.eq).toHaveBeenCalledWith('current_step_index', 2);
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(won).toBe(true);
  });

  it('loses (false) when no row matched (duplicate delivery)', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    expect(await claimStep('c1', 'k1', 2)).toBe(false);
  });
});

describe('writeReach (shared reach path — stop on billed)', () => {
  it('on billed: records via the RPC AND stops the contact outreach', async () => {
    vi.mocked(recordReached).mockResolvedValue('billed');
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const outcome = await writeReach(reachArgs);
    expect(outcome).toBe('billed');
    expect(recordReached).toHaveBeenCalledWith(reachArgs); // campaignId+attemptId carried
    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe('reached');
  });

  it('on already_billed: does NOT touch outreach_state (no double-stop)', async () => {
    vi.mocked(recordReached).mockResolvedValue('already_billed');
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const outcome = await writeReach(reachArgs);
    expect(outcome).toBe('already_billed');
    expect(builder.update).not.toHaveBeenCalled();
  });
});

// §5.6 — a broken outreach_schedule touchpoint must never send, and must be
// recorded durably through recordTemplateFailure (now shared via outreach.ts;
// its atomic-upsert/UNIQUE-conflict-key DB contract is pinned in
// outreach.test.ts). Here we pin WHEN the engine records and with which
// (campaign, touchpoint, reason, key, channel) identity.
// 2026-07-20 18:00 UTC = Monday 21:00 in Israel (IDT, UTC+3) — same anchor as
// template-spec.test.ts, so the expected {{4}}–{{6}} strings are known.
const MONDAY_EVENING = '2026-07-20T18:00:00+00:00';

// A fully-bindable event context; per-test event overrides knock ingredients
// out for the fail-closed matrix.
const makeCtx = (
  messageKey: string,
  eventOverrides: Partial<CampaignContext['event']> = {},
): CampaignContext => ({
  status: 'active',
  event_id: 'e1',
  allowed_channels: ['whatsapp'],
  start_at: null,
  close_at: null,
  schedule: [{ days_before: 7, channel: 'whatsapp', message_key: messageKey }],
  eventDate: '2999-01-01T00:00:00+00:00',
  eventStatus: 'active',
  inviteImagePath: null,
  event: {
    name: 'החתונה של דוד ושרה',
    event_type: 'wedding',
    event_date: MONDAY_EVENING,
    venue_name: 'אולמי הגן',
    venue_address: 'דרך השלום 10, תל אביב',
    celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
    ...eventOverrides,
  },
});

const waConfig: WhatsAppConfig = {
  phoneNumberId: 'pn1',
  wabaId: null,
  accessToken: 'token',
  appSecret: null,
  verifyToken: null,
};

// Sequence one executeStep run on the shared builder: await #1 is the
// contacts read (eligible, consented), await #2 is claimStep's guarded
// update (the claim WINS). Any later await — the guest-name read, the
// failure upsert, bumpCount — falls back to the builder's default result
// unless the test chains more mockImplementationOnce calls onto the
// returned spy.
const sequenceRun = (
  builder: MockQueryBuilder<Record<string, unknown>>,
  contactId: string,
) =>
  vi
    .spyOn(builder, 'then')
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: {
          id: contactId,
          normalized_phone: '972500000001',
          removal_requested: false,
          whatsapp_consent_at: '2026-01-01T00:00:00+00:00',
        },
        error: null,
      }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: { id: 'os1' }, error: null }),
    );

describe('executeStep — runtime template integrity (§5.6)', () => {

  it('wrong message_key → no send, one deduped template_missing record; a repeat contact records the SAME failure key', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(waConfig);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(null);
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    sequenceRun(builder, 'k1');
    const r1 = await executeStep(makeCtx('bogus_key'), 'c1', 'k1', 'e1', 0);

    // (א) the broken touchpoint never sends.
    expect(r1).toEqual({ action: 'skipped' });
    expect(sendOneWhatsApp).not.toHaveBeenCalled();

    // (ב) exactly one sink record with the full failure identity — the
    // (campaign_id, touchpoint_index, reason) dedup happens inside
    // recordTemplateFailure's atomic upsert (contract pinned in outreach.test.ts).
    expect(recordTemplateFailure).toHaveBeenCalledTimes(1);
    expect(recordTemplateFailure).toHaveBeenCalledWith(
      expect.anything(), // the engine's admin client
      'c1',
      0,
      'template_missing',
      'bogus_key',
      'whatsapp',
    );

    // (ג) a second contact hitting the SAME broken touchpoint records
    // IDENTICAL args — same conflict key, so the sink's UNIQUE constraint
    // keeps a single row per (campaign, touchpoint, reason), not N.
    sequenceRun(builder, 'k2');
    const r2 = await executeStep(makeCtx('bogus_key'), 'c1', 'k2', 'e1', 0);
    expect(r2).toEqual({ action: 'skipped' });
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
    expect(recordTemplateFailure).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordTemplateFailure).mock.calls[1]).toEqual(
      vi.mocked(recordTemplateFailure).mock.calls[0],
    );
  });

  it("template resolves on another channel → records reason 'channel_mismatch', no send", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(waConfig);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue({
      name: 'call_script',
      language: 'he',
      channel: 'call',
    });
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    sequenceRun(builder, 'k1');
    const r = await executeStep(makeCtx('call_only_key'), 'c1', 'k1', 'e1', 0);

    expect(r).toEqual({ action: 'skipped' });
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
    expect(recordTemplateFailure).toHaveBeenCalledTimes(1);
    expect(recordTemplateFailure).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      0,
      'channel_mismatch',
      'call_only_key',
      'whatsapp',
    );
  });

  it('missing WhatsApp config is expected fail-closed — skipped WITHOUT a failure record (§5.6 exclusion)', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(null);
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    sequenceRun(builder, 'k1');
    const r = await executeStep(makeCtx('any_key'), 'c1', 'k1', 'e1', 0);

    expect(r).toEqual({ action: 'skipped' });
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
    // !config exits BEFORE template resolution — no template lookup, and no
    // integrity record: logging here would flood the sink in every
    // environment that simply hasn't configured WhatsApp yet.
    expect(resolveTemplateForEvent).not.toHaveBeenCalled();
    expect(recordTemplateFailure).not.toHaveBeenCalled();
  });

  it("incomplete event data (no venue) → records reason 'params_incomplete', no send", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(waConfig);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue({
      name: 'kalfa_event_invite_v2',
      language: 'he',
      channel: 'whatsapp',
    });
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    // await #3 (after contact + claim) is the guest-name read — present here,
    // so the ONLY missing ingredient is the venue.
    sequenceRun(builder, 'k1').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: { full_name: 'דנה כהן' }, error: null }),
    );
    const r = await executeStep(makeCtx('invite', { venue_name: null }), 'c1', 'k1', 'e1', 0);

    // Fail-closed: nothing reaches the provider with an empty {{7}}.
    expect(r).toEqual({ action: 'skipped' });
    expect(sendOneWhatsApp).not.toHaveBeenCalled();
    expect(recordTemplateFailure).toHaveBeenCalledTimes(1);
    expect(recordTemplateFailure).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      0,
      'params_incomplete',
      'invite',
      'whatsapp',
    );
  });
});

// The send-time binding wiring: event-type-aware template resolution, the
// per-recipient guest-name lookup, and the positional params handed to
// sendOneWhatsApp (which forwards them to the client as the body component).
describe('executeStep — send-time parameter binding', () => {
  const wireHappyPath = () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(waConfig);
    vi.mocked(sendOneWhatsApp).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.e' });
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  };

  it('wedding variant end-to-end: resolves by event type and binds groom/bride into {{2}}/{{3}}', async () => {
    const weddingTemplate = {
      name: 'kalfa_wedding_invite_v1',
      language: 'he',
      channel: 'whatsapp' as const,
    };
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(weddingTemplate);
    const { builder } = wireHappyPath();

    // await #3: the guest-name read — full_name's FIRST whitespace token is {{1}}.
    sequenceRun(builder, 'k1').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: { full_name: 'דנה כהן מזרחי' },
        error: null,
      }),
    );
    const r = await executeStep(makeCtx('invite'), 'c1', 'k1', 'e1', 0);

    expect(r).toEqual({ action: 'whatsapp_sent' });
    // Resolution is per the EVENT's type — that is what selects the variant.
    expect(resolveTemplateForEvent).toHaveBeenCalledWith('invite', 'wedding');
    // The guest lookup is scoped to (event, contact), oldest guest first.
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.eq).toHaveBeenCalledWith('contact_id', 'k1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(builder.limit).toHaveBeenCalledWith(1);
    // The full positional contract, wedding family: guest first name, groom,
    // bride, then the Israel-local date parts and the venue line.
    expect(sendOneWhatsApp).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'c1', event_id: 'e1' },
      { id: 'k1', normalized_phone: '972500000001' },
      weddingTemplate,
      waConfig,
      [
        'דנה',
        'דוד לוי',
        'שרה כהן',
        'שני',
        'ו׳ באב תשפ״ו (20.07.2026)',
        '21:00',
        'אולמי הגן, דרך השלום 10, תל אביב',
      ],
      undefined,
    );
    // No integrity failure for a fully-bound send.
    expect(recordTemplateFailure).not.toHaveBeenCalled();
  });

  it('no linked guest → {{1}} falls back to the generic greeting instead of skipping', async () => {
    vi.mocked(resolveTemplateForEvent).mockResolvedValue({
      name: 'kalfa_event_invite_v2',
      language: 'he',
      channel: 'whatsapp',
    });
    const { builder } = wireHappyPath();

    // await #3: no guest row for this contact.
    sequenceRun(builder, 'k1').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: null, error: null }),
    );
    const r = await executeStep(makeCtx('invite'), 'c1', 'k1', 'e1', 0);

    expect(r).toEqual({ action: 'whatsapp_sent' });
    const bodyParams = vi.mocked(sendOneWhatsApp).mock.calls[0][5];
    expect(bodyParams?.[0]).toBe(GUEST_FIRST_NAME_FALLBACK);
    // Generic family: {{2}} is the event-type label, {{3}} the celebrants text.
    expect(bodyParams?.[1]).toBe('חתונה');
    expect(bodyParams?.[2]).toBe('דוד לוי ו־שרה כהן');
  });
});
