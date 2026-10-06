// VoiceABTest — Hebrew TTS A/B PROBE (kalfatest ONLY, NOT production).
//
// Purpose: on ONE real call, speak the SAME un-vocalized Hebrew sentence back to
// back in two Google he-IL voices, so a human can judge whether the newer
// Chirp3-HD voice pronounces un-niqqud Hebrew names better than Wavenet. This is
// test #1 of the Hebrew-TTS playbook. It mutates no RSVP data and sends NO cb.
//
// Deliberately minimal vs RSVPPreview / RSVP:
//   * No ASR, no Groq, no DTMF, no personalization fetch (ctx/cb untouched).
//   * Reads ONLY {to, from} from the Branch B payload {to, from, tok, u} that
//     VoxEngine.customData() carries (<=200-byte cap). tok/u are ignored on purpose.
//   * callPSTN(to, from); on Connected records the call (stereo + hd_audio) and
//     logs RECORDING_URL exactly like RSVPPreview so the two voices can be A/B'd
//     from the recording via the Management API.
//   * A tiny PlaybackFinished state machine chains the four utterances so each
//     say() starts only after the previous finished. Every branch ends in hangup
//     -> Disconnected -> VoxEngine.terminate(); a fallback timer guards each leg.
//
// The test sentence is IDENTICAL and UN-VOCALIZED (no niqqud, no SSML) in both
// voices — that is the whole point: compare raw pronunciation of "כלפה" and the
// venue name. Do NOT add niqqud or markup here.
//
// Symbols verified against typings/voxengine.d.ts (cdn.voximplant.com/
// voxengine_typings/voxengine.d.ts):
//   AppEvents.Started; VoxEngine.customData/callPSTN/terminate;
//   Call.say(text,{voice})/.record(CallRecordParameters)/.hangup;
//   CallEvents.Connected/PlaybackFinished/RecordStarted(ev.url)/Failed/Disconnected;
//   VoiceList.Google.he_IL_Wavenet_A (namespace VoiceList.Google, d.ts L29959) and
//   VoiceList.Google.he_IL_Chirp3_HD_Kore (Hebrew (Israel) FEMALE, d.ts L29864 —
//   "Google voice, Hebrew (Israel) female (eighth voice)"). Kore is the female
//   Chirp3-HD counterpart to the female Wavenet_A, so the A/B is gender-matched.
VoxEngine.addEventListener(AppEvents.Started, function () {
    // The two voices under test. Wavenet_A = current production voice; Chirp3_HD
    // Kore = candidate. If the Chirp3 constant were ever rejected, say() below is
    // wrapped in try/catch so the failure is logged rather than leaking the call.
    var WAVENET = { voice: VoiceList.Google.he_IL_Wavenet_A };
    var CHIRP = { voice: VoiceList.Google.he_IL_Chirp3_HD_Kore };
    // The identical, un-vocalized probe sentence spoken in BOTH voices.
    var PROBE_SENTENCE = 'שלום, משפחת כלפה. האירוע באולם גני התערוכה.';
    // Global safety net — a leaked session bills money. Close no matter what at 90s.
    var GLOBAL_TIMEOUT_MS = 90000;
    // Per-leg fallback: if a say()'s PlaybackFinished never fires (e.g. a voice
    // silently fails to synthesize), advance/hang up anyway after this long.
    var LEG_FALLBACK_MS = 6000;
    var state = {
        to: '',
        from: '',
        // idle -> announce_w -> sentence_w -> announce_c -> sentence_c -> done
        stage: 'idle',
        recordingUrl: null,
        finished: false,
        legTimer: null,
        globalTimer: null
    };
    function log(msg) {
        Logger.write('[VoiceABTest] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_e) {
            return String(value);
        }
    }
    function clearLegTimer() {
        if (state.legTimer) {
            clearTimeout(state.legTimer);
            state.legTimer = null;
        }
    }
    // Speak `text` in `opts.voice`. Chirp3 legs pass mayFail=true so a rejected
    // voice constant is caught + logged (we still need to know) instead of throwing
    // out of the event handler and leaking the session.
    function sayLogged(call, text, opts, mayFail) {
        log('SAY(' + (opts === CHIRP ? 'Chirp3_HD_Kore' : 'Wavenet_A') + '): ' + text);
        try {
            call.say(text, opts);
            return true;
        }
        catch (err) {
            log((mayFail ? 'CHIRP3 ' : '') + 'say() failed: ' + err);
            return false;
        }
    }
    function terminate() {
        clearLegTimer();
        if (state.globalTimer) {
            clearTimeout(state.globalTimer);
            state.globalTimer = null;
        }
        VoxEngine.terminate();
    }
    function hangup(call) {
        if (state.finished)
            return;
        state.finished = true;
        state.stage = 'done';
        clearLegTimer();
        try {
            call.hangup(); // -> CallEvents.Disconnected -> terminate()
        }
        catch (err) {
            log('call.hangup() failed: ' + err);
            terminate();
        }
    }
    // Arm the per-leg fallback so a missing PlaybackFinished can never wedge the
    // state machine. `next` runs the same transition PlaybackFinished would have.
    function armLegFallback(call, next) {
        clearLegTimer();
        state.legTimer = setTimeout(function () {
            log('Leg PlaybackFinished not seen (stage=' + state.stage + ') — fallback advance.');
            next(call);
        }, LEG_FALLBACK_MS);
    }
    // --- State-machine transitions -------------------------------------------
    // Leg 2: sentence in Wavenet.
    function speakSentenceWavenet(call) {
        if (state.finished)
            return;
        state.stage = 'sentence_w';
        sayLogged(call, PROBE_SENTENCE, WAVENET, false);
        armLegFallback(call, announceChirp);
    }
    // Leg 3: spoken announcement of the second (Chirp3) voice, in that voice.
    function announceChirp(call) {
        if (state.finished)
            return;
        state.stage = 'announce_c';
        var ok = sayLogged(call, 'קול שני, צ׳ירפ.', CHIRP, true);
        if (!ok) {
            // The Chirp3 voice constant was rejected outright — nothing will play
            // and no PlaybackFinished will come. Log already done; close politely.
            log('Chirp3 announcement say() failed — ending A/B without the Chirp3 leg.');
            hangup(call);
            return;
        }
        armLegFallback(call, speakSentenceChirp);
    }
    // Leg 4: the same probe sentence in Chirp3.
    function speakSentenceChirp(call) {
        if (state.finished)
            return;
        state.stage = 'sentence_c';
        var ok = sayLogged(call, PROBE_SENTENCE, CHIRP, true);
        if (!ok) {
            log('Chirp3 sentence say() failed — ending A/B.');
            hangup(call);
            return;
        }
        armLegFallback(call, hangup);
    }
    // --- customData ----------------------------------------------------------
    function readSessionCustomData() {
        var raw;
        try {
            raw = VoxEngine.customData();
            log('raw customData: ' + raw);
        }
        catch (err) {
            log('Failed to read VoxEngine.customData(): ' + err);
            return null;
        }
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch (err) {
            log('Failed to parse customData JSON: ' + err);
            return null;
        }
    }
    var customData = readSessionCustomData();
    if (!customData) {
        log('No script_custom_data. Start with {to, from} (Branch B {to,from,tok,u}).');
        VoxEngine.terminate();
        return;
    }
    state.to = customData.to || '';
    state.from = customData.from || '';
    // tok / u are intentionally ignored — this probe fetches nothing and sends no cb.
    if (!state.to || !state.from) {
        log('Missing required customData fields (need to + from): ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    state.globalTimer = setTimeout(function () {
        log('Global timeout reached — closing.');
        terminate();
    }, GLOBAL_TIMEOUT_MS);
    // --- Call ----------------------------------------------------------------
    log('Creating PSTN call for A/B voice probe');
    var call = VoxEngine.callPSTN(state.to, state.from);
    // Record so the two voices can be compared from the recording (stereo split,
    // 48kHz mp3). URL is only logged (no cb) for a Management-API pull.
    call.addEventListener(CallEvents.RecordStarted, function (ev) {
        state.recordingUrl = (ev && ev.url) || null;
        log('RECORDING_URL: ' + state.recordingUrl);
    });
    call.addEventListener(CallEvents.Connected, function () {
        log('Call connected');
        try {
            call.record({ stereo: true, hd_audio: true });
        }
        catch (err) {
            log('call.record() failed: ' + err);
        }
        // Leg 1: announce the first (Wavenet) voice, in that voice.
        state.stage = 'announce_w';
        sayLogged(call, 'קול ראשון, ווייבנט.', WAVENET, false);
        armLegFallback(call, speakSentenceWavenet);
    });
    call.addEventListener(CallEvents.PlaybackFinished, function () {
        if (state.finished)
            return;
        clearLegTimer();
        log('PlaybackFinished (stage=' + state.stage + ')');
        if (state.stage === 'announce_w') {
            speakSentenceWavenet(call);
            return;
        }
        if (state.stage === 'sentence_w') {
            announceChirp(call);
            return;
        }
        if (state.stage === 'announce_c') {
            speakSentenceChirp(call);
            return;
        }
        if (state.stage === 'sentence_c') {
            // Both voices spoken the same sentence back to back — done.
            log('A/B complete — hanging up.');
            hangup(call);
            return;
        }
    });
    call.addEventListener(CallEvents.Failed, function (ev) {
        log('Call failed: ' + safeStringify(ev));
        terminate();
    });
    call.addEventListener(CallEvents.Disconnected, function (ev) {
        log('Call disconnected: ' + safeStringify(ev));
        terminate();
    });
});
