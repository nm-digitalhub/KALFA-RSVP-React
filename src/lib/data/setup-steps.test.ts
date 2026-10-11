import { describe, expect, it } from 'vitest';

import {
  PAST_EVENT_HINT,
  SETUP_STEP_LABELS,
  computeSetupSteps,
  setupBackTarget,
  missingEventPrerequisites,
  missingSetupPrerequisites,
  type SetupInput,
} from '@/lib/data/setup-steps';

const FUTURE = '2999-01-01T18:00:00+00:00';
const readyEvent: SetupInput['event'] = {
  status: 'draft',
  event_type: 'wedding',
  event_date: FUTURE,
  venue_name: 'אולם',
  venue_address: 'הרצל 1, תל אביב',
  celebrants: { groom: 'דני', bride: 'דנה' },
};

function stateOf(input: SetupInput) {
  return Object.fromEntries(computeSetupSteps(input).steps.map((s) => [s.key, s.state]));
}

describe('missingEventPrerequisites', () => {
  it('lists every missing ingredient createCampaign would refuse on', () => {
    expect(
      missingEventPrerequisites({
        status: 'draft',
        event_type: 'wedding',
        event_date: null,
        venue_name: '',
        venue_address: null,
        celebrants: null,
      }),
    ).toEqual(['תאריך אירוע עתידי', 'שעת האירוע', 'פרטי בעלי השמחה', 'מקום האירוע', 'כתובת המקום']);
  });

  it('is empty when date and time are set, celebrants complete, venue and address set', () => {
    expect(missingEventPrerequisites(readyEvent)).toEqual([]);
  });

  it('a date-only value (no time of day) is missing the time', () => {
    // Stored midnight UTC is how a date without a time is kept (ilWallTimeToIso).
    expect(
      missingEventPrerequisites({ ...readyEvent, event_date: '2999-01-01T00:00:00+00:00' }),
    ).toEqual(['שעת האירוע']);
  });

  it('names the FORM FIELD each missing prerequisite belongs to, so the form can mark it', () => {
    expect(
      missingSetupPrerequisites({
        ...readyEvent,
        event_date: '2999-01-01T00:00:00+00:00',
        venue_name: '',
        venue_address: null,
        celebrants: null,
      }),
    ).toEqual([
      { label: 'שעת האירוע', field: 'event_time' },
      { label: 'פרטי בעלי השמחה', field: null },
      { label: 'מקום האירוע', field: 'venue_name' },
      { label: 'כתובת המקום', field: 'venue_address' },
    ]);
  });

  it('a blank address counts as missing', () => {
    expect(missingEventPrerequisites({ ...readyEvent, venue_address: '   ' })).toEqual(['כתובת המקום']);
  });
});

// The flow: details → confirm → package choice (which creates the campaign) → approve the terms → pay → live.
describe('computeSetupSteps', () => {
  const active = { ...readyEvent, status: 'active' as const };
  const pkg = (status: 'pending_approval' | 'approved' | 'active' | 'paused', payment?: { status: string } | null) => ({
    status,
    package_price: 150,
    payment,
  });

  it('draft + ready → confirm is current; the package step waits', () => {
    const input: SetupInput = { event: readyEvent, campaign: null, isPast: false };
    const r = computeSetupSteps(input);
    expect(stateOf(input)).toEqual({
      details: 'done',
      confirm: 'current',
      package: 'pending',
      sign: 'pending',
      pay: 'pending',
      live: 'pending',
    });
    expect(r.steps.map((s) => s.key)).toEqual(['details', 'confirm', 'package', 'sign', 'pay', 'live']);
    expect(r.stage).toBe('not_set');
  });

  it('draft with missing prerequisites → details is the current step, with the list; confirm waits', () => {
    const r = computeSetupSteps({ event: { ...readyEvent, venue_name: null }, campaign: null, isPast: false });
    const details = r.steps.find((s) => s.key === 'details');
    expect(details?.state).toBe('current');
    expect(details?.hint).toBe('יש להשלים: מקום האירוע');
    expect(r.steps.find((s) => s.key === 'confirm')?.state).toBe('pending');
  });

  it('confirmed, no campaign yet → the package step is current, also when no package is on offer (the step says so)', () => {
    expect(stateOf({ event: active, campaign: null, isPast: false })).toEqual({
      details: 'done', confirm: 'done', package: 'current', sign: 'pending', pay: 'pending', live: 'pending',
    });
  });

  it('a campaign awaiting approval → package is done and approving the terms is current', () => {
    expect(stateOf({ event: active, campaign: pkg('pending_approval'), isPast: false })).toMatchObject({
      package: 'done', sign: 'current', pay: 'pending',
    });
  });

  it('approved, unpaid → the payment step is current and the campaign is not live', () => {
    expect(stateOf({ event: active, campaign: pkg('approved', { status: 'none' }), isPast: false })).toMatchObject({
      sign: 'done', pay: 'current', live: 'pending',
    });
  });

  it('paid, not yet active → activation is the current step', () => {
    const r = computeSetupSteps({ event: active, campaign: pkg('approved', { status: 'collected' }), isPast: false });
    expect(stateOf({ event: active, campaign: pkg('approved', { status: 'collected' }), isPast: false })).toMatchObject({
      pay: 'done', live: 'current',
    });
    expect(r.stage).toBe('awaiting_activation');
  });

  it('active campaign → everything done, stage active', () => {
    const r = computeSetupSteps({ event: active, campaign: pkg('active', { status: 'collected' }), isPast: false });
    expect(r.stage).toBe('active');
    expect(r.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('paused → live is current with the paused hint', () => {
    const r = computeSetupSteps({ event: active, campaign: pkg('paused', { status: 'collected' }), isPast: false });
    expect(r.steps.find((s) => s.key === 'live')).toMatchObject({ state: 'current', hint: 'הקמפיין מושהה' });
  });

  it('past event → the current step becomes blocked with the past-event hint', () => {
    const r = computeSetupSteps({ event: active, campaign: pkg('approved', { status: 'none' }), isPast: true });
    expect(r.steps.find((s) => s.key === 'pay')).toMatchObject({ state: 'blocked', hint: PAST_EVENT_HINT });
    const noCampaign = computeSetupSteps({ event: active, campaign: null, isPast: true });
    expect(noCampaign.steps.find((s) => s.key === 'package')).toMatchObject({ state: 'blocked', hint: PAST_EVENT_HINT });
  });

  it('exactly one step is current in every non-terminal state', () => {
    const cases: SetupInput[] = [
      { event: readyEvent, campaign: null, isPast: false },
      { event: active, campaign: null, isPast: false },
      { event: active, campaign: pkg('pending_approval'), isPast: false },
      { event: active, campaign: pkg('approved', { status: 'none' }), isPast: false },
      { event: active, campaign: pkg('approved', { status: 'collected' }), isPast: false },
    ];
    for (const c of cases) {
      expect(computeSetupSteps(c).steps.filter((s) => s.state === 'current')).toHaveLength(1);
    }
  });
});

describe('SETUP_STEP_LABELS', () => {
  it('names each step for what the owner does: choose a package, approve its terms, pay for it', () => {
    expect(SETUP_STEP_LABELS.package).toBe('בחירת חבילה');
    expect(SETUP_STEP_LABELS.sign).toBe('אישור תנאי החבילה');
    expect(SETUP_STEP_LABELS.pay).toBe('תשלום החבילה');
  });
});

describe('setupBackTarget', () => {
  const activeEvent = { ...readyEvent, status: 'active' as const };
  const back = (input: SetupInput) => setupBackTarget({ eventId: 'e1', steps: computeSetupSteps(input).steps });

  it('on the confirm step: back to the details form, which is open while the event is still a draft', () => {
    expect(back({ event: readyEvent, campaign: null, isPast: false })).toEqual({ key: 'details', href: '/app/events/e1/setup?step=details' });
  });

  it('on the package-choice step: back to the event\'s own page, where a confirmed event is edited', () => {
    expect(back({ event: activeEvent, campaign: null, isPast: false })).toEqual({ key: 'details', href: '/app/events/e1' });
  });

  it('has no back on the details step: there is nothing before it', () => {
    expect(back({ event: { ...readyEvent, venue_name: null }, campaign: null, isPast: false })).toBeNull();
  });

  it.each([
    ['awaiting the approval', { status: 'pending_approval' as const, package_price: 149 }],
    ['approved, awaiting payment', { status: 'approved' as const, package_price: 149, payment: { status: 'none' } }],
    ['paid, awaiting activation', { status: 'approved' as const, package_price: 149, payment: { status: 'collected' } }],
    ['active', { status: 'active' as const, package_price: 149 }],
  ])('has no back once a campaign exists (%s): the choice, the approval and the payment cannot be undone from here', (_name, campaign) => {
    expect(back({ event: activeEvent, campaign, isPast: false })).toBeNull();
  });

  it('has no back for a past event: its current step is blocked, not current', () => {
    expect(back({ event: readyEvent, campaign: null, isPast: true })).toBeNull();
    expect(back({ event: activeEvent, campaign: null, isPast: true })).toBeNull();
  });
});
