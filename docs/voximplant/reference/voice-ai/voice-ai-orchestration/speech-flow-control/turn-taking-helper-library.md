> מקור: https://docs.voximplant.ai/voice-ai-orchestration/speech-flow-control/turn-taking-helper-library
> נשמר: 2026-09-14

# Turn Taking Helper Library

Speech Flow Control
Turn Taking Helper Library

Reusable VoxEngine helper for STT + VAD + Pipecat Smart Turn pipelines

Ask a question
|
Copy page
|
View as Markdown
|
More actions

For the complete documentation index, see llms.txt.

Overview

VoxTurnTaking is a reusable VoxEngine helper scenario that packages the current turn-taking policy used in full-cascade examples. It exists to keep your main scenario focused on STT, LLM, and TTS wiring while the helper owns the mechanics of barge-in, transcript accumulation, end-of-turn prediction, and fallback timing.

The design goal is pragmatic:

simplify turn-taking implementations in VoxEngine scenarios
add key timers and policy controls that are common in production turn-taking flows
stay close to Pipecat Smart Turn concepts

How it works

A user turn stays open until the helper decides to submit it. Silero VAD, Pipecat turn detection, STT results, and local timeouts are only signals that help make that decision.

Turn lifecycle

The helper keeps one open user turn in memory. As transcripts arrive, it accumulates them until there is enough evidence to submit the turn to your LLM.

The main signals are:

Silero VAD: detects when speech starts and stops
Pipecat turn detection: predicts whether the caller is probably finished
STT: provides interim and final transcript text
local timers: handle grace periods and fallback behavior when STT or turn detection are late or uncertain

The turn does not end when VAD fires or when Pipecat returns endOfTurn. Those events are only evidence that the user may be finished.

This distinction matters because both signals can be early or incomplete:

VAD only knows that speech stopped, not whether the thought is complete
Pipecat predicts end-of-turn, but STT may still be landing the final words
callers often pause, restart, self-correct, or begin with short disfluencies such as um or and that indicate they are formulating/continuing a thought rather than finishing

If the helper treated those signals as hard turn boundaries, it would submit too many clipped or fragmented turns. Instead, VoxTurnTaking keeps the turn open until it has enough evidence to actually commit the transcript and call onUserTurn(input, reason).

End-of-turn parameters often vary by language, use case, and LLM behavior. The helper lets you configure them through the policy option, which is layered on top of Voximplant’s current Silero and Pipecat surface.

Barge-in handling

In a full-cascade pipeline, barge-in is not just “detect speech and stop audio.” There are two separate responsibilities:

The helper detects the interruption. VoxTurnTaking listens for speechStartAt from Silero VAD. When new user speech starts, it marks agent audio as no longer safe to forward and calls your onInterrupt() callback.
Your scenario stops playback. Inside onInterrupt(), the consuming scenario should clear any queued or currently buffered TTS playback for the active turn.

The helper owns turn state and interruption policy. You should choose an interruption approach based on your TTS provider and playback policy.

In practice, the barge-in path often looks like this:

The agent is speaking and response text is being streamed to TTS
The caller starts talking
Silero emits speechStartAt (handled in the helper)
VoxTurnTaking marks agent audio as interrupted and calls onInterrupt() (handled in the helper)
Your scenario clears buffered TTS audio
Additional stale text deltas from the interrupted response are ignored until the next user turn is submitted.
Agent audio gating

turnTaking.canPlayAgentAudio() is the guard on the downstream text-to-speech path. It answers a simple question:

should this response text still be spoken to the caller?

The LLM and TTS pipeline are asynchronous - even after the caller interrupts, the LLM may continue emitting ResponseTextDelta events for the now-stale assistant response.

With this gate:

once VoxTurnTaking marks the agent response as interrupted, canPlayAgentAudio() returns false
the scenario drops those stale deltas instead of forwarding them to TTS
agent audio only becomes allowed again after the helper submits the next user turn
Policy options

The policy object is where the helper adds practical turn-taking behavior on top of Voximplant’s current Silero and Pipecat surface.

The options fall into a few groups:

settle timing - transcriptSettleMs gives STT a short extra window after Pipecat thinks the user may be done
default fallback timing - userSpeechTimeoutMs is the standard “wait a bit more, then submit” timeout after speechEndAt
short-utterance handling - shortUtteranceExtensionMs, fastShortUtteranceTimeoutMs, shortUtteranceMaxChars, and shortUtteranceMaxWords let the helper treat short fragments differently from longer turns
replaceable short finals - lowConfidenceShortUtteranceThreshold keeps weak short finals open so they can be replaced by later STT
continuation cues - continuationTokens helps hold turns open when the user starts with fragments such as and, so, or um

Callers often pause, restart, hedge, and self-correct. These policy controls prevent short fragments from becoming clipped, standalone turns.

Cleanup and shutdown

turnTaking.close() is the helper’s call-scoped shutdown path. It:

clears active fallback and settle timers
closes the Silero VAD instance
closes the Pipecat turn detector instance

VAD and turn detector connectors are live per-call resources and should be closed to avoid accidental charges. In addition, the helper keeps call-local timers and turn-state flags in memory. Cleanup avoids late timer callbacks or stale events during termination

How to use it
1. Include the helper before your scenario

VoxTurnTaking is implemented as a sequenced VoxEngine scenario, not a JavaScript module. That matters because VoxEngine routing-rule sequencing shares global scope.

Include vox-turn-taking before your main scenario in the same routing rule sequence.

For the routing-rule setup flow in the Control Panel, see Setup routing.

2. Create STT, LLM, and TTS in the consuming scenario

The helper owns Silero and Pipecat. Your main scenario still owns:

STT
LLM / Responses client
TTS
agent prompts
what happens when barge-in interrupts playback

This separation is useful when you are mixing providers in a full-cascade pipeline, for example Deepgram + Groq via the OpenAI Responses client + Inworld.

3. Create the helper runtime
turnTaking = await VoxTurnTaking.create({
  call,
  stt,
  vadOptions: {
    threshold: 0.5,
    minSilenceDurationMs: 300,
    speechPadMs: 10,
  },
  turnDetectorOptions: {
    threshold: 0.5,
  },
  policy: {
    transcriptSettleMs: 500,
    userSpeechTimeoutMs: 1000,
    shortUtteranceExtensionMs: 1800,
    fastShortUtteranceTimeoutMs: 700,
    shortUtteranceMaxChars: 12,
    shortUtteranceMaxWords: 2,
    lowConfidenceShortUtteranceThreshold: 0.75,
    continuationTokens: ["and", "but", "so", "well", "then", "uh", "um"],
  },
  enableLogging: true,
  onUserTurn: (input, reason) => {
    responsesClient.createResponses({
      model: "llama-3.3-70b-versatile",
      instructions: SYSTEM_PROMPT,
      input,
    });
  },
  onInterrupt: () => {
    ttsPlayer.clearBuffer();
  },
});
4. Gate agent audio through the helper
responsesClient.addEventListener(
  OpenAI.ResponsesAPIEvents.ResponseTextDelta,
  (event) => {
    const text = event?.data?.payload?.delta;
    if (!text || !turnTaking.canPlayAgentAudio()) return;
    ttsPlayer.send({ send_text: { text } });
  },
);
5. Clean up on disconnect
call.addEventListener(CallEvents.Disconnected, () => {
  turnTaking?.close();
  VoxEngine.terminate();
});
Public API
Required options
Option	Type	What it does
call	Call	Call whose inbound media is analyzed by VAD and turn detection.
stt	ASR	STT instance created by the consuming scenario. The helper listens for interim and final transcripts.
onUserTurn	function	Called when the helper decides the current user turn is ready to submit to the LLM.
Optional options
Option	Type	Default	What it does
onInterrupt	function	none	Called when a new speechStartAt indicates barge-in. Use it to stop queued agent audio.
enableLogging	boolean	false	Emits debug logs for turn-taking decisions.
logger	function	Logger.write	Custom logger used when enableLogging is enabled.
vadOptions	object	helper defaults	Passed to Silero.createVAD() after merging with defaults.
turnDetectorOptions	object	helper defaults	Passed to Pipecat.createTurnDetector() after merging with defaults.
policy	object	helper defaults	Local policy layered on top of Voximplant’s current Silero and Pipecat surface.
Helper parameters
VAD options

These are forwarded to Silero.createVAD().

Option	Default	What it does
threshold	0.5	Speech probability threshold for VAD.
minSilenceDurationMs	300	Silence duration required before speechEndAt.
speechPadMs	10 in the example, 0 in the raw module default	Padding around detected speech segments.
Turn detector options

These are forwarded to Pipecat.createTurnDetector().

Option	Default	What it does
threshold	0.5	End-of-turn probability threshold used by Pipecat.
Helper policy options

These are local helper controls, not native Silero or Pipecat parameters.

Option	Default	What it does
transcriptSettleMs	500	Short grace window after Pipecat says the turn may be complete but the final STT chunk has not landed yet.
userSpeechTimeoutMs	1000	Default fallback timeout after speechEndAt.
shortUtteranceExtensionMs	1800	Longer hold for short fragments that may be followed by more speech.
fastShortUtteranceTimeoutMs	700	Faster fallback for very short utterances that are likely complete, such as a standalone greeting.
shortUtteranceMaxChars	12	Maximum length still treated as a short fragment.
shortUtteranceMaxWords	2	Maximum word count still treated as a short fragment.
lowConfidenceShortUtteranceThreshold	0.75	Below this confidence, a short final transcript stays replaceable instead of being committed immediately.
continuationTokens	and, but, so, well, then, uh, um	Short leading words that often indicate the caller is continuing a thought rather than finishing a turn.
Return value

VoxTurnTaking.create() returns an object with:

Field	Type	What it does
vad	Silero.VAD	The Silero VAD instance created by the helper.
turnDetector	Pipecat.TurnDetector	The Pipecat detector instance created by the helper.
canPlayAgentAudio()	function	Returns whether agent audio should still be forwarded to TTS.
close()	function	Clears timers and closes the helper-owned VAD and turn detector.
Turn Taking Helper Code
voxeengine-vox-turn-taking.js
/**
 * Voximplant turn-taking runtime for sequenced scenarios.
 *
 * Include this scenario BEFORE any scenario that wants to use VoxTurnTaking
 * in the same routing rule sequence.
 *
 * This runtime hides the current Silero + Pipecat + timer-based turn policy
 * behind a small API so scenarios stay simple today and can transition more
 * easily if Voximplant later exposes a more Pipecat-native Smart Turn model.
 */
require(Modules.ASR);
require(Modules.Silero);
require(Modules.Pipecat);
// eslint-disable-next-line no-unused-vars
const VoxTurnTaking = {
    DEFAULTS: {
        vadOptions: {
            threshold: 0.5,
            minSilenceDurationMs: 300,
            speechPadMs: 10,
        },
        turnDetectorOptions: {
            threshold: 0.5,
        },
        policy: {
            transcriptSettleMs: 500,
            userSpeechTimeoutMs: 1000,
            shortUtteranceExtensionMs: 1800,
            fastShortUtteranceTimeoutMs: 700,
            shortUtteranceMaxChars: 12,
            shortUtteranceMaxWords: 2,
            lowConfidenceShortUtteranceThreshold: 0.75,
            continuationTokens: ["and", "but", "so", "well", "then", "uh", "um"],
        },
    },
    /**
     * Creates a turn-taking controller around a call, STT engine, Silero VAD,
     * and Pipecat turn detector.
     *
     * A user turn stays open until this runtime calls `onUserTurn()`. Silero,
     * Pipecat, and the timeout policy only provide evidence that the current
     * turn may be ready to submit.
     *
     * @param {object} options
     * @param {Call} options.call
     *   Active VoxEngine call whose inbound media should be analyzed.
     * @param {ASR} options.stt
     *   Speech-to-text engine already configured by the consuming scenario.
     * @param {(input: string, reason: string) => void} options.onUserTurn
     *   Callback invoked when the accumulated user turn should be submitted to
     *   the LLM.
     * @param {() => void} [options.onInterrupt]
     *   Callback invoked on barge-in so the consuming scenario can stop agent
     *   playback and flush TTS state.
     * @param {boolean} [options.enableLogging=false]
     *   When true, emits debug logs for turn-taking decisions. Disabled by
     *   default so scenarios can keep logs quiet unless they are debugging.
     * @param {(line: string) => void} [options.logger]
     *   Optional logger used when `enableLogging` is true.
     * @param {object} [options.vadOptions]
     *   Silero VAD options merged over `VoxTurnTaking.DEFAULTS.vadOptions`.
     * @param {number} [options.vadOptions.threshold]
     *   Voice activity threshold passed to `Silero.createVAD()`.
     * @param {number} [options.vadOptions.minSilenceDurationMs]
     *   Silence required before Silero emits `speechEndAt`.
     * @param {number} [options.vadOptions.speechPadMs]
     *   Padding used around detected speech segments.
     * @param {object} [options.turnDetectorOptions]
     *   Pipecat options merged over
     *   `VoxTurnTaking.DEFAULTS.turnDetectorOptions`.
     * @param {number} [options.turnDetectorOptions.threshold]
     *   End-of-turn probability threshold passed to
     *   `Pipecat.createTurnDetector()`.
     * @param {object} [options.policy]
     *   Local policy layered on top of Silero and Pipecat to bridge gaps in
     *   the current API.
     * @param {number} [options.policy.transcriptSettleMs]
     *   Extra ASR grace period after Pipecat signals end-of-turn but a final
     *   transcript chunk has not arrived yet.
     * @param {number} [options.policy.userSpeechTimeoutMs]
     *   Default fallback timeout started after `speechEndAt`.
     * @param {number} [options.policy.shortUtteranceExtensionMs]
     *   Longer hold time used for short fragments that may be followed by a
     *   continuation.
     * @param {number} [options.policy.fastShortUtteranceTimeoutMs]
     *   Shorter fallback used for brief, high-confidence utterances that are
     *   likely complete, such as a standalone greeting.
     * @param {number} [options.policy.shortUtteranceMaxChars]
     *   Maximum character count considered a short fragment.
     * @param {number} [options.policy.shortUtteranceMaxWords]
     *   Maximum word count considered a short fragment.
     * @param {number} [options.policy.lowConfidenceShortUtteranceThreshold]
     *   Confidence threshold below which a short final transcript stays
     *   replaceable instead of being committed immediately.
     * @param {string[]} [options.policy.continuationTokens]
     *   Short leading words that usually indicate the caller is continuing a
     *   thought rather than finishing a turn.
     * @returns {Promise<object>}
     * @returns {object} return.vad
     *   Silero VAD instance created by the runtime.
     * @returns {object} return.turnDetector
     *   Pipecat turn detector instance created by the runtime.
     * @returns {() => boolean} return.canPlayAgentAudio
     *   Indicates whether agent audio should still be forwarded to TTS.
     * @returns {() => void} return.close
     *   Cleans up timers and closes the VAD and turn detector.
     */
    async create(options) {
        const {
            call,
            stt,
            onUserTurn,
            onInterrupt,
            enableLogging = false,
            logger = (line) => Logger.write(line),
        } = options;
        const vadOptions = Object.assign({}, this.DEFAULTS.vadOptions, options.vadOptions);
        const turnDetectorOptions = Object.assign(
            {},
            this.DEFAULTS.turnDetectorOptions,
            options.turnDetectorOptions
        );
        const policy = Object.assign({}, this.DEFAULTS.policy, options.policy);
        const vad = await Silero.createVAD(vadOptions);
        const turnDetector = await Pipecat.createTurnDetector(turnDetectorOptions);
        call.sendMediaTo(vad);
        call.sendMediaTo(turnDetector);
        const log = (line) => {
            if (enableLogging) logger(line);
        };
        const emitModuleEvent = (eventName, event) => {
            logger(`===${eventName}===`);
            if (event) logger(JSON.stringify(event));
        };
        let fallbackTimer;
        let settleTimer;
        let finalTranscript = "";
        let interimTranscript = "";
        let transcriptSeparator = "";
        let smartTurnComplete = false;
        let acceptingTranscript = false;
        let signalVersion = 0;
        let allowAgentAudio = true;
        let lastFinalConfidence = 1;
        let replaceableShortFinal = false;
        let shortExtensionApplied = false;
        const clearTimers = () => {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            if (settleTimer) clearTimeout(settleTimer);
            fallbackTimer = null;
            settleTimer = null;
        };
        const normalizeConfidence = (value) => {
            if (typeof value !== "number" || Number.isNaN(value)) return null;
            return value > 1 ? value / 100 : value;
        };
        const isShortUtterance = (text) => {
            if (!text) return false;
            const words = text.trim().split(/\s+/).filter(Boolean);
            return (
                text.length <= policy.shortUtteranceMaxChars &&
                words.length <= policy.shortUtteranceMaxWords
            );
        };
        const startsWithContinuationToken = (text) => {
            if (!text) return false;
            const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase();
            return policy.continuationTokens.includes(firstWord);
        };
        const buildInput = () => {
            let input = finalTranscript;
            if (interimTranscript) {
                if (input) input += transcriptSeparator;
                input += interimTranscript;
            }
            return input.trim();
        };
        const submitCurrentTurn = (reason) => {
            const input = buildInput();
            if (!input) return false;
            // Hold short replaceable fragments open for one extra window so
            // resumed speech can overwrite them. After that extension, submit
            // the turn instead of looping forever.
            if (replaceableShortFinal && !shortExtensionApplied) {
                shortExtensionApplied = true;
                startHardTimeout(signalVersion, policy.shortUtteranceExtensionMs);
                return false;
            }
            log(`===${reason}===`);
            log(`===USER=== ${input}`);
            allowAgentAudio = true;
            onUserTurn(input, reason);
            finalTranscript = "";
            interimTranscript = "";
            transcriptSeparator = "";
            smartTurnComplete = false;
            acceptingTranscript = false;
            lastFinalConfidence = 1;
            replaceableShortFinal = false;
            shortExtensionApplied = false;
            signalVersion += 1;
            clearTimers();
            return true;
        };
        const startHardTimeout = (version, delay = policy.userSpeechTimeoutMs) => {
            clearTimers();
            fallbackTimer = setTimeout(() => {
                if (version !== signalVersion) return;
                const input = buildInput();
                if (!input) return;
                submitCurrentTurn("FALLBACK_END_OF_TURN");
            }, delay);
        };
        // Connector information and error events are part of the module's core
        // contract, so log them here instead of making every consuming scenario
        // re-register the same listeners.
        [
            Silero.VADEvents.ConnectorInformation,
            Silero.VADEvents.Error,
        ].forEach((eventName) => {
            vad.addEventListener(eventName, (event) => emitModuleEvent(eventName, event));
        });
        [
            Pipecat.TurnEvents.ConnectorInformation,
            Pipecat.TurnEvents.Error,
        ].forEach((eventName) => {
            turnDetector.addEventListener(eventName, (event) =>
                emitModuleEvent(eventName, event)
            );
        });
        stt.addEventListener(ASREvents.InterimResult, (event) => {
            if (!acceptingTranscript) return;
            const text = event?.text?.trim();
            if (!text) return;
            if (!transcriptSeparator && finalTranscript) transcriptSeparator = " ";
            interimTranscript = text;
        });
        stt.addEventListener(ASREvents.Result, (event) => {
            if (!acceptingTranscript) return;
            const text = event?.text?.trim();
            if (!text) return;
            const confidence = normalizeConfidence(event?.confidence);
            const hadCommittedPrefix = !!finalTranscript;
            // A short low-confidence fragment like "they" or "so" is often an
            // early clipped piece of a longer utterance. Keep it replaceable so
            // the next final STT chunk can overwrite it. Also keep short
            // trailing chunks replaceable when they arrive after an existing
            // transcript prefix, which helps prevent submits like
            // "do they support open" before the final "AI" lands.
            if (replaceableShortFinal) {
                finalTranscript = text;
            } else {
                if (finalTranscript) finalTranscript += transcriptSeparator || " ";
                finalTranscript += text;
            }
            interimTranscript = "";
            transcriptSeparator = " ";
            lastFinalConfidence = confidence === null ? 1 : confidence;
            replaceableShortFinal =
                isShortUtterance(text) &&
                (
                    hadCommittedPrefix ||
                    lastFinalConfidence < policy.lowConfidenceShortUtteranceThreshold ||
                    startsWithContinuationToken(text)
                );
            shortExtensionApplied = false;
            log(`===STT Final: ${event.text}`);
            if (isShortUtterance(text) && !replaceableShortFinal && !smartTurnComplete) {
                startHardTimeout(
                    signalVersion,
                    Math.min(
                        policy.userSpeechTimeoutMs,
                        policy.fastShortUtteranceTimeoutMs
                    )
                );
            }
            if (smartTurnComplete) submitCurrentTurn("TURN_DETECT: FINAL_TRANSCRIPT");
        });
        vad.addEventListener(Silero.VADEvents.Result, (event) => {
            if (event.speechStartAt) {
                signalVersion += 1;
                clearTimers();
                smartTurnComplete = false;
                acceptingTranscript = true;
                allowAgentAudio = false;
                if (finalTranscript || interimTranscript) transcriptSeparator = " ... ";
                log("===BARGE-IN===");
                if (onInterrupt) onInterrupt();
            }
            if (event.speechEndAt) {
                startHardTimeout(signalVersion);
                turnDetector.predict();
            }
        });
        turnDetector.addEventListener(Pipecat.TurnEvents.Result, (event) => {
            log(
                `===Pipecat.TurnEvents.Result=== ${JSON.stringify(event.probability)}`
            );
            if (!event.endOfTurn) return;
            smartTurnComplete = true;
            if (finalTranscript) {
                submitCurrentTurn("TURN_DETECT: END_OF_TURN");
                return;
            }
            if (settleTimer) clearTimeout(settleTimer);
            const version = signalVersion;
            settleTimer = setTimeout(() => {
                if (version !== signalVersion) return;
                submitCurrentTurn("TURN_DETECT: ASR_GRACE");
            }, policy.transcriptSettleMs);
        });
        return {
            vad,
            turnDetector,
            canPlayAgentAudio() {
                return allowAgentAudio;
            },
            close() {
                clearTimers();
                vad?.close();
                turnDetector?.close();
            },
        };
    },
};
Related example

The current full-cascade example that consumes this helper is:

Example: Responses: Deepgram-Groq-Inworld
Links
VAD and Turn Detection product page
VAD and Turn Detection guide
Silero module API reference
Pipecat module API reference

## קישורים חיצוניים

- [VAD and Turn Detection product page](https://voximplant.com/products/turn-detection)
