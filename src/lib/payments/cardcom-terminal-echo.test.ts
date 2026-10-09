import { describe, expect, it } from 'vitest';

import { checkTerminalEcho, terminalEchoFromCardcom, terminalsConflict } from './cardcom-terminal-echo';

// The terminal CardCom names in its answer, read leniently enough that it can never make a paid answer unreadable (it is parsed as
// `unknown` upstream) and strictly enough that it can never be mistaken for a terminal when it is not one.

describe('terminalEchoFromCardcom', () => {
  it('reads a positive whole number', () => {
    expect(terminalEchoFromCardcom(1000)).toBe(1000);
    expect(terminalEchoFromCardcom(1)).toBe(1);
    expect(terminalEchoFromCardcom(2_147_483_647)).toBe(2_147_483_647);
  });

  it('reads nothing from a string, even a numeric one', () => {
    expect(terminalEchoFromCardcom('1000')).toBeNull();
    expect(terminalEchoFromCardcom('')).toBeNull();
    expect(terminalEchoFromCardcom(' ')).toBeNull();
  });

  it('reads nothing from zero, a negative number or a fraction', () => {
    expect(terminalEchoFromCardcom(0)).toBeNull();
    expect(terminalEchoFromCardcom(-1000)).toBeNull();
    expect(terminalEchoFromCardcom(1000.5)).toBeNull();
  });

  it('reads nothing from a number the 32-bit column cannot hold: a report that cannot be recorded counts as not reported', () => {
    expect(terminalEchoFromCardcom(2_147_483_648)).toBeNull();
    expect(terminalEchoFromCardcom(5_000_000_000)).toBeNull();
    expect(terminalEchoFromCardcom(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('reads nothing from a number that is not a safe integer', () => {
    expect(terminalEchoFromCardcom(Number.NaN)).toBeNull();
    expect(terminalEchoFromCardcom(Number.POSITIVE_INFINITY)).toBeNull();
    expect(terminalEchoFromCardcom(2 ** 60)).toBeNull();
  });

  it('reads nothing from a missing value or any other type', () => {
    expect(terminalEchoFromCardcom(undefined)).toBeNull();
    expect(terminalEchoFromCardcom(null)).toBeNull();
    expect(terminalEchoFromCardcom(true)).toBeNull();
    expect(terminalEchoFromCardcom(Symbol('1000'))).toBeNull();
    expect(terminalEchoFromCardcom({ TerminalNumber: 1000 })).toBeNull();
    expect(terminalEchoFromCardcom([1000])).toBeNull();
  });
});

// Every row of the table in plan section 2, once.
describe('checkTerminalEcho', () => {
  const ACCEPT = { verdict: 'accept' };

  it('a row with no stamp (written before the stamp existed) is believed whatever CardCom reports', () => {
    expect(checkTerminalEcho({ stamp: null, echo: null, isTestTerminal: false })).toEqual(ACCEPT);
    expect(checkTerminalEcho({ stamp: null, echo: 1000, isTestTerminal: false })).toEqual(ACCEPT);
    expect(checkTerminalEcho({ stamp: null, echo: 1001, isTestTerminal: false })).toEqual(ACCEPT);
  });

  it('a test-terminal payment that comes back naming the same terminal is accepted', () => {
    expect(checkTerminalEcho({ stamp: 1000, echo: 1000, isTestTerminal: true })).toEqual(ACCEPT);
  });

  it('a test-terminal payment that names no terminal must be looked at by a person', () => {
    expect(checkTerminalEcho({ stamp: 1000, echo: null, isTestTerminal: true })).toEqual({ verdict: 'review', reason: 'echo_missing' });
  });

  it('a test-terminal payment that names another terminal must be looked at by a person', () => {
    expect(checkTerminalEcho({ stamp: 1000, echo: 1001, isTestTerminal: true })).toEqual({ verdict: 'review', reason: 'echo_differs' });
  });

  it('a real-terminal payment that names the same terminal is accepted', () => {
    expect(checkTerminalEcho({ stamp: 1001, echo: 1001, isTestTerminal: false })).toEqual(ACCEPT);
  });

  it('a real-terminal payment that names no terminal is accepted, as before', () => {
    expect(checkTerminalEcho({ stamp: 1001, echo: null, isTestTerminal: false })).toEqual(ACCEPT);
  });

  it('a real-terminal payment that names another terminal must be looked at by a person, even when that one is the test terminal', () => {
    expect(checkTerminalEcho({ stamp: 1001, echo: 1000, isTestTerminal: false })).toEqual({ verdict: 'review', reason: 'echo_differs' });
    expect(checkTerminalEcho({ stamp: 1001, echo: 2002, isTestTerminal: false })).toEqual({ verdict: 'review', reason: 'echo_differs' });
  });

  it('decides from the stamp, the echo and the row class only - never from a terminal number it knows about', () => {
    // A row the database classified as test, on a terminal number this code has never heard of, is still held to the test rule.
    expect(checkTerminalEcho({ stamp: 777, echo: null, isTestTerminal: true })).toEqual({ verdict: 'review', reason: 'echo_missing' });
    expect(checkTerminalEcho({ stamp: 1000, echo: null, isTestTerminal: false })).toEqual(ACCEPT);
  });
});

describe('terminalsConflict', () => {
  it('is true only when both terminals are known and different', () => {
    expect(terminalsConflict(1000, 1001)).toBe(true);
    expect(terminalsConflict(1000, 1000)).toBe(false);
  });

  it('is false when either side is unknown: there is nothing to compare', () => {
    expect(terminalsConflict(null, 1001)).toBe(false);
    expect(terminalsConflict(1000, null)).toBe(false);
    expect(terminalsConflict(null, null)).toBe(false);
  });
});
