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
// only. The campaign display state is DERIVED (status + capture_status), not a
// new enum value.
describe('campaignStage', () => {
  it('no campaign → not_set', () => {
    expect(campaignStage(null)).toBe('not_set');
  });

  it('draft / pending_approval → awaiting_signature', () => {
    expect(campaignStage({ status: 'draft', capture_status: null })).toBe('awaiting_signature');
    expect(campaignStage({ status: 'pending_approval', capture_status: null })).toBe(
      'awaiting_signature',
    );
  });

  it('approved without a confirmed hold → awaiting_payment (incl. a failed/ambiguous attempt)', () => {
    expect(campaignStage({ status: 'approved', capture_status: null })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'approved', capture_status: 'pending' })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'approved', capture_status: 'hold_failed' })).toBe(
      'awaiting_payment',
    );
    expect(campaignStage({ status: 'approved', capture_status: 'hold_review' })).toBe(
      'awaiting_payment',
    );
  });

  it('approved/scheduled WITH a confirmed hold → awaiting_activation', () => {
    expect(campaignStage({ status: 'approved', capture_status: 'authorized' })).toBe(
      'awaiting_activation',
    );
    expect(campaignStage({ status: 'scheduled', capture_status: 'authorized' })).toBe(
      'awaiting_activation',
    );
  });

  it('active → active, paused → paused', () => {
    expect(campaignStage({ status: 'active', capture_status: 'authorized' })).toBe('active');
    expect(campaignStage({ status: 'paused', capture_status: 'authorized' })).toBe('paused');
  });

  it('every post-run status folds into closed', () => {
    for (const status of ['closed', 'awaiting_invoice', 'billed', 'paid'] as const) {
      expect(campaignStage({ status, capture_status: 'authorized' })).toBe('closed');
    }
  });

  it('cancelled → cancelled', () => {
    expect(campaignStage({ status: 'cancelled', capture_status: null })).toBe('cancelled');
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

  it('pending_approval reads as waiting for a SIGNATURE (audit §4)', () => {
    expect(CAMPAIGN_STATUS_LABELS.pending_approval).toBe('ממתין לחתימה');
  });
});

describe('campaignStage — a package campaign is funded by its payment, not by a card hold', () => {
  const approved = { status: 'approved' as const, capture_status: null, package_price: 150 };

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

  it('a campaign that is not a package ignores any payment it is handed', () => {
    expect(campaignStage({ status: 'approved', capture_status: null, package_price: null, payment: { status: 'collected' } })).toBe('awaiting_payment');
  });

  it('the pay-per-result rule is unchanged', () => {
    expect(campaignStage({ status: 'approved', capture_status: 'authorized' })).toBe('awaiting_activation');
    expect(campaignStage({ status: 'approved', capture_status: 'pending' })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'scheduled', capture_status: 'authorized' })).toBe('awaiting_activation');
  });

  it('statuses past activation do not depend on the payment', () => {
    for (const status of ['active', 'paused', 'closed'] as const) {
      expect(campaignStage({ status, capture_status: null, package_price: 150, payment: null })).toBe(campaignStage({ status, capture_status: 'authorized' }));
    }
  });
});

