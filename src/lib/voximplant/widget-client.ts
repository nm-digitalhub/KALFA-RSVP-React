/**
 * Voximplant Web SDK — PUBLIC WIDGET controller (capability A, revised
 * 12.8). Deliberately a SEPARATE, smaller module from web-client.ts (the
 * agent softphone controller), not a shared one: an agent identity needs
 * presence, roster, a single-tab lease, incoming-call handling, and hold/
 * mute/transfer; a widget visitor logs in as a SHARED identity, places
 * exactly ONE outbound call per page load, and never receives one. Reusing
 * web-client.ts's singleton for both would mean threading a second,
 * unrelated identity model through code that already documents (in its own
 * header) that it is agent-specific, for no benefit — the two modules DO
 * share the low-level SDK sequence (Core.init, registerModules, connect,
 * one-time-key login, Call events), which this module replicates rather
 * than importing, exactly as faithfully as web-client.ts's own comments
 * document it (see connectAndLogin/startCall there for the reference this
 * was checked against).
 *
 * BROWSER ONLY — same discipline as web-client.ts: every entry point guards
 * on `typeof window`, the SDK loads via dynamic import() inside the first
 * call, and this component tree is mounted behind `dynamic(..., {ssr:false})`.
 *
 * Auth flow — identical protocol to the agent flow, different signing
 * endpoint and identity source (there is no session to read a username
 * from; it's fixed server-side, see widget-sdk-auth.ts):
 *   1. client.connect({ node })
 *   2. client.requestOneTimeKey({ username: FQDN })
 *   3. POST /api/widget/sdk-auth { one_time_key } → { hash, username }
 *   4. client.loginOneTimeKey({ username: FQDN, hash })
 * Call flow — the widget dials a MINTED TOKEN, never a raw destination:
 *   5. POST /api/widget/call-intent → { ok, token, call_id } (the admission
 *      gate — evaluateWidgetCallCaps; see call-intent/route.ts)
 *   6. client.call('wt' + token) — pattern-matched by a Voximplant rule NOT
 *      YET CREATED (ConsoleWidgetIn — see the report for why) — routes to a
 *      scenario that calls widget-authorize/route.ts to verify the token and
 *      ring an agent, exactly like ConsoleDial/ConsoleInbound already do for
 *      their own flows.
 *
 * Honest-UI rule (project-wide, restated): `call()` resolving is NOT
 * "connected" — only CallEvent.Connected is, and even that only proves the
 * browser<->platform leg is up (see web-client.ts's own "FINDING for the
 * record" — the same platform behavior applies here: ConsoleWidgetIn will
 * almost certainly answer the visitor's leg before an agent is confirmed
 * reachable, matching ConsoleDial/ConsoleInbound's existing pattern). The UI
 * built on this snapshot must say "מחובר למוקד" (connected to the platform),
 * never "מדברים עם נציג" (talking to an agent) — that claim needs a REAL
 * signal from the agent side, which this module cannot see and does not
 * fabricate.
 */

export type WidgetPhoneState =
  | 'idle'
  | 'connecting'
  | 'logging_in'
  | 'requesting'
  | 'calling'
  | 'connected'
  | 'ended'
  | 'failed'
  | 'mic_denied'
  | 'refused';

export interface WidgetPhoneSnapshot {
  state: WidgetPhoneState;
  /** Hebrew, user-facing; set for failed/refused/mic_denied. */
  detail?: string;
  /** Diagnostic only — never shown to the visitor. */
  diag?: string;
}

type Listener = (snap: WidgetPhoneSnapshot) => void;

let initialized = false;
let core: import('@voximplant/websdk').Core | null = null;
let sdkClient: import('@voximplant/websdk').Client | null = null;
let unwatchSdkState: (() => void) | null = null;

type CallModuleNs = typeof import('@voximplant/websdk/modules/call-manager');
type StreamModuleNs = typeof import('@voximplant/websdk/modules/stream');
let callModuleNs: CallModuleNs | null = null;
let streamModuleNs: StreamModuleNs | null = null;
let callManagerMod: import('@voximplant/websdk/modules/call-manager').CallManager | null = null;
let streamMod: import('@voximplant/websdk/modules/stream').StreamModule | null = null;

let activeCall: import('@voximplant/websdk/modules/call-manager').Call | null = null;
let activeTracker: import('@voximplant/websdk/modules/stream').DeviceTrackerHelper | null = null;
let callWatchers: Array<() => void> = [];
const audioRenderers = new Map<
  string,
  { renderer: import('@voximplant/websdk/modules/stream').AudioRenderer; element: HTMLAudioElement }
>();

let snapshot: WidgetPhoneSnapshot = { state: 'idle' };
const listeners = new Set<Listener>();

function setSnapshot(next: WidgetPhoneSnapshot): void {
  snapshot = next;
  for (const l of listeners) l(snapshot);
}

export function getWidgetPhoneSnapshot(): WidgetPhoneSnapshot {
  return snapshot;
}

export function subscribeWidgetPhone(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

function describeSdkError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  return `${e?.name ?? 'Error'}: ${String(e?.message ?? err).slice(0, 200)}`;
}

async function ensureMicrophonePermission(): Promise<boolean> {
  if (!streamMod) return false;
  try {
    const state = await streamMod.hardware.permission.requestAudioPermission();
    if (state === 'granted') return true;
    setSnapshot({ state: 'mic_denied', detail: 'לא ניתנה הרשאה למיקרופון' });
    return false;
  } catch {
    setSnapshot({ state: 'mic_denied', detail: 'לא ניתנה הרשאה למיקרופון' });
    return false;
  }
}

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
    void tracker.clear().catch(() => {
      // best-effort
    });
  }
  activeCall = null;
}

function onRemoteMediaAdded(ev: import('@voximplant/websdk/modules/call-manager').CallRemoteMediaAdded): void {
  if (String(ev.payload.type) !== 'audio' || !streamMod) return;
  try {
    const renderer = streamMod.rendererManager.createAudioRenderer(ev.payload.stream);
    const element = renderer.getElement();
    element.style.display = 'none';
    document.body.appendChild(element);
    audioRenderers.set(ev.payload.stream.id, { renderer, element });
  } catch (err) {
    console.error('[widget-call] audio renderer failed', err);
  }
}

function onRemoteMediaRemoved(ev: import('@voximplant/websdk/modules/call-manager').CallRemoteMediaRemoved): void {
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

function attachCallListeners(call: import('@voximplant/websdk/modules/call-manager').Call): void {
  activeCall = call;
  const CallEvent = callModuleNs!.CallEvent;

  const onConnected = () => setSnapshot({ state: 'connected' });
  const onDisconnected = () => {
    setSnapshot({ state: 'ended' });
    cleanupCall();
  };
  const onFailed = (ev: import('@voximplant/websdk/modules/call-manager').CallFailed) => {
    setSnapshot({
      state: 'failed',
      detail: 'השיחה נכשלה — נסו שוב בעוד רגע',
      diag: `${ev.payload.code} ${ev.payload.reason}`,
    });
    cleanupCall();
  };

  call.addEventListener(CallEvent.Connected, onConnected);
  call.addEventListener(CallEvent.Disconnected, onDisconnected);
  call.addEventListener(CallEvent.Failed, onFailed);
  call.addEventListener(CallEvent.RemoteMediaAdded, onRemoteMediaAdded);
  call.addEventListener(CallEvent.RemoteMediaRemoved, onRemoteMediaRemoved);

  callWatchers.push(
    () => call.removeEventListener(CallEvent.Connected, onConnected),
    () => call.removeEventListener(CallEvent.Disconnected, onDisconnected),
    () => call.removeEventListener(CallEvent.Failed, onFailed),
    () => call.removeEventListener(CallEvent.RemoteMediaAdded, onRemoteMediaAdded),
    () => call.removeEventListener(CallEvent.RemoteMediaRemoved, onRemoteMediaRemoved),
  );
}

// Friendly, honest wording per refusal reason — never a technical code, but
// never a false "connecting" either. Mirrors NO_AGENT_LINE_HE's spirit for
// the caps this project already has PSTN-side wording for; the two reasons
// with no PSTN precedent (flag_disabled/live_calls_disabled — ops states, not
// visitor-facing concepts) collapse to the same generic message as balance/
// daily_breaker, since a visitor has no actionable distinction between them.
const REFUSAL_MESSAGE: Record<string, string> = {
  concurrency: 'כל הנציגים תפוסים כרגע — נסו שוב בעוד כמה דקות.',
  per_ip_rate: 'בוצעו יותר מדי ניסיונות שיחה — נסו שוב בעוד שעה.',
  flag_disabled: 'שיחה מהאתר אינה זמינה כרגע.',
  live_calls_disabled: 'שיחה מהאתר אינה זמינה כרגע.',
  balance: 'שיחה מהאתר אינה זמינה כרגע.',
  daily_breaker: 'שיחה מהאתר אינה זמינה כרגע — נסו שוב מחר.',
};
const DEFAULT_REFUSAL_MESSAGE = 'לא ניתן להתחיל שיחה כרגע.';

export interface StartWidgetCallOptions {
  node: import('./web-client').ConnectionNodeName;
  /** POSTs /api/widget/sdk-auth — no Bearer token needed, unlike the agent flow. */
  fetchHash: (oneTimeKey: string) => Promise<{ hash: string }>;
  /** POSTs /api/widget/call-intent. */
  requestCallIntent: () => Promise<
    { ok: true; token: string } | { ok: false; reason?: string }
  >;
}

// Public (non-secret) config, inlined at build time — see
// widget-sdk-auth.ts's header for why the browser must know this BEFORE
// calling requestOneTimeKey (the request and the eventual login must name
// the SAME identity), not learn it from the sdk-auth response afterward.
const WIDGET_VOX_USERNAME = process.env.NEXT_PUBLIC_WIDGET_VOX_USERNAME;

/**
 * The full widget flow: connect (if needed) -> log in as the shared identity
 * -> request admission -> place the call. Safe to call again after a
 * failure; a no-op while already connecting/logging in/calling/connected.
 */
export async function startWidgetCall(opts: StartWidgetCallOptions): Promise<void> {
  if (typeof window === 'undefined') throw new Error('widget-client is browser-only');
  if (
    snapshot.state === 'connecting' ||
    snapshot.state === 'logging_in' ||
    snapshot.state === 'requesting' ||
    snapshot.state === 'calling' ||
    snapshot.state === 'connected'
  ) {
    return;
  }

  if (!WIDGET_VOX_USERNAME) {
    setSnapshot({ state: 'refused', detail: DEFAULT_REFUSAL_MESSAGE });
    return;
  }

  setSnapshot({ state: 'connecting' });
  let phase = 'load-sdk';
  try {
    const websdk = await import('@voximplant/websdk');
    if (!initialized) {
      core = websdk.Core.init();
      sdkClient = core.client;
      const [callMod, streamModNs] = await Promise.all([
        import('@voximplant/websdk/modules/call-manager'),
        import('@voximplant/websdk/modules/stream'),
      ]);
      callModuleNs = callMod;
      streamModuleNs = streamModNs;
      core.registerModules([streamModNs.StreamLoader(), callMod.CallLoader()]);
      callManagerMod = core.getModule(callMod.callToken) ?? null;
      streamMod = core.getModule(streamModNs.streamToken) ?? null;
      initialized = true;
    }
    const client = sdkClient;
    if (!client || !callManagerMod || !streamMod || !callModuleNs || !streamModuleNs) {
      throw new Error('SDK modules unavailable');
    }
    if (!unwatchSdkState) {
      unwatchSdkState = client.state.watch(() => {
        /* no reconnect UX for the widget (single short-lived call, unlike
           the agent softphone which must survive a whole shift) — the call's
           own Disconnected/Failed events are the truth this module tracks. */
      });
    }

    const { VOX_APP_DOMAIN } = await import('./web-client');
    const sdkNow = String(client.state.value);
    if (sdkNow !== 'CONNECTED' && sdkNow !== 'LOGGED_IN') {
      phase = 'connect';
      await client.connect({ node: websdk.ConnectionNode[opts.node] });
    }

    setSnapshot({ state: 'logging_in' });
    // Same short username for BOTH calls — the login protocol requires
    // requesting a key for the identity you actually intend to log in as
    // (verified against web-client.ts's connectAndLogin, which reuses one
    // `fqdn` variable for exactly this reason).
    const fqdn = `${WIDGET_VOX_USERNAME}@${VOX_APP_DOMAIN}`;
    phase = 'request-key';
    const oneTimeKey = await client.requestOneTimeKey({ username: fqdn });
    phase = 'sign';
    const signed = await opts.fetchHash(oneTimeKey);
    phase = 'login';
    await client.loginOneTimeKey({ username: fqdn, hash: signed.hash });

    setSnapshot({ state: 'requesting' });
    phase = 'call-intent';
    const intent = await opts.requestCallIntent();
    if (!intent.ok) {
      setSnapshot({
        state: 'refused',
        detail: REFUSAL_MESSAGE[intent.reason ?? ''] ?? DEFAULT_REFUSAL_MESSAGE,
      });
      return;
    }

    const micOk = await ensureMicrophonePermission();
    if (!micOk) return;

    setSnapshot({ state: 'calling' });
    phase = 'call';
    // The token IS the dialed destination, verbatim — call-intent already
    // minted it 'wt'-prefixed (mintDialToken(callId, 'wt')); the future
    // ConsoleWidgetIn rule matches on that exact prefix.
    const call = callManagerMod.createCall(intent.token);
    attachCallListeners(call);
    const tracker = streamMod.createHelper(streamModuleNs.StreamHelper.DeviceTracker);
    activeTracker = tracker;
    tracker.enableTracker();
    await tracker.attachCall(call);
    await call.start();
  } catch (err) {
    console.error('[widget-call] start failed', err);
    setSnapshot({
      state: 'failed',
      detail: 'לא הצלחנו להתחיל את השיחה — נסו שוב בעוד רגע',
      diag: `${phase} · ${describeSdkError(err)}`,
    });
    if (activeCall) {
      try {
        activeCall.hangup();
      } catch {
        // best-effort
      }
    }
    cleanupCall();
  }
}

/** Ends the active call, if any. Safe to call at any state. */
export function hangupWidgetCall(): void {
  if (!activeCall) {
    if (snapshot.state !== 'idle') setSnapshot({ state: 'idle' });
    return;
  }
  const call = activeCall;
  try {
    call.hangup();
  } catch {
    // best-effort
  }
  setTimeout(() => {
    if (activeCall === call) {
      cleanupCall();
      setSnapshot({ state: 'ended' });
    }
  }, 2000);
}

/** Resets a terminal (ended/failed/refused) snapshot back to idle. */
export function resetWidgetPhone(): void {
  if (
    snapshot.state === 'ended' ||
    snapshot.state === 'failed' ||
    snapshot.state === 'refused' ||
    snapshot.state === 'mic_denied'
  ) {
    setSnapshot({ state: 'idle' });
  }
}
