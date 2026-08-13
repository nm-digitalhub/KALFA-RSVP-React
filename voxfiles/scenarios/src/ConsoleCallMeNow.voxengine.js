// ConsoleCallMeNow — capability A, THIRD design (OTP-verified "call me now",
// 12.8; see console-calls.ts's evaluateCallMeNowCaps header for the full
// trail). BOUND to rule ConsoleCallMeNow (voxfiles/applications/.../rules.config.json,
// pattern cn[0-9a-f]+ → this scenario) and LIVE — verified both via that
// config and a real session log (13.8). StartScenarios-triggered ONLY
// (there is no CallAlerting entry point here at all, unlike
// ConsoleDial/ConsoleInbound — the rule pattern exists only because
// StartScenarios still requires a rule_id to resolve which scenario to run;
// it is never pattern-matched against an inbound destination the way
// ConsoleDial/ConsoleInbound's rules are): POST /api/call-me-now/verify
// places the visitor's PSTN leg itself via the Management API once every
// admission gate (OTP, consent, AVAILABILITY, caps) has already passed —
// see that route's own header for the full order. This file never decides
// admission; by the time it runs, the call already exists and is already
// being billed, exactly like RSVPAgent/Outgoingcall-RSVPAI.
//
// Flow: Started -> parse {to,from,tok,u} (Branch B shape, same as
// Outgoingcall-RSVPAI.voxengine.js:271-288) -> callPSTN the VISITOR -> on
// Connected: record() then say(disclosure) (recording first, so the
// disclosure itself is on tape — ConsoleDial.voxengine.js:946-958's own
// ordering) -> on PlaybackFinished: POST `tok` to
// /api/voximplant/console/call-me-now-authorize (that route's own header,
// call-me-now-authorize/route.ts:29-33, documents this exact sequencing:
// "AFTER the visitor leg answers and its disclosure finishes playing") -> the
// response is EITHER `{ok:false}` (call-me-now-authorize/route.ts:80, a hard
// refuse: bad secret/token, flag/live_calls/balance off, concurrency or daily
// cap) OR `{ok:true, ring_order, call_id}` (route.ts:161), where an EMPTY
// ring_order is explicitly NOT a refusal (route.ts:49-58) — both an
// ok:false AND an ok:true-with-empty-ring_order feed the SAME serial ring
// (ConsoleInbound.voxengine.js:890-955 ringNext, reused near-verbatim below),
// whose own idx>=length base case already means "declare no agent" — so no
// special-case branch is needed for the empty-ring shape at all, it falls out
// of ringNext's existing recursion for free.
//
// NO_AGENT_LINE_HE and declareNoAgent() (ConsoleInbound.voxengine.js:65,
// 828-843) are reused VERBATIM (identical string, identical behavior) per
// the compliance ruling and this build's explicit brief: a call that finds
// nobody routable — whether because the ring genuinely exhausted, or because
// call-me-now-authorize's fresh re-check refused for ANY reason (concurrency/
// balance/flag/daily-cap having changed in the few seconds since verify's own
// admission check) — is the SAME visitor-facing moment: "we are not
// connecting you to anyone right now" and gets the SAME honest promise and
// the SAME 'ended' reason='no_agent', which is what makes /event's own
// `if (body.reason === 'no_agent') recordNoAgentCallback(...)`
// (event/route.ts:174-176) write the real callback row. Deliberate
// simplification, not an oversight — see this file's own report to
// team-lead for the reasoning spelled out in full.
//
// EVENT call_kind CHOICE (a genuine cross-file subtlety, read from
// console-calls.ts/event/route.ts directly, not assumed):
// /api/voximplant/console/event's `call_kind` field
// (validation/console-calls.ts:105: z.enum(['internal','outbound','inbound']))
// is NOT the same vocabulary as console_calls.kind ('call_me_now' is not a
// valid value here) — it is a coarse SESSION-TRIGGER tag the /event route
// uses BOTH to pick a session-resolution tier (findConsoleCallForEvent,
// console-calls.ts:893-961) AND to pick per-event behavior
// (event/route.ts:124-135 'ringing'/'connected' disclosurePlayed timing,
// :143-146 resolveAgentIdByVoxUsername). At Started time this scenario has
// NO call_id (verify/route.ts's payload is {to,from,tok,u} only) — so the
// 'started' report MUST claim call_kind:'outbound', the only shape whose
// token gets forwarded into findConsoleCallForEvent's Tier 2 (token-hash)
// resolution (console-calls.ts:925-937). That Tier 2 lookup calls
// linkSession(), which writes console_call_pii.vox_session_id — so EVERY
// event after a successful 'started' resolves via Tier 1 (already-linked,
// console-calls.ts:917-923) regardless of what call_kind it claims. This
// scenario uses that freedom deliberately: 'ringing'/'connected'/'ended' all
// claim call_kind:'inbound' instead, because THIS file's architecture (agent
// unknown until a later serial ring resolves a winner) matches
// ConsoleInbound's semantics, not ConsoleDial's (operator already on the line
// from the start) — 'inbound' semantics mark disclosurePlayed as soon as
// 'ringing' fires (accurate even on a no_agent outcome, where 'connected'
// never happens — an 'outbound'-tagged 'ringing' would never set it in that
// case, a real audit-trail gap) and let resolveAgentIdByVoxUsername() attach
// agent_id from the 'connected' event (this row has no agent_id at creation,
// unlike ConsoleDial's manual-dial flow, which already knows it from
// dial-intent's ctx.userId). Traded off explicitly: if 'started' itself is
// somehow lost, Tier 3's FIFO fallback (console-calls.ts:939-959) filters on
// `direction`, and this row is created with direction:'outbound'
// (call-me-now/verify/route.ts) — an 'inbound'-tagged later event would miss
// that fallback too on this rare double-failure path. Judged an acceptable
// trade for the common-case correctness gained; flagged for team-lead's own
// review rather than decided silently.
//
// DISCLOSURE_LINE_CALL_ME_NOW_HE below is NEW wording, NOT verbatim
// owner/regulation-authorized text like ConsoleDial's DISCLOSURE_LINE_HE or
// ConsoleInbound's DISCLOSURE_LINE_INBOUND_HE (both of those are marked
// "do not paraphrase" in their own files) — neither existing line fits: one
// claims an RSVP purpose that has nothing to do with call-me-now, the other
// claims the visitor dialed IN ("הגעתם לקלפה"), which is false here (the
// platform placed this leg). This is drafted here, flagged, and MUST get the
// same compliance/owner review the other two already received before this
// scenario can ever go live — see this file's own report to team-lead.
//
// Net.httpRequestAsync per-session budget discipline (same concern
// ConsoleInbound.voxengine.js:844-855 documents for its own wake-retry):
// worst case here is 5 requests (started, authorize, ringing, connected,
// ended) — same order of magnitude as ConsoleInbound's own proven "5-deep
// ring order plus started/ringing/connected/ended" baseline. No retry loop,
// no request per ring attempt.
//
// No require(Modules.*) — unlike ConsoleDial/ConsoleInbound, this file never
// calls VoxEngine.createConference/destroyConference (transfer/consult/
// conference are NOT implemented for this call kind: console-calls.ts's
// LIVE_CUSTOMER_CALL_KINDS deliberately excludes 'call_me_now', same as
// 'widget', "scenario-side command channel not implemented for either" — no
// server route will ever dispatch those commands here) and never uses ASR
// (unlike Outgoingcall-RSVPAI.voxengine.js). Requiring an unused module, or
// omitting a used one, is exactly the class of bug the console audit already
// caught once (both console scenarios were missing require(Modules.Conference)
// for their OWN conference_add command) — verified here by checking every
// VoxEngine.* call actually used below needs no explicit require (matching
// Outgoingcall-RSVPAI's own callPSTN/record/say usage, which needs none
// either).
//
// Symbols verified against typings/voxengine.d.ts and
// docs/voximplant/digest-voxengine-ref.md, same citations as
// ConsoleDial.voxengine.js/ConsoleInbound.voxengine.js's own headers:
// AppEvents.Started/HttpRequest/Terminating; Call.answer() is NEVER called in
// this file (there is no operator leg to answer — the visitor leg is a
// callPSTN() result, already "outbound", per Outgoingcall-RSVPAI's identical
// precedent of never calling answer() on a callPSTN() call); Call.hangup()/
// say()/record() (~3624/3664/3672); CallEvents.Connected/Disconnected/
// Failed/PlaybackFinished/RecordStarted (~2540/2568/2586/2617/2657);
// VoxEngine.callPSTN(number,callerid) (~13055) / callUser(CallUserParameters)
// (~13092, object form — ConsoleInbound's own choice for its ring, reused
// here rather than RSVPAgent:633's unverified two-positional-string form, per
// this build's brief: "if ConsoleInbound... already solve something, copy
// its shape"); Net.httpRequestAsync(url,options) (~8496);
// VoiceList.Google.he_IL_Wavenet_A (same voice as the other two console
// scenarios).
VoxEngine.addEventListener(AppEvents.Started, function (startedEvent) {
    // ---- Constants ---------------------------------------------------------
    var KALFA_APP_ORIGIN = 'https://beta.kalfa.me';
    // NEW, NOT YET owner/regulation-authorized — see file header.
    var DISCLOSURE_LINE_CALL_ME_NOW_HE = 'שלום, כאן קלפה, חוזרים אליכם לפי בקשתכם להתקשרות. לתשומת ליבכם, השיחה מוקלטת לצורך תיעוד ושיפור השירות. כעת מנסים לחבר אתכם לנציג.';
    // Verbatim — ConsoleInbound.voxengine.js:65. Do not paraphrase.
    var NO_AGENT_LINE_HE = 'אין נציג זמין כרגע. נחזור אליכם בהקדם.';
    // Operational hold line — NOT owner/regulation-authorized wording like
    // the two disclosure/no-agent lines above. Verbatim reuse of
    // ConsoleInbound.voxengine.js's RING_HOLD_LINE_HE (already live in
    // production there), not new compliance-sensitive text. Played once per
    // agent attempted in ringNext (found in a full telephony audit, 13.8):
    // without ANY audio on this leg while ringing, an ANSWERED, RECORDING,
    // BILLING call sits in raw silence for up to RING_PER_AGENT_MS per agent
    // tried — a caller reasonably reads that as a dead line, not "please
    // wait".
    var RING_HOLD_LINE_HE = 'אנא המתינו רגע, מחפשים עבורכם נציג.';
    var ttsOptions = { voice: VoiceList.Google.he_IL_Wavenet_A };
    // Same constant and reasoning as ConsoleInbound.voxengine.js.
    var RING_PER_AGENT_MS = 20000;
    // Leaked-session backstop, NOT a call-length cap — same reasoning as
    // ConsoleDial/ConsoleInbound (ordinary agent-operated calls, not an AI
    // handoff; no reason to cut a genuine customer-service call short).
    var SAFETY_NET_MS = 60 * 60 * 1000;
    var HANGUP_GRACE_MS = 500;
    // Net.httpRequestAsync's own default is 90s total / 6s TCP connect,
    // "value can be only decreased" (typings HttpRequestOptions.timeout,
    // seconds). call-me-now-authorize fires AFTER the visitor leg is
    // answered, recording, and its disclosure has already played — a hung/
    // mid-deploy backend there is real dead air on a live, billing call, and
    // declareNoAgent's own 6s watchdog cannot help because it is never
    // reached until this promise settles. Applied to every gating
    // Net.httpRequestAsync call in this file (found in a full telephony
    // audit, 13.8).
    var GATE_HTTP_TIMEOUT_S = 10;
    var CONSOLE_SECRET = VoxEngine.getSecretValue('KALFA_CONSOLE_SECRET');
    if (!CONSOLE_SECRET) {
        // Unlike ConsoleDial's internal branch, there is no ungated path
        // here either — every call-me-now session needs the authorize gate
        // to ever ring an agent. Logged once, matching ConsoleInbound's own
        // reasoning for its equivalent case.
        Logger.write('[ConsoleCallMeNow] KALFA_CONSOLE_SECRET missing — event reporting is best-effort and will silently skip; authorize will fail closed (no ring, honest no-agent line only)');
    }
    var state = {
        sessionId: (startedEvent && startedEvent.sessionId) || 0,
        // Present on every session regardless of trigger type — same
        // precedent as ConsoleDial.voxengine.js:112-120 /
        // ConsoleInbound.voxengine.js:101-107's identical comment.
        accessUrl: (startedEvent && startedEvent.accessURL) || null,
        accessSecureUrl: (startedEvent && startedEvent.accessSecureURL) || null,
        to: '', // visitor's PSTN number — never logged raw (PII)
        from: '', // KALFA's own callerid, reused as the ring callerid below
        token: '', // the 'cn'-prefixed dial token from customData
        operator: null, // the agent leg once the ring connects — replaceable? no (V1: no transfer)
        agentUsername: '',
        remote: null, // the VISITOR leg — anchor, never replaced, recorded
        recordingUrl: null,
        connectedAt: 0,
        operatorHangupScheduled: false,
        remoteHangupScheduled: false,
        endedReported: false,
        terminated: false,
        globalTimer: null
    };
    function log(msg) {
        Logger.write('[ConsoleCallMeNow] ' + msg);
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
        VoxEngine.terminate();
    }
    // Best-effort lifecycle report — NEVER blocks or throws into the call
    // path. See the file header's "EVENT call_kind CHOICE" note for why the
    // reported call_kind differs between 'started' and every later event —
    // this is the ONLY behavioral difference from ConsoleDial/
    // ConsoleInbound's own identical-shaped reportEvent().
    function reportEvent(eventName, extra) {
        if (!CONSOLE_SECRET)
            return Promise.resolve();
        var body = {
            secret: CONSOLE_SECRET,
            session_id: state.sessionId,
            call_kind: eventName === 'started' ? 'outbound' : 'inbound',
            token: state.token,
            event: eventName
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
            log('event ' + eventName + ' -> ' + (r && r.code));
        }).catch(function (err) {
            log('event ' + eventName + ' failed: ' + err);
        });
    }
    // Exactly ONE 'ended' report per session (idempotent) — same pattern as
    // both other console scenarios.
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
    // Either leg going down brings the whole call down — same pattern as
    // ConsoleDial/ConsoleInbound's identical function, simplified: V1 has no
    // transfer/consult/conference state to unwind (LIVE_CUSTOMER_CALL_KINDS
    // excludes this call kind — see file header).
    function handleLegDown(which, reasonForEnd) {
        if (which === 'operator')
            state.operator = null;
        else
            state.remote = null;
        if (state.operator)
            scheduleOperatorHangup(HANGUP_GRACE_MS);
        if (state.remote)
            scheduleRemoteHangup(HANGUP_GRACE_MS);
        if (!state.operator && !state.remote) {
            reportEndedOnce(reasonForEnd);
            cleanupAndTerminate();
        }
    }
    function attachOperatorTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('operator disconnected: ' + safeStringify(ev));
            handleLegDown('operator', 'operator_hangup');
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('operator failed: ' + safeStringify(ev));
            handleLegDown('operator', 'operator_failed');
        });
    }
    function attachRemoteTerminalHandlers(call) {
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('remote (visitor) disconnected: ' + safeStringify(ev));
            handleLegDown('remote', 'visitor_hangup');
        });
    }
    // ── Live-call command channel (RSVPAgent :701 pattern, reused) ──────────
    // Only call_end is wired — transfer/consult/conference are NOT
    // implemented for this call kind (see file header); an unsupported
    // command is logged and ignored, same defensive default as the other two
    // scenarios' own "unknown command" branch.
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
            else {
                log('command unknown/unsupported: ' + cmd + ' [' + rid + ']');
                return;
            }
            log('command ' + cmd + ' [' + rid + '] applied');
        }
        catch (err) {
            log('command ' + cmd + ' [' + rid + '] failed: ' + err);
        }
    });
    // Last-resort report — same reasoning as both other console scenarios.
    VoxEngine.addEventListener(AppEvents.Terminating, function () {
        if (state.endedReported)
            return;
        log('Terminating with no ended report sent — posting last-resort close');
        reportEndedOnce('session_terminating');
    });
    // Global safety net — same reasoning as both other console scenarios
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
    // Reused near-verbatim from ConsoleInbound.voxengine.js:828-955
    // (ringNext/declareNoAgent) — renamed `callerCall` -> `visitorCall` for
    // this file's own naming, and the wake-and-answer retry step
    // (attemptWakeRetry, ConsoleInbound-only, calls a route
    // — route-inbound-retry — that has no call-me-now equivalent) is
    // deliberately DROPPED: the base case calls declareNoAgent directly. Every
    // other line (the timeout/Connected/Failed handling, the settled guard,
    // the deliberate choice to ring on the KALFA DID rather than expose the
    // visitor's number to the agent leg) is identical in structure and intent.
    function declareNoAgent(visitorCall) {
        log('ring exhausted or authorize refused — no agent');
        reportEndedOnce('no_agent');
        try {
            visitorCall.say(NO_AGENT_LINE_HE, ttsOptions);
        }
        catch (err) {
            log('say failed: ' + err);
        }
        visitorCall.addEventListener(CallEvents.PlaybackFinished, function () {
            scheduleRemoteHangup(0);
        });
        setTimeout(function () {
            scheduleRemoteHangup(0);
        }, 6000);
    }
    function ringNext(visitorCall, ringOrder, idx) {
        if (idx >= ringOrder.length) {
            declareNoAgent(visitorCall);
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
            visitorCall.say(RING_HOLD_LINE_HE, ttsOptions);
        }
        catch (err) {
            log('ring hold line failed: ' + err);
        }
        var username = ringOrder[idx];
        var settled = false;
        // callerid = KALFA's own outbound DID (state.from), NOT the visitor's
        // number — same PII-avoidance reasoning as
        // ConsoleInbound.voxengine.js:898-905's identical choice (display_hint
        // is the intended channel for the agent to see who is on the line, via
        // Realtime/console_calls, not an internal callUser leg).
        var agentCall = VoxEngine.callUser({
            username: username,
            callerid: state.from || 'kalfa-console'
        });
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
            ringNext(visitorCall, ringOrder, idx + 1);
        }, RING_PER_AGENT_MS);
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
                VoxEngine.sendMediaBetween(visitorCall, agentCall);
            }
            catch (err) {
                log('bridge failed: ' + err);
            }
            log('call-me-now connected to an agent');
            reportEvent('connected', { agent: username });
        });
        agentCall.addEventListener(CallEvents.Failed, function (ev) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            log('ring attempt failed for ' + username + ': ' + safeStringify(ev));
            ringNext(visitorCall, ringOrder, idx + 1);
        });
    }
    // ── Ask call-me-now-authorize for a fresh ring, then ring it ─────────────
    // call-me-now-authorize/route.ts:29-33/44-58 — called AFTER the visitor's
    // disclosure PlaybackFinished, never before (the disclosure must never be
    // skipped even if this call ends up refused). `startedReported` is the
    // 'started' report's own promise (always resolves, see reportEvent's
    // .catch) — chaining behind it, not calling in parallel, mirrors
    // ConsoleDial.voxengine.js:1005's identical race protection: authorize's
    // verifyDialToken() nulls dial_token_hash on success, which is exactly
    // what the 'started' report's own Tier-2 session-link
    // (findConsoleCallForEvent) depends on — see this file's header for the
    // full reasoning. In practice 'started' fired seconds earlier here (the
    // visitor had to answer and hear the whole disclosure first), so this is
    // defensive, not load-bearing the way it is for ConsoleDial's back-to-back
    // case — kept anyway since it costs nothing and matches proven precedent.
    function requestAgentAuthorization(visitorCall, startedReported) {
        if (!CONSOLE_SECRET) {
            declareNoAgent(visitorCall);
            return;
        }
        startedReported.then(function () {
            Net.httpRequestAsync(KALFA_APP_ORIGIN + '/api/voximplant/console/call-me-now-authorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: GATE_HTTP_TIMEOUT_S,
                // session_id — lets this route link the session directly to
                // its console_calls row (console-calls.ts's
                // linkConsoleCallSession), independent of whether the
                // 'started' /event report above ever actually landed. MORE
                // load-bearing here than for ConsoleDial's outbound branch:
                // this call kind's later events deliberately claim
                // call_kind:'inbound' (see the file header's own "EVENT
                // call_kind CHOICE" note), so without this direct link
                // nothing downstream can ever correlate them if 'started' is
                // lost. See linkConsoleCallSession's header for the full
                // reasoning.
                postData: safeStringify({ secret: CONSOLE_SECRET, token: state.token, session_id: state.sessionId })
            }).then(function (r) {
                var body = null;
                try {
                    body = JSON.parse(r.text || '{}');
                }
                catch (_e) { }
                var ok = r.code === 200 && !!body && body.ok === true && Array.isArray(body.ring_order);
                if (!ok) {
                    log('authorize refused: code=' + (r && r.code));
                    declareNoAgent(visitorCall);
                    return;
                }
                // An empty ring_order is NOT a refusal (route.ts:49-58) — it
                // falls into ringNext's own idx>=length base case for free,
                // no special branch needed here.
                reportEvent('ringing', { ring_order_len: body.ring_order.length });
                ringNext(visitorCall, body.ring_order, 0);
            }).catch(function (err) {
                log('authorize request failed: ' + err);
                declareNoAgent(visitorCall);
            });
        });
    }
    // ── Entry point — StartScenarios only, no CallAlerting in this file ─────
    function readSessionCustomData() {
        var rawCustomData;
        try {
            rawCustomData = VoxEngine.customData();
        }
        catch (err) {
            log('Failed to read VoxEngine.customData(): ' + err);
            return null;
        }
        if (!rawCustomData)
            return null;
        try {
            return JSON.parse(rawCustomData);
        }
        catch (err) {
            log('Failed to parse customData JSON: ' + err);
            return null;
        }
    }
    // Branch B: tiny payload ({to,from,tok,u}) — same shape and same 200-byte
    // budget already proven by outreach-calls.ts's buildScriptCustomData and
    // used verbatim by Outgoingcall-RSVPAI.voxengine.js:271-288. Unlike that
    // file, `u` (app origin) is read but unused beyond building the two fixed
    // KALFA_APP_ORIGIN-based URLs already in this file — no ctx/cb fetch is
    // needed here (call-me-now-authorize returns everything this scenario
    // needs directly, per verify/route.ts's own header).
    var customData = readSessionCustomData();
    if (!customData || !customData.to || !customData.from || !customData.tok) {
        log('Missing or invalid script_custom_data — terminating');
        VoxEngine.terminate();
        return;
    }
    state.to = String(customData.to);
    state.from = String(customData.from);
    state.token = String(customData.tok);
    // Not blocking the dial below on this settling — see
    // requestAgentAuthorization's own comment for why that is safe here.
    var startedReported = reportEvent('started', {
        access_url: state.accessUrl,
        access_secure_url: state.accessSecureUrl
    });
    var visitorCall = VoxEngine.callPSTN(state.to, state.from);
    state.remote = visitorCall;
    attachRemoteTerminalHandlers(visitorCall);
    visitorCall.addEventListener(CallEvents.RecordStarted, function (ev) {
        state.recordingUrl = (ev && ev.url) || null;
        log('RECORDING_URL captured');
    });
    visitorCall.addEventListener(CallEvents.Connected, function () {
        log('visitor leg connected');
        // Recording FIRST — the disclosure itself must be on tape (same
        // ordering as both other console scenarios).
        try {
            visitorCall.record({ stereo: true });
        }
        catch (err) {
            log('visitor record() failed: ' + err);
        }
        try {
            visitorCall.say(DISCLOSURE_LINE_CALL_ME_NOW_HE, ttsOptions);
        }
        catch (err) {
            log('disclosure say() failed: ' + err);
        }
        // ONE-SHOT. addEventListener does not replace a previous handler: the
        // vendor documents multi-handler fan-out for the same API on the Web
        // SDK ("One event can have more than one handler; handlers are
        // executed in order of their registration",
        // @voximplant/websdk/index.d.ts:1722-1724). The VoxEngine typings
        // state neither way, so for THIS runtime that is INFERRED, not
        // measured — which is exactly why it is guarded rather than reasoned
        // about: declareNoAgent() registers a SECOND PlaybackFinished
        // listener on this same leg, so if the fan-out holds, the no-agent
        // line finishing would re-enter this handler and fire a second,
        // pointless authorize (its token already consumed) plus a duplicate
        // no-agent line. A boolean costs nothing and is correct under both
        // answers. Settle it in the live-call matrix.
        var authorizeRequested = false;
        visitorCall.addEventListener(CallEvents.PlaybackFinished, function () {
            if (authorizeRequested) return;
            authorizeRequested = true;
            requestAgentAuthorization(visitorCall, startedReported);
        });
    });
    visitorCall.addEventListener(CallEvents.Failed, function (ev) {
        // The visitor's own phone never answered (no-answer/busy/unreachable)
        // — nobody ever heard anything, so there is no leg to say anything
        // into. 'guest_failed' is reused verbatim from ConsoleDial's own
        // reason vocabulary (mapEndedReasonToStatus maps it to the 'failed'
        // status, which is more accurate here than the generic 'ended'
        // bucket a novel reason string would fall into).
        log('visitor call failed: ' + safeStringify(ev));
        state.remote = null;
        reportEndedOnce('guest_failed');
        cleanupAndTerminate();
    });
});
