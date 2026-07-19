// VoiceAgentTest — bridge an outbound PSTN call to an ElevenLabs conversational
// agent WITH per-call personalization (kalfatest ONLY, NOT production).
//
// Purpose: prove the ElevenLabs Agents realtime bridge end-to-end over a real
// call, now feeding the agent real per-call guest/event data. It dials the
// recipient, opens the Hebrew RSVP agent
// (agent_9701kxj3n54ye518a3s518cexd48: language he, eleven_v3_conversational,
// voice Kalfa), injects dynamic variables so the agent's {{guest_name}},
// {{event_name}}, {{event_date}}, {{event_venue}} placeholders resolve, records
// the call and logs the transcript events. It sends NO cb and touches no RSVP row.
//
// Branch B customData ({to, from, tok, u}) — tiny, ≤200-byte cap:
//   * to/from        — dial legs (required).
//   * u (app origin) — used to build the ctx URL (optional; if absent, the test
//                      still runs with empty dynamic variables).
//   * tok            — opaque per-call access token; the scenario fetches
//                      GET {u}/api/voximplant/ctx/{tok} → {guest_name, event_name,
//                      event_date, event_venue, groq_key}. Only the 4 name/event
//                      fields are used here; groq_key is IGNORED (this scenario
//                      runs the LLM inside ElevenLabs, not Groq). No secret ever
//                      sits in customData/call history.
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
        // Speech-probability high-water mark (VadScore) — a rough silence / no-
        // answer signal logged at teardown. 0 ⇒ the agent never detected speech.
        maxVadScore: 0,
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
        Logger.write('[VoiceAgentTest] ' + msg);
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
                cleanupAndTerminate();
            }
        }, delayMs);
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
        // application's scope. If this fires on kalfatest, add the ELEVENLABS_API_KEY
        // secret to the kalfatest application.
        log('SECRET MISSING — add ELEVENLABS_API_KEY secret to the kalfatest application');
        VoxEngine.terminate();
        return;
    }
    // Global safety net: close the session even if every other path is stuck.
    state.globalTimer = setTimeout(function () {
        log('Global timeout reached — closing.');
        cleanupAndTerminate();
    }, GLOBAL_TIMEOUT_MS);
    // Places the outbound call and wires the ElevenLabs bridge. Called only after
    // the ctx fetch settles (success or failure) so the dynamic variables are known
    // by the time the agent connects.
    function proceedToDial() {
        if (state.terminated)
            return;
        log('Creating PSTN call to test recipient (guest="' + state.guestName +
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
                    scheduleHangup(call, 0);
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
                });
                agent.addEventListener(ElevenLabs.Events.WebSocketMediaEnded, function () {
                    log('AGENT_MEDIA_ENDED');
                });
                // Client-tool router (conversation-design §4.2). Each tool maps to a
                // token-scoped KALFA endpoint (this scenario already holds tok + u —
                // no secret in the payload). The endpoint's {ok} decides the result
                // string, so the agent only claims success ("נרשם"/"הוסרת") when the
                // write actually landed. Unknown tools are ignored (never fabricate).
                //   save_rsvp    → agent-tool/rsvp  → saved | queued
                //   mark_dnc     → agent-tool/dnc   → removed | queued
                //   notify_owner → agent-tool/note  → noted | queued
                var TOOL_ROUTES = {
                    save_rsvp: {
                        path: 'rsvp',
                        okResult: 'saved',
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
                        var ok = false;
                        try {
                            ok = r.code === 200 && JSON.parse(r.text || '{}').ok === true;
                        }
                        catch (_e) { }
                        log(toolName + ' -> ' + (r && r.code) + ' ok=' + ok);
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
                try {
                    call.hangup();
                }
                catch (_e) { }
                cleanupAndTerminate();
            });
            } // end bridgeAgent
            // Gate the bridge on AMD (fail-open). HUMAN → bridgeAgent(); VOICEMAIL →
            // hang up without ever opening the ElevenLabs WS.
            runVoicemailGate(call, bridgeAgent);
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            cleanupAndTerminate();
        });
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('Call disconnected: ' + safeStringify(ev));
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
                // normalization (unlike the say()-based RSVP scenario). groq_key
                // is intentionally ignored here.
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
