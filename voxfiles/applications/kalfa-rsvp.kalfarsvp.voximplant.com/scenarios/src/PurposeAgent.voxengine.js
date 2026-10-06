// PurposeAgent — the GENERIC bridge. One scenario for every voice purpose in
// the `voice_purposes` registry, instead of one hand-written scenario per
// persona.
//
// ⚠️ WHY THIS FILE HAD TO EXIST, stated as the measured fact it is rather than
// as a design preference. On 2026-09-15 the account carried eight routing rules
// (read live with `npm run voximplant -- rules`), and the deployed text of all
// three agent scenarios was downloaded and inspected
// (`npm run voximplant -- scenario --id 920395|920394|920396`). Every one of
// them builds its context URL from a PERSONA-SPECIFIC path:
//
//     RSVPAgent            /api/voximplant/ctx/{tok}
//     MeetingConfirmAgent  /api/voximplant/mtg/ctx/{tok}
//     SalesCloseAgent      /api/voximplant/sls/ctx/{tok}
//
// and NOT ONE of them contains the string `/purpose/`. Meanwhile
// `dispatchVoicePurposeCall` mints its token in `voice_purpose_attempts` and
// sends `{to, from, tok, u, p}` expecting the scenario to build
// `{u}/api/voximplant/purpose/{p}/ctx/{tok}`. So a purpose pointed at any
// existing rule would dial, then fetch a ctx route that has never heard of its
// token, and get a 404. The generic path had a complete server half and no
// telephony half at all.
//
// ⚠️ AND THE AGENT IS NOT A CONSTANT HERE. That is the second half of the same
// problem: all three deployed scenarios hardcode `var AGENT_ID = 'agent_…'`, so
// "which agent answers" is a property of the deployed JavaScript rather than of
// the call. This one reads `agent_id` from ctx, which is what makes a purpose —
// and the workflow node that selects one — able to name its own agent without a
// deploy. A ctx that names no agent REFUSES TO DIAL rather than falling back to
// some default: there is no honest default, and telephoning someone so that
// nobody speaks is worse than not telephoning them.
//
// customData ({to, from, tok, u, p}) — the exact shape voice-purpose-dispatch.ts
// sends, and it is capped: `VoxEngine.customData()` holds at most 200 bytes
// (docs.voximplant.ai/platform/voxengine/custom-data, re-read 2026-09-15). That
// cap is why `u` is an ORIGIN and the scenario composes the two URLs itself, and
// why the agent id travels over ctx — which has no such limit — rather than
// beside the token here.
//
// The bridge/dispatch/terminal-report shape below is SalesCloseAgent's, read in
// full as the direct template, minus its eight client tools (the generic purpose
// surface exposes no tool routes yet) and minus its hardcoded agent. The
// load-bearing findings it documents — dynamic variables must be injected
// synchronously the instant `createAgentsClient` resolves, `end_call` does not
// close the WebSocket, the AgentToolResponse three-field frame — are the same
// here and are not re-derived; read that file for the verification trail.
require(Modules.ElevenLabs);
VoxEngine.addEventListener(AppEvents.Started, function () {
    // A ceiling, not a policy. The purpose's own duration budget belongs to the
    // agent's `conversation.max_duration_seconds`; this is the backstop that
    // keeps a wedged WebSocket from holding a paid channel open, and it is
    // deliberately generous enough never to truncate a healthy call.
    var DEFAULT_TIMEOUT_MS = 300000;
    var MAX_TIMEOUT_MS = 900000;
    var FAREWELL_GRACE_MS = 2000;
    var state = {
        to: '',
        from: '',
        purposeKey: '',
        contextUrl: '',
        callbackUrl: '',
        // ⚠️ THE ONE FIELD WITHOUT A FALLBACK. Everything else below degrades to
        // an empty string and the call still happens; an empty agent id means
        // there is nobody to connect the caller to.
        agentId: '',
        // Whatever the purpose's ctx chose to send, passed through verbatim as
        // dynamic variables. Deliberately a BAG and not a fixed list of fields:
        // a new purpose adds a variable by returning it from ctx and naming it
        // in its prompt, with no change to this file and no deploy.
        dynamicVariables: {},
        firstMessageOverride: '',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        agent: null,
        recordingUrl: null,
        elConversationId: '',
        callbackSent: false,
        callWasConnected: false,
        conversationStarted: false,
        voicemailDetected: false,
        connectedAt: 0,
        maxVadScore: 0,
        globalTimer: null,
        hangupScheduled: false,
        hangupTimer: null,
        terminated: false
    };
    function log(msg) {
        Logger.write('[PurposeAgent] ' + msg);
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
        if (state.hangupTimer) {
            clearTimeout(state.hangupTimer);
            state.hangupTimer = null;
        }
        try {
            if (state.agent)
                state.agent.close();
        }
        catch (err) {
            log('agent.close() failed: ' + err);
        }
        log('maxVadScore=' + state.maxVadScore);
        VoxEngine.terminate();
    }
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
    function postCallback(payload, done) {
        if (!state.callbackUrl) {
            if (done)
                done();
            return;
        }
        log('POST terminal report: ' + safeStringify(payload));
        Net.httpRequestAsync(state.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            postData: safeStringify(payload)
        }).then(function (r) {
            log('terminal report response: ' + (r && r.code));
            if (done)
                done();
        }).catch(function (err) {
            log('terminal report failed: ' + err);
            if (done)
                done();
        });
    }
    // voicemail tested FIRST — a machine greeting also starts media, so a call
    // that reached an answering machine would otherwise report as 'completed'.
    //
    // These four strings are not free-form: `voice-outcome.ts` maps exactly
    // completed / no_answer / no_response / failed onto the business outcome a
    // workflow branches on, and anything else falls through to 'unknown'.
    function terminalStatus() {
        if (state.voicemailDetected)
            return 'no_answer';
        if (state.conversationStarted)
            return 'completed';
        return state.callWasConnected ? 'no_response' : 'no_answer';
    }
    function postFinalCallbackOnce(payload, done) {
        if (state.callbackSent) {
            if (done)
                done();
            return;
        }
        state.callbackSent = true;
        if (state.elConversationId) {
            payload.el_conversation_id = state.elConversationId;
        }
        postCallback(payload, done);
    }
    VoxEngine.addEventListener(AppEvents.Terminating, function () {
        if (state.callbackSent)
            return;
        log('Terminating with no terminal report sent — posting last-resort close');
        postFinalCallbackOnce({
            call_status: terminalStatus(),
            call_duration: state.connectedAt
                ? Math.round((Date.now() - state.connectedAt) / 1000)
                : 0,
            error_reason: 'session_terminating'
        });
    });
    // --- customData ({to, from, tok, u, p}) ---
    var raw = '';
    try {
        raw = VoxEngine.customData();
        log('raw customData: ' + raw);
    }
    catch (err) {
        log('Failed to read VoxEngine.customData(): ' + err);
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
        log('No usable customData — terminating.');
        VoxEngine.terminate();
        return;
    }
    state.to = customData.to || '';
    state.from = customData.from || '';
    state.purposeKey = customData.p || '';
    if (!state.to || !state.from) {
        log('Missing required customData fields (to/from): ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    // ⚠️ ALL THREE OR NOTHING, and no "proceed with empty variables" branch.
    //
    // The persona scenarios can dial without ctx because their agent is compiled
    // in — a call with no personalization is degraded but real. Here the agent
    // id ITSELF comes from ctx, so no ctx means no agent, which means a call
    // nobody answers. The purpose key matters for the same reason: it is a path
    // segment, and a wrong one reaches a different purpose's route.
    if (!appOrigin || !accessToken || !state.purposeKey) {
        log('Missing u/tok/p in customData — cannot resolve a purpose. Not dialing.');
        VoxEngine.terminate();
        return;
    }
    state.contextUrl = appOrigin + '/api/voximplant/purpose/' + state.purposeKey + '/ctx/' + accessToken;
    state.callbackUrl = appOrigin + '/api/voximplant/purpose/' + state.purposeKey + '/cb/' + accessToken;
    var key = VoxEngine.getSecretValue('ELEVENLABS_API_KEY');
    if (!key) {
        log('SECRET MISSING — add the ELEVENLABS_API_KEY secret to this application');
        postFinalCallbackOnce({
            call_status: 'failed',
            call_duration: 0,
            error_reason: 'missing_secret'
        }, function () {
            VoxEngine.terminate();
        });
        return;
    }
    function globalTimeoutFired() {
        log('Global timeout reached — closing.');
        postFinalCallbackOnce({
            call_status: terminalStatus(),
            call_duration: state.connectedAt
                ? Math.round((Date.now() - state.connectedAt) / 1000)
                : 0
        }, function () {
            cleanupAndTerminate();
        });
    }
    function proceedToDial() {
        if (state.terminated)
            return;
        // Started HERE and not at parse time: the ceiling is a call's budget, and
        // the ctx fetch that precedes it has its own failure paths that report
        // and terminate on their own.
        state.globalTimer = setTimeout(globalTimeoutFired, state.timeoutMs);
        log('Creating PSTN call for purpose="' + state.purposeKey +
            '" agent=' + state.agentId + ' timeout_ms=' + state.timeoutMs);
        var call = VoxEngine.callPSTN(state.to, state.from);
        call.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = (ev && ev.url) || null;
            log('RECORDING_URL: ' + state.recordingUrl);
        });
        call.addEventListener(CallEvents.Connected, function () {
            log('Call connected');
            state.callWasConnected = true;
            state.connectedAt = Date.now();
            try {
                call.record({ stereo: true, hd_audio: true });
            }
            catch (err) {
                log('call.record() failed: ' + err);
            }
            bridgeAgent(call);
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            postFinalCallbackOnce({
                call_status: 'no_answer',
                call_duration: 0,
                error_reason: 'sip_' + ((ev && ev.code) || 0)
            }, function () {
                cleanupAndTerminate();
            });
        });
        call.addEventListener(CallEvents.Disconnected, function () {
            log('Call disconnected');
            postFinalCallbackOnce({
                call_status: terminalStatus(),
                call_duration: state.connectedAt
                    ? Math.round((Date.now() - state.connectedAt) / 1000)
                    : 0
            }, function () {
                cleanupAndTerminate();
            });
        });
        function bridgeAgent(call) {
            if (state.terminated)
                return;
            ElevenLabs.createAgentsClient({
                xiApiKey: key,
                // The whole point of this file: a value, not a constant.
                agentId: state.agentId,
                includeConversationId: true,
                onWebSocketClose: function (event) {
                    log('AGENT_WS_CLOSED code=' + (event && event.code) +
                        ' clean=' + (event && event.wasClean) +
                        ' reason=' + (event && event.reason));
                    state.agent = null;
                    scheduleHangup(call, FAREWELL_GRACE_MS);
                }
            }).then(function (agent) {
                if (state.terminated) {
                    try {
                        agent.close();
                    }
                    catch (_e) { }
                    return;
                }
                state.agent = agent;
                log('ElevenLabs AgentsClient created: ' + agent.id());
                try {
                    // ⚠️ SYNCHRONOUSLY, BEFORE `sendMediaBetween` AND BEFORE ANY
                    // LISTENER IS ATTACHED. Sent any later, the dynamic variables
                    // resolve EMPTY — the finding RSVPAgent's own header records,
                    // and the reason both of ElevenLabs' official examples (which
                    // never call this method at all) cannot be used as a template.
                    agent.conversationInitiationClientData({
                        dynamic_variables: state.dynamicVariables,
                        // ⚠️ OMITTED ENTIRELY when ctx sent none, never sent empty.
                        //
                        // And the decision of WHETHER to send one is the server's,
                        // not this file's: a first-message override reaching an
                        // agent whose
                        // platform_settings.overrides.conversation_config_override
                        // .agent.first_message flag is false is an ERROR for most
                        // fields and silence for this one. Either way the scenario
                        // cannot know the flag — it has no ElevenLabs API key use
                        // beyond the WebSocket — so the invariant lives where the
                        // value is minted, in the purpose ctx route. This sends
                        // what it is given and nothing it is not.
                        conversation_config_override: state.firstMessageOverride
                            ? { agent: { first_message: state.firstMessageOverride } }
                            : undefined
                    });
                    log('Injected dynamic_variables (' +
                        Object.keys(state.dynamicVariables).length + ' keys, first_message_override=' +
                        (state.firstMessageOverride ? 'yes' : 'no') + ')');
                }
                catch (err) {
                    log('conversationInitiationClientData failed: ' + err);
                }
                VoxEngine.sendMediaBetween(call, agent);
                // --- diagnostic listeners ---
                // No behaviour, log only. Without them a failed call produces
                // nothing at all on the Voximplant side — no transcript, no error
                // — which is exactly why one persona's failures were diagnosable
                // and another's had to be reconstructed from ElevenLabs' own
                // conversation record.
                agent.addEventListener(ElevenLabs.AgentsEvents.UserTranscript, function (e) {
                    log('USER: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentResponse, function (e) {
                    log('AGENT: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentResponseCorrection, function (e) {
                    log('AGENT_CORRECTION: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.WebSocketError, function (e) {
                    log('AGENT_WS_ERROR: ' + safeStringify(e && e.data));
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.ConversationInitiationMetadata, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var meta = payload.conversation_initiation_metadata_event || payload;
                    var convId = meta.conversation_id;
                    log('AUDIO_FORMAT: agent_out=' + (meta.agent_output_audio_format || '?') +
                        ' user_in=' + (meta.user_input_audio_format || '?'));
                    if (convId) {
                        state.elConversationId = String(convId);
                        log('CONVERSATION_ID captured');
                    }
                    else {
                        log('ConversationInitiationMetadata without a conversation_id');
                    }
                    state.conversationStarted = true;
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.VadScore, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var scoreEv = payload.vad_score_event || payload;
                    var score = Number(scoreEv.vad_score);
                    if (!isNaN(score) && score > state.maxVadScore) {
                        state.maxVadScore = score;
                    }
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.Interruption, function () {
                    try {
                        agent.clearMediaBuffer();
                    }
                    catch (err) {
                        log('clearMediaBuffer failed: ' + err);
                    }
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentToolResponse, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var atr = payload.agent_tool_response || payload;
                    var name = atr.tool_name || '';
                    var isErr = atr.is_error === true;
                    var executed = atr.is_called !== false && atr.is_blocked !== true;
                    log('AGENT_TOOL_RESPONSE: ' + name + ' is_error=' + isErr +
                        ' is_called=' + atr.is_called + ' is_blocked=' + atr.is_blocked);
                    // ElevenLabs' OWN built-in tool, not one of ours — it runs on
                    // their side and reports here. Tested before `end_call` for the
                    // reason terminalStatus documents.
                    if (name === 'voicemail_detection' && !isErr && executed) {
                        state.voicemailDetected = true;
                        log('voicemail detected — call will close as no_answer');
                    }
                    if (name === 'end_call' && !isErr && executed) {
                        // ⚠️ `end_call` DOES NOT CLOSE THE WEBSOCKET. The agent
                        // stops speaking and the socket stays open, so without
                        // this the call would hold the line in silence until the
                        // global timeout.
                        log('end_call — hanging up after the farewell');
                        scheduleHangup(call, FAREWELL_GRACE_MS);
                    }
                });
                agent.addEventListener(ElevenLabs.AgentsEvents.ClientToolCall, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var ctc = payload.client_tool_call || payload;
                    var toolName = ctc.tool_name || '';
                    var toolCallId = ctc.tool_call_id || '';
                    // ⚠️ THE GENERIC SURFACE EXPOSES NO CLIENT TOOLS — there is no
                    // `/api/voximplant/purpose/{p}/tool/...` route, by design: a
                    // tool is a per-purpose contract and there is nothing generic
                    // to route it to yet.
                    //
                    // ⚠️ AND IT ANSWERS RATHER THAN IGNORING. A tool call left
                    // unanswered hangs the conversation until ElevenLabs times it
                    // out, which the caller hears as dead air. `is_error: true` is
                    // the unified unknown-tool answer this codebase settled on —
                    // it lets the agent recover and say something honest.
                    log('Unsupported client tool on the generic surface: ' + toolName);
                    try {
                        agent.clientToolResult({
                            tool_call_id: toolCallId,
                            result: 'unsupported_tool',
                            is_error: true
                        });
                    }
                    catch (err) {
                        log('clientToolResult failed: ' + err);
                    }
                });
            }).catch(function (err) {
                log('createAgentsClient failed: ' + err);
                postFinalCallbackOnce({
                    call_status: 'failed',
                    call_duration: 0,
                    error_reason: 'agent_client_failed'
                }, function () {
                    try {
                        call.hangup();
                    }
                    catch (_e) { }
                    cleanupAndTerminate();
                });
            });
        }
    }
    // --- fetch ctx BEFORE dialing ---
    //
    // Non-negotiable here, unlike in the persona scenarios: this is where the
    // agent id comes from.
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code);
        if (response.code !== 200 || !response.text) {
            // Non-200 is FATAL. The purpose ctx route answers 404 generically —
            // an expired token, a token minted for a different purpose, a purpose
            // switched off since dispatch all look identical — so "not 200" can
            // mean "this call should no longer happen", and dialing anyway would
            // telephone someone the rules had already excluded.
            log('Context fetch non-200 (' + response.code + ') — not dialing.');
            postFinalCallbackOnce({
                call_status: 'failed',
                call_duration: 0,
                error_reason: 'ctx_fetch_failed_' + response.code
            }, function () {
                VoxEngine.terminate();
            });
            return;
        }
        var ctx = null;
        try {
            ctx = JSON.parse(response.text);
        }
        catch (err) {
            log('Context parse error: ' + err);
            postFinalCallbackOnce({
                call_status: 'failed',
                call_duration: 0,
                error_reason: 'ctx_parse_error'
            }, function () {
                VoxEngine.terminate();
            });
            return;
        }
        state.agentId = String(ctx.agent_id || '');
        if (!state.agentId) {
            // See the file header: there is no honest default agent, and a call
            // that connects to nobody is worse than a call not placed.
            log('ctx named no agent_id — not dialing.');
            postFinalCallbackOnce({
                call_status: 'failed',
                call_duration: 0,
                error_reason: 'no_agent_configured'
            }, function () {
                VoxEngine.terminate();
            });
            return;
        }
        state.firstMessageOverride = ctx.first_message_override || '';
        var seconds = Number(ctx.max_duration_sec);
        if (!isNaN(seconds) && seconds > 0) {
            var requested = Math.round(seconds) * 1000;
            state.timeoutMs = requested > MAX_TIMEOUT_MS ? MAX_TIMEOUT_MS : requested;
        }
        // ⚠️ EVERY OTHER ctx FIELD BECOMES A DYNAMIC VARIABLE, BY ITS OWN NAME.
        //
        // A pass-through and not a fixed mapping, because the whole purpose of
        // this scenario is that adding a purpose does not mean editing this file:
        // a new variable ships by ctx returning it and the agent's prompt naming
        // it. The three keys below are excluded because they are INSTRUCTIONS to
        // this scenario rather than values for the prompt, and letting a prompt
        // interpolate them would leak plumbing into what the caller hears.
        //
        // Values are stringified: the frame's `dynamic_variables` carries scalars,
        // and an object arriving here would otherwise reach the prompt as
        // "[object Object]".
        var reserved = { agent_id: 1, first_message_override: 1, max_duration_sec: 1 };
        for (var k in ctx) {
            if (!Object.prototype.hasOwnProperty.call(ctx, k) || reserved[k])
                continue;
            var v = ctx[k];
            if (v === null || v === undefined)
                continue;
            state.dynamicVariables[k] = typeof v === 'string' ? v : safeStringify(v);
        }
        proceedToDial();
    }).catch(function (err) {
        log('Context fetch failed: ' + err);
        postFinalCallbackOnce({
            call_status: 'failed',
            call_duration: 0,
            error_reason: 'ctx_fetch_error'
        }, function () {
            VoxEngine.terminate();
        });
    });
});
