import { describe, expect, it } from 'vitest';

import { deriveAssignmentDisplayStatus } from './assignment-display-status';

// Every row of the spec's §5 table (admin-panel change) — the display status is DERIVED,
// never written, and consumed beats expiry.

const NOW = Date.parse('2026-10-13T00:00:00.000Z');
const FUTURE = '2026-10-20T00:00:00.000Z';
const PAST = '2026-10-01T00:00:00.000Z';

describe('deriveAssignmentDisplayStatus (spec §5)', () => {
  it('assigned in validity → ממתינה לשימוש', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'assigned', expiresAt: FUTURE }, NOW)).toEqual({
      key: 'waiting',
      label: 'ממתינה לשימוש',
    });
  });

  it('bound in validity → משויכת לאירוע', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'bound', expiresAt: FUTURE }, NOW)).toEqual({
      key: 'bound',
      label: 'משויכת לאירוע',
    });
  });

  it('assigned past expiry → פגה, derived at read time', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'assigned', expiresAt: PAST }, NOW)).toEqual({
      key: 'expired',
      label: 'פגה',
    });
  });

  it('bound past expiry → פגה', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'bound', expiresAt: PAST }, NOW).key).toBe('expired');
  });

  it('consumed beats expiry — a redeemed benefit stays מומשה', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'consumed', expiresAt: PAST }, NOW)).toEqual({
      key: 'consumed',
      label: 'מומשה',
    });
    expect(deriveAssignmentDisplayStatus({ state: 'consumed', expiresAt: FUTURE }, NOW).key).toBe('consumed');
  });

  it('void with the recorded expiry reason → פגה', () => {
    expect(
      deriveAssignmentDisplayStatus({ state: 'void', expiresAt: PAST, endReason: 'expired' }, NOW),
    ).toEqual({ key: 'expired', label: 'פגה' });
  });

  it('void with a recorded cancellation reason → בוטלה with the reason', () => {
    expect(
      deriveAssignmentDisplayStatus({ state: 'void', expiresAt: FUTURE, endReason: 'staff_void' }, NOW),
    ).toEqual({ key: 'cancelled', label: 'בוטלה', reasonLabel: 'בוטלה על ידי הצוות' });
    expect(
      deriveAssignmentDisplayStatus({ state: 'void', expiresAt: FUTURE, endReason: 'duplicate' }, NOW)
        .reasonLabel,
    ).toContain('כפילות');
    expect(
      deriveAssignmentDisplayStatus(
        { state: 'void', expiresAt: FUTURE, endReason: 'escalation_replaced' },
        NOW,
      ).key,
    ).toBe('cancelled');
  });

  it('void without a recorded reason → הסתיימה, never a reason invented from dates', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'void', expiresAt: PAST }, NOW)).toEqual({
      key: 'ended',
      label: 'הסתיימה',
    });
  });

  it('void with an unrecognized reason keeps the raw code visible, not a guess', () => {
    const s = deriveAssignmentDisplayStatus(
      { state: 'void', expiresAt: FUTURE, endReason: 'campaign_cancelled' },
      NOW,
    );
    expect(s).toEqual({ key: 'ended', label: 'הסתיימה', reasonLabel: 'campaign_cancelled' });
  });

  it('an unknown stored state renders as הסתיימה instead of crashing the screen', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'weird', expiresAt: FUTURE }, NOW).key).toBe('ended');
  });

  it('an unparseable expiry is treated as not expired (fail-open to the stored state)', () => {
    expect(deriveAssignmentDisplayStatus({ state: 'assigned', expiresAt: 'not-a-date' }, NOW).key).toBe(
      'waiting',
    );
  });
});
