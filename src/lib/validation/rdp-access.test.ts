import { describe, expect, it } from 'vitest';

import { RDP_REASON_MAX, RDP_REASON_MIN } from '@/lib/rdp-access/policy';

import { RDP_ACCESS_ERRORS, rdpGatewayCheckBodySchema, rdpRequestFormSchema } from './rdp-access';

describe('rdpRequestFormSchema', () => {
  const ok = { reason: 'Maintenance window for the worker', minutes: '60' };

  it('accepts a reason and a preset duration, coercing the form string', () => {
    expect(rdpRequestFormSchema.parse(ok)).toEqual({ reason: ok.reason, minutes: 60 });
  });

  it('trims the reason before measuring it', () => {
    const parsed = rdpRequestFormSchema.parse({ ...ok, reason: `   ${ok.reason}   ` });
    expect(parsed.reason).toBe(ok.reason);
  });

  it(`rejects a reason shorter than ${RDP_REASON_MIN} characters after trimming`, () => {
    const result = rdpRequestFormSchema.safeParse({ ...ok, reason: `  ${'x'.repeat(RDP_REASON_MIN - 1)}  ` });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RDP_ACCESS_ERRORS.reasonTooShort);
  });

  it(`rejects a reason longer than ${RDP_REASON_MAX} characters`, () => {
    const result = rdpRequestFormSchema.safeParse({ ...ok, reason: 'x'.repeat(RDP_REASON_MAX + 1) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RDP_ACCESS_ERRORS.reasonTooLong);
  });

  it('accepts exactly the boundary lengths', () => {
    expect(rdpRequestFormSchema.safeParse({ ...ok, reason: 'x'.repeat(RDP_REASON_MIN) }).success).toBe(true);
    expect(rdpRequestFormSchema.safeParse({ ...ok, reason: 'x'.repeat(RDP_REASON_MAX) }).success).toBe(true);
  });

  it('accepts Hebrew text', () => {
    expect(rdpRequestFormSchema.safeParse({ ...ok, reason: 'תחזוקה שוטפת של שרת העבודה' }).success).toBe(true);
  });

  it.each(['30', '60', '120', '240', 30])('accepts the preset %s', (minutes) => {
    expect(rdpRequestFormSchema.safeParse({ ...ok, minutes }).success).toBe(true);
  });

  it.each(['0', '5', '45', '241', '1000', '-60', '60.5', 'abc', '', null, undefined])(
    'rejects the duration %j, which is not a preset',
    (minutes) => {
      const result = rdpRequestFormSchema.safeParse({ ...ok, minutes });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(RDP_ACCESS_ERRORS.minutesInvalid);
    },
  );

  it('rejects a missing reason with the required message', () => {
    const result = rdpRequestFormSchema.safeParse({ minutes: '60' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RDP_ACCESS_ERRORS.reasonRequired);
  });
});

describe('rdpGatewayCheckBodySchema', () => {
  const ok = {
    user: 'kalfa.me',
    clientIp: '203.0.113.7',
    target: 'desktop.example.test:3389',
    tunnelId: 'tunnel-1',
    rdgConnectionId: 'conn-1',
  };

  it('accepts the contract body', () => {
    expect(rdpGatewayCheckBodySchema.parse(ok)).toEqual(ok);
  });

  it('accepts the optional ids being absent and an IPv6 client address', () => {
    expect(rdpGatewayCheckBodySchema.safeParse({ user: ok.user, clientIp: '2001:db8::1', target: ok.target }).success).toBe(
      true,
    );
  });

  it('is strict: an unknown key, such as a smuggled token, is refused', () => {
    const result = rdpGatewayCheckBodySchema.safeParse({ ...ok, paaToken: 'secret' });
    expect(result.success).toBe(false);
  });

  it.each([
    ['a non-IP client address', { clientIp: 'not-an-ip' }],
    ['an IP with a port', { clientIp: '203.0.113.7:3389' }],
    ['a target without a port', { target: 'desktop.example.test' }],
    ['a target with a port above 65535', { target: 'desktop.example.test:99999' }],
    ['a target with port 0', { target: 'desktop.example.test:0' }],
    ['a target with a path', { target: 'desktop.example.test:3389/x' }],
    ['an empty user', { user: '' }],
    ['a very long tunnel id', { tunnelId: 'x'.repeat(65) }],
  ])('rejects %s', (_label, patch) => {
    expect(rdpGatewayCheckBodySchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});
