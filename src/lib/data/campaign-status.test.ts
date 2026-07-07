import { describe, expect, it } from 'vitest';

import {
  hasAnyOperationalCampaign,
  isOperationalCampaignStatus,
  OPERATIONAL_CAMPAIGN_STATUSES,
  type CampaignStatus,
} from '@/lib/data/campaign-status';

// The FULL campaign_status enum (verified against the live DB, 2026-07-07):
// 6 operational + 5 terminal/cancelled = 11. These RUNTIME lists are cross-checked
// against each other (OPERATIONAL ∪ NON_OPERATIONAL === ALL). FUTURE exhaustiveness
// — a newly ADDED enum value MUST be classified — is guaranteed by the COMPILE-TIME
// assertion `_EveryCampaignStatusMustBeClassified` below, NOT by these arrays.
const ALL_CAMPAIGN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'active',
  'paused',
  'closed',
  'awaiting_invoice',
  'billed',
  'paid',
  'cancelled',
] as const satisfies readonly CampaignStatus[];

const NON_OPERATIONAL = [
  'closed',
  'awaiting_invoice',
  'billed',
  'paid',
  'cancelled',
] as const satisfies readonly CampaignStatus[];

// COMPILE-TIME exhaustiveness guard: if `campaign_status` ever gains a value that
// is NOT placed in OPERATIONAL_CAMPAIGN_STATUSES or NON_OPERATIONAL, `Exclude<…>`
// becomes that value (not `never`), so `AssertNever<…>` fails to typecheck and
// tsc breaks here — forcing the new status to be classified.
type AssertNever<T extends never> = T;
type ClassifiedCampaignStatus =
  | (typeof OPERATIONAL_CAMPAIGN_STATUSES)[number]
  | (typeof NON_OPERATIONAL)[number];
type _EveryCampaignStatusMustBeClassified = AssertNever<
  Exclude<CampaignStatus, ClassifiedCampaignStatus>
>;

describe('isOperationalCampaignStatus — every one of the 11 enum values', () => {
  it('the 6 operational statuses ARE operational', () => {
    expect(OPERATIONAL_CAMPAIGN_STATUSES).toHaveLength(6);
    for (const s of OPERATIONAL_CAMPAIGN_STATUSES) {
      expect(isOperationalCampaignStatus(s)).toBe(true);
    }
  });

  it('the 5 terminal/cancelled statuses are NOT operational', () => {
    for (const s of NON_OPERATIONAL) {
      expect(isOperationalCampaignStatus(s)).toBe(false);
    }
  });

  it('operational ∪ non-operational covers the full 11-value enum exactly', () => {
    const union = new Set<CampaignStatus>([
      ...OPERATIONAL_CAMPAIGN_STATUSES,
      ...NON_OPERATIONAL,
    ]);
    expect(union).toEqual(new Set(ALL_CAMPAIGN_STATUSES));
    expect(ALL_CAMPAIGN_STATUSES).toHaveLength(11);
  });
});

describe('hasAnyOperationalCampaign — ∃ over ALL campaigns (matches server + DB)', () => {
  const c = (status: CampaignStatus) => ({ status });

  it('empty list → false', () => {
    expect(hasAnyOperationalCampaign([])).toBe(false);
  });

  it('active + paid → true regardless of record order (the fix: ∃, NOT newest-non-cancelled)', () => {
    // If the flag were derived from getCampaignForEvent (newest non-cancelled),
    // a NEWER `paid` ahead of an OLDER `active` would read false — the exact
    // divergence this guards. The ∃ quantifier is order-independent → true both
    // ways, matching updateEvent's `.in(OPERATIONAL…).limit(1)`.
    expect(hasAnyOperationalCampaign([c('active'), c('paid')])).toBe(true);
    expect(hasAnyOperationalCampaign([c('paid'), c('active')])).toBe(true);
  });

  it('paid only → false (no operational campaign present)', () => {
    expect(hasAnyOperationalCampaign([c('paid')])).toBe(false);
  });

  it('cancelled + active → true (a cancelled sibling never hides an operational one)', () => {
    expect(hasAnyOperationalCampaign([c('cancelled'), c('active')])).toBe(true);
  });

  it('all-terminal/cancelled → false', () => {
    expect(hasAnyOperationalCampaign(NON_OPERATIONAL.map(c))).toBe(false);
  });
});
