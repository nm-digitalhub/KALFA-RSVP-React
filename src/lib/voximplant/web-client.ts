/**
 * Voximplant Web SDK — browser-side console-phone controller (call-center
 * stages 2 + [call layer]).
 *
 * BROWSER ONLY. This module must never be imported from a Server Component or
 * any server module: the SDK it wraps needs window/WebRTC/microphone. Every
 * entry point guards on `typeof window`, and the SDK itself is loaded with a
 * dynamic `import()` inside the first connect call — importing THIS module is
 * cheap and SSR-safe, the SDK chunk only ever loads in the browser (the same
 * discipline as src/components/consent/cookie-consent.tsx documents).
 *
 * Auth flow (docs/voice-agent/sdk-auth-implementation-plan.md, verified against
 * the installed @voximplant/websdk 5.2.0 typings):
 *   1. client.connect({ node })                    — WebSocket to the cloud
 *   2. client.requestOneTimeKey({ username: FQDN })→ one-time key
 *   3. POST /api/agents/sdk-auth { one_time_key }  → { hash }   (server signs;
 *      the password never reaches the browser — supplied via `fetchHash`)
 *   4. client.loginOneTimeKey({ username: FQDN, hash })
 * The FQDN is `${vox_username}@${VOX_APP_DOMAIN}`; the SERVER hashes with the
 * short name (its concern, not ours — we only ever send the FQDN to the SDK).
 *
 * Module-level singleton: Core.init() is itself a singleton in the SDK, and a
 * second controller would race it. The `initialized` flag also absorbs React
 * StrictMode double-effects and HMR re-imports (cookie-consent precedent).
 *
 * Single-tab lease: two tabs logged in as the same agent would both ring and
 * fight over calls. The Web Locks API holds `kalfa-console-softphone` for the
 * tab's lifetime; a second tab gets `other_tab` instead of a login. (Lock is
 * released automatically when the tab closes — no heartbeat bookkeeping.)
 *
 * ── Call layer ───────────────────────────────────────────────────────────
 * Adds the Call + Stream SDK modules (subpath imports, matching the SDK's
 * own README example verbatim — `@voximplant/websdk/modules/call-manager`
 * and `@voximplant/websdk/modules/stream` are SEPARATE package.json
 * "exports" entries, not re-exported from the root `@voximplant/websdk`):
 *   registerModules([StreamLoader(), CallLoader()])
 * Outgoing: streamModule.createHelper(StreamHelper.DeviceTracker) →
 * enableTracker() → attachCall(call) (captures + sends the mic) → call.start().
 * Incoming: CallManagerEvent.IncomingCall carries only {callId, headers,
 * hasIncomingVideo} — the Call itself is fetched via
 * callManager.getCalls().get(callId).
 *
 * Honest-UI rule (project-wide, restated for this layer): `start()`/
 * `answer()` resolving is NOT "connected" — only CallEvent.Connected is. All
 * state transitions are funneled through the PURE reducer in
 * call-snapshot.ts so this is mechanically enforced (see its test).
 *
 * FINDING for the record (not a bug in this file — a fact about the
 * platform): on ConsoleDial.voxengine.js, BOTH branches answer the operator
 * (browser) leg before the far party is confirmed reachable — the internal
 * branch answers before VoxEngine.callUser(callee) even rings, and the
 * outbound branch answers before the PSTN leg connects and before the
 * disclosure+bridge. CallEvent.Connected therefore only proves the
 * browser↔platform leg is up, never that the other party actually answered.
 * The UI in call-bar.tsx labels this "מחובר למערכת" (not "מחובר") for that
 * reason — do not "fix" that wording without re-reading this comment.
 */

import type { Client, Core } from '@voximplant/websdk';
import type {
  Call,
  CallDisconnected,
  CallFailed,
  CallManagerIncomingCall,
  CallRemoteMediaAdded,
  CallRemoteMediaRemoved,
} from '@voximplant/websdk/modules/call-manager';
import type { AudioRenderer, DeviceTrackerHelper } from '@voximplant/websdk/modules/stream';

import {
  CALL_ACTIVE_STATES,
  IDLE_CALL_SNAPSHOT,
  reduceCallSnapshot,
  type CallSnapshotAction,
  type ConsoleCallSnapshot,
} from './call-snapshot';
import {
  RECONNECT_TIMEOUT_MS,
  reducePhoneSnapshot,
  type ConsolePhoneSnapshot,
} from './phone-snapshot';

export type { ConsoleCallSnapshot, ConsoleCallState } from './call-snapshot';
export { CALL_ACTIVE_STATES } from './call-snapshot';
export type { ConsolePhoneSnapshot, ConsolePhoneState } from './phone-snapshot';

/** The single Voximplant application console agents belong to (stage-2 scope). */
export const VOX_APP_DOMAIN = 'kalfa-rsvp.kalfarsvp.voximplant.com';

/** Connection nodes the account may belong to (mirrors ConnectionNode 5.2.0). */
export const CONNECTION_NODES = [
  'NODE_1', 'NODE_2', 'NODE_3', 'NODE_4', 'NODE_5', 'NODE_6', 'NODE_7',
  'NODE_8', 'NODE_9', 'NODE_10', 'NODE_11', 'NODE_12', 'NODE_13',
] as const;
export type ConnectionNodeName = (typeof CONNECTION_NODES)[number];

/**
 * The account's node — MEASURED 2026-08-12: a real browser login (one-time-key
 * flow end-to-end) succeeded on NODE_1 and on no other node tried. Empirical
 * fact about account kalfarsvp (10694307), not a guess; re-verify only if the
 * account itself changes.
 */
export const MEASURED_CONNECTION_NODE: ConnectionNodeName = 'NODE_1';

export interface ConnectAndLoginOptions {
  /** Short vox username (`agent_<uuid>`) — from the console_me view. */
  voxUsername: string;
  node: ConnectionNodeName;
  /**
   * Exchanges a one-time key for the login hash — POSTs /api/agents/sdk-auth
   * with the caller's Bearer token. Injected so this module stays free of
   * Supabase/session concerns.
   */
  fetchHash: (oneTimeKey: string) => Promise<string>;
}

type Listener = (snap: ConsolePhoneSnapshot) => void;

let initialized = false;
let core: Core | null = null;
let sdkClient: Client | null = null;
let unwatchSdkState: (() => void) | null = null;
let releaseTabLock: (() => void) | null = null;

let snapshot: ConsolePhoneSnapshot = { state: 'idle' };
const listeners = new Set<Listener>();

// Bounded watchdog for the 'reconnecting' business state — see
// phone-snapshot.ts's header for the incident this fixes. Managed centrally
// here (inside setSnapshot, the ONE function every transition in this module
// passes through) rather than at each call site: that guarantees the timer
// is always in sync with whether the CURRENT snapshot is 'reconnecting',
// regardless of which code path caused the transition (SDK-driven via
// onSdkStateChange, or an explicit connectAndLogin/disconnectPhone action).
let reconnectWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearReconnectWatchdog(): void {
  if (reconnectWatchdog) {
    clearTimeout(reconnectWatchdog);
    reconnectWatchdog = null;
  }
}

function setSnapshot(next: ConsolePhoneSnapshot): void {
  snapshot = next;
  if (next.state === 'reconnecting') {
    if (!reconnectWatchdog) {
      reconnectWatchdog = setTimeout(() => {
        reconnectWatchdog = null;
        // Releases the tab lock BEFORE demoting to 'error' — without this, a
        // subsequent connectAndLogin() (the operator clicking "התחברות"
        // again, the only recovery path from 'error') would find the lease
        // still held by this SAME tab (acquireTabLease's ifAvailable:true
        // does not special-case same-tab re-entry) and misreport
        // 'other_tab', leaving the operator with no way back in short of a
        // full page reload.
        releaseTabLock?.();
        releaseTabLock = null;
        setSnapshot(reducePhoneSnapshot(snapshot, { type: 'reconnect_timeout' }));
      }, RECONNECT_TIMEOUT_MS);
    }
  } else {
    clearReconnectWatchdog();
  }
  for (const l of listeners) l(snapshot);
}

export function getPhoneSnapshot(): ConsolePhoneSnapshot {
  return snapshot;
}

export function subscribePhone(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

/** Null until logged in. */
export function getSdkClient(): Client | null {
  return sdkClient;
}

// ── Call layer state ────────────────────────────────────────────────────

// Runtime namespaces from the dynamically-imported subpath modules — holds
// the actual enum objects (CallEvent, CallManagerEvent, RejectMode,
// StreamHelper, …), which only exist once connectAndLogin has loaded them.
// `import type` above only pulls in the TYPES, erased at compile time.
type CallModuleNs = typeof import('@voximplant/websdk/modules/call-manager');
type StreamModuleNs = typeof import('@voximplant/websdk/modules/stream');
let callModuleNs: CallModuleNs | null = null;
let streamModuleNs: StreamModuleNs | null = null;
let callManagerMod: import('@voximplant/websdk/modules/call-manager').CallManager | null = null;
let streamMod: import('@voximplant/websdk/modules/stream').StreamModule | null = null;

// The single call this controller manages at a time (MVP: no multi-call/
// hold-and-swap — a second incoming call while busy is rejected with
// RejectMode.Busy, see onIncomingCall below).
let activeCall: Call | null = null;
let activeTracker: DeviceTrackerHelper | null = null;
let callWatchers: Array<() => void> = [];
// streamId -> renderer+element. Module-scope (NOT a React ref): this
// controller is a singleton that outlives any component, and an
// HTMLAudioElement not attached to the DOM (or held only by a component-
// local ref that can unmount) is at the mercy of GC/autoplay policy — the
// element is explicitly appended to document.body below and removed on
// cleanup.
const audioRenderers = new Map<string, { renderer: AudioRenderer; element: HTMLAudioElement }>();

let callSnapshot: ConsoleCallSnapshot = IDLE_CALL_SNAPSHOT;
type CallListener = (snap: ConsoleCallSnapshot) => void;
const callListeners = new Set<CallListener>();

function dispatchCall(action: CallSnapshotAction): void {
  callSnapshot = reduceCallSnapshot(callSnapshot, action);
  for (const l of callListeners) l(callSnapshot);
}

export function getCallSnapshot(): ConsoleCallSnapshot {
  return callSnapshot;
}

export function subscribeCall(listener: CallListener): () => void {
  callListeners.add(listener);
  listener(callSnapshot);
  return () => callListeners.delete(listener);
}

function describeSdkError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  return `${e?.name ?? 'Error'}: ${String(e?.message ?? err).slice(0, 200)}`;
}

// Best-effort microphone gate. Per stream.d.ts DevicePermission docstrings,
// Chrome/Safari can THROW NotAllowedError on popup dismissal while the
// watchable permission state itself stays 'prompt' — a throw is refusal
// too, not just a resolved non-'granted' state. Never promotes call state;
// only sets the sibling `micError` field (see call-snapshot.ts).
async function ensureMicrophonePermission(): Promise<boolean> {
  if (!streamMod) return false;
  try {
    const state = await streamMod.hardware.permission.requestAudioPermission();
    if (state === 'granted') return true;
    dispatchCall({ type: 'mic_denied', reason: String(state) });
    return false;
  } catch (err) {
    dispatchCall({ type: 'mic_denied', reason: (err as { name?: string })?.name ?? 'denied' });
    return false;
  }
}

// Stops and detaches every per-call resource. Safe to call multiple times.
function cleanupCall(): void {
  for (const off of callWatchers) {
    try {
      off();
    } catch {
      // best-effort
    }
  }
  callWatchers = [];
  for (const [, entry] of audioRenderers) {
    try {
      entry.renderer.clear();
    } catch {
      // best-effort
    }
    try {
      entry.element.remove();
    } catch {
      // best-effort
    }
  }
  audioRenderers.clear();
  if (activeTracker) {
    const tracker = activeTracker;
    activeTracker = null;
    // "Stops all streams managed by the device tracker helper and releases
    // all resources" (stream.d.ts) — documented, unlike whether attachCall
    // cleanly detaches a PREVIOUS call, which is why a fresh
    // DeviceTrackerHelper is created per call instead of reusing one.
    void tracker.clear().catch(() => {
      // best-effort
    });
  }
  activeCall = null;
}

function setCallFailure(callId: string, diag: string): void {
  dispatchCall({ type: 'sdk_failed', callId, diag, now: Date.now() });
  cleanupCall();
}

// Self-initiated terminal actions (hangup/reject) are always safe to reflect
// without waiting for an SDK event: unlike "connected" (external truth about
// the far party), "I just hung up/rejected" is deterministically true the
// instant we call it. CallDisconnectReason.LocalEnded PROVES the SDK fires
// CallEvent.Disconnected for a self-initiated hangup() (its own listener in
// attachCallListeners handles that transition — no manual dispatch needed).
// reject() has no equivalent documented event contract for the REJECTING
// side, so a bounded fallback resets locally if no event arrives — the same
// defensive-watchdog shape as ConsoleDial.voxengine.js's own
// PlaybackFinished watchdog (op cit., "watchdog in case PlaybackFinished
// never fires").
function scheduleLocalTerminationFallback(call: Call, ms: number): void {
  setTimeout(() => {
    if (activeCall === call) {
      cleanupCall();
      dispatchCall({ type: 'reset' });
    }
  }, ms);
}

function onRemoteMediaAdded(ev: CallRemoteMediaAdded): void {
  // StreamType isn't exported from the call-manager module (only from the
  // stream module) — comparing the string value avoids naming a symbol this
  // file cannot import from call-manager.d.ts.
  if (String(ev.payload.type) !== 'audio' || !streamMod) return;
  try {
    const renderer = streamMod.rendererManager.createAudioRenderer(ev.payload.stream);
    const element = renderer.getElement();
    element.style.display = 'none';
    document.body.appendChild(element);
    audioRenderers.set(ev.payload.stream.id, { renderer, element });
  } catch (err) {
    console.error('[console-call] audio renderer failed', err);
  }
}

function onRemoteMediaRemoved(ev: CallRemoteMediaRemoved): void {
  const entry = audioRenderers.get(ev.payload.stream.id);
  if (!entry) return;
  try {
    entry.renderer.clear();
  } catch {
    // best-effort
  }
  try {
    entry.element.remove();
  } catch {
    // best-effort
  }
  audioRenderers.delete(ev.payload.stream.id);
}

// (Re)binds the terminal + media + watchable listeners for whichever Call is
// currently active. Called once per call (outgoing at createCall time,
// incoming at CallManagerEvent.IncomingCall time).
function attachCallListeners(call: Call): void {
  activeCall = call;
  const CallEvent = callModuleNs!.CallEvent;

  const onConnected = () =>
    dispatchCall({ type: 'sdk_connected', callId: call.id, now: Date.now() });
  const onDisconnected = (_ev: CallDisconnected) => {
    dispatchCall({ type: 'sdk_disconnected', callId: call.id, now: Date.now() });
    cleanupCall();
  };
  const onFailed = (ev: CallFailed) => {
    dispatchCall({
      type: 'sdk_failed',
      callId: call.id,
      diag: `${ev.payload.code} ${ev.payload.reason}`,
      now: Date.now(),
    });
    cleanupCall();
  };
  // Diagnostics only — NEVER gates UI state. ConsoleDial.voxengine.js never
  // calls Call.ring() on either the internal or outbound branch (it answers
  // straight away), so these may simply never fire on this platform; that
  // is fine, nothing here depends on them.
  const onStartRinging = () => console.debug('[console-call] StartRinging', call.id);
  const onStopRinging = () => console.debug('[console-call] StopRinging', call.id);

  call.addEventListener(CallEvent.Connected, onConnected);
  call.addEventListener(CallEvent.Disconnected, onDisconnected);
  call.addEventListener(CallEvent.Failed, onFailed);
  call.addEventListener(CallEvent.RemoteMediaAdded, onRemoteMediaAdded);
  call.addEventListener(CallEvent.RemoteMediaRemoved, onRemoteMediaRemoved);
  call.addEventListener(CallEvent.StartRinging, onStartRinging);
  call.addEventListener(CallEvent.StopRinging, onStopRinging);

  const unwatchHold = call.isOnHold.watch((value) =>
    dispatchCall({ type: 'hold_changed', callId: call.id, value }),
  );
  const unwatchMute = call.isMicrophoneMuted.watch((value) =>
    dispatchCall({ type: 'mute_changed', callId: call.id, value }),
  );
  const unwatchName = call.remoteDisplayName.watch((value) =>
    dispatchCall({ type: 'remote_display_name', callId: call.id, value }),
  );

  callWatchers.push(
    unwatchHold,
    unwatchMute,
    unwatchName,
    () => call.removeEventListener(CallEvent.Connected, onConnected),
    () => call.removeEventListener(CallEvent.Disconnected, onDisconnected),
    () => call.removeEventListener(CallEvent.Failed, onFailed),
    () => call.removeEventListener(CallEvent.RemoteMediaAdded, onRemoteMediaAdded),
    () => call.removeEventListener(CallEvent.RemoteMediaRemoved, onRemoteMediaRemoved),
    () => call.removeEventListener(CallEvent.StartRinging, onStartRinging),
    () => call.removeEventListener(CallEvent.StopRinging, onStopRinging),
  );
}

// CallManagerEvent.IncomingCall payload carries only {callId, headers,
// hasIncomingVideo} — the Call object itself must be fetched from
// getCalls(). Population order between the event firing and the map being
// populated is not documented; a miss is logged and ignored, never thrown.
function onIncomingCall(ev: CallManagerIncomingCall): void {
  if (!callManagerMod || !callModuleNs) return;
  const call = callManagerMod.getCalls().get(ev.payload.callId);
  if (!call) {
    console.error('[console-call] incoming callId not found in getCalls()', ev.payload.callId);
    return;
  }
  if (CALL_ACTIVE_STATES.includes(callSnapshot.state)) {
    // Already on a call — this is not for us. Reject with Busy and leave
    // the current call's snapshot untouched (it is not this call).
    try {
      call.reject(callModuleNs.RejectMode.Busy);
    } catch {
      // best-effort
    }
    return;
  }
  dispatchCall({
    type: 'incoming_call',
    callId: call.id,
    remoteDisplayName: call.remoteDisplayName.value,
    now: Date.now(),
  });
  attachCallListeners(call);
}

/**
 * Places an outgoing call. `destination` is either `agent_<uuid>`
 * (ConsoleInternal rule) or a `ct<hex>` dial-token from
 * POST /api/console-calls/dial-intent (ConsoleOut rule) — never a raw phone
 * number (the platform resolves that server-side; see dial-intent's route
 * comment).
 *
 * Throws (caught by the caller, e.g. a button's onClick) if the phone isn't
 * logged in or a call is already active — callers should already disable
 * the control in that state; this is the last-resort guard.
 */
export async function startCall(destination: string): Promise<void> {
  if (typeof window === 'undefined') throw new Error('web-client is browser-only');
  if (!callManagerMod || !streamMod || !callModuleNs || !streamModuleNs) {
    throw new Error('הטלפון אינו מחובר');
  }
  if (CALL_ACTIVE_STATES.includes(callSnapshot.state)) {
    throw new Error('קיימת שיחה פעילה כרגע');
  }

  // Mic permission FIRST — "abort before createCall, never after" (a denied
  // mic must never look like a connected call, and must never leave behind
  // a Call object nobody will clean up).
  const micOk = await ensureMicrophonePermission();
  if (!micOk) return;

  const call = callManagerMod.createCall(destination);
  dispatchCall({ type: 'outgoing_started', callId: call.id, destination, now: Date.now() });
  attachCallListeners(call);

  try {
    const tracker = streamMod.createHelper(streamModuleNs.StreamHelper.DeviceTracker);
    activeTracker = tracker;
    tracker.enableTracker();
    await tracker.attachCall(call);
    await call.start();
  } catch (err) {
    setCallFailure(call.id, describeSdkError(err));
    try {
      call.hangup();
    } catch {
      // best-effort
    }
  }
}

/** Answers the pending incoming call. No-op if there is none. */
export async function answerCall(): Promise<void> {
  if (typeof window === 'undefined' || !activeCall || callSnapshot.state !== 'ringing_in') return;
  if (!streamMod || !streamModuleNs) return;
  const call = activeCall;

  const micOk = await ensureMicrophonePermission();
  if (!micOk) return; // ringing_in stays — the agent can still press דחייה.

  try {
    const tracker = streamMod.createHelper(streamModuleNs.StreamHelper.DeviceTracker);
    activeTracker = tracker;
    tracker.enableTracker();
    await tracker.attachCall(call);
    await call.answer();
  } catch (err) {
    setCallFailure(call.id, describeSdkError(err));
    try {
      call.hangup();
    } catch {
      // best-effort
    }
  }
}

/** Rejects the pending incoming call. No-op if there is none. */
export function rejectCall(): void {
  if (!activeCall || callSnapshot.state !== 'ringing_in' || !callModuleNs) return;
  const call = activeCall;
  try {
    call.reject(callModuleNs.RejectMode.Decline);
  } catch {
    // best-effort
  }
  scheduleLocalTerminationFallback(call, 2000);
}

/** Ends the active call. No-op if there is none. */
export function hangupCall(): void {
  if (!activeCall) return;
  const call = activeCall;
  try {
    call.hangup();
  } catch {
    // best-effort
  }
  // No manual dispatch — CallDisconnectReason.LocalEnded proves the SDK
  // fires Disconnected for a self-hangup; attachCallListeners' onDisconnected
  // handles it. Bounded fallback in case a pre-Connected leg behaves
  // differently (same reasoning as rejectCall).
  scheduleLocalTerminationFallback(call, 2000);
}

/** Toggles the microphone. Truth comes from the isMicrophoneMuted watcher. */
export function toggleMute(): void {
  if (!activeCall) return;
  try {
    activeCall.toggleMicrophone();
  } catch (err) {
    console.error('[console-call] toggleMicrophone failed', err);
  }
}

/** Toggles hold. Truth comes from the isOnHold watcher. */
export async function toggleHold(): Promise<void> {
  if (!activeCall || callSnapshot.state !== 'connected') return;
  try {
    await activeCall.hold(!callSnapshot.onHold);
  } catch (err) {
    // CallOnHoldError/CallNotOnHoldError on a lost race — isOnHold's watcher
    // reflects the SDK's real state regardless, nothing to reconcile here.
    console.error('[console-call] hold toggle failed', err);
  }
}

/** Sends one DTMF tone/string within the active call. */
export function sendDtmf(digits: string): void {
  if (!activeCall || !digits) return;
  try {
    activeCall.sendDTMF(digits);
  } catch (err) {
    console.error('[console-call] sendDTMF failed', err);
  }
}

/** Clears a terminal (ended/failed) call banner. No SDK call — the call is already over. */
export function dismissCall(): void {
  if (callSnapshot.state === 'ended' || callSnapshot.state === 'failed') {
    dispatchCall({ type: 'reset' });
  }
}

// Map the SDK's transport state onto our business states WITHOUT ever
// promoting to logged_in (only a successful loginOneTimeKey does that) —
// delegated to the pure, tested reducer in phone-snapshot.ts. See that
// file's header for why 'reconnecting' also needs the bounded watchdog
// setSnapshot arms above: this mapping alone has no way to KNOW the SDK has
// given up, only what it currently reports.
function onSdkStateChange(next: string): void {
  setSnapshot(reducePhoneSnapshot(snapshot, { type: 'sdk_state', sdkState: String(next) }));
}

// Hold the cross-tab lease for the tab's lifetime. Resolves true if acquired.
// Web Locks is best-effort: if the API is missing (very old browser), proceed —
// the lease is a UX guard, not a security boundary (the server rate-limits and
// Voximplant enforces one registration per identity anyway).
async function acquireTabLease(): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return true;
  return new Promise<boolean>((resolve) => {
    void locks.request('kalfa-console-softphone', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return;
      }
      resolve(true);
      // Keep the lock until release() — the promise we return only settles then.
      return new Promise<void>((release) => {
        releaseTabLock = release;
      });
    });
  });
}

/**
 * Connect to the Voximplant cloud and log the agent in. Safe to call again
 * after a failure; a second call while logged in is a no-op.
 */
export async function connectAndLogin(opts: ConnectAndLoginOptions): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('web-client is browser-only');
  }
  if (snapshot.state === 'logged_in' || snapshot.state === 'connecting' || snapshot.state === 'logging_in') {
    return;
  }

  if (!(await acquireTabLease())) {
    setSnapshot({
      state: 'other_tab',
      detail: 'הטלפון פעיל בלשונית אחרת של הדפדפן — יש לסגור אותה קודם',
    });
    return;
  }

  setSnapshot({ state: 'connecting' });
  let phase = 'load-sdk';
  try {
    const websdk = await import('@voximplant/websdk');
    if (!initialized) {
      core = websdk.Core.init();
      sdkClient = core.client;
      // Call + Stream modules — subpath imports (README's own working
      // example, verbatim order: Stream before Call in the array passed to
      // registerModules). Not fatal if this fails: the phone (login/
      // presence) layer must keep working even if the call layer can't
      // load — startCall/answerCall already guard on callManagerMod being
      // set and surface 'הטלפון אינו מחובר' otherwise.
      try {
        const [callMod, streamModNs] = await Promise.all([
          import('@voximplant/websdk/modules/call-manager'),
          import('@voximplant/websdk/modules/stream'),
        ]);
        callModuleNs = callMod;
        streamModuleNs = streamModNs;
        core.registerModules([streamModNs.StreamLoader(), callMod.CallLoader()]);
        callManagerMod = core.getModule(callMod.callToken) ?? null;
        streamMod = core.getModule(streamModNs.streamToken) ?? null;
        if (callManagerMod) {
          callManagerMod.addEventListener(callMod.CallManagerEvent.IncomingCall, onIncomingCall);
        }
      } catch (err) {
        console.error('[console-call] call/stream module registration failed', err);
      }
      initialized = true;
    }
    const client = sdkClient;
    if (!client) throw new Error('SDK client unavailable');
    if (!unwatchSdkState) {
      unwatchSdkState = client.state.watch((next) => onSdkStateChange(String(next)));
    }

    const sdkNow = String(client.state.value);
    if (sdkNow !== 'CONNECTED' && sdkNow !== 'LOGGED_IN') {
      phase = 'connect';
      await client.connect({ node: websdk.ConnectionNode[opts.node] });
    }

    setSnapshot({ state: 'logging_in', sdkState: String(client.state.value) });
    const fqdn = `${opts.voxUsername}@${VOX_APP_DOMAIN}`;
    phase = 'request-key';
    const oneTimeKey = await client.requestOneTimeKey({ username: fqdn });
    phase = 'sign';
    const hash = await opts.fetchHash(oneTimeKey);
    phase = 'login';
    const result = await client.loginOneTimeKey({ username: fqdn, hash });

    setSnapshot({
      state: 'logged_in',
      sdkState: String(client.state.value),
      displayName: result.displayName,
    });
  } catch (err) {
    // Generic Hebrew for the operator; the raw error goes to the console for
    // diagnostics (no key/hash material is ever part of these messages).
    console.error('[console-phone] login failed', err);
    const e = err as { name?: string; message?: string } | null;
    setSnapshot({
      state: 'error',
      detail: 'ההתחברות למערכת הטלפוניה נכשלה — נסו שוב או פנו לתמיכה',
      diag: `${phase} · ${e?.name ?? 'Error'}: ${String(e?.message ?? err).slice(0, 200)}`,
    });
    releaseTabLock?.();
    releaseTabLock = null;
    throw err;
  }
}

/**
 * Disconnect and release the tab lease. Also tears down any active call —
 * without this, logging out mid-call would leave the panel showing a call
 * that no longer has a live transport under it.
 */
export async function disconnectPhone(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (activeCall) {
      try {
        activeCall.hangup();
      } catch {
        // best-effort
      }
    }
    cleanupCall();
    dispatchCall({ type: 'reset' });
    await sdkClient?.disconnect();
  } finally {
    unwatchSdkState?.();
    unwatchSdkState = null;
    releaseTabLock?.();
    releaseTabLock = null;
    setSnapshot({ state: 'disconnected' });
  }
}
