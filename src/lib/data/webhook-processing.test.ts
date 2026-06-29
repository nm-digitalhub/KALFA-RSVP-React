import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/interactions', () => ({
  resolveByContextId: vi.fn(),
  resolveInboundContact: vi.fn(),
  insertInteraction: vi.fn(),
  markContactRemovalRequested: vi.fn(),
  setContactOpStatus: vi.fn(),
  setDeliveryStatus: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));

import { processWebhookEvent } from '@/lib/data/webhook-processing';
import type { WebhookInboxRow } from '@/lib/data/webhooks';
import {
  insertInteraction,
  markContactRemovalRequested,
  resolveByContextId,
  resolveInboundContact,
  setContactOpStatus,
  setDeliveryStatus,
} from '@/lib/data/interactions';
import { recordReached } from '@/lib/data/billing';

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
