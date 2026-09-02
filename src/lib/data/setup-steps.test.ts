import { describe, expect, it } from 'vitest';

import {
  NO_GUESTS_HINT,
  PAST_EVENT_HINT,
  computeSetupSteps,
  missingEventPrerequisites,
  type SetupInput,
} from '@/lib/data/setup-steps';

const FUTURE = '2999-01-01T18:00:00+00:00';
const readyEvent: SetupInput['event'] = {
  status: 'draft',
  event_type: 'wedding',
  event_date: FUTURE,
  venue_name: 'אולם',
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
        celebrants: null,
      }),
    ).toEqual(['תאריך אירוע עתידי', 'פרטי בעלי השמחה', 'מקום האירוע']);
  });

  it('is empty when date is future, celebrants complete, venue set', () => {
    expect(missingEventPrerequisites(readyEvent)).toEqual([]);
  });
});

describe('computeSetupSteps', () => {
  it('draft + ready + no guests → confirm is current, guests is a soft (pending) recommendation', () => {
    const input: SetupInput = { event: readyEvent, campaign: null, guestCount: 0, isPast: false };
    const r = computeSetupSteps(input);
    expect(stateOf(input)).toEqual({
      details: 'done',
      guests: 'pending',
      confirm: 'current',
      sign: 'pending',
      pay: 'pending',
      live: 'pending',
    });
    expect(r.steps.find((s) => s.key === 'guests')?.hint).toBe(NO_GUESTS_HINT);
    expect(r.stage).toBe('not_set');
  });

  it('draft with missing prerequisites → confirm is blocked with the list', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, venue_name: null },
      campaign: null,
      guestCount: 3,
      isPast: false,
    });
    const confirm = r.steps.find((s) => s.key === 'confirm');
    expect(confirm?.state).toBe('blocked');
    expect(confirm?.hint).toBe('יש להשלים: מקום האירוע');
  });

  it('confirmed event, campaign awaiting signature → sign is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'pending_approval', capture_status: null },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ confirm: 'done', sign: 'current', pay: 'pending', live: 'pending', guests: 'done' });
  });

  it('confirmed event, NO campaign yet → sign is current (create-or-continue)', () => {
    expect(
      stateOf({ event: { ...readyEvent, status: 'active' }, campaign: null, guestCount: 3, isPast: false }),
    ).toMatchObject({ confirm: 'done', sign: 'current' });
  });

  it('signed, no hold → pay is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: null },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ sign: 'done', pay: 'current', live: 'pending' });
  });

  it('held but not active → live is current (activate in place)', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: 'authorized' },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ pay: 'done', live: 'current' });
  });

  it('active campaign → everything done, stage active, guests hint changes', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'active', capture_status: 'authorized' },
      guestCount: 0,
      isPast: false,
    });
    expect(r.stage).toBe('active');
    expect(r.steps.every((s) => s.key === 'guests' || s.state === 'done')).toBe(true);
    // Guests still empty AFTER activation: the campaign has nobody to send to.
    expect(r.steps.find((s) => s.key === 'guests')?.hint).toBe('הפניות יישלחו רק למוזמנים שברשימה');
  });

  it('paused → live is current with the paused hint', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'paused', capture_status: 'authorized' },
      guestCount: 3,
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
      guestCount: 3,
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
      { event: readyEvent, campaign: null, guestCount: 0, isPast: false },
      { event: active, campaign: null, guestCount: 0, isPast: false },
      {
        event: active,
        campaign: { status: 'pending_approval', capture_status: null },
        guestCount: 0,
        isPast: false,
      },
      {
        event: active,
        campaign: { status: 'approved', capture_status: 'hold_failed' },
        guestCount: 0,
        isPast: false,
      },
      {
        event: active,
        campaign: { status: 'approved', capture_status: 'authorized' },
        guestCount: 0,
        isPast: false,
      },
    ];
    for (const c of cases) {
      expect(computeSetupSteps(c).steps.filter((s) => s.state === 'current')).toHaveLength(1);
    }
  });
});
