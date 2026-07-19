# Voximplant Docs Research — Group: sdk-mobile

Scope: references.androidsdk (Android SDK v2, 88 pages), references.androidsdk3 (Android SDK v3, 128 pages), references.iossdk (iOS SDK v2, 91 pages), references.ios_v3 (iOS SDK v3, 5 pages). Total 308 manifest pages. Fetched 39 (root/folder/focus pages via getDoc API).

NOTE: intended output path was `<scratchpad>/vox-research/sdk-mobile.md`, but this session ran under plan-mode (read-only; only this plan file writable), so notes live here.

---

## 1. Android SDK v2 (`references.androidsdk`, Java/Kotlin, package com.voximplant.sdk)

Structure: 4 ref_folders (call, client, hardware, messaging) + top-level `Voximplant` class + Changelog. Folder pages are nav-only shells (no prose).

### Voximplant (top-level class) — "Primary interface of the SDK"
- `getClientInstance(executor, context, ClientConfig)` -> IClient — entry point (connect/login/make/receive calls).
- `getAudioDeviceManager()` -> IAudioDeviceManager; `getCameraManager(ctx)`; `getCustomVideoSource()`; `getMessenger()`; `getMessengerPushNotificationProcessing()`.
- `createAudioFile(url|uri|resId, AudioFileUsage)` -> IAudioFile — play audio from URL/resource.
- `getMissingPermissions(ctx, videoSupportEnabled)` — runtime-permission helper (RECORD_AUDIO, BLUETOOTH_CONNECT for audio calls).
- `setLogListener(ILogListener)`.

### client folder
- **IClient**: `connect(Node[, connectivityCheck, gateways])`, `disconnect()`, `login(user, password)`, `loginWithAccessToken`, `loginWithOneTimeKey`, `refreshToken`, `requestOneTimeKey`, `call(number, CallSettings)` -> ICall (must then `start()`), `callConference(number, settings)`, `handlePushNotification(Map)`, `registerForPushNotifications` / `unregisterFromPushNotifications` (FCM/HMS token + IPushTokenCompletionHandler), `getClientState()`, listeners: setClientIncomingCallListener / setClientLoginListener / setClientSessionListener.
- **ClientConfig** props: enableVideo (default true), enableDebugLogging, enableLogcatLogging, enableVideoAdaptation, forceRelayTraffic (TURN), preferredVideoCodec (default VP8), statsCollectionInterval (default 5000ms, multiple of 500), requestAudioFocusMode (REQUEST_ON_CALL_START default), packageName (multi-app push), useHmsForPushNotifications (Huawei), eglBase, enableCameraMirroring.
- **Node** enum — account's connection node (must match Voximplant account node; also exists in v3 + iOS as VIConnectionNode).
- Other pages: AuthParams (access/refresh token lifetimes), ClientException, ClientState enum, IClientIncomingCallListener, IClientLoginListener (onLoginSuccessful returns AuthParams w/ tokens), IClientSessionListener (onConnectionEstablished/Failed/Closed), ILogListener, IPushTokenCompletionHandler, LoginError, LogLevel, PushTokenError, RequestAudioFocusMode.

### call folder
- **ICall**: `start()` (outgoing), `answer(CallSettings)`, `reject(RejectMode, headers)` (DECLINE = busy/486 vs BLOCK), `hangup(headers)`, `hold(enable, handler)` (NOT supported in conference calls since 2.23.0 → CallError.INCORRECT_OPERATION), `sendAudio(enable)` (mic mute), `sendDTMF(tone)` (only after onCallConnected), `sendInfo(mime, content, headers)` (SIP INFO), `sendMessage(text)` (atop SIP INFO; separate from Messaging API — pairs with VoxEngine call.sendMessage), `sendVideo`/`receiveVideo`/`startScreenSharing`/`useCustomVideoSource`, `getCallId()`, `getCallDuration()`, `getEndpoints()`, quality-issue APIs (`getCurrentQualityIssues`, `setQualityIssueListener`), add/removeCallListener.
- **ICallListener** events: onCallConnected(headers), onCallDisconnected(headers, answeredElsewhere), onCallFailed(code, description, headers), onCallRinging (fires when scenario calls Call.ring), onCallAudioStarted (fires when scenario calls Call.answer or startEarlyMedia — direct bridge to VoxEngine semantics), onCallReconnecting/onCallReconnected, onCallStatsReceived (interval = ClientConfig.statsCollectionInterval), onEndpointAdded, onICECompleted/onICETimeout, onLocalVideoStreamAdded/Removed, onMessageReceived (in-call messages from scenario), onSIPInfoReceived.
- Rest of folder: CallError/CallException, CallSettings (customData → readable in scenario CallAlerting; extraHeaders X-*; preferredVideoCodec; videoFlags), CallStats/EndpointStats/Inbound&OutboundAudio/VideoStats/VideoStreamLayerStats, IEndpoint/IEndpointListener, audio/video stream interfaces (IAudioStream, ILocal/IRemoteAudioStream, ILocal/IRemoteVideoStream, IVideoStream), QualityIssue/QualityIssueLevel enums, RejectMode, RenderScaleType, VideoCodec, VideoFlags, VideoStreamReceiveStopReason, VideoStreamType, ICallCompletionHandler, IQualityIssueListener.

### hardware folder (FOCUS: audio devices)
- **IAudioDeviceManager**: supports EARPIECE / SPEAKER / WIRED_HEADSET / BLUETOOTH (AudioDevice enum, + NONE = error state). `getActiveDevice()`, `getAudioDevices()`, `selectAudioDevice(device)` — before a call it only *selects* (activation at call start); during a call it activates immediately. `add/removeAudioDeviceEventsListener`, `setAudioFocusChangeListener`, `setTelecomConnection(Connection)` — hands audio routing to Android Telecom for self-managed ConnectionService.
- Also: AudioFileUsage enum, IAudioFile/IAudioFileListener (playback from URL/resource), IAudioFocusChangeListener, camera pages (CameraResolution, ICameraEventsListener, ICameraManager, ICustomVideoSource(+Listener), VideoQuality).

### messaging folder
- **IMessenger**: createConversation, getConversation(s) (max 30), getPublicConversations, joinConversation/leaveConversation, getUser(sByIMId/ByName) (max 50), subscribe/unsubscribe(FromAll), setStatus, editUser, managePushNotifications, recreateConversation/recreateMessage (restore from local DB, not create), add/removeMessengerListener, getMe.
- Rest: ConversationConfig(+Builder), ConversationParticipant, IConversation, event interfaces (IConversationEvent, IConversationListEvent, IConversationServiceEvent, IErrorEvent, IMessage, IMessageEvent, IMessengerCompletionHandler, IMessengerEvent, IMessengerListener, IMessengerPushNotificationProcessing, IRetransmitEvent, IStatusEvent, ISubscriptionEvent, IUser, IUserEvent), enums MessengerAction/MessengerEventType/MessengerNotification.

## 2. Android SDK v3 (`references.androidsdk3`, Kotlin-first, package com.voximplant.android.sdk.*)

Modular re-architecture: `core` (connection/auth/push/audio/logging), `calls` (calls+conference+video+stats), `messaging`, `renderer.compose` (Jetpack Compose `VideoRenderer(modifier, videoStream, renderScaleType)` composable). Singleton objects replace factory interfaces.

### core
- **VICore** (object): `initialize(context)` required first; `callbackExecutor` (single-thread default — all SDK events delivered there), `logging`, `version`, `isInitialized`.
- **Client** (object; replaces IClient for session): `connect(ConnectOptions, ConnectionCallback)`, `disconnect()`, `login/loginWithAccessToken/loginWithOneTimeKey/refreshToken/requestOneTimeKey` — all callback-based (LoginCallback/RefreshTokenCallback/GenerateOneTimeKeyCallback), `handlePushNotification(Map)`, `registerForPushNotifications(PushConfig, cb)` / unregister, `setClientSessionListener`, props `clientState`, `displayName`.
- **ConnectOptions**(Node) + `gateways`, `services: MobileServices` (Google vs Huawei — affects push).
- audio module: **AudioDeviceManager** (object) — auto audio routing when a call/conference is active; `audioDevices` list, `selectedAudioDevice`, `selectAudioDevice`, `getAudioDeviceOfType(AudioDeviceType)`, `setDefaultAudioDeviceType` (fallback priority; only Earpiece/Speaker allowed), `setTelecomConnection` (Android 12+/API 31 Telecom-managed routing), `audioFocusListener`, add/removeAudioDeviceListener. **AudioDevice** is now a class (id, name, type, hasMic) instead of enum; AudioDeviceType enum; AudioFile(+Listener,+Usage); AudioFocusListener.
- logging module: Logger, Logging, LogLevel. Plus AuthParams, ClientSessionListener, ClientState, ConnectionCallback/ConnectionError, DisconnectReason, LoginCallback/LoginError, MobileServices, Node, PushConfig, PushTokenError, RegisterPushTokenCallback, GenerateOneTimeKeyCallback, RefreshTokenCallback.

### calls
- **VICalls** (object): `initialize()` (separate from VICore.initialize), `createCall(number, CallSettings)` -> Call?, `createConference(number, ConferenceSettings)` -> Conference, `setIncomingCallListener`, `getMissingPermissions(videoSupportEnabled)`, props `calls`/`conferences` maps, `eglBase` (set before initialize).
- **Call** (class): answer/reject(RejectMode)/hangup(headers)/hold/`muteAudio(muted)` (renamed from sendAudio), sendDTMF/sendInfo/sendMessage, start(), startSendingVideo(LocalVideoStream, cb)/stopSendingVideo (explicit stream objects; must close stream after stop), setCallListener/setQualityIssueListener; props: id, state (CallState enum — new in v3), direction (CallDirection), duration (ms), isMuted, isOnHold, isVideoEnabled, number, remoteDisplayName/remoteSipUri (available after onCallConnected for outgoing), localVideoStream, remoteVideoStreams, currentQualityIssues.
- **CallListener** events (set via Call.setCallListener; delivered on VICore.callbackExecutor): onCallConnected(withVideo, headers), onCallDisconnected(headers, **CallDisconnectReason** — replaces answeredElsewhere bool), onCallFailed(code, description, headers), onCallReconnecting/onCallReconnected, onCallStatsReceived, **onStartRinging/onStopRinging** (renamed from onCallRinging/onCallAudioStarted; explicitly "start/stop playing progress tone"), onInfoReceived/onMessageReceived, onRemoteVideoStreamAdded/Removed, **onCallUpgradeRequested(call, CallUpgradeDecision)** / onCallUpgradeRequestTimeout — audio→video upgrade consent flow (new in v3).
- video module: CameraDevice(+Type/Orientation/Resolution), CameraVideoSource (object), CustomVideoSource, ScreenCaptureVideoSource, StabilizationMode, VideoSource (+StopReason/EventsListener/Error hierarchy: NotInitialized, CameraError, CameraNotFound, CameraPermissionRequired, Interrupted).
- stats module: CallStats, CandidateType, ConferenceStats, EndpointStats, Inbound/OutboundAudio/VideoStats, Stats, VideoStreamLayerStats.
- Conference is a first-class separate class (Conference, ConferenceListener, ConferenceSettings, ConferenceDisconnectReason) — in v2 conferences were ICall via callConference.
- Misc: AudioStream/Local/RemoteAudioStream, CallCallback, CallError/CallException, CallSettings (has own statsCollectionInterval now), CallUpgradeDecision(+Callback/Error)+Exception, Endpoint(+Listener), IncomingCallListener, QualityIssue(+Level/Listener), RejectMode, RemoteVideoStream/LocalVideoStream/VideoStream(+OnSizeChangedCallback/Error/RendererCallback), RenderScaleType, Rotation, VideoCodec, VideoStreamReceiveStopReason, VideoStreamType.

### messaging (v3)
Class-based mirror of v2: Conversation, ConversationConfig(+Builder), ConversationEvent/ListEvent/Participant/ServiceEvent, ErrorEvent, Message(+Event), Messenger (object), MessengerAction/Callback/Event/EventType/Listener/Notification, MessengerPushNotificationProcessing, RetransmitEvent, StatusEvent, SubscriptionEvent, User(+Event).

## 3. iOS SDK v2 (`references.iossdk`, Obj-C/Swift, VI-prefixed)

Structure mirrors Android v2: call / client / hardware / messaging folders + Changelog. Folder pages DO carry one-line summaries per type (unlike Android's empty folders). Method titles in the docs API come back as locale objects ({objectivec, swift}) — rendered "[object Object]" in manifests; signatures still resolvable from params.

### client
- **VIClient**: init `VIClient(delegateQueue:[, bundleId:])` (bundleId for multi-app push), `connect(node: VIConnectionNode[, connectivityCheck, gateways])`, disconnect, `login(withUser:password:/token:/oneTimeKey: success: failure:)` (VILoginSuccess returns displayName + VIAuthParams), refreshToken, requestOneTimeKey, `call(number, settings)` -> VICall? and conference call variant (start via VICall.start()), `calls` dictionary, clientState, sessionDelegate (VIClientSessionDelegate), callManagerDelegate (VIClientCallManagerDelegate — incoming calls), push: register/unregister VoIP (PushKit voipToken) + IM tokens with VICompletionBlock, `handlePushNotification` -> UUID? (matches CallKit), static setLogLevel/setLogDelegate (before instance creation), clientVersion/webrtcVersion, enableForceRelayTraffic, enableVideoAdaptation.
- Others: VIAuthParams, VIClientState, VIConnectionNode (account node — see iOS getting-started), VICompletionBlock/VILoginSuccess/VILoginFailure/VIOneTimeKeyResult/VIRefreshTokenResult typedefs, VILogDelegate/VILogLevel/VILogSeverity, error enums (VIConnectivityErrorCode, VILoginErrorCode, VIPushTokenErrorCode).

### call
- **VICall**: addDelegate/removeDelegate (multiple VICallDelegate supported), start(), answer(settings), reject(mode, headers), hangup(headers), setHold(completion) (unsupported in conferences → incorrectOperation), `sendAudio` Bool property (mic), sendDTMF -> Bool, sendInfo/sendMessage (SIP INFO channel to scenario), setSendVideo/startReceiveVideo/startInAppScreenSharing, callId, **callKitUUID** (matches call to VoIP push; nil for outgoing until set), duration, endpoints, localVideoStreams, videoSource, quality-issue APIs (qualityIssueDelegate, issueLevel(for:), qualityIssues()).
- **VICallDelegate** events = Android ICallListener equivalents: didConnect, didDisconnectWithHeaders:answeredElsewhere:, didFailWithError, startRinging (scenario Call.ring), didStartAudio (scenario Call.answer/startEarlyMedia), reconnecting/didReconnect, didReceiveStatistics, didAddEndpoint, ICE completed/timeout, local video stream added/removed, didReceiveInfo/didReceiveMessage.
- **VICallSettings**: `customData` (→ scenario CallAlerting event), extraHeaders (X-*), preferredVideoCodec (default .auto), receiveAudio (default YES), statsCollectionInterval (5000ms, multiples of 500), videoFlags, enableSimulcast (conference only).
- Rest: VIAudioStream, VICallError/FailErrorCode enums, VICallStats/VIEndpointStats/in-out audio/video stats/VIVideoStreamLayerStats, VIEndpoint(+Delegate), VILocal/RemoteAudio/VideoStream, VIQualityIssue{Delegate,Level,Type}, VIRejectMode, VIVideoCodec, VIVideoFlags, VIVideoStream(+ReceiveStopReason/Type).

### hardware (FOCUS: audio devices)
- **VIAudioManager** (sharedAudioManager singleton): availableAudioDevices() -> Set<VIAudioDevice>, currentAudioDevice(), select(audioDevice) (same select-vs-activate semantics as Android), `speakerIsDefault` Bool, `mode: AVAudioSessionMode` (VoiceChat default; VideoChat for video), delegate (VIAudioManagerDelegate — route changes). CallKit integration methods: callKitConfigureAudioSession(error:), callKitStartAudio/callKitStopAudio, callKitReleaseAudioSession (MUST be called after call ends) — "required for correct CallKit integration only, otherwise do not use".
- Documented limitations: can't select Receiver while wired headset connected; can't select Receiver while Bluetooth A2DP connected; mic-less wired headsets may still be selected as active; AirPods auto-ear-detection has known issues list.
- **VIAudioDeviceType** enum: none/receiver/speaker/wired/bluetooth. **VIAudioFile** player (formats .caf .wav .aiff .aifc .mp3 .ac3; auto-manages audio session; limitation on playing during calls per description).
- Rest: VIAudioDevice, VIAudioFileDelegate/ErrorCode, VICameraManager, VICustomVideoSource(+Delegate), VIRotation, VISupportedDeviceOrientation, VIVideoFormat, VIVideoPreprocessDelegate, VIVideoRenderer(View)(+Delegate), VIVideoResizeMode, VIVideoSource.

### messaging (iOS v2)
VI-prefixed mirror of Android messaging: VIConversation(+Config/Event/ListEvent/Participant/ServiceEvent), VIErrorEvent, VIMessage(+Event), VIMessenger(+Action/Completion/Delegate/Event/EventType/Notification), VIRetransmitEvent, VIStatusEvent, VISubscriptionEvent, VIUser(+Event).

## 4. iOS SDK v3 (`references.ios_v3`)

Only 5 manifest pages: root + 3 modules (Core, Calls, Messaging) + Changelog. Modules are split Swift packages (VoximplantCore / VoximplantCalls / VoximplantMessaging). The in-site pages are stubs that link out to DocC-style docs at `/docs/references/ios_v3/{core|calls|messaging}/documentation/voximplant{core|calls|messaging}` — the actual v3 API reference is NOT enumerated in this manifest (external DocC bundle). Core = connectivity/auth/push config; Calls = voice calls + video conferences; Messaging = groups/channels/chats.

## Cross-cutting gotchas
- Both v2 SDKs share the same session model: connect → login (password/token/one-time-key) → tokens (AuthParams) for re-login; push-driven wakeup (FCM/HMS on Android, PushKit VoIP on iOS + CallKit UUID matching).
- Client events tie directly to VoxEngine scenario calls: onCallRinging ↔ Call.ring(), onCallAudioStarted ↔ Call.answer()/startEarlyMedia(), in-call messaging ↔ scenario call.sendMessage (SIP INFO transport).
- CallSettings.customData is the SDK-side twin of script_custom_data: passed to cloud, read in scenario via CallAlerting.
- v3 SDKs (both platforms) are breaking rewrites: singletons + explicit module init (VICore.initialize + VICalls.initialize on Android), disconnect-reason enums, renamed ringing events, explicit video-stream lifecycle, Compose renderer; iOS v3 docs hosted as separate DocC bundles.
- statsCollectionInterval everywhere: 5000ms default, must be multiple of 500 (rounded down otherwise).
- Hold not supported in conference calls (both v2 SDKs, Android since 2.23.0).

## KALFA relevance
Mobile SDKs are for in-app VoIP endpoints (app users making/receiving calls in a mobile app). KALFA's flow is server-driven PSTN outbound (Management API StartScenarios → VoxEngine → callPSTN to +972 guests) with no mobile app — so this whole group is NOT on KALFA's critical path. Useful transferable facts: (1) confirmation that client-side ringing/audio events map 1:1 to scenario Call.ring/answer/startEarlyMedia — helpful mental model when debugging call progress from the scenario side; (2) CallSettings.customData ↔ CallAlerting is the SDK analogue of the 200-byte script_custom_data channel; (3) in-call sendMessage rides SIP INFO and pairs with VoxEngine call.sendMessage — a possible low-latency signaling channel if KALFA ever ships an app-based "owner listens in / whisper" feature; (4) if KALFA ever builds an owner-side mobile softphone (e.g. let the event owner take over an AI call), Android v3 + iOS v3 are the current-generation choices, and push+CallKit/Telecom integration is the bulk of the work.

---

## INVENTORY (every page in scope; ✔ = fetched)

### references_androidsdk.txt — Android SDK (88 pages)
- ✔ Android SDK (root)
- ✔ call (ref_folder): CallError, CallException, CallSettings, CallStats, EndpointStats, IAudioStream, ✔ ICall, ICallCompletionHandler, ✔ ICallListener, IEndpoint, IEndpointListener, ILocalAudioStream, ILocalVideoStream, InboundAudioStats, InboundVideoStats, IQualityIssueListener, IRemoteAudioStream, IRemoteVideoStream, IVideoStream, OutboundAudioStats, OutboundVideoStats, QualityIssue, QualityIssueLevel, RejectMode, RenderScaleType, VideoCodec, VideoFlags, VideoStreamLayerStats, VideoStreamReceiveStopReason, VideoStreamType
- ✔ client (ref_folder): AuthParams, ✔ ClientConfig, ClientException, ClientState, ✔ IClient, IClientIncomingCallListener, IClientLoginListener, IClientSessionListener, ILogListener, IPushTokenCompletionHandler, LoginError, LogLevel, Node, PushTokenError, RequestAudioFocusMode
- ✔ hardware (ref_folder): ✔ AudioDevice, AudioFileUsage, CameraResolution, IAudioDeviceEventsListener, ✔ IAudioDeviceManager, IAudioFile, IAudioFileListener, IAudioFocusChangeListener, ICameraEventsListener, ICameraManager, ICustomVideoSource, ICustomVideoSourceListener, VideoQuality
- ✔ messaging (ref_folder): ConversationConfig, ConversationConfigBuilder, ConversationParticipant, IConversation, IConversationEvent, IConversationListEvent, IConversationServiceEvent, IErrorEvent, IMessage, IMessageEvent, ✔ IMessenger, IMessengerCompletionHandler, IMessengerEvent, IMessengerListener, IMessengerPushNotificationProcessing, IRetransmitEvent, IStatusEvent, ISubscriptionEvent, IUser, IUserEvent, MessengerAction, MessengerEventType, MessengerNotification
- ✔ Voximplant (class); Changelog

### references_androidsdk3.txt — Android SDK v3 (128 pages)
- ✔ Android SDK v3 (root)
- com.voximplant.android.sdk.calls (ref_folder):
  - video (module): CameraDevice, CameraDeviceType, CameraOrientation, CameraResolution, CameraVideoSource, CustomVideoSource, ScreenCaptureVideoSource, StabilizationMode, VideoSource (+ StopReason, EventsListener, Error: NotInitialized, CameraError, CameraNotFound, CameraPermissionRequired, Interrupted)
  - stats (module): CallStats, CandidateType, ConferenceStats, EndpointStats, InboundAudioStats, InboundVideoStats, OutboundAudioStats, OutboundVideoStats, Stats, VideoStreamLayerStats
  - AudioStream, ✔ Call, CallCallback, CallDirection, CallDisconnectReason, CallError, CallException, ✔ CallListener, CallSettings, CallState, CallUpgradeDecision (+ Callback, Error), CallUpgradeDecisionException, Conference, ConferenceDisconnectReason, ConferenceListener, ConferenceSettings, Endpoint, EndpointListener, IncomingCallListener, LocalAudioStream, LocalVideoStream, QualityIssue, QualityIssueLevel, QualityIssueListener, RejectMode, RemoteAudioStream, RemoteVideoStream, RenderScaleType, Rotation, ✔ VICalls, VideoCodec, VideoStream (+ OnSizeChangedCallback, Error, RendererCallback), VideoStreamReceiveStopReason, VideoStreamType
- com.voximplant.android.sdk.core (ref_folder):
  - logging (module): Logger, Logging, LogLevel
  - ✔ audio (module): ✔ AudioDevice, AudioDeviceListener, ✔ AudioDeviceManager, AudioDeviceType, AudioFile, AudioFileListener, AudioFileUsage, AudioFocusListener
  - AuthParams, ✔ Client, ClientSessionListener, ClientState, ConnectionCallback, ConnectionError, ✔ ConnectOptions, DisconnectReason, GenerateOneTimeKeyCallback, LoginCallback, LoginError, MobileServices, Node, PushConfig, PushTokenError, RefreshTokenCallback, RegisterPushTokenCallback, ✔ VICore
- com.voximplant.android.sdk.messaging (ref_folder): Conversation, ConversationConfig (+ Builder), ConversationEvent, ConversationListEvent, ConversationParticipant, ConversationServiceEvent, ErrorEvent, Message, MessageEvent, Messenger, MessengerAction, MessengerCallback, MessengerEvent, MessengerEventType, MessengerListener, MessengerNotification, MessengerPushNotificationProcessing, RetransmitEvent, StatusEvent, SubscriptionEvent, User, UserEvent
- ✔ com.voximplant.android.sdk.renderer.compose (ref_folder — VideoRenderer composable); Changelog

### references_iossdk.txt — iOS SDK (91 pages)
- ✔ IOS SDK (root)
- ✔ call (ref_folder): VIAudioStream, ✔ VICall, ✔ VICallDelegate, VICallErrorCode, VICallFailErrorCode, ✔ VICallSettings, VICallStats, VIEndpoint, VIEndpointDelegate, VIEndpointStats, VIInboundAudioStats, VIInboundVideoStats, VILocalAudioStream, VILocalVideoStream, VIOutboundAudioStats, VIOutboundVideoStats, VIQualityIssueDelegate, VIQualityIssueLevel, VIQualityIssueType, VIRejectMode, VIRemoteAudioStream, VIRemoteVideoStream, VIVideoCodec, VIVideoFlags, VIVideoStream, VIVideoStreamLayerStats, VIVideoStreamReceiveStopReason, VIVideoStreamType
- ✔ client (ref_folder): VIAuthParams, ✔ VIClient, VIClientCallManagerDelegate, VIClientSessionDelegate, VIClientState, VICompletionBlock, VIConnectionNode, VIConnectivityErrorCode, VILogDelegate, VILoginErrorCode, VILoginFailure, VILoginSuccess, VILogLevel, VILogSeverity, VIOneTimeKeyResult, VIPushTokenErrorCode, VIRefreshTokenResult
- ✔ hardware (ref_folder): VIAudioDevice, ✔ VIAudioDeviceType, VIAudioFile, VIAudioFileDelegate, VIAudioFileErrorCode, ✔ VIAudioManager, VIAudioManagerDelegate, VICameraManager, VICustomVideoSource, VICustomVideoSourceDelegate, VIRotation, VISupportedDeviceOrientation, VIVideoFormat, VIVideoPreprocessDelegate, VIVideoRenderer, VIVideoRendererView, VIVideoRendererViewDelegate, VIVideoResizeMode, VIVideoSource
- ✔ messaging (ref_folder): VIConversation, VIConversationConfig, VIConversationEvent, VIConversationListEvent, VIConversationParticipant, VIConversationServiceEvent, VIErrorEvent, VIMessage, VIMessageEvent, VIMessenger, VIMessengerAction, VIMessengerCompletion, VIMessengerDelegate, VIMessengerEvent, VIMessengerEventType, VIMessengerNotification, VIRetransmitEvent, VIStatusEvent, VISubscriptionEvent, VIUser, VIUserEvent
- Changelog

### references_ios_v3.txt — iOS SDK v3 (5 pages)
- ✔ iOS SDK v3 (root); ✔ Core (module); ✔ Calls (module); ✔ Messaging (module); Changelog
