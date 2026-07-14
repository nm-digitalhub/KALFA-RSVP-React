require(Modules.ASR);
VoxEngine.addEventListener(AppEvents.Started, function () {
    var ttsOptions = {
        // Wavenet Hebrew is currently the most stable/natural voice for names and dates.
        voice: VoiceList.Google.he_IL_Wavenet_A
    };
    var state = {
        guestName: '',
        eventName: '',
        eventDate: '',
        eventVenue: '',
        callbackSent: false,
        recordingUrl: null,
        invitationId: null,
        callbackUrl: '',
        contextUrl: '',
        to: '',
        from: '',
        groqKey: '',
        callWasConnected: false,
        asrListening: false,
        shuttingDown: false,
        noSpeechTimer: null,
        finalHangupTimer: null,
        finalHangupScheduled: false,
        transcriptParts: []
    };
    function log(msg) {
        Logger.write('[RSVP] ' + msg);
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
            .replace(/\b2025\b/g, 'אלפיים עשרים וחמש')
            .replace(/\b2026\b/g, 'אלפיים עשרים ושש')
            .replace(/\b2027\b/g, 'אלפיים עשרים ושבע')
            .replace(/\b2028\b/g, 'אלפיים עשרים ושמונה')
            .replace(/["'`]/g, '')
            .replace(/[()/\\|]/g, ' ')
            .replace(/[,:;]+/g, ', ')
            .replace(/[-–—]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function clearTimers() {
        if (state.noSpeechTimer) {
            clearTimeout(state.noSpeechTimer);
            state.noSpeechTimer = null;
        }
        if (state.finalHangupTimer) {
            clearTimeout(state.finalHangupTimer);
            state.finalHangupTimer = null;
        }
    }
    function postCallback(payload, done) {
        if (!state.callbackUrl) {
            if (done)
                done();
            return;
        }
        log('POST callback: ' + safeStringify(payload));
        var options = new Net.HttpRequestOptions();
        options.method = 'POST';
        options.headers = [
            'Content-Type: application/json'
        ];
        options.postData = JSON.stringify(payload);
        Net.httpRequestAsync(state.callbackUrl, options)
            .then(function (r) {
            log('Callback response: ' + r.code + ' ' + r.text);
            if (done)
                done();
        })
            .catch(function (err) {
            log('Callback failed: ' + err);
            if (done)
                done();
        });
    }
    function postFinalCallbackOnce(payload, done) {
        if (state.callbackSent) {
            if (done)
                done();
            return;
        }
        state.callbackSent = true;
        // Send array of turns: [{speaker, text, at}, ...]. Backend accepts
        // both array (rich multi-turn) and plain string (legacy).
        if (state.transcriptParts && state.transcriptParts.length > 0) {
            payload.transcript = state.transcriptParts;
        }
        postCallback(payload, done);
    }
    /**
     * Say + log: record the turn BEFORE TTS plays so the transcript timeline
     * matches call chronology. Centralises every spoken agent line so nothing
     * escapes the recorder.
     */
    function sayLogged(call, text) {
        state.transcriptParts.push({
            speaker: 'agent',
            text: text,
            at: new Date().toISOString()
        });
        call.say(text, ttsOptions);
    }
    function buildMainMessage() {
        var parts = [];
        parts.push(state.guestName ? 'שלום, ' + state.guestName + '.' : 'שלום.');
        parts.push('כאן קלפה, מערכת אישורי ההגעה.');
        parts.push(state.eventName
            ? 'אני מתקשרת אליך בנוגע לאירוע ' + state.eventName + '.'
            : 'אני מתקשרת אליך בנוגע לאירוע שלך.');
        if (state.eventDate) {
            parts.push('תאריך האירוע הוא ' + state.eventDate + '.');
        }
        if (state.eventVenue) {
            parts.push('מיקום האירוע הוא ' + state.eventVenue + '.');
        }
        parts.push('לאישור הגעה, לחצו 1.');
        parts.push('לעדכון שלא תוכלו להגיע, לחצו 2.');
        parts.push('לחזרה על ההודעה, לחצו 9.');
        parts.push('אפשר גם לומר: כן, לא, או חזרה.');
        return parts.join(' ');
    }
    // Schedule the final call.hangup(). Guarded by a dedicated flag rather than
    // state.shuttingDown — the shutdown sequence is what *invokes* this function
    // (see finalizeChoice), so checking shuttingDown here would always bail and
    // leave the call open until the remote party hangs up themselves. Lived
    // bug: every 'completed' RSVP run kept the line open ~44s until the guest
    // manually disconnected.
    function scheduleHangup(call, delayMs) {
        if (state.finalHangupScheduled)
            return;
        state.finalHangupScheduled = true;
        state.finalHangupTimer = setTimeout(function () {
            try {
                call.hangup();
            }
            catch (err) {
                log('call.hangup() failed: ' + err);
                VoxEngine.terminate();
            }
        }, delayMs);
    }
    function stopAsr(call, asr) {
        clearTimers();
        if (!state.asrListening)
            return;
        state.asrListening = false;
        try {
            call.stopMediaTo(asr);
        }
        catch (err) {
            log('call.stopMediaTo(asr) failed: ' + err);
        }
    }
    function startAsr(call, asr) {
        if (state.asrListening || state.shuttingDown)
            return;
        state.asrListening = true;
        log('Starting ASR window');
        try {
            call.sendMediaTo(asr);
        }
        catch (err) {
            log('call.sendMediaTo(asr) failed: ' + err);
            state.asrListening = false;
            return;
        }
        state.noSpeechTimer = setTimeout(function () {
            if (!state.asrListening)
                return;
            log('ASR timeout: no speech detected');
            stopAsr(call, asr);
            sayLogged(call, 'לא שמעתי תשובה. אפשר לומר כן, לא או חזרה. אפשר גם ללחוץ 1, 2 או 9.');
        }, 6000);
    }
    function finalizeChoice(call, digit, method) {
        if (state.shuttingDown)
            return;
        state.shuttingDown = true;
        clearTimers();
        var confirmation = digit === '1'
            ? 'תודה. הגעתך אושרה.'
            : 'תודה. עדכנו שלא תוכל להגיע.';
        sayLogged(call, confirmation);
        postFinalCallbackOnce({
            call_status: 'completed',
            call_duration: 0,
            rsvp_digit: digit,
            rsvp_method: method,
            invitation_id: state.invitationId,
            recording_url: state.recordingUrl
        }, function () {
            scheduleHangup(call, 2000);
        });
    }
    function handleVoiceIntent(text, call, _asr) {
        if (!state.groqKey) {
            log('No Groq key, cannot process voice response');
            sayLogged(call, 'לא הבנתי. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.');
            return;
        }
        var groqPayload = {
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'החזר אך ורק ספרה אחת: 1 אם המשתמש מאשר הגעה, 2 אם המשתמש דוחה הגעה, 9 אם לא ברור.'
                },
                {
                    role: 'user',
                    content: text
                }
            ]
        };
        log('Sending to Groq Llama 4: ' + text);
        log('Groq payload: ' + JSON.stringify(groqPayload));
        var options = new Net.HttpRequestOptions();
        options.method = 'POST';
        options.headers = [
            'Authorization: Bearer ' + state.groqKey,
            'Content-Type: application/json'
        ];
        options.postData = JSON.stringify(groqPayload);
        Net.httpRequestAsync('https://api.groq.com/openai/v1/chat/completions', options)
            .then(function (response) {
            log('Groq HTTP code: ' + response.code);
            log('Groq raw response: ' + response.text);
            var digit = '';
            try {
                var parsedResponse = JSON.parse(response.text);
                if (parsedResponse.error) {
                    log('Groq API error: ' + parsedResponse.error.message);
                    sayLogged(call, 'אירעה תקלה בזיהוי התשובה. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.');
                    return;
                }
                if (parsedResponse.choices &&
                    parsedResponse.choices.length > 0 &&
                    parsedResponse.choices[0].message &&
                    parsedResponse.choices[0].message.content) {
                    digit = String(parsedResponse.choices[0].message.content).trim().charAt(0);
                }
                else {
                    log('Groq response format error: missing choices array');
                }
            }
            catch (err) {
                log('Failed to parse Groq response: ' + err + '; raw=' + response.text);
            }
            log('Groq intent digit: ' + digit);
            if (digit === '1' || digit === '2') {
                finalizeChoice(call, digit, 'voice_asr');
            }
            else if (digit === '9') {
                sayLogged(call, buildMainMessage());
            }
            else {
                sayLogged(call, 'לא הבנתי. אפשר לומר כן, לא או חזרה. אפשר גם ללחוץ 1, 2 או 9.');
            }
        })
            .catch(function (err) {
            log('Groq request failed: ' + err);
            sayLogged(call, 'אירעה תקלה בזיהוי התשובה. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.');
        });
    }
    function readSessionCustomData() {
        var rawCustomData;
        try {
            rawCustomData = VoxEngine.customData();
            log('raw customData: ' + rawCustomData);
        }
        catch (err) {
            log('Failed to read VoxEngine.customData(): ' + err);
            return null;
        }
        if (!rawCustomData) {
            return null;
        }
        try {
            return JSON.parse(rawCustomData);
        }
        catch (err) {
            log('Failed to parse customData JSON: ' + err);
            return null;
        }
    }
    var customData = readSessionCustomData();
    if (!customData) {
        log('No script_custom_data found. Start the scenario with script_custom_data.');
        VoxEngine.terminate();
        return;
    }
    // Branch B: the payload is tiny ({to, from, tok, u}) — well under VoxEngine's
    // 200-byte customData() cap. The opaque per-call access token (tok) + app
    // origin (u) are all the scenario needs; it builds the ctx/cb URLs itself and
    // fetches the Groq key from the ctx response (never in customData, so it never
    // lands in Voximplant call history).
    state.to = customData.to || '';
    state.from = customData.from || '';
    var appOrigin = customData.u || '';
    var accessToken = customData.tok || '';
    // Identity for every callback comes from the URL-path token resolved
    // server-side — the scenario no longer knows the attempt id, so it never
    // asserts one (invitation_id stays null and is ignored by the cb route).
    state.invitationId = null;
    if (!state.to || !state.from || !appOrigin || !accessToken) {
        log('Missing required fields in customData: ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    state.callbackUrl = appOrigin + '/api/voximplant/cb/' + accessToken;
    state.contextUrl = appOrigin + '/api/voximplant/ctx/' + accessToken;
    // Remote hangup — POST to media_session_access_url from Kalfa backend
    // (triggered by /dashboard/calling "Hang up" button).
    VoxEngine.addEventListener(AppEvents.HttpRequest, function (ev) {
        log('Remote hangup requested: ' + safeStringify(ev && ev.content ? ev.content : {}));
        state.shuttingDown = true;
        clearTimers();
        postFinalCallbackOnce({
            call_status: 'cancelled',
            call_duration: 0,
            rsvp_digit: null,
            invitation_id: state.invitationId,
            recording_url: state.recordingUrl
        }, function () {
            VoxEngine.terminate();
        });
    });
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code + ' ' + response.text);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                state.guestName = normalizeForSpeech(ctx.guest_name || '');
                state.eventName = normalizeForSpeech(ctx.event_name || '');
                state.eventDate = normalizeForSpeech(ctx.event_date || '');
                state.eventVenue = normalizeForSpeech(ctx.event_venue || '');
                // Branch B: the Groq key is delivered here (token-gated), not in
                // customData, so it never appears in call-history custom data.
                state.groqKey = ctx.groq_key || '';
            }
            catch (err) {
                log('Context parse error: ' + err);
            }
        }
        log('About to create PSTN call');
        var call = VoxEngine.callPSTN(state.to, state.from);
        log('About to create ASR');
        var asr = VoxEngine.createASR({
            profile: ASRProfileList.Google.he_IL,
            singleUtterance: true,
            interimResults: false
        });
        log('ASR object created, about to attach listeners');
        asr.addEventListener(ASREvents.Result, function (ev) {
            var text = ev.text || '';
            log('ASR result: ' + text);
            stopAsr(call, asr);
            if (!text) {
                sayLogged(call, 'לא שמעתי היטב. אפשר לומר כן, לא, או ללחוץ על המקשים.');
                return;
            }
            state.transcriptParts.push({
                speaker: 'guest',
                text: text,
                at: new Date().toISOString()
            });
            handleVoiceIntent(text, call, asr);
        });
        call.addEventListener(CallEvents.Connected, function () {
            state.callWasConnected = true;
            log('Call connected');
            call.handleTones(true);
            try {
                call.record();
            }
            catch (err) {
                log('record() failed: ' + err);
            }
            sayLogged(call, buildMainMessage());
        });
        call.addEventListener(CallEvents.RecordStarted, function (ev) {
            state.recordingUrl = ev.url || null;
            log('Recording URL: ' + state.recordingUrl);
            postCallback({
                call_status: 'recording_started',
                invitation_id: state.invitationId,
                recording_url: state.recordingUrl
            });
        });
        call.addEventListener(CallEvents.PlaybackFinished, function () {
            log('Playback finished');
            if (state.shuttingDown)
                return;
            // Delay ASR start so acoustic coupling from the guest's handset
            // (TTS echoes back via phone speaker → mic → PSTN) has time to
            // fade. Without this, Google ASR captured our own TTS as the
            // guest's "speech" and polluted the transcript.
            setTimeout(function () {
                if (state.shuttingDown)
                    return;
                startAsr(call, asr);
            }, 700);
        });
        call.addEventListener(CallEvents.ToneReceived, function (ev) {
            var digit = ev.tone;
            log('Tone received: ' + digit);
            stopAsr(call, asr);
            if (digit === '9') {
                call.stopPlayback();
                sayLogged(call, buildMainMessage());
                return;
            }
            if (digit === '1' || digit === '2') {
                finalizeChoice(call, digit, 'dtmf');
            }
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            clearTimers();
            postFinalCallbackOnce({
                call_status: 'failed',
                call_duration: 0,
                rsvp_digit: null,
                invitation_id: state.invitationId,
                recording_url: state.recordingUrl
            }, function () {
                VoxEngine.terminate();
            });
        });
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('Call disconnected: ' + safeStringify(ev));
            clearTimers();
            var duration = ev && ev.duration ? ev.duration : 0;
            var wasAnswered = state.callWasConnected || duration > 0;
            if (!state.callbackSent) {
                postFinalCallbackOnce({
                    call_status: wasAnswered ? 'no_response' : 'no_answer',
                    call_duration: duration,
                    rsvp_digit: null,
                    invitation_id: state.invitationId,
                    recording_url: state.recordingUrl
                }, function () {
                    VoxEngine.terminate();
                });
                return;
            }
            VoxEngine.terminate();
        });
    }).catch(function (err) {
        log('Call flow initialization failed after context load: ' + err);
        postFinalCallbackOnce({
            call_status: 'failed',
            call_duration: 0,
            rsvp_digit: null,
            invitation_id: state.invitationId,
            error_reason: 'call_flow_initialization_failed'
        }, function () {
            VoxEngine.terminate();
        });
    });
});
