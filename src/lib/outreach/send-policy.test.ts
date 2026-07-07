import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEND_POLICY,
  parseSendPolicy,
  preferredMinutes,
  hhmmToMin,
} from './send-policy';

describe('parseSendPolicy', () => {
  it('accepts the shipped defaults', () => {
    expect(parseSendPolicy(DEFAULT_SEND_POLICY)).toEqual(DEFAULT_SEND_POLICY);
  });

  it('rejects a window that exceeds the ceilings (weekday 20:30 caught first)', () => {
    const bad = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        { start: '09:00', end: '22:30' }, // past both the 20:30 ceiling and 21:00
        ...DEFAULT_SEND_POLICY.weekday.slice(1),
      ],
    };
    expect(() => parseSendPolicy(bad)).toThrow(/20:30/);
  });

  it('rejects a start-after-end window', () => {
    const bad = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        { start: '20:00', end: '09:00' },
        ...DEFAULT_SEND_POLICY.weekday.slice(1),
      ],
    };
    expect(() => parseSendPolicy(bad)).toThrow(/start/);
  });

  it('rejects a malformed HH:MM', () => {
    expect(() =>
      parseSendPolicy({ ...DEFAULT_SEND_POLICY, hardCap: '25:00' }),
    ).toThrow();
  });

  it('requires Saturday (index 6) to be null', () => {
    const withSaturday = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        ...DEFAULT_SEND_POLICY.weekday.slice(0, 6),
        { start: '20:00', end: '20:30' },
      ],
    };
    expect(() => parseSendPolicy(withSaturday)).toThrow(/שבת/);
  });

  it('rejects a null window on any day other than Saturday (e.g. Sunday)', () => {
    const sundayNull = {
      ...DEFAULT_SEND_POLICY,
      weekday: [null, ...DEFAULT_SEND_POLICY.weekday.slice(1)],
    };
    expect(() => parseSendPolicy(sundayNull)).toThrow();
  });

  it('rejects a Sun–Thu window ending after 20:30 or starting before 09:00', () => {
    const lateEnd = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        { start: '09:00', end: '20:31' },
        ...DEFAULT_SEND_POLICY.weekday.slice(1),
      ],
    };
    expect(() => parseSendPolicy(lateEnd)).toThrow(/20:30/);
    const earlyStart = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        { start: '08:59', end: '20:30' },
        ...DEFAULT_SEND_POLICY.weekday.slice(1),
      ],
    };
    expect(() => parseSendPolicy(earlyStart)).toThrow(/09:00/);
  });

  it('rejects a Friday window ending after 12:00', () => {
    const bad = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        ...DEFAULT_SEND_POLICY.weekday.slice(0, 5),
        { start: '09:00', end: '12:30' },
        null,
      ],
    };
    expect(() => parseSendPolicy(bad)).toThrow(/12:00/);
  });

  it('rejects motzashPlusMin below 60', () => {
    expect(() =>
      parseSendPolicy({ ...DEFAULT_SEND_POLICY, motzashPlusMin: 45 }),
    ).toThrow(/60/);
  });

  it('allows an admin to NARROW a window within the ceilings', () => {
    const narrow = {
      ...DEFAULT_SEND_POLICY,
      weekday: [
        { start: '10:00', end: '18:00' }, // narrower than 09:00–20:30
        ...DEFAULT_SEND_POLICY.weekday.slice(1),
      ],
    };
    expect(() => parseSendPolicy(narrow)).not.toThrow();
  });
});

describe('preferredMinutes', () => {
  it('maps reminder type to its preferred time, else the default', () => {
    expect(preferredMinutes(DEFAULT_SEND_POLICY, 7)).toBe(hhmmToMin('11:00'));
    expect(preferredMinutes(DEFAULT_SEND_POLICY, 3)).toBe(hhmmToMin('17:30'));
    expect(preferredMinutes(DEFAULT_SEND_POLICY, 99)).toBe(hhmmToMin('11:00'));
  });
});
