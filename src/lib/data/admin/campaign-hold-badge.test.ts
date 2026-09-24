import { describe, expect, it } from 'vitest';

import {
  HOLD_AWAITING_RELEASE_BADGE,
  HOLD_CHARGED_BADGE,
  HOLD_RELEASED_BADGE,
  holdBadge,
} from './campaign-hold-badge';

// Every state of an authorized hold, by the three columns that together say
// what became of the money. Written against the live rows of 2026-09-24
// (three "authorized" campaigns: one released and synced, two closed with
// nothing_to_charge and not yet synced) plus the charge path in campaigns.ts
// (recordCampaignCharge writes charge_status='charged' and touches neither
// capture_status nor release_status).
const authorized = (over: Partial<Parameters<typeof holdBadge>[0]>) =>
  holdBadge({ captureStatus: 'authorized', releaseStatus: null, chargeStatus: null, ...over });

describe('holdBadge — an authorized hold', () => {
  it('still held, campaign running: תפוס', () => {
    expect(authorized({})).toMatchObject({ label: 'תפוס', variant: 'success' });
  });

  it('CAPTURED by the final charge: חויב — capture_status still says authorized', () => {
    expect(authorized({ chargeStatus: 'charged' })).toBe(HOLD_CHARGED_BADGE);
  });

  it('released in SUMIT and synced: שוחרר', () => {
    expect(authorized({ releaseStatus: 'released' })).toBe(HOLD_RELEASED_BADGE);
  });

  it('closed with nothing to charge but the release not yet seen: warm, awaiting release', () => {
    expect(authorized({ chargeStatus: 'nothing_to_charge' })).toBe(HOLD_AWAITING_RELEASE_BADGE);
  });

  it('closed with nothing to charge AND the release synced: שוחרר', () => {
    expect(authorized({ chargeStatus: 'nothing_to_charge', releaseStatus: 'released' })).toBe(
      HOLD_RELEASED_BADGE,
    );
  });

  it('a capture beats a stray release mark: charged money cannot be "released"', () => {
    expect(authorized({ chargeStatus: 'charged', releaseStatus: 'released' })).toBe(HOLD_CHARGED_BADGE);
  });

  it.each(['pending', 'charge_failed', 'charge_review'])(
    'a charge in flight or failed (%s) leaves the hold as תפוס — the money is still held',
    (chargeStatus) => {
      expect(authorized({ chargeStatus })).toMatchObject({ label: 'תפוס' });
    },
  );
});

describe('holdBadge — no hold, or a hold that never went through', () => {
  it('no hold at all → null (the cell shows —)', () => {
    expect(holdBadge({ captureStatus: null, releaseStatus: null, chargeStatus: null })).toBeNull();
  });

  it('release/charge marks mean nothing for a hold that never went through', () => {
    expect(
      holdBadge({ captureStatus: 'hold_failed', releaseStatus: 'released', chargeStatus: 'charged' }),
    ).toMatchObject({ label: 'תפיסה נדחתה', variant: 'destructive' });
  });

  it('an unknown capture_status is shown raw, neutral', () => {
    expect(holdBadge({ captureStatus: 'something_new', releaseStatus: null, chargeStatus: null })).toEqual({
      label: 'something_new',
      variant: 'neutral',
    });
  });
});
