import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/headcount', () => ({
  requestHeadcount: vi.fn(),
  handleHeadcountReply: vi.fn(async () => false),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/interactions', () => ({
  resolveByContextId: vi.fn(),
  resolveInboundContact: vi.fn(),
  insertInteraction: vi.fn(),
  markContactRemovalRequested: vi.fn(),
  setContactOpStatus: vi.fn(),
  setDeliveryStatus: vi.fn(),
  getGuestsForContact: vi.fn(),
  recordRsvpFromWhatsapp: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));
vi.mock('@/lib/data/rsvp', () => ({ submitRsvp: vi.fn() }));

import { processWebhookEvent } from '@/lib/data/webhook-processing';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
import {
  getGuestsForContact,
  insertInteraction,
  markContactRemovalRequested,
  recordRsvpFromWhatsapp,
  resolveByContextId,
  resolveInboundContact,
  setContactOpStatus,
  setDeliveryStatus,
} from '@/lib/data/interactions';
import { recordReached } from '@/lib/data/billing';
import { submitRsvp } from '@/lib/data/rsvp';

function messageRow(overrides: Partial<WebhookInboxRow> = {}): WebhookInboxRow {
  return {
    id: 'row-1',
    provider: 'whatsapp',
    event_kind: 'message',
    dedupe_key: 'wa-msg:wamid.in',
    message_id: 'wamid.in',
    context_message_id: 'wamid.out',
    phone_number_id: 'p1',
    event_at: null,
    payload: { type: 'text', text: { body: 'אני מגיע' } },
    received_at: '2026-06-29T00:00:00Z',
    processed_at: null,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

function statusRow(overrides: Partial<WebhookInboxRow> = {}): WebhookInboxRow {
  return {
    id: 'row-s',
    provider: 'whatsapp',
    event_kind: 'status',
    dedupe_key: 'wa-status:wamid.out:delivered',
    message_id: 'wamid.out',
    context_message_id: null,
    phone_number_id: 'p1',
    event_at: null,
    payload: { status: 'delivered' },
    received_at: '2026-06-29T00:00:00Z',
    processed_at: null,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveByContextId).mockResolvedValue({
    eventId: 'e1',
    campaignId: 'c1',
    contactId: 'k1',
  });
  // Phone fallback resolves nothing by default; the fallback tests opt in.
  vi.mocked(resolveInboundContact).mockResolvedValue(null);
  vi.mocked(insertInteraction).mockResolvedValue(true);
  vi.mocked(recordReached).mockResolvedValue('billed');
  vi.mocked(markContactRemovalRequested).mockResolvedValue();
  vi.mocked(setContactOpStatus).mockResolvedValue();
  vi.mocked(setDeliveryStatus).mockResolvedValue({ contactId: 'k1' });
  // Default: exactly one guest behind the contact → the auto-record path runs.
  vi.mocked(getGuestsForContact).mockResolvedValue([
    { id: 'g1', full_name: 'אורח א', rsvp_token: 'tok-1' },
  ]);
  vi.mocked(recordRsvpFromWhatsapp).mockResolvedValue();
  vi.mocked(submitRsvp).mockResolvedValue({
    ok: true,
    status: 'attending',
    unchanged: false,
  });
});

describe('processWebhookEvent — message', () => {
  it('bills a billable reply that answered a known outbound (resolve by context)', async () => {
    await processWebhookEvent(messageRow());

    expect(resolveByContextId).toHaveBeenCalledWith('wamid.out');
    expect(insertInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'k1',
        direction: 'in',
        provider_id: 'wamid.in',
        context_message_id: 'wamid.out',
        billable: true,
      }),
    );
    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'k1',
        evidence: 'whatsapp_inbound_message',
        providerRef: 'wamid.in',
      }),
    );
    // Context resolved → the phone fallback is never consulted.
    expect(resolveInboundContact).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).not.toHaveBeenCalled();
    // A plain typed reply carries no button id → it never records an RSVP.
    expect(submitRsvp).not.toHaveBeenCalled();
    expect(getGuestsForContact).not.toHaveBeenCalled();
  });

  it('a removal reply bills FIRST, then sets removal_requested', async () => {
    await processWebhookEvent(
      messageRow({ payload: { type: 'text', text: { body: 'אנא הסירו אותי' } } }),
    );

    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: 'whatsapp_inbound_removal' }),
    );
    expect(markContactRemovalRequested).toHaveBeenCalledWith('k1');
    expect(
      vi.mocked(recordReached).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(markContactRemovalRequested).mock.invocationCallOrder[0],
    );
  });

  it('honors removal on a deduped re-process without re-billing', async () => {
    vi.mocked(insertInteraction).mockResolvedValue(false);

    await processWebhookEvent(
      messageRow({ payload: { type: 'text', text: { body: 'הסר' } } }),
    );

    expect(recordReached).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).toHaveBeenCalledWith('k1');
  });

  it('falls back to the sender phone and bills when the reply carries no context', async () => {
    vi.mocked(resolveInboundContact).mockResolvedValue({
      eventId: 'e1',
      campaignId: 'c1',
      contactId: 'k1',
    });

    await processWebhookEvent(
      messageRow({
        context_message_id: null,
        payload: { type: 'text', from: '972501234567', text: { body: 'אני מגיע' } },
      }),
    );

    expect(resolveByContextId).not.toHaveBeenCalled();
    expect(resolveInboundContact).toHaveBeenCalledWith('972501234567');
    expect(insertInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'k1',
        direction: 'in',
        provider_id: 'wamid.in',
        context_message_id: null,
        billable: true,
      }),
    );
    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'k1', providerRef: 'wamid.in' }),
    );
  });

  it('falls back to the sender phone when context is present but unresolved', async () => {
    vi.mocked(resolveByContextId).mockResolvedValue(null);
    vi.mocked(resolveInboundContact).mockResolvedValue({
      eventId: 'e1',
      campaignId: 'c1',
      contactId: 'k1',
    });

    await processWebhookEvent(
      messageRow({
        payload: { type: 'text', from: '972501234567', text: { body: 'אני מגיע' } },
      }),
    );

    expect(resolveByContextId).toHaveBeenCalledWith('wamid.out');
    expect(resolveInboundContact).toHaveBeenCalledWith('972501234567');
    expect(recordReached).toHaveBeenCalled();
  });

  it('honors a context-less opt-out via the phone fallback (bills FIRST, then removes)', async () => {
    vi.mocked(resolveInboundContact).mockResolvedValue({
      eventId: 'e1',
      campaignId: 'c1',
      contactId: 'k1',
    });

    await processWebhookEvent(
      messageRow({
        context_message_id: null,
        payload: { type: 'text', from: '972501234567', text: { body: 'הסר' } },
      }),
    );

    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: 'whatsapp_inbound_removal' }),
    );
    expect(markContactRemovalRequested).toHaveBeenCalledWith('k1');
  });

  it('does NOT bill a non-billable message type (e.g. system)', async () => {
    await processWebhookEvent(messageRow({ payload: { type: 'system' } }));

    expect(resolveByContextId).not.toHaveBeenCalled();
    expect(resolveInboundContact).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
  });

  it('does NOT bill when neither context nor sender phone resolves a contact', async () => {
    vi.mocked(resolveByContextId).mockResolvedValue(null);
    vi.mocked(resolveInboundContact).mockResolvedValue(null);

    await processWebhookEvent(
      messageRow({
        payload: { type: 'text', from: '972501234567', text: { body: 'אני מגיע' } },
      }),
    );

    expect(insertInteraction).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
  });
});

// A template/interactive quick-reply tap. context resolves to {e1,c1,k1} by
// default; getGuestsForContact → [{ id: g1, rsvp_token: tok-1 }] (one guest);
// submitRsvp → ok by default.
function buttonRow(payload: Record<string, unknown>): WebhookInboxRow {
  return messageRow({ payload: payload as WebhookInboxRow['payload'] });
}

describe('processWebhookEvent — RSVP from a quick-reply button (C9)', () => {
  it('records an attending RSVP from the attending button — defaults to 1 adult', async () => {
    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'rsvp_attending' } }),
    );

    // Still a billable reach (a button tap is a human reply).
    expect(recordReached).toHaveBeenCalledTimes(1);
    // Exactly one guest behind the contact (within the same event) → submitted
    // via the shared atomic RPC. attending => 1 adult (the RPC rejects 0).
    expect(getGuestsForContact).toHaveBeenCalledWith('e1', 'k1');
    expect(submitRsvp).toHaveBeenCalledWith('tok-1', {
      status: 'attending',
      adults: 1,
      kids: 0,
    });
    expect(recordRsvpFromWhatsapp).toHaveBeenCalledWith('e1', 'g1', 'attending');
  });

  it('records a declined RSVP from an interactive button reply — 0 counts', async () => {
    await processWebhookEvent(
      buttonRow({
        type: 'interactive',
        interactive: { button_reply: { id: 'rsvp_declined', title: 'לא מגיע' } },
      }),
    );

    expect(submitRsvp).toHaveBeenCalledWith('tok-1', {
      status: 'declined',
      adults: 0,
      kids: 0,
    });
    expect(recordRsvpFromWhatsapp).toHaveBeenCalledWith('e1', 'g1', 'declined');
  });

  it('records a maybe RSVP from an interactive list reply — 0 counts', async () => {
    await processWebhookEvent(
      buttonRow({
        type: 'interactive',
        interactive: { list_reply: { id: 'rsvp_maybe', title: 'אולי' } },
      }),
    );

    expect(submitRsvp).toHaveBeenCalledWith('tok-1', {
      status: 'maybe',
      adults: 0,
      kids: 0,
    });
    expect(recordRsvpFromWhatsapp).toHaveBeenCalledWith('e1', 'g1', 'maybe');
  });

  it('does NOT record an RSVP for an unrecognized button id (still bills the reach)', async () => {
    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'menu_directions' } }),
    );

    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(getGuestsForContact).not.toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
    expect(recordRsvpFromWhatsapp).not.toHaveBeenCalled();
  });

  it('does NOT record an RSVP when no guest is behind the contact (still bills the reach)', async () => {
    vi.mocked(getGuestsForContact).mockResolvedValue([]);

    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'rsvp_attending' } }),
    );

    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(getGuestsForContact).toHaveBeenCalledWith('e1', 'k1');
    expect(submitRsvp).not.toHaveBeenCalled();
    expect(recordRsvpFromWhatsapp).not.toHaveBeenCalled();
  });

  it('does NOT record an RSVP when MULTIPLE guests share the contact — never guesses one', async () => {
    // One phone (contact) can back several guests (guests.contact_id is not
    // unique). A "מגיע" tap is then ambiguous about which guest is meant, so the
    // RSVP is deliberately skipped — picking an arbitrary guest would corrupt the
    // wrong person's response. The reach still bills (it is a human reply).
    vi.mocked(getGuestsForContact).mockResolvedValue([
      { id: 'g1', full_name: 'אורח א', rsvp_token: 'tok-1' },
      { id: 'g2', full_name: 'אורח ב', rsvp_token: 'tok-2' },
    ]);

    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'rsvp_attending' } }),
    );

    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(getGuestsForContact).toHaveBeenCalledWith('e1', 'k1');
    expect(submitRsvp).not.toHaveBeenCalled();
    expect(recordRsvpFromWhatsapp).not.toHaveBeenCalled();
  });

  it('skips the RSVP submit on a deduped re-process (no duplicate audit rows)', async () => {
    // fresh === false: the reach was already billed; the RSVP block must not
    // re-run submit_rsvp/marker, or a Meta retry would double the audit rows.
    vi.mocked(insertInteraction).mockResolvedValue(false);

    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'rsvp_attending' } }),
    );

    expect(recordReached).not.toHaveBeenCalled();
    expect(getGuestsForContact).not.toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
    expect(recordRsvpFromWhatsapp).not.toHaveBeenCalled();
  });

  it('does NOT write the source marker when submit_rsvp rejects (e.g. revoked/closed)', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: false, reason: 'closed' });

    await processWebhookEvent(
      buttonRow({ type: 'button', button: { payload: 'rsvp_attending' } }),
    );

    expect(submitRsvp).toHaveBeenCalled();
    expect(recordRsvpFromWhatsapp).not.toHaveBeenCalled();
  });
});

describe('processWebhookEvent — status', () => {
  it('records a delivery status without touching op_status or billing', async () => {
    await processWebhookEvent(statusRow());

    expect(setDeliveryStatus).toHaveBeenCalledWith('wamid.out', 'delivered', null);
    expect(setContactOpStatus).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
  });

  it('flips op_status to wrong_number on a failed status with the definitive code', async () => {
    await processWebhookEvent(
      statusRow({
        dedupe_key: 'wa-status:wamid.out:failed',
        payload: { status: 'failed', errors: [{ code: 131026 }] },
      }),
    );

    expect(setDeliveryStatus).toHaveBeenCalledWith('wamid.out', 'failed', '131026');
    expect(setContactOpStatus).toHaveBeenCalledWith('k1', 'wrong_number');
  });

  it('records the error code but does NOT flip op_status on a non-definitive failure', async () => {
    await processWebhookEvent(
      statusRow({
        dedupe_key: 'wa-status:wamid.out:failed',
        payload: { status: 'failed', errors: [{ code: 131047 }] },
      }),
    );

    expect(setDeliveryStatus).toHaveBeenCalledWith('wamid.out', 'failed', '131047');
    expect(setContactOpStatus).not.toHaveBeenCalled();
  });
});
