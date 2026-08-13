import { describe, expect, it } from 'vitest';

import {
  CALL_ACTIVE_STATES,
  IDLE_CALL_SNAPSHOT,
  type CallSnapshotAction,
  type ConsoleCallSnapshot,
  reduceCallSnapshot,
} from './call-snapshot';

const CALL_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_CALL_ID = '22222222-2222-2222-2222-222222222222';

function afterOutgoingStarted(): ConsoleCallSnapshot {
  return reduceCallSnapshot(IDLE_CALL_SNAPSHOT, {
    type: 'outgoing_started',
    callId: CALL_ID,
    destination: 'agent_x',
    now: 1000,
  });
}

describe('reduceCallSnapshot — honest-UI rule', () => {
  it('never reaches connected from anything other than sdk_connected', () => {
    const started = afterOutgoingStarted();
    expect(started.state).toBe('ringing_out');

    // Every OTHER action type, fed against the same call, must never
    // promote state to 'connected'. This is the mechanical enforcement of
    // "never show a state without its signal".
    const otherActions: CallSnapshotAction[] = [
      { type: 'remote_display_name', callId: CALL_ID, value: 'Someone' },
      { type: 'mute_changed', callId: CALL_ID, value: true },
      { type: 'hold_changed', callId: CALL_ID, value: true },
      { type: 'mic_denied', reason: 'denied' },
      { type: 'sdk_disconnected', callId: OTHER_CALL_ID, now: 2000 }, // stale/mismatched
      { type: 'sdk_failed', callId: OTHER_CALL_ID, diag: 'x', now: 2000 }, // stale/mismatched
      { type: 'incoming_call', callId: OTHER_CALL_ID, remoteDisplayName: null, now: 2000 },
    ];

    for (const action of otherActions) {
      const next = reduceCallSnapshot(started, action);
      expect(next.state).not.toBe('connected');
    }
  });

  it('sdk_connected promotes ringing_out -> connected only for the matching callId', () => {
    const started = afterOutgoingStarted();
    const mismatched = reduceCallSnapshot(started, {
      type: 'sdk_connected',
      callId: OTHER_CALL_ID,
      now: 1500,
    });
    expect(mismatched.state).toBe('ringing_out'); // stale event ignored

    const connected = reduceCallSnapshot(started, {
      type: 'sdk_connected',
      callId: CALL_ID,
      now: 1500,
    });
    expect(connected.state).toBe('connected');
    expect(connected.connectedAt).toBe(1500);
  });

  it('incoming_call starts ringing_in with the SDK-provided display name', () => {
    const snap = reduceCallSnapshot(IDLE_CALL_SNAPSHOT, {
      type: 'incoming_call',
      callId: CALL_ID,
      remoteDisplayName: 'Agent B',
      now: 500,
    });
    expect(snap.state).toBe('ringing_in');
    expect(snap.direction).toBe('incoming');
    expect(snap.remoteDisplayName).toBe('Agent B');
  });

  it('sdk_failed carries a diag string and ends the call', () => {
    const started = afterOutgoingStarted();
    const failed = reduceCallSnapshot(started, {
      type: 'sdk_failed',
      callId: CALL_ID,
      diag: '486 Busy Here',
      now: 3000,
    });
    expect(failed.state).toBe('failed');
    expect(failed.diag).toBe('486 Busy Here');
    expect(failed.endedAt).toBe(3000);
  });

  it('sdk_disconnected ends a connected call', () => {
    const started = afterOutgoingStarted();
    const connected = reduceCallSnapshot(started, {
      type: 'sdk_connected',
      callId: CALL_ID,
      now: 1500,
    });
    const ended = reduceCallSnapshot(connected, {
      type: 'sdk_disconnected',
      callId: CALL_ID,
      now: 4000,
    });
    expect(ended.state).toBe('ended');
    expect(ended.endedAt).toBe(4000);
  });

  it('a new outgoing/incoming call clears stale mute/hold/micError from the previous one', () => {
    const started = afterOutgoingStarted();
    const muted = reduceCallSnapshot(started, {
      type: 'mute_changed',
      callId: CALL_ID,
      value: true,
    });
    const micErr = reduceCallSnapshot(muted, { type: 'mic_denied', reason: 'denied' });
    expect(micErr.muted).toBe(true);
    expect(micErr.micError).toBe('denied');

    const nextCall = reduceCallSnapshot(micErr, {
      type: 'outgoing_started',
      callId: OTHER_CALL_ID,
      destination: 'agent_y',
      now: 9000,
    });
    expect(nextCall.muted).toBe(false);
    expect(nextCall.micError).toBeUndefined();
  });

  it('reset returns to the exact idle snapshot', () => {
    const started = afterOutgoingStarted();
    expect(reduceCallSnapshot(started, { type: 'reset' })).toEqual(IDLE_CALL_SNAPSHOT);
  });

  it('CALL_ACTIVE_STATES matches exactly the non-terminal, non-idle states', () => {
    expect(CALL_ACTIVE_STATES).toEqual(['ringing_out', 'ringing_in', 'connected']);
  });
});
