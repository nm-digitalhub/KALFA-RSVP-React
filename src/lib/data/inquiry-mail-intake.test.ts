import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/microsoft/graph-client', () => ({
  graphConfigured: vi.fn(() => true),
  primaryMailbox: vi.fn(() => 'owner@kalfa.me'),
}));
vi.mock('@/lib/microsoft/mail', async () => {
  // flattenForDrafter is pure and is exactly what the drafter reads, so the
  // real one is used — mocking it would hide the thing most worth asserting.
  const actual = await vi.importActual<typeof import('@/lib/microsoft/mail')>(
    '@/lib/microsoft/mail',
  );
  return {
    flattenForDrafter: actual.flattenForDrafter,
    fetchInboundMail: vi.fn(),
    ensureMailFolder: vi.fn(),
  };
});
vi.mock('@/lib/microsoft/subscriptions', () => ({
  ensureIntakeSubscription: vi.fn(),
  intakeFolderName: vi.fn(() => 'KALFA-Intake'),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { intakeMailAsInquiry } from '@/lib/data/inquiry-mail-intake';
import { fetchInboundMail, type InboundMail } from '@/lib/microsoft/mail';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

type UpsertArgs = { row: Record<string, unknown>; opts: Record<string, unknown> };

/** Minimal supabase double that records the upsert and returns `rows`. */
function mockAdmin(rows: Array<{ id: string }>, captured: UpsertArgs[]) {
  const chain = {
    upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
      captured.push({ row, opts });
      return { select: () => Promise.resolve({ data: rows, error: null }) };
    },
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => chain,
  } as unknown as ReturnType<typeof createAdminClient>);
}

function mail(overrides: Partial<InboundMail> = {}): InboundMail {
  return {
    id: 'AAkALgAA',
    internetMessageId: '<abc@example.com>',
    conversationId: 'conv-1',
    subject: 'שאלה על חבילה',
    fromName: 'דנה לוי',
    fromAddress: 'dana@example.com',
    receivedAt: '2026-08-16T09:00:00Z',
    body: 'שלום, מה כולל המסלול?',
    hasAttachments: false,
    attachmentNames: [],
    ...overrides,
  };
}

describe('intakeMailAsInquiry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an inquiry keyed on the stable Message-ID, not the item id', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([{ id: 'cm-1' }], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    const res = await intakeMailAsInquiry('AAkALgAA');

    expect(res).toEqual({ status: 'created', contactMessageId: 'cm-1' });
    // Graph's item id changes when a message is filed to another folder; the
    // RFC 5322 id does not. Keying on the item id would let a moved message
    // re-enter as a brand new inquiry.
    expect(captured[0].row.source_message_id).toBe('<abc@example.com>');
    expect(captured[0].row.source).toBe('outlook');
    expect(captured[0].opts).toMatchObject({ onConflict: 'source,source_message_id' });
  });

  it('reports a redelivered notification as duplicate, not as a new inquiry', async () => {
    const captured: UpsertArgs[] = [];
    // ignoreDuplicates makes an already-seen row return nothing.
    mockAdmin([], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({ status: 'duplicate' });
    // The whole point: no second inquiry means no second draft and no second
    // reply to a customer who wrote once.
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('never turns our own outbound mail into an inquiry', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([{ id: 'cm-x' }], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromAddress: 'owner@kalfa.me' }));

    expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({ status: 'skipped', reason: 'self' });
    expect(captured).toHaveLength(0);
  });

  it.each(['mailer-daemon@x.com', 'no-reply@vendor.io', 'postmaster@y.net'])(
    'never replies to an automated sender (%s)',
    async (from) => {
      const captured: UpsertArgs[] = [];
      mockAdmin([{ id: 'cm-x' }], captured);
      vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromAddress: from }));

      expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({
        status: 'skipped',
        reason: 'automated',
      });
      expect(captured).toHaveLength(0);
    },
  );

  it('treats a message deleted before the fetch as gone, not as an error', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(null);

    expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({ status: 'gone' });
    expect(captured).toHaveLength(0);
  });

  it('carries the subject and attachment names into the text the drafter reads', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([{ id: 'cm-2' }], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(
      mail({ hasAttachments: true, attachmentNames: ['חוזה.pdf'] }),
    );

    await intakeMailAsInquiry('AAkALgAA');

    const message = String(captured[0].row.message);
    // contact_messages has no subject column, and a reply written without the
    // subject reads as an answer to a different email.
    expect(message).toContain('שאלה על חבילה');
    // The drafter is Tier 0 and can never open the file — but knowing one is
    // attached changes what a sensible reply says.
    expect(message).toContain('חוזה.pdf');
    expect(message).toContain('שלום, מה כולל המסלול?');
  });

  it('falls back to the address when the sender has no display name', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([{ id: 'cm-3' }], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromName: null }));

    await intakeMailAsInquiry('AAkALgAA');
    expect(captured[0].row.name).toBe('dana@example.com');
  });

  it('alerts with the row id ONLY — never the sender, the body, or a topic', async () => {
    mockAdmin([{ id: 'cm-4' }], []);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    await intakeMailAsInquiry('AAkALgAA');

    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    // `topic` is gone on purpose: mail intake leaves it null, and `source`
    // already carries the channel it used to duplicate.
    expect(alert.fields).toEqual({ contactMessageId: 'cm-4' });
    expect(alert.source).toBe('outlook');
    const serialized = JSON.stringify(alert);
    expect(serialized).not.toContain('dana@example.com');
    expect(serialized).not.toContain('מה כולל המסלול');
  });

  // The channel is not a topic. 'פנייה בדואר' described where the inquiry came
  // from — which `source` already stores — and matched no console_queues row,
  // which is what routing will key on. "Not yet classified" is real information;
  // a wrong label is not.
  it('leaves topic null, and records the channel in source instead', async () => {
    const captured: UpsertArgs[] = [];
    mockAdmin([{ id: 'cm-5' }], captured);
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    await intakeMailAsInquiry('AAkALgAA');

    expect(captured[0].row.topic).toBeNull();
    expect(captured[0].row.source).toBe('outlook');
  });
});
