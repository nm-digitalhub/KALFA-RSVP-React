import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cancelActionCopy,
  CANCELLABLE_CAMPAIGN_STATUSES,
  hasAnyOperationalCampaign,
  isCampaignCancellable,
  isOperationalCampaignStatus,
  liveCampaignOf,
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

// The definition of cancel_campaign as the database has it now: the text of the NEWEST migration that creates it, from its CREATE to
// the end of its body. (An older migration is a history of how it was, not what it is; a drop that precedes a re-create is not a
// definition.)
function liveCancelCampaignDefinition(): string {
  return liveFunctionDefinition('cancel_campaign');
}

function liveFunctionDefinition(name: string): string {
  const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const CREATE = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i');
  const definers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => CREATE.test(readFileSync(join(dir, f), 'utf8')));
  expect(definers.length).toBeGreaterThan(0);
  const sql = readFileSync(join(dir, definers[definers.length - 1]), 'utf8');
  const from = sql.search(CREATE);
  const opening = sql.indexOf('$function$', from);
  return sql.slice(from, sql.indexOf('$function$', opening + 1) + '$function$'.length);
}

describe('isCampaignCancellable mirrors the cancel_campaign RPC', () => {
  const base = { status: 'approved' as CampaignStatus, capture_status: null, charge_status: null };

  it('allows a pre-money campaign in draft / pending_approval / approved', () => {
    for (const status of ['draft', 'pending_approval', 'approved'] as CampaignStatus[]) {
      expect(isCampaignCancellable({ ...base, status }, 0)).toBe(true);
    }
    // A failed hold left no money behind.
    expect(isCampaignCancellable({ ...base, capture_status: 'hold_failed' }, 0)).toBe(true);
  });

  it('refuses every later status, including closed', () => {
    for (const status of ['scheduled', 'active', 'paused', 'closed', 'cancelled'] as CampaignStatus[]) {
      expect(isCampaignCancellable({ ...base, status }, 0)).toBe(false);
    }
  });

  it('refuses once money is involved', () => {
    for (const capture_status of ['authorized', 'pending', 'hold_review']) {
      expect(isCampaignCancellable({ ...base, capture_status }, 0)).toBe(false);
    }
    expect(isCampaignCancellable({ ...base, charge_status: 'nothing_to_charge' }, 0)).toBe(false);
    expect(isCampaignCancellable(base, 1)).toBe(false);
  });

  it('uses the same status set as the live RPC definition', () => {
    const fn = liveCancelCampaignDefinition();
    expect(fn).toContain("v.status in ('draft','pending_approval','approved')");
    expect([...CANCELLABLE_CAMPAIGN_STATUSES]).toEqual(['draft', 'pending_approval', 'approved']);
    for (const s of ['authorized', 'pending', 'hold_review']) {
      expect(fn).toContain(`v.capture_status is distinct from '${s}'`);
    }
    expect(fn).toContain('v.charge_status is null');
  });

  it('the RPC looks at the payment ledger, which is why a payment in flight blocks the staff button as well', () => {
    expect(liveCancelCampaignDefinition()).toContain('not public.campaign_has_payment_activity(v.id)');
  });

  it('what the ledger blocks is exactly what this file says: in flight and succeeded block, and only a succeeded TEST row is ignored', () => {
    // The clause test money depends on lives in campaign_has_payment_activity, which the RPC calls; if a later migration changes it,
    // this fails and paymentBlocksCancel has to be looked at with it.
    const activity = liveFunctionDefinition('campaign_has_payment_activity');
    expect(activity).toContain("o.outcome in ('succeeded', 'pending', 'review')");
    expect(activity).toContain("not (o.is_test and o.outcome = 'succeeded')");
  });

  it('the RPC writes the audit record itself, in the same transaction as the status change', () => {
    const fn = liveCancelCampaignDefinition();
    expect(fn).toContain('p_actor');
    expect(fn).toContain("insert into public.activity_log");
    expect(fn).toContain("'campaign.cancelled'");
  });
});

describe('isCampaignCancellable — a paid package is not erased by flipping its status', () => {
  const approved = { status: 'approved' as CampaignStatus, capture_status: null, charge_status: null };

  it.each(['collected', 'refunded', 'pending', 'review'])('is false while the payment is %s (a refund does not erase the real payment it returned)', (status) => {
    expect(isCampaignCancellable({ ...approved, payment: { status } }, 0)).toBe(false);
  });

  it.each(['none', 'declined'])('stays as before when the payment is %s', (status) => {
    expect(isCampaignCancellable({ ...approved, payment: { status } }, 0)).toBe(true);
  });

  it('is unchanged for a campaign that was not given a payment', () => {
    expect(isCampaignCancellable(approved, 0)).toBe(true);
  });
});

// A campaign whose only settled money is TEST money (a payment on the no-money test terminal) can be reset: the RPC ignores a
// SUCCEEDED test payment (campaign_has_payment_activity), so the staff button is offered. A payment still in flight blocks whatever
// its class, and so does real money - testMoney is only ever true when every settled row is a test row.
describe('isCampaignCancellable - test money', () => {
  const approved = { status: 'approved' as CampaignStatus, capture_status: null, charge_status: null };

  it('a collected payment that is test money does not block: the run can be reset and paid again', () => {
    expect(isCampaignCancellable({ ...approved, payment: { status: 'collected', testMoney: true } }, 0)).toBe(true);
  });

  it('a collected payment that is real money (or says nothing about its class) still blocks', () => {
    expect(isCampaignCancellable({ ...approved, payment: { status: 'collected' } }, 0)).toBe(false);
    expect(isCampaignCancellable({ ...approved, payment: { status: 'collected', testMoney: false } }, 0)).toBe(false);
  });

  it.each(['pending', 'review'])('a payment that is %s blocks even when what settled before was test money', (status) => {
    expect(isCampaignCancellable({ ...approved, payment: { status, testMoney: true } }, 0)).toBe(false);
  });

  it('a test refund after a test payment (refunded) is not in the way either', () => {
    expect(isCampaignCancellable({ ...approved, payment: { status: 'refunded', testMoney: true } }, 0)).toBe(true);
  });

  it('test money does not open any other door: a hold, a charge, a reached contact or a later status still refuse', () => {
    const payment = { status: 'collected', testMoney: true };
    expect(isCampaignCancellable({ ...approved, capture_status: 'authorized', payment }, 0)).toBe(false);
    expect(isCampaignCancellable({ ...approved, charge_status: 'charged', payment }, 0)).toBe(false);
    expect(isCampaignCancellable({ ...approved, payment }, 1)).toBe(false);
    expect(isCampaignCancellable({ ...approved, status: 'active', payment }, 0)).toBe(false);
  });
});

describe('cancelActionCopy - what the staff cancel button says', () => {
  const PLAIN = { label: 'ביטול קמפיין', confirm: 'לבטל את הקמפיין לצמיתות? הפעולה עוצרת כל פנייה נוספת ולא ניתנת לשחזור.' };

  it('keeps the plain words for every campaign that is not a paid test run', () => {
    expect(cancelActionCopy(null)).toEqual(PLAIN);
    expect(cancelActionCopy(undefined)).toEqual(PLAIN);
    expect(cancelActionCopy({ status: 'none' })).toEqual(PLAIN);
    expect(cancelActionCopy({ status: 'collected' })).toEqual(PLAIN);
    expect(cancelActionCopy({ status: 'collected', testMoney: false })).toEqual(PLAIN);
    expect(cancelActionCopy({ status: 'pending', testMoney: true })).toEqual(PLAIN);
  });

  it('calls it a reset of a test run when everything that was paid is test money, and says no real money was taken', () => {
    const copy = cancelActionCopy({ status: 'collected', testMoney: true });
    expect(copy.label).toBe('אפס ריצת בדיקה');
    expect(copy.confirm).toContain('כסף בדיקה');
    expect(copy.confirm).toContain('ולשלם שוב');
  });
});

// An event keeps a cancelled campaign for every reset test run and has at most one that is not cancelled. Both readers below get the
// campaigns newest first.
describe('liveCampaignOf - which of an event\'s campaigns is meant', () => {
  const cancelled = { id: 'old', status: 'cancelled' };
  const live = { id: 'live', status: 'approved' };

  it('the live campaign wins whatever its position', () => {
    expect(liveCampaignOf([live, cancelled])).toBe(live);
    expect(liveCampaignOf([cancelled, live])).toBe(live);
  });

  it('with only cancelled campaigns there is no live one', () => {
    const newer = { id: 'newer', status: 'cancelled' };
    expect(liveCampaignOf([newer, cancelled])).toBeNull();
  });

  it('with no campaign at all there is nothing', () => {
    expect(liveCampaignOf([])).toBeNull();
  });

  it('a finished (closed) campaign is not cancelled: it is the one the event has', () => {
    const closed = { id: 'c', status: 'closed' };
    expect(liveCampaignOf([closed, cancelled])).toBe(closed);
  });
});
