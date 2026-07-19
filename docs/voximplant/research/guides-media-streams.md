# Voximplant docs research — group: guides-media-streams

> NOTE: Plan mode was active in this session, restricting all writes to this plan file. The intended
> deliverable path (`<scratchpad>/vox-research/guides-media-streams.md`) could not be created; these are
> the complete notes, written to the only permitted file. Content-wise this IS the full deliverable.
>
> Manifest: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-manifests/guides_media-streams.txt`
> Scope: 3 pages (1 folder + 2 tutorials). Depth: DEEP — every page fetched via
> `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` and read in full, including raw-JSON recovery of
> code examples and alert blocks that the shared extractor missed.

---

## 1. Media streams (folder) — `guides.media-streams`

URL: https://voximplant.com/docs/guides/media-streams

Section intro. Positions Media Streams as the mechanism to "integrate live audio streams from LLMs
into Voximplant applications through WebSockets": real-time transcription, sentiment analysis, voice
authentication, streaming raw audio into calls, conversational IVR, AI chatbot assistants — i.e., the
official bring-your-own-ASR/LLM/TTS transport. Two children: the WebSocket how-to and the wire-format
spec.

**KALFA relevance:** This section is the canonical entry point for exactly what KALFA's Groq bridge
does today over HTTP, but streaming — the upgrade path from turn-based ctx/cb HTTP to full-duplex audio.

---

## 2. Sending media over WebSockets (tutorial) — `guides.media-streams.websocket`

URL: https://voximplant.com/docs/guides/media-streams/websocket

### What it covers
How a VoxEngine scenario opens outgoing WebSocket connections, accepts incoming ones, and moves both
text and audio through them; the JSON audio protocol; faster-than-realtime sending and playback
interruption.

### Key APIs / methods / events
- `VoxEngine.createWebSocket(url, protocols?)` — outgoing connection; URL must be `wss://domain/path`.
- `call.sendMediaTo(webSocket, { encoding?, tag?, customParameters? })` — stream call audio out.
  **Default encoding is PCM8 if not set** (explicitly stated twice). `WebSocketAudioEncoding.ALAW`
  used in the example, with `tag` as a stream label.
- `webSocket.send(text)` — send text/JSON frames; `webSocket.close()` — either side may close.
- Incoming: `VoxEngine.allowWebSocketConnections()` then subscribe to `AppEvents.WebSocket`
  (handler receives `event.websocket`). The session's WebSocket URL = the session media URL with
  `https` → `wss`; obtainable from the **StartScenarios HTTP API response** or from
  `AppEvents.Started` (`accessSecureURL` field in the sample code).
- `webSocket.sendMediaTo(call)` — route inbound WS audio into a call.
- `webSocket.clearMediaBuffer()` — interrupt current buffered playback (added with the
  faster-than-realtime update).
- WebSocket events used in samples: `WebSocketEvents.OPEN` / `MESSAGE` / `CLOSE` / `ERROR`
  (property-style `onopen`/`onmessage` callbacks are equivalent to addEventListener).
- Failure event: `AppEvents.NewWebSocketFailed` when the incoming-connection limit is exceeded.
- `WebSocketEvents.MediaEventStarted` — scenario-side event whose `message.customParameters` exposes
  the `customParameters` sent by the external app's StartEvent.

### Limits and gotchas (several only in alert blocks the HTML extractor dropped)
- **Incoming WS connection cap: number of calls in the session + 3.** One more connection → error +
  `AppEvents.NewWebSocketFailed`. Existing connections are NOT destroyed when a call ends.
- **`event` parameter is mandatory for system events**; you cannot use both `event` and `customEvent`
  in custom messages.
- Default audio encoding PCM8 unless explicitly set — a silent quality trap.
- Media can be sent **faster than realtime**: Voximplant buffers and plays back in realtime; use
  `clearMediaBuffer()` in the scenario to cut playback (barge-in primitive).
- Server-side sample expects **raw pcm u-law 8 kHz mono**; conversion recipe given:
  `ffmpeg -i ./record.mp3 -f mulaw -acodec pcm_mulaw -ac 1 -ar 8000 output.raw`.
- Cross-link: "Connect external STT providers" (`guides/speech/asr-providers`) for full
  Vox-side + server-side setup (owned by the guides-speech group).

### Wire protocol (as presented in this tutorial; both directions)
1. `{"event":"start","sequenceNumber":0,"start":{"mediaFormat":{"encoding":"audio/x-mulaw","sampleRate":8000,"channels":1},"customParameters":{...}}}`
2. `{"event":"media","sequenceNumber":N,"media":{"chunk":n,"timestamp":t,"payload":"<base64>"}}`
3. `{"event":"stop","sequenceNumber":N,"stop":{"mediaInfo":{"bytesSent":21100,"duration":124}}}`

### Essence of code examples (recovered in full from raw JSON)
- **Outgoing WS**: on `CallAlerting`, `VoxEngine.createWebSocket('wss://…')`.
- **Incoming WS**: `allowWebSocketConnections()` + `AppEvents.WebSocket` → `event.websocket`.
- **Sending text**: answer call, open WS, `send()` on OPEN, log on MESSAGE, `VoxEngine.terminate()`
  on CLOSE; paired with a ~10-line Python `websockets` echo server.
- **Sending audio to WS**: `call.sendMediaTo(webSocket, { encoding: WebSocketAudioEncoding.ALAW, tag: 'call' })`
  inside `onopen`.
- **Audio from WS to call** (full bidirectional scenario): capture `accessSecureURL` at
  `AppEvents.Started`, `allowWebSocketConnections()`, hand the `wss` URL to the caller via
  `call.sendMessage()`, then on `AppEvents.WebSocket` do `websocket.sendMediaTo(inCall)` with
  ERROR/CLOSE/MESSAGE/OPEN logging.
- **Node.js server client** (~90 lines, `websocket` npm package): connects to the session wss URL,
  sends StartEvent `{encoding:'ULAW', sampleRate:8000}`, reads a raw file in **160-byte chunks
  (= 20 ms of ULAW 8 kHz)**, sends each as a media event with `timestamp = sn * CHUNK_SIZE` paced by
  `setTimeout` against wall-clock, then StopEvent. A ready-made template for a TTS-audio injector.

**KALFA relevance:** The `accessSecureURL`→`wss` handshake means KALFA's backend can attach a
full-duplex audio socket to any running scenario it started via StartScenarios — the foundation for a
streaming Groq/ElevenLabs bridge and for barge-in via `clearMediaBuffer()`.

---

## 3. Media Stream format (tutorial) — `guides.media-streams.format`

URL: https://voximplant.com/docs/guides/media-streams/format

### What it covers
The precise `Voximplant.WebSocketFormat` contract (JSON serialization) for both directions: receiving
a stream from Voximplant and sending one to it. This is the spec page; the websocket tutorial is the
how-to.

### Receiving a stream FROM Voximplant
- Lifecycle: `StartEvent` → `MediaInfo`* → `StopEvent`; controlled in-scenario by `sendMediaTo` /
  `stopMediaTo`. After a stop, a new stream may start. Concurrent streams are distinguished by unique
  `tag` on Start/Media/Stop events.
- `call.sendMediaTo(webSocket)` default StartEvent: `{encoding:'PCM16', sampleRate:16000}`.
  With options `{ tag, encoding: WebSocketAudioEncoding.PCM16_8KHZ, customParameters: {...} }` the
  StartEvent carries them — **customParameters arrives as a JSON-STRING** (`'{"test":"123"}'`), not an
  object; the receiver must JSON.parse it.
- `MediaInfo.payload` = base64 audio encoded per `StartEvent.mediaFormat`; typically **20 ms** per
  chunk; if the source is a call, chunk length follows the call SDP's `a=ptime`/`a=maxptime`.
- Duration formula: `sizeInBytes(payloadInPcm16) / 2 * 1000 / sampleRate` (ms).
- `chunk` / `timestamp` mirror RTP sequence-number/timestamp (RFC 3550) but widened to **uint64**.
- **Chunks may be skipped (network loss)** — the app should implement PLC; lost count =
  `current.chunk − lastReceived.chunk − 1`.
- An **adaptive jitter buffer** handles duplicates/reordering but does NOT guarantee 100% in-order
  delivery; the app decides how to treat out-of-order chunks.
- `StopEvent.stop.mediaInfo` reports `{ bytesSent, duration }` stats.

### Sending a stream TO Voximplant
- Destinations: a call, a conference, a recorder, another WebSocket, etc., via
  `webSocket.sendMediaTo(target, { tag? })`; multiple inbound streams demultiplex by tag to different
  media units (example: `stream1`→call, `stream2`→recorder).
- A correct StartEvent fires **`WebSocketEvents.MEDIA_STARTED`** in the scenario (fields `tag`,
  `customParameters`, `encoding` mirror the event). A correct StopEvent fires
  **`WebSocketEvents.MEDIA_ENDED`**.
- Chunk duration arbitrary but **recommended multiple of 20 ms**.
- **No realtime pacing required** — you may push everything at once; Voximplant's WebSocket buffer
  repackages into 20 ms chunks and forwards to the media unit in realtime.
- **Buffer hard limit: 10 seconds — excess chunks are DISCARDED.**
- Well-formed stream rules: `chunk` +1 per packet; `timestamp` = cumulative sample count of prior
  chunks (`sizeInBytes(payloadInPcm16)/2`). Losses/dupes/reorder must be reflected honestly in those
  fields.
- **Codec is immutable mid-stream**: to change codec, send StopEvent, then a new StartEvent with the
  new MediaCodec.
- Alert (recovered): the format is also specified as a **proto file** —
  https://github.com/voximplant/protobuf/blob/main/websockets.proto

**KALFA relevance:** This page is the exact contract a KALFA bridge server must implement — including
the two failure-prone details (customParameters as string; 10-s discard limit) and the two events
(`MEDIA_STARTED`/`MEDIA_ENDED`) the scenario should use to sequence TTS playback.

---

## KALFA relevance — consolidated

1. **Streaming upgrade path for the Groq bridge**: today's ctx/cb HTTP turn-taking can evolve into
   full-duplex audio: `call.sendMediaTo(ws)` streams caller audio to KALFA/an ASR, and the bridge
   pushes synthesized audio back per the JSON format into the same session.
2. **Two attachment topologies**: (a) scenario dials OUT to a KALFA wss endpoint
   (`createWebSocket`) — simplest for outbound campaign calls; (b) KALFA connects IN using the
   StartScenarios response's media URL (`https`→`wss`) — no new field needed inside the 200-byte
   `script_custom_data`, the backend already has the URL from the StartScenarios call it made.
3. **Barge-in**: push ElevenLabs/other TTS faster than realtime, and on ASR speech-start send a
   command to the scenario to call `webSocket.clearMediaBuffer()` — interrupts playback mid-sentence.
4. **ElevenLabs fit**: ElevenLabs can output `ulaw_8000` / `pcm_16000`, matching
   `audio/x-mulaw`+8000 or PCM16+16000 here; a thin adapter wrapping ElevenLabs audio chunks in
   media events (160-byte/20 ms ULAW pacing optional — can burst ≤10 s) replaces `call.say()` and
   its no-SSML Google he-IL limitation entirely.
5. **Encoding traps for Hebrew ASR quality**: default is PCM8 (websocket tutorial) — always set
   encoding explicitly; prefer `PCM16` @16 kHz outbound to ASR, telephony ULAW/ALAW 8 kHz toward the
   call.
6. **Hard limits to engineer around**: 10-s send buffer (chunk long TTS or pace it), incoming-WS cap
   = calls-in-session + 3, PLC responsibility on the receiver, uint64 chunk/timestamp, codec change
   requires stop+start.
7. **customParameters** is a legitimate side-channel for per-call context (guest token, campaign id)
   from scenario to bridge — but it arrives JSON-stringified inside StartEvent and, in the reverse
   direction, surfaces via `WebSocketEvents.MediaEventStarted.message.customParameters`.
8. **Formal spec available** (websockets.proto on GitHub) — use it to type the bridge implementation
   instead of reverse-engineering the JSON examples.

---

## INVENTORY (every page in scope)

| fqdn | kind | title | read |
|---|---|---|---|
| guides.media-streams | folder | Media streams | yes (full) |
| guides.media-streams.websocket | tutorial | Sending media over WebSockets | yes (full, incl. raw-JSON code + alerts) |
| guides.media-streams.format | tutorial | Media Stream format | yes (full, incl. proto-file alert) |
