# Voximplant Docs Research Notes — Group: guides-sdk (Client SDK Guides)

Source manifest: scratchpad/vox-manifests/guides_sdk.txt (11 pages: 1 folder + 10 tutorials).
All 11 pages fetched via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` and read in full.
NOTE: Plan mode restricted file creation to this plan file, so these notes live here instead of
`scratchpad/vox-research/guides-sdk.md`. Content is complete and self-contained.

Public URL pattern: `https://voximplant.com/docs/guides/sdk/<slug>`.

## Section overview (guides.sdk — "SDKs" folder)

Landing page for client-SDK how-to guides. Voximplant ships client SDKs for Web, Android, and
iOS (plus React Native/Flutter/Unity elsewhere in the docs tree). This section covers: SDK major-
version migrations (Android v2→v3, Web v4→v5), client authorization schemes (one-time key,
renewable tokens), platform telephony integration (iOS PushKit/CallKit, Android FCM push /
ConnectionService), screen sharing, and custom video sources. The folder page itself is thin
(marketing blurb + section index); all substance is in the 10 tutorials.

Structural takeaway: these guides are all about **client endpoints** — apps where a human user
logs in as a Voximplant application user and places/receives calls. They are the counterpart to
VoxEngine (cloud) scenarios: `VoxEngine.callUser()` in a scenario is what rings these SDK clients
(and triggers mobile push automatically).

---

## 1. Android SDK v3 migration guide (guides.sdk.android-migration-guide)

Covers migrating Android apps from SDK v2 (`com.voximplant:voximplant-sdk:2.x`) to v3.

Key API changes:
- **Dependencies**: v3 uses a BoM — `platform("com.voximplant:android-sdk-bom:3.1.0")` with
  modules `android-sdk-core`, `android-sdk-calls`, `android-sdk-renderer-compose`,
  `android-sdk-messaging` (import only what you need).
- **Init**: `VICore.initialize(applicationContext)` replaces `Voximplant.getClientInstance(executor,
  context, config)`. Event executor is SDK-managed (single-thread), configurable via
  `VICore.callbackExecutor`.
- **Client**: `Client` is now a singleton object. `Client.connect(ConnectOptions(node = Node), ConnectionCallback)`
  requires the **account node** to be specified; `Client.login(username, password, LoginCallback)`
  uses callbacks with typed errors (`ConnectionError`, `LoginError`, `DisconnectReason`).
- **Local video**: local video streams can be created outside a call (`LocalVideoStream(CameraVideoSource)`).
  A source captures only while (rendered OR attached to active call); stops when neither.
- **Calls vs conferences split**: `VICalls.createCall(number, CallSettings)` /
  `VICalls.createConference(...ConferenceSettings)`; separate `CallListener` and `ConferenceListener`.
  `VideoFlags` replaced by `CallSettings.receiveVideo` + `CallSettings.localVideoStream` (video off
  by default). Incoming calls via `VICalls.setIncomingCallListener`. Endpoint interface removed for
  1:1 calls. `onCallDisconnected` now carries a `disconnectReason`.
- **Compose rendering**: new `VideoRenderer` composable (renderer-compose module) with
  `RenderScaleType`.
- **Logging**: `VICore.logging.logger` interface (level, threadId, time, throwable),
  `VICore.logging.level`, `enableLogcat` — configured once for all modules.

KALFA relevance: LOW. KALFA places server-originated PSTN calls (StartScenarios → VoxEngine →
callPSTN); no Android client app exists or is planned. Useful only as awareness that "androidsdk3"
reference namespace exists.

## 2. Web SDK v5 migration guide (guides.sdk.web-sdk-migration-guide)

Covers migrating web apps from Web SDK v4 (`VoxImplant.getInstance()`) to v5
(`@voximplant/websdk` on npm, modular).

Key API changes:
- **Modular architecture**: `Core.init({})` is an IoC container; register modules with
  `core.registerModules([StreamLoader(), CallLoader(), ConferenceLoader(), SmartQueueLoader(), ...])`;
  obtain via `core.getModule(token)` / `getModuleAsync` (async loaders support code-splitting, e.g.
  noise-suppression module loaded via dynamic import).
- **Watchable**: new reactive type used across modules — `value` + `.watch(cb, options)` (e.g.
  `core.client.state.watch(...)`, `call.remoteStreams.watch(...)`).
- **Auth**: `client.connect({ node: ConnectionNode.NODE_n })` (node moved from init to connect),
  `client.login({username, password})`, one-time key flow = `client.requestOneTimeKey({username})`
  → backend computes hash → `client.loginOneTimeKey({username, hash})`.
- **Stream module**: app-side stream management. Low-level `StreamManager`/`Hardware`; helpers:
  `DeviceTrackerHelper` (device changes during calls, `startPreviewVideo`, `attachCall`,
  `attachConference`, `shouldSendVideo` watchable) and `AudioProcessor` (pre-send audio
  preprocessing). Rendering: create `AudioRenderer`/`VideoRenderer` via `RendererManager` and mount
  `renderer.getElement()` into the DOM yourself (no more localVideoContainerId).
- **Calls**: `CallManager` (module token `callToken`) — `createCall(destination)`, incoming via
  `CallManagerEvent.IncomingCall` (payload has `callId`; fetch from `callManager.getCalls()`).
  Remote media via `CallEvent.RemoteMediaAdded` + stream `type` (`StreamType.Audio/Video/ScreenAudio/ScreenVideo`).
- **Conferences**: `ConferenceManager.createConference({conferenceName})`, `conference.join()`,
  simulcast on by default, per-endpoint media via `EndpointEvent.RemoteMediaAdded/Removed` and
  `conference.endpoints` watchable.
- **SmartQueue module**: contact-center agent status — `setCallStatus`/`setMessagingStatus`,
  events `SmartQueueEvent.CallStatusUpdated/MessagingStatusUpdated`, or watchable `callStatus`/
  `messagingStatus` (replaces v4 `setOperatorACDStatus`/`setOperatorSQMessagingStatus`).
- **Logging**: configured at `Core.init({ logger: { enableConsoleLogger, prefix, timeFormat,
  callbackLogLevel, onLogCallback } })`.

KALFA relevance: LOW-MEDIUM. Not needed for outbound PSTN campaign calls. Would matter only if
KALFA ever builds an in-browser "listen/monitor/answer" console for event owners or an operator
takeover UI (human-in-the-loop escalation from the AI caller) — in that case Web SDK v5 modular
+ SmartQueue is the current-generation API to target, and v4 examples floating around the docs
are legacy.

## 3. Authorization: one-time key (guides.sdk.authorization-onetimekey)

Login without shipping a plaintext password in client JS:
1. Listen for `AuthResult`; call `requestOneTimeLoginKey(username)` (v5: `requestOneTimeKey`).
2. Server receives `key` (via AuthResult code 302 in v4), backend computes
   `MD5(login_key + "|" + MD5(user + ":voximplant.com:" + password))` — **hash must be computed on
   your backend**, never client-side.
3. `loginWithOneTimeKey(username, token)` → `AuthResult.result == true`.
Backend examples given in PHP, Ruby, Node.js (Express + crypto MD5), Java/Spring.

Gotchas: the hash recipe is fixed MD5 with the literal realm string `voximplant.com`; the username
format is `user@app.account.voximplant.com`.

KALFA relevance: LOW today (no client logins). If a browser operator console is ever added, this
is the recommended pattern with KALFA's Next.js backend holding the Voximplant user password
server-side (fits KALFA's "no secrets in browser" rule).

## 4. Authorization: renewable tokens (guides.sdk.authorization-tokens)

Alternative to one-time keys, fully SDK-side:
- After password login, `AuthResult` carries a `tokens` object: `accessToken` (+`accessExpire`,
  seconds), `refreshToken` (+`refreshExpire`).
- Later logins use `loginWithToken` (Web) instead of password; refresh via `tokenRefresh`.
- Access token lifespan ~1 month by default (doc says "can be changed in the future").
- Trade-off vs one-time key: no backend needed, but a stolen token CAN log in — hence limited
  lifespan; store e.g. in localStorage (their example does).

KALFA relevance: LOW. Same conditional relevance as one-time keys; tokens are the lower-friction
option for an internal admin/operator tool where standing up the MD5-hash endpoint is overkill.

## 5. iOS: Push notifications (guides.sdk.ios-push)

VoIP pushes (PushKit) for incoming-call wakeup on iOS:
- Advantages: wakes device, high priority/no delay, larger payload, app relaunched if dead,
  background runtime. Limitations: PushKit-only; **since iOS 13 you MUST report the push to
  CallKit** (`CXProvider.reportNewIncomingCall`) and cannot customize the incoming-call screen.
- Setup: Xcode capabilities (Push Notifications + Background Modes: audio, VoIP, background
  fetch, remote notifications); generate Apple VoIP Push Services certificate, export .p12,
  upload in Voximplant control panel → application → Push Certificates (Production vs Development
  mode; prod only for App Store/TestFlight builds). Multiple bundle IDs per Voximplant app are
  supported; bundle id is used only to select the certificate (not validated).
- **VoxEngine scenario must include a push notification helper module** for pushes to be sent;
  `VoxEngine.callUser()` then sends the push automatically (app wakes → connect → login → receive
  call).
- Token flow: PushKit `PKPushRegistryDelegate.pushRegistry(_:didUpdate:for:)` →
  `VIClient.registerVoIPPushNotificationsToken(_:completion:)` (registered only after login).
- Handling: in `didReceiveIncomingPushWith`, use UUID from `VIClient.handlePushNotification(_:)`
  (matches later `VICall.callKitUUID`); complete `reportNewIncomingCall` only after processing,
  else iOS may throttle app resources.
- Ends with the standard "use tokens or keys, not passwords" security note.

KALFA relevance: VERY LOW. Guests are reached by PSTN, not an app. Only structural note: this is
where "callUser + automatic push" lives, confirming callUser ≠ callPSTN semantics.

## 6. iOS: CallKit (guides.sdk.ios-callkit)

Native iOS call-UI integration (demo: voximplant/ios-sdk-swift-demo AudioCallKit):
- Outgoing: create `CXStartCallAction` (UUID) → `CXCallController` → in
  `CXProviderDelegate.provider(_:perform:)` create `VICall`, set `VICall.callKitUUID`, `start()`,
  `reportOutgoingCall(with:startedConnectingAt:)`; on `didConnectWithHeaders` update CallKit;
  `CXCallUpdate` + `CXProvider.reportCall` for info updates.
- Incoming: from `didReceiveIncomingCall` extract callKitUUID + caller info, build `CXCallUpdate`,
  report to CallKit. (Push+CallKit combo covered in the ios-push guide.)
- All user actions arrive as `CXAction` subclasses — `fulfill()` on success, `fail()` on error.
- Audio session: CallKit escalates/de-escalates privileges; you MUST notify the SDK via
  `VIAudioManager.callKitStartAudio`/`callKitStopAudio` to avoid config conflicts.
- Note: many inline code blocks on this page are rendered empty by the docs API (visible on the
  website only) — flow text is complete, code specifics partially missing.

KALFA relevance: VERY LOW (no iOS app).

## 7. Android: Push notifications (guides.sdk.android-push)

FCM data-message pushes for incoming calls on Android:
- Add Firebase to project; certificate = **service-account JSON** (Firebase console → Service
  Accounts → generate key for firebase-adminsdk) uploaded in Voximplant panel → Push Certificates
  → GOOGLE. Multi-package support mirrors iOS (package name only selects the cert).
- Same requirement: **VoxEngine scenario needs the push helper**; `callUser` auto-sends push.
- Token: obtain from Firebase, register via `IClient.registerForPushNotifications` (effective
  after login); re-register on `onNewToken` (FirebaseMessagingService).
- **Huawei/HMS**: `ClientConfig.useHmsForPushNotifications = true` switches the registered token
  to the Huawei-provider certificate.
- Handling: `onMessageReceived` (any app state) → connect/login if needed →
  `IClient.handlePushNotification` (payload has "voximplant" signature) → re-register token →
  wait `onIncomingCall` → show UI.
- Delivery monitoring: set `CallUserRequest.analyticsLabel` on the VoxEngine `callUser` side to
  track FCM message delivery.
- Same closing "tokens/keys over passwords" note.

KALFA relevance: VERY LOW (no Android app). `analyticsLabel` is a neat pattern but push-specific.

## 8. Android: ConnectionService (guides.sdk.android-connectionservice)

Self-managed Telecom ConnectionService integration (Android's CallKit analog):
- Manifest: `MANAGE_OWN_CALLS` permission; service declared with
  `BIND_TELECOM_CONNECTION_SERVICE` + `android.telecom.ConnectionService` intent filter.
- Register a `PhoneAccount` (`CAPABILITY_SELF_MANAGED`) with a `PhoneAccountHandle`.
- One Telecom `Connection` per Voximplant call — create before `ICall.start()` (outgoing, in
  `onCreateOutgoingConnection` after `TelecomManager.placeCall`) or before `ICall.answer()`
  (incoming, `TelecomManager.addNewIncomingCall` → `onCreateIncomingConnection` →
  `onShowIncomingCallUi`, full-screen-intent notification recommended).
- **Pass every new Connection to `IAudioDeviceManager.setTelecomConnection()`** so the SDK can
  manage audio devices.
- State sync rules: `Connection.setActive()` when connected; hold = `ICall.hold()` success THEN
  `Connection.setOnHold()`; mute/audio-device fully SDK-managed (no Connection call needed);
  end = on `onCallDisconnected` → `Connection.setDisconnected(DisconnectCause)` + `destroy()`.
- Benefits: multi-app call coexistence (hold/switch), wearable answer/decline.

KALFA relevance: VERY LOW (no Android app).

## 9. Screen sharing (guides.sdk.screen-sharing)

Cross-platform screen-share how-to:
- **Web**: desktop browsers only. In-call `call.shareScreen()` REPLACES user video (cannot send
  both); stop via `stopSharingScreen()` or the browser's native stop button. In conferences,
  either replace video or join screen as a SEPARATE participant via `client.joinAsSharing()`
  (ends via `SharingCall.hangup()`). Track source switches via Hardware `MediaRendererUpdated`
  event (`type` = video source).
- **Android**: MediaProjection API, minSdk 21; permission via `createScreenCaptureIntent` →
  `ICall.startScreenSharing(intent)` with `ICallCompletionHandler` (errors in `CallError` enum);
  stop by calling `sendVideo(true|false)`.
- **iOS**: min iOS 11. (a) In-app sharing: `VICall.startInAppScreenSharing` (per-launch prompt);
  stop via `setSendVideo`. (b) Broadcast (whole device incl. other apps): Broadcast Upload
  Extension target, credentials passed app→extension via Keychain/UserDefaults + App Group
  (token auth preferred), extension joins the conference as a second participant using
  `VICustomVideoSource(initScreenCastFormat)` and `sendVideoFrame:rotation` from
  `processSampleBuffer`; 50 MB RAM limit in extensions; cross-process status sync via Darwin
  notify center.

KALFA relevance: NONE for the voice-only RSVP flow.

## 10. Custom video sources (guides.sdk.custom-video-sources)

Android-focused (v2 and v3) custom video injection — filters, background blur/replacement:
- App owns all processing resources (and their deallocation).
- Configure SDK with a WebRTC `EglBase`: v2 via `ClientConfig.eglBase` before
  `getClientInstance`; v3 via `VICalls.eglBase` before `VICalls.initialize()`.
- Frames flow through a `SurfaceTexture` via WebRTC `SurfaceTextureHelper.create(name,
  eglBase.eglBaseContext)` + `setTextureSize(w, h)`.
- v2: `Voximplant.getCustomVideoSource()` → `setSurfaceTextureHelper` →
  `ICustomVideoSourceListener.onStarted/onStopped` → `call.useCustomVideoSource(source)`.
- v3: `CustomVideoSource()` + `surfaceTextureHelper` + `VideoSource.EventsListener`
  (onStart/onStop(reason)/onError) → wrap in `LocalVideoStream(customVideoSource)` →
  `CallSettings.localVideoStream`.

KALFA relevance: NONE (voice-only).

---

## Cross-cutting observations for KALFA

1. This entire section is client-endpoint (human app user) territory; KALFA's architecture
   (Management API StartScenarios → VoxEngine → callPSTN → guest's phone) touches none of it in
   production today. The section's main value is negative confirmation: nothing here is a missing
   piece for the outbound AI-calling flow.
2. If KALFA ever adds a live-monitor / barge-in / human-takeover console for the AI caller,
   the modern target is Web SDK v5 (modular, Watchable, SmartQueue) with one-time-key or token
   auth brokered by the Next.js backend — not the v4 API that many older Voximplant examples use.
3. `VoxEngine.callUser()` auto-triggers mobile push (when the scenario includes the push helper)
   — irrelevant to callPSTN, useful vocabulary when reading other docs.
4. Several tutorial pages (iOS push/CallKit, Android push, parts of screen sharing) return empty
   code blocks through the getDoc API — the prose flow is complete but exact snippets live only
   in the website render / linked GitHub demos (voximplant/ios-sdk-swift-demo etc.).
5. Reference namespaces confirmed by these guides: `references/websdk` (v4), `references/websdk-v5`,
   `references/androidsdk` (v2), `references/androidsdk3`, `references/iossdk` — relevant when
   navigating the reference tree.

## INVENTORY (all pages in scope; all 11 fetched and read)

| fqdn | kind | title |
|---|---|---|
| guides.sdk | folder | SDKs |
| guides.sdk.android-migration-guide | tutorial | Android SDK v3 migration guide |
| guides.sdk.web-sdk-migration-guide | tutorial | Web SDK v5 migration guide |
| guides.sdk.authorization-onetimekey | tutorial | Authorization: one-time key |
| guides.sdk.authorization-tokens | tutorial | Authorization: renewable tokens |
| guides.sdk.ios-push | tutorial | iOS: Push notifications |
| guides.sdk.ios-callkit | tutorial | iOS: CallKit |
| guides.sdk.android-push | tutorial | Android: Push notifications |
| guides.sdk.android-connectionservice | tutorial | Android: ConnectionService |
| guides.sdk.screen-sharing | tutorial | Screen sharing |
| guides.sdk.custom-video-sources | tutorial | Custom video sources |
