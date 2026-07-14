require(Modules.ASR);
VoxEngine.addEventListener(AppEvents.Started, function () {
    var ttsOptions = {
        voice: VoiceList.Google.he_IL_Chirp3_HD_Aoede
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
        finalHangupTimer: null
    };
    function log(msg) {
        Logger.write('[RSVP] ' + msg);
    }
    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        }
        catch (e) {
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
        postCallback(payload, done);
    }
    function buildMainMessage() {
        var parts = [];
        parts.push(state.guestName ? 'שלום, ' + state.guestName + '.' : 'שלום.');
        parts.push(state.eventName
            ? 'אנו מתקשרים אליך בנוגע לאירוע ' + state.eventName + '.'
            : 'אנו מתקשרים אליך בנוגע לאירוע.');
        if (state.eventDate) {
            parts.push('האירוע יתקיים בתאריך ' + state.eventDate + '.');
        }
        if (state.eventVenue) {
            parts.push('מקום האירוע הוא ' + state.eventVenue + '.');
        }
        parts.push('לאישור הגעה, לחץ 1.');
        parts.push('לדחייה, לחץ 2.');
        parts.push('לשמיעה חוזרת, לחץ 9.');
        parts.push('אפשר גם לומר כן, לא, או חזרה.');
        return parts.join(' ');
    }
    function scheduleHangup(call, delayMs) {
        if (state.shuttingDown)
            return;
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
            call.say('לא שמעתי תשובה. אפשר לומר כן, לא, או חזרה. אפשר גם ללחוץ 1, 2 או 9.', ttsOptions);
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
        call.say(confirmation, ttsOptions);
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
    function handleVoiceIntent(text, call, asr) {
        if (!state.groqKey) {
            log('No Groq key, cannot process voice response');
            call.say('לא הבנתי. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.', ttsOptions);
            return;
        }
        var groqPayload = {
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'החזר רק תו אחד: 1 אם המשתמש מאשר הגעה, 2 אם המשתמש דוחה הגעה, 9 אם לא ברור.'
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
                    call.say('אירעה תקלה בזיהוי התשובה. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.', ttsOptions);
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
                call.say(buildMainMessage(), ttsOptions);
            }
            else {
                call.say('לא הבנתי. אפשר לומר כן, לא, או חזרה. אפשר גם ללחוץ 1, 2 או 9.', ttsOptions);
            }
        })
            .catch(function (err) {
            log('Groq request failed: ' + err);
            call.say('אירעה תקלה בזיהוי התשובה. אנא לחץ 1 לאישור, 2 לדחייה, או 9 לשמיעה חוזרת.', ttsOptions);
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
    state.to = customData.to || '';
    state.from = customData.from || '';
    state.invitationId = customData.iid || null;
    state.callbackUrl = customData.cb || '';
    state.contextUrl = customData.ctx || '';
    state.groqKey = customData.gk || '';
    if (!state.to || !state.from || !state.invitationId || !state.callbackUrl || !state.contextUrl) {
        log('Missing required fields in customData: ' + safeStringify(customData));
        VoxEngine.terminate();
        return;
    }
    Net.httpRequestAsync(state.contextUrl).then(function (response) {
        log('Context response: ' + response.code + ' ' + response.text);
        if (response.code === 200 && response.text) {
            try {
                var ctx = JSON.parse(response.text);
                state.guestName = normalizeForSpeech(ctx.guest_name || '');
                state.eventName = normalizeForSpeech(ctx.event_name || '');
                state.eventDate = normalizeForSpeech(ctx.event_date || '');
                state.eventVenue = normalizeForSpeech(ctx.event_venue || '');
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
                call.say('לא שמעתי היטב. אפשר לומר כן, לא, או ללחוץ על המקשים.', ttsOptions);
                return;
            }
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
            call.say(buildMainMessage(), ttsOptions);
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
            // אחרי כל הודעה, פותחים הקשבה קולית
            startAsr(call, asr);
        });
        call.addEventListener(CallEvents.ToneReceived, function (ev) {
            var digit = ev.tone;
            log('Tone received: ' + digit);
            stopAsr(call, asr);
            if (digit === '9') {
                call.stopPlayback();
                call.say(buildMainMessage(), ttsOptions);
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
