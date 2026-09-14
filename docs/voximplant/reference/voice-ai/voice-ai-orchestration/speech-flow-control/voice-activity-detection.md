> מקור: https://docs.voximplant.ai/voice-ai-orchestration/speech-flow-control/voice-activity-detection
> נשמר: 2026-09-14

# Voice Activity Detection

Speech Flow Control
Voice Activity Detection

Silero VAD in VoxEngine for barge-in and speech-boundary signals

Ask a question
|
Copy page
|
View as Markdown
|
More actions

For the complete documentation index, see llms.txt.

Benefits

Voice Activity Detection (VAD) gives your VoxEngine scenario a fast signal for when a caller starts and stops speaking. In practice, that is what powers barge-in, pause detection, and the first layer of turn-taking.

Capability highlights:

Powered by Voximplant’s native Silero module.
Works directly on call media inside VoxEngine without a custom media gateway.
Emits speech-boundary events you can use to stop TTS playback and trigger downstream turn detection.
Pairs naturally with STT and Pipecat Smart Turn in full-cascade voice pipelines.
Architecture
What Voximplant exposes

Load the module and create a VAD instance:

require(Modules.Silero);
const vad = await Silero.createVAD({
  threshold: 0.5,
  minSilenceDurationMs: 300,
  speechPadMs: 10,
});
call.sendMediaTo(vad);

The module surface is intentionally small:

Silero.createVAD(parameters)
vad.addEventListener(...)
vad.reset()
vad.close()
vad.id() and vad.webSocketId() for diagnostics
VAD parameters

These are the parameters Voximplant currently exposes on Silero.createVAD().

Parameter	Type	Default	What it controls
threshold	number	0.5	Speech probability threshold above which Voximplant treats the segment as speech. Raise it to reduce false positives; lower it to react earlier to softer speech.
minSilenceDurationMs	number	300	Silence duration required before Voximplant emits speechEndAt for a segment. Raise it if short pauses are splitting turns too aggressively.
speechPadMs	number	0	Padding added around detected speech segments so the boundaries are less aggressive. Useful when speech starts or ends are getting clipped.
VAD events

These are the core events exposed by the Silero module.

Event	Payload	How to use it
Silero.VADEvents.Result	speechStartAt?, speechEndAt?	Main speech-boundary signal. In Voximplant typings these timestamps are documented in seconds. Use speechStartAt for barge-in and speechEndAt to start pause-based logic.
Silero.VADEvents.Reset	none	Emitted after vad.reset(). Useful when you need to clear VAD state between turns or after call state changes.
Silero.VADEvents.Error	reason	Connector/runtime error path. Log it and fail fast or fall back cleanly.
Silero.VADEvents.ConnectorInformation	data	Connector metadata and diagnostics. Useful for confirming the loaded connector version and endpoint.
Development notes
Use VAD for speech boundaries, not transcripts. Silero tells you that speech is happening; STT still owns the actual words.
Barge-in usually starts with speechStartAt. In a phone assistant flow, that is the right moment to clear any queued agent audio.
Pause sensitivity is mostly minSilenceDurationMs. If callers pause naturally mid-sentence, this is usually the first value to tune.
speechPadMs is a safety margin. It helps avoid clipped starts and ends, but too much padding can make boundaries feel slower.
VAD and turn detection are complementary. A common pattern is: Silero detects speech boundaries, then Pipecat evaluates whether the turn is actually complete.
This matters most in cascade architectures. When STT, LLM, and TTS come from different vendors, VAD is usually the first signal that keeps interruptions responsive and prevents the agent from talking over the caller.
Example
require(Modules.Silero);
const vad = await Silero.createVAD({
  threshold: 0.5,
  minSilenceDurationMs: 300,
  speechPadMs: 10,
});
call.sendMediaTo(vad);
vad.addEventListener(Silero.VADEvents.Result, (event) => {
  if (event.speechStartAt) {
    ttsPlayer.clearBuffer();
  }
  if (event.speechEndAt) {
    turnDetector.predict();
  }
});
Links
Voximplant
VAD and Turn Detection product page
VAD and Turn Detection guide
Silero module API reference
Upstream technology
Silero

## קישורים חיצוניים

- [VAD and Turn Detection product page](https://voximplant.com/products/turn-detection)
- [Silero](https://github.com/snakers4/silero-vad)
