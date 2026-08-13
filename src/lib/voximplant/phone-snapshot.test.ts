import { describe, expect, it } from 'vitest';

import { type ConsolePhoneSnapshot, reducePhoneSnapshot } from './phone-snapshot';

const LOGGED_IN: ConsolePhoneSnapshot = {
  state: 'logged_in',
  sdkState: 'LOGGED_IN',
  displayName: 'Agent A',
};

describe('reducePhoneSnapshot — SDK transport/login mapping', () => {
  it('logged_in -> reconnecting on ClientState RECONNECTING', () => {
    const next = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState: 'RECONNECTING' });
    expect(next.state).toBe('reconnecting');
    // Never loses what it already knew (displayName) mid-reconnect — only the
    // state/sdkState fields change, matching the spread-preserving shape the
    // old inline mapping had.
    expect(next.displayName).toBe('Agent A');
  });

  it('reconnecting -> logged_in only on an exact ClientState LOGGED_IN', () => {
    const reconnecting = reducePhoneSnapshot(LOGGED_IN, {
      type: 'sdk_state',
      sdkState: 'RECONNECTING',
    });
    const recovered = reducePhoneSnapshot(reconnecting, {
      type: 'sdk_state',
      sdkState: 'LOGGED_IN',
    });
    expect(recovered.state).toBe('logged_in');
  });

  it('reconnecting -> disconnected when the SDK gives up entirely', () => {
    const reconnecting = reducePhoneSnapshot(LOGGED_IN, {
      type: 'sdk_state',
      sdkState: 'RECONNECTING',
    });
    const gaveUp = reducePhoneSnapshot(reconnecting, { type: 'sdk_state', sdkState: 'DISCONNECTED' });
    expect(gaveUp.state).toBe('disconnected');
  });

  describe('logged_in -> CONNECTED with no RECONNECTING in between (team-lead review finding, 12.8)', () => {
    // The hole: nothing in the SDK's ClientState enum or docs guarantees
    // RECONNECTING always precedes CONNECTED on a reconnect. A version of
    // this reducer that allowlisted only RECONNECTING/DISCONNECTED and fell
    // through to "keep logged_in" for every other sdkState — including a
    // bare CONNECTED reached directly from logged_in — would leave the
    // heartbeat beating successfully and agent_status.updated_at fresh while
    // the SDK was not actually confirmed logged in: WORSE than the original
    // incident, because the agent looks routable and the caller hears
    // ringing instead of the honest no-agent line. This pins the fix: ANY
    // sdkState other than an exact LOGGED_IN or DISCONNECTED must move OUT
    // of logged_in, never stay in it. A future refactor that reintroduces an
    // allowlist-of-known-transients (instead of "only LOGGED_IN keeps it")
    // must fail this test.
    it('does NOT remain logged_in — it must become reconnecting (arming the watchdog)', () => {
      const next = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState: 'CONNECTED' });
      expect(next.state).toBe('reconnecting');
      expect(next.sdkState).toBe('CONNECTED');
    });

    it('the same hole applies to every other non-LOGGED_IN, non-DISCONNECTED ClientState value', () => {
      for (const sdkState of ['CONNECTING', 'LOGGING_IN', 'DISCONNECTING']) {
        const next = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState });
        expect(next.state).toBe('reconnecting');
      }
    });

    it('an unrecognized future ClientState value also falls to reconnecting, never logged_in — this reducer is an allowlist, not a denylist', () => {
      const next = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState: 'SOME_FUTURE_SDK_STATE' });
      expect(next.state).toBe('reconnecting');
    });

    it('end-to-end: logged_in -> CONNECTED -> watchdog timeout reaches the same honest error as the RECONNECTING path', () => {
      const stuck = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState: 'CONNECTED' });
      expect(stuck.state).toBe('reconnecting'); // this is what arms web-client.ts's watchdog
      const timedOut = reducePhoneSnapshot(stuck, { type: 'reconnect_timeout' });
      expect(timedOut.state).toBe('error');
    });
  });

  it('idle/connecting/logging_in/other_tab/error/disconnected are never touched by sdk_state — only connectAndLogin\'s own explicit calls promote out of them', () => {
    const untouchedStates: ConsolePhoneSnapshot['state'][] = [
      'idle',
      'connecting',
      'logging_in',
      'other_tab',
      'error',
      'disconnected',
    ];
    for (const state of untouchedStates) {
      const snap: ConsolePhoneSnapshot = { state };
      const next = reducePhoneSnapshot(snap, { type: 'sdk_state', sdkState: 'LOGGED_IN' });
      // The mapping only special-cases logged_in/reconnecting; every other
      // state falls through to the "just record sdkState" branch, exactly
      // like the old inline code — a stray LOGGED_IN tick can never
      // resurrect a snapshot the app itself moved to idle/error/etc.
      expect(next.state).toBe(state);
    }
  });

  describe('reconnect_timeout — the incident fix', () => {
    it('demotes a genuinely stuck reconnecting snapshot to an honest, actionable error', () => {
      const reconnecting = reducePhoneSnapshot(LOGGED_IN, {
        type: 'sdk_state',
        sdkState: 'RECONNECTING',
      });
      const timedOut = reducePhoneSnapshot(reconnecting, { type: 'reconnect_timeout' });
      expect(timedOut.state).toBe('error');
      expect(timedOut.detail).toBeTruthy();
      expect(timedOut.diag).toContain('reconnect-timeout');
    });

    it('is a no-op if the snapshot already recovered or moved on before the watchdog fired', () => {
      // web-client.ts only dispatches this while still 'reconnecting' at fire
      // time, but the reducer defends against a late/racing timer anyway —
      // it must never clobber a snapshot that has already reached logged_in,
      // disconnected, or anything else.
      for (const already of [LOGGED_IN, { state: 'disconnected' } as ConsolePhoneSnapshot, { state: 'idle' } as ConsolePhoneSnapshot]) {
        const result = reducePhoneSnapshot(already, { type: 'reconnect_timeout' });
        expect(result).toEqual(already);
      }
    });

    it('the stuck-at-CONNECTED shape from the actual incident resolves to error, not an eternal reconnecting', () => {
      // Reproduces the reported failure sequence: logged_in -> RECONNECTING
      // (transport drop) -> CONNECTED (transport recovered, but the
      // single-use one-time-key login was never silently replayed) -> stuck.
      // Before this fix there was no way OUT of 'reconnecting' short of an
      // exact LOGGED_IN tick that this sequence never produces.
      let snap = reducePhoneSnapshot(LOGGED_IN, { type: 'sdk_state', sdkState: 'RECONNECTING' });
      snap = reducePhoneSnapshot(snap, { type: 'sdk_state', sdkState: 'CONNECTED' });
      expect(snap.state).toBe('reconnecting'); // still honestly "trying", not yet timed out

      const timedOut = reducePhoneSnapshot(snap, { type: 'reconnect_timeout' });
      expect(timedOut.state).toBe('error');
    });
  });
});
