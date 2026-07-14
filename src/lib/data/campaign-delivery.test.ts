import { describe, expect, it, vi } from 'vitest';

// campaign-delivery.ts begins with `import 'server-only'` and pulls in the cookie
// client + the ownership gate at module load; stub them so the pure aggregator can
// be imported and exercised without a database.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));

import { aggregateDeliveryBreakdown } from '@/lib/data/campaign-delivery';

describe('aggregateDeliveryBreakdown', () => {
  it('returns an all-zeros breakdown for no data', () => {
    expect(aggregateDeliveryBreakdown([], [])).toEqual({
      totalContacts: 0,
      delivery: { sent: 0, delivered: 0, read: 0, failed: 0 },
      outcome: { reached: 0, wrongNumber: 0, optedOut: 0 },
      call: { dialed: 0, noAnswer: 0, voicemail: 0, humanInteraction: 0 },
    });
  });

  it('counts delivery as a cumulative funnel by the LATEST message per contact', () => {
    const result = aggregateDeliveryBreakdown(
      [
        // c1: an older 'read' superseded by a newer 'failed' → terminal failed only.
        { contact_id: 'c1', delivery_status: 'read', created_at: '2026-06-01T10:00:00Z' },
        { contact_id: 'c1', delivery_status: 'failed', created_at: '2026-06-02T10:00:00Z' },
        // c2: 'delivered' → counts toward delivered AND sent (monotonic funnel).
        { contact_id: 'c2', delivery_status: 'delivered', created_at: '2026-06-01T09:00:00Z' },
        // c3: latest message not yet acknowledged (null) → no delivery stage.
        { contact_id: 'c3', delivery_status: 'read', created_at: '2026-06-01T08:00:00Z' },
        { contact_id: 'c3', delivery_status: null, created_at: '2026-06-03T08:00:00Z' },
        // c4: 'read' → counts toward read, delivered AND sent.
        { contact_id: 'c4', delivery_status: 'read', created_at: '2026-06-01T07:00:00Z' },
      ],
      [],
    );
    // sent ≥ delivered ≥ read: c2+c4 sent/delivered, c4 read, c1 failed, c3 none.
    expect(result.delivery).toEqual({ sent: 2, delivered: 2, read: 1, failed: 1 });
  });

  it('ignores outbound rows with no contact attribution', () => {
    const result = aggregateDeliveryBreakdown(
      [{ contact_id: null, delivery_status: 'sent', created_at: '2026-06-01T10:00:00Z' }],
      [],
    );
    expect(result.delivery.sent).toBe(0);
  });

  it('derives outcome from contact op_status and counts opt-out independently', () => {
    const result = aggregateDeliveryBreakdown(
      [],
      [
        { op_status: 'reached_billed', removal_requested: false },
        { op_status: 'wrong_number', removal_requested: false },
        // reached AND opted out: the opt-out reply billed (reach) then requested removal.
        { op_status: 'reached_billed', removal_requested: true },
        { op_status: 'pending_contact', removal_requested: false },
      ],
    );
    expect(result.totalContacts).toBe(4);
    expect(result.outcome).toEqual({ reached: 2, wrongNumber: 1, optedOut: 1 });
  });

  it('tallies the AI-call family from contact op_status', () => {
    const result = aggregateDeliveryBreakdown(
      [],
      [
        { op_status: 'call_dialed', removal_requested: false },
        { op_status: 'call_dialed', removal_requested: false },
        { op_status: 'no_answer', removal_requested: false },
        { op_status: 'voicemail', removal_requested: false },
        { op_status: 'human_interaction_call', removal_requested: false },
        // A non-call outcome must NOT leak into the call buckets.
        { op_status: 'reached_billed', removal_requested: false },
      ],
    );
    expect(result.call).toEqual({
      dialed: 2,
      noAnswer: 1,
      voicemail: 1,
      humanInteraction: 1,
    });
    // The call family and the outcome buckets are counted independently.
    expect(result.outcome.reached).toBe(1);
  });

  it('leaves the call buckets at zero for a WhatsApp-only campaign', () => {
    const result = aggregateDeliveryBreakdown(
      [],
      [
        { op_status: 'whatsapp_read', removal_requested: false },
        { op_status: 'reached_billed', removal_requested: false },
      ],
    );
    expect(result.call).toEqual({ dialed: 0, noAnswer: 0, voicemail: 0, humanInteraction: 0 });
  });
});
