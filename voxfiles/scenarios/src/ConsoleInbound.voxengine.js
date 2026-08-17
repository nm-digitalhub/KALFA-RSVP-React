// ConsoleInbound — inbound PSTN calls to KALFA's console number (97237219347).
// Bound to the existing "incoming" rule (ruleId 1494687, pattern
// "97237219347") — see rules.config.PROPOSED.json for the binding itself; that
// flip is gate E (go-live), a SEPARATE owner approval from this file's authoring.
//
// The scenario NEVER decides admission itself — POST /api/voximplant/console/
// route-inbound (the server gate: flag, caps, rate-limit, balance) does. This
// file only enforces "no answer without an accept": on any refusal or an
// unreachable gate, the call is REJECTED before Call.answer() is ever called —
// zero cost, zero autocharge exposure, fail-closed by construction.
//
// accept:true → answer → disclosure (recording already running under it) →
// SERIAL ring through server-ordered console agents (20s each) → first
// Connected wins → bridge caller↔agent. Ring exhausted → an honest Hebrew line,
// never a dead line pretending to search forever.
//
// Plan: /var/www/vhosts/kalfa.me/.claude/plans/shimmering-snuggling-neumann.md
// ("הכרעות עיצוב", "שלב 5"; consult/conference below = "שלב 2", accelerated
// ahead of the plan's own deferral per this build's explicit brief).
// DISCLOSURE_LINE_INBOUND_HE and NO_AGENT_LINE_HE are the regulation
// reviewer's / owner's authorized wordings verbatim (12.8) — do not
// paraphrase.
//
// Symbols verified against typings/voxengine.d.ts (cdn.voximplant.com copy) and
// docs/voximplant/digest-voxengine-ref.md:
//   AppEvents.Started (e.sessionId ~1315) / AppEvents.CallAlerting
//   (_CallAlertingEvent: call/callerid/destination ~1342) / AppEvents.HttpRequest
//   (e.content ~1255) / AppEvents.Terminating (one HTTP request allowed ~1193);
//   Call.answer()/reject(code)/hangup()/say(text,params)/record(params)
//   (~3597/3624/3590/3664/3672) — reject(code) (NOT the deprecated decline()) is
//   the documented decline-before-answer API, confirmed against BOTH the
//   typings signature and the guides-solutions.md forwarding-service precedent
//   ("webservice non-200 ⇒ call.reject(603)"); CallEvents.Connected/
//   Disconnected/Failed/PlaybackFinished/RecordStarted
//   (~2540/2568/2586/2617/2657); VoxEngine.callUser(CallUserParameters)/
//   sendMediaBetween(u1,u2)/getSecretValue(name)/terminate()
//   (~13092/13391/13359/13419); Net.httpRequestAsync(url,options) (~8496);
//   VoiceList.Google.he_IL_Wavenet_A (same voice as RSVP.voxengine.js).
//
// CallUserParameters also inherits `displayName?: string` from
// BaseCallParameters (typings ~2329, "Name of the caller that is displayed to
// the user. Normally it is a human-readable version of CallerID, e.g. a
// person's name") — used by ringIdentity() to put the caller's name in front of
// the ringing agent. The typings say nothing about non-ASCII in that field, so
// a Hebrew name there is INFERRED-safe, not measured; ringNext's Failed handler
// carries the one-shot fallback that keeps that inference from being able to
// break the ring. Settle it on the live-call matrix.
//
// UNVERIFIED / cross-cutting finding (NOT fixed here — out of this file's
// scope, same finding as ConsoleDial.voxengine.js): the typings declare
// VoxEngine.callUser with ONLY the object form, `callUser(parameters:
// CallUserParameters)`, requiring `username` + `callerid` — that is what this
// file uses for every ring attempt and transfer. The shipped PRODUCTION
// RSVPAgent.voxengine.js (:633) calls it with two positional strings instead,
// on a code path that has never run on a live call. See ConsoleDial.voxengine.js
// for the full note — flagging once per file so neither ships without it.
//
// Conference module — required for the stage-2 conference_add command
// (VoxEngine.createConference/destroyConference). Same reasoning as
// ConsoleDial.voxengine.js's identical require: RSVPAgent.voxengine.js:81
// already requires it unconditionally for its own supervisor mixer.
require(Modules.Conference);
// PushService — makes the platform send an incoming-call push to a registered
// device whenever this scenario calls VoxEngine.callUser. Live docs
// (guides.sdk.android-push, fetched 14.8): "Call push notifications are sent
// automatically. Call the callUser method in the VoxEngine scenario and a push
// notification is automatically sent to the app." No call site changes.
//
// Load-bearing here specifically: route-inbound-retry's second audience now
// includes agents who are on shift but NOT heartbeat-fresh (beta 8af24ab) —
// i.e. sleeping apps. Ringing them is the ONLY way a push gets sent, and this
// require is the only thing that makes that ring produce one.
//
// Inert until a Firebase service-account JSON is uploaded to the Voximplant
// control panel (Applications -> kalfa-rsvp -> Push Certificates -> GOOGLE).
// Until then callUser to a sleeping agent simply fails fast with SIP 480, as
// it does today.
require(Modules.PushService);
VoxEngine.addEventListener(AppEvents.Started, function (startedEvent) {
    // ---- Constants ---------------------------------------------------------
    // Same reasoning as ConsoleDial.voxengine.js: a CallAlerting-triggered
    // session has no per-call customData channel for this, so it is a scenario
    // constant. Matches THIS deployment's APP_ORIGIN (.env.local).
    var KALFA_APP_ORIGIN = 'https://beta.kalfa.me';
    // Disclosure + no-agent wording — regulation-reviewer / owner authorized
    // (12.8), verbatim, no slash-forms. "מנסים לחבר" not "מעבירים לנציג" is
    // DELIBERATE (plan honest-UI principle: never claim a connection that has
    // not happened yet).
    var DISCLOSURE_LINE_INBOUND_HE = 'הגעתם לקלפה. לתשומת ליבכם, השיחה מוקלטת לצורך תיעוד ושיפור השירות. כעת מנסים לחבר את השיחה.';
    var NO_AGENT_LINE_HE = 'אין נציג זמין כרגע. נחזור אליכם בהקדם.';
    // Wake-and-answer research (12.8) — NOT owner/regulation-authorized
    // wording like the two lines above (this is an operational hold line,
    // not a disclosure). Originally written only for the wake-retry wave;
    // NOW ALSO played once per serial-ring attempt in ringNext (found in a
    // full telephony audit, 13.8: ringNext did nothing at all to callerCall
    // while dialing an agent, leaving an ANSWERED, RECORDING, BILLING call in
    // raw silence for up to RING_PER_AGENT_MS per agent tried — 100s on a
    // 5-deep ring — which a caller reasonably reads as a dead line, not
    // "please wait". Reused verbatim rather than inventing new
    // compliance-sensitive wording — this exact string was already live in
    // production for the retry wave). See route-inbound-retry/route.ts's
    // header for why the RETRY wave specifically still degrades to
    // byte-identical NO_AGENT_LINE_HE behaviour when app_settings.console_wake_enabled
    // is off — that flag has no bearing on this line's use in the PRIMARY
    // ring, which is unconditional.
    var RING_HOLD_LINE_HE = 'אנא המתינו רגע, מחפשים עבורכם נציג.';
    // Hold cue for AFTER an agent is already connected (17.8; music-file
    // swap 17.8) — deliberately a DIFFERENT line from RING_HOLD_LINE_HE
    // above: "מחפשים עבורכם נציג" ("looking for an agent for you") is false
    // once one is already on the call. Same category as RING_HOLD_LINE_HE —
    // an OPERATIONAL hold line, NOT owner/regulation-authorized wording like
    // DISCLOSURE_LINE_INBOUND_HE. Driven by CallEvents.OnHold (the agent's
    // SDK "השהיה" button, src/lib/voximplant/web-client.ts's toggleHold) AND
    // by an active consult (startConsult's own stopMediaBetween) — see
    // startHoldAudio()/remoteNeedsHold() below.
    //
    // PRIMARY mechanism is now HOLD_MUSIC_URL below, a looped audio file
    // (owner-supplied, 17.8 — supersedes the earlier "NO hold-music asset
    // exists in this scenario" finding recorded elsewhere in this file's
    // history, e.g. startConsult()'s own header). HOLD_LINE_HE is kept as
    // the FALLBACK spoken cue for when the file player fails (see
    // startHoldAudioSayFallback()) — the same production-proven
    // mechanism/voice this scenario already used everywhere else (including
    // RING_HOLD_LINE_HE, which is unaffected — playback mechanism only, this
    // task does not extend to the ringing-wait line), now a safety net
    // instead of the primary path.
    var HOLD_LINE_HE = 'השיחה מוחזקת לרגע, אנא המתינו על הקו.';
    // The owner-supplied hold-music clip — same file, same cache-versioning
    // rule, same reasoning as ConsoleDial.voxengine.js's identical constant.
    var HOLD_MUSIC_URL = KALFA_APP_ORIGIN + '/audio/hold-music-v1.mp3';
    var ttsOptions = { voice: VoiceList.Google.he_IL_Wavenet_A };
    // Per-agent serial-ring ceiling — plan-decided constant for V1 (§ שלב 5).
    var RING_PER_AGENT_MS = 20000;
    // Wake-and-answer retry wave's per-agent ceiling — deliberately SHORTER
    // than RING_PER_AGENT_MS: this is a second, bounded chance for an agent
    // who connected AFTER the original ring_order was computed (see
    // route-inbound-retry/route.ts's header for the frozen-ring-order root
    // cause), not a full second serial ring — a caller who has already
    // waited through the whole original ring should not wait a second full
    // cycle on top of it.
    var RING_RETRY_WINDOW_MS = 15000;
    // Blind-transfer watchdog — same constant and reasoning as ConsoleDial.
    var TRANSFER_TIMEOUT_MS = 20000;
    // SIP codes on CallEvents.Failed that mean the call attempt was ANSWERED on
    // its merits — by the platform or by the callee — rather than refused as a
    // bad request. Verbatim from the Failed event's own typings table
    // (voxengine.d.ts ~2574): 402 insufficient funds, 404 invalid number,
    // 408 no answer within 60s, 480 destination unavailable, 486 busy,
    // 487 request terminated, 603 rejected. Used by ringNext's displayName
    // self-heal to tell "this agent is asleep" (480, the common case) from
    // "the platform would not accept this INVITE" — see there for why
    // conflating the two would switch the feature off on most calls.
    var RING_ROUTINE_FAILURE_CODES = [402, 404, 408, 480, 486, 487, 603];
    // Hold-cue cadence for the SAY FALLBACK ONLY — same reasoning and same
    // backoff shape as ConsoleDial.voxengine.js's identical constants (see
    // that file's comment for the full "why keep backoff here but not on
    // the primary path" reasoning). The PRIMARY path (HOLD_MUSIC_URL, looped
    // via loop:true) has no per-repeat cost and needs no backoff — this
    // constant pair stopped applying to it the moment the music file became
    // primary (17.8). Kept, unchanged, for startHoldAudioSayFallback: a
    // scenario-side setTimeout loop (Call.say has no loop option).
    // HOLD_REPEAT_MS is the STARTING interval; the fallback doubles it on
    // every repeat, capped at HOLD_REPEAT_MAX_MS — bounds a 10-minute
    // FALLBACK (e.g. a sustained CDN/deploy outage keeping HOLD_MUSIC_URL
    // unreachable for the whole hold) to 7 TTS calls instead of 31 at a flat
    // 20s cadence, without ever reverting to permanent silence. Independently
    // tunable from RING_PER_AGENT_MS above — same value today by
    // coincidence, not because the two concepts couple.
    var HOLD_REPEAT_MS = 20000;
    var HOLD_REPEAT_MAX_MS = 120000;
    // Leaked-session backstop, NOT a call-length cap — see ConsoleDial.voxengine.js
    // for the full reasoning (not reusing RSVPAgent's 30-min HANDOFF_MAX_MS;
    // these are ordinary agent-operated calls).
    var SAFETY_NET_MS = 60 * 60 * 1000;
    var HANGUP_GRACE_MS = 500;
    // Net.httpRequestAsync's own default is 90s total / 6s TCP connect,
    // "value can be only decreased" (typings HttpRequestOptions.timeout,
    // seconds). route-inbound gates BEFORE Call.answer() (no cost exposure),
    // but a hung/mid-deploy backend still leaves the caller hearing carrier
    // ringback for up to 90s before a fail-closed reject — and
    // route-inbound-retry's own gating call happens on an ALREADY-ANSWERED,
    // recording leg after the ring exhausts, where a hang is real dead air.
    // Applied to every gating Net.httpRequestAsync call in this file (found
    // in a full telephony audit, 13.8).
    var GATE_HTTP_TIMEOUT_S = 10;
    var CONSOLE_SECRET = VoxEngine.getSecretValue('KALFA_CONSOLE_SECRET');
    if (!CONSOLE_SECRET) {
        // Unlike ConsoleDial's internal branch, EVERY inbound call needs the
        // route-inbound gate — there is no ungated path here. A missing
        // secret must fail closed for the WHOLE call, logged once.
        Logger.write('[ConsoleInbound] KALFA_CONSOLE_SECRET missing — every call will be rejected fail-closed');
    }
    var state = {
        sessionId: (startedEvent && startedEvent.sessionId) || 0,
        // Same reasoning as ConsoleDial.voxengine.js: _StartedEvent carries these
        // on EVERY session, including this CallAlerting-triggered one (typings/
        // voxengine.d.ts:1291-1299) — the only way the backend ever learns a
        // command URL for an inbound console call (there is no StartScenarios
        // call in this flow, so no media_session_access_url).
        accessUrl: (startedEvent && startedEvent.accessURL) || null,
        accessSecureUrl: (startedEvent && startedEvent.accessSecureURL) || null,
        // The console_calls row route-inbound created FOR THIS CALL, echoed
        // in its accept response (stage-7 addition). Sent on every /event
        // report so the server can resolve THIS session's row EXACTLY —
        // inbound has no other correlating id (no vox_session_id, no dial
        // token) — instead of the ambiguous FIFO fallback tier.
        callId: null,
        cli: '', // inbound CallerID — NEVER logged raw (PII). Since 17.8 it is
        // ALSO the `callerid` passed on every agent ring, so the agent whose
        // phone is ringing sees who is calling (see ringIdentity()).
        called: '', // the dialed DID (97237219347) — not PII, safe to log/reuse
        callerDisplay: '', // route-inbound's `caller_display`: the guest's name
        // when we recognise the number, their E.164 otherwise, '' when the CLI
        // was withheld/unparsable. Copied into callUser's `displayName` — PII,
        // same handling rule as `cli`: never logged, never sent in a
        // reportEvent extra.
        operator: null, // the currently-bridged AGENT leg — replaceable via transfer
        agentUsername: '', // vox_username of whoever is currently connected
        remote: null, // the CALLER leg — anchor, never replaced, recorded
        recordingUrl: null,
        connectedAt: 0,
        transferring: false,
        transferTimer: null,
        releasingOperator: null,
        operatorHangupScheduled: false,
        remoteHangupScheduled: false,
        endedReported: false,
        terminated: false,
        globalTimer: null,
        // ── Stage 2 (consult-before-transfer) ────────────────────────────
        consultTarget: null, // the Call object of the agent being consulted
        consultTargetUsername: '', // stashed for consult_completed's report —
        // completeConsult()/cancelConsult() run from a LATER command-channel
        // invocation than startConsult(), so its own `voxUsername` param is
        // out of scope by then.
        consulting: false, // true while dialing the consult target
        consultActive: false, // true once privately bridged with the operator
        consultTimer: null,
        // ── Stage 2 (3-way conference) ───────────────────────────────────
        conf: null, // the mixer — created only once the conference target connects
        conferenceTarget: null, // the Call object of the 3rd participant
        conferenceTargetUsername: '', // same reasoning as consultTargetUsername
        conferencing: false, // true while dialing the conference target
        conferenced: false, // true once the 3-way mixer is live
        conferenceTimer: null,
        // ── Wake-and-answer research (12.8) ───────────────────────────────
        wakeRetryDone: false, // true once attemptWakeRetry has fired ONCE for
        // this call — guards against a second retry wave's own exhaustion
        // recursing back into attemptWakeRetry.
        // ── Hold audio (17.8; music-file swap 17.8) ──────────────────────
        sdkOnHold: false, // true while CallEvents.OnHold is active on the
        // CURRENT operator leg. Reset on every operator handoff
        // (completeTransfer/completeConsult) — a stale leg's hold state
        // never carries over to the fresh one.
        holdPlayer: null, // the looped HOLD_MUSIC_URL Player instance while
        // it is playing; null whenever it is not (see
        // startHoldAudio/stopHoldAudio). PRIMARY hold mechanism.
        holdAudioTimer: null // the repeating say() timer driving HOLD_LINE_HE
        // — FALLBACK ONLY now, used while holdPlayer failed/is unavailable
        // and remoteNeedsHold() is true; null whenever it is not running
        // (see startHoldAudioSayFallback/stopHoldAudio).
    };
    function log(msg) {
        Logger.write('[ConsoleInbound] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_e) {
            return String(value);
        }
    }
    function cleanupAndTerminate() {
        if (state.terminated)
            return;
        state.terminated = true;
        if (state.globalTimer) {
            clearTimeout(state.globalTimer);
            state.globalTimer = null;
        }
        if (state.transferTimer) {
            clearTimeout(state.transferTimer);
            state.transferTimer = null;
        }
        VoxEngine.terminate();
    }
    // Best-effort lifecycle report — NEVER blocks or throws into the call
    // path. Secret travels in the POST body (never a query string, never
    // logged). Deliberately NOT called per ring attempt (only once at ring
    // start) — Net.httpRequestAsync has a per-session request quota (digest:
    // internal code 0 = quota exceeded) and a 5-deep ring order plus
    // started/ringing/connected/ended would otherwise burn it fast; the final
    // connected/no_agent report already carries which agent (or none) won.
    function reportEvent(kind, extra) {
        if (!CONSOLE_SECRET)
            return;
        var body = {
            secret: CONSOLE_SECRET,
            session_id: state.sessionId,
            call_kind: 'inbound',
            called: state.called,
            call_id: state.callId,
            event: kind
        };
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k))
                    body[k] = extra[k];
            }
        }
        Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: GATE_HTTP_TIMEOUT_S,
            postData: safeStringify(body)
        }).then(function (r) {
            log('event ' + kind + ' -> ' + (r && r.code));
        }).catch(function (err) {
            log('event ' + kind + ' failed: ' + err);
        });
    }
    // Exactly ONE 'ended' report per session (idempotent).
    function reportEndedOnce(reason) {
        if (state.endedReported)
            return;
        state.endedReported = true;
        var duration = state.connectedAt ? Math.round((Date.now() - state.connectedAt) / 1000) : 0;
        reportEvent('ended', {
            reason: reason,
            duration_s: duration,
            recording_url: state.recordingUrl || null
        });
    }
    function scheduleOperatorHangup(delayMs) {
        if (state.operatorHangupScheduled || !state.operator)
            return;
        state.operatorHangupScheduled = true;
        var call = state.operator;
        setTimeout(function () {
            try {
                call.hangup();
            }
            catch (err) {
                log('operator hangup() failed: ' + err);
            }
        }, delayMs);
    }
    function scheduleRemoteHangup(delayMs) {
        if (state.remoteHangupScheduled || !state.remote)
            return;
        state.remoteHangupScheduled = true;
        var call = state.remote;
        setTimeout(function () {
            try {
                call.hangup();
            }
            catch (err) {
                log('remote hangup() failed: ' + err);
            }
        }, delayMs);
    }
    // Either leg going down brings the whole call down — hang up the other
    // one (idempotent) and finalize once BOTH are gone.
    function handleLegDown(which, reasonForEnd) {
        if (which === 'operator')
            state.operator = null;
        else
            state.remote = null;
        // Either leg going down ends any point in a pending hold-audio
        // timer — state.remote's own identity check inside it would catch
        // this within HOLD_REPEAT_MS anyway, but there is no reason to leave
        // it dangling for that long.
        stopHoldAudio();
        // Same reasoning as ConsoleDial.voxengine.js's identical block: a
        // consult in flight (dialing OR privately bridged) has no meaning
        // once operator or remote is gone — hang up the orphaned consult leg
        // explicitly rather than rely on VoxEngine.terminate()'s eventual
        // session-wide cleanup once both named legs are down.
        if (state.consulting || state.consultActive) {
            var consultTarget = state.consultTarget;
            state.consultTarget = null;
            state.consultTargetUsername = '';
            state.consulting = false;
            state.consultActive = false;
            if (state.consultTimer) {
                clearTimeout(state.consultTimer);
                state.consultTimer = null;
            }
            try {
                if (consultTarget)
                    consultTarget.hangup();
            }
            catch (err) {
                log('consult target hangup on leg-down failed: ' + err);
            }
        }
        // A leg fundamental to a live 3-way conference just dropped — there
        // is no partial 2-way to preserve (one of operator/remote is now
        // gone), so collapse the mixer and drop the 3rd participant instead
        // of leaving a stale Conference object referencing a dead leg.
        if (state.conf || state.conferenceTarget) {
            if (state.conferenceTarget) {
                var confTarget = state.conferenceTarget;
                state.conferenceTarget = null;
                try {
                    confTarget.hangup();
                }
                catch (err) {
                    log('conference target hangup on leg-down failed: ' + err);
                }
            }
            try {
                if (state.conf)
                    VoxEngine.destroyConference(state.conf);
            }
            catch (err) {
                log('destroyConference on leg-down failed: ' + err);
            }
            state.conf = null;
            state.conferenceTargetUsername = '';
            state.conferencing = false;
            state.conferenced = false;
            reportEvent('conference_ended', { reason: 'leg_down_' + which });
        }
        if (state.operator)
            scheduleOperatorHangup(HANGUP_GRACE_MS);
        if (state.remote)
            scheduleRemoteHangup(HANGUP_GRACE_MS);
        if (!state.operator && !state.remote) {
            reportEndedOnce(reasonForEnd);
            cleanupAndTerminate();
        }
    }
    // ── Hold audio ───────────────────────────────────────────────────────
    // The caller leg (state.remote) goes silent for two INDEPENDENT reasons:
    // the agent's own SDK "השהיה" button (CallEvents.OnHold below), and an
    // active consult (startConsult's own stopMediaBetween). Both now hear
    // HOLD_MUSIC_URL, looped (17.8 — supersedes this section's earlier "NO
    // hold-music asset exists in this scenario" finding, now that the owner
    // has supplied one). remoteNeedsHold() is the single source of truth
    // both triggers check, so neither one can prematurely resume the live
    // bridge while the OTHER reason is still active (e.g. the agent toggles
    // SDK hold mid-consult).
    function remoteNeedsHold() {
        return state.sdkOnHold || state.consulting || state.consultActive;
    }
    // Owner-supplied looped audio file (17.8) is now PRIMARY — see
    // ConsoleDial.voxengine.js's identical function for the full reasoning
    // (loop:true native repeat, cold-cache cost accepted/documented,
    // say()-fallback triggered by PlayerEvents.Error specifically — NOT
    // every PlaybackFinished, since loop:true's per-iteration firing
    // behaviour is undocumented — and the enumerated stopHoldAudio() call
    // sites that each re-bridge or terminate immediately after).
    // Self-terminates (both paths) the instant remoteNeedsHold() goes false
    // OR state.remote has moved on to a different leg
    // (transfer/consult-complete/conference/hangup).
    function startHoldAudio() {
        if (state.holdPlayer || state.holdAudioTimer || !state.remote)
            return; // already playing (music or say fallback), or nothing to play it to
        var remote = state.remote;
        var player;
        try {
            player = VoxEngine.createURLPlayer({ url: HOLD_MUSIC_URL }, { loop: true });
        }
        catch (err) {
            log('hold-music createURLPlayer failed: ' + err);
            startHoldAudioSayFallback(remote);
            return;
        }
        state.holdPlayer = player;
        function onPlayerError(ev) {
            if (state.holdPlayer !== player)
                return; // stopHoldAudio() already nulled this reference
            // before calling player.stop() — an intentional stop, not a
            // failure; nothing to fall back to.
            state.holdPlayer = null;
            log('hold-music player error: ' + (ev && ev.error));
            if (state.remote === remote && remoteNeedsHold()) {
                startHoldAudioSayFallback(remote);
            }
        }
        function onPlaybackFinished(ev) {
            if (state.holdPlayer !== player)
                return; // our own intentional stop — expected
            if (ev && ev.error) {
                // Finished WITH an error — the same failure PlayerEvents.Error
                // is documented to cover; belt-and-braces in case the two
                // events ever fire in a different order for one failure.
                onPlayerError(ev);
                return;
            }
            // No error, and we did not stop it ourselves — diagnostic only,
            // NOT a fallback trigger (see the comment above startHoldAudio()
            // for why: an undocumented per-loop-iteration firing would
            // otherwise cut the say() fallback in across still-looping
            // music every ~31s). A log line here on an active hold is the
            // tell to check first if callers report the music cutting out.
            log('hold-music PlaybackFinished without error while still playing — investigate cadence (~31s would indicate per-loop firing)');
        }
        player.addEventListener(PlayerEvents.Error, onPlayerError);
        player.addEventListener(PlayerEvents.PlaybackFinished, onPlaybackFinished);
        try {
            player.sendMediaTo(remote);
        }
        catch (err) {
            log('hold-music sendMediaTo failed: ' + err);
            state.holdPlayer = null;
            try {
                player.stop();
            }
            catch (_stopErr) {
                // already gone — nothing further to clean up
            }
            startHoldAudioSayFallback(remote);
        }
    }
    // FALLBACK ONLY (see startHoldAudio() above) — the original say()-based
    // hold cue this scenario shipped with, kept verbatim as the safety net
    // for a broken/unreachable HOLD_MUSIC_URL. HOLD_REPEAT_MS/MAX's own
    // comment covers why the backoff still belongs here even though the
    // primary path no longer needs one.
    function startHoldAudioSayFallback(remote) {
        if (state.holdAudioTimer)
            return; // already running
        // Resets to HOLD_REPEAT_MS every time a NEW fallback period starts —
        // a caller who was unheld and gets re-held hears the frequent
        // cadence again from the top, not wherever a previous backoff left
        // off.
        var delay = HOLD_REPEAT_MS;
        function tick() {
            if (state.remote !== remote || !remoteNeedsHold() || state.holdPlayer) {
                // state.holdPlayer set: a fresh startHoldAudio() call (hold
                // toggled off/on, or a later trigger) got a working player
                // since this fallback started — defer to it.
                state.holdAudioTimer = null;
                return;
            }
            try {
                remote.say(HOLD_LINE_HE, ttsOptions);
            }
            catch (err) {
                log('hold-audio fallback say failed: ' + err);
            }
            state.holdAudioTimer = setTimeout(tick, delay);
            delay = Math.min(delay * 2, HOLD_REPEAT_MAX_MS);
        }
        tick();
    }
    function stopHoldAudio() {
        if (state.holdPlayer) {
            var player = state.holdPlayer;
            state.holdPlayer = null; // clear FIRST — see onPlayerDone()'s
            // guard in startHoldAudio(): this makes the PlaybackFinished
            // that stop() itself triggers recognizable as our own
            // intentional stop, not a failure needing the say() fallback.
            try {
                player.stop();
            }
            catch (err) {
                log('hold-music player stop failed: ' + err);
            }
        }
        if (state.holdAudioTimer) {
            clearTimeout(state.holdAudioTimer);
            state.holdAudioTimer = null;
        }
    }
    // (Re)binds the terminal listeners for whichever Call is currently
    // playing the "operator" (agent-side) role — called on every successful
    // ring connect and again after a successful transfer.
    function attachOperatorTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            if (state.releasingOperator === call) {
                state.releasingOperator = null;
                log('operator (origin) released after successful transfer');
                return;
            }
            log('operator disconnected: ' + safeStringify(ev));
            handleLegDown('operator', 'operator_hangup');
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('operator failed: ' + safeStringify(ev));
            handleLegDown('operator', 'operator_failed');
        });
        // SDK-initiated hold (verified live docs — guides.calls.features'
        // "How to hold a call" gives ONE shared VoxEngine-side example for
        // Web/iOS/Android SDK hold alike: "play the file when the OnHold
        // event is triggered", platform-agnostic by the vendor's own design;
        // references.voxengine.callevents' OnHold/OffHold entries and the
        // ReInviteReceived cross-reference — "3) put a call on hold / took a
        // call off hold" — describe the same cloud-side signal. The Call
        // object here is whichever leg the SDK put on hold). Every inbound
        // call is customer-facing (unlike ConsoleDial's internal branch), so
        // no kind gate is needed here.
        //
        // Conference guard, and the KNOWN GAP it accepts: once
        // state.conferenced is true, state.remote's incoming stream is the
        // Conference mixer, not this leg directly — playing hold audio here
        // would silently steal the caller's audio out of a live 3-way call
        // (Call.sendMediaTo's docs: "a new incoming stream always replaces
        // the previous one"), so hold is ignored entirely while conferenced.
        // This means an agent who holds mid-conference leaves the caller in
        // silence again — the ORIGINAL bug this task fixes, reappearing in
        // the one topology where fixing it risks a worse outcome (silencing
        // the whole 3-way call for everyone). Accepted deliberately, not
        // missed: silence for one caller in a rare topology beats breaking a
        // live 3-way call for three people.
        call.addEventListener(CallEvents.OnHold, function () {
            if (state.conferenced)
                return;
            state.sdkOnHold = true;
            log('operator SDK hold — starting hold audio for the caller leg');
            startHoldAudio();
        });
        call.addEventListener(CallEvents.OffHold, function () {
            if (!state.sdkOnHold)
                return; // hold was ignored above (conferenced) — nothing to undo
            state.sdkOnHold = false;
            log('operator SDK off-hold');
            restoreCustomerBridge('sdk_hold_released');
        });
    }
    function attachRemoteTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('remote (caller) disconnected: ' + safeStringify(ev));
            handleLegDown('remote', 'caller_hangup');
        });
    }
    // ── Blind transfer between agents (V1: scenario-side, no consult) ───────
    function completeTransfer(target, requestId) {
        var origin = state.operator;
        state.operator = target;
        // The ORIGIN's hold state (if any) does not carry over to a fresh
        // target leg, and any pending hold-audio timer must not land a stray
        // utterance on the just-established post-transfer conversation.
        state.sdkOnHold = false;
        stopHoldAudio();
        attachOperatorTerminalHandlers(target);
        try {
            // Recording lives on state.remote (the caller leg), untouched by
            // this rewire — it continues across the transfer (decided).
            VoxEngine.sendMediaBetween(state.remote, target);
        }
        catch (err) {
            log('transfer rebridge failed: ' + err);
        }
        state.releasingOperator = origin;
        try {
            if (origin)
                origin.hangup();
        }
        catch (err) {
            log('origin release hangup failed: ' + err);
            state.releasingOperator = null;
        }
        state.transferring = false;
        reportEvent('transferred', { request_id: requestId });
        log('transfer [' + requestId + '] complete');
    }
    function failTransfer(target, requestId, why) {
        if (!state.transferring)
            return;
        state.transferring = false;
        if (state.transferTimer) {
            clearTimeout(state.transferTimer);
            state.transferTimer = null;
        }
        try {
            if (target)
                target.hangup();
        }
        catch (err) {
            log('abandoned transfer target hangup failed: ' + err);
        }
        // The caller↔origin bridge was never touched during the attempt —
        // nothing to restore.
        reportEvent('transfer_failed', { request_id: requestId, reason: why });
        log('transfer [' + requestId + '] failed: ' + why);
    }
    // True while ANY live-topology change (blind transfer, consult,
    // conference) is in flight — see ConsoleDial.voxengine.js's identical
    // guard for the full rationale (single canonical guard preventing the
    // command handlers below from racing each other into a corrupted
    // bridge).
    function specialOpBusy() {
        return state.transferring || state.consulting || state.consultActive ||
            state.conferencing || state.conferenced;
    }
    function startTransfer(voxUsername, requestId) {
        if (!voxUsername) {
            log('transfer [' + requestId + '] ignored — missing vox_username');
            return;
        }
        if (specialOpBusy()) {
            log('transfer [' + requestId + '] ignored — another live-call operation is in progress');
            return;
        }
        if (!state.remote || !state.operator) {
            log('transfer [' + requestId + '] ignored — no live call to transfer');
            return;
        }
        state.transferring = true;
        // Keeps the DID as callerid — see ringIdentity()'s own note for why the
        // caller-identity change (17.8) deliberately stops at the primary ring
        // and does not reach the three internal agent-to-agent legs.
        var target = VoxEngine.callUser({
            username: voxUsername,
            callerid: state.called || 'kalfa-console'
        });
        reportEvent('transfer_started', { request_id: requestId, target: voxUsername });
        var timer = setTimeout(function () {
            failTransfer(target, requestId, 'timeout');
        }, TRANSFER_TIMEOUT_MS);
        state.transferTimer = timer;
        target.addEventListener(CallEvents.Connected, function () {
            if (!state.transferring) {
                try {
                    target.hangup();
                }
                catch (err) {
                    log('orphaned transfer target hangup failed: ' + err);
                }
                return;
            }
            if (state.transferTimer) {
                clearTimeout(state.transferTimer);
                state.transferTimer = null;
            }
            completeTransfer(target, requestId);
        });
        target.addEventListener(CallEvents.Failed, function (ev) {
            failTransfer(target, requestId, 'sip_' + ((ev && ev.code) || 0));
        });
    }
    // ── Consult-before-transfer (stage 2, V1: single consult target) ────────
    // Puts the caller on hold (HOLD_MUSIC_URL, looped — see
    // startHoldAudio(); supersedes this section's earlier "no asset" finding)
    // and privately bridges operator<->target so the caller hears NEITHER
    // side of the consultation. Two ways out: consult_cancel restores the
    // caller bridge; consult_complete is the actual warm transfer (drops the
    // operator, bridges caller<->target). Recording (Call.record() on
    // state.remote, armed once at connect time in proceedInbound) is
    // UNAFFECTED by any of this: it keeps recording whatever state.remote
    // currently receives (hold music during the hold window) — the
    // operator<->target conversation never touches state.remote and is
    // therefore NEVER recorded. Deliberate: the caller's disclosure said
    // THEIR call is recorded, not that internal staff consultations are.
    function restoreCustomerBridge(why) {
        // The OTHER trigger for hold (SDK hold vs. consult) may still be
        // active — e.g. the agent toggled SDK hold mid-consult, and this
        // call is consult ending first. Defer the restore; the remaining
        // trigger's own resolution (OffHold, or this same function called
        // again once it clears) is what actually resumes the live bridge.
        if (remoteNeedsHold()) {
            log('bridge restore (' + why + ') deferred — still on hold (sdkOnHold=' + state.sdkOnHold + ')');
            return;
        }
        stopHoldAudio();
        if (state.operator && state.remote) {
            try {
                VoxEngine.sendMediaBetween(state.operator, state.remote);
            }
            catch (err) {
                log('consult restore bridge failed: ' + err);
            }
        }
        log('consult ' + why + ' — restored operator<->caller bridge');
    }
    function failConsult(target, requestId, why) {
        if (!state.consulting)
            return; // already resolved (Connected raced the timeout/Failed)
        state.consulting = false;
        if (state.consultTimer) {
            clearTimeout(state.consultTimer);
            state.consultTimer = null;
        }
        try {
            if (target)
                target.hangup();
        }
        catch (err) {
            log('abandoned consult target hangup failed: ' + err);
        }
        state.consultTarget = null;
        state.consultTargetUsername = '';
        restoreCustomerBridge('dial failed');
        reportEvent('consult_failed', { request_id: requestId, reason: why });
        log('consult [' + requestId + '] failed: ' + why);
    }
    function startConsult(voxUsername, requestId) {
        if (!voxUsername) {
            log('consult_start [' + requestId + '] ignored — missing vox_username');
            return;
        }
        if (specialOpBusy()) {
            log('consult_start [' + requestId + '] ignored — another live-call operation is in progress');
            return;
        }
        if (!state.remote || !state.operator) {
            log('consult_start [' + requestId + '] ignored — no live call to consult on');
            return;
        }
        state.consulting = true;
        state.consultTargetUsername = voxUsername;
        // Hold FIRST (per the task's own ordering): the caller must never
        // hear the target ring or any part of the consultation.
        try {
            VoxEngine.stopMediaBetween(state.operator, state.remote);
        }
        catch (err) {
            log('consult hold (stopMediaBetween) failed: ' + err);
        }
        startHoldAudio();
        var target = VoxEngine.callUser({
            username: voxUsername,
            callerid: state.called || 'kalfa-console'
        });
        state.consultTarget = target;
        reportEvent('consult_started', { request_id: requestId, target: voxUsername });
        var timer = setTimeout(function () {
            failConsult(target, requestId, 'timeout');
        }, TRANSFER_TIMEOUT_MS);
        state.consultTimer = timer;
        target.addEventListener(CallEvents.Connected, function () {
            if (!state.consulting) {
                // Already given up (timeout/cancel raced Connected) — a late
                // Connected must not leak an orphaned live call.
                try {
                    target.hangup();
                }
                catch (err) {
                    log('orphaned consult target hangup failed: ' + err);
                }
                return;
            }
            if (state.consultTimer) {
                clearTimeout(state.consultTimer);
                state.consultTimer = null;
            }
            state.consulting = false;
            state.consultActive = true;
            try {
                // PRIVATE bridge — the caller (state.remote) is not part of
                // this and stays on hold (silent) throughout.
                VoxEngine.sendMediaBetween(state.operator, target);
            }
            catch (err) {
                log('consult bridge failed: ' + err);
            }
            reportEvent('consult_connected', { request_id: requestId });
            log('consult [' + requestId + '] connected');
        });
        target.addEventListener(CallEvents.Failed, function (ev) {
            failConsult(target, requestId, 'sip_' + ((ev && ev.code) || 0));
        });
    }
    function cancelConsult(requestId) {
        if (!state.consulting && !state.consultActive) {
            log('consult_cancel [' + requestId + '] ignored — no consult in progress');
            return;
        }
        var target = state.consultTarget;
        if (state.consultTimer) {
            clearTimeout(state.consultTimer);
            state.consultTimer = null;
        }
        if (state.consultActive && state.operator && target) {
            try {
                VoxEngine.stopMediaBetween(state.operator, target);
            }
            catch (err) {
                log('consult unbridge on cancel failed: ' + err);
            }
        }
        try {
            if (target)
                target.hangup();
        }
        catch (err) {
            log('consult target hangup on cancel failed: ' + err);
        }
        state.consulting = false;
        state.consultActive = false;
        state.consultTarget = null;
        state.consultTargetUsername = '';
        restoreCustomerBridge('cancelled');
        reportEvent('consult_cancelled', { request_id: requestId });
        log('consult [' + requestId + '] cancelled');
    }
    function completeConsult(requestId) {
        if (!state.consultActive || !state.consultTarget || !state.operator || !state.remote) {
            log('consult_complete [' + requestId + '] ignored — no active consult to complete');
            return;
        }
        var target = state.consultTarget;
        var targetUsername = state.consultTargetUsername;
        var origin = state.operator;
        try {
            VoxEngine.stopMediaBetween(origin, target);
        }
        catch (err) {
            log('consult unbridge on complete failed: ' + err);
        }
        // consulting/consultActive clear further below, but a pending
        // hold-audio timer must not land a stray say() on the live
        // post-warm-transfer conversation this bridge is about to start —
        // stop it explicitly rather than wait for its own lazy check.
        stopHoldAudio();
        try {
            // The actual warm transfer: the caller, silent since
            // startConsult's hold, is now bridged to the consult target.
            VoxEngine.sendMediaBetween(state.remote, target);
        }
        catch (err) {
            log('consult complete bridge failed: ' + err);
        }
        state.operator = target; // hand off the "operator" role
        state.agentUsername = targetUsername;
        // The ORIGIN's SDK-hold state (if any) does not carry over to the
        // consult target now playing "operator".
        state.sdkOnHold = false;
        attachOperatorTerminalHandlers(target);
        state.releasingOperator = origin;
        try {
            origin.hangup();
        }
        catch (err) {
            log('consult origin release hangup failed: ' + err);
            state.releasingOperator = null;
        }
        state.consultActive = false;
        state.consultTarget = null;
        state.consultTargetUsername = '';
        reportEvent('consult_completed', { request_id: requestId, target: targetUsername });
        log('consult [' + requestId + '] completed (warm transfer)');
    }
    // ── 3-way conference (stage 2, V1: single additional participant) ───────
    // Unlike consult, the caller is NOT put on hold: the existing
    // operator<->caller bridge stays live through the ring, and only once
    // the target answers does the scenario create the mixer and rewire all
    // three into it (RSVPAgent's attachSupervisor 'takeover' topology,
    // reused verbatim: VoxEngine.createConference + three sendMediaBetween
    // calls). Recording continues on state.remote unaffected — a Conference
    // is just another media unit state.remote is bridged INTO, same as a
    // direct Call.
    function teardownConference(why) {
        if (state.conferenceTarget) {
            var t = state.conferenceTarget;
            state.conferenceTarget = null;
            try {
                t.hangup();
            }
            catch (err) {
                log('conference target hangup on teardown failed: ' + err);
            }
        }
        try {
            if (state.conf)
                VoxEngine.destroyConference(state.conf);
        }
        catch (err) {
            log('destroyConference failed: ' + err);
        }
        state.conf = null;
        state.conferenceTargetUsername = '';
        state.conferencing = false;
        state.conferenced = false;
        // The direct operator<->caller bridge below is only correct if
        // NEITHER hold trigger is still active (state.conferenced is now
        // false, so remoteNeedsHold() reflects SDK-hold/consult accurately
        // again) — e.g. the agent never took SDK hold off for the whole
        // conference. Resuming hold audio instead of a silent direct bridge
        // in that case is the same fix this task made everywhere else.
        if (remoteNeedsHold()) {
            startHoldAudio();
        }
        else if (state.operator && state.remote) {
            try {
                VoxEngine.sendMediaBetween(state.operator, state.remote);
            }
            catch (err) {
                log('conference restore direct bridge failed: ' + err);
            }
        }
        reportEvent('conference_ended', { reason: why });
        log('conference ended: ' + why);
    }
    function failConference(target, requestId, why) {
        if (!state.conferencing)
            return; // already resolved
        state.conferencing = false;
        if (state.conferenceTimer) {
            clearTimeout(state.conferenceTimer);
            state.conferenceTimer = null;
        }
        try {
            if (target)
                target.hangup();
        }
        catch (err) {
            log('abandoned conference target hangup failed: ' + err);
        }
        state.conferenceTarget = null;
        state.conferenceTargetUsername = '';
        // The operator<->caller bridge was never touched during the dialing
        // phase — nothing to restore (same reasoning as failTransfer's
        // identical comment).
        reportEvent('conference_failed', { request_id: requestId, reason: why });
        log('conference [' + requestId + '] failed: ' + why);
    }
    function startConference(voxUsername, requestId) {
        if (!voxUsername) {
            log('conference_add [' + requestId + '] ignored — missing vox_username');
            return;
        }
        if (specialOpBusy()) {
            log('conference_add [' + requestId + '] ignored — another live-call operation is in progress');
            return;
        }
        if (!state.remote || !state.operator) {
            log('conference_add [' + requestId + '] ignored — no live call to add to');
            return;
        }
        state.conferencing = true;
        state.conferenceTargetUsername = voxUsername;
        var target = VoxEngine.callUser({
            username: voxUsername,
            callerid: state.called || 'kalfa-console'
        });
        state.conferenceTarget = target;
        reportEvent('conference_started', { request_id: requestId, target: voxUsername });
        var timer = setTimeout(function () {
            failConference(target, requestId, 'timeout');
        }, TRANSFER_TIMEOUT_MS);
        state.conferenceTimer = timer;
        target.addEventListener(CallEvents.Connected, function () {
            if (!state.conferencing) {
                try {
                    target.hangup();
                }
                catch (err) {
                    log('orphaned conference target hangup failed: ' + err);
                }
                return;
            }
            if (state.conferenceTimer) {
                clearTimeout(state.conferenceTimer);
                state.conferenceTimer = null;
            }
            state.conferencing = false;
            state.conferenced = true;
            // From this point state.remote's incoming stream becomes the
            // Conference mixer (below), not a direct feed from state.operator
            // — a hold-audio say() landing on it now (a pending timer from
            // SDK hold or a consult that happened to be active right up to
            // this moment) would silently steal the caller's audio out of the
            // live 3-way call. Stop it unconditionally; the OnHold handler's
            // own conferenced guard prevents a NEW one from starting for as
            // long as the mixer is live.
            stopHoldAudio();
            // Mixer (needs no video-conference rule flag, unlike Conference.add
            // — RSVPAgent's own precedent). hd_audio explicit: the parameter
            // is the interface's only field and HD audio bills extra — false
            // = the free 8kHz default, stated on purpose.
            state.conf = VoxEngine.createConference({ hd_audio: false });
            try {
                VoxEngine.sendMediaBetween(state.operator, state.conf);
                VoxEngine.sendMediaBetween(state.remote, state.conf);
                VoxEngine.sendMediaBetween(target, state.conf);
            }
            catch (err) {
                log('conference bridge failed: ' + err);
            }
            // (Re)bind THIS leg's terminal handlers to the conference-aware
            // teardown — a plain hangup mid-conference must collapse back to
            // a direct bridge, never leave a 2-party mixer running.
            target.addEventListener(CallEvents.Disconnected, function (ev) {
                log('conference target disconnected: ' + safeStringify(ev));
                teardownConference('target_left');
            });
            reportEvent('conference_joined', { request_id: requestId, target: voxUsername });
            log('conference [' + requestId + '] joined — 3-way live');
        });
        target.addEventListener(CallEvents.Failed, function (ev) {
            failConference(target, requestId, 'sip_' + ((ev && ev.code) || 0));
        });
    }
    // ── Live-call command channel (RSVPAgent :701 pattern) ───────────────────
    VoxEngine.addEventListener(AppEvents.HttpRequest, function (e) {
        var env;
        try {
            env = JSON.parse((e && e.content) || '{}');
        }
        catch (_parseErr) {
            log('command: unparseable body');
            return;
        }
        var cmd = env && env.command;
        var rid = (env && env.request_id) || '(none)';
        if (state.terminated) {
            log('command ' + cmd + ' [' + rid + '] ignored — session terminated');
            return;
        }
        try {
            if (cmd === 'call_end') {
                reportEndedOnce('call_end');
                if (state.operator)
                    scheduleOperatorHangup(HANGUP_GRACE_MS);
                if (state.remote)
                    scheduleRemoteHangup(HANGUP_GRACE_MS);
            }
            else if (cmd === 'transfer') {
                var payload = env && env.payload;
                startTransfer(payload && payload.vox_username, rid);
            }
            else if (cmd === 'consult_start') {
                var consultPayload = env && env.payload;
                startConsult(consultPayload && consultPayload.vox_username, rid);
            }
            else if (cmd === 'consult_cancel') {
                cancelConsult(rid);
            }
            else if (cmd === 'consult_complete') {
                completeConsult(rid);
            }
            else if (cmd === 'conference_add') {
                var conferencePayload = env && env.payload;
                startConference(conferencePayload && conferencePayload.vox_username, rid);
            }
            else {
                log('command unknown: ' + cmd + ' [' + rid + ']');
                return;
            }
            log('command ' + cmd + ' [' + rid + '] applied');
        }
        catch (err) {
            log('command ' + cmd + ' [' + rid + '] failed: ' + err);
        }
    });
    // Last-resort report — mirrors RSVPAgent's Terminating handler; a no-op on
    // a healthy call (reportEndedOnce is idempotent).
    VoxEngine.addEventListener(AppEvents.Terminating, function () {
        if (state.endedReported)
            return;
        log('Terminating with no ended report sent — posting last-resort close');
        reportEndedOnce('session_terminating');
    });
    // Global safety net — see ConsoleDial.voxengine.js for the full reasoning
    // (leaked-session backstop, not a call-length cap).
    state.globalTimer = setTimeout(function () {
        log('safety-net timeout reached — closing');
        reportEndedOnce('safety_net_timeout');
        if (state.operator)
            scheduleOperatorHangup(0);
        if (state.remote)
            scheduleRemoteHangup(0);
        setTimeout(function () {
            cleanupAndTerminate();
        }, 3000);
    }, SAFETY_NET_MS);
    // ── Serial ring through server-ordered agents ────────────────────────────
    function declareNoAgent(callerCall) {
        log('ring exhausted — no agent found');
        reportEndedOnce('no_agent');
        try {
            callerCall.say(NO_AGENT_LINE_HE, ttsOptions);
        }
        catch (err) {
            log('say failed: ' + err);
        }
        callerCall.addEventListener(CallEvents.PlaybackFinished, function () {
            scheduleRemoteHangup(0);
        });
        setTimeout(function () {
            scheduleRemoteHangup(0);
        }, 6000);
    }
    // Wake-and-answer late-ring-arrival retry (research 12.8) — ONE retry
    // only per call (state.wakeRetryDone), never per ring attempt: this
    // scenario's own Net.httpRequestAsync budget is already spent on
    // started/ringing/connected-or-ended, and the platform's per-session
    // HTTP-request quota (digest-voxengine-ref.md: "0 = חריגה ממכסת בקשות
    // HTTP פר-session") is close enough to that baseline that an unbounded
    // retry-per-attempt would risk losing the 'ended' report — which is what
    // makes the no-agent callback promise (NO_AGENT_LINE_HE) true. No
    // separate reportEvent('ringing', ...) is sent for the retry wave on
    // purpose (route-inbound-retry/route.ts's own server-side audit already
    // records the found count) — this function is the ONE added request in
    // the worst case, not two.
    // [suppressName] is threaded through, not defaulted: if the primary ring
    // already proved the displayName unusable (see ringNext's Failed handler),
    // the retry wave must not put it straight back on the wire.
    function attemptWakeRetry(callerCall, triedSoFar, suppressName) {
        if (state.wakeRetryDone) {
            declareNoAgent(callerCall);
            return;
        }
        state.wakeRetryDone = true;
        try {
            callerCall.say(RING_HOLD_LINE_HE, ttsOptions);
        }
        catch (err) {
            log('wake-retry hold line failed: ' + err);
        }
        Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/route-inbound-retry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: GATE_HTTP_TIMEOUT_S,
            postData: safeStringify({ secret: CONSOLE_SECRET, call_id: state.callId, already_tried: triedSoFar })
        }).then(function (r) {
            var body = null;
            try {
                body = JSON.parse(r.text || '{}');
            }
            catch (_e) { }
            var newRing = (body && Array.isArray(body.ring_order)) ? body.ring_order : [];
            if (newRing.length === 0) {
                declareNoAgent(callerCall);
                return;
            }
            log('wake retry found ' + newRing.length + ' newly-routable agent(s)');
            ringNext(callerCall, newRing, 0, RING_RETRY_WINDOW_MS, suppressName);
        }).catch(function (err) {
            log('wake retry request failed: ' + err);
            declareNoAgent(callerCall);
        });
    }
    // Who the ringing agent sees. Builds the identity half of
    // CallUserParameters for a ring attempt.
    //
    // `callerid` is the CALLER'S OWN NUMBER, echoed back byte-for-byte from
    // AppEvents.CallAlerting's e.callerid. Verbatim on purpose: it is a shape
    // the platform itself produced and therefore provably accepts, which
    // sidesteps the one documented constraint on this field ("Usage of
    // whitespaces is not allowed" — CallUserParameters.callerid) without this
    // scenario having to guess at a normalization. It also satisfies the
    // field's stated intent, "normally a phone number that can be used for
    // callback". The DID stays the fallback for a withheld/absent CLI, where
    // there is no caller number to show.
    //
    // `displayName` is route-inbound's `caller_display` — the guest's name when
    // the number is recognised, their E.164 otherwise. [suppressName] drops it;
    // see ringNext's Failed handler for the one case that sets it.
    //
    // NOT applied to startTransfer/startConsult/startConference, which keep the
    // DID: those are internal agent-to-agent legs, none of them has any app UI
    // yet (the transfer/consult/conference buttons do not exist), and for a
    // consult the target speaks to the AGENT first, not the caller — so
    // labelling that leg with the caller's number would be actively wrong.
    // Deferred deliberately, to be decided when those buttons are built.
    function ringIdentity(suppressName) {
        var params = { callerid: state.cli || state.called || 'kalfa-console' };
        if (!suppressName) {
            // No CLI at all: say so, rather than leave the agent looking at our
            // own DID with no explanation — that reads exactly like the bug
            // this change fixes.
            params.displayName = state.callerDisplay || (state.cli ? state.cli : 'מספר חסוי');
        }
        return params;
    }
    function ringNext(callerCall, ringOrder, idx, ringWindowMs, suppressName) {
        var windowMs = ringWindowMs || RING_PER_AGENT_MS;
        if (idx >= ringOrder.length) {
            attemptWakeRetry(callerCall, ringOrder, suppressName);
            return;
        }
        // Caller-facing hold cue, once per agent attempted — see
        // RING_HOLD_LINE_HE's own comment for the silence this closes. A
        // fresh say() replaces whatever is already playing on this leg
        // (typings Call.say: "a new incoming stream always replaces the
        // previous one"), so this is safe to call on every attempt without
        // stacking/queuing, and self-resolves the instant an agent connects
        // (sendMediaBetween below replaces it in turn).
        try {
            callerCall.say(RING_HOLD_LINE_HE, ttsOptions);
        }
        catch (err) {
            log('ring hold line failed: ' + err);
        }
        var username = ringOrder[idx];
        var settled = false;
        // The ring used to pass our OWN DID as the callerid, reasoning that
        // route-inbound's display_hint was "the intended channel for showing
        // caller identity to the agent" so the caller's number never needed to
        // ride an internal callUser leg. Two things were wrong with that. The
        // app never read display_hint, so the agent's phone showed OUR number
        // on every incoming call and nothing else — the owner's report, 17.8.
        // And the second half of the reasoning, an explicitly UNVERIFIED worry
        // about whether the "real rented number" CallerID rule applies to an
        // intra-app callUser, was resolvable and has been resolved: the live
        // reference (references.voxengine.calluserparameters, 17.8) restricts
        // only TEST numbers rented from Voximplant — a real caller's own number
        // is precisely what the field is for.
        //
        // ACCEPTED CONSEQUENCE, not an oversight: the CLI and the display name
        // now travel in SIP signalling, so they appear in the platform's own
        // session logs however carefully this file's log() calls avoid them.
        // That is inseparable from showing an agent who is calling.
        var ringParams = ringIdentity(suppressName);
        ringParams.username = username;
        var sentName = typeof ringParams.displayName === 'string';
        var agentCall = VoxEngine.callUser(ringParams);
        var timer = setTimeout(function () {
            if (settled)
                return;
            settled = true;
            try {
                agentCall.hangup();
            }
            catch (err) {
                log('ring timeout hangup failed: ' + err);
            }
            ringNext(callerCall, ringOrder, idx + 1, windowMs, suppressName);
        }, windowMs);
        agentCall.addEventListener(CallEvents.Connected, function () {
            if (settled) {
                try {
                    agentCall.hangup();
                }
                catch (err) {
                    log('late ring-connect hangup failed: ' + err);
                }
                return;
            }
            settled = true;
            clearTimeout(timer);
            state.operator = agentCall;
            state.agentUsername = username;
            attachOperatorTerminalHandlers(agentCall);
            state.connectedAt = Date.now();
            try {
                VoxEngine.sendMediaBetween(callerCall, agentCall);
            }
            catch (err) {
                log('inbound bridge failed: ' + err);
            }
            log('inbound call connected to an agent');
            reportEvent('connected', { agent: username });
        });
        agentCall.addEventListener(CallEvents.Failed, function (ev) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            log('ring attempt failed for ' + username + ': ' + safeStringify(ev));
            // Self-heal for the ONE thing about this ring that is inferred
            // rather than measured. displayName carries a Hebrew guest name
            // into SIP signalling; the typings document the field
            // (BaseCallParameters.displayName) but say nothing about non-ASCII,
            // and the failure mode if the platform rejects the INVITE is not
            // cosmetic — it is EVERY ring failing, i.e. inbound console dead.
            // So the first agent's failure re-rings that SAME agent once with
            // the name dropped, and the flag then rides the rest of the
            // recursion: a bad displayName costs one extra internal leg and
            // degrades the whole call to number-only instead of taking it down.
            //
            // GATED ON THE SIP CODE, and that gate is the whole correctness of
            // this branch. Without it the retry fires on the single most common
            // outcome there is — this file's own PushService note records that
            // "callUser to a sleeping agent simply fails fast with SIP 480" —
            // so any call whose first agent is merely asleep would ring them
            // twice and then drop the name for the WHOLE call. The feature
            // would be off on most calls, and a live test would read as
            // "Hebrew displayName is broken" when nothing was wrong with it.
            //
            // The routine codes are the ones CallEvents.Failed's own typings
            // table enumerates: 402 insufficient funds, 404 invalid number,
            // 408 no answer, 480 unavailable, 486 busy, 487 terminated,
            // 603 rejected. Every one of those is the platform or the callee
            // answering the call attempt on its merits — none of them can mean
            // "this INVITE was malformed", so none of them justifies a retry.
            // Anything else (including a missing code, which cannot be ruled
            // out) does, because that is where a rejected request would land.
            //
            // Delete this branch (and `suppressName`) once a live call has
            // shown a Hebrew name arriving intact on the device.
            var failCode = (ev && ev.code) || 0;
            var routineFailure = RING_ROUTINE_FAILURE_CODES.indexOf(failCode) !== -1;
            if (!suppressName && sentName && idx === 0 && !routineFailure) {
                log('first ring failed with sip_' + failCode + ' while a displayName was set — retrying the same agent without it');
                ringNext(callerCall, ringOrder, idx, windowMs, true);
                return;
            }
            ringNext(callerCall, ringOrder, idx + 1, windowMs, suppressName);
        });
    }
    function proceedInbound(callerCall, ringOrder) {
        state.remote = callerCall;
        attachRemoteTerminalHandlers(callerCall);
        callerCall.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = (ev && ev.url) || null;
            log('RECORDING_URL captured');
        });
        reportEvent('started', { access_url: state.accessUrl, access_secure_url: state.accessSecureUrl });
        callerCall.addEventListener(CallEvents.Connected, function () {
            log('caller leg connected');
            // Recording FIRST — the disclosure itself must be on tape.
            try {
                callerCall.record({ stereo: true });
            }
            catch (err) {
                log('caller record() failed: ' + err);
            }
            try {
                callerCall.say(DISCLOSURE_LINE_INBOUND_HE, ttsOptions);
            }
            catch (err) {
                log('disclosure say() failed: ' + err);
            }
            // ONE-SHOT — and here it protects a LIVE path, which is why it
            // was added (13.8). addEventListener does not replace a previous
            // handler; the vendor documents multi-handler fan-out for the
            // same API on the Web SDK ("One event can have more than one
            // handler; handlers are executed in order of their
            // registration", @voximplant/websdk/index.d.ts:1722-1724), while
            // the VoxEngine typings state neither way — so for THIS runtime
            // it is INFERRED, and guarded rather than argued. Without the
            // guard: declareNoAgent() registers a SECOND PlaybackFinished
            // listener on this same leg, so NO_AGENT_LINE_HE finishing would
            // re-enter this handler and restart the ENTIRE serial ring from
            // index 0 — placing a second wave of real calls to every agent
            // on a call we already told the caller we could not connect. It
            // races declareNoAgent's own immediate hangup, so it may not
            // reproduce every time, which is precisely what makes it worth a
            // boolean instead of a wait-and-see. Settle it in the live-call
            // matrix.
            var ringStarted = false;
            callerCall.addEventListener(CallEvents.PlaybackFinished, function () {
                if (ringStarted) return;
                ringStarted = true;
                reportEvent('ringing', { ring_order_len: ringOrder.length });
                ringNext(callerCall, ringOrder, 0);
            });
        });
        try {
            callerCall.answer();
        }
        catch (err) {
            log('caller answer() failed: ' + err);
            cleanupAndTerminate();
        }
    }
    // ── Entry point — gate BEFORE answer ─────────────────────────────────────
    VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
        var callerCall = e.call;
        var cli = e.callerid || '';
        var called = e.destination || '';
        state.cli = cli;
        state.called = called;
        function rejectFailClosed(why) {
            log('rejecting fail-closed: ' + why);
            try {
                callerCall.reject(603);
            }
            catch (err) {
                log('reject failed: ' + err);
            }
            cleanupAndTerminate();
        }
        if (!CONSOLE_SECRET) {
            rejectFailClosed('secret_missing');
            return;
        }
        Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/route-inbound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: GATE_HTTP_TIMEOUT_S,
            postData: safeStringify({ secret: CONSOLE_SECRET, cli: cli, called: called })
        }).then(function (r) {
            var body = null;
            try {
                body = JSON.parse(r.text || '{}');
            }
            catch (_e) { }
            var accept = r.code === 200 && !!body && body.accept === true && Array.isArray(body.ring_order);
            if (!accept) {
                rejectFailClosed('gate_refused_code_' + (r && r.code));
                return;
            }
            // Stash the exact console_calls row id BEFORE any reportEvent()
            // fires — proceedInbound's very first report is 'started', which
            // must already carry it.
            state.callId = (body && body.call_id) || null;
            // The agent-facing label for this caller (see ringIdentity()).
            // Coerced to a string here rather than trusted: a non-string
            // displayName would reach CallUserParameters on every ring.
            state.callerDisplay = (body && typeof body.caller_display === 'string') ? body.caller_display : '';
            proceedInbound(callerCall, body.ring_order);
        }).catch(function (err) {
            log('route-inbound request failed: ' + err);
            rejectFailClosed('gate_unreachable');
        });
    });
});
