import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEmailSender } from '@/lib/email/sender';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  inquiryReminderEmail,
  inquiryClosingWarningEmail,
  inquiryRatingRequestEmail,
} from '@/lib/email/templates';
import {
  getInquiryFollowupEnabled,
  listDueForReminder,
  listDueForWarning,
  listDueForAutoClose,
  runInquiryFollowupSweep,
} from './inquiry-followup';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
vi.mock('@/lib/email/templates', () => ({
  inquiryReminderEmail: vi.fn(() => ({ subject: 'reminder', html: 'h', text: 't' })),
  inquiryClosingWarningEmail: vi.fn(() => ({ subject: 'warning', html: 'h', text: 't' })),
  inquiryRatingRequestEmail: vi.fn(() => ({ subject: 'rating', html: 'h', text: 't' })),
}));

const NOW = Date.parse('2026-08-25T12:00:00Z');
const HOUR = 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getInquiryFollowupEnabled', () => {
  it('returns true only when the column is exactly true', async () => {
    const { client } = createMockSupabase<{ inquiry_followup_enabled: boolean }>({
      data: { inquiry_followup_enabled: true },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(getInquiryFollowupEnabled()).resolves.toBe(true);
  });

  it('fails closed (false) when the row is missing', async () => {
    const { client } = createMockSupabase<{ inquiry_followup_enabled: boolean }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(getInquiryFollowupEnabled()).resolves.toBe(false);
  });

  it('fails closed (false) on a DB error', async () => {
    const { client } = createMockSupabase<{ inquiry_followup_enabled: boolean }>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await expect(getInquiryFollowupEnabled()).resolves.toBe(false);
  });
});

describe('listDueForReminder / listDueForWarning / listDueForAutoClose', () => {
  it('reminder: in_progress + has email + replied >=24h ago + never reminded', async () => {
    const { client, builder } = createMockSupabase<unknown[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await listDueForReminder(client as unknown as ReturnType<typeof createAdminClient>, NOW);

    expect(builder.select).toHaveBeenCalledWith('id, email, name, ref_code, replied_at');
    expect(builder.eq).toHaveBeenCalledWith('status', 'in_progress');
    expect(builder.not).toHaveBeenCalledWith('email', 'is', null);
    expect(builder.not).toHaveBeenCalledWith('replied_at', 'is', null);
    expect(builder.lte).toHaveBeenCalledWith('replied_at', new Date(NOW - 24 * HOUR).toISOString());
    expect(builder.is).toHaveBeenCalledWith('reminder_sent_at', null);
  });

  it('warning: additionally requires a reminder already sent, cutoff at 72h', async () => {
    const { client, builder } = createMockSupabase<unknown[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await listDueForWarning(client as unknown as ReturnType<typeof createAdminClient>, NOW);

    expect(builder.select).toHaveBeenCalledWith('id, email, name, ref_code, replied_at');
    expect(builder.lte).toHaveBeenCalledWith('replied_at', new Date(NOW - 72 * HOUR).toISOString());
    expect(builder.not).toHaveBeenCalledWith('reminder_sent_at', 'is', null);
    expect(builder.is).toHaveBeenCalledWith('closing_warning_sent_at', null);
  });

  it('auto-close: additionally requires a warning already sent, cutoff at 96h', async () => {
    const { client, builder } = createMockSupabase<unknown[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    await listDueForAutoClose(client as unknown as ReturnType<typeof createAdminClient>, NOW);

    expect(builder.select).toHaveBeenCalledWith('id, email, name, ref_code, replied_at');
    expect(builder.lte).toHaveBeenCalledWith('replied_at', new Date(NOW - 96 * HOUR).toISOString());
    expect(builder.not).toHaveBeenCalledWith('closing_warning_sent_at', 'is', null);
    expect(builder.is).toHaveBeenCalledWith('auto_closed_at', null);
  });
});

describe('runInquiryFollowupSweep', () => {
  function mockSend() {
    const send = vi.fn();
    vi.mocked(getEmailSender).mockResolvedValue(
      { send } as unknown as Awaited<ReturnType<typeof getEmailSender>>,
    );
    return send;
  }

  // Two independent builders — one per table — because the sweep now queries
  // inquiry_messages too (the batched lastInboundMessageIds lookup). Routing
  // by table name keeps that lookup from interleaving with the
  // contact_messages select/update sequence that the tests below assert on
  // by ordinal call position.
  function createSweepMocks() {
    const { builder: contactBuilder } = createMockSupabase<unknown>({ data: [], error: null });
    const { builder: messagesBuilder } = createMockSupabase<unknown>({ data: [], error: null });
    const client = {
      from: vi.fn((table: string) => (table === 'inquiry_messages' ? messagesBuilder : contactBuilder)),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { contactBuilder, messagesBuilder };
  }

  // Canned results for the contact_messages builder, keyed by 1-based call
  // order. The sweep processes each tier fully (list -> batched lookup ->
  // per-row loop) before moving to the next tier, so for a single due row
  // the order is deterministic: [tier's list] [update for that row] [the
  // remaining tiers' lists...]. Any call position without an override
  // resolves to an empty/successful default, which is valid both for an
  // empty list select (data: []) and for a successful update (error: null
  // is all the code checks).
  function queueContactResults(
    builder: MockQueryBuilder<unknown>,
    overrides: Record<number, { data: unknown; error: { message: string } | null }>,
  ) {
    let call = 0;
    builder.then = ((onFulfilled: (v: unknown) => unknown) => {
      call += 1;
      return onFulfilled(overrides[call] ?? { data: [], error: null });
    }) as typeof builder.then;
  }

  const REPLIED_AT_1 = '2026-08-20T00:00:00Z';
  const REPLIED_AT_2 = '2026-08-22T09:00:00Z';

  function makeRow(
    overrides: Partial<{
      id: string;
      email: string;
      name: string;
      ref_code: string;
      replied_at: string;
    }> = {},
  ) {
    return {
      id: 'c-1',
      email: 'dana@example.com',
      name: 'דנה',
      ref_code: 'K-1001',
      replied_at: REPLIED_AT_1,
      ...overrides,
    };
  }

  it('sends the reminder email and stamps reminder_sent_at, nothing else', async () => {
    const send = mockSend();
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-1' });
    // call order: 1=reminder list (row), 2=update (default success),
    // 3=warning list (empty), 4=autoclose list (empty)
    queueContactResults(contactBuilder, { 1: { data: [row], error: null } });

    const result = await runInquiryFollowupSweep(NOW);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: row.email,
        subject: 'reminder',
        idempotencyKey: `inquiry-reminder/${row.id}/${row.replied_at}`,
      }),
    );
    expect(inquiryReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: row.name,
        refCode: row.ref_code,
        origin: 'https://beta.kalfa.me',
      }),
    );
    expect(contactBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_sent_at: expect.any(String) }),
    );
    expect(result).toEqual({ reminded: 1, warned: 0, autoClosed: 0, failed: 0 });
  });

  it('sends the closing-warning email and stamps closing_warning_sent_at, nothing else', async () => {
    const send = mockSend();
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-2' });
    // call order: 1=reminder list (empty), 2=warning list (row),
    // 3=update (default success), 4=autoclose list (empty)
    queueContactResults(contactBuilder, { 2: { data: [row], error: null } });

    const result = await runInquiryFollowupSweep(NOW);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: row.email,
        subject: 'warning',
        idempotencyKey: `inquiry-warning/${row.id}/${row.replied_at}`,
      }),
    );
    expect(inquiryClosingWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: row.name,
        refCode: row.ref_code,
        origin: 'https://beta.kalfa.me',
      }),
    );
    expect(contactBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ closing_warning_sent_at: expect.any(String) }),
    );
    expect(result).toEqual({ reminded: 0, warned: 1, autoClosed: 0, failed: 0 });
  });

  it('auto-close claims a rating_token before sending, then sets status=done + auto_closed_at + handled_at', async () => {
    const send = mockSend();
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-3' });
    // call order: 1=reminder list (empty), 2=warning list (empty),
    // 3=autoclose list (row), 4=read current rating_token (none yet, default
    // {data:[],error:null} falls into the "claim a new one" branch),
    // 5=claim-write of rating_token/rating_requested_at (default success),
    // 6=final status update (default success)
    queueContactResults(contactBuilder, { 3: { data: [row], error: null } });

    const result = await runInquiryFollowupSweep(NOW);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: row.email,
        subject: 'rating',
        idempotencyKey: `inquiry-rating/${row.id}/${row.replied_at}`,
      }),
    );
    expect(inquiryRatingRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: row.name,
        refCode: row.ref_code,
        origin: 'https://beta.kalfa.me',
        ratingToken: expect.stringMatching(/^[0-9a-f]{32}$/),
      }),
    );
    // Claimed in its OWN update, before the send — not bundled into the
    // final status update — so a retry within the same cycle reads this
    // back and reuses it instead of generating a new one, keeping the
    // Resend idempotency key's payload byte-identical across retries.
    expect(contactBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        rating_token: expect.stringMatching(/^[0-9a-f]{32}$/),
        rating_requested_at: expect.any(String),
      }),
    );
    expect(contactBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        auto_closed_at: expect.any(String),
        handled_at: expect.any(String),
      }),
    );
    expect(result).toEqual({ reminded: 0, warned: 0, autoClosed: 1, failed: 0 });
  });

  it('auto-close: a retry reuses the already-claimed rating_token instead of generating a new one', async () => {
    const send = mockSend();
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-3b' });
    const EXISTING_TOKEN = 'a'.repeat(32);
    // call order: 1=reminder list (empty), 2=warning list (empty),
    // 3=autoclose list (row), 4=read current rating_token (already claimed
    // by a prior, crashed attempt) — no claim-write this time, 5=final
    // status update (default success)
    queueContactResults(contactBuilder, {
      3: { data: [row], error: null },
      4: { data: { rating_token: EXISTING_TOKEN, rating_requested_at: '2026-08-25T11:00:00Z' }, error: null },
    });

    const result = await runInquiryFollowupSweep(NOW);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `inquiry-rating/${row.id}/${row.replied_at}` }),
    );
    expect(inquiryRatingRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ratingToken: EXISTING_TOKEN }),
    );
    // No second call carrying a fresh rating_token — only the final status
    // update should have run.
    expect(contactBuilder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ rating_token: expect.anything() }),
    );
    expect(result).toEqual({ reminded: 0, warned: 0, autoClosed: 1, failed: 0 });
  });

  it('auto-close: SEND-THEN-PERSIST for the final status — a failed email send never writes status=done, but the claimed rating_token survives for the next retry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp down'));
    vi.mocked(getEmailSender).mockResolvedValue(
      { send } as unknown as Awaited<ReturnType<typeof getEmailSender>>,
    );
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-4' });
    queueContactResults(contactBuilder, { 3: { data: [row], error: null } });

    const result = await runInquiryFollowupSweep(NOW);

    // The token claim happens (and persists) even though the send then
    // fails — that's the fix: the NEXT tick's retry must find this same
    // token already on the row and reuse it, not generate a different one.
    expect(contactBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ rating_token: expect.stringMatching(/^[0-9a-f]{32}$/) }),
    );
    expect(contactBuilder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    );
    expect(result).toEqual({ reminded: 0, warned: 0, autoClosed: 0, failed: 1 });
  });

  it('one row failing does not block the others, and is counted in failed', async () => {
    mockSend();
    const { contactBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-5' });
    // call order: 1=reminder list (row), 2=update (forced error),
    // 3=warning list (empty), 4=autoclose list (empty)
    queueContactResults(contactBuilder, {
      1: { data: [row], error: null },
      2: { data: null, error: { message: 'boom' } },
    });

    const result = await runInquiryFollowupSweep(NOW);

    expect(result).toEqual({ reminded: 0, warned: 0, autoClosed: 0, failed: 1 });
  });

  it('idempotencyKey differs across two replied_at values for the same row id (reopen cascade)', async () => {
    // First cascade cycle.
    const send1 = mockSend();
    const { contactBuilder: cb1 } = createSweepMocks();
    queueContactResults(cb1, {
      1: { data: [makeRow({ id: 'c-dup', replied_at: REPLIED_AT_1 })], error: null },
    });
    await runInquiryFollowupSweep(NOW);
    const key1 = (send1.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;

    // Customer replies again (reopen), admin replies again, and a second
    // cascade cycle starts for the SAME contact_messages.id with a fresh
    // replied_at.
    const send2 = mockSend();
    const { contactBuilder: cb2 } = createSweepMocks();
    queueContactResults(cb2, {
      1: { data: [makeRow({ id: 'c-dup', replied_at: REPLIED_AT_2 })], error: null },
    });
    await runInquiryFollowupSweep(NOW);
    const key2 = (send2.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;

    expect(key1).toBe(`inquiry-reminder/c-dup/${REPLIED_AT_1}`);
    expect(key2).toBe(`inquiry-reminder/c-dup/${REPLIED_AT_2}`);
    expect(key1).not.toBe(key2);
  });

  it('batches the inbound-message lookup once per tier, not once per row', async () => {
    mockSend();
    const { contactBuilder, messagesBuilder } = createSweepMocks();
    const rowA = makeRow({ id: 'c-a', email: 'a@example.com' });
    const rowB = makeRow({ id: 'c-b', email: 'b@example.com' });
    const rowC = makeRow({ id: 'c-c', email: 'c@example.com' });
    const rowD = makeRow({ id: 'c-d', email: 'd@example.com' });
    // Two rows due in EACH of two tiers (reminder + warning), so "once per
    // tier" (2 lookup calls) is actually distinguishable from "once total"
    // (1 call) — not just from "once per row" (4 calls). Call order:
    // 1=reminder list (2 rows), 2-3=updates for those rows, 4=warning list
    // (2 rows), 5-6=updates for those rows, 7=autoclose list (empty).
    queueContactResults(contactBuilder, {
      1: { data: [rowA, rowB], error: null },
      4: { data: [rowC, rowD], error: null },
    });

    const result = await runInquiryFollowupSweep(NOW);

    expect(messagesBuilder.select).toHaveBeenCalledTimes(2);
    expect(messagesBuilder.in).toHaveBeenNthCalledWith(1, 'inquiry_id', ['c-a', 'c-b']);
    expect(messagesBuilder.in).toHaveBeenNthCalledWith(2, 'inquiry_id', ['c-c', 'c-d']);
    expect(result).toEqual({ reminded: 2, warned: 2, autoClosed: 0, failed: 0 });
  });

  it('passes inReplyTo from the batched inbound-message lookup when present', async () => {
    const send = mockSend();
    const { contactBuilder, messagesBuilder } = createSweepMocks();
    const row = makeRow({ id: 'c-thread' });
    queueContactResults(contactBuilder, { 1: { data: [row], error: null } });
    messagesBuilder.then = ((onFulfilled: (v: unknown) => unknown) =>
      onFulfilled({
        data: [{ inquiry_id: 'c-thread', message_id: '<abc123@mail.example>' }],
        error: null,
      })) as typeof messagesBuilder.then;

    await runInquiryFollowupSweep(NOW);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: '<abc123@mail.example>' }));
    expect(messagesBuilder.eq).toHaveBeenCalledWith('direction', 'inbound');
    expect(messagesBuilder.not).toHaveBeenCalledWith('message_id', 'is', null);
    expect(messagesBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('emits no Slack alert on a fully quiet tick (nothing due)', async () => {
    createSweepMocks();
    await runInquiryFollowupSweep(NOW);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
