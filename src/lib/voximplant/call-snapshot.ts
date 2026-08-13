/**
 * Pure call-state reducer for the browser softphone (stage: call layer).
 *
 * Isolated from web-client.ts on purpose: this is the ONE place the
 * honest-UI rule ("never show a state without its signal" —
 * docs/voice-agent, restated by the team lead) is mechanically enforced.
 * web-client.ts only ever feeds this reducer real SDK signals (a
 * CallManagerEvent.IncomingCall payload, a CallEvent.Connected/Failed/
 * Disconnected payload, a Watchable's new value); nothing in here is
 * reachable from application code that "decides" a call is connected.
 * `state === 'connected'` is producible ONLY by the 'sdk_connected' action,
 * which web-client.ts dispatches ONLY from a CallEvent.Connected listener —
 * see call-snapshot.test.ts for the assertion that pins this down.
 */

export type ConsoleCallState =
  | 'idle'
  | 'ringing_out'
  | 'ringing_in'
  | 'connected'
  | 'ended'
  | 'failed';

/** States in which a second call (incoming or outgoing) must be refused. */
export const CALL_ACTIVE_STATES: readonly ConsoleCallState[] = [
  'ringing_out',
  'ringing_in',
  'connected',
];

export interface ConsoleCallSnapshot {
  state: ConsoleCallState;
  callId: string | null;
  direction: 'incoming' | 'outgoing' | null;
  /** Dial destination (outgoing) — agent_<uuid> or ct<hex>. Null for incoming. */
  destination: string | null;
  remoteDisplayName: string | null;
  muted: boolean;
  onHold: boolean;
  startedAt: number | null;
  connectedAt: number | null;
  endedAt: number | null;
  /**
   * Dev-surface diagnostic only (mirrors ConsolePhoneSnapshot.diag) — never
   * render verbatim to the operator. 'failed' gets a fixed Hebrew message in
   * the UI; this is for console.error / a future ops debug surface.
   */
  diag?: string;
  /**
   * Last microphone-permission failure code (e.g. 'denied', 'NotAllowedError').
   * Independent of `state` on purpose: a denied mic must never promote state
   * past idle/ringing, so this is a sibling field, not a state value.
   */
  micError?: string;
}

export const IDLE_CALL_SNAPSHOT: ConsoleCallSnapshot = {
  state: 'idle',
  callId: null,
  direction: null,
  destination: null,
  remoteDisplayName: null,
  muted: false,
  onHold: false,
  startedAt: null,
  connectedAt: null,
  endedAt: null,
};

export type CallSnapshotAction =
  | { type: 'outgoing_started'; callId: string; destination: string; now: number }
  | { type: 'incoming_call'; callId: string; remoteDisplayName: string | null; now: number }
  | { type: 'sdk_connected'; callId: string; now: number }
  | { type: 'sdk_disconnected'; callId: string; now: number }
  | { type: 'sdk_failed'; callId: string; diag: string; now: number }
  | { type: 'remote_display_name'; callId: string; value: string | null }
  | { type: 'mute_changed'; callId: string; value: boolean }
  | { type: 'hold_changed'; callId: string; value: boolean }
  | { type: 'mic_denied'; reason: string }
  | { type: 'reset' };

/**
 * Pure transition function. Actions carrying a `callId` are ignored when it
 * does not match the snapshot's current call — this rejects stale events
 * from a call that has already been superseded (e.g. a late Disconnected
 * arriving after `reset`), without needing any mutable bookkeeping here.
 */
export function reduceCallSnapshot(
  prev: ConsoleCallSnapshot,
  action: CallSnapshotAction,
): ConsoleCallSnapshot {
  switch (action.type) {
    case 'outgoing_started':
      return {
        ...IDLE_CALL_SNAPSHOT,
        state: 'ringing_out',
        callId: action.callId,
        direction: 'outgoing',
        destination: action.destination,
        startedAt: action.now,
      };
    case 'incoming_call':
      return {
        ...IDLE_CALL_SNAPSHOT,
        state: 'ringing_in',
        callId: action.callId,
        direction: 'incoming',
        remoteDisplayName: action.remoteDisplayName,
        startedAt: action.now,
      };
    case 'sdk_connected':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, state: 'connected', connectedAt: action.now };
    case 'sdk_disconnected':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, state: 'ended', endedAt: action.now };
    case 'sdk_failed':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, state: 'failed', endedAt: action.now, diag: action.diag };
    case 'remote_display_name':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, remoteDisplayName: action.value };
    case 'mute_changed':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, muted: action.value };
    case 'hold_changed':
      if (action.callId !== prev.callId) return prev;
      return { ...prev, onHold: action.value };
    case 'mic_denied':
      // Not callId-gated: this can happen BEFORE a call/callId exists (the
      // outgoing path checks mic permission before createCall — "abort
      // before createCall, never after").
      return { ...prev, micError: action.reason };
    case 'reset':
      return IDLE_CALL_SNAPSHOT;
    default:
      return prev;
  }
}
