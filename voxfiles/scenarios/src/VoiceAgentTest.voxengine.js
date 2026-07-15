// VoiceAgentTest — bridge an outbound PSTN call to an ElevenLabs conversational
// agent (kalfatest ONLY, NOT production).
//
// Purpose: prove the ElevenLabs Agents realtime bridge end-to-end over a real
// call before wiring it into any RSVP flow. It dials the recipient, connects the
// Hebrew RSVP agent (agent_9701kxj3n54ye518a3s518cexd48: language he,
// eleven_v3_conversational, voice Kalfa) and lets them talk. It records the call
// and logs the transcript events. It sends NO cb and touches no RSVP row.
//
// Deliberately NARROW vs the live RSVP scenario:
//   * Reads ONLY {to, from} from the Branch B customData payload; tok/u are
//     ignored (no ctx fetch, no personalization — this is a wiring test).
//   * The ElevenLabs API key is read from a Voximplant Secret named
//     ELEVENLABS_API_KEY via VoxEngine.getSecretValue — NEVER placed in code,
//     customData or the log.
//   * Records the call (call.record) so the exchange can be reviewed; the record
//     URL is logged (CallEvents.RecordStarted.url) for a Management-API pull.
//
// Symbols verified against typings/voxengine.d.ts (cdn.voximplant.com copy):
//   VoxEngine.customData / callPSTN / terminate / getSecretValue(name):string|undefined
//     (~13353) / sendMediaBetween(u1,u2):void (~13391);
//   ElevenLabs.createAgentsClient({xiApiKey,agentId,...}):Promise<AgentsClient> (~6327);
//   AgentsClient.close() / addEventListener(event, cb) (~6113);
//   ElevenLabs.AgentsEvents.UserTranscript / AgentResponse / AgentResponseCorrection /
//     Interruption / WebSocketError (~6197);
//   ElevenLabs.Events.WebSocketMediaStarted / WebSocketMediaEnded (~6351);
//   CallEvents.Connected / RecordStarted(ev.url) / Failed / Disconnected;
//   Call.record(CallRecordParameters).
VoxEngine.addEventListener(AppEvents.Started, function () {
    var AGENT_ID = 'agent_9701kxj3n54ye518a3s518cexd48';
    // Global hard limit — a leaked session bills money. Close at 90s.
    var GLOBAL_TIMEOUT_MS = 90000;
    var state = {
        to: '',
        from: '',
        agent: null,
        recordingUrl: null,
        globalTimer: null,
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
        try {
            if (state.agent) {
                state.agent.close();
            }
        }
        catch (err) {
            log('agent.close() failed: ' + err);
        }
        VoxEngine.terminate();
    }
    // --- customData ({to, from}; tok/u ignored) ---
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
        log('No/invalid script_custom_data. Start with {to, from}.');
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
    log('Creating PSTN call to test recipient');
    var call = VoxEngine.callPSTN(state.to, state.from);
    // Record so the exchange can be reviewed; URL logged for a Management-API pull.
    call.addEventListener(CallEvents.RecordStarted, function (ev) {
        state.recordingUrl = (ev && ev.url) || null;
        log('RECORDING_URL: ' + state.recordingUrl);
    });
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
        // Build the ElevenLabs Agents client (opens a WebSocket to 11labs) and bridge
        // it to the call. createAgentsClient is async — await it, then bind media.
        ElevenLabs.createAgentsClient({
            xiApiKey: key,
            agentId: AGENT_ID
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
            // Media-stream lifecycle (audio actually flowing / 1s silence tail).
            agent.addEventListener(ElevenLabs.Events.WebSocketMediaStarted, function () {
                log('AGENT_MEDIA_STARTED');
            });
            agent.addEventListener(ElevenLabs.Events.WebSocketMediaEnded, function () {
                log('AGENT_MEDIA_ENDED');
            });
        }).catch(function (err) {
            log('createAgentsClient failed: ' + err);
            try {
                call.hangup();
            }
            catch (_e) { }
            cleanupAndTerminate();
        });
    });
    call.addEventListener(CallEvents.Failed, function (ev) {
        log('Call failed: ' + safeStringify(ev));
        cleanupAndTerminate();
    });
    call.addEventListener(CallEvents.Disconnected, function (ev) {
        log('Call disconnected: ' + safeStringify(ev));
        cleanupAndTerminate();
    });
});
