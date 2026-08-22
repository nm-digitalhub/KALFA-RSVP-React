// SalesCloseAgent — bridges an outbound PSTN call to the ElevenLabs
// sales-closing agent ("עומר"): a consultative call to a lead who solicited
// a callback about buying the service (callback_requests, topic='מכירות'),
// aiming to get either a verbal commitment + a real signup link sent, or an
// honest non-success outcome. NEW scenario file — deliberately does NOT edit
// RSVPAgent.voxengine.js or MeetingConfirmAgent.voxengine.js. Bound to its
// own NEW routing rule in the SAME kalfa-rsvp application (multiple
// scenarios behind separate rules on one application — confirmed live for
// MeetingConfirmAgent, 2026-08-22).
//
// Architecture mirrors MeetingConfirmAgent.voxengine.js's proven
// bridge/dispatch/terminal-report shape (same file, read in full as the
// direct template) with the differences the sales-closing script draft
// (docs/voice-agent/plans/2026-08-22-sales-closing-agent-script-draft.md)
// requires:
//   - 8 client tools, not 4 — 3 reused from RSVPAgent (mark_dnc /
//     notify_owner / schedule_callback, same tool_id, sales-scoped route)
//     plus 5 new ones (get_pricing / apply_discount_tier / send_signup_link /
//     escalate_to_human / log_outcome). Each still gets its OWN
//     sls/tool/{name}/{tok} URL — same reasoning as meeting-confirm's file
//     header (no documented ElevenLabs mechanism to discriminate one shared
//     URL by a non-LLM field).
//   - unlike the 4 meeting-confirm tools (each returning a plain okResult
//     string), get_pricing/apply_discount_tier/send_signup_link/
//     escalate_to_human return real DATA the agent must speak (a price, a
//     discount amount, whether a link was accepted) — so TOOL_ROUTES below
//     carries a per-tool `resultFrom` instead of one shared okResult string.
//   - ctx failure is FATAL here for the SAME B3-class reason as
//     meeting-confirm's ctx (sls/ctx's generic-404 can mean "this callback
//     row is no longer scheduled", not just "no personalization") — never
//     dial on a non-200.
//   - no Voximplant-native AMD pre-connect gate (voicemail_detection is
//     ElevenLabs' own built-in tool, same choice as meeting-confirm).
//
// Branch B customData ({to, from, tok, u}) — the EXACT shape
// buildSalesCallCustomData() in sales-call-dispatch.ts sends:
//   * to/from — dial legs.
//   * u (app origin) + tok (opaque per-attempt access token, 32 hex chars):
//       - GET  {u}/api/voximplant/sls/ctx/{tok}       (personalization, once)
//       - POST {u}/api/voximplant/sls/cb/{tok}         (this scenario's OWN
//         terminal-lifecycle report)
//       - POST {u}/api/voximplant/sls/tool/{name}/{tok} (the 8 client tools)
// No ca/dh keys — same reasoning as meeting-confirm (no live-takeover
// mechanism wired for this token surface).
//
// The ElevenLabs API key is read from the SAME Voximplant Secret
// (ELEVENLABS_API_KEY) every other persona already uses.
//
// Dynamic-variable injection timing, end_call-does-not-close-the-WebSocket,
// and the AgentToolResponse voicemail/end_call fixes are all the SAME
// load-bearing findings documented in MeetingConfirmAgent.voxengine.js's own
// header — not repeated here verbatim; read that file for the full
// verification trail against the live ElevenLabs client-to-server-events
// docs and RSVPAgent's own production incident (session 6905201622).
require(Modules.ElevenLabs);
VoxEngine.addEventListener(AppEvents.Started, function () {
    // KALFA Sales Close (עומר) — created 2026-08-22 via `elevenlabs agents
    // add --from-file`, verified with a pull --update round-trip (8 tools, 1
    // custom guardrail, 8 evaluation criteria all persisted). llm=claude-
    // haiku-4-5, voice=Kalfa (eac91g6mnNRvS4L6tF5P).
    var AGENT_ID = 'agent_4101m0my2f2kf4qvhegat60wrgtn';
    // Sales conversations are naturally the longest of the three personas
    // (discovery + pricing + objection handling + the mandatory legal
    // disclosure + consent + signup) — unlike meeting-confirm's deliberately
    // short cap, this is aligned with the agent's own
    // conversation.max_duration_seconds (300s) rather than truncating
    // earlier than that budget allows.
    var GLOBAL_TIMEOUT_MS = 300000;
    var FAREWELL_GRACE_MS = 2000;
    var state = {
        to: '',
        from: '',
        contextUrl: '',
        callbackUrl: '',
        prospectName: '',
        noteText: '',
        companyName: '',
        companyId: '',
        companyAddress: '',
        attemptToken: '',
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
        Logger.write('[SalesCloseAgent] ' + msg);
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
    // voicemail tested FIRST — a machine greeting also starts media.
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
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    if (appOrigin && accessToken) {
        state.contextUrl = appOrigin + '/api/voximplant/sls/ctx/' + accessToken;
        state.callbackUrl = appOrigin + '/api/voximplant/sls/cb/' + accessToken;
    }
    else {
        log('No tok/u in customData — proceeding with empty dynamic variables.');
    }
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
    state.globalTimer = setTimeout(globalTimeoutFired, GLOBAL_TIMEOUT_MS);
    function proceedToDial() {
        if (state.terminated)
            return;
        log('Creating PSTN call to prospect="' + state.prospectName + '"');
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
        function bridgeAgent(call) {
            if (state.terminated)
                return;
            ElevenLabs.createAgentsClient({
                xiApiKey: key,
                agentId: AGENT_ID,
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
                    agent.conversationInitiationClientData({
                        dynamic_variables: {
                            prospect_name: state.prospectName,
                            note_text: state.noteText,
                            company_name: state.companyName,
                            company_id: state.companyId,
                            company_address: state.companyAddress,
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
                    if (name === 'voicemail_detection' && !isErr && executed) {
                        state.voicemailDetected = true;
                        log('voicemail detected — call will close as no_answer');
                    }
                    if (name === 'end_call' && !isErr && executed) {
                        log('agent called end_call — hanging up after the farewell drains');
                        scheduleHangup(call, FAREWELL_GRACE_MS);
                    }
                });
                // Client-tool router — 8 tools, each its own sls/tool/{name}/{tok}
                // route. Unlike meeting-confirm's uniform okResult string, several
                // of these carry real DATA the agent must speak — resultFrom
                // shapes what comes back from the parsed HTTP response body.
                var DISCOUNT_NOT_CONFIGURED = { tier: 'not_configured', amount_or_pct: null };
                var TOOL_ROUTES = {
                    get_pricing: {
                        path: 'pricing',
                        body: function () { return {}; },
                        resultFrom: function (ok, body) {
                            if (ok && body && body.available) {
                                return {
                                    available: true,
                                    package_name: body.package_name,
                                    base_price: body.base_price,
                                    included_reached: body.included_reached,
                                    price_per_reached: body.price_per_reached,
                                    price_with_vat: body.price_with_vat
                                };
                            }
                            return { available: false };
                        }
                    },
                    apply_discount_tier: {
                        path: 'discount',
                        body: function (args) {
                            return { objection_reason: String(args.objection_reason || '').slice(0, 300) };
                        },
                        resultFrom: function (ok, body) {
                            if (ok && body && body.tier) {
                                return { tier: body.tier, amount_or_pct: body.amount_or_pct };
                            }
                            return DISCOUNT_NOT_CONFIGURED;
                        }
                    },
                    send_signup_link: {
                        path: 'signup-link',
                        body: function (args) {
                            return { whatsapp_consent: args.whatsapp_consent === true };
                        },
                        resultFrom: function (ok, body) {
                            return { accepted: ok && !!body && body.accepted === true };
                        }
                    },
                    escalate_to_human: {
                        path: 'escalate',
                        body: function (args) {
                            return { reason: String(args.reason || '').slice(0, 300) };
                        },
                        resultFrom: function (ok, body) {
                            return { transferred: ok && !!body && body.transferred === true };
                        }
                    },
                    log_outcome: {
                        path: 'log-outcome',
                        body: function (args) {
                            var allowed = ['needs_followup', 'closed', 'escalated_to_human'];
                            var outcome = allowed.indexOf(args.outcome) !== -1 ? args.outcome : 'needs_followup';
                            var body = { outcome: outcome };
                            var tier = String(args.discount_tier_applied || '');
                            if (tier)
                                body.discount_tier_applied = tier.slice(0, 64);
                            return body;
                        },
                        resultFrom: function (ok) { return ok ? 'recorded' : 'failed'; }
                    },
                    mark_dnc: {
                        path: 'dnc',
                        body: function () { return {}; },
                        resultFrom: function (ok) { return ok ? 'removed' : 'failed'; }
                    },
                    notify_owner: {
                        path: 'note',
                        body: function (args) {
                            var kinds = ['question', 'message', 'flag'];
                            var kind = kinds.indexOf(args.kind) !== -1 ? args.kind : 'flag';
                            return { kind: kind, text: String(args.text || '').slice(0, 500) };
                        },
                        resultFrom: function (ok) { return ok ? 'noted' : 'failed'; }
                    },
                    schedule_callback: {
                        path: 'schedule',
                        body: function (args) {
                            var body = {
                                callback_when_text: String(args.callback_when_text || '').slice(0, 200)
                            };
                            var iso = String(args.callback_iso || '');
                            if (iso)
                                body.callback_iso = iso.slice(0, 40);
                            return body;
                        },
                        resultFrom: function (ok) { return ok ? 'noted' : 'failed'; }
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
                    Net.httpRequestAsync(appOrigin + '/api/voximplant/sls/tool/' + route.path + '/' + accessToken, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        postData: safeStringify(postBody)
                    }).then(function (r) {
                        var body = null;
                        try {
                            body = JSON.parse(r.text || '{}');
                        }
                        catch (_e) { }
                        var ok = r.code === 200;
                        log(toolName + ' -> ' + (r && r.code) + ' ok=' + ok);
                        // A non-200 means the request was REJECTED BEFORE anything
                        // was persisted — is_error stays FALSE so the WS survives
                        // and the agent can speak an honest failure, same
                        // discipline as save_rsvp/meeting-confirm's own tools.
                        reply(route.resultFrom(ok, body), false);
                    }).catch(function (err) {
                        log(toolName + ' request failed: ' + err);
                        reply(route.resultFrom(false, null), true);
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
    // --- fetch ctx (prospect personalization) BEFORE dialing ---
    if (!state.contextUrl) {
        proceedToDial();
        return;
    }
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                state.prospectName = ctx.prospect_name || '';
                state.noteText = ctx.note_text || '';
                state.companyName = ctx.company_name || '';
                state.companyId = ctx.company_id || '';
                state.companyAddress = ctx.company_address || '';
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
        // Non-200 is FATAL — see file header (sls/ctx's own generic-404
        // discipline may mean the row is no longer scheduled). Never dial.
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
