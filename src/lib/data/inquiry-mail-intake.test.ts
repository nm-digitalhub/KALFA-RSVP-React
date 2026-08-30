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

// ── the mock admin client ───────────────────────────────────────────────────
//
// docs/inquiry-email-threading-fix-plan-2026-08-25.md §2.3/§2.5 rewrote
// findExistingInquiry into two DIFFERENT query shapes against contact_messages
// (ref_code lookup, thread_id lookup), added a THIRD (hasSameSenderInquiry's
// ilike email lookup), and the existing new-inquiry path now performs a FOURTH
// (the source/source_message_id self-heal lookup, §2.8) alongside the upsert
// and update. A single fixed-result stub (as the old test used) can no longer
// tell these apart. Instead, each `.from('contact_messages')` call gets its own
// closure that tracks which filters were applied and dispatches to the matching
// `AdminBehavior` callback — mirroring PostgREST's real behaviour (a fresh
// builder per `.from()` call) rather than a single canned response.

// thread_id is optional here (not required) so the many fixtures that don't
// care about it stay untouched — an omitted value behaves exactly like an
// explicit `null` at runtime (the source's `!match.thread_id` check), since
// the mock passes the row straight through with no defaulting of its own.
type ContactRow = { id: string; email: string; status: string; thread_id?: string | null };
type SlimRow = { id: string };

interface AdminBehavior {
  /** Tier 1 (§2.3 point 1-2): ref_code parsed from the subject. */
  refCode?: (code: string) => ContactRow | null;
  refCodeError?: boolean;
  /** Tier 2 (§2.3 point 3): conversationId fallback. */
  threadId?: (conversationId: string) => ContactRow | null;
  threadIdError?: boolean;
  /** §2.3 point 6 / §2.5 hasSameSenderInquiry. */
  sameSenderEmail?: (escapedEmail: string) => SlimRow | null;
  /** The new-inquiry upsert (onConflict source,source_message_id). Empty array
   * simulates ignoreDuplicates reporting a conflict (§2.8's "duplicate" case). */
  contactUpsert?: (row: Record<string, unknown>) => SlimRow[];
  /** §2.8 self-heal lookup on a duplicate — finds the row the conflict was against. */
  duplicateLookup?: (sourceMessageId: string) => SlimRow | null;
}

interface Captured {
  contactUpserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>;
  contactUpdates: Array<{ row: Record<string, unknown>; id: string }>;
  threadUpserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>;
  ilikeCalls: Array<{ col: string; val: string }>;
}

function makeAdmin(behavior: AdminBehavior = {}) {
  const captured: Captured = {
    contactUpserts: [],
    contactUpdates: [],
    threadUpserts: [],
    ilikeCalls: [],
  };

  function contactMessagesChain() {
    const filters: Record<string, unknown> = {};
    let ilikeCol: string | null = null;
    let ilikeVal: string | null = null;

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      ilike: (col: string, val: string) => {
        ilikeCol = col;
        ilikeVal = val;
        captured.ilikeCalls.push({ col, val });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        if ('ref_code' in filters) {
          if (behavior.refCodeError) {
            return Promise.resolve({ data: null, error: { message: 'db down' } });
          }
          const row = behavior.refCode?.(filters.ref_code as string) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if ('thread_id' in filters) {
          if (behavior.threadIdError) {
            return Promise.resolve({ data: null, error: { message: 'db down' } });
          }
          const row = behavior.threadId?.(filters.thread_id as string) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if (ilikeCol === 'email') {
          const row = behavior.sameSenderEmail?.(ilikeVal as string) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        if ('source_message_id' in filters) {
          const row = behavior.duplicateLookup?.(filters.source_message_id as string) ?? null;
          return Promise.resolve({ data: row, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        captured.contactUpserts.push({ row, opts });
        const rows = behavior.contactUpsert ? behavior.contactUpsert(row) : [{ id: 'cm-default' }];
        const result = { data: rows, error: null };
        // Mirrors the real PostgrestFilterBuilder: thenable on its own (the
        // inquiry_messages call site awaits it directly) AND chainable via
        // .select() (the contact_messages call site does `.upsert(...).select('id')`).
        const thenable = Promise.resolve(result) as Promise<typeof result> & {
          select: (cols: string) => Promise<typeof result>;
        };
        thenable.select = () => Promise.resolve(result);
        return thenable;
      },
      update: (row: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          captured.contactUpdates.push({ row, id });
          return Promise.resolve({ error: null });
        },
      }),
    };
    return chain;
  }

  function inquiryMessagesChain() {
    const chain: Record<string, unknown> = {
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        captured.threadUpserts.push({ row, opts });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  }

  const admin = {
    from: (table: string) => {
      if (table === 'contact_messages') return contactMessagesChain();
      if (table === 'inquiry_messages') return inquiryMessagesChain();
      throw new Error(`unexpected table in mock: ${table}`);
    },
  };

  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>,
  );

  return captured;
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
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-1' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    const res = await intakeMailAsInquiry('AAkALgAA');

    expect(res).toEqual({ status: 'created', contactMessageId: 'cm-1' });
    // Graph's item id changes when a message is filed to another folder; the
    // RFC 5322 id does not. Keying on the item id would let a moved message
    // re-enter as a brand new inquiry.
    expect(captured.contactUpserts[0].row.source_message_id).toBe('<abc@example.com>');
    expect(captured.contactUpserts[0].row.source).toBe('outlook');
    expect(captured.contactUpserts[0].opts).toMatchObject({ onConflict: 'source,source_message_id' });
  });

  it('never turns our own outbound mail into an inquiry', async () => {
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-x' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromAddress: 'owner@kalfa.me' }));

    expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({ status: 'skipped', reason: 'self' });
    expect(captured.contactUpserts).toHaveLength(0);
  });

  it.each(['mailer-daemon@x.com', 'no-reply@vendor.io', 'postmaster@y.net'])(
    'never replies to an automated sender (%s)',
    async (from) => {
      const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-x' }] });
      vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromAddress: from }));

      expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({
        status: 'skipped',
        reason: 'automated',
      });
      expect(captured.contactUpserts).toHaveLength(0);
    },
  );

  it('treats a message deleted before the fetch as gone, not as an error', async () => {
    const captured = makeAdmin();
    vi.mocked(fetchInboundMail).mockResolvedValue(null);

    expect(await intakeMailAsInquiry('AAkALgAA')).toEqual({ status: 'gone' });
    expect(captured.contactUpserts).toHaveLength(0);
  });

  it('carries the subject and attachment names into the text the drafter reads', async () => {
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-2' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(
      mail({ hasAttachments: true, attachmentNames: ['חוזה.pdf'] }),
    );

    await intakeMailAsInquiry('AAkALgAA');

    const message = String(captured.contactUpserts[0].row.message);
    // contact_messages has no subject column, and a reply written without the
    // subject reads as an answer to a different email.
    expect(message).toContain('שאלה על חבילה');
    // The drafter is Tier 0 and can never open the file — but knowing one is
    // attached changes what a sensible reply says.
    expect(message).toContain('חוזה.pdf');
    expect(message).toContain('שלום, מה כולל המסלול?');
  });

  it('falls back to the address when the sender has no display name', async () => {
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-3' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(mail({ fromName: null }));

    await intakeMailAsInquiry('AAkALgAA');
    expect(captured.contactUpserts[0].row.name).toBe('dana@example.com');
  });

  it('alerts with the row id ONLY — never the sender, the body, or a topic', async () => {
    makeAdmin({ contactUpsert: () => [{ id: 'cm-4' }] });
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
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-5' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(mail());

    await intakeMailAsInquiry('AAkALgAA');

    expect(captured.contactUpserts[0].row.topic).toBeNull();
    expect(captured.contactUpserts[0].row.source).toBe('outlook');
  });

  it('opens a new inquiry when neither tier matches (unrelated thread, no ref_code)', async () => {
    const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-new' }] });
    vi.mocked(fetchInboundMail).mockResolvedValue(mail({ conversationId: 'conv-unseen' }));

    const res = await intakeMailAsInquiry('AAkALgAA');

    expect(res).toEqual({ status: 'created', contactMessageId: 'cm-new' });
    expect(captured.contactUpserts[0].row.thread_id).toBe('conv-unseen');
  });

  // ── two-tier matching (§2.3) ────────────────────────────────────────────
  describe('tier 1 — [KLF-XXXXXXXX] reference code in the subject (§2.3 points 1-2)', () => {
    it('matches and reopens when the code and the sender both match', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4' ? { id: 'cm-ref', email: 'dana@example.com', status: 'new' } : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA',
          fromAddress: 'dana@example.com',
        }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-ref' });
      // A tier-1 hit must short-circuit — no second, disconnected row and no
      // "does this sender have another inquiry" check either.
      expect(captured.contactUpserts).toHaveLength(0);
      expect(captured.ilikeCalls).toHaveLength(0);
    });

    it('matches case-insensitively on both the code and the sender address', async () => {
      const captured = makeAdmin({
        // The stored code is always uppercase (§2.1); the regex's own `i` flag
        // plus the explicit .toUpperCase() in the source is what's under test
        // here, along with the email comparison.
        refCode: (code) =>
          code === 'A1B2C3D4' ? { id: 'cm-ref', email: 'DANA@EXAMPLE.COM', status: 'new' } : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: 'Re: [klf-a1b2c3d4] תגובה לפנייתך — KALFA',
          fromAddress: 'dana@example.com',
        }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-ref' });
      expect(captured.contactUpserts).toHaveLength(0);
    });

    it('does NOT match on a code with a mismatched sender, and alerts distinctly', async () => {
      const captured = makeAdmin({
        refCode: () => ({ id: 'cm-victim', email: 'dana@example.com', status: 'new' }),
        // No thread match either, and no other row for this sender — isolates
        // the assertion to tier 1's own behaviour.
        contactUpsert: () => [{ id: 'cm-attacker-new' }],
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA',
          fromAddress: 'attacker@evil.com',
          conversationId: null,
        }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      // Never attaches to the victim's row — it opens a brand new one instead.
      expect(res).toEqual({ status: 'created', contactMessageId: 'cm-attacker-new' });
      expect(captured.contactUpserts).toHaveLength(1);

      const mismatchAlert = vi
        .mocked(sendSlackAlert)
        .mock.calls.map((c) => c[0])
        .find((a) => a.title === 'קוד פנייה תואם אך כתובת שולח לא תואמת');
      expect(mismatchAlert).toBeDefined();
      expect(mismatchAlert?.level).toBe('warn');
      // ids/reason only — never the two addresses being compared.
      expect(mismatchAlert?.fields).toEqual({
        contactMessageId: 'cm-victim',
        reason: 'ref_code_sender_mismatch',
      });
      const serialized = JSON.stringify(mismatchAlert);
      expect(serialized).not.toContain('attacker@evil.com');
      expect(serialized).not.toContain('dana@example.com');
    });

    it('throws rather than treating a ref_code lookup DB error as no match', async () => {
      makeAdmin({ refCodeError: true });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA' }),
      );

      // A swallowed error here is exactly how the live incident in §0
      // happened — a miss silently creates a new, disconnected row.
      await expect(intakeMailAsInquiry('AAkALgAA')).rejects.toThrow(
        'שאילתת חיפוש פנייה לפי קוד נכשלה',
      );
    });

    it('falls through to tier 2 when the subject carries a token but no row has that code', async () => {
      // §2.3 point 3: "If no subject token, or it doesn't match, or the sender
      // mismatches — fall through to the conversationId check." A stripped or
      // mangled ref_code (no row at all, not a mismatch) must still let a
      // surviving conversationId anchor the reply.
      const captured = makeAdmin({
        refCode: () => null,
        threadId: (id) =>
          id === 'conv-99' ? { id: 'cm-thread', email: 'dana@example.com', status: 'new' } : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: '[KLF-99999999] תגובה לפנייתך — KALFA',
          conversationId: 'conv-99',
        }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-thread' });
      expect(captured.contactUpserts).toHaveLength(0);
      // No row was found for the code, so there is nothing to be "mismatched" —
      // the tier-1 warn alert must not fire on a plain miss.
      const mismatchAlert = vi
        .mocked(sendSlackAlert)
        .mock.calls.map((c) => c[0])
        .find((a) => a.title === 'קוד פנייה תואם אך כתובת שולח לא תואמת');
      expect(mismatchAlert).toBeUndefined();
    });

    it('still attaches via tier 2 after a tier-1 sender mismatch fires its warn alert', async () => {
      // Confirms the two tiers are independent: a tier-1 mismatch does not
      // short-circuit the whole match attempt, only tier 1's own branch.
      const captured = makeAdmin({
        refCode: () => ({ id: 'cm-victim', email: 'someone-else@example.com', status: 'new' }),
        threadId: (id) =>
          id === 'conv-99' ? { id: 'cm-thread', email: 'dana@example.com', status: 'new' } : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA',
          conversationId: 'conv-99',
          fromAddress: 'dana@example.com',
        }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-thread' });
      expect(captured.contactUpserts).toHaveLength(0);

      const mismatchAlert = vi
        .mocked(sendSlackAlert)
        .mock.calls.map((c) => c[0])
        .find((a) => a.title === 'קוד פנייה תואם אך כתובת שולח לא תואמת');
      expect(mismatchAlert).toBeDefined();
      expect(mismatchAlert?.fields).toEqual({
        contactMessageId: 'cm-victim',
        reason: 'ref_code_sender_mismatch',
      });
      // Tier 2's own success alert also fires — a mismatch on tier 1 doesn't
      // suppress the normal reopen flow once tier 2 legitimately matches.
      const reopenAlert = vi
        .mocked(sendSlackAlert)
        .mock.calls.map((c) => c[0])
        .find((a) => a.title === 'לקוח הגיב לפנייה קיימת');
      expect(reopenAlert?.fields).toEqual({ contactMessageId: 'cm-thread' });
    });
  });

  describe('tier 2 — conversationId fallback (§2.3 point 3)', () => {
    it('matches when there is no subject token, case-insensitively on the sender', async () => {
      const captured = makeAdmin({
        threadId: (id) =>
          id === 'conv-99' ? { id: 'cm-thread', email: 'Dana@Gmail.com', status: 'new' } : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה נוספת', conversationId: 'conv-99', fromAddress: 'dana@gmail.com' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-thread' });
      expect(captured.contactUpserts).toHaveLength(0);
    });

    it('does NOT match on a mismatched sender, and fires NO alert (deliberate asymmetry vs tier 1)', async () => {
      makeAdmin({
        threadId: () => ({ id: 'cm-other', email: 'someone@else.com', status: 'new' }),
        contactUpsert: () => [{ id: 'cm-new-instead' }],
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה נוספת', conversationId: 'conv-99', fromAddress: 'dana@example.com' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'created', contactMessageId: 'cm-new-instead' });
      // Exactly one alert — the generic "new inquiry" one. §2.3 point 3 is
      // explicit that a tier-2 mismatch is common and benign (cc, forward,
      // shared mailbox) and must not get its own alert the way tier 1 does.
      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendSlackAlert).mock.calls[0][0].title).toBe('פנייה חדשה בדואר');
    });

    it('throws rather than treating a conversationId lookup DB error as no match', async () => {
      makeAdmin({ threadIdError: true });
      vi.mocked(fetchInboundMail).mockResolvedValue(mail({ subject: 'שאלה נוספת' }));

      await expect(intakeMailAsInquiry('AAkALgAA')).rejects.toThrow(
        'שאילתת חיפוש פנייה לפי conversationId נכשלה',
      );
    });

    it('never overwrites the original question with the reply', async () => {
      const captured = makeAdmin({
        threadId: () => ({ id: 'cm-existing', email: 'dana@example.com', status: 'new' }),
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(mail());

      await intakeMailAsInquiry('AAkALgAA');

      // The flat `message` column holds the ORIGINAL question — overwriting it
      // would destroy the context the drafter needs to avoid repeating an
      // answer already given.
      expect(captured.contactUpdates[0].row).not.toHaveProperty('message');
    });
  });

  // ── attachReplyToInquiry — cancelled vs. normal reopen (§2.3 points 4-5) ──
  describe('a matched reply against a cancelled inquiry (§2.3 point 4)', () => {
    it('still records the reply, but does not reopen the row, and alerts distinctly', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4'
            ? {
                id: 'cm-cancelled',
                email: 'dana@example.com',
                status: 'cancelled',
                // Already linked — isolates this test to the status/cascade
                // question; the thread_id-backfill interaction has its own
                // dedicated test below.
                thread_id: 'conv-already-linked',
              }
            : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'skipped', reason: 'cancelled' });
      // The reply itself must never be silently lost — this is the durable
      // record of what happened, independent of the best-effort Slack alert.
      expect(captured.threadUpserts).toHaveLength(1);
      expect(captured.threadUpserts[0].row).toMatchObject({
        inquiry_id: 'cm-cancelled',
        direction: 'inbound',
        body: expect.stringContaining('מה כולל המסלול'),
      });
      // No status/cascade mutation — a deliberate cancellation is not silently
      // overruled by a stale reply.
      expect(captured.contactUpdates).toHaveLength(0);

      const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
      expect(alert.title).toBe('לקוח הגיב לפנייה שבוטלה');
      expect(alert.level).toBe('warn');
      expect(alert.fields).toEqual({ contactMessageId: 'cm-cancelled' });
    });

    it('still backfills thread_id on a cancelled row (the thread link is a fact about the conversation, not a verdict on it) — without reopening it', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4'
            ? {
                id: 'cm-cancelled-webform',
                email: 'dana@example.com',
                status: 'cancelled',
                thread_id: null, // web-form-originated, never linked
              }
            : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA', conversationId: 'conv-new-link' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'skipped', reason: 'cancelled' });
      // Exactly one update — the thread_id backfill — and NOT the reopen
      // status/cascade fields: cancelled stays cancelled.
      expect(captured.contactUpdates).toHaveLength(1);
      expect(captured.contactUpdates[0].id).toBe('cm-cancelled-webform');
      expect(captured.contactUpdates[0].row).toEqual({ thread_id: 'conv-new-link' });
    });
  });

  describe('a normal reopen (§2.3 point 5)', () => {
    it('sets status to reopened and nulls all five follow-up cascade stamps', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4'
            ? {
                id: 'cm-existing',
                email: 'dana@example.com',
                status: 'in_progress',
                // Already linked — isolates this test to the cascade-stamp
                // question; the thread_id-backfill interaction has its own
                // dedicated test above (tier 1 describe block).
                thread_id: 'conv-already-linked',
              }
            : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'reopened', contactMessageId: 'cm-existing' });
      expect(captured.contactUpdates).toHaveLength(1);
      const row = captured.contactUpdates[0].row;
      expect(captured.contactUpdates[0].id).toBe('cm-existing');

      // The status is the whole trap: the fleet trigger is
      // `status='new' AND draft_reply IS NULL`, so `new` (not `reopened`)
      // would leave the drafter asleep on an already-answered inquiry.
      expect(row.status).toBe('reopened');
      expect(row).toHaveProperty('reply_needed_at', '2026-08-16T09:00:00Z');
      expect(row).toHaveProperty('last_activity_at', '2026-08-16T09:00:00Z');
      expect(row).toHaveProperty('handled_at', null);

      // All FIVE cascade stamps — a reopen must not let round-1's stamps leak
      // into round-2's gating (listDueForReminder/Warning/AutoClose gate on
      // "is null"), and rating_token must clear alongside rating_requested_at
      // since together they're the whole /rate/[token] auth pair.
      expect(row).toHaveProperty('reminder_sent_at', null);
      expect(row).toHaveProperty('closing_warning_sent_at', null);
      expect(row).toHaveProperty('auto_closed_at', null);
      expect(row).toHaveProperty('rating_requested_at', null);
      expect(row).toHaveProperty('rating_token', null);

      // Rating feedback itself is unrelated to a reopen and must survive it.
      expect(row).not.toHaveProperty('rating_score');
      expect(row).not.toHaveProperty('rating_comment');
      expect(row).not.toHaveProperty('rating_at');

      const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
      expect(alert.title).toBe('לקוח הגיב לפנייה קיימת');
      expect(alert.level).toBe('info');
    });

    it('backfills thread_id on a tier-1 (ref_code) match, so a web-form-originated row (thread_id NULL) gains a tier-2 fallback for future replies', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4'
            ? {
                id: 'cm-webform',
                email: 'dana@example.com',
                status: 'in_progress',
                thread_id: null, // web-form-originated, never linked
              }
            : null,
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA', conversationId: 'conv-real' }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      // Two SEPARATE updates, in order: the write-once thread_id backfill
      // first, then the normal reopen/cascade update — not merged into one.
      expect(captured.contactUpdates).toHaveLength(2);
      expect(captured.contactUpdates[0].id).toBe('cm-webform');
      expect(captured.contactUpdates[0].row).toEqual({ thread_id: 'conv-real' });
      expect(captured.contactUpdates[1].row).toMatchObject({ status: 'reopened' });
    });

    it('does NOT overwrite an already-linked thread_id on a tier-1 match', async () => {
      const captured = makeAdmin({
        refCode: (code) =>
          code === 'A1B2C3D4'
            ? {
                id: 'cm-linked',
                email: 'dana@example.com',
                status: 'in_progress',
                thread_id: 'conv-original',
              }
            : null,
      });
      // A later reply arrives under a DIFFERENT conversationId than the
      // original link (e.g. the customer started a fresh thread) — the
      // already-learned link must not be clobbered by this one.
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: '[KLF-A1B2C3D4] תגובה לפנייתך — KALFA', conversationId: 'conv-different' }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      // Only the reopen update — no separate thread_id write at all.
      expect(captured.contactUpdates).toHaveLength(1);
      expect(captured.contactUpdates[0].row).not.toHaveProperty('thread_id');
    });
  });

  describe('inquiry_messages write is an upsert, not a plain insert (§2.7)', () => {
    it('uses onConflict:message_id + ignoreDuplicates on every reply, so a retried delivery cannot error or duplicate the row', async () => {
      const captured = makeAdmin({
        threadId: () => ({ id: 'cm-existing', email: 'dana@example.com', status: 'new' }),
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(mail());

      // Simulate the exact scenario §2.7 exists for: webhook_inbox retries
      // attachReplyToInquiry after a partial failure. Two calls with the same
      // message_id must both succeed and both request the idempotent shape —
      // it is that request shape (not this mock) that makes the DB constraint
      // do the actual deduping.
      const first = await intakeMailAsInquiry('AAkALgAA');
      const second = await intakeMailAsInquiry('AAkALgAA');

      expect(first).toEqual({ status: 'reopened', contactMessageId: 'cm-existing' });
      expect(second).toEqual({ status: 'reopened', contactMessageId: 'cm-existing' });
      expect(captured.threadUpserts).toHaveLength(2);
      for (const call of captured.threadUpserts) {
        expect(call.row.message_id).toBe('<abc@example.com>');
        expect(call.opts).toEqual({ onConflict: 'message_id', ignoreDuplicates: true });
      }
    });
  });

  // ── hasSameSenderInquiry (§2.3 point 6) ────────────────────────────────
  describe('the miss path — distinguishing an unmatched reply from a genuinely new inquiry', () => {
    it('fires the "possible unmatched reply" alert, not the generic one, when the sender already has a row', async () => {
      const captured = makeAdmin({
        // Simulates Postgres ILIKE's case-insensitivity — the DB itself does
        // the case folding; contact_messages.email is stored exactly as
        // typed (never lowercased on write), unlike mail.fromAddress.
        sameSenderEmail: (val) => (val.toLowerCase() === 'dana@gmail.com' ? { id: 'cm-old' } : null),
        contactUpsert: () => [{ id: 'cm-new' }],
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen', fromAddress: 'dana@gmail.com' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'created', contactMessageId: 'cm-new' });
      // .ilike(), not .eq() — a plain equality check would miss a form
      // submission stored as "Dana@Gmail.com".
      expect(captured.ilikeCalls).toEqual([{ col: 'email', val: 'dana@gmail.com' }]);

      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
      const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
      expect(alert.title).toBe('תגובה אפשרית לא שויכה — נפתחה פנייה חדשה');
      expect(alert.level).toBe('warn');
      expect(alert.fields).toEqual({ contactMessageId: 'cm-new' });
    });

    it('fires the generic "new inquiry" alert when no other row shares the sender', async () => {
      makeAdmin({
        sameSenderEmail: () => null,
        contactUpsert: () => [{ id: 'cm-new' }],
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      expect(sendSlackAlert).toHaveBeenCalledTimes(1);
      const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
      expect(alert.title).toBe('פנייה חדשה בדואר');
      expect(alert.level).toBe('info');
    });

    it('escapes ILIKE wildcards in the address before querying (§2.3 point 6)', async () => {
      // `_` is a legal, common character in real addresses but an ILIKE
      // wildcard (matches any single character) — every other fixture in this
      // file uses an address with no such characters, which would pass even
      // if the escaping were silently dropped. This is the one test that
      // actually exercises it.
      const captured = makeAdmin({ contactUpsert: () => [{ id: 'cm-new' }] });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({
          subject: 'שאלה חדשה לגמרי',
          conversationId: 'conv-unseen',
          fromAddress: 'dana_levi@gmail.com',
        }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      expect(captured.ilikeCalls).toEqual([{ col: 'email', val: 'dana\\_levi@gmail.com' }]);
    });

    it('is called before the insert, so it cannot match the row the insert itself just created', async () => {
      let sawExistingRowAtCheckTime = false;
      const captured = makeAdmin({
        sameSenderEmail: () => {
          // If the upsert had already run, captured.contactUpserts would be
          // non-empty by the time this runs.
          sawExistingRowAtCheckTime = captured.contactUpserts.length > 0;
          return null;
        },
        contactUpsert: () => [{ id: 'cm-new' }],
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      expect(sawExistingRowAtCheckTime).toBe(false);
    });
  });

  // ── §2.8 first-inquiry-creation self-healing ───────────────────────────
  describe('the new-inquiry path (§2.8)', () => {
    it('a redelivered message_id reports duplicate, fires no alert, and does not error', async () => {
      makeAdmin({
        contactUpsert: () => [], // ignoreDuplicates conflict — no row returned
        duplicateLookup: (msgId) => (msgId === '<abc@example.com>' ? { id: 'cm-retry' } : null),
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      await expect(intakeMailAsInquiry('AAkALgAA')).resolves.toEqual({ status: 'duplicate' });
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('self-heals: even on the duplicate path it looks up the existing row and re-attempts the idempotent inquiry_messages upsert', async () => {
      const captured = makeAdmin({
        contactUpsert: () => [],
        duplicateLookup: (msgId) => (msgId === '<abc@example.com>' ? { id: 'cm-retry' } : null),
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      await intakeMailAsInquiry('AAkALgAA');

      // This is the entire point of §2.8: a prior attempt's inquiry_messages
      // write may have silently failed even though the contact_messages row
      // was created. The "duplicate" branch must not just report duplicate
      // and stop — it must re-attempt the thread write against the row the
      // conflict was against.
      expect(captured.threadUpserts).toHaveLength(1);
      expect(captured.threadUpserts[0].row).toMatchObject({
        inquiry_id: 'cm-retry',
        direction: 'inbound',
        message_id: '<abc@example.com>',
      });
      expect(captured.threadUpserts[0].opts).toEqual({
        onConflict: 'message_id',
        ignoreDuplicates: true,
      });
    });

    it('throws if a reported conflict cannot be resolved to an existing row (should never happen)', async () => {
      makeAdmin({
        contactUpsert: () => [],
        duplicateLookup: () => null, // ignoreDuplicates says "conflict" but the row vanished
      });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      await expect(intakeMailAsInquiry('AAkALgAA')).rejects.toThrow(
        'פנייה קיימת לא אותרה לאחר זיהוי כפילות',
      );
    });

    it('a genuinely first-time insert returns created with contactMessageId, and the alert uses that same field name', async () => {
      makeAdmin({ contactUpsert: () => [{ id: 'cm-brand-new' }] });
      vi.mocked(fetchInboundMail).mockResolvedValue(
        mail({ subject: 'שאלה חדשה לגמרי', conversationId: 'conv-unseen' }),
      );

      const res = await intakeMailAsInquiry('AAkALgAA');

      expect(res).toEqual({ status: 'created', contactMessageId: 'cm-brand-new' });
      const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
      // Guards against the exact bug §2.8 fixed: the old variable was named
      // `created`, but the field key sent to Slack was always the string
      // "contactMessageId" — this must still be the ONLY key present.
      expect(Object.keys(alert.fields ?? {})).toEqual(['contactMessageId']);
      expect(alert.fields).toEqual({ contactMessageId: 'cm-brand-new' });
    });
  });
});
