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
//   NOTE on SSML: DISPROVEN on a live call (session 6756017978). Despite the d.ts
//   say() doc referencing a <say-as> tag, this account's Google he-IL say() spoke
//   SSML LITERALLY ("<sub alias=...>" -> "קטן-מ SAB ALIAS שווה…") and the raw tags
//   broke playback (terminal PlaybackFinished never fired). => NO SSML in say() here.
//   Pronunciation is tuned with niqqud only (plain combining Unicode, safe-by-
//   degradation: ignored niqqud just reads the bare word, never garbage).
VoxEngine.addEventListener(AppEvents.Started, function () {
    var ttsOptions = {
        voice: VoiceList.Google.he_IL_Wavenet_A
    };
    // PREVIEW placeholders: event_owner + event_type do NOT exist in the ctx
    // response yet. In production they will arrive from the ctx endpoint after a
    // backend change; for this preview they are fixed demo values.
    // Pronunciation fix (tag-free): Google he-IL Wavenet read "קלפה" as "כלפה".
    // SSML was tried and PROVEN WRONG on a live call — say() spoke the tags aloud
    // ("קטן-מ SAB ALIAS…") — so we use ONLY niqqud (combining Unicode marks). Niqqud
    // is safe-by-degradation: if the voice ignores it, it simply reads "קלפה" as
    // before (never garbage). Qamatz on the kuf pushes a hard "ka". This constant
    // flows into ALL family-name occurrences, so the fix is applied in one place.
    var PREVIEW_EVENT_OWNER = 'משפחת קָלְפָה';
    var PREVIEW_EVENT_TYPE = 'הברית';
    // Global hard limit — a leaked session bills money. Close politely at 90s.
    var GLOBAL_TIMEOUT_MS = 90000;
    // C1: quantity-entry pacing. The listening window opens the instant the count
    // question finishes playing. After the last digit we auto-submit within a short
    // inter-digit window so the wait is never read as dead-air (gap < 2s target).
    var COUNT_INTERDIGIT_MS = 1500;
    var COUNT_NOINPUT_MS = 4500;
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
        awaitOptOut: false,
        optOutOffered: false,
        finished: false,
        finalLinePlaying: false,
        hangupScheduled: false,
        promptTimer: null,
        countTimer: null,
        hangupTimer: null,
        fallbackHangupTimer: null,
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
    function clearCountTimer() {
        if (state.countTimer) {
            clearTimeout(state.countTimer);
            state.countTimer = null;
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
    function clearFallbackHangupTimer() {
        if (state.fallbackHangupTimer) {
            clearTimeout(state.fallbackHangupTimer);
            state.fallbackHangupTimer = null;
        }
    }
    // End the call on a terminal branch: say the closing line, then hang up the
    // MOMENT that line finishes playing (CallEvents.PlaybackFinished) — NOT on a
    // fixed short timer, which previously truncated long closings (e.g. the count
    // confirmation). A long fallback timer guards against a missing PlaybackFinished
    // so the session can never leak. No cb is sent (preview).
    function finish(call, text) {
        if (state.finished)
            return;
        state.finished = true;
        state.stage = 'done';
        state.finalLinePlaying = true;
        clearPromptTimer();
        clearCountTimer();
        sayLogged(call, text);
        // Safety net only: normally the terminal CallEvents.PlaybackFinished fires and
        // hangs up (cleared below). With SSML removed, playback is well-formed so it
        // WILL fire. As a bound on any silent tail if it somehow doesn't, estimate the
        // spoken length from the text (~130ms/char, niqqud marks over-count harmlessly)
        // and cap it to 4.5-9s — long enough never to truncate, short enough to avoid
        // a long dead tail.
        clearFallbackHangupTimer();
        var fallbackMs = Math.min(9000, Math.max(4500, text.length * 130));
        state.fallbackHangupTimer = setTimeout(function () {
            log('Final-line PlaybackFinished not seen — fallback hangup after ' + fallbackMs + 'ms.');
            scheduleHangup(call, 0);
        }, fallbackMs);
    }
    // C1: submit the guest count and close. Empty count => generic confirmation.
    function submitCount(call) {
        if (state.finished || state.stage !== 'guest_count')
            return;
        clearCountTimer();
        call.stopPlayback();
        if (state.countDigits.length === 0) {
            finish(call, 'רשמתי אתכם. את המספר המדויק תעדכנו בוואטסאפ. נתראה!');
        }
        else {
            // Pronunciation fix (tag-free): niqqud only sharpens "מחכים לכם"; no SSML
            // <break> (say() would speak the tag aloud). The comma before it gives a
            // natural spoken pause without any markup.
            finish(call, 'מעולה, ' + state.countDigits + '. רשמתי. ' +
                PREVIEW_EVENT_OWNER + ', מְחַכִּים לָכֶם — נתראה!');
        }
    }
    function armCountTimer(call, delayMs) {
        clearCountTimer();
        state.countTimer = setTimeout(function () {
            submitCount(call);
        }, delayMs);
    }
    function rsvpAskText() {
        // F1: legal AI self-identification at the head of the FIRST ask — who is
        // calling + why, in the first sentence (Israeli automated-call compliance).
        return 'זו שיחה אוטומטית מטעם ' + PREVIEW_EVENT_OWNER + ', בקשר ל' +
            PREVIEW_EVENT_TYPE + '. מגיעים? לאישור לחצו 1, אם לא תגיעו לחצו 2, ' +
            'אם עדיין לא בטוח לחצו 3.';
    }
    function askRsvp(call, isFirst) {
        state.stage = 'rsvp_ask';
        state.countDigits = '';
        sayLogged(call, rsvpAskText());
        // F2: the opt-out line is spoken ONLY after the first ask, after a short
        // pause. It is chained on the natural PlaybackFinished of this ask (not on a
        // reprompt, not in the count stage). stopPlayback() does not fire
        // PlaybackFinished, so pressing a key before it plays cancels the offer.
        if (isFirst && !state.optOutOffered) {
            state.awaitOptOut = true;
        }
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
            sayLogged(call, 'רגע, לא קלטתי. אם מגיעים לחצו 1, אם לא — לחצו 2, ואם עוד לא בטוח — לחצו 3.');
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
            // Fix 1: the terminal closing line just finished playing in full — hang
            // up now (with a brief natural tail). Checked BEFORE the `finished`
            // early-return, because finish() sets finished=true. stopPlayback() does
            // NOT emit PlaybackFinished, so this only fires for the real say() end.
            if (state.finalLinePlaying) {
                state.finalLinePlaying = false;
                clearFallbackHangupTimer();
                log('Final line finished playing — hanging up.');
                scheduleHangup(call, 600);
                return;
            }
            if (state.finished)
                return;
            if (state.stage === 'greeting') {
                askRsvp(call, true);
                return;
            }
            // F2: after the first ask finishes playing naturally, speak the opt-out
            // line once, after this short pause.
            if (state.stage === 'rsvp_ask' && state.awaitOptOut && !state.optOutOffered) {
                state.awaitOptOut = false;
                state.optOutOffered = true;
                sayLogged(call, 'ולהסרה מהרשימה — לחצו אפס.');
                return;
            }
            // C1: the moment the count question finishes, open the listening window.
            if (state.stage === 'guest_count' && state.countDigits.length === 0) {
                armCountTimer(call, COUNT_NOINPUT_MS);
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
                else if (digit === '0') {
                    // F2: opt-out. Preview does NOT send a cb — it only logs.
                    call.stopPlayback();
                    log('OPT_OUT (0)');
                    finish(call, 'הוסרת. לא נטריד יותר. סליחה על ההפרעה, יום טוב.');
                }
                else if (digit === '9') {
                    call.stopPlayback();
                    askRsvp(call, false);
                }
                // Any other key: ignore, stay in rsvp_ask.
                return;
            }
            if (state.stage === 'guest_count') {
                if (digit === '#') {
                    submitCount(call);
                }
                else if (digit >= '0' && digit <= '9') {
                    // Accumulate the count (cap length defensively).
                    if (state.countDigits.length < 3) {
                        state.countDigits += digit;
                    }
                    // C1: short inter-digit window — auto-submit soon after the last
                    // key so the caller never waits on '#'. Reset on every digit.
                    armCountTimer(call, COUNT_INTERDIGIT_MS);
                }
                // '*' or other: ignore.
                return;
            }
        });
        call.addEventListener(CallEvents.Failed, function (ev) {
            log('Call failed: ' + safeStringify(ev));
            clearPromptTimer();
            clearCountTimer();
            clearFallbackHangupTimer();
            VoxEngine.terminate();
        });
        call.addEventListener(CallEvents.Disconnected, function (ev) {
            log('Call disconnected: ' + safeStringify(ev));
            clearPromptTimer();
            clearCountTimer();
            clearFallbackHangupTimer();
            VoxEngine.terminate();
        });
    }
});
