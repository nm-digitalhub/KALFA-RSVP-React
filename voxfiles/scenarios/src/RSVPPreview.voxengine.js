// RSVPPreview — DTMF-only PREVIEW scenario (kalfatest ONLY, NOT production).
//
// Purpose: let a human hear the NEW Hebrew RSVP wording, pacing and every branch
// over a real call, before the conversational (Groq/ASR) Phase 3 build. This is a
// PREVIEW for approval, not the shipped flow.
//
// Deliberately NARROW vs the live RSVP scenario:
//   * DTMF navigation only — no ASR, no Groq.
//   * Records the call (call.record) so the preview can be listened back; the
//     record URL is logged (CallEvents.RecordStarted.url) for Management-API pull.
//   * Reads the Branch B payload {to, from, tok, u} from VoxEngine.customData()
//     (<=200-byte cap) and fetches guest/event fields from GET {u}/api/voximplant/
//     ctx/{tok} (guest_name, event_name, event_date, event_venue). It does NOT use
//     the groq_key the ctx returns.
//   * Sends NO cb callback — a preview must not mutate any real RSVP row. Every
//     terminal branch just logs and terminates the session.
//
// Symbols verified against cdn.voximplant.com/voxengine_typings/voxengine.d.ts:
//   VoxEngine.customData/callPSTN/terminate, Call.say(text,{voice}), .handleTones,
//   .stopPlayback, .hangup, .record(CallRecordParameters); CallEvents.Connected/
//   PlaybackFinished/ToneReceived(ev.tone)/RecordStarted(ev.url)/Failed/Disconnected;
//   VoiceList.Google.he_IL_Wavenet_A; Net.httpRequestAsync.
VoxEngine.addEventListener(AppEvents.Started, function () {
    var ttsOptions = {
        voice: VoiceList.Google.he_IL_Wavenet_A
    };
    // PREVIEW placeholders: event_owner + event_type do NOT exist in the ctx
    // response yet. In production they will arrive from the ctx endpoint after a
    // backend change; for this preview they are fixed demo values.
    var PREVIEW_EVENT_OWNER = 'משפחת קלפה';
    var PREVIEW_EVENT_TYPE = 'הברית';
    // Global hard limit — a leaked session bills money. Close politely at 90s.
    var GLOBAL_TIMEOUT_MS = 90000;
    var state = {
        guestName: '',
        eventName: '',
        eventDate: '',
        eventVenue: '',
        recordingUrl: null,
        to: '',
        from: '',
        contextUrl: '',
        stage: 'idle', // idle -> rsvp_ask -> guest_count -> (terminal)
        countDigits: '',
        rsvpReprompted: false,
        finished: false,
        hangupScheduled: false,
        promptTimer: null,
        hangupTimer: null,
        globalTimer: null
    };
    function log(msg) {
        Logger.write('[RSVPPreview] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (_e) {
            return String(value);
        }
    }
    function normalizeForSpeech(text) {
        if (!text)
            return '';
        return String(text)
            .replace(/["'`]/g, '')
            .replace(/[()/\\|]/g, ' ')
            .replace(/[,:;]+/g, ', ')
            .replace(/[-–—]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function clearPromptTimer() {
        if (state.promptTimer) {
            clearTimeout(state.promptTimer);
            state.promptTimer = null;
        }
    }
    function sayLogged(call, text) {
        log('SAY: ' + text);
        call.say(text, ttsOptions);
    }
    // Schedule the terminal hangup after a final line finishes speaking. Guarded by
    // its own flag (not `finished`) so the terminal branch that sets `finished` can
    // still arm the hangup. call.hangup() -> CallEvents.Disconnected -> terminate().
    function scheduleHangup(call, delayMs) {
        if (state.hangupScheduled)
            return;
        state.hangupScheduled = true;
        state.hangupTimer = setTimeout(function () {
            try {
                call.hangup();
            }
            catch (err) {
                log('call.hangup() failed: ' + err);
                VoxEngine.terminate();
            }
        }, delayMs);
    }
    // End the call on a terminal branch: say the closing line, then hang up once it
    // has had time to play. No cb is sent (preview).
    function finish(call, text, delayMs) {
        if (state.finished)
            return;
        state.finished = true;
        state.stage = 'done';
        clearPromptTimer();
        sayLogged(call, text);
        scheduleHangup(call, delayMs || 4500);
    }
    function rsvpAskText() {
        return 'מגיעים ל' + PREVIEW_EVENT_TYPE + ' של ' + PREVIEW_EVENT_OWNER +
            '? לאישור לחצו 1, אם לא תגיעו לחצו 2, אם עדיין לא בטוח לחצו 3.';
    }
    function askRsvp(call) {
        state.stage = 'rsvp_ask';
        state.countDigits = '';
        sayLogged(call, rsvpAskText());
        armRsvpReprompt(call);
    }
    // One gentle re-prompt if no key is pressed; after that, the global timeout
    // owns the polite close (never loop a third time).
    function armRsvpReprompt(call) {
        clearPromptTimer();
        state.promptTimer = setTimeout(function () {
            if (state.finished || state.stage !== 'rsvp_ask')
                return;
            if (state.rsvpReprompted)
                return;
            state.rsvpReprompted = true;
            sayLogged(call, 'לא שמעתי. מגיעים? לאישור לחצו 1, אם לא תגיעו לחצו 2, אם עדיין לא בטוח לחצו 3.');
        }, 9000);
    }
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
        log('No script_custom_data. Start with {to, from, tok, u}.');
        VoxEngine.terminate();
        return;
    }
    state.to = customData.to || '';
    state.from = customData.from || '';
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    if (!state.to || !state.from || !appOrigin || !accessToken) {
        log('Missing required customData fields: ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    state.contextUrl = appOrigin + '/api/voximplant/ctx/' + accessToken;
    // Global safety net: close the session even if every other path is stuck.
    state.globalTimer = setTimeout(function () {
        log('Global timeout reached — closing.');
        VoxEngine.terminate();
    }, GLOBAL_TIMEOUT_MS);
    // Fetch personalization (guest_name etc). A 404 (fake/expired token) is fine —
    // the preview still dials and greets generically.
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                state.guestName = normalizeForSpeech(ctx.guest_name || '');
                state.eventName = normalizeForSpeech(ctx.event_name || '');
                state.eventDate = normalizeForSpeech(ctx.event_date || '');
                state.eventVenue = normalizeForSpeech(ctx.event_venue || '');
                // ctx.groq_key is intentionally ignored — DTMF-only preview.
            }
            catch (err) {
                log('Context parse error: ' + err);
            }
        }
    }).catch(function (err) {
        log('Context fetch failed (continuing generic): ' + err);
    }).then(function () {
        startCall();
    });
    function startCall() {
        log('Creating PSTN call to preview recipient');
        var call = VoxEngine.callPSTN(state.to, state.from);
        // Record the preview call so we can review the wording/pacing after the
        // fact. CallRecordParameters requires an object; all fields are optional.
        // stereo:true splits guest (left) and bot (right); hd_audio:true gives a
        // 48kHz/192kbps mp3. No cb is sent — the URL is only written to the log
        // (CallEvents.RecordStarted below) so we can fetch it via the Management API.
        call.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = (ev && ev.url) || null;
            log('RECORDING_URL: ' + state.recordingUrl);
        });
        call.addEventListener(CallEvents.Connected, function () {
            log('Call connected');
            call.handleTones(true);
            try {
                call.record({ stereo: true, hd_audio: true });
            }
            catch (err) {
                log('call.record() failed: ' + err);
            }
            // GREETING — then chain to RSVP_ASK on PlaybackFinished.
            state.stage = 'greeting';
            sayLogged(call, state.guestName ? 'היי, ' + state.guestName + '?' : 'היי?');
        });
        call.addEventListener(CallEvents.PlaybackFinished, function () {
            if (state.finished)
                return;
            if (state.stage === 'greeting') {
                askRsvp(call);
            }
        });
        call.addEventListener(CallEvents.ToneReceived, function (ev) {
            var digit = ev.tone;
            log('Tone received: ' + digit + ' (stage=' + state.stage + ')');
            if (state.finished)
                return;
            if (state.stage === 'rsvp_ask') {
                clearPromptTimer();
                if (digit === '1') {
                    state.stage = 'guest_count';
                    state.countDigits = '';
                    call.stopPlayback();
                    sayLogged(call, 'יופי! כמה תהיו? הקישו את המספר ואז סולמית.');
                }
                else if (digit === '2') {
                    call.stopPlayback();
                    finish(call, 'חבל, נעדכן את ' + PREVIEW_EVENT_OWNER + '. שיהיה יום נעים!');
                }
                else if (digit === '3') {
                    call.stopPlayback();
                    finish(call, 'בסדר גמור. נשלח תזכורת בוואטסאפ בעוד כמה ימים. יום נעים!');
                }
                else if (digit === '9') {
                    call.stopPlayback();
                    askRsvp(call);
                }
                // Any other key: ignore, stay in rsvp_ask.
                return;
            }
            if (state.stage === 'guest_count') {
                if (digit === '#') {
                    call.stopPlayback();
                    if (state.countDigits.length === 0) {
                        finish(call, 'רשמתי אתכם. את המספר המדויק תעדכנו בוואטסאפ. נתראה!');
                    }
                    else {
                        finish(call, 'מעולה, ' + state.countDigits + '. רשמתי. ' +
                            PREVIEW_EVENT_OWNER + ' מחכים לכם — נתראה!');
                    }
                }
                else if (digit >= '0' && digit <= '9') {
                    // Accumulate the count (cap length defensively).
                    if (state.countDigits.length < 3) {
                        state.countDigits += digit;
                    }
                }
                // '*' or other: ignore.
                return;
            }
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            clearPromptTimer();
            VoxEngine.terminate();
        });
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('Call disconnected: ' + safeStringify(ev));
            clearPromptTimer();
            VoxEngine.terminate();
        });
    }
});
