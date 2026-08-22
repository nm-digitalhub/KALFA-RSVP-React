// MeetingConfirmAgent — bridges an outbound PSTN call to the ElevenLabs
// meeting-booking agent: a short (plan target 30-45s) confirm/reschedule ping
// to a callback_requests lead who already has a SCHEDULED slot, placed
// shortly before the real, human-run meeting. NEW scenario file — deliberately
// does NOT edit RSVPAgent.voxengine.js (production, promoted 2026-07-20, its
// own OutCallAgent rule 1520915 must never carry a different persona's calls,
// per CLAUDE.md). Bound to its own NEW routing rule in the SAME kalfa-rsvp
// application — confirmed live (Voximplant docs 2026-08-22, not memory) that
// one application can host multiple scenarios, each behind its own rule.
//
// Architecture mirrors RSVPAgent's PROVEN bridge/dispatch/terminal-report
// design (read in full, cross-checked against live Voximplant + ElevenLabs
// docs 2026-08-22) but is deliberately SMALLER, per the meeting-booking
// plan's own explicit non-goals:
//   - no Voximplant-native AMD pre-connect gate. voicemail_detection here is
//     ElevenLabs' OWN built-in system tool (plan §4a names this explicitly,
//     "critical here because it is an outbound call to a lead who may not be
//     expecting it") — not a second, native gate.
//   - no DTMF ASR-fallback intents, no conference/human-monitor/takeover
//     topology (plan: "אין live-takeover מכניזם בשלב זה" — escalation goes to
//     console_queues via escalate_to_queue, never a live conference bridge).
//   - no RSVP concept at all — this agent never reads or writes guest RSVP
//     state; its 4 tools are confirm_meeting / request_reschedule /
//     mark_opt_out / escalate_to_queue (docs/voice-agent/plans/
//     2026-08-22-meeting-booking-agent-plan.md §4).
//
// Branch B customData ({to, from, tok, u}) — the EXACT shape
// buildMeetingConfirmCustomData() in meeting-confirm-dispatch.ts sends (read
// in full; that function is the only caller):
//   * to/from — dial legs.
//   * u (app origin) + tok (opaque per-attempt access token, 32 hex chars) —
//     used to build:
//       - GET  {u}/api/voximplant/mtg/ctx/{tok}      (personalization, once)
//       - POST {u}/api/voximplant/mtg/cb/{tok}        (this scenario's OWN
//         terminal-lifecycle report — mirrors RSVP's cb/[token])
//       - POST {u}/api/voximplant/mtg/tool/{name}/{tok} (the 4 ElevenLabs
//         client tools — a SEPARATE namespace from mtg/cb on purpose: two of
//         the four tools take no LLM-supplied parameters at all, so a single
//         shared URL would need a synthetic discriminator field ElevenLabs'
//         webhook-tool schema has no documented constant/non-LLM mechanism
//         for — verified live against the server-tools docs 2026-08-22).
// No ca/dh keys: buildMeetingConfirmCustomData's own doc comment says this
// dispatcher never sends them ("no live-takeover mechanism in v1").
//
// The ElevenLabs API key is read from the SAME Voximplant Secret
// (ELEVENLABS_API_KEY) RSVPAgent already uses — one secret, shared per
// application, never placed in code, customData, or the log.
//
// --- Dynamic-variable injection timing (load-bearing; RSVPAgent's own
// verified finding, re-confirmed against ElevenLabs' client-to-server-events
// docs 2026-08-22) ---
// ElevenLabs' Agents WebSocket protocol accepts ONE
// conversation_initiation_client_data message and it must be the FIRST
// client frame; the server then replies with conversation_initiation_metadata
// and generates first_message. createAgentsClient() resolves once the
// WebSocket is open, so agent.conversationInitiationClientData(...) is called
// SYNCHRONOUSLY the instant that promise resolves — before sendMediaBetween
// and before attaching any listener. Injecting later (e.g. on the
// ConversationInitiationMetadata event) is too late: that event IS the
// server's acknowledgement that init already happened, and {{placeholders}}
// would resolve empty.
//
// --- end_call does NOT close the WebSocket by itself (RSVPAgent's own
// live-incident fix, session 6905201622 — re-read from the actual production
// file, not assumed) ---
// The built-in end_call system tool runs INSIDE ElevenLabs and does not
// trigger onWebSocketClose. Detected instead via
// AgentsEvents.AgentToolResponse (tool_name==='end_call', successfully
// executed, i.e. is_called!==false && is_blocked!==true && !is_error) →
// scheduleHangup. Relying on onWebSocketClose alone left a real RSVPAgent
// call's line open for 88s of dead air after the agent had already finished
// speaking — the exact bug this mirrors the fix for.
//
// --- Why ctx failure is FATAL here, unlike RSVPAgent's own ctx ---
// RSVPAgent proceeds to dial even when its ctx fetch fails (empty
// personalization is a degraded-but-safe outcome — there is still a real,
// current guest+event either way). mtg/ctx is different: per
// public-rsvp-sentinel's own review finding (B3), it returns the SAME bare
// 404 for "unknown token" AND for "the appointment is stale/reconciled since
// dispatch" — so a non-200 here is not just "no personalization", it may mean
// the slot this call was dispatched for no longer exists. Dialing anyway
// with empty variables risks the agent discussing a meeting that was already
// moved or cancelled. This scenario therefore treats a non-200 ctx response
// as terminal and never dials.
//
// Symbols verified against live Voximplant docs (voximplant.com/docs API,
// fetched 2026-08-22) and RSVPAgent.voxengine.js (the actual production,
// promoted scenario) as the concrete precedent for every ordering/gotcha
// noted above — not from memory.
require(Modules.ElevenLabs);
VoxEngine.addEventListener(AppEvents.Started, function () {
    // KALFA Meeting Confirm — created 2026-08-22 via `elevenlabs agents add
    // --from-file`, verified with a pull --update round-trip (0 fields
    // dropped). llm=claude-haiku-4-5, voice=Kalfa (eac91g6mnNRvS4L6tF5P).
    var AGENT_ID = 'agent_3601m0mt3tf3e2cvgqwak2yg54b6';
    // Short call by design (plan §3: "יעד 30–45 שניות") — a generous safety
    // margin for a reschedule negotiation running longer than the typical
    // case, but well below RSVPAgent's own 150s (a materially richer,
    // multi-question conversation this persona never has — see non-goals).
    var GLOBAL_TIMEOUT_MS = 120000;
    // Grace before hanging up the PSTN leg once the agent has ended the
    // conversation, so the buffered goodbye finishes draining instead of
    // being clipped. Same value and reasoning as RSVPAgent/RSVP.voxengine.js.
    var FAREWELL_GRACE_MS = 2000;
    var state = {
        to: '',
        from: '',
        contextUrl: '',
        callbackUrl: '',
        leadName: '',
        topicHe: '',
        scheduledWhenSpoken: '',
        scheduledTimeSpoken: '',
        meetingDurationSpoken: '',
        callerRole: '',
        // Non-authorizing correlation nonce from ctx (kalfa_attempt_token) —
        // injected as a dynamic variable so KALFA can link conversation→attempt
        // if ever needed; never used for identity here (that stays the token
        // in the URL path, resolved server-side).
        attemptToken: '',
        agent: null,
        recordingUrl: null,
        elConversationId: '',
        callbackSent: false,
        callWasConnected: false,
        // True once the ElevenLabs bridge actually carried the conversation
        // (ConversationInitiationMetadata received) — decides completed vs
        // no_response, mirrors RSVPAgent's own flag exactly.
        conversationStarted: false,
        // The agent's own voicemail_detection system tool fired — a machine
        // pickup must never read as 'completed' just because media started.
        voicemailDetected: false,
        connectedAt: 0,
        maxVadScore: 0,
        globalTimer: null,
        hangupScheduled: false,
        hangupTimer: null,
        terminated: false
    };
    function log(msg) {
        Logger.write('[MeetingConfirmAgent] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_e) {
            return String(value);
        }
    }
    // Single owner of teardown — closes the agent WebSocket (if any) and ends
    // the session exactly once. Every terminal path funnels through here.
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
    // Terminal hangup of the PSTN leg after the agent ends the conversation.
    // Guarded + idempotent; bails once teardown has begun so a WS close
    // triggered by our own agent.close() never schedules a stray hangup.
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
                // Disconnected will never fire on this path — close the
                // attempt row here so it cannot stick pre-terminal.
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
    // POST one JSON payload to KALFA's mtg/cb terminal-report endpoint
    // (best-effort, never blocks teardown).
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
    // The ONE terminal-status rule, shared by every teardown path. Order
    // matters — voicemail is tested FIRST: a machine greeting also starts
    // media, which would otherwise set conversationStarted and read as a
    // real completed call.
    function terminalStatus() {
        if (state.voicemailDetected)
            return 'no_answer';
        if (state.conversationStarted)
            return 'completed';
        return state.callWasConnected ? 'no_response' : 'no_answer';
    }
    // Exactly ONE terminal report per call (idempotent — a racing Failed +
    // Disconnected or timeout can never double-post).
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
    // LAST-RESORT terminal report. VoxEngine guarantees exactly one HTTP
    // request may be performed inside an AppEvents.Terminating handler — the
    // only slot left once the session is being torn down. A no-op on a
    // healthy call (postFinalCallbackOnce is idempotent); exists for a JS
    // error mid-scenario or the platform force-ending a wedged session —
    // precisely the class of bug that left RSVPAgent rows stuck pre-terminal
    // before this same safety net was added there.
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
    // tok + u are optional here (mirrors RSVPAgent): without them a manual
    // test-dial still runs, just with empty dynamic variables and no
    // terminal report possible (state.callbackUrl stays '').
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    if (appOrigin && accessToken) {
        state.contextUrl = appOrigin + '/api/voximplant/mtg/ctx/' + accessToken;
        state.callbackUrl = appOrigin + '/api/voximplant/mtg/cb/' + accessToken;
    }
    else {
        log('No tok/u in customData — proceeding with empty dynamic variables.');
    }
    // --- ElevenLabs API key from Voximplant Secret (never logged) ---
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
    // Global safety net: close the session even if every other path is stuck.
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
    state.globalTimer = setTimeout(globalTimeoutFired, GLOBAL_TIMEOUT_MS);
    // Places the outbound call and wires the ElevenLabs bridge. Called only
    // after the ctx fetch settles successfully, so dynamic variables are
    // known by the time the agent connects (a failed ctx fetch never reaches
    // here — see the file-header note on why that is fatal for this agent).
    function proceedToDial() {
        if (state.terminated)
            return;
        log('Creating PSTN call to lead="' + state.leadName + '" topic="' + state.topicHe + '"');
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
            // No Voximplant-native AMD pre-connect gate and no DTMF fallback
            // here — see the file header for why (voicemail_detection is
            // ElevenLabs' own built-in tool for this persona; there is no
            // ASR-fallback keypad path in the meeting-booking plan).
            bridgeAgent(call);
        });
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
        // Build the ElevenLabs Agents client (opens a WebSocket to 11labs)
        // and bridge it to the call. createAgentsClient is async — await it,
        // then bind media.
        function bridgeAgent(call) {
            if (state.terminated)
                return;
            ElevenLabs.createAgentsClient({
                xiApiKey: key,
                agentId: AGENT_ID,
                includeConversationId: true,
                // Fires for ANY WebSocket close — a dropped connection OR the
                // connector's own close. Does NOT fire for end_call (see file
                // header) — that is handled separately via AgentToolResponse.
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
                // CRITICAL ORDERING — see file header. Inject dynamic
                // variables SYNCHRONOUSLY, before sendMediaBetween and before
                // attaching any listener.
                try {
                    agent.conversationInitiationClientData({
                        dynamic_variables: {
                            lead_name: state.leadName,
                            topic_he: state.topicHe,
                            scheduled_when_spoken: state.scheduledWhenSpoken,
                            scheduled_time_spoken: state.scheduledTimeSpoken,
                            meeting_duration_spoken: state.meetingDurationSpoken,
                            caller_role: state.callerRole,
                            kalfa_attempt_token: state.attemptToken
                        }
                    });
                    log('Injected dynamic_variables');
                }
                catch (err) {
                    log('conversationInitiationClientData failed: ' + err);
                }
                VoxEngine.sendMediaBetween(call, agent);
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
                    // The bridge is carrying a live conversation as of this
                    // event — the earliest point it is safe to say so.
                    state.conversationStarted = true;
                });
                // VadScore (0..1 speech probability) — track the high-water
                // mark as a rough silence/no-answer diagnostic. Logged once
                // at teardown, never per-frame.
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
                // System-tool visibility — see file header for both fixes:
                // voicemail_detection (never bill/close a machine as
                // completed) and end_call (does NOT close the WebSocket by
                // itself; must hang up explicitly here).
                agent.addEventListener(ElevenLabs.AgentsEvents.AgentToolResponse, function (e) {
                    var payload = (e && e.data && e.data.payload) || {};
                    var atr = payload.agent_tool_response || payload;
                    var name = atr.tool_name || '';
                    var isErr = atr.is_error === true;
                    // Only an EXPLICIT negative signal suppresses detection —
                    // absent is_called/is_blocked (older connector build) is
                    // treated as executed, so this can never silently disable
                    // the checks below.
                    var executed = atr.is_called !== false && atr.is_blocked !== true;
                    log('AGENT_TOOL_RESPONSE: ' + name + ' is_error=' + isErr +
                        ' is_called=' + atr.is_called + ' is_blocked=' + atr.is_blocked);
                    if (name === 'voicemail_detection' && !isErr && executed) {
                        state.voicemailDetected = true;
                        log('voicemail detected — call will close as no_answer');
                    }
                    if (name === 'end_call' && !isErr && executed) {
                        log('agent called end_call — hanging up after the farewell drains');
                        scheduleHangup(call, FAREWELL_GRACE_MS);
                    }
                });
                // Client-tool router (plan §4). Each of the 4 tools maps to
                // its own mtg/tool/{name}/{tok} URL — see the file header for
                // why one shared URL was rejected. Unknown tools are ignored
                // (never fabricate a result). ElevenLabs REQUIRES is_error on
                // every client-tool-result frame — omitting it closes the
                // WebSocket with 1008, killing the call right after the tool
                // (the exact lesson RSVPAgent's own reply() carries). is_error
                // stays false for every outcome except "could not even
                // attempt the call" (missing tok/u, a thrown request).
                var TOOL_ROUTES = {
                    confirm_meeting: {
                        path: 'confirm',
                        okResult: 'confirmed',
                        body: function () { return {}; }
                    },
                    request_reschedule: {
                        path: 'reschedule',
                        okResult: 'noted',
                        body: function (args) {
                            var body = {
                                callback_when_text: String(args.callback_when_text || '').slice(0, 200)
                            };
                            var iso = String(args.callback_iso || '');
                            if (iso)
                                body.callback_iso = iso.slice(0, 40);
                            return body;
                        }
                    },
                    mark_opt_out: {
                        path: 'dnc',
                        okResult: 'removed',
                        body: function () { return {}; }
                    },
                    escalate_to_queue: {
                        path: 'escalate',
                        okResult: 'noted',
                        body: function (args) {
                            var reasons = ['wrong_person', 'substantive_question', 'unclear_reschedule', 'bad_line', 'other'];
                            var reason = reasons.indexOf(args.reason) !== -1 ? args.reason : 'other';
                            var body = { reason: reason };
                            var note = String(args.note_he || '').slice(0, 300);
                            if (note)
                                body.note_he = note;
                            return body;
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
                    var route = TOOL_ROUTES[toolName];
                    if (!route) {
                        return; // unknown tool — ignore (never fabricate a result)
                    }
                    var postBody = route.body(args);
                    postBody.tool_call_id = toolCallId;
                    Net.httpRequestAsync(appOrigin + '/api/voximplant/mtg/tool/' + route.path + '/' + accessToken, {
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
                        log(toolName + ' -> ' + (r && r.code) + ' ok=' + ok);
                        // A non-200 means the request was REJECTED BEFORE
                        // anything was persisted (guard rate-limit/expired
                        // token, or Zod refusing the body) — reporting
                        // anything but a plain failure would be the same
                        // false promise RSVPAgent's own save_rsvp fix exists
                        // to prevent. is_error stays FALSE: the WS must
                        // survive so the agent can speak honestly.
                        if (r.code !== 200) {
                            reply('failed', false);
                            return;
                        }
                        reply(ok ? route.okResult : 'failed', false);
                    }).catch(function (err) {
                        log(toolName + ' request failed: ' + err);
                        reply('error', true);
                    });
                });
            }).catch(function (err) {
                log('createAgentsClient failed: ' + err);
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
        }
    }
    // --- fetch ctx (lead/meeting personalization) BEFORE dialing ---
    if (!state.contextUrl) {
        proceedToDial();
        return;
    }
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                state.leadName = ctx.lead_name || '';
                state.topicHe = ctx.topic_he || '';
                state.scheduledWhenSpoken = ctx.scheduled_when_spoken || '';
                state.scheduledTimeSpoken = ctx.scheduled_time_spoken || '';
                state.meetingDurationSpoken = ctx.meeting_duration_spoken || '';
                state.callerRole = ctx.caller_role || '';
                state.attemptToken = ctx.kalfa_attempt_token || '';
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
            proceedToDial();
            return;
        }
        // Non-200 is FATAL for this agent — see file header (mtg/ctx's own
        // generic-404 discipline means this may mean the slot is stale/gone,
        // not just "no personalization available"). Never dial.
        log('Context fetch non-200 (' + response.code + ') — not dialing.');
        postFinalCallbackOnce({
            call_status: 'failed',
            call_duration: 0,
            error_reason: 'ctx_fetch_failed_' + response.code
        }, function () {
            VoxEngine.terminate();
        });
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
