# Voximplant Docs Research — Group: guides-troubleshooting

Fleet research notes. Scope: `guides.troubleshooting` subtree (8 pages, all fetched DEEP via `https://voximplant.com/api/v2/getDoc?fqdn=...`).
Public URL pattern: `https://voximplant.com/docs/guides/troubleshooting/<page>`.

NOTE: intended output path was `<base>/vox-research/guides-troubleshooting.md` but the orchestrator passed `undefined` as base and this session is in plan mode (writes restricted to this plan file), so the notes live here.

---

## 1. Troubleshooting (folder page) — `guides.troubleshooting`

Overview hub. Recommends, in order: contact support, search Stack Overflow (`voximplant` tag), or self-debug using this section. Links to the 5 sub-articles (scenarios, microphone, web-logs, sdk-statistics, push).

**Key alert (info, "Secure storage"):** if **Secure storage for recordings and logs** is enabled during application creation, accessing logs and call recordings requires authorization — see `/docs/guides/management-api/secure-objects`.

**KALFA relevance:** the secure-storage note matters if KALFA enables secure storage for Hebrew call recordings/logs (guest personal data — aligns with Israeli privacy posture); it changes how the backend must fetch session logs/recordings (authorized URLs, not public).

## 2. Scenarios troubleshooting — `guides.troubleshooting.scenarios` (tutorial)

The core VoxEngine debugging page.

- **Code prerequisites:** scenarios must be ES6-compliant, NOT transpiled below ES6, NOT minified/obfuscated, human-readable (style-guide compliant). Also see `/docs/guides/voxengine/concepts`.
- **Built-in Logger:** `Logger.write()` (in addition to `console.log`) writes to the JS session log, persisted and viewable anytime in Control Panel → **Call history**. Accepts objects:
  ```js
  VoxEngine.addEventListener(AppEvents.CallAlerting, (e) => {
    Logger.write(JSON.stringify(e)); // whole object
    Logger.write(e.callerid);        // one field
  });
  ```
- **Cloud IDE debugger:** open a scenario in the cloud IDE → **Debug** button (upper right). "Debug parameters" dialog: pick the **rule** and one of three **criteria**:
  - Calls from a specific IP address
  - Calls from/to a specific phone number
  - All calls (any call matching the rule)
  Optional **Run the rule** checkbox (starts the rule together with the debugger) and a **custom data** input field (passes custom data to the scenario — same channel as script_custom_data). Debugger UI = DevTools-like: Scripts, Watch Expressions, Call Stack, Breakpoints, Console; waits for a matching session after START; step-through/resume controls.
- **Softphone:** Debug → **Softphone** (built on Web SDK) to make/receive test calls in the browser; log in with an app user (`username@appname.account.voximplant.com`); also launchable from **Routing tab → Test tools**.
- **`debugger` keyword** is recognized in scenarios (pauses in cloud debugger), and **`trace()`** prints to the Debug Console (debug-session-only output, unlike Logger.write which persists).

**KALFA relevance:** primary debugging path for the Groq-bridge scenario — Logger.write is the persistent audit trail per call (call history), the IDE debugger's "All calls"/phone-number criteria + custom-data field lets us replay the exact StartScenarios script_custom_data payload with breakpoints; keep the deployed scenario unminified ES6 so cloud debugging stays usable.

## 3. Mobile SDK statistics — `guides.troubleshooting.sdk-statistics` (tutorial)

Call-quality telemetry from the client SDKs (iOS/Android; one note on Web).

- **Basic — 8 dedicated call-quality events** (Android `IQualityIssueListener` / iOS `VIQualityIssueType`):
  1. Codec mismatch — local media encoded with a codec different from config/call settings
  2. High media latency — network-based media latency detected
  3. ICE disconnected — ICE switched to "disconnected" mid-call
  4. Local video degradation — sent resolution < captured resolution
  5. Packet loss — fired **every 2.5 seconds** for the last period
  6. No audio signal — mic captures nothing
  7. No audio received — no audio stream from remote side
  8. No video received — no video stream from remote side
  Severity is indicated by an issue-level code in the event.
- **Advanced — stats interfaces:** `CallStats` (whole call) + `EndpointStats` (per participant). Received via iOS `VICallDelegate.didReceiveStatistics` (`VICallStats`) / Android `ICallListener.onCallStatsReceived` (`CallStats`). Default arrival interval: **every 5 s**; tunable via `statsCollectionInterval` (iOS: `VICallSettings.statsCollectionInterval = 1000`; Android: `ClientConfig.statsCollectionInterval = 1000` before `getClientInstance`).
- **Gotchas (alerts):** Web SDK: in a simple 2-party call `CallStats === EndpointStats`. RAM: stats accumulate in RAM during the interval — bigger interval = higher RAM use. `timestamp` in successive stats must differ; identical timestamps mean the stats pipeline itself is broken.

**KALFA relevance:** low — KALFA places PSTN calls with no mobile SDK client. Only useful if a future in-app softphone/monitoring client is built; the quality-event taxonomy is a good vocabulary for call-quality dashboards.

## 4. Collecting logs: Web — `guides.troubleshooting.web-logs` (tutorial)

What support asks for when debugging Web SDK / WebRTC issues.

- **Console + HAR logs:** DevTools (F12 / ⌘+Alt+C Safari); Console → right-click → Save as; Network tab with **Preserve log** + **Disable cache**, reproduce, **Export HAR (sanitized)**.
- **Mobile Safari:** enable Web Inspector on iPhone + "Show features for web developers" in macOS Safari, cable-connect, Develop menu → device → tab → Console → save selection.
- **Web SDK logs:** enable at init: `voximplant.init({ showDebugInfo: true })`; view Verbose level in console, or browser-level via `chrome://webrtc-internals/` / `about:webrtc`.
- **WebRTC logs:** Chrome — restart browser, open webrtc-internals, reproduce, save the app's tab page as "Web Page, Complete". **Alert:** stats graphs are NOT preserved in the saved file — analyze live or screenshot.
- **log-collector demo** (`github.com/voximplant/websdk-demos/tree/master/logs-collector`): collects call-state logs client-side and POSTs them to any backend (a "Report" button sends the batch); includes a companion VoxEngine scenario. This is the documented pattern for debugging remote clients in production.

**KALFA relevance:** marginal for the PSTN AI-call flow; useful only when using the debug Softphone (which is Web SDK) or if a browser-based call-monitor is added. The log-collector POST-to-your-backend pattern mirrors KALFA's existing ctx/cb callback design.

## 5. Collecting logs: iOS — `guides.troubleshooting.ios-logs` (tutorial)

- Xcode console: iOS SDK logs print in debug mode; filter with the **`#VI`** tag.
- File logging via **`VILogDelegate`** (`VIClient.setLogDelegate(...)`, implement `didReceiveLogMessage(_:severity:)`); add timestamps yourself. Full Swift FileLogger sample provided.
- Alternative: **CocoaLumberjack** (max file size, rolling/cleanup interval; sample with `DDFileLogger`, 10 MB max, 24 h rolling).
- Pull the log file off-device: Xcode → Devices and Simulators → download app container (`.xcappdata`) → Show Package Contents → `AppData/Documents`.
- Redirect SDK logs to macOS Console via `os.Logger` in the log delegate (iOS 14+). **Warning alert:** debug-only — production log redirection can leak sensitive data (Voximplant account name, IP address, texts received from the VoxEngine scenario).

**KALFA relevance:** none today (no iOS client). The "logs contain scenario-sent texts" warning generalizes: Voximplant logs can carry guest personal data — treat session logs as PII surfaces.

## 6. Collecting logs: Android — `guides.troubleshooting.android-logs` (tutorial)

- Logcat: filter by **`VOXSDK`** tag; enable timestamp (Datetime) + thread id in formatting options; select-all and save as .log/.txt.
- File logging via **`ILogListener`** (`Voximplant.setLogListener`, `onLogMessage(level: LogLevel, log: String)`); Kotlin sample maps `LogLevel` → `java.util.logging.Level`, writes to `data/data/<app>/VOXSDK.log`.
- **Extended logs** = WebRTC info/warning/error included: `ClientConfig.enableDebugLogging = true` at SDK init. Gotcha: significant log-volume increase + possible app-performance impact; enable only for media diagnostics, ideally at support's request.

**KALFA relevance:** none today (no Android client).

## 7. Microphone troubleshooting — `guides.troubleshooting.microphone` (tutorial)

Server-side (VoxEngine) mic-activity tooling — despite the title this is scenario-level, not device-level.

- **Monitor mic activity:** `call.handleMicStatus(true)` then listen to `CallEvents.MicStatusChange`; event field `e.active` (bool). Documented uses: highlight the current speaker in a conference, **measure a participant's speech length**.
  ```js
  call.handleMicStatus(true);
  call.addEventListener(CallEvents.MicStatusChange, (e) => {
    Logger.write('Mic active: ' + e.active);
  });
  ```
- **Echo-test service (Skype echo123 clone):** full scenario using `Modules.Recorder`: answer → `call.say(intro)` → on `PlaybackFinished` play a beep → `VoxEngine.createRecorder()`, `call.sendMediaTo(rec)`, `rec.stop()` after 6 s → `RecorderEvents.Started` gives `e.url` → play the recording back to the caller → closing `call.say(...)` → `VoxEngine.terminate()` on final PlaybackFinished. Pattern highlights: remove-then-re-add PlaybackFinished listeners per stage; Disconnected → terminate.

**KALFA relevance:** HIGH. `handleMicStatus`/`MicStatusChange` is a lightweight server-side VAD signal usable for (a) detecting whether the callee actually spoke (evidence for per-reached-contact billing), (b) silence detection/barge-in heuristics in the AI conversation loop, (c) answering-machine heuristics. The echo scenario's PlaybackFinished chaining is exactly KALFA's existing terminal-hangup-on-PlaybackFinished pattern; the recorder flow is a template for recording consented Hebrew calls.

## 8. Push troubleshooting — `guides.troubleshooting.push` (tutorial)

Diagnosing mobile/web push notifications for calls.

- **Setup checklist:** push certificate uploaded to Control Panel; scenario contains `require(Modules.PushService);` (calls only); push token registered by the app.
- **Verify delivery to FCM/APNS:** in the call's **session logs**, find the **`Call.PushSent`** event; `push_results[]` has one entry per `sdk_type` (ios/android/web) with `token`, `msg`, `result`. `result: true` = accepted by FCM/APNS.
- **Error table (recovered from raw JSON):**
  | Error | Reason | Fix |
  |---|---|---|
  | "no tokens found" | token never registered, or previously rejected by FCM/APNS | fix registration code; check earlier sessions' push errors |
  | "Forbidden" (FCM) | Service-Account-JSON cert whose service account lacks the **Service Account Token Creator** role | add the role in Firebase Admin |
  | "Internal error" | any | contact support@voximplant.com |
  | DEVICE_UNREGISTERED (FCM, android/web) | token invalid: app unregistered/uninstalled, token rotated/expired, app updated without messaging config | drop the token, stop using it |
  | BadDeviceToken (APNS) | cert environment (Development/Production) mismatched vs build type (Debug/Release) | release builds → Production cert mode; Xcode debug builds → Development |
  | DeviceTokenNotForTopic (APNS) | wrong cert type or cert for a different bundle id | fix the certificate |
  | "Request has failed with timeout" | (iOS) push certificate may be expired | renew; else contact support |
  | "Push certificate not match to a bundle" | panel cert bundle-id/package ≠ SDK-init bundle id (typical with 2+ certs of same provider) | align SDK init bundle id with panel certs or re-upload |
- **result=true but no push received:** Android — Doze/Standby + OEM-specific push limits (call pushes go highest-priority; IP-messaging pushes normal priority, may lag). iOS — since iOS 13 a VoIP push MUST be reported to CallKit or iOS terminates the app and blocks further VoIP pushes.

**KALFA relevance:** none for the outbound PSTN AI-calling flow (no mobile app). Indirectly useful: `Call.PushSent` demonstrates that structured per-call events land in session logs — the same log stream KALFA can mine (Logger.write + platform events) when reconciling stuck calls.

---

## Cross-cutting takeaways for KALFA

1. **Session log = the persistent per-call debug artifact.** `Logger.write` output and platform events (e.g. `Call.PushSent`) are stored with call history and readable later from the Control Panel (or Management API GetCallHistory/log URLs) — build the AI-call audit trail on it, but treat it as a PII surface (docs explicitly warn logs can contain scenario texts, account name, IPs).
2. **Cloud IDE debugger + custom data** = the sanctioned way to step-debug the exact StartScenarios payload (breakpoints, watch, call stack) instead of blind redeploys; requires unminified ES6 scenario code.
3. **`handleMicStatus` + `MicStatusChange`** — server-side voice-activity events, directly useful for reached-contact evidence and conversation turn-taking.
4. **Secure storage for recordings and logs** (app-level option) gates logs/recordings behind authorization — evaluate enabling it for Hebrew guest-call recordings.
5. The debug **Softphone** and **Test tools → Routing** allow manual end-to-end call tests without burning PSTN minutes/credit.

## INVENTORY (all pages in scope)

| fqdn | kind | title | fetched |
|---|---|---|---|
| guides.troubleshooting | folder | Troubleshooting | yes |
| guides.troubleshooting.scenarios | tutorial | Scenarios troubleshooting | yes |
| guides.troubleshooting.sdk-statistics | tutorial | Mobile SDK statistics | yes |
| guides.troubleshooting.web-logs | tutorial | Collecting logs: Web | yes |
| guides.troubleshooting.ios-logs | tutorial | Collecting logs: iOS | yes |
| guides.troubleshooting.android-logs | tutorial | Collecting logs: Android | yes |
| guides.troubleshooting.microphone | tutorial | Microphone troubleshooting | yes |
| guides.troubleshooting.push | tutorial | Push troubleshooting | yes |
