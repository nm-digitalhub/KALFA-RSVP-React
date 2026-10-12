import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  campaignStage,
  eventStatusLabel,
} from '@/lib/data/event-labels';

// Audit §3 (docs/KALFA-RSVP.md): the EVENT state and the CAMPAIGN state are two
// separate things the owner must never confuse — "פעיל" belongs to the campaign
// only. The campaign display state is DERIVED (status + the package payment), not
// a new enum value.
describe('campaignStage', () => {
  const pkg = { price: 150 };

  it('no campaign → not_set', () => {
    expect(campaignStage(null)).toBe('not_set');
  });

  it('draft / pending_approval → awaiting_terms', () => {
    expect(campaignStage({ status: 'draft', ...pkg })).toBe('awaiting_terms');
    expect(campaignStage({ status: 'pending_approval', ...pkg })).toBe('awaiting_terms');
  });

  it('active → active, paused → paused', () => {
    expect(campaignStage({ status: 'active', ...pkg })).toBe('active');
    expect(campaignStage({ status: 'paused', ...pkg })).toBe('paused');
  });

  it('every post-run status folds into closed', () => {
    for (const status of ['closed', 'awaiting_invoice', 'billed', 'paid'] as const) {
      expect(campaignStage({ status, ...pkg })).toBe('closed');
    }
  });

  it('cancelled → cancelled', () => {
    expect(campaignStage({ status: 'cancelled', ...pkg })).toBe('cancelled');
  });

  it('every stage has a non-empty Hebrew label', () => {
    for (const label of Object.values(CAMPAIGN_STAGE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('event status labels (audit §2/§3)', () => {
  it('an active event reads as confirmed details, never "פעיל"', () => {
    expect(EVENT_STATUS_LABELS.active).toBe('פרטי האירוע אושרו');
    expect(eventStatusLabel('active', null)).toBe('פרטי האירוע אושרו');
  });

  it('closed reads "הסתיים", and "בוטל" when the closure came from a cancellation request', () => {
    expect(eventStatusLabel('closed', null)).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'owner')).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'settlement')).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'cancellation')).toBe('בוטל');
  });

  it('pending_approval reads as waiting for the owner to approve the package terms (audit §4)', () => {
    expect(CAMPAIGN_STATUS_LABELS.pending_approval).toBe('ממתין לאישור התנאים');
  });
});

describe('campaignStage — a campaign is funded by its package payment', () => {
  const approved = { status: 'approved' as const, price: 150 };

  it('approved and paid in full: awaiting activation', () => {
    expect(campaignStage({ ...approved, payment: { status: 'collected' } })).toBe('awaiting_activation');
  });

  it.each(['none', 'pending', 'review', 'declined', 'refunded', 'released', 'committed'])(
    'approved with payment %s: still awaiting payment',
    (status) => {
      expect(campaignStage({ ...approved, payment: { status } })).toBe('awaiting_payment');
    },
  );

  it('approved package whose payment could not be read (null): awaiting payment — the safe direction', () => {
    expect(campaignStage({ ...approved, payment: null })).toBe('awaiting_payment');
  });

  it('scheduled and paid: awaiting activation too', () => {
    expect(campaignStage({ ...approved, status: 'scheduled', payment: { status: 'collected' } })).toBe('awaiting_activation');
  });

  it('a campaign without a package is never funded, whatever payment it is handed', () => {
    expect(campaignStage({ status: 'approved', price: null, payment: { status: 'collected' } })).toBe('awaiting_payment');
  });

  it('statuses past activation do not depend on the payment', () => {
    for (const status of ['active', 'paused', 'closed'] as const) {
      expect(campaignStage({ status, price: 150, payment: null })).toBe(
        campaignStage({ status, price: 150, payment: { status: 'collected' } }),
      );
    }
  });
});

