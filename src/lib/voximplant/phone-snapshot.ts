/**
 * Pure phone-connection-state reducer for the browser softphone SDK wrapper
 * (web-client.ts). Isolated on the same principle as call-snapshot.ts: this
 * is the ONE place the honest-UI rule ("never show a state without its own
 * signal") is mechanically enforced for the SDK transport/login axis —
 * web-client.ts only ever feeds this reducer a raw ClientState string (via
 * client.state.watch) or its own bounded reconnect-watchdog firing; nothing
 * here is reachable from application code that "decides" the phone is
 * logged in.
 *
 * Extracted from web-client.ts's former inline onSdkStateChange (12.8) after
 * a production incident: an agent connected, set themselves 'ready', and was
 * found unroutable ~28+ minutes later — agent_status.updated_at was stuck at
 * the moment they connected and never advanced again (verified live against
 * the DB during this audit, not just at the moment first reported), while
 * findRoutableAgents (console-calls.ts) requires it fresher than 90s and the
 * panel's heartbeat effect (softphone-panel.tsx) only re-POSTs while
 * phoneSnap.state === 'logged_in'. A sustained, non-self-healing gap that
 * long rules out "one slow beat" — something stopped the heartbeat entirely.
 *
 * Two candidate mechanisms were found and BOTH are fixed by this change +
 * softphone-panel.tsx's beat() fix, because live DB timestamps alone cannot
 * cleanly distinguish which one actually fired without a client-side console
 * capture (out of scope — no live browser session was available):
 *
 * (1) STATE-MACHINE STALL (this file): the OLD mapping's only exit from
 * 'reconnecting' was an exact ClientState.LOGGED_IN, with no watchdog and no
 * re-attempted login anywhere in the old code. One-time-key logins are
 * single-use by protocol (console-sdk-auth.ts) — it has NOT been observed on
 * this account whether this SDK version silently restores LOGGED_IN via a
 * stored token on reconnect (the docs mention `refreshTokens`/
 * `loginAccessToken`, but this project has never measured that path live).
 * If it does not, a transport reconnect that only reaches ClientState.
 * CONNECTED (transport up, login lost) would pin the business state at
 * 'reconnecting' forever — the panel would keep showing "מתחבר מחדש…"
 * indefinitely (an honesty violation on its own) and the heartbeat would
 * stop with zero visible signal.
 *
 * (2) SILENT POST FAILURE (softphone-panel.tsx): the heartbeat's beat()
 * never checked `res.ok`, so any non-2xx response (an expired session
 * token, a transient 5xx, …) was indistinguishable from success — the
 * interval kept "firing" from the client's perspective while never actually
 * writing agent_status.updated_at, again with zero visible signal.
 *
 * The fix for (1) is a bounded watchdog (armed by web-client.ts on entry
 * into 'reconnecting', cleared on exit): if the SDK has not restored
 * LOGGED_IN within RECONNECT_TIMEOUT_MS, this reducer demotes the snapshot
 * to an honest terminal 'error' state instead of continuing to claim
 * 'reconnecting'. That single-click-recoverable state was already at least
 * as informative to the operator as a pretend "connected" would have been —
 * the same 'error' badge/label the panel already renders, just reached via
 * a new path. A bounded timer is deliberately used instead of reacting the
 * instant ClientState settles at CONNECTED: whether this SDK version ever
 * silently restores LOGGED_IN via a stored refresh token on some accounts is
 * unverified (docs mention `refreshTokens`/`loginAccessToken` but this
 * project has never observed it live), so the watchdog gives that a full,
 * generous window before giving up rather than guessing.
 *
 * FOLLOW-UP FINDING (team-lead review, same day): the FIRST version of this
 * fix only special-cased sdkState RECONNECTING and DISCONNECTED while
 * business state was logged_in/reconnecting, falling through to "keep
 * logged_in" for everything else — including a bare ClientState.CONNECTED
 * reached DIRECTLY from logged_in, with no RECONNECTING step in between.
 * Nothing in the SDK's ClientState enum or docs guarantees RECONNECTING
 * always precedes CONNECTED on a reconnect, so that fall-through was a real,
 * reachable hole — and a WORSE one than the incident above: the heartbeat
 * kept beating successfully (it depends on nothing but this HTTP endpoint,
 * not the Voximplant transport), agent_status.updated_at stayed fresh, and
 * findRoutableAgents kept ringing an agent whose SDK could not actually
 * receive the call — a caller hearing ringing into a void instead of the
 * honest no-agent line. Fixed by inverting the branch to an ALLOWLIST: only
 * an exact LOGGED_IN keeps/restores logged_in, only DISCONNECTED means
 * given-up, and literally everything else (RECONNECTING, CONNECTED,
 * CONNECTING, LOGGING_IN, DISCONNECTING, or any future ClientState value)
 * falls to 'reconnecting' — which arms the same watchdog above with no
 * changes needed in web-client.ts (it keys purely on `state ===
 * 'reconnecting'`, agnostic to how that was reached). See
 * phone-snapshot.test.ts's "logged_in -> CONNECTED with no RECONNECTING"
 * describe block — it pins this exact shape so a future refactor back
 * toward a denylist cannot silently reintroduce the hole.
 */

/** Business-facing phone states. Honest by construction (save_rsvp 'queued'
 * precedent): `logged_in` is only ever set AFTER loginOneTimeKey resolves,
 * and transport/login regressions reported by the SDK — or this module's own
 * bounded watchdog — downgrade it immediately. */
export type ConsolePhoneState =
  | 'idle'
  | 'connecting'
  | 'logging_in'
  | 'logged_in'
  | 'reconnecting'
  | 'disconnected'
  | 'other_tab'
  | 'error';

export interface ConsolePhoneSnapshot {
  state: ConsolePhoneState;
  /** Hebrew, user-facing; set only for other_tab/error states. */
  detail?: string;
  /** The SDK's raw client state, for the dev/diagnostics surface. */
  sdkState?: string;
  /**
   * Technical failure diagnostic: which login phase failed + the error's
   * name/message (SDK login errors and our own Hebrew fetch errors — no key,
   * hash or password material ever appears in either). Dev surface only.
   */
  diag?: string;
  displayName?: string;
}

/**
 * How long a snapshot may sit at 'reconnecting' before this module stops
 * trusting that the SDK's own autoReconnect is still going to restore
 * LOGGED_IN on its own. Generous relative to AGENT_STATUS_FRESHNESS_MS
 * (90s, console-calls.ts) on purpose: a false demotion just costs one extra
 * manual click, while a demotion so early it fires during a normal brief
 * network blip would be its own honesty violation in the other direction.
 */
export const RECONNECT_TIMEOUT_MS = 45_000;

export type PhoneSnapshotAction =
  | { type: 'sdk_state'; sdkState: string }
  | { type: 'reconnect_timeout' };

/**
 * Pure transition function — maps the SDK's raw ClientState string (or the
 * watchdog's own timeout signal) onto the honest business snapshot, WITHOUT
 * ever promoting to logged_in on its own (only a successful loginOneTimeKey,
 * driven explicitly by connectAndLogin in web-client.ts, does that).
 */
export function reducePhoneSnapshot(
  prev: ConsolePhoneSnapshot,
  action: PhoneSnapshotAction,
): ConsolePhoneSnapshot {
  switch (action.type) {
    case 'sdk_state': {
      const sdkState = action.sdkState;
      if (prev.state === 'logged_in' || prev.state === 'reconnecting') {
        // Allowlist, not a denylist: while business state is logged_in or
        // reconnecting, ONLY an exact LOGGED_IN keeps/restores logged_in and
        // ONLY DISCONNECTED means the SDK gave up entirely. EVERY other
        // ClientState — RECONNECTING, CONNECTED, CONNECTING, LOGGING_IN,
        // DISCONNECTING, or any value this reducer doesn't yet know about —
        // maps to 'reconnecting'. This was a real production hole (found by
        // team-lead review, 12.8): the previous version special-cased only
        // RECONNECTING/DISCONNECTED and fell through to "keep logged_in" for
        // everything else, including CONNECTED — a state the SDK's own
        // ClientState enum documents as distinct from LOGGED_IN. Nothing in
        // the SDK's types or docs guarantees RECONNECTING always precedes
        // CONNECTED on a reconnect, so `logged_in` -sdkState-> `CONNECTED`
        // directly (transport back, login not yet confirmed) previously left
        // the snapshot claiming logged_in — heartbeat kept beating
        // successfully, agent_status.updated_at stayed fresh, and
        // findRoutableAgents kept ringing an agent whose SDK could not
        // actually receive the call. That is WORSE than a merely stale
        // agent: the caller hears ringing into a void instead of the honest
        // "no agent" line. Mapping the fall-through to 'reconnecting'
        // instead arms the existing bounded watchdog (setSnapshot in
        // web-client.ts, keyed purely on state === 'reconnecting', needs no
        // change) — a false positive costs one harmless "מתחבר מחדש…" blip
        // that self-clears the moment a real LOGGED_IN arrives; a false
        // negative (the bug this replaces) costs a silent phantom-available
        // agent for as long as nobody notices.
        if (sdkState === 'LOGGED_IN') {
          return { ...prev, state: 'logged_in', sdkState };
        }
        if (sdkState === 'DISCONNECTED') {
          return { state: 'disconnected', sdkState };
        }
        return { ...prev, state: 'reconnecting', sdkState };
      }
      return { ...prev, sdkState };
    }
    case 'reconnect_timeout': {
      // Re-checked here too (defensively) even though web-client.ts only
      // dispatches this while still 'reconnecting' at fire time — a late
      // timer racing a just-arrived LOGGED_IN/DISCONNECTED must never
      // clobber a snapshot that has already moved on.
      if (prev.state !== 'reconnecting') return prev;
      return {
        state: 'error',
        detail: 'החיבור לטלפוניה אבד — יש להתחבר מחדש',
        diag: 'reconnect-timeout: SDK did not restore LOGGED_IN in time',
        sdkState: prev.sdkState,
      };
    }
    default:
      return prev;
  }
}
