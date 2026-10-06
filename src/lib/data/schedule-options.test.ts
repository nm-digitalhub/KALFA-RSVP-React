import { describe, expect, it } from 'vitest';

import {
  NO_APPROVED_TEMPLATE_PROBLEM,
  STEP_OFF_PROBLEM,
  buildScheduleOptions,
  firstSelectableKey,
  hasApprovedDefaultRoute,
  type ScheduleStepRow,
} from './schedule-options';

const approved = { event_type: null, with_media: false, whatsapp_message_templates: { status: 'APPROVED' } };
const pending = { event_type: null, with_media: false, whatsapp_message_templates: { status: 'PENDING' } };

const step = (over: Partial<ScheduleStepRow> & { message_key: string }): ScheduleStepRow => ({
  channel: 'whatsapp',
  label: null,
  active: true,
  message_template_routes: [approved],
  ...over,
});

describe('hasApprovedDefaultRoute — the rule the sender and the save-time check both use', () => {
  it('needs a default route (no event type, no media) to an APPROVED template', () => {
    expect(hasApprovedDefaultRoute([approved])).toBe(true);
  });

  it.each([
    ['no routes', []],
    ['null routes', null],
    ['a template that is not approved', [pending]],
    ['a route for one event type only', [{ ...approved, event_type: 'wedding' }]],
    ['a media-only route', [{ ...approved, with_media: true }]],
    ['a route whose template is missing', [{ ...approved, whatsapp_message_templates: null }]],
  ])('is false for %s', (_label, routes) => {
    expect(hasApprovedDefaultRoute(routes as never)).toBe(false);
  });
});

describe('buildScheduleOptions', () => {
  it('offers a ready WhatsApp step with its label', () => {
    expect(buildScheduleOptions([step({ message_key: 'invite', label: 'הזמנה' })])).toEqual([
      { channel: 'whatsapp', messageKey: 'invite', label: 'הזמנה', problem: null },
    ]);
  });

  it('falls back to the key when a step has no label', () => {
    expect(buildScheduleOptions([step({ message_key: 'invite', label: '  ' })])[0].label).toBe('invite');
  });

  it('shows a step that cannot be picked, with the reason', () => {
    const options = buildScheduleOptions([
      step({ message_key: 'invite', active: false }),
      step({ message_key: 'final', message_template_routes: [pending] }),
    ]);
    expect(options.find((o) => o.messageKey === 'invite')?.problem).toBe(STEP_OFF_PROBLEM);
    expect(options.find((o) => o.messageKey === 'final')?.problem).toBe(NO_APPROVED_TEMPLATE_PROBLEM);
  });

  it('leaves out what is not a touchpoint of an event\'s schedule: a lead step and the post-event step', () => {
    const keys = buildScheduleOptions([
      step({ message_key: 'invite' }),
      step({ message_key: 'sales_signup_link' }),
      step({ message_key: 'thankyou' }),
    ]).map((o) => o.messageKey);
    expect(keys).toEqual(['invite']);
  });

  it('lists call steps without a problem — their key is not read by anything — even when switched off', () => {
    const options = buildScheduleOptions([step({ message_key: 'call_1', channel: 'call', active: false, message_template_routes: null })]);
    expect(options).toEqual([{ channel: 'call', messageKey: 'call_1', label: 'call_1', problem: null }]);
  });

  it('orders the steps of a channel as a guest meets them, and puts an unknown step last', () => {
    const options = buildScheduleOptions([
      step({ message_key: 'zzz_new' }),
      step({ message_key: 'final' }),
      step({ message_key: 'call_1', channel: 'call' }),
      step({ message_key: 'invite' }),
      step({ message_key: 'reminder_1' }),
    ]);
    expect(options.filter((o) => o.channel === 'whatsapp').map((o) => o.messageKey)).toEqual(['invite', 'reminder_1', 'final', 'zzz_new']);
    expect(options.filter((o) => o.channel === 'call').map((o) => o.messageKey)).toEqual(['call_1']);
  });
});

describe('firstSelectableKey', () => {
  const options = buildScheduleOptions([
    step({ message_key: 'invite', active: false }),
    step({ message_key: 'reminder_1' }),
    step({ message_key: 'call_1', channel: 'call' }),
  ]);

  it('is the first step of the channel that can be picked, skipping one that cannot', () => {
    expect(firstSelectableKey(options, 'whatsapp')).toBe('reminder_1');
    expect(firstSelectableKey(options, 'call')).toBe('call_1');
  });

  it('is empty when the channel has nothing to pick', () => {
    expect(firstSelectableKey(options, 'sms')).toBe('');
  });
});
