import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import {
  handleHeadcountReply,
  requestHeadcount,
  HEADCOUNT_QUESTION,
  headcountQuestionFor,
  HEADCOUNT_ACK,
} from './headcount';

const CONFIG = { phoneNumberId: 'PNID', accessToken: 'TKN', appSecret: null };

// Chainable builder: every op returns itself; awaiting resolves the response.
function makeAdmin(responses: Record<string, unknown[]>) {
  const calls: Record<string, unknown[][]> = { update: [] };
  const queues: Record<string, unknown[]> = { ...responses };
  const client = {
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {};
      const chain = new Proxy(b, {
        get(_t, prop: string) {
          if (prop === 'then') {
            const next = (queues[table] ?? []).shift() ?? { data: null, error: null };
            return (resolve: (v: unknown) => void) => resolve(next);
          }
          return (...args: unknown[]) => {
            if (prop === 'update') calls.update.push([table, args[0]]);
            return chain;
          };
        },
      });
      return chain;
    }),
  };
  return { client, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('handleHeadcountReply', () => {
  const AWAITING = { data: [{ id: 'g1', headcount_attempts: 1 }], error: null };
  const PHONE = { data: { normalized_phone: '+972501111111' }, error: null };

  it('saves 1-10, stamps answered_at, and sends the ack', async () => {
    const { client, calls } = makeAdmin({ guests: [AWAITING, {}], contacts: [PHONE] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);
    vi.mocked(sendWhatsAppText).mockResolvedValue({ providerId: 'w1' });

    const consumed = await handleHeadcountReply('e1', 'c1', ' 7 ');

    expect(consumed).toBe(true);
    const upd = calls.update.find(([t]) => t === 'guests')?.[1] as Record<string, unknown>;
    expect(upd.confirmed_headcount).toBe(7);
    expect(upd.confirmed_adults).toBe(7);
    expect(upd.confirmed_kids).toBe(0);
    expect(upd.headcount_answered_at).toBeTruthy();
    expect(sendWhatsAppText).toHaveBeenCalledWith(CONFIG, {
      to: '+972501111111',
      body: HEADCOUNT_ACK,
    });
  });

  it('"0" re-asks the question and increments the attempt counter', async () => {
    const { client, calls } = makeAdmin({ guests: [AWAITING, {}], contacts: [PHONE] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);
    vi.mocked(sendWhatsAppText).mockResolvedValue({ providerId: 'w2' });

    const consumed = await handleHeadcountReply('e1', 'c1', '0');

    expect(consumed).toBe(true);
    expect(sendWhatsAppText).toHaveBeenCalledWith(CONFIG, {
      to: '+972501111111',
      body: HEADCOUNT_QUESTION,
    });
    const upd = calls.update.find(([t]) => t === 'guests')?.[1] as Record<string, unknown>;
    expect(upd.headcount_attempts).toBe(2);
  });

  it('"0" at the attempts cap is consumed WITHOUT another send (no nag loop)', async () => {
    const capped = { data: [{ id: 'g1', headcount_attempts: 3 }], error: null };
    const { client, calls } = makeAdmin({ guests: [capped] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);

    const consumed = await handleHeadcountReply('e1', 'c1', '0');

    expect(consumed).toBe(true);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(calls.update).toHaveLength(0);
  });

  it('non-numeric text is not consumed (stays default 0, no messages)', async () => {
    const { client } = makeAdmin({});
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    expect(await handleHeadcountReply('e1', 'c1', 'תודה רבה!')).toBe(false);
    expect(await handleHeadcountReply('e1', 'c1', '11')).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('ambiguous contact (two awaiting guests) is never guessed', async () => {
    const two = { data: [{ id: 'g1', headcount_attempts: 1 }, { id: 'g2', headcount_attempts: 1 }], error: null };
    const { client } = makeAdmin({ guests: [two] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    expect(await handleHeadcountReply('e1', 'c1', '5')).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe('requestHeadcount', () => {
  it('sends the question and stamps requested_at/attempts=1', async () => {
    const PHONE = { data: { normalized_phone: '+972501111111' }, error: null };
    const { client, calls } = makeAdmin({ contacts: [PHONE], guests: [{ data: { headcount_answered_at: null }, error: null }, {}] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);
    vi.mocked(sendWhatsAppText).mockResolvedValue({ providerId: 'w3' });

    await requestHeadcount('g1', 'c1');

    expect(sendWhatsAppText).toHaveBeenCalledWith(CONFIG, {
      to: '+972501111111',
      body: HEADCOUNT_QUESTION,
    });
    const upd = calls.update.find(([t]) => t === 'guests')?.[1] as Record<string, unknown>;
    expect(upd.headcount_attempts).toBe(1);
    expect(upd.headcount_requested_at).toBeTruthy();
  });

  it('send failure is fail-soft: no request marker is written', async () => {
    const PHONE = { data: { normalized_phone: '+972501111111' }, error: null };
    const { client, calls } = makeAdmin({ contacts: [PHONE], guests: [{ data: { headcount_answered_at: null }, error: null }] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);
    vi.mocked(sendWhatsAppText).mockRejectedValue(new Error('down'));

    await requestHeadcount('g1', 'c1');

    expect(calls.update).toHaveLength(0);
  });
});

describe('requestHeadcount — no double ask', () => {
  it('skips entirely when the guest already answered (web page or earlier round)', async () => {
    const { client, calls } = makeAdmin({
      guests: [{ data: { headcount_answered_at: '2026-07-05T10:00:00Z' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);

    await requestHeadcount('g1', 'c1');

    expect(sendWhatsAppText).not.toHaveBeenCalled();
    expect(calls.update).toHaveLength(0);
  });
});

describe('headcountQuestionFor', () => {
  it('mentions the invited size when present — informational, never a cap', () => {
    const q = headcountQuestionFor(4);
    expect(q).toContain('כ־4 אנשים');
    expect(q).toContain('(1–10)');
  });

  it('falls back to the base question without an invited size', () => {
    expect(headcountQuestionFor(null)).toBe(HEADCOUNT_QUESTION);
    expect(headcountQuestionFor(0)).toBe(HEADCOUNT_QUESTION);
  });
});

describe('personalized re-ask', () => {
  it('"0" re-asks WITH the invited size when the guest has one', async () => {
    const awaiting = {
      data: [{ id: 'g1', headcount_attempts: 1, expected_count: 4 }],
      error: null,
    };
    const phone = { data: { normalized_phone: '+972501111111' }, error: null };
    const { client } = makeAdmin({ guests: [awaiting, {}], contacts: [phone] });
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(CONFIG as never);
    vi.mocked(sendWhatsAppText).mockResolvedValue({ providerId: 'w9' });

    await handleHeadcountReply('e1', 'c1', '0');

    expect(sendWhatsAppText).toHaveBeenCalledWith(CONFIG, {
      to: '+972501111111',
      body: headcountQuestionFor(4),
    });
  });
});
