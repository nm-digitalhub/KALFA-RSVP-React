import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getEmailSender } from '@/lib/email/sender';
import {
  listContactMessages,
  updateContactStatus,
  sendInquiryReply,
  resolveInquiryUrgency,
  CONTACT_COLUMNS,
  type ContactMessage,
} from './contacts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({
  inquiryReplyEmail: vi.fn(() => ({ subject: 's', html: 'h', text: 't' })),
}));

const ADMIN_ID = 'admin-1';
function adminUser(): User {
  return { id: ADMIN_ID } as unknown as User;
}

function row(overrides: Partial<ContactMessage> = {}): ContactMessage {
  return {
    id: 'c-1',
    name: 'דנה',
    email: 'dana@example.com',
    phone: '0501234567',
    message: 'שלום',
    created_at: '2026-06-20T10:00:00.000Z',
    status: 'new',
    topic: null,
    user_id: null,
    handled_at: null,
    draft_reply: null,
    draft_created_at: null,
    sent_reply: null,
    replied_at: null,
    last_activity_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

describe('listContactMessages', () => {
  it('enforces the admin gate before querying', async () => {
    const { client } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
      count: 0,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await listContactMessages();

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
  });

  it('does NOT query when the admin gate redirects (throws)', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(redirectErr);
    const { client } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listContactMessages()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('requests exactly the DTO columns with an exact count', async () => {
    const { client, builder } = createMockSupabase<ContactMessage[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listContactMessages();

    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.select).toHaveBeenCalledWith(CONTACT_COLUMNS, {
      count: 'exact',
    });
    expect(result.items).toEqual([row()]);
    expect(result.total).toBe(1);
  });

  it('paginates: page 2 ranges over the second page window', async () => {
    const { client, builder } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
      count: 100,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listContactMessages({ page: 2 });

    // Default ADMIN_PAGE_SIZE is 25 → page 2 = rows 25..49.
    expect(builder.range).toHaveBeenCalledWith(25, 49);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(25);
  });

  it('throws a safe error and leaks no DB detail on failure', async () => {
    const { client } = createMockSupabase<ContactMessage[]>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listContactMessages()).rejects.toThrow('טעינת הפניות נכשלה');
  });
});

describe('updateContactStatus', () => {
  it('updates status, stamps handled_at for terminal statuses, logs previous status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'new' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'done');

    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done', handled_at: expect.any(String) }),
    );
    expect(logActivity).toHaveBeenCalledWith({
      action: 'contact.status_updated',
      meta: expect.objectContaining({
        contactMessageId: '11111111-1111-4111-8111-111111111111',
        previousStatus: 'new',
        status: 'done',
      }),
    });
  });

  it('clears handled_at when moving back to a non-terminal status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'done' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'in_progress');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', handled_at: null }),
    );
  });
});

describe('sendInquiryReply', () => {
  const ID = '22222222-2222-4222-8222-222222222222';

  function mockSend() {
    const send = vi.fn();
    vi.mocked(getEmailSender).mockResolvedValue(
      { send } as unknown as Awaited<ReturnType<typeof getEmailSender>>,
    );
    return send;
  }

  it('sends the email THEN stamps sent_reply/replied_at/status=done and logs', async () => {
    const send = mockSend();
    const { client, builder } = createMockSupabase<{ email: string; name: string }>({
      data: { email: 'dana@example.com', name: 'דנה' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await sendInquiryReply(ID, 'שלום, תודה על פנייתך.');

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dana@example.com', subject: 's' }),
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sent_reply: 'שלום, תודה על פנייתך.',
        status: 'done',
        replied_at: expect.any(String),
        handled_at: expect.any(String),
      }),
    );
    expect(logActivity).toHaveBeenCalledWith({
      action: 'contact.reply_sent',
      meta: { contactMessageId: ID },
    });
  });

  it('throws (and never sends) when the inquiry has no email', async () => {
    const send = mockSend();
    const { client } = createMockSupabase<{ email: string | null; name: string }>({
      data: { email: null, name: 'דנה' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(sendInquiryReply(ID, 'תשובה')).rejects.toThrow('אין כתובת אימייל');
    expect(send).not.toHaveBeenCalled();
  });

  it('turns a send failure into an actionable error and does NOT persist (send-then-persist safety)', async () => {
    const sendErr = Object.assign(new Error('שליחת הדואר נכשלה'), { name: 'EmailSendError' });
    const send = vi.fn().mockRejectedValue(sendErr);
    vi.mocked(getEmailSender).mockResolvedValue(
      { send } as unknown as Awaited<ReturnType<typeof getEmailSender>>,
    );
    const { client, builder } = createMockSupabase<{ email: string; name: string }>({
      data: { email: 'dana@example.com', name: 'דנה' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    // Actionable, not generic: tells the admin exactly where/what to check.
    await expect(sendInquiryReply(ID, 'תשובה')).rejects.toThrow('בדקו במסך ההגדרות');
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('turns an unconfigured mail service into an actionable "set up SMTP" error', async () => {
    const cfgErr = Object.assign(new Error('שירות הדואר אינו מוגדר'), { name: 'EmailConfigError' });
    vi.mocked(getEmailSender).mockRejectedValue(cfgErr);
    const { client, builder } = createMockSupabase<{ email: string; name: string }>({
      data: { email: 'dana@example.com', name: 'דנה' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(sendInquiryReply(ID, 'תשובה')).rejects.toThrow('הגדירו SMTP');
    expect(builder.update).not.toHaveBeenCalled();
  });
});

// Urgency is DERIVED, never stored: a saved flag is wrong the moment the event
// passes and nothing would clear it. KALFA's customers are private individuals,
// so an event three days out is somebody's wedding — that question cannot queue
// behind a general pricing enquiry, and nothing else in the list says so.
describe('resolveInquiryUrgency', () => {
  const NOW = Date.parse('2026-08-16T09:00:00Z');
  const IN_3_DAYS = new Date(NOW + 3 * 86_400_000).toISOString();

  // Two batched reads for the whole page — profiles, then events — never one
  // per row: this renders inside a paginated list.
  function mockTwoReads(profiles: unknown, events: unknown) {
    const { client, builder } = createMockSupabase<unknown>({ data: null, error: null });
    const then = vi.spyOn(builder, 'then');
    then.mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: profiles, error: null }));
    then.mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: events, error: null }));
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('reports days to the soonest upcoming event of a matching phone', async () => {
    mockTwoReads(
      [{ id: 'owner-1', phone: '+972501112222' }],
      [{ owner_id: 'owner-1', name: 'החתונה של דנה', event_date: IN_3_DAYS }],
    );

    const map = await resolveInquiryUrgency([{ id: 'cm-1', phone: '+972501112222' }], NOW);

    expect(map.get('cm-1')).toEqual({ daysToEvent: 3, eventName: 'החתונה של דנה' });
  });

  it('does not query at all when no inquiry carries a phone', async () => {
    const { client } = mockTwoReads([], []);
    const map = await resolveInquiryUrgency([{ id: 'cm-1', phone: null }], NOW);
    expect(map.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns nothing for a phone that matches no account', async () => {
    mockTwoReads([], []);
    const map = await resolveInquiryUrgency([{ id: 'cm-1', phone: '+972500000000' }], NOW);
    expect(map.size).toBe(0);
  });

  // An account with no upcoming event is the common case and must stay quiet.
  it('returns nothing when the matched account has no upcoming event', async () => {
    mockTwoReads([{ id: 'owner-1', phone: '+972501112222' }], []);
    const map = await resolveInquiryUrgency([{ id: 'cm-1', phone: '+972501112222' }], NOW);
    expect(map.size).toBe(0);
  });

  // A phone typed into a public form is a PRIORITY HINT, never identity — so the
  // gate runs before any lookup, exactly as the list query does.
  it('enforces the admin gate before touching the database', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(redirectErr);
    const { client } = mockTwoReads([], []);

    await expect(
      resolveInquiryUrgency([{ id: 'cm-1', phone: '+972501112222' }], NOW),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});
