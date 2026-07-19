# Voximplant Docs Research — Group: guides-conferences

> NOTE ON LOCATION: The orchestrator asked for notes at `<scratchpad>/vox-research/guides-conferences.md`, but this session runs in plan mode (read-only; only this plan file is writable). These are the complete deliverable notes; a follow-up session can copy this file verbatim to the intended path.
> Intended path: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-research/guides-conferences.md`

Scope: `guides.conferences` (folder) + 4 tutorials. All 5 pages fetched via `https://voximplant.com/api/v2/getDoc?fqdn=...` and read in full, including all code examples (extraction required a custom walker: code lives in `content_source.examples[].source` with optional per-SDK tab nesting; alerts carry `title`+`description`; lists carry `text[]`).

---

## 1. Conferences (folder overview) — `guides.conferences`

**Covers:** Section landing page. Key features and section map.

**Key facts:**
- Up to **100 participants in voice conferences**, up to **50 in video conferences** (web limit).
- Per-participant audio/video can be enabled/disabled selectively.
- Screen sharing and recording supported; platforms: web browsers, iOS, Android, React Native (Flutter appears throughout the child pages too).
- Voximplant hosts a free ready-made video conference demo at http://videoconf.voximplant.com/.

**KALFA relevance:** Establishes the conference primitive exists on the same VoxEngine platform KALFA already uses; voice-conference capacity (100) is more than enough for any "broadcast announcement to a household/family group" idea.

---

## 2. Processing conferences in scenarios — `guides.conferences.scenarios`

**Covers:** Server-side (VoxEngine) conference construction: voice vs video patterns, PSTN/SIP gateway scenario, viewer mode, dialing out FROM a conference, FAQ.

**Key APIs / pattern:**
- `require(Modules.Conference)` then `VoxEngine.createConference({ hd_audio: true })`.
- **Voice conference:** on `AppEvents.CallAlerting` → `call.answer()` → on `CallEvents.Connected` → `VoxEngine.sendMediaBetween(call, conf)`. (Audio-only joins use sendMediaBetween, NOT Conference.add.)
- **Video conference:** `conf.add({ call, mode: 'FORWARD', direction: 'BOTH', scheme: e.scheme, displayName, maxVideoBitrate })` returns an endpoint with `.id()`.
- **Gateway scenario** (to bring PSTN/SIP callers into a conference running in another session): `VoxEngine.callConference('conferenceId', e.callerid, e.displayName)` + `VoxEngine.easyProcess(e.call, conf_call)`. The routing-rule pattern of the conference scenario must match the string passed to `callConference` (e.g. `conferenceId`).
- **Conference events:** `ConferenceEvents.Started` (has `event.conference.id()`), `ConferenceEvents.Stopped`, `ConferenceEvents.ConferenceError`, `ConferenceEvents.EndpointAdded/EndpointRemoved`.
- **Viewer mode (receive-only):** Web SDK `client.joinAsViewer('my_conf')` → returns ViewerCall; stop with `ViewerCall.hangup()`. Viewers never send media. Parameters: `num` (conference number) + optional `extraHeaders` (X-headers into INVITE).
- **Outbound call from a conference:** `VoxEngine.callPSTN(number, callerId)` → on `CallEvents.Connected` → `sendMediaBetween(conf, e.call)` (voice) or `Conference.add` (video). This is the canonical "dial a phone number into a live conference" recipe.
- **TTS into a conference:** `VoxEngine.createTTSPlayer('New participant has joined…').sendMediaTo(conf)`; chain on `PlayerEvents.PlaybackFinished` before wiring call↔conference media. This is the announcement primitive.
- **Termination:** `VoxEngine.terminate()` ends session+conference; participant-count bookkeeping + `setTimeout(checkForTermination, 10s)` pattern to auto-stop empty conferences (`conf.stop()`).

**Limits / gotchas:**
- Voice: 100 participants; video: web limit 50, but docs admit **10–15 realistic** on common devices (client-side rendering load).
- One scenario can serve multiple conferences (rule pattern per conference id).
- ALERT: for video conferences, the **routing rule must have the "video conference" flag set to true** — a separate rule-level switch, easy to miss.
- Conference lives inside one VoxEngine JS session; gateway sessions are separate sessions bridged by `callConference`.

**Code essence:** Three full scenarios shipped: (1) voice conf with TTS join/leave announcements, (2) video conf with participant counter and 10s-delayed auto-termination, (3) 5-line PSTN gateway.

**KALFA relevance:** HIGH for the "announcements" angle. The TTS→`sendMediaTo(conf)` + `sendMediaBetween` pattern is the exact mechanism for a one-to-many voice announcement (e.g., dial several family members and play one hosted/TTS message, or a "listen-in" supervision channel on AI calls). `callPSTN`-into-conference is the outbound direction KALFA needs. Caveat: KALFA is audio-only; ignore video paths but note say()/TTSPlayer works into conferences just like into calls (same niqqud constraints apply).

---

## 3. Processing conferences in SDKs — `guides.conferences.sdk`

**Covers:** Client-side joining of conferences from Web/iOS/Android/React Native/Flutter SDKs; voice vs video; rendering local/remote video; camera-state detection.

**Key APIs:**
- Join = same as a normal SDK call but `client.callConference(callSettings)` instead of `call()`. First parameter/number must match a routing rule server-side.
- Voice: `callSettings = { number, videoFlags: { sendVideo:false, receiveVideo:false } }`; end with `call.hangup()`. Standard `CallEvents.Connected/Disconnected/Failed`.
- Video: add `simulcast: true` (enables quality management) + `video: { sendVideo, receiveVideo }`; `receiveVideo` is REQUIRED for video conferences, `sendVideo` optional.
- Restricted joins: `joinAsViewer` (receive-only), `joinAsSharing` (screen-share-only send).
- Video containers per platform: Web `HTMLDivElement`, iOS `UIView`, Android `SurfaceViewRenderer`, RN `VideoView`, Flutter `VIVideoView`.
- Web local video: `sdk.init({ localVideoContainerId, remoteVideoContainerId })` + `sdk.showLocalVideo(true)`; or manual via `Hardware.StreamManager` `MediaRendererAdded` events.
- Remote participants = **Endpoints**; flow: `CallEvents.EndpointAdded` → `EndpointEvents.RemoteMediaAdded` → `mediaRenderer.render(container)`; also `RemoteMediaRemoved` / `RemoteMediaUpdated` (fires when camera↔screen-share swap).
- Camera-on detection: in `RemoteMediaAdded`, check `mediaEvent.mediaRenderer.kind === 'video'`.
- Scale types when rendering: `SCALE_FILL` (crop) vs `SCALE_FIT` (letterbox).

**Limits / gotchas:** Only websdk code tabs are actually present on this page (the per-SDK guidance for iOS/Android/RN/Flutter is prose with reference links). Requires app + SDK login before any conference work. Routing rule must match the number passed to `callConference`.

**See also:** `voximplant/tiler` GitHub library for conference video layouts; screen-sharing guide.

**KALFA relevance:** LOW-MEDIUM. KALFA's guests are on PSTN, not SDK clients. Relevant only if KALFA ever builds an owner-facing web "listen in / barge into the AI call" console — that would be Web SDK `callConference` or `joinAsViewer` (viewer mode = silent monitoring for free, no media sent).

---

## 4. Video quality management — `guides.conferences.quality-management`

**Covers:** Simulcast and automatic incoming-video-stream disabling; sender/recipient-side optimization; full Web SDK + VoxEngine API surface for stream control.

**Key mechanics:**
- Cloud auto-disables incoming video streams per-recipient on poor bandwidth and resumes when it improves. With simulcast ON it first downgrades quality, then disables streams one-by-one; with simulcast OFF it goes straight to disabling.
- Disable priority = least-active speakers first; most-active resumed first. **Screen-sharing stream is never auto-disabled. Audio is never disabled.**
- `reason` param on disable events: `Manual` vs `Automatic`. Recommended UX: hide frozen video, show network icon (only for Automatic).
- Sender-side: webcam quality managed by resolution layers; screen-share by lowering FPS (to keep text readable).
- Recipient-side: request video no bigger than the on-screen window; disable streams for out-of-view participants.
- Per-SDK disable/enable events: Web `MediaRenderDisabled/Enabled`; iOS `didStopReceivingVideoStream:reason:`; Android `onStopReceivingVideoStream`; RN `StopReceivingVideoStream`; Flutter `onStopReceivingVideoStream`. (This page DOES ship 5 full SDK code tabs: websdk/iossdk/androidsdk/reactnative/fluttersdk.)
- Web SDK: `callConference({ number, simulcast:true })`; `mediaRenderer.disable()/enable()/enabled()`; `mediaRenderer.requestVideoSize(w,h)` + `mediaRenderer.videoSize`; `EndpointEvents.VoiceStart/VoiceEnd` (speaking detection).
- VoxEngine side: `conference.add/remove`, `conference.getList()`, `conference.get(endpointId)`, `endpoint.getCall()/getMode()/getDirection()/getStreamsInfo()` (→ `{fromClientEndpoint, toClientEndpoint}` stream maps), `stream.enable()/disable()`, `endpoint.requestVideoSize(w,h)`; events `ToClientStreamAdded/Removed/Updated`, `FromClientStreamAdded/Removed/Updated/Enabled/Disabled`, `FromClientStreamMaxRenderSizeUpdated`.

**KALFA relevance:** LOW for calls themselves (audio-only; audio streams are never throttled/disabled by this mechanism). One transferable nugget: `EndpointEvents.VoiceStart/VoiceEnd` speaking-detection events exist in the Web SDK conference context — not applicable to VoxEngine PSTN flows (KALFA already uses ASR/VAD elsewhere), but good to know if a monitoring console is ever built.

---

## 5. Conference recording — `guides.conferences.recording`

**Covers:** Mixed (single-file) recording of conferences: recorder setup, layouts, priorities, S3 export, errors, billing.

**Key APIs / pattern:**
- `require(Modules.Recorder)` (+ Conference). `VoxEngine.createRecorder(params)` → `conf.sendMediaTo(recorder)` starts recording. `recorder.stop()`; events `RecorderEvents.Started/Stopped/RecorderError`.
- Params: `{ video:true, expire: RecordExpireTime.THREEMONTHS, videoopt: { mixing:true, profile:'hd', background:'#FFFFFF', vad:true, labels:true, layout:'tribune' } }`.
  - `mixing` = single mixed file; `vad` = highlight speaking participant's frame border; `labels` = show participant names; `background` = HTML color.
  - Newer param spelling also shown: `videoParameters` with `RecorderProfile.HD`, `RecorderLayout.tribune`, `vad:{thickness,color}`, `labels:{position: RecorderLabelPosition.BOTTOM_CENTER, textAlign: RecorderLabelTextAlign.TOP_CENTER}` — the docs use BOTH `videoopt` (older) and `videoParameters` (newer) forms.
- Profiles (case-sensitive): HD 1280x720@30 4096kbps; FHD 1920x1080@30 8192kbps; QHD 2560x1440@30 16384kbps; 4K 3840x2160@30 32768kbps. Output always **MP4/H.264**.
- Layouts: `grid` (default, equal tiles), `tribune` (active/priority speaker enlarged), `custom` (requires `layoutSettings` array in `videoopt`).
- Layout priorities: `recorder.setConference(conference)` first; then `recorder.getPriority()` / `await recorder.setPriority(endpointArray)` (real-time reorder; highest priority = big tribune window; new joiners default to highest priority). setPriority is async, wrap in try/catch.
- Dynamic re-config mid-recording: `recorder.update({ layout, background })` works live.
- Notify participants recording started: iterate `conference.getList()` → `participant.getCall().sendMessage(JSON.stringify({command:'record_started'}))`.
- Storage: Voximplant cloud by default (record URL access errors: 403 broken link/invalid URI, 401 auth failed, 416 range not satisfiable, 404 deleted); or own **S3-compatible storage** via the S3 integration guide.
- `expire` default 3 months (`RecordExpireTime` enum); longer retention = extra charges.
- Processing delay: recorded video appears in the panel after ~**1/5 of conference duration** post-call.
- Billing: pay for (a) video recording, (b) composition + storage; price scales with quality and storage time (see control panel Billing).

**Full-scenario essence:** AppEvents.Started → createConference; on first `EndpointAdded` create recorder, `setConference`, `sendMediaTo(recorder)`, notify participants; on `EndpointRemoved` with no active calls → `recorder.stop()`; RecorderEvents.Stopped → `conference.stop()` → ConferenceEvents.Stopped → `terminate()`. Careful mutual-shutdown wiring between recorder and conference.

**KALFA relevance:** MEDIUM as a pattern library, not for video. KALFA already records 1:1 AI calls; if a conference/announcement mode is added, the same `createRecorder` + `sendMediaTo` mechanic applies (audio-only recorder, no `videoopt`). The `expire`/`RecordExpireTime` retention knob and the S3-compatible export path matter for KALFA's data-retention/privacy posture on call recordings (personal data, Israeli privacy law). The 403/401/404 record-access error table is useful for KALFA's recording-fetch code.

---

## Cross-cutting takeaways for KALFA

1. **Announcement primitive:** TTSPlayer/URL player → `player.sendMediaTo(conf)` broadcasts one audio source to N participants; `sendMediaBetween(call, conf)` wires each PSTN leg. Combined with `VoxEngine.callPSTN` you get "dial N guests, play one message, optionally let them talk" — a possible future group-announcement feature (e.g., day-of-event voice blast to hosts/family). All audio-only; no video needed.
2. **Supervision/whisper potential:** viewer mode (`joinAsViewer`) and receive-only endpoints (`direction`) enable silent listen-in on live calls if KALFA ever adds owner monitoring of AI calls.
3. **Capacity is a non-issue** for KALFA-scale groups (100 voice participants).
4. **Recording retention** (`RecordExpireTime`, default 3 months, longer = paid) and S3 export apply to ALL VoxEngine recording, not just conferences — relevant to KALFA's existing call recordings and privacy commitments.
5. Conference does NOT change KALFA's current 1:1 AI-call architecture: `createConference` is a separate media object inside the same scenario session model, same routing rules, same StartScenarios entry point.

---

## INVENTORY (all pages in scope)

| fqdn | kind | title | fetched |
|---|---|---|---|
| guides.conferences | folder | Conferences | YES |
| guides.conferences.scenarios | tutorial | Processing conferences in scenarios | YES |
| guides.conferences.sdk | tutorial | Processing conferences in SDKs | YES |
| guides.conferences.quality-management | tutorial | Video quality management | YES |
| guides.conferences.recording | tutorial | Conference recording | YES |
