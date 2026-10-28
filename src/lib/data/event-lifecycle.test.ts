import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CANCELLABLE_CAMPAIGN_STATUSES, type CampaignStatus } from '@/lib/data/campaign-status';
import {
  CLOSE_BLOCKED_MONEY_ERROR,
  CLOSE_BLOCKED_PAID_ERROR,
  closeControlOf,
  eventLifecycleMachine,
  eventMode,
  resolveEventLifecycle,
  serviceLeafValues,
  type EventLifecycleFacts,
  type EventMode,
} from '@/lib/data/event-lifecycle';
import { deriveStatus, type OperationRow } from '@/lib/payments/status';
import { Constants } from '@/lib/supabase/types';

// ── The database side: close_event_retiring_setup as the newest migration defines it ──

function liveCloseFunction(): string {
  const dir = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
  const CREATE = /create\s+(or\s+replace\s+)?function\s+public\.close_event_retiring_setup\s*\(/i;
  const definers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => CREATE.test(readFileSync(join(dir, f), 'utf8')));
  expect(definers.length).toBeGreaterThan(0);
  const sql = readFileSync(join(dir, definers[definers.length - 1]), 'utf8');
  const from = sql.search(CREATE);
  const opening = sql.indexOf('$function$', from);
  const body = sql.slice(from, sql.indexOf('$function$', opening + 1));
  // Comments out, whitespace folded: the rules below are read from the code only.
  return body.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function statusList(fragment: string): CampaignStatus[] {
  return [...fragment.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as CampaignStatus);
}

const FN = liveCloseFunction();
// "if v_has_live and v.status in (…) then return 'blocked_paid'": the running service.
const RUNNING_MATCH = FN.match(/v_has_live and v\.status in \(([^)]*)\) then return 'blocked_paid'/);
// "if v_has_live and v.status in (…) then if exists (…succeeded…)": the setup stage, which the close retires.
const SETUP_MATCH = FN.match(/v_has_live and v\.status in \(([^)]*)\) then if exists/);
const SQL_RUNNING = statusList(RUNNING_MATCH?.[1] ?? '');
const SQL_SETUP = statusList(SETUP_MATCH?.[1] ?? '');

type DbResult = 'closed' | 'blocked_paid' | 'blocked_money';

// What the function answers for an open event whose live campaign has these status and ledger rows: the rules as written
// in its body - a running status refuses; a setup status refuses on any succeeded money row (test money included), then on
// a row still in flight; anything else closes.
function dbResult(campaign: CampaignStatus | null, rows: readonly OperationRow[]): DbResult {
  if (campaign === null) return 'closed';
  if (SQL_RUNNING.includes(campaign)) return 'blocked_paid';
  if (SQL_SETUP.includes(campaign)) {
    if (rows.some((o) => o.outcome === 'succeeded' && o.effect !== 'none')) return 'blocked_paid';
    if (rows.some((o) => o.outcome === 'pending' || o.outcome === 'review')) return 'blocked_money';
  }
  return 'closed';
}

// ── ledgers: rows as the payment tables hold them, derived by the same deriveStatus the screens use ──

let clock = 0;
function row(effect: OperationRow['effect'], outcome: OperationRow['outcome'], isTest = false): OperationRow {
  clock += 1;
  const at = new Date(Date.UTC(2026, 9, 1, 0, 0, clock)).toISOString();
  return { kind: effect, effect, outcome, amount: 100, credit: 0, occurredAt: at, recordedAt: at, isTest };
}

const LEDGERS: Record<string, OperationRow[]> = {
  'no payment': [],
  declined: [row('collect', 'failed')],
  'payment pending': [row('collect', 'pending')],
  'payment in review': [row('collect', 'review')],
  'paid (real)': [row('collect', 'succeeded')],
  'paid (test money)': [row('collect', 'succeeded', true)],
  'declined, then paid': [row('collect', 'failed'), row('collect', 'succeeded')],
  'hold only': [row('commit', 'succeeded')],
  'hold, charge declined': [row('commit', 'succeeded'), row('collect', 'failed')],
  'hold released': [row('commit', 'succeeded'), row('void', 'succeeded')],
  refunded: [row('collect', 'succeeded'), row('return', 'succeeded')],
  'test money refunded': [row('collect', 'succeeded', true), row('return', 'succeeded', true)],
  'refund in flight': [row('collect', 'succeeded'), row('return', 'pending')],
};

const LIVE_STATUSES = Constants.public.Enums.campaign_status.filter((s) => s !== 'cancelled');

function facts(
  eventStatus: EventLifecycleFacts['eventStatus'],
  campaign: CampaignStatus | null,
  rows: readonly OperationRow[] | 'unreadable',
): EventLifecycleFacts {
  return {
    eventStatus,
    campaignsVisible: true,
    campaign: campaign && { status: campaign, price: 100 },
    payment: campaign === null || rows === 'unreadable' ? null : deriveStatus(rows),
  };
}

describe('the database function, as read from its migration', () => {
  it('refuses the running statuses and retires exactly the cancellable ones', () => {
    expect(SQL_RUNNING).toEqual(['scheduled', 'active', 'paused']);
    expect(SQL_SETUP).toEqual([...CANCELLABLE_CAMPAIGN_STATUSES]);
  });
});

describe('the model never offers a close the database would refuse', () => {
  for (const eventStatus of ['draft', 'active'] as const) {
    it(`${eventStatus} event, no service → close offered, as the database closes it`, () => {
      expect(closeControlOf(resolveEventLifecycle(facts(eventStatus, null, []))).allowed).toBe(true);
      expect(dbResult(null, [])).toBe('closed');
    });
  }

  for (const campaign of LIVE_STATUSES) {
    for (const [ledger, rows] of Object.entries(LEDGERS)) {
      it(`${campaign} · ${ledger}`, () => {
        const offered = closeControlOf(resolveEventLifecycle(facts('active', campaign, rows))).allowed;
        expect(offered).toBe(dbResult(campaign, rows) === 'closed');
      });
    }

    it(`${campaign} · ledger unreadable → never offered (stricter than the database, never looser)`, () => {
      const control = closeControlOf(resolveEventLifecycle(facts('active', campaign, 'unreadable')));
      if (SQL_RUNNING.includes(campaign) || SQL_SETUP.includes(campaign)) {
        expect(control.allowed).toBe(false);
      } else {
        // A finished service no longer holds the event open: the ledger is not consulted, by the database either.
        expect(control.allowed).toBe(true);
      }
    });
  }

  it('a campaign without a package (nothing to pay) in setup → offered, as the database closes it', () => {
    const control = closeControlOf(
      resolveEventLifecycle({
        eventStatus: 'active',
        campaignsVisible: true,
        campaign: { status: 'pending_approval', price: null },
        payment: null,
      }),
    );
    expect(control.allowed).toBe(true);
    expect(dbResult('pending_approval', [])).toBe('closed');
  });

  it('a viewer who cannot see the campaigns → never offered', () => {
    const control = closeControlOf(
      resolveEventLifecycle({ eventStatus: 'active', campaignsVisible: false, campaign: null, payment: null }),
    );
    expect(control.allowed).toBe(false);
  });

  it('a closed event → nothing is offered, and no hint', () => {
    const control = closeControlOf(resolveEventLifecycle(facts('closed', 'pending_approval', [])));
    expect(control).toEqual({ allowed: false, hint: null, cancellationRequestable: false });
  });

  it('a draft event with a draft campaign → offered', () => {
    expect(closeControlOf(resolveEventLifecycle(facts('draft', 'draft', []))).allowed).toBe(true);
    expect(dbResult('draft', [])).toBe('closed');
  });
});

describe('what the screens say instead', () => {
  const control = (campaign: CampaignStatus, ledger: keyof typeof LEDGERS | 'unreadable') =>
    closeControlOf(resolveEventLifecycle(facts('active', campaign, ledger === 'unreadable' ? ledger : LEDGERS[ledger])));

  it('paid or running → the cancellation request, with the paid message', () => {
    for (const c of [control('approved', 'paid (real)'), control('approved', 'paid (test money)'), control('active', 'paid (real)')]) {
      expect(c).toEqual({ allowed: false, hint: CLOSE_BLOCKED_PAID_ERROR, cancellationRequestable: true });
    }
  });

  it('a payment in flight → contact support, no cancellation request', () => {
    for (const c of [control('approved', 'payment pending'), control('approved', 'payment in review')]) {
      expect(c).toEqual({ allowed: false, hint: CLOSE_BLOCKED_MONEY_ERROR, cancellationRequestable: false });
    }
  });

  it('money moved in another way, or an unreadable ledger → a support hint, no cancellation request', () => {
    for (const c of [control('approved', 'refunded'), control('approved', 'hold released'), control('approved', 'unreadable')]) {
      expect(c.allowed).toBe(false);
      expect(c.cancellationRequestable).toBe(false);
      expect(c.hint).not.toBeNull();
      expect(c.hint).not.toMatch(/קמפיין/);
    }
  });

  it('unpaid setup → the close, and no cancellation request', () => {
    expect(control('pending_approval', 'no payment')).toEqual({ allowed: true, hint: null, cancellationRequestable: false });
    expect(control('approved', 'declined')).toEqual({ allowed: true, hint: null, cancellationRequestable: false });
  });
});

// ── the event's mode (design D1): a projection of the snapshot ──

// Written out from the design (D1, D2, D6), not read back from the machine.
const EXPECTED_MODE: Record<string, EventMode> = {
  none: 'setup',
  setup: 'setup',
  paymentInFlight: 'setup',
  paid: 'management',
  running: 'management',
  finished: 'management',
  moneyMoved: 'unavailable',
  unavailable: 'unavailable',
};

describe('eventMode', () => {
  const top = (value: ReturnType<typeof serviceLeafValues>[number]) =>
    typeof value === 'string' ? value : Object.keys(value)[0];

  it('covers every top-level service state', () => {
    expect(new Set(serviceLeafValues().map(top))).toEqual(new Set(Object.keys(EXPECTED_MODE)));
  });

  for (const status of ['draft', 'active'] as const) {
    for (const service of serviceLeafValues()) {
      it(`${status} · ${JSON.stringify(service)} → ${EXPECTED_MODE[top(service)]}`, () => {
        const snapshot = eventLifecycleMachine.resolveState({ value: { open: { status, service } } });
        expect(eventMode(snapshot)).toBe(EXPECTED_MODE[top(service)]);
      });
    }
  }

  it('a closed event is management (its summary), never setup', () => {
    expect(eventMode(resolveEventLifecycle(facts('closed', 'pending_approval', [])))).toBe('management');
  });

  it('a ledger that cannot be read is unavailable, never setup or management', () => {
    for (const campaign of ['pending_approval', 'approved'] as const) {
      expect(eventMode(resolveEventLifecycle(facts('active', campaign, 'unreadable')))).toBe('unavailable');
    }
  });

  it('a viewer who cannot see the campaigns is unavailable (the permission-limited card)', () => {
    expect(
      eventMode(resolveEventLifecycle({ eventStatus: 'active', campaignsVisible: false, campaign: null, payment: null })),
    ).toBe('unavailable');
  });

  it('a reset event (its only campaign cancelled, so no live campaign) is setup', () => {
    expect(eventMode(resolveEventLifecycle(facts('active', null, [])))).toBe('setup');
  });

  it('paid but not yet running (awaiting activation) is already management', () => {
    expect(eventMode(resolveEventLifecycle(facts('active', 'approved', LEDGERS['paid (real)'])))).toBe('management');
    expect(eventMode(resolveEventLifecycle(facts('active', 'approved', LEDGERS['paid (test money)'])))).toBe('management');
  });

  it('a payment still in flight stays in setup (the payment step), money that moved is unavailable', () => {
    expect(eventMode(resolveEventLifecycle(facts('active', 'approved', LEDGERS['payment pending'])))).toBe('setup');
    expect(eventMode(resolveEventLifecycle(facts('active', 'approved', LEDGERS.refunded)))).toBe('unavailable');
  });
});

describe('the event region follows R6 (events_guard_update)', () => {
  it('only a draft is confirmed; draft and active both close', () => {
    const draft = resolveEventLifecycle(facts('draft', null, []));
    const active = resolveEventLifecycle(facts('active', null, []));
    expect(draft.can({ type: 'event.published' })).toBe(true);
    expect(active.can({ type: 'event.published' })).toBe(false);
    expect(draft.can({ type: 'event.close' })).toBe(true);
    expect(active.can({ type: 'event.close' })).toBe(true);
    expect(resolveEventLifecycle(facts('closed', null, [])).can({ type: 'event.close' })).toBe(false);
  });
});
