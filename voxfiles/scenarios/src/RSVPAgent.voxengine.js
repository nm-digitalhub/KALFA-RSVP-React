// RSVPAgent — bridge an outbound PSTN call to an ElevenLabs conversational
// agent WITH per-call personalization. PRODUCTION scenario (promoted from
// VoiceAgentTest on kalfatest, 2026-07-20; bound to the kalfa-rsvp application,
// rule OutCallAgent).
//
// It dials the recipient, opens the Hebrew RSVP agent
// (agent_9701kxj3n54ye518a3s518cexd48: language he, eleven_v3_conversational,
// voice Kalfa), injects dynamic variables so the agent's {{guest_name}},
// {{event_name}}, {{event_date}}, {{event_venue}} placeholders resolve, records
// the call, logs transcript events, forwards the agent's client tools
// (save_rsvp / mark_dnc / notify_owner / schedule_callback) to KALFA's
// token-scoped endpoints, reports el_conversation_id via the cb endpoint, and
// posts exactly ONE terminal callback per call (rsvp_method 'agent', no digit:
// completed = conversation ran → billed reach; no_response / no_answer /
// failed otherwise) so the attempt row always closes and billing is per-reached.
//
// Branch B customData ({to, from, tok, u}) — tiny, ≤200-byte cap:
//   * to/from        — dial legs (required).
//   * u (app origin) — used to build the ctx URL (optional; if absent, the call
//                      still runs with empty dynamic variables).
//   * tok            — opaque per-call access token; the scenario fetches
//                      GET {u}/api/voximplant/ctx/{tok} → guest/event fields
//                      (guest_name, event_name, event_date, event_time,
//                      event_venue, event_address, event_celebrants,
//                      event_rsvp_deadline) + kalfa_attempt_token (correlation
//                      nonce). No secret ever sits in customData/call history.
// If ctx fails/404s the scenario logs a warning and proceeds with empty defaults
// — it never drops the call over missing personalization.
//
// The ElevenLabs API key is read from a Voximplant Secret named
// ELEVENLABS_API_KEY via VoxEngine.getSecretValue — NEVER placed in code,
// customData or the log.
//
// --- Dynamic-variable INJECTION TIMING (the load-bearing part) ---
// ElevenLabs' Agents WebSocket protocol: the client MAY send ONE
// `conversation_initiation_client_data` message (carrying dynamic_variables +
// overrides) and it must be the FIRST client message; the server then replies
// with `conversation_initiation_metadata` ("only sent once") and the agent
// generates its first_message. Once metadata arrives the init is locked in —
// injecting on the ElevenLabs.AgentsEvents.ConversationInitiationMetadata event
// would be TOO LATE (that event is the server's acknowledgement that init already
// happened). VoxEngine's createAgentsClient() resolves once the WebSocket is
// open, so we call agent.conversationInitiationClientData(...) SYNCHRONOUSLY, the
// instant the promise resolves — before sendMediaBetween and before attaching the
// transcript listeners — so it is queued as the first client frame.
// (Verified vs ElevenLabs client-to-server-events / personalization docs and
// typings/voxengine.d.ts ~6173: conversationInitiationClientData(parameters:Object):void.)
//
// Symbols verified against typings/voxengine.d.ts (cdn.voximplant.com copy):
//   VoxEngine.customData / callPSTN / terminate / getSecretValue(name):string|undefined
//     (~13353) / sendMediaBetween(u1,u2):void (~13391);
//   Net.HttpRequestOptions / Net.httpRequestAsync (used exactly as in RSVP.voxengine.js);
//   ElevenLabs.createAgentsClient({xiApiKey,agentId,...}):Promise<AgentsClient> (~6327);
//   AgentsClient.conversationInitiationClientData(Object):void (~6173) /
//     close() / addEventListener(event, cb) / id();
//   ElevenLabs.AgentsEvents.UserTranscript / AgentResponse / AgentResponseCorrection /
//     Interruption / WebSocketError (~6197);
//   ElevenLabs.Events.WebSocketMediaStarted / WebSocketMediaEnded (~6351);
//   CallEvents.Connected / RecordStarted(ev.url) / Failed / Disconnected;
//   Call.record(CallRecordParameters).
// The ElevenLabs namespace only exists after its module is required (Modules.ElevenLabs
// = 'elevenlabs', typings ~8360). Without this the scenario throws "ElevenLabs is not
// defined" the moment it reaches createAgentsClient.
require(Modules.ElevenLabs);
// AMD (answering-machine detection) for the voicemail PRE-CONNECT gate. Its
// Modules enum member is MISSING from the bundled typings copy, so require it by
// the resolved value with a fallback to the 'amd' module id, wrapped so a load
// failure can NEVER abort the scenario — the gate is itself fail-open (a missing
// AMD just skips detection and bridges the call).
try {
    require((typeof Modules !== 'undefined' && Modules.AMD) ? Modules.AMD : 'amd');
}
catch (_amdErr) { /* AMD unavailable — runVoicemailGate() will fail open */ }
VoxEngine.addEventListener(AppEvents.Started, function () {
    var AGENT_ID = 'agent_9701kxj3n54ye518a3s518cexd48';
    // Voicemail PRE-CONNECT gate: classify the answered call with Voximplant-native
    // AMD BEFORE opening the ElevenLabs WS (zero credits on a machine). CONFIGURABLE
    // + fail-open. FLAG: there is NO Hebrew/IL AMD model — EU_GENERAL is the only
    // candidate and is UNVALIDATED on +972 voicemail; confidence is advisory. Set
    // VOICEMAIL_GATE_ENABLED=false to disable while tuning.
    var VOICEMAIL_GATE_ENABLED = true;
    var AMD_TIMEOUT_MS = 5000; // ≤20000; only counts after Connected (AMD default 6500)
    // DTMF fallback (Hebrew-ASR safety net): keypad digit → Hebrew intent injected
    // into the conversation via AgentsClient.userMessage (corpus voice-ai-b.md).
    var DTMF_INTENT = {
        '1': 'אני מאשר הגעה',
        '2': 'לא אגיע',
        '0': 'אפשר לחזור אליי מאוחר יותר'
    };
    // Global hard limit — a leaked session bills money. 150s (conversation-design
    // §2.5): a REAL conversational call with one guest question was cut mid-count
    // at 90s (session 6758867554); the timeout is a stuck-session safety net, not
    // a terminator for a healthy conversation.
    var GLOBAL_TIMEOUT_MS = 150000;
    // Grace before hanging up the PSTN leg once the agent has ended the
    // conversation (end_call → ElevenLabs closes the WS → onWebSocketClose). At
    // that instant the whole farewell has been SENT to Voximplant, but the last
    // ~1s may still be draining through the outbound jitter buffer to the PSTN
    // leg — hanging up immediately clips the goodbye. Mirrors RSVP.voxengine.js's
    // scheduleHangup(call, 2000) after its closing say().
    var FAREWELL_GRACE_MS = 2000;
    var state = {
        to: '',
        from: '',
        contextUrl: '',
        guestName: '',
        eventName: '',
        eventDate: '',
        eventVenue: '',
        // The four later-added ctx fields MUST be declared with the same ''
        // default as the four above: they are injected into dynamic_variables
        // unconditionally, and an undeclared field is `undefined` when ctx
        // fails — leaking the string "undefined" into the agent's variables
        // instead of a clean empty value.
        eventTime: '',
        eventAddress: '',
        eventCelebrants: '',
        eventRsvpDeadline: '',
        // NON-authorizing correlation nonce from ctx (ctx.kalfa_attempt_token).
        // Injected as the `kalfa_attempt_token` dynamic variable so ElevenLabs
        // echoes it in the post-call webhook and KALFA links conversation→attempt.
        // Empty-safe: '' when ctx omits it → the agent still runs, just unlinked.
        attemptToken: '',
        agent: null,
        recordingUrl: null,
        // Second link vector (belt-and-suspenders with the token): the ElevenLabs
        // conversation_id, captured from ConversationInitiationMetadata (needs
        // includeConversationId:true) and reported to KALFA's cb endpoint so it is
        // stored on the call_attempt. callbackUrl built from {u}+{tok} like ctx.
        elConversationId: '',
        callbackUrl: '',
        cbConversationSent: false,
        // Terminal-callback state (mirrors RSVP.voxengine.js): exactly ONE
        // terminal cb per call, so KALFA's drain can close the attempt row,
        // bill the reach (rsvp_method 'agent' ⇒ no digit required and the
        // digit-RSVP path is skipped — save_rsvp already wrote real counts),
        // and the reconciler never alert-floods on stuck rows.
        callbackSent: false,
        callWasConnected: false,
        // True once the ElevenLabs bridge actually carried the conversation
        // (media started / init metadata) — decides completed vs no_response.
        conversationStarted: false,
        connectedAt: 0,
        // Speech-probability high-water mark (VadScore) — a rough silence / no-
        // answer signal logged at teardown. 0 ⇒ the agent never detected speech.
        maxVadScore: 0,
        // The agent's own voicemail_detection system tool fired. This is the
        // SECOND line of defence: the AMD gate above runs pre-connect and is
        // explicitly UNVALIDATED on +972 voicemail, so when it fails open the
        // agent still ends up talking to a machine. Without this flag that call
        // reaches Disconnected with conversationStarted=true and closes as
        // 'completed' — which writeReach bills as a reached human.
        voicemailDetected: false,
        // DTMF debounce: ignore a repeat of the SAME digit within 1.5s (idempotent).
        lastTone: '',
        lastToneAt: 0,
        globalTimer: null,
        // Terminal-hangup guard (agent ended the conversation) — idempotent so a
        // WS close + a racing timeout can't schedule two hangups.
        hangupScheduled: false,
        hangupTimer: null,
        terminated: false
    };
    function log(msg) {
        Logger.write('[RSVPAgent] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_e) {
            return String(value);
        }
    }
    // Single owner of teardown — closes the agent WebSocket (if any) and ends the
    // session exactly once. Every terminal path funnels through here.
    function cleanupAndTerminate() {
        if (state.terminated)
            return;
        state.terminated = true;
        if (state.globalTimer) {
            clearTimeout(state.globalTimer);
            state.globalTimer = null;
        }
        if (state.hangupTimer) {
            clearTimeout(state.hangupTimer);
            state.hangupTimer = null;
        }
        try {
            if (state.agent) {
                state.agent.close();
            }
        }
        catch (err) {
            log('agent.close() failed: ' + err);
        }
        // Silence/no-answer diagnostic: 0 ⇒ the agent never heard speech.
        log('maxVadScore=' + state.maxVadScore);
        VoxEngine.terminate();
    }
    // Terminal hangup of the PSTN leg after the agent ends the conversation
    // (onWebSocketClose). Guarded + idempotent; bails once teardown has begun so a
    // WS close triggered by our own agent.close() never schedules a stray hangup.
    // After the grace delay call.hangup() fires CallEvents.Disconnected, which
    // funnels into cleanupAndTerminate — so this never calls terminate() itself
    // except as a fallback when hangup() throws (mirrors RSVP.voxengine.js).
    function scheduleHangup(call, delayMs) {
        if (state.terminated || state.hangupScheduled)
            return;
        state.hangupScheduled = true;
        state.hangupTimer = setTimeout(function () {
            try {
                call.hangup();
            }
            catch (err) {
                log('call.hangup() failed: ' + err);
                // Disconnected will never fire on this path — close the attempt
                // row here so it cannot stick pre-terminal.
                postFinalCallbackOnce({
                    call_status: terminalStatus(),
                    call_duration: state.connectedAt
                        ? Math.round((Date.now() - state.connectedAt) / 1000)
                        : 0
                }, function () {
                    cleanupAndTerminate();
                });
            }
        }, delayMs);
    }
    // POST one JSON payload to KALFA's cb endpoint (best-effort, never blocks
    // teardown). Mirrors RSVP.voxengine.js's postCallback.
    function postCallback(payload, done) {
        if (!state.callbackUrl) {
            if (done)
                done();
            return;
        }
        log('POST callback: ' + safeStringify(payload));
        Net.httpRequestAsync(state.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            postData: safeStringify(payload)
        }).then(function (r) {
            log('Callback response: ' + (r && r.code));
            if (done)
                done();
        }).catch(function (err) {
            log('Callback failed: ' + err);
            if (done)
                done();
        });
    }
    // The ONE terminal-status rule, shared by all three teardown paths (failed
    // hangup, global timeout, Disconnected). It was duplicated three times; a
    // rule that must not be added to only two of three places does not get to
    // live in three places.
    //
    // Order matters. Voicemail is tested FIRST: a machine greeting starts media,
    // which sets conversationStarted, so testing that first would bill every
    // voicemail the AMD gate let through as a reached human.
    //
    //   no_answer   — never connected, OR a voicemail. A machine is not a reached
    //                 human; identical to what the pre-connect AMD gate posts.
    //   no_response — answered, but the bridge never carried a conversation.
    //   completed   — a real conversation ran. THIS is the status writeReach
    //                 bills as a reached contact.
    function terminalStatus() {
        if (state.voicemailDetected)
            return 'no_answer';
        if (state.conversationStarted)
            return 'completed';
        return state.callWasConnected ? 'no_response' : 'no_answer';
    }
    // Exactly ONE terminal callback per call (idempotent — a racing Failed +
    // Disconnected or timeout can never double-post). No transcript is sent:
    // the agent path is metadata-only; conversation QA arrives via the separate
    // ElevenLabs post-call webhook.
    function postFinalCallbackOnce(payload, done) {
        if (state.callbackSent) {
            if (done)
                done();
            return;
        }
        state.callbackSent = true;
        payload.rsvp_method = 'agent';
        payload.recording_url = state.recordingUrl || null;
        if (state.elConversationId) {
            payload.el_conversation_id = state.elConversationId;
        }
        postCallback(payload, done);
    }
    // Report the captured ElevenLabs conversation_id to KALFA's EXISTING cb
    // endpoint (persist-then-process; identity resolved server-side from the token
    // in the URL, never the body). Sent ONCE, as an additive field on a
    // recording_started callback — the cb schema requires a call_status, and
    // recording_started is the natural non-terminal "call is live" signal that
    // does not drive RSVP/billing. Best-effort: a failure never affects the call
    // (the pre-call token nonce remains the PRIMARY link vector).
    function reportConversationId() {
        if (!state.callbackUrl || state.cbConversationSent || !state.elConversationId)
            return;
        state.cbConversationSent = true;
        var body = {
            call_status: 'recording_started',
            el_conversation_id: state.elConversationId,
            recording_url: state.recordingUrl || null
        };
        Net.httpRequestAsync(state.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            postData: safeStringify(body)
        }).then(function (r) {
            log('cb el_conversation_id -> ' + (r && r.code));
        }).catch(function (err) {
            log('cb el_conversation_id failed: ' + err);
        });
    }
    // --- customData ({to, from, tok, u}) ---
    var raw;
    try {
        raw = VoxEngine.customData();
        log('raw customData: ' + raw);
    }
    catch (err) {
        log('Failed to read VoxEngine.customData(): ' + err);
        VoxEngine.terminate();
        return;
    }
    var customData = null;
    if (raw) {
        try {
            customData = JSON.parse(raw);
        }
        catch (err) {
            log('Failed to parse customData JSON: ' + err);
        }
    }
    if (!customData) {
        log('No/invalid script_custom_data. Start with {to, from, tok, u}.');
        VoxEngine.terminate();
        return;
    }
    state.to = customData.to || '';
    state.from = customData.from || '';
    if (!state.to || !state.from) {
        log('Missing required customData fields (to/from): ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    // tok + u are optional here: without them the wiring test still runs, just
    // with empty dynamic variables. When present, build the token-gated ctx URL.
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    if (appOrigin && accessToken) {
        state.contextUrl = appOrigin + '/api/voximplant/ctx/' + accessToken;
        state.callbackUrl = appOrigin + '/api/voximplant/cb/' + accessToken;
    }
    else {
        log('No tok/u in customData — proceeding with empty dynamic variables.');
    }
    // --- ElevenLabs API key from Voximplant Secret (never logged) ---
    var key = VoxEngine.getSecretValue('ELEVENLABS_API_KEY');
    if (!key) {
        // getSecretValue returns undefined when the secret is missing in THIS
        // application's scope — the secret must exist on the application this
        // scenario is bound to (kalfa-rsvp in production; kalfatest for tests).
        // The callbackUrl is already built at this point, so CLOSE THE ATTEMPT
        // before terminating: without it a missing/rotated secret leaves the
        // row pre-terminal forever (never dialed, never retried, and the
        // reconciler alert-floods on it) — the same stuck-row class the
        // terminal-callback work fixed everywhere else.
        log('SECRET MISSING — add the ELEVENLABS_API_KEY secret to this application');
        postFinalCallbackOnce({
            call_status: 'failed',
            call_duration: 0
        }, function () {
            VoxEngine.terminate();
        });
        return;
    }
    // Global safety net: close the session even if every other path is stuck.
    // Post the terminal callback FIRST so the attempt row still closes (a cut
    // conversation is still a reached human; a session that never bridged is not).
    state.globalTimer = setTimeout(function () {
        log('Global timeout reached — closing.');
        var duration = state.connectedAt
            ? Math.round((Date.now() - state.connectedAt) / 1000)
            : 0;
        postFinalCallbackOnce({
            call_status: terminalStatus(),
            call_duration: duration
        }, function () {
            cleanupAndTerminate();
        });
    }, GLOBAL_TIMEOUT_MS);
    // Places the outbound call and wires the ElevenLabs bridge. Called only after
    // the ctx fetch settles (success or failure) so the dynamic variables are known
    // by the time the agent connects.
    function proceedToDial() {
        if (state.terminated)
            return;
        log('Creating PSTN call to recipient (guest="' + state.guestName +
            '", event="' + state.eventName + '")');
        var call = VoxEngine.callPSTN(state.to, state.from);
        // Record so the exchange can be reviewed; URL logged for a Management-API pull.
        call.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = (ev && ev.url) || null;
            log('RECORDING_URL: ' + state.recordingUrl);
        });
        // VOICEMAIL PRE-CONNECT GATE (Voximplant-native AMD). Runs AMD on the
        // answered call and only SKIPS the ElevenLabs bridge on a confident
        // VOICEMAIL — every other outcome (HUMAN, TIMEOUT, CALL_ENDED, any error,
        // AMD unavailable) FAILS OPEN to onHuman so a real person is never dropped.
        // Corpus vox-ref-callflow.md §2 + typings AMD.*: AMD.create({model,timeout})
        // → sendMediaTo(amd) → detect():Promise<DetectionComplete|DetectionError>;
        // ResultClass = HUMAN|VOICEMAIL|TIMEOUT|CALL_ENDED. NO Hebrew model —
        // EU_GENERAL only, UNVALIDATED on +972; confidence advisory. Zero ElevenLabs
        // cost when a machine is caught (we never open the WS).
        function runVoicemailGate(call, onHuman) {
            if (!VOICEMAIL_GATE_ENABLED || typeof AMD === 'undefined' || !AMD.create) {
                if (VOICEMAIL_GATE_ENABLED)
                    log('AMD unavailable — gate disabled, bridging');
                onHuman();
                return;
            }
            var amd = null;
            var decided = false;
            function decide(bridge, why) {
                if (decided)
                    return;
                decided = true;
                try {
                    if (amd)
                        call.stopMediaTo(amd);
                }
                catch (_e) { }
                if (bridge) {
                    log('AMD gate: ' + why + ' → bridging');
                    onHuman();
                }
                else {
                    log('AMD gate: ' + why + ' → machine, NOT bridging (0 EL cost), hanging up');
                    // A voicemail is NOT a reached human: close the attempt as
                    // no_answer (no billing) before dropping the line.
                    postFinalCallbackOnce({
                        call_status: 'no_answer',
                        call_duration: 0
                    }, function () {
                        scheduleHangup(call, 0);
                    });
                }
            }
            try {
                amd = AMD.create({ model: AMD.Model.EU_GENERAL, timeout: AMD_TIMEOUT_MS });
                call.sendMediaTo(amd);
            }
            catch (err) {
                log('AMD setup failed: ' + err + ' — failing open');
                decide(true, 'setup_error');
                return;
            }
            amd.detect().then(function (ev) {
                var rc = ev && ev.resultClass;
                log('AMD result: class=' + rc + ' subtype=' + (ev && ev.resultSubtype) +
                    ' confidence=' + (ev && ev.confidence != null ? ev.confidence : '?'));
                // ONLY a positive VOICEMAIL skips the bridge; everything else opens.
                decide(rc !== AMD.ResultClass.VOICEMAIL, rc || 'unknown');
            }).catch(function (err) {
                log('AMD detect error: ' + err + ' — failing open');
                decide(true, 'detect_error');
            });
            // Watchdog: never let the gate itself stall the call. If detect() neither
            // resolves nor rejects within timeout + margin, force-bridge.
            setTimeout(function () { decide(true, 'gate_watchdog'); }, AMD_TIMEOUT_MS + 2000);
        }
        call.addEventListener(CallEvents.Connected, function () {
            log('Call connected');
            state.callWasConnected = true;
            state.connectedAt = Date.now();
            // stereo:true splits guest (left) and agent (right); hd_audio:true gives a
            // 48kHz mp3. No cb is sent — the URL is only written to the log.
            try {
                call.record({ stereo: true, hd_audio: true });
            }
            catch (err) {
                log('call.record() failed: ' + err);
            }
            // DTMF fallback (Hebrew-ASR safety net): enable keypad tones and map each
            // digit to a Hebrew intent, injected into the ElevenLabs conversation via
            // AgentsClient.userMessage({text}) (corpus voice-ai-b.md line 48; typings
            // 6189). handleTones is required for ToneReceived (typings 3709/3135).
            // Guards on a live agent + debounces a repeated digit (idempotent).
            call.handleTones(true);
            call.addEventListener(CallEvents.ToneReceived, function (ev) {
                var digit = ev && ev.tone;
                var text = DTMF_INTENT[digit];
                log('TONE ' + digit + (text ? ' -> inject' : ' (ignored)'));
                if (!text || !state.agent || state.terminated)
                    return;
                var now = Date.now();
                if (state.lastTone === digit && (now - state.lastToneAt) < 1500)
                    return; // ignore a repeat of the same digit within 1.5s
                state.lastTone = digit;
                state.lastToneAt = now;
                try {
                    state.agent.userMessage({ text: text });
                }
                catch (err) {
                    log('userMessage failed: ' + err);
                }
            });
            // ── Live-call command channel ────────────────────────────────────
            // KALFA POSTs a command envelope to this session's managing URL
            // (media_session_access_secure_url, returned by StartScenarios and
            // stored server-side); the platform raises AppEvents.HttpRequest here
            // with the body in e.content. Source of the envelope shape:
            // src/lib/validation/agent-console.ts (CommandEnvelope).
            //
            // There is NO reply: _HttpRequestEvent carries only method/path/content/
            // headers and the namespace exposes no response API, so the caller
            // learns nothing beyond "the POST returned 200". That is exactly why
            // the route answers applied:'pending' — a real acknowledgement has to
            // travel back out-of-band, which is the next phase, not this one.
            //
            // Trust: the managing URL is a capability held only by our backend and
            // never exposed to a client, so arrival here is the authorization. We
            // still validate the shape, ignore unknown commands, and never log the
            // whisper text (it is guest-facing conversation content).
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
                // Once teardown has begun nothing is actionable.
                if (state.terminated) {
                    log('command ' + cmd + ' [' + rid + '] ignored — session terminated');
                    return;
                }
                // The four AI commands need a live agent leg; call_end does NOT.
                // Hanging up must still work after close_agent dropped the agent —
                // that is precisely when an operator reaches for it.
                if (cmd !== 'call_end' && !state.agent) {
                    log('command ' + cmd + ' [' + rid + '] ignored — no live agent');
                    return;
                }
                var text = env && env.payload && env.payload.text;
                try {
                    if (cmd === 'contextual_update') {
                        // Non-interrupting: enters conversation history, is NOT spoken.
                        if (!text)
                            return;
                        state.agent.contextualUpdate({ text: text });
                    }
                    else if (cmd === 'user_message') {
                        // Injects a user turn — DOES interrupt the agent mid-sentence.
                        if (!text)
                            return;
                        state.agent.userMessage({ text: text });
                    }
                    else if (cmd === 'clear_buffer') {
                        // One-shot barge-in: drops buffered TTS already queued out.
                        state.agent.clearMediaBuffer();
                    }
                    else if (cmd === 'close_agent') {
                        // Closes the AI leg only. The PSTN call stays up — ending the
                        // call is a separate route, deliberately not a command here.
                        state.agent.close();
                    }
                    else if (cmd === 'call_end') {
                        // Operator hangup (POST /api/calls/{id}/end). Goes through
                        // scheduleHangup like every other terminal path so
                        // Disconnected fires and postFinalCallbackOnce closes the
                        // attempt row. Calling VoxEngine.terminate() here instead
                        // would end the call and leave the row stuck pre-terminal —
                        // the stale-row state that had to be cleaned by hand on
                        // 2026-07-21. Short grace so audio already queued out drains.
                        scheduleHangup(call, 500);
                    }
                    else {
                        log('command unknown: ' + cmd + ' [' + rid + ']');
                        return;
                    }
                    // Text is never logged — only which command and its correlation id.
                    log('command ' + cmd + ' [' + rid + '] applied');
                }
                catch (err) {
                    log('command ' + cmd + ' [' + rid + '] failed: ' + err);
                }
            });
            // The ElevenLabs bridge, wrapped so the voicemail gate can DEFER it until
            // AMD confirms a human (zero ElevenLabs cost on a machine).
            function bridgeAgent() {
                if (state.terminated)
                    return;
            // Build the ElevenLabs Agents client (opens a WebSocket to 11labs) and bridge
            // it to the call. createAgentsClient is async — await it, then bind media.
            ElevenLabs.createAgentsClient({
                xiApiKey: key,
                agentId: AGENT_ID,
                // Surface the ElevenLabs conversation_id in the initiation metadata
                // (default is off). NOTE: with this on, the conversation_signature is
                // single-use — fine here, the connector opens exactly one WS.
                includeConversationId: true,
                // TERMINAL SIGNAL (the fix): when the agent invokes the built-in
                // end_call system tool, ElevenLabs plays the farewell then CLOSES the
                // WebSocket (docs: end_call system tool / "End conversation and close
                // WebSocket"). This callback is the connector-surfaced close — there
                // is no conversation-end event in AgentsEvents, and end_call is a
                // server-side system tool, not a ClientToolCall. Hang up the PSTN leg
                // (after a grace so the buffered goodbye finishes) instead of leaving
                // dead air until the 150s global timeout. Fires for ANY close (agent
                // end OR a dropped WS) — hanging up is correct in both cases.
                onWebSocketClose: function (event) {
                    log('AGENT_WS_CLOSED code=' + (event && event.code) +
                        ' clean=' + (event && event.wasClean) +
                        ' reason=' + (event && event.reason));
                    scheduleHangup(call, FAREWELL_GRACE_MS);
                }
            }).then(function (agent) {
                if (state.terminated) {
                    // Call already ended while the client was connecting — don't leak it.
                    try {
                        agent.close();
                    }
                    catch (_e) { }
                    return;
                }
                state.agent = agent;
                log('ElevenLabs AgentsClient created: ' + agent.id());
                // CRITICAL ORDERING: inject per-call dynamic variables as the FIRST
                // client frame, synchronously, before binding media / listeners. This
                // must reach 11labs before it emits conversation_initiation_metadata and
                // generates the first_message, otherwise {{guest_name}} etc. resolve
                // empty. (See the timing note at the top of this file.)
                try {
                    agent.conversationInitiationClientData({
                        dynamic_variables: {
                            guest_name: state.guestName,
                            event_name: state.eventName,
                            event_date: state.eventDate,
                            event_venue: state.eventVenue,
                            event_time: state.eventTime,
                            event_address: state.eventAddress,
                            event_celebrants: state.eventCelebrants,
                            event_rsvp_deadline: state.eventRsvpDeadline,
                            // Round-trips in the post-call webhook's
                            // conversation_initiation_client_data.dynamic_variables
                            // → KALFA links conversation → call_attempt (item 2).
                            kalfa_attempt_token: state.attemptToken
                        }
                    });
                    log('Injected dynamic_variables');
                }
                catch (err) {
                    log('conversationInitiationClientData failed: ' + err);
                }
                // Two-way audio bridge (verified: sendMediaBetween binds BOTH directions,
                // so no extra agent.sendMediaTo(call) is required).
                VoxEngine.sendMediaBetween(call, agent);
                // --- transcript / lifecycle logging ---
                agent.addEventListener(ElevenLabs.AgentsEvents.UserTranscript, function (e) {
                    log('USER: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentResponse, function (e) {
                    log('AGENT: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentResponseCorrection, function (e) {
                    log('AGENT_CORRECTION: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.Interruption, function (e) {
                    log('INTERRUPTION: ' + safeStringify(e && e.data));
                    // Barge-in was broken by OMISSION: we listened and only logged, so
                    // agent TTS already buffered kept draining to the PSTN leg after the
                    // guest started talking — the caller hears the agent talk over them.
                    // clearMediaBuffer() is the documented pattern and is declared on
                    // AgentsClient itself (voxengine.d.ts class AgentsClient ~3917/3950,
                    // present in both our pinned 7.51.0 and the live CDN typings).
                    // Guarded: an older connector build without the method must not throw
                    // inside an event handler and kill the call.
                    try {
                        if (agent && typeof agent.clearMediaBuffer === 'function') {
                            agent.clearMediaBuffer();
                            log('INTERRUPTION: media buffer cleared');
                        }
                    }
                    catch (err) {
                        log('clearMediaBuffer failed: ' + err);
                    }
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.WebSocketError, function (e) {
                    log('AGENT_WS_ERROR: ' + safeStringify(e && e.data));
                });
                // Conversation start metadata — carries the ElevenLabs conversation_id
                // when includeConversationId:true (item-2 second link vector). Extract
                // it defensively (the id may sit under conversation_initiation_metadata_event
                // or at the payload root depending on protocol version) and report it to
                // KALFA's cb endpoint. This is the server's ack that init is locked in —
                // the dynamic_variables were already sent above (correct ordering).
                agent.addEventListener(ElevenLabs.AgentsEvents.ConversationInitiationMetadata, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var meta = payload.conversation_initiation_metadata_event || payload;
                    var convId = meta.conversation_id || payload.conversation_id || '';
                    state.conversationStarted = true;
                    if (convId) {
                        state.elConversationId = String(convId);
                        log('CONVERSATION_ID captured');
                        reportConversationId();
                    }
                    else {
                        log('ConversationInitiationMetadata without a conversation_id');
                    }
                });
                // VadScore (0..1 speech probability) — track the high-water mark as a
                // rough silence / no-answer signal. Do NOT log every frame (floods the
                // session log); the max is logged once at teardown.
                agent.addEventListener(ElevenLabs.AgentsEvents.VadScore, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var scoreEv = payload.vad_score_event || payload;
                    var score = Number(scoreEv.vad_score);
                    if (!isNaN(score) && score > state.maxVadScore) {
                        state.maxVadScore = score;
                    }
                });
                // Ping — health check. The VoxEngine ElevenLabs connector auto-responds
                // (there is NO pong/respond method on AgentsClient in the typings), so we
                // only OBSERVE it; no manual pong is possible or required.
                agent.addEventListener(ElevenLabs.AgentsEvents.Ping, function () {
                    log('PING (auto-handled by connector)');
                });
                // Media-stream lifecycle (audio actually flowing / 1s silence tail).
                agent.addEventListener(ElevenLabs.Events.WebSocketMediaStarted, function () {
                    log('AGENT_MEDIA_STARTED');
                    state.conversationStarted = true;
                });
                agent.addEventListener(ElevenLabs.Events.WebSocketMediaEnded, function () {
                    log('AGENT_MEDIA_ENDED');
                });
                // SYSTEM-tool observer. The four built-in tools enabled on the agent
                // (end_call / language_detection / skip_turn / voicemail_detection)
                // execute INSIDE ElevenLabs — they never arrive as ClientToolCall, so
                // without this handler the scenario is blind to them. The agent's
                // client_events already includes 'agent_tool_response', so the signal
                // was being sent and dropped.
                //
                // voicemail_detection is the one that costs money. The AMD gate runs
                // pre-connect and its own comment flags EU_GENERAL as UNVALIDATED on
                // +972 voicemail; when it fails open, the agent talks to a machine,
                // the machine's beep and greeting start media, and Disconnected sees
                // conversationStarted=true → 'completed' → writeReach bills it as a
                // reached human. Recording it here lets teardown close the attempt the
                // same way the AMD gate already does: no_answer, not billed.
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentToolResponse, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var atr = payload.agent_tool_response || payload;
                    var name = atr.tool_name || '';
                    var isErr = atr.is_error === true;
                    // is_called / is_blocked are REQUIRED fields on this message that
                    // it would be easy to ignore. ElevenLabs does not document what
                    // is_error holds when a call is BLOCKED rather than executed, and
                    // "blocked" is plausibly not an "error" — so is_error alone can
                    // report false for a tool that never actually ran. Acting on that
                    // would mark a real human as voicemail and UNDER-bill a genuine
                    // reach: the opposite error, and the one that silently loses money.
                    //
                    // Absent (older connector build) is treated as executed, so this
                    // hardening can never quietly disable the detection itself; only an
                    // EXPLICIT negative signal suppresses it.
                    var executed = atr.is_called !== false && atr.is_blocked !== true;
                    log('AGENT_TOOL_RESPONSE: ' + name + ' type=' + (atr.tool_type || '?') +
                        ' is_error=' + isErr + ' is_called=' + atr.is_called +
                        ' is_blocked=' + atr.is_blocked);
                    // Only a SUCCESSFUL, ACTUALLY-EXECUTED detection reclassifies the
                    // call. A failed or blocked invocation proves nothing about who
                    // answered, and guessing 'machine' there would under-bill a real
                    // conversation.
                    if (name === 'voicemail_detection' && !isErr && executed) {
                        state.voicemailDetected = true;
                        log('voicemail detected by the agent — call will close as no_answer (not billed)');
                    }
                });
                // Client-tool router (conversation-design §4.2). Each tool maps to a
                // token-scoped KALFA endpoint (this scenario already holds tok + u —
                // no secret in the payload). The endpoint's THREE-STATE body decides
                // the result string, so the agent only claims success ("נרשם") when
                // the write actually landed, and hears the truth when the server
                // REFUSED (live failure 6875455354: server said rejected, the old
                // binary ok-mapping collapsed it to 'queued', and the agent told the
                // guest "נרשם"). Unknown tools are ignored (never fabricate).
                //   save_rsvp    → agent-tool/rsvp  → saved | rejected | queued
                //   mark_dnc     → agent-tool/dnc   → removed | queued
                //   notify_owner → agent-tool/note  → noted | queued
                var TOOL_ROUTES = {
                    save_rsvp: {
                        path: 'rsvp',
                        // No okResult: save_rsvp replies via the three-state
                        // pass-through below, never the generic boolean mapping.
                        body: function (args) {
                            return {
                                status: (args.status === 'attending' || args.status === 'declined' || args.status === 'maybe')
                                    ? args.status
                                    : (args.attending ? 'attending' : 'declined'),
                                adults: Number(args.adults) || 0,
                                children: Number(args.children) || 0
                            };
                        }
                    },
                    mark_dnc: {
                        path: 'dnc',
                        okResult: 'removed',
                        body: function () { return {}; }
                    },
                    notify_owner: {
                        path: 'note',
                        okResult: 'noted',
                        body: function (args) {
                            return {
                                kind: (args.kind === 'question' || args.kind === 'message' || args.kind === 'flag')
                                    ? args.kind
                                    : 'message',
                                text: String(args.text || '').slice(0, 500)
                            };
                        }
                    }
                };
                agent.addEventListener(ElevenLabs.AgentsEvents.ClientToolCall, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var ctc = payload.client_tool_call || payload;
                    var toolName = ctc.tool_name || ctc.name;
                    var toolCallId = ctc.tool_call_id || ctc.id;
                    var args = ctc.parameters || ctc.arguments || {};
                    log('CLIENT_TOOL_CALL: ' + safeStringify(payload));
                    // ElevenLabs REQUIRES is_error on the client-tool-result frame —
                    // omitting it closes the WebSocket with 1008 (policy violation),
                    // killing the call right after the tool (verified live, session
                    // 6760041670). is_error=false = handled (saved/queued/removed/
                    // noted); true = the tool could not run at all.
                    function reply(result, isError) {
                        try {
                            agent.clientToolResult({
                                tool_call_id: toolCallId,
                                result: result,
                                is_error: isError === true
                            });
                        }
                        catch (err) {
                            log('clientToolResult failed: ' + err);
                        }
                    }
                    if (!appOrigin || !accessToken) {
                        log(toolName + ' called but no tok/u — cannot persist');
                        reply('error', true);
                        return;
                    }
                    // schedule_callback (combination feature): the agent asked to be
                    // called back later. Reported to the EXISTING cb endpoint as an
                    // additive {call_status:'callback_requested', callback_when_text,
                    // callback_iso?}. cb persists it OUT-OF-BAND (not via the drain, so
                    // it never becomes a call_attempts.status). Best-effort; the agent
                    // gets a truthful 'noted'/'queued'. Actual re-dispatch is a KALFA
                    // follow-up (the dispatcher must re-enqueue — flagged).
                    if (toolName === 'schedule_callback') {
                        if (!state.callbackUrl) {
                            reply('error', true);
                            return;
                        }
                        var cbBody = {
                            call_status: 'callback_requested',
                            callback_when_text: String(args.callback_when_text || args.when || '').slice(0, 200)
                        };
                        var whenIso = String(args.callback_iso || args.when_iso || '');
                        if (whenIso)
                            cbBody.callback_iso = whenIso.slice(0, 40);
                        Net.httpRequestAsync(state.callbackUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            postData: safeStringify(cbBody)
                        }).then(function (r) {
                            log('schedule_callback -> ' + (r && r.code));
                            reply(r.code === 200 ? 'noted' : 'queued', false);
                        }).catch(function (err) {
                            log('schedule_callback failed: ' + err);
                            reply('error', true);
                        });
                        return;
                    }
                    var route = TOOL_ROUTES[toolName];
                    if (!route) {
                        return; // unknown tool — ignore (never fabricate a result)
                    }
                    var postBody = route.body(args);
                    postBody.tool_call_id = toolCallId;
                    Net.httpRequestAsync(appOrigin + '/api/voximplant/agent-tool/' + route.path + '/' + accessToken, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        postData: safeStringify(postBody)
                    }).then(function (r) {
                        var body = null;
                        try {
                            body = JSON.parse(r.text || '{}');
                        }
                        catch (_e) { }
                        var ok = r.code === 200 && !!body && body.ok === true;
                        var status = body && typeof body.status === 'string' ? body.status : null;
                        log(toolName + ' -> ' + (r && r.code) + ' ok=' + ok +
                            (status ? ' status=' + status : ''));
                        // A non-200 means the request was REJECTED BEFORE anything
                        // was persisted (guard rate-limit/expired token → 404/429,
                        // or Zod refusing the body → 400): there is no inbox row,
                        // so nothing will ever be retried. Reporting 'queued' there
                        // would be the same false promise the three-state contract
                        // exists to kill — say 'error' so the agent uses its
                        // tool-failure wording instead of implying a pending save.
                        // is_error stays FALSE: the WS must survive (E-12).
                        if (r.code !== 200) {
                            reply('error', false);
                            return;
                        }
                        if (toolName === 'save_rsvp') {
                            // THREE-STATE pass-through (server contract:
                            // {ok, status: 'saved'|'rejected'|'queued'}).
                            //   saved    — applied; the agent may say "נרשם".
                            //   rejected — the server REFUSED on business grounds
                            //              (event closed/past). Terminal. The agent
                            //              must be honest, never claim success.
                            //   queued   — transient; durably retried by the drain.
                            // ALL THREE are outcomes of a tool that RAN — so
                            // is_error:false for each (E-12: is_error true/missing
                            // closes the WebSocket with 1008 immediately, killing
                            // the call before the honest sentence can be spoken).
                            var result = (status === 'saved' || status === 'rejected' || status === 'queued')
                                ? status
                                : 'queued';
                            reply(result, false);
                            return;
                        }
                        // Other tools keep the boolean contract ({ok} only).
                        // 'queued' is not an error (durably persisted; agent softens
                        // wording) — is_error=false so the WS stays open either way.
                        reply(ok ? route.okResult : 'queued', false);
                    }).catch(function (err) {
                        log(toolName + ' request failed: ' + err);
                        reply('error', true);
                    });
                });
            }).catch(function (err) {
                log('createAgentsClient failed: ' + err);
                // The bridge never opened — close the attempt as failed (not
                // billed) BEFORE dropping the line, so the row never sticks.
                postFinalCallbackOnce({
                    call_status: 'failed',
                    call_duration: 0
                }, function () {
                    try {
                        call.hangup();
                    }
                    catch (_e) { }
                    cleanupAndTerminate();
                });
            });
            } // end bridgeAgent
            // Gate the bridge on AMD (fail-open). HUMAN → bridgeAgent(); VOICEMAIL →
            // hang up without ever opening the ElevenLabs WS.
            runVoicemailGate(call, bridgeAgent);
        });
        // A failed dial is NOT one outcome — the SIP code is a real disposition,
        // and collapsing every code into 'failed' throws away the only signal
        // that distinguishes "try again tomorrow" from "this number is wrong".
        // Classify by ev.code (a NUMBER); never by ev.reason — a live +972 call
        // returned code 408 with reason:"" (session 6885681848), so the text
        // field is not populated by our carriers and string matching would fail
        // silently.
        //   408 timeout / 486 busy / 480 unavailable → no_answer  (retryable)
        //   603 declined                             → no_response (they saw it and refused)
        //   404 / 484 bad number                     → failed      (never retry; fix the list)
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            var code = (ev && typeof ev.code === 'number') ? ev.code : 0;
            var status;
            if (code === 404 || code === 484) {
                status = 'failed';
            }
            else if (code === 603) {
                status = 'no_response';
            }
            else if (code === 408 || code === 486 || code === 480 || code === 487) {
                status = 'no_answer';
            }
            else {
                status = 'failed';
            }
            postFinalCallbackOnce({
                call_status: status,
                call_duration: 0,
                error_reason: 'sip_' + code
            }, function () {
                cleanupAndTerminate();
            });
        });
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('Call disconnected: ' + safeStringify(ev));
            var duration = ev && ev.duration ? ev.duration : 0;
            if (!state.callbackSent) {
                // completed = the ElevenLabs conversation actually ran (billed as a
                // reached human — the RSVP itself was already written by save_rsvp);
                // no_response = answered but the bridge never carried a conversation;
                // no_answer = never even connected.
                postFinalCallbackOnce({
                    call_status: terminalStatus(),
                    call_duration: duration
                }, function () {
                    cleanupAndTerminate();
                });
                return;
            }
            cleanupAndTerminate();
        });
    }
    // --- fetch ctx (guest/event) BEFORE dialing, then proceed either way ---
    if (!state.contextUrl) {
        proceedToDial();
        return;
    }
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                // Raw values — ElevenLabs runs its own TTS, so no speech
                // normalization (unlike the say()-based RSVP scenario).
                //
                // PRONUNCIATION HYPOTHESIS TEST (A.2, scenario-side only, no DB
                // touch): the live call heard "זהבה" as "זה אבא" (dropped medial
                // /h/ + lost final stress). Docs say phoneme/IPA is unreliable on
                // eleven_v3_conversational; the scalable fix is injecting a
                // niqqud-vocalized name — but whether ElevenLabs Hebrew HONORS
                // niqqud is UNVERIFIED (proven only for Google he-IL say()).
                // This one-entry map is the minimal falsifier: if the next call
                // says "Zehava" correctly, we build the auto-niqqud ctx pipeline;
                // if not, we fall back to an alias dictionary.
                var NIQQUD_TEST_MAP = { 'זהבה': 'זְהָבָה' };
                state.guestName = ctx.guest_name || '';
                if (NIQQUD_TEST_MAP[state.guestName]) {
                    log('Niqqud test: injecting vocalized guest name');
                    state.guestName = NIQQUD_TEST_MAP[state.guestName];
                }
                state.eventName = ctx.event_name || '';
                state.eventDate = ctx.event_date || '';
                state.eventVenue = ctx.event_venue || '';
                // Event details the agent previously lacked, so "באיזו שעה?" /
                // "איפה בדיוק?" / "של מי?" had to be deflected to notify_owner.
                state.eventTime = ctx.event_time || '';
                state.eventAddress = ctx.event_address || '';
                state.eventCelebrants = ctx.event_celebrants || '';
                state.eventRsvpDeadline = ctx.event_rsvp_deadline || '';
                // Correlation nonce (additive ctx field) — carried through to the
                // agent init below so the post-call webhook can link back. Never
                // logged: it is a correlation id, not a spoken/personalization field.
                state.attemptToken = ctx.kalfa_attempt_token || '';
            }
            catch (err) {
                log('Context parse error: ' + err + ' — using empty defaults');
            }
        }
        else {
            log('Context fetch non-200 (' + response.code + ') — using empty defaults');
        }
        proceedToDial();
    }).catch(function (err) {
        log('Context fetch failed: ' + err + ' — using empty defaults');
        proceedToDial();
    });
});
