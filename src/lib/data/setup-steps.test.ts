import { describe, expect, it } from 'vitest';

import {
  PACKAGE_PAY_LABEL,
  PAST_EVENT_HINT,
  SETUP_STEP_LABELS,
  computeSetupSteps,
  setupBackTarget,
  setupStepLabels,
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

describe('computeSetupSteps', () => {
  it('draft + ready → confirm is current and the flow has no guests step', () => {
    const input: SetupInput = { event: readyEvent, campaign: null, isPast: false };
    const r = computeSetupSteps(input);
    expect(stateOf(input)).toEqual({
      details: 'done',
      confirm: 'current',
      sign: 'pending',
      pay: 'pending',
      live: 'pending',
    });
    expect(r.steps.map((s) => s.key)).toEqual(['details', 'confirm', 'sign', 'pay', 'live']);
    expect(r.stage).toBe('not_set');
  });

  it('draft with missing prerequisites → details is the current step, with the list; confirm waits', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, venue_name: null },
      campaign: null,
      isPast: false,
    });
    const details = r.steps.find((s) => s.key === 'details');
    expect(details?.state).toBe('current');
    expect(details?.hint).toBe('יש להשלים: מקום האירוע');
    expect(r.steps.find((s) => s.key === 'confirm')?.state).toBe('pending');
  });

  it('confirmed event, campaign awaiting signature → sign is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'pending_approval', capture_status: null },
        isPast: false,
      }),
    ).toMatchObject({ confirm: 'done', sign: 'current', pay: 'pending', live: 'pending' });
  });

  it('confirmed event, NO campaign yet → sign is current (create-or-continue)', () => {
    expect(
      stateOf({ event: { ...readyEvent, status: 'active' }, campaign: null, isPast: false }),
    ).toMatchObject({ confirm: 'done', sign: 'current' });
  });

  it('signed, no hold → pay is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: null },
        isPast: false,
      }),
    ).toMatchObject({ sign: 'done', pay: 'current', live: 'pending' });
  });

  it('held but not active → live is current (activate in place)', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: 'authorized' },
        isPast: false,
      }),
    ).toMatchObject({ pay: 'done', live: 'current' });
  });

  it('active campaign → everything done, stage active', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'active', capture_status: 'authorized' },
      isPast: false,
    });
    expect(r.stage).toBe('active');
    expect(r.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('paused → live is current with the paused hint', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'paused', capture_status: 'authorized' },
      isPast: false,
    });
    expect(r.steps.find((s) => s.key === 'live')).toMatchObject({
      state: 'current',
      hint: 'הקמפיין מושהה',
    });
  });

  it('past event → the current step becomes blocked with the past-event hint', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'approved', capture_status: null },
      isPast: true,
    });
    expect(r.steps.find((s) => s.key === 'pay')).toMatchObject({
      state: 'blocked',
      hint: PAST_EVENT_HINT,
    });
  });

  it('exactly one step is current in every non-terminal state', () => {
    const active = { ...readyEvent, status: 'active' as const };
    const cases: SetupInput[] = [
      { event: readyEvent, campaign: null, isPast: false },
      { event: active, campaign: null, isPast: false },
      {
        event: active,
        campaign: { status: 'pending_approval', capture_status: null },
        isPast: false,
      },
      {
        event: active,
        campaign: { status: 'approved', capture_status: 'hold_failed' },
        isPast: false,
      },
      {
        event: active,
        campaign: { status: 'approved', capture_status: 'authorized' },
        isPast: false,
      },
    ];
    for (const c of cases) {
      expect(computeSetupSteps(c).steps.filter((s) => s.state === 'current')).toHaveLength(1);
    }
  });
});

// The fixed-price package model adds ONE step, between confirming the event and signing: the owner chooses a package,
// which is what creates the campaign. It exists only while a package is on offer (or the campaign is already a package
// campaign), so with no package on offer the flow is the five steps it always was.
describe('computeSetupSteps — the package-choice step', () => {
  const active = { ...readyEvent, status: 'active' as const };
  const keys = (input: SetupInput) => computeSetupSteps(input).steps.map((s) => s.key);

  it('is absent when no package is on offer — the flow is exactly the five steps it was', () => {
    for (const packageOffered of [undefined, false]) {
      expect(keys({ event: active, campaign: null, isPast: false, packageOffered })).toEqual([
        'details', 'confirm', 'sign', 'pay', 'live',
      ]);
    }
  });

  it('is placed between confirm and sign when a package is on offer', () => {
    expect(keys({ event: active, campaign: null, isPast: false, packageOffered: true })).toEqual([
      'details', 'confirm', 'package', 'sign', 'pay', 'live',
    ]);
  });

  it('confirmed, nothing chosen yet → package is current and sign waits (it needs the campaign the choice creates)', () => {
    expect(stateOf({ event: active, campaign: null, isPast: false, packageOffered: true })).toEqual({
      details: 'done', confirm: 'done', package: 'current', sign: 'pending', pay: 'pending', live: 'pending',
    });
  });

  it('a draft event, ready to confirm → confirm is current and package waits', () => {
    expect(stateOf({ event: readyEvent, campaign: null, isPast: false, packageOffered: true })).toMatchObject({
      confirm: 'current', package: 'pending', sign: 'pending',
    });
  });

  it('a package campaign exists → package is done and sign is current', () => {
    expect(
      stateOf({
        event: active,
        campaign: { status: 'pending_approval', capture_status: null, package_price: 150 },
        isPast: false,
        packageOffered: true,
      }),
    ).toMatchObject({ package: 'done', sign: 'current' });
  });

  it('a package campaign keeps its step even if the offer has since been withdrawn', () => {
    expect(
      keys({
        event: active,
        campaign: { status: 'pending_approval', capture_status: null, package_price: 150 },
        isPast: false,
        packageOffered: false,
      }),
    ).toContain('package');
  });

  it('a pay-per-result campaign already in flight keeps its own flow, even while packages are on offer', () => {
    const input: SetupInput = {
      event: active,
      campaign: { status: 'pending_approval', capture_status: null, package_price: null },
      isPast: false,
      packageOffered: true,
    };
    expect(keys(input)).toEqual(['details', 'confirm', 'sign', 'pay', 'live']);
    expect(stateOf(input)).toMatchObject({ sign: 'current' });
  });

  it('exactly one step is current in each state of the package flow', () => {
    const cases: SetupInput[] = [
      { event: readyEvent, campaign: null, isPast: false, packageOffered: true },
      { event: active, campaign: null, isPast: false, packageOffered: true },
      { event: active, campaign: { status: 'pending_approval', capture_status: null, package_price: 150 }, isPast: false, packageOffered: true },
      { event: active, campaign: { status: 'approved', capture_status: null, package_price: 150 }, isPast: false, packageOffered: true },
    ];
    for (const c of cases) {
      expect(computeSetupSteps(c).steps.filter((s) => s.state === 'current')).toHaveLength(1);
    }
  });

  it('a past event blocks the package step like any other current step', () => {
    const r = computeSetupSteps({ event: active, campaign: null, isPast: true, packageOffered: true });
    expect(r.steps.find((s) => s.key === 'package')).toMatchObject({ state: 'blocked', hint: PAST_EVENT_HINT });
  });
});

// The package flow has no signature: its "sign" step is the approval of the package terms, and the label says so.
describe('setupStepLabels', () => {
  const active = { ...readyEvent, status: 'active' as const };

  it('is the standard labels, unchanged, when the flow has no package step', () => {
    const { steps } = computeSetupSteps({ event: active, campaign: null, isPast: false });
    expect(setupStepLabels(steps)).toEqual(SETUP_STEP_LABELS);
  });

  it('in the package flow the signing step is an approval of the package terms and the payment step is the purchase', () => {
    const { steps } = computeSetupSteps({ event: active, campaign: null, isPast: false, packageOffered: true });
    const labels = setupStepLabels(steps);
    expect(labels.sign).toBe('אישור תנאי החבילה');
    expect(labels.pay).toBe(PACKAGE_PAY_LABEL);
    expect(labels.package).toBe('בחירת חבילה');
    // everything else is untouched
    expect({ ...labels, sign: SETUP_STEP_LABELS.sign, pay: SETUP_STEP_LABELS.pay }).toEqual(SETUP_STEP_LABELS);
  });

  it('a package campaign keeps the package labels even when the offer was withdrawn', () => {
    const { steps } = computeSetupSteps({
      event: active,
      campaign: { status: 'pending_approval', capture_status: null, package_price: 150 },
      isPast: false,
    });
    expect(setupStepLabels(steps).sign).toBe('אישור תנאי החבילה');
  });
});

describe('computeSetupSteps — a package campaign after payment', () => {
  const campaign = (payment: { status: string } | null): SetupInput['campaign'] => ({
    status: 'approved',
    capture_status: null,
    package_price: 150,
    payment,
  });
  const keys = (r: ReturnType<typeof computeSetupSteps>) => Object.fromEntries(r.steps.map((s) => [s.key, s.state]));
  const activeEvent: SetupInput['event'] = { ...readyEvent, status: 'active' };

  it('unpaid: the payment step is current, and the campaign is not live', () => {
    expect(keys(computeSetupSteps({ event: activeEvent, campaign: campaign({ status: 'none' }), isPast: false }))).toMatchObject({
      package: 'done',
      sign: 'done',
      pay: 'current',
      live: 'pending',
    });
  });

  it('paid, not yet active: payment done, activation is the current step', () => {
    const r = computeSetupSteps({ event: activeEvent, campaign: campaign({ status: 'collected' }), isPast: false });
    expect(keys(r)).toMatchObject({ pay: 'done', live: 'current' });
    expect(r.stage).toBe('awaiting_activation');
  });

  it('names the payment step for what the owner does — in the package flow only', () => {
    const r = computeSetupSteps({ event: activeEvent, campaign: campaign({ status: 'none' }), isPast: false });
    expect(setupStepLabels(r.steps).pay).toBe(PACKAGE_PAY_LABEL);
    const legacy = computeSetupSteps({ event: activeEvent, campaign: { status: 'approved', capture_status: null }, isPast: false });
    expect(setupStepLabels(legacy.steps).pay).toBe(SETUP_STEP_LABELS.pay);
  });
});


describe('setupBackTarget', () => {
  const activeEvent = { ...readyEvent, status: 'active' as const };
  const back = (input: SetupInput) => setupBackTarget({ eventId: 'e1', steps: computeSetupSteps(input).steps });

  it('on the confirm step: back to the details form, which is open while the event is still a draft', () => {
    expect(back({ event: readyEvent, campaign: null, isPast: false })).toEqual({ key: 'details', href: '/app/events/e1/setup?step=details' });
  });

  it('on the package-choice step: back to the event\'s own page, where a confirmed event is edited', () => {
    expect(back({ event: activeEvent, campaign: null, isPast: false, packageOffered: true })).toEqual({ key: 'details', href: '/app/events/e1' });
  });

  it('has no back on the details step: there is nothing before it', () => {
    expect(back({ event: { ...readyEvent, venue_name: null }, campaign: null, isPast: false })).toBeNull();
  });

  it.each([
    ['awaiting the approval', { status: 'pending_approval' as const, capture_status: null, package_price: 149 }],
    ['approved, awaiting payment', { status: 'approved' as const, capture_status: null, package_price: 149, payment: { status: 'none' } }],
    ['paid, awaiting activation', { status: 'approved' as const, capture_status: null, package_price: 149, payment: { status: 'collected' } }],
    ['active', { status: 'active' as const, capture_status: 'authorized', package_price: 149 }],
  ])('has no back once a campaign exists (%s): the choice, the approval and the payment cannot be undone from here', (_name, campaign) => {
    expect(back({ event: activeEvent, campaign, isPast: false })).toBeNull();
  });

  it('has no back for a past event: its current step is blocked, not current', () => {
    expect(back({ event: readyEvent, campaign: null, isPast: true })).toBeNull();
    expect(back({ event: activeEvent, campaign: null, isPast: true, packageOffered: true })).toBeNull();
  });
});
