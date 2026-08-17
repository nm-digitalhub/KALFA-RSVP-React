// ConsoleDial — SDK-originated calls from an operator's browser (KALFA console
// softphone). Bound to TWO rules that both point at this scenario (voxfiles/
// applications/kalfa-rsvp.kalfarsvp.voximplant.com/rules.config.json):
//   * ConsoleInternal (pattern ^agent_.*)     — operator calling another console
//     agent directly, destination = agent_<uuid> (console_agents.vox_username).
//   * ConsoleOut      (pattern ^ct[0-9a-f]+$) — operator calling a customer,
//     destination = a one-time dial-token minted by
//     POST /api/console-calls/dial-intent (plan "יוצאת ידנית").
//
// Internal branch: NO server gate (the Web SDK login on the calling leg IS the
// authorization — requireConsoleAgent/enrollConsoleAgent already gate who can
// log in as an agent_<uuid> user) and NO recording (decided 12.8: legs with no
// customer on the line are never recorded).
//
// Outbound branch: this scenario is NEVER the authority. It resolves the
// dial-token against KALFA's authorize endpoint (consent/DNC/live_calls/caps —
// all server-side, plan "החלטות היקף" gate D) and only then places the PSTN
// call. The guest leg is disclosed + recording-started BEFORE it is bridged to
// the operator, so the disclosure itself is on tape.
//
// Plan: /var/www/vhosts/kalfa.me/.claude/plans/shimmering-snuggling-neumann.md
// ("הכרעות עיצוב", "שלב 4"; consult/conference below = "שלב 2", accelerated
// ahead of the plan's own deferral per this build's explicit brief).
// DISCLOSURE_LINE_HE is the regulation reviewer's authorized wording verbatim
// (12.8) — do not paraphrase.
//
// Symbols verified against typings/voxengine.d.ts (cdn.voximplant.com copy) and
// docs/voximplant/digest-voxengine-ref.md:
//   AppEvents.Started (e.sessionId ~1315) / AppEvents.CallAlerting
//   (_CallAlertingEvent: call/callerid/destination ~1342) / AppEvents.HttpRequest
//   (e.content ~1255) / AppEvents.Terminating (one HTTP request allowed ~1193);
//   Call.answer()/reject(code)/hangup()/say(text,params)/record(params)
//   (~3597/3624/3590/3664/3672); CallEvents.Connected/Disconnected/Failed/
//   PlaybackFinished/RecordStarted (~2540/2568/2586/2617/2657);
//   VoxEngine.callUser(CallUserParameters)/callPSTN(number,callerid,params?)/
//   sendMediaBetween(u1,u2)/getSecretValue(name)/terminate()
//   (~13092/13055/13391/13359/13419); Net.httpRequestAsync(url,options)
//   (~8496); VoiceList.Google.he_IL_Wavenet_A (same voice as RSVP.voxengine.js —
//   vetted natural for he-IL names/dates).
//
// UNVERIFIED / cross-cutting finding (NOT fixed here — out of this file's
// scope): the typings above declare VoxEngine.callUser with ONLY the object
// form, `callUser(parameters: CallUserParameters)`, requiring `username` +
// `callerid` — that is what this file uses throughout. The shipped PRODUCTION
// RSVPAgent.voxengine.js (:633, attachSupervisor) calls it as
// `VoxEngine.callUser(voxUsername, state.from)` — two positional strings. That
// call site has never been exercised on a live call (human_agent_call_legs has
// 0 rows today per app-db-foundations' live measurement), so it is deployed but
// UNTESTED, not confirmed precedent — unlike the AMD.create({call:...}) case
// elsewhere in that file, where the runtime's own error message proved the
// typings wrong. Here there is no such runtime evidence either way. If a live
// smoke test proves the object form used here is wrong, RSVPAgent:633 likely
// carries the same latent bug and should be reviewed together with this finding.
//
// Conference module — required for the stage-2 conference_add command's
// VoxEngine.createConference/destroyConference (typings ~5049-5052: the
// Conference/ConferenceEvents/ConferenceMode namespace only exists once this
// is required). RSVPAgent.voxengine.js:81 requires it unconditionally at
// module top level for the identical reason (its own supervisor mixer);
// mirrored here rather than lazily, so the namespace exists before the first
// conference_add command can possibly arrive.
require(Modules.Conference);
// PushService — same reasoning and same live-doc citation as
// ConsoleInbound.voxengine.js's identical require (14.8). This file rings
// agents from SEVEN call sites (the internal agent_* branch, blind transfer,
// consult, and conference targets), and every one of them can legitimately
// target an agent whose app is asleep — a colleague dialling them directly, or
// a transfer aimed at someone who is on shift but not currently connected.
// Without this the platform sends no push and those attempts just fail 480.
require(Modules.PushService);
VoxEngine.addEventListener(AppEvents.Started, function (startedEvent) {
    // ---- Constants ---------------------------------------------------------
    // The production app origin this scenario reports to. A CallAlerting-
    // triggered session (SDK call, not Management API StartScenarios) has no
    // customData channel to receive this per-call the way RSVP/RSVPAgent's {u}
    // field does — it must be a scenario constant. Matches THIS deployment's
    // APP_ORIGIN (.env.local: https://beta.kalfa.me). Move to a VoxEngine
    // Secret if kalfa-rsvp's reporting target ever needs to differ from the
    // app that owns this scenario's deploy.
    var KALFA_APP_ORIGIN = 'https://beta.kalfa.me';
    // Disclosure wording — regulation-reviewer authorized (12.8), verbatim, no
    // slash-forms (TTS reads them literally). Played on the GUEST leg only,
    // before the bridge, over recording already running.
    var DISCLOSURE_LINE_HE = 'שלום, שיחה זו מטעם בעלי האירוע בנוגע לאישור הגעה — השיחה מוקלטת לצורך תיעוד.';
    var OUTBOUND_REFUSED_HE = 'לא ניתן לבצע את השיחה כעת. אנא פנו למנהל המערכת.';
    var OUTBOUND_UNREACHABLE_HE = 'לא הצלחנו להשלים את השיחה. אנא נסו שוב מאוחר יותר.';
    var INTERNAL_UNAVAILABLE_HE = 'הנציג המבוקש אינו זמין כרגע.';
    // Hold cue (this task, 17.8) — an OPERATIONAL hold line, NOT owner/
    // regulation-authorized wording like DISCLOSURE_LINE_HE above (same
    // category as ConsoleInbound.voxengine.js's RING_HOLD_LINE_HE — that
    // precedent is exactly why this needs no separate sign-off). Repeated via
    // say() while the customer leg has no live audio flowing to it — driven
    // by CallEvents.OnHold (the operator's SDK "השהיה" button,
    // src/lib/voximplant/web-client.ts's toggleHold) AND by an active
    // consult (startConsult's own stopMediaBetween) — see
    // startHoldAudio()/remoteNeedsHold() below. Outbound branch only: the
    // internal (agent_*) branch is colleague-to-colleague, never recorded,
    // never customer-facing (this file's own header) and gets no hold audio.
    var HOLD_LINE_HE = 'השיחה מוחזקת לרגע, אנא המתינו על הקו.';
    // Wavenet Hebrew — same voice RSVP.voxengine.js already vetted as stable
    // for he-IL names/dates. No SSML anywhere (the platform reads it literally).
    var ttsOptions = { voice: VoiceList.Google.he_IL_Wavenet_A };
    // Blind-transfer watchdog. VoxEngine's own no-answer Failed fires around
    // 60s (platform default) — 20s is OUR tighter ceiling so a stuck transfer
    // target never leaves the guest waiting a full minute (plan owner-decided
    // constant for V1 blind transfer).
    var TRANSFER_TIMEOUT_MS = 20000;
    // Hold-cue cadence — a scenario-side setTimeout loop (not Call.say's own
    // mechanism, which has no loop option; verified against live docs).
    // HOLD_REPEAT_MS is the STARTING interval; startHoldAudio() doubles it on
    // every repeat, capped at HOLD_REPEAT_MAX_MS — an uncapped flat 20s cue
    // on a 10-minute hold is 31 TTS calls on ONE call (this project's own
    // flood measured 41% of its cost as TTS), while a hard N-repeat cutoff
    // just replaces "audible reassurance" with "silence again" past that
    // point, which is the exact bug this task exists to fix. Backoff bounds
    // both: a 10-minute hold plays HOLD_LINE_HE only 7 times (immediately,
    // then at the 20s/60s/140s/260s/380s/500s marks) instead of 31, and
    // NEVER reverts to permanent silence — it just gets less frequent, for
    // as long as the hold lasts. Independently tunable from RING_PER_AGENT_MS in
    // ConsoleInbound.voxengine.js on purpose — same value today by
    // coincidence, not because the two concepts are coupled.
    var HOLD_REPEAT_MS = 20000;
    var HOLD_REPEAT_MAX_MS = 120000;
    // Leaked-session backstop, NOT a call-length cap — operator calls are
    // human-paced and can legitimately run long. 60 minutes is a generous
    // ceiling purely so a wedged session cannot bill/hold forever; tune as an
    // owner knob. (Closest existing precedent: the owner-approved
    // HANDOFF_MAX_MS = 30 min for AI-handoff calls in RSVPAgent — deliberately
    // NOT reused here: these are ordinary agent-operated calls, not an AI
    // handoff, and a customer-service call legitimately running past 30
    // minutes should not be cut off.)
    var SAFETY_NET_MS = 60 * 60 * 1000;
    // Grace before hangup so any queued TTS drains instead of clipping —
    // mirrors RSVPAgent's call_end grace (500ms).
    var HANGUP_GRACE_MS = 500;
    // Net.httpRequestAsync's own default is 90s total / 6s TCP connect,
    // "value can be only decreased" (typings HttpRequestOptions.timeout,
    // seconds) — left at that default, a hung/mid-deploy backend leaves the
    // GUEST leg (already answered, recording, disclosure already played by
    // the time authorize's response gates the bridge — see handleOutbound)
    // in dead silence for up to 90s before this scenario's own no-answer/
    // refusal wording ever plays. Applied to EVERY gating Net.httpRequestAsync
    // call in this file (reportEvent + authorize), not just authorize itself:
    // handleOutbound chains authorize BEHIND reportEvent('started', ...)'s
    // own promise, so an untimed 'started' request would silently compound
    // into up to 180s before authorize even starts (found in a full
    // telephony audit, 13.8).
    var GATE_HTTP_TIMEOUT_S = 10;
    var CONSOLE_SECRET = VoxEngine.getSecretValue('KALFA_CONSOLE_SECRET');
    if (!CONSOLE_SECRET) {
        // Lifecycle reporting is best-effort and silently no-ops without a
        // secret (never blocks internal audio). The OUTBOUND branch's
        // authorize call is the AUTHORITY gate, not best-effort — a missing
        // secret there fails closed (see handleOutbound). Logged once here so
        // it is visible without repeating per call.
        Logger.write('[ConsoleDial] KALFA_CONSOLE_SECRET missing — outbound authorize will fail closed; ' +
            'internal-branch/event reporting is best-effort and will silently skip');
    }
    var state = {
        sessionId: (startedEvent && startedEvent.sessionId) || 0,
        // _StartedEvent carries these on EVERY session (CallAlerting-triggered
        // ones included, not just StartScenarios) — typings/voxengine.d.ts:1291-1299:
        // "HTTP(S) URL that can be used to send commands to this scenario from
        // external systems". Reported once on 'started' so the backend can later
        // push a command (e.g. transfer) the same way it already does for
        // RSVPAgent via media_session_access_url — the StartScenarios-only field
        // that does NOT exist for this CallAlerting-triggered scenario.
        accessUrl: (startedEvent && startedEvent.accessURL) || null,
        accessSecureUrl: (startedEvent && startedEvent.accessSecureURL) || null,
        kind: '', // 'internal' | 'outbound'
        token: '', // agent_<uuid> destination (internal) or ct<hex> (outbound)
        operator: null, // the SDK leg — replaceable via transfer
        operatorUsername: '', // CallAlerting's own callerid — reused as the
        // callerid parameter for any callUser this session issues (internal
        // callee, transfer target), so the callee/target's device shows who is
        // calling. ASSUMPTION flagged in the final report: unverified that an
        // SDK-originated call's own callerid is reliably the caller's own
        // agent_<uuid> identity — needs a live smoke test.
        remote: null, // callee (internal) or guest (outbound) — never replaced
        recordingUrl: null,
        connectedAt: 0,
        transferring: false,
        transferTimer: null,
        releasingOperator: null, // set just before hanging up an origin leg
        // we're intentionally retiring on a successful transfer, so its own
        // Disconnected does not end the session.
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
        // ── Hold audio (this task, 17.8) ─────────────────────────────────
        sdkOnHold: false, // true while CallEvents.OnHold is active on the
        // CURRENT operator leg (outbound branch only — see
        // attachOperatorTerminalHandlers). Reset on every operator handoff
        // (completeTransfer/completeConsult) — a stale leg's hold state
        // never carries over to the fresh one.
        holdAudioTimer: null // the repeating say() timer driving HOLD_LINE_HE
        // while remoteNeedsHold() is true; null whenever it is not playing
        // (see startHoldAudio/stopHoldAudio).
    };
    function log(msg) {
        Logger.write('[ConsoleDial] ' + msg);
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
    // path. A dropped report only leaves server-side console_calls history
    // incomplete; it never touches audio. Secret travels in the POST body
    // (never a query string, never logged). Returns the underlying promise
    // (always resolves, success or failure — see the .catch below) so
    // handleOutbound can SEQUENCE the authorize call after 'started', closing
    // a session-linking race (see handleOutbound's comment).
    function reportEvent(kind, extra) {
        if (!CONSOLE_SECRET)
            return Promise.resolve();
        var body = {
            secret: CONSOLE_SECRET,
            session_id: state.sessionId,
            call_kind: state.kind,
            token: state.token,
            event: kind
        };
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k))
                    body[k] = extra[k];
            }
        }
        return Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/event', {
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
    // Exactly ONE 'ended' report per session (idempotent — a racing Failed +
    // Disconnected, or a command-triggered close, can never double-post).
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
    // one (idempotent, via the scheduleXHangup guards) and finalize once BOTH
    // are gone. `which` names the leg that just disconnected.
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
        // Same reasoning as the conference block below: a consult in flight
        // (dialing OR privately bridged) has no meaning once operator or
        // remote is gone — hang up the orphaned consult leg explicitly
        // rather than rely on VoxEngine.terminate()'s eventual session-wide
        // cleanup once both named legs are down.
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
    // The customer leg (state.remote) goes silent for two INDEPENDENT
    // reasons: the operator's own SDK "השהיה" button (CallEvents.OnHold
    // below), and an active consult (startConsult's own stopMediaBetween —
    // the pre-existing gap this file's consult section already documented:
    // "NO hold-music asset exists in this scenario"). remoteNeedsHold() is
    // the single source of truth both triggers check, so neither one can
    // prematurely resume the live bridge while the OTHER reason is still
    // active (e.g. the operator toggles SDK hold mid-consult).
    function remoteNeedsHold() {
        return state.sdkOnHold || state.consulting || state.consultActive;
    }
    // Repeating say() rather than a looped hosted audio file — reuses the
    // exact production-proven mechanism and voice as this codebase's other
    // operational hold cues (ConsoleInbound.voxengine.js's RING_HOLD_LINE_HE)
    // instead of inventing a new audio asset (this file's own consult
    // comment already declined to do that once; a hosted asset is an
    // owner-decision this task does not extend to). Self-terminates the
    // instant remoteNeedsHold() goes false OR state.remote has moved on to a
    // different leg (transfer/consult-complete/conference/hangup), so no
    // stray utterance can land on a leg that already has a live
    // conversation running.
    function startHoldAudio() {
        if (state.holdAudioTimer || !state.remote)
            return; // already playing, or nothing to play it to
        var remote = state.remote;
        // Resets to HOLD_REPEAT_MS every time a NEW hold period starts (a
        // fresh call to startHoldAudio — see its guard above) — a caller who
        // was unheld and gets re-held hears the frequent cadence again from
        // the top, not wherever a previous hold's backoff left off.
        var delay = HOLD_REPEAT_MS;
        function tick() {
            if (state.remote !== remote || !remoteNeedsHold()) {
                state.holdAudioTimer = null;
                return;
            }
            try {
                remote.say(HOLD_LINE_HE, ttsOptions);
            }
            catch (err) {
                log('hold-audio say failed: ' + err);
            }
            state.holdAudioTimer = setTimeout(tick, delay);
            delay = Math.min(delay * 2, HOLD_REPEAT_MAX_MS);
        }
        tick();
    }
    function stopHoldAudio() {
        if (state.holdAudioTimer) {
            clearTimeout(state.holdAudioTimer);
            state.holdAudioTimer = null;
        }
    }
    // (Re)binds the terminal listeners for whichever Call is currently
    // playing the "operator" role — called once at dial time and again after
    // a successful transfer hands the role to the target leg.
    function attachOperatorTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            if (state.releasingOperator === call) {
                // Expected: this IS the origin leg being released as part of a
                // successful transfer, not the call ending.
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
        // object here is whichever leg the SDK put on hold). Outbound only:
        // internal legs are never customer-facing (see HOLD_LINE_HE's own
        // comment).
        //
        // Conference guard, and the KNOWN GAP it accepts: once
        // state.conferenced is true, state.remote's incoming stream is the
        // Conference mixer, not this leg directly — a say() here would
        // silently steal the customer's audio out of a live 3-way call
        // (Call.sendMediaTo's docs: "a new incoming stream always replaces
        // the previous one"), so hold is ignored entirely while conferenced.
        // This means an operator who holds mid-conference leaves the
        // customer in silence again — the ORIGINAL bug this task fixes,
        // reappearing in the one topology where fixing it risks a worse
        // outcome (silencing the whole 3-way call for everyone). Accepted
        // deliberately, not missed: silence for one caller in a rare
        // topology beats breaking a live 3-way call for three people.
        call.addEventListener(CallEvents.OnHold, function () {
            if (state.kind !== 'outbound' || state.conferenced)
                return;
            state.sdkOnHold = true;
            log('operator SDK hold — starting hold audio for the customer leg');
            startHoldAudio();
        });
        call.addEventListener(CallEvents.OffHold, function () {
            if (!state.sdkOnHold)
                return; // hold was ignored above (internal/conferenced) — nothing to undo
            state.sdkOnHold = false;
            log('operator SDK off-hold');
            restoreCustomerBridge('sdk_hold_released');
        });
    }
    function attachRemoteTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('remote disconnected: ' + safeStringify(ev));
            handleLegDown('remote', 'remote_hangup');
        });
    }
    // ── Blind transfer (V1: scenario-side, no consult) ──────────────────────
    function completeTransfer(target, requestId) {
        var origin = state.operator;
        state.operator = target; // hand off the "operator" role FIRST
        // The ORIGIN's hold state (if any) does not carry over to a fresh
        // target leg, and any pending hold-audio timer must not land a stray
        // utterance on the just-established post-transfer conversation.
        state.sdkOnHold = false;
        stopHoldAudio();
        attachOperatorTerminalHandlers(target);
        try {
            // Recording lives on state.remote (guest/callee), untouched by
            // this rewire — it continues across the transfer (decided).
            VoxEngine.sendMediaBetween(state.remote, target);
        }
        catch (err) {
            log('transfer rebridge failed: ' + err);
        }
        state.releasingOperator = origin;
        try {
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
            return; // already resolved (Connected raced the timeout/Failed)
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
        // The origin↔remote bridge was never touched during the attempt —
        // guest and origin operator stayed connected throughout, so there is
        // nothing to restore.
        reportEvent('transfer_failed', { request_id: requestId, reason: why });
        log('transfer [' + requestId + '] failed: ' + why);
    }
    // True while ANY live-topology change (blind transfer, consult,
    // conference) is in flight. A single canonical guard so the four command
    // handlers below can never race each other into a corrupted bridge —
    // e.g. starting a conference mid-consult, or a blind transfer while the
    // operator is privately bridged to a consult target. Checked FIRST in
    // every one of startTransfer/startConsult/startConference; the
    // commands that ACT ON an already-in-flight op (consult_cancel,
    // consult_complete) check their own narrower state instead (see below).
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
        var target = VoxEngine.callUser({
            username: voxUsername,
            callerid: state.operatorUsername || 'kalfa-console'
        });
        reportEvent('transfer_started', { request_id: requestId, target: voxUsername });
        var timer = setTimeout(function () {
            failTransfer(target, requestId, 'timeout');
        }, TRANSFER_TIMEOUT_MS);
        state.transferTimer = timer;
        target.addEventListener(CallEvents.Connected, function () {
            if (!state.transferring) {
                // We already gave up (timeout/Failed) — a late Connected must
                // not leak an orphaned live call.
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
    // Puts the customer on hold (silent — NO hold-music asset exists in this
    // scenario; documented here rather than invented) and privately bridges
    // operator<->target so the customer hears NEITHER side of the
    // consultation. Two ways out: consult_cancel restores the customer
    // bridge; consult_complete is the actual warm transfer (drops the
    // operator, bridges customer<->target). Recording (Call.record() on
    // state.remote, armed once at connect time in proceedOutbound) is
    // UNAFFECTED by any of this: it keeps recording whatever state.remote
    // currently receives (silence during the hold window) — the
    // operator<->target conversation never touches state.remote and is
    // therefore NEVER recorded. Deliberate: the guest's disclosure said
    // THEIR call is recorded, not that internal staff consultations are.
    function restoreCustomerBridge(why) {
        // The OTHER trigger for hold (SDK hold vs. consult) may still be
        // active — e.g. the operator toggled SDK hold mid-consult, and this
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
        log('consult ' + why + ' — restored operator<->customer bridge');
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
        // Hold FIRST (per the task's own ordering): the customer must never
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
            callerid: state.operatorUsername || 'kalfa-console'
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
                // PRIVATE bridge — the customer (state.remote) is not part of
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
            // The actual warm transfer: the customer, silent since
            // startConsult's hold, is now bridged to the consult target.
            VoxEngine.sendMediaBetween(state.remote, target);
        }
        catch (err) {
            log('consult complete bridge failed: ' + err);
        }
        state.operator = target; // hand off the "operator" role
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
    // Unlike consult, the customer is NOT put on hold: the existing
    // operator<->customer bridge stays live through the ring, and only once
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
        // The direct operator<->customer bridge below is only correct if
        // NEITHER hold trigger is still active (state.conferenced is now
        // false, so remoteNeedsHold() reflects SDK-hold/consult accurately
        // again) — e.g. the operator never took SDK hold off for the whole
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
        // The operator<->customer bridge was never touched during the
        // dialing phase — nothing to restore (same reasoning as
        // failTransfer's identical comment).
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
            callerid: state.operatorUsername || 'kalfa-console'
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
            // this moment) would silently steal the customer's audio out of
            // the live 3-way call. Stop it unconditionally; the OnHold
            // handler's own conferenced guard prevents a NEW one from
            // starting for as long as the mixer is live.
            stopHoldAudio();
            // Mixer (needs no video-conference rule flag, unlike Conference.add
            // — RSVPAgent's own precedent, :742-745). hd_audio explicit: the
            // parameter is the interface's only field and HD audio bills
            // extra — false = the free 8kHz default, stated on purpose.
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
    // No reply channel exists on AppEvents.HttpRequest — arrival here IS the
    // authorization (the managing URL is a capability held only by KALFA's
    // backend). Unknown commands are ignored.
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
    // Last-resort report. Every ordinary path already reports 'ended' via
    // reportEndedOnce (idempotent), so this is a no-op on a healthy call — it
    // exists for a JS error mid-scenario or the platform force-ending a
    // wedged session, exactly like RSVPAgent's Terminating handler.
    VoxEngine.addEventListener(AppEvents.Terminating, function () {
        if (state.endedReported)
            return;
        log('Terminating with no ended report sent — posting last-resort close');
        reportEndedOnce('session_terminating');
    });
    // Global safety net — closes the session even if every other path is
    // stuck. Not a call-length cap (see SAFETY_NET_MS comment above).
    state.globalTimer = setTimeout(function () {
        log('safety-net timeout reached — closing');
        reportEndedOnce('safety_net_timeout');
        if (state.operator)
            scheduleOperatorHangup(0);
        if (state.remote)
            scheduleRemoteHangup(0);
        // Belt-and-suspenders: if neither leg's Disconnected arrives in time,
        // force-terminate directly (mirrors RSVPAgent's global-timeout path).
        setTimeout(function () {
            cleanupAndTerminate();
        }, 3000);
    }, SAFETY_NET_MS);
    // ── Internal branch (agent_<uuid>) ──────────────────────────────────────
    function handleInternal(operatorCall, destination) {
        reportEvent('started', { access_url: state.accessUrl, access_secure_url: state.accessSecureUrl });
        operatorCall.addEventListener(CallEvents.Connected, function () {
            log('operator leg connected (internal)');
            var callee = VoxEngine.callUser({
                username: destination,
                callerid: state.operatorUsername || 'kalfa-console'
            });
            state.remote = callee;
            attachRemoteTerminalHandlers(callee);
            reportEvent('ringing', {});
            callee.addEventListener(CallEvents.Connected, function () {
                state.connectedAt = Date.now();
                try {
                    VoxEngine.sendMediaBetween(operatorCall, callee);
                }
                catch (err) {
                    log('internal bridge failed: ' + err);
                }
                log('internal call connected');
                reportEvent('connected', {});
            });
            callee.addEventListener(CallEvents.Failed, function (ev) {
                log('internal callee failed: ' + safeStringify(ev));
                state.remote = null;
                reportEndedOnce('callee_failed');
                try {
                    operatorCall.say(INTERNAL_UNAVAILABLE_HE, ttsOptions);
                }
                catch (err) {
                    log('say failed: ' + err);
                }
                operatorCall.addEventListener(CallEvents.PlaybackFinished, function () {
                    scheduleOperatorHangup(0);
                });
                // Watchdog in case PlaybackFinished never fires (say() itself
                // failed, e.g.).
                setTimeout(function () {
                    scheduleOperatorHangup(0);
                }, 5000);
            });
        });
        try {
            operatorCall.answer();
        }
        catch (err) {
            log('operator answer() failed: ' + err);
            cleanupAndTerminate();
        }
    }
    // ── Outbound branch (ct<hex> dial-token) ────────────────────────────────
    function refuseOutbound(operatorCall, reason) {
        reportEndedOnce(reason);
        operatorCall.addEventListener(CallEvents.Connected, function () {
            try {
                operatorCall.say(OUTBOUND_REFUSED_HE, ttsOptions);
            }
            catch (err) {
                log('say failed: ' + err);
            }
        });
        operatorCall.addEventListener(CallEvents.PlaybackFinished, function () {
            scheduleOperatorHangup(0);
        });
        setTimeout(function () {
            scheduleOperatorHangup(0);
        }, 6000);
        try {
            operatorCall.answer();
        }
        catch (err) {
            log('answer() before refusal failed: ' + err);
            cleanupAndTerminate();
        }
    }
    function proceedOutbound(operatorCall, phone, callerid) {
        try {
            operatorCall.answer();
        }
        catch (err) {
            log('operator answer() failed: ' + err);
            cleanupAndTerminate();
            return;
        }
        reportEvent('ringing', {});
        var guestCall = VoxEngine.callPSTN(phone, callerid);
        state.remote = guestCall;
        attachRemoteTerminalHandlers(guestCall);
        guestCall.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = (ev && ev.url) || null;
            log('RECORDING_URL captured');
        });
        guestCall.addEventListener(CallEvents.Connected, function () {
            state.connectedAt = Date.now();
            // Recording FIRST — the disclosure itself must be on tape.
            try {
                guestCall.record({ stereo: true });
            }
            catch (err) {
                log('guest record() failed: ' + err);
            }
            try {
                guestCall.say(DISCLOSURE_LINE_HE, ttsOptions);
            }
            catch (err) {
                log('disclosure say() failed: ' + err);
            }
            // ONE-SHOT — without this, ANY later PlaybackFinished on this
            // same leg (e.g. a repeating hold-audio say() completing while
            // the operator has the call on hold, see startHoldAudio()) would
            // re-enter this handler: re-bridge to the CAPTURED operatorCall
            // (stale after any transfer), and fire a duplicate
            // reportEvent('connected') that corrupts the row's answered
            // timestamp. addEventListener does not replace a previous
            // handler (see ConsoleInbound.voxengine.js's identical
            // ringStarted guard/comment for the citation) — guarded rather
            // than argued, exactly like that one. Found in this task (17.8)
            // while adding hold audio, not exercised by a live call before.
            var bridgedAfterDisclosure = false;
            guestCall.addEventListener(CallEvents.PlaybackFinished, function () {
                if (bridgedAfterDisclosure)
                    return;
                bridgedAfterDisclosure = true;
                try {
                    VoxEngine.sendMediaBetween(operatorCall, guestCall);
                }
                catch (err) {
                    log('outbound bridge failed: ' + err);
                }
                log('outbound call bridged after disclosure');
                reportEvent('connected', {});
            });
        });
        guestCall.addEventListener(CallEvents.Failed, function (ev) {
            log('guest call failed: ' + safeStringify(ev));
            state.remote = null;
            reportEndedOnce('guest_failed');
            try {
                operatorCall.say(OUTBOUND_UNREACHABLE_HE, ttsOptions);
            }
            catch (err) {
                log('say failed: ' + err);
            }
            operatorCall.addEventListener(CallEvents.PlaybackFinished, function () {
                scheduleOperatorHangup(0);
            });
            setTimeout(function () {
                scheduleOperatorHangup(0);
            }, 5000);
        });
    }
    function handleOutbound(operatorCall, token) {
        if (!CONSOLE_SECRET) {
            reportEvent('started', { access_url: state.accessUrl, access_secure_url: state.accessSecureUrl });
            refuseOutbound(operatorCall, 'no_secret');
            return;
        }
        // 'started' MUST reach the server and be processed BEFORE authorize
        // fires — authorize's success path (verifyDialToken) NULLS the
        // dial_token_hash the 'started' report's session-link Tier 2 depends
        // on (findConsoleCallForEvent). Firing them concurrently races: if
        // authorize's round trip wins, the hash is already consumed by the
        // time 'started' arrives, and the server falls back to the FIFO
        // fallback tier — which, under >1 concurrent outbound dial, can link
        // this session's transfer/command capability (session_url) to the
        // WRONG console_calls row. Chaining behind reportEvent()'s promise
        // (which always resolves, success or failure — see its own .catch)
        // guarantees the token is still live when the server looks it up.
        reportEvent('started', { access_url: state.accessUrl, access_secure_url: state.accessSecureUrl }).then(function () {
            Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/authorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: GATE_HTTP_TIMEOUT_S,
                // session_id — lets authorize link this session to its
                // console_calls row DIRECTLY (console-calls.ts's
                // linkConsoleCallSession), independent of whether the
                // 'started' /event report above ever lands. See that
                // function's header for the gap this closes.
                postData: safeStringify({ secret: CONSOLE_SECRET, token: token, session_id: state.sessionId })
            }).then(function (r) {
                var body = null;
                try {
                    body = JSON.parse(r.text || '{}');
                }
                catch (_e) { }
                var ok = r.code === 200 && !!body && body.ok === true && !!body.phone && !!body.callerid;
                if (!ok) {
                    log('authorize refused: code=' + (r && r.code));
                    refuseOutbound(operatorCall, 'refused');
                    return;
                }
                proceedOutbound(operatorCall, String(body.phone), String(body.callerid));
            }).catch(function (err) {
                log('authorize request failed: ' + err);
                refuseOutbound(operatorCall, 'authorize_unreachable');
            });
        });
    }
    // ── Entry point ──────────────────────────────────────────────────────────
    VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
        var operatorCall = e.call;
        var destination = e.destination || '';
        state.operator = operatorCall;
        state.operatorUsername = e.callerid || '';
        attachOperatorTerminalHandlers(operatorCall);
        if (/^agent_/.test(destination)) {
            state.kind = 'internal';
            state.token = destination;
            handleInternal(operatorCall, destination);
        }
        else if (/^ct[0-9a-f]+$/.test(destination)) {
            state.kind = 'outbound';
            state.token = destination;
            handleOutbound(operatorCall, destination);
        }
        else {
            // Defensive only — the rule patterns already filter this before
            // the scenario runs. destination here is an internal id/token,
            // never PII, safe to log its length.
            log('unroutable destination (len=' + destination.length + ') — rejecting');
            try {
                operatorCall.reject(404);
            }
            catch (err) {
                log('reject failed: ' + err);
            }
            cleanupAndTerminate();
        }
    });
});
