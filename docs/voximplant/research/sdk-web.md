# Voximplant Docs Research — Group: sdk-web (Web SDK v5 + legacy Web SDK)

Research notes for the KALFA Voximplant documentation-mapping fleet. Scope: the entire
`references.websdk-v5` manifest (315 pages) and `references.websdk` legacy manifest (119 pages), 434 pages total.
Depth: STRUCTURAL — 33 pages fetched (roots, all module pages, key ref_folders, focus pages, changelog); the rest enumerated from the manifests.

NOTE: plan mode was active in this session, so these notes live in the plan file instead of `vox-research/sdk-web.md`.
Fetch recipe used (read-only, stdout only):
`curl -s 'https://voximplant.com/api/v2/getDoc?fqdn=<FQDN>' | jq -r '<title/desc/children extractor>'`
(The provided extract.js does NOT walk `.children`, where all reference members live — use jq for reference pages.)

---

## What the Web SDKs are

Both SDKs are **browser-side client SDKs**: they let a web page act as a Voximplant endpoint — connect to the Voximplant Cloud over WebSocket/WebRTC, log in as an application **user**, make/receive calls and conferences, exchange messages, and manage mic/camera/speaker hardware. They are the counterpart of VoxEngine scenarios: a Web SDK call terminates in the cloud where a scenario handles it.

- **Legacy Web SDK (4.x)** — monolithic singleton (`VoxImplant.getInstance()`), event-emitter style (`client.on(Events.X, handler)`), covers calls, conferences (incl. SharingCall/ViewerCall roles), messaging, hardware, ACD v1 + SmartQueue contact-center statuses.
- **Web SDK v5** — full rewrite: modular (tree-shakable module loaders registered into a `Core` container), promise-based, typed events with payload interfaces, reactive `Watchable` properties, richer error-class hierarchy, new modules (noise suppression, PushService, Statistics). Current version 5.2.0 (Jul 3, 2026).

## v5 architecture (Core module — fetched)

- `Core.init(options?: CoreInitOptions) => Core` — singleton init; since 5.2.0 options are optional.
- `Core.registerModules(modules: ModuleLoader[])` — register only what you need (CallLoader, ConferenceLoader, StreamLoader, MessagingLoader, SmartQueueLoader, PushServiceLoader, NoiseSuppression*Loader). Modules unavailable until registered.
- `Core.getModule(token)` / `getModuleAsync(token)` — retrieve module instances via exported tokens (`callToken`, `streamToken`, …).
- `Core.client: Client` — the connection/auth surface.

### Client interface (focus — fetched)
- `connect(options: ConnectionOptions): Promise<void>` (throws ConnectionErrors), `disconnect()`.
- Login methods, each promise-returning `LoginResult`: `login(PasswordLoginOptions)`, `loginAccessToken(AccessTokenLoginOptions)`, `loginOneTimeKey(OneTimeKeyLoginOptions)`, plus `requestOneTimeKey`, `refreshTokens(RefreshTokenOptions) => LoginTokens`.
- `addEventListener/removeEventListener(ClientEvent.Disconnected, listener, ListenerOptions)` — v5 Client has essentially ONE event (Disconnected w/ ClientDisconnectReason); state is exposed instead via `state: ReadonlyWatchable<ClientState>`.
- Login failures are typed error classes (LoginErrors): InvalidPassword, InvalidUser, TokenExpired, AccountFrozen, **LoginMauAccessDeniedError (Monthly-Active-Users limit reached — payment required)**, Timeout, NetworkIssues, InvalidState, Internal.
- ConnectionErrors: Network, Timeout, Interrupted (explicit disconnect), Internal.
- `ConnectionNode` enum — account node must be specified (NODE_13 added in 5.2.0); legacy `Config.node` same concept.

### Watchable (v5 reactive primitive — fetched)
`Watchable`/`ReadonlyWatchable<T>` with `watch(OnValueChangeCallback, WatchOptions) => UnwatchFunction`; strict-equality change detection. Nearly all live state in v5 (client state, call state, mute, hold, streams sets) is Watchable rather than event-only.

### Logger (enumerated)
LogLevel, TimeFormat, LoggerOptions, LogCallbackFunction/LogCallBackProps, LogRecordExtraData — pluggable log pipeline.

## v5 Call module (focus — fetched)

- `CallManager` creates calls; `CallManagerEvent.IncomingCall` (CallManagerIncomingCall/Payload) is the only manager event.
- `Call` interface: `start()` (outgoing), `answer(CallSettings)`, `reject(RejectMode, headers)`, `hangup(headers)`, `hold(enable)`, `mute/unmute/toggleMicrophone`, `sendDTMF(tones)`, `sendInfo(mime, body, headers)`, `sendMessage(text)` (SIP-INFO transport, separate from Messaging module), `addStream/removeStream/replaceStream(LocalStream)`, `start/stopScreenSharing`.
  - Gotcha: `start()`/`answer()` resolving ≠ connected; wait for `CallEvent.Connected`.
- Props (mostly Watchable): `state: CallState`, `direction`, `duration` (ms), `id`, `destination`, `remoteDisplayName`/`remoteSipUri` (null until Connected on outgoing), `localStreams`/`remoteStreams: Set<Stream>`, `isMicrophoneMuted`, `isOnHold`, `isVideoEnabled`, `videoSendingStatus`, `hasScreenSharing`.
- CallEvents (typed event+payload pairs): Connected, Disconnected (CallDisconnectReason), Failed, InfoReceived, MessageReceived, RemoteMediaAdded/Removed, StartRinging/StopRinging, StatsReport, **CallUpgrade** (new in 5.2.0 — accept/reject audio→video upgrade; if neither called the upgrade is auto-declined).
- Error classes: CallInternal, CallNotFound, CallNotOnHold/CallOnHold, CallTransferFailed/Timeout, CallWrongDirection, CallWrongState.
- `CallSettings` = extra call params: preferred video codec, custom data, extra headers (headers reach the VoxEngine scenario).

## v5 Conference module (fetched module page)
Dedicated conference client: `ConferenceManager`, `Conference`, `Endpoint` (remote participant with per-endpoint media events Start/StopReceivingAudio/VideoStream), `ConferenceSettings`, simulcast (`SimulcastLayerRid`), screen-sharing events + errors, `ConferenceState`, `StreamReceiveStopReason`. Events mirror Call: Connected/Disconnected/Failed/EndpointAdded/Removed/Info/Message/ScreenSharing*/StatsReport.

## v5 Stream module (fetched module page)
Media/hardware layer, replaces legacy Hardware module:
- `StreamManager` (create local audio/video/screen streams), `RendererManager` + `AudioRenderer`/`VideoRenderer` (attach media to DOM), `Hardware` (device management), `DevicePermission` (permission states; Firefox gotcha: dismissing the popup = temporary denial), `DeviceTrackerHelper` (auto-handle device plug/unplug mid-call — heavily refactored in 5.2.0), `AudioProcessor`/`WasmProcessor` + `AudioProcessingType/State`.
- Config types: AudioConstraints/AudioPreset/AudioConfig, VideoConstraints/ExtendedVideoConstraints/VideoQuality/FrameRate/VideoResolution, ScreenSharingConfig/Quality, StreamType, StreamSource ("local"|"remote"), InputDevice/OutputDevice/DeviceKind.
- StreamEvent: only `StreamEnded`.

## v5 NoiseSuppression modules (fetched)
Two loadable variants, both = noise suppression + echo cancellation + AGC:
- **Aggressive** — high CPU, "only for very noisy environments", high-end devices/desktop.
- **Balanced** — moderate CPU, mid-range/desktop; **not recommended for mobile devices**.

## v5 PushService module (fetched)
New in 5.2.0 — browser push notifications for **incoming calls even when the tab is closed**. `PushService` + `PushTokenOptions` (register/unregister token), error classes (InvalidToken, Timeout, ConnectionClosed, Cancelled, Internal).

## v5 SmartQueue module (fetched)
Contact-center agent status control from the browser: `SmartQueue.setCallStatus`/`setMessagingStatus` (+ optional `SetSmartQueueStatusOptions` since 5.2.0); status enums split into AgentStatus (agent-settable), CustomStatus, SystemStatus (auto-assigned); events CallStatusUpdated/UpdateFailed, MessagingStatusUpdated/UpdateFailed.

## v5 Statistics module (fetched)
`StatisticsReport` = ConnectionStatsReport + per-stream Local/RemoteAudio/VideoStatsReport keyed by stream id; LocalVideoLayerStats for simulcast layers. 5.2.0 fixed screensharing metrics.

## v5 Messaging module (fetched module page)
Same messaging backend as other SDKs: `Messaging` → `Messenger` → `Conversation`/`Message`/`User`/`ConversationParticipant` (default perms: write/edit-own/remove-own). ConversationConfig/EditOptions/SendMessageOptions (text and/or payload), MessengerEventType/MessengerAction events (OnSendMessage, OnEditMessage, IsRead, OnTyping, subscriptions, retransmit ~ history replay), MessengerError/MessengerErrorCode.

## v5 Changelog highlights (fetched)
- **5.2.0 (Jul 3, 2026)**: PushService module introduced; audio→video call-upgrade APIs; `Core.init` options optional; ConnectionNode.NODE_13; DeviceTrackerHelper refactor; fixes (answer during reconnection, reject in reconnecting state, audio routing after rapid device changes, screensharing stats).
- **5.1.0 (Feb 3, 2026)** and earlier entries exist on the changelog page (not fully extracted).

## Legacy Web SDK (references.websdk — fetched root/Client/Call/Events/CallEvents/Config)

- Singleton: `VoxImplant.getInstance()`; `getMessenger()` for messaging. `version` const.
- `Client.init(Config)` → `Events.SDKReady`; `connect()` → ConnectionEstablished/Failed/Closed; `login/loginWithToken/loginWithOneTimeKey` → **`Events.AuthResult`** (result via event + AuthResultCode, not promise rejection); `tokenRefresh`.
- `Client.call(...)`, `callConference(...)`, `joinAsSharing`/`joinAsViewer` (conference roles → SharingCall/ViewerCall classes), `transferCall`, codec controls (`limitAudioCodecs/limitVideoCodecs`, `setVideoBandwidth`, per-call `rearangeCodecs`), ToneScript playback (`playToneScript`/`stopPlayback`), silent-log facility (`enableSilentLogging`/`getSilentLog`, `setLoggerCallback`), push (`registerForPushNotifications`, `handlePushNotification`), ACD v1 + SmartQueue statuses (`setOperatorACDStatus`, `setOperatorSQMessagingStatus`), `audioMediaTrackTransform`/`videoMediaTrackTransform` hooks.
- `Call` class: `answer`/`decline` (all devices) vs `reject` (this SDK only), `hangup`, `sendTone` (DTMF → VoxEngine ToneReceived), `sendInfo` (SIP INFO → VoxEngine InfoReceived), `sendMessage`, `getEndpoints`, active-call model (`active()`/`setActive` — one active call, others must be activated), `shareScreen`/`stopSharingScreen`, `mutePlayback`.
- Client events (`Events`): SDKReady, ConnectionEstablished/Failed/Closed, AuthResult, RefreshTokenResult, IncomingCall, MicAccessResult, Reconnecting/Reconnected, Playback*, ACD/SQ events.
- CallEvents: Connected (2–3 s possible lag vs first audio), Disconnected, Failed (status codes table: 486 busy, 487 request terminated, …), ProgressToneStart/Stop (mapped to scenario-side `Call.ring()` / `answer()`/`startEarlyMedia()`), ICECompleted/ICETimeout, EndpointAdded/Removed, MessageReceived, InfoReceived, RTCStatsReceived (raw RTCStatsReport every 10 s), CallStatsReceived (interval via `Config.rtcStatsCollectionInterval`, default 1000 ms, multiple of 500), Transfer events, Updated, SharingStopped, StateUpdated, ActiveUpdated.
- `Config` interface: node (required — account node), micRequired, progressTone/progressToneCountry (RU/US only), H264first, queueType (ACD|SmartQueue), video container ids, showDebugInfo/enableTrace.
- EventHandlers module = the payload interfaces for all the above events; Hardware module = AudioDeviceManager/CameraManager/StreamManager (+ HardwareEvents, AudioParams, CameraParams, VideoQuality); Messaging module = same messenger model as v5 (class-based; serialized forms SerializedConversation/SerializedMessage).

## v5 vs legacy — key differences (focus)

| Aspect | Legacy (4.x) | v5 |
|---|---|---|
| Structure | Monolithic singleton | Modular Core + registerModules (tree-shaking) |
| Async style | Event-driven (AuthResult etc.) | Promise-based + typed error classes |
| Live state | Getter methods + events | `Watchable` reactive properties |
| Events | String enums, one big EventHandlers bag | Per-module typed event enum + Event/Payload interface pairs |
| Media | Hardware module, renderer via events | Stream module: StreamManager/RendererManager/DevicePermission/DeviceTrackerHelper |
| Extras only in v5 | — | NoiseSuppression modules, PushService (tab-closed incoming-call push), Statistics module, call upgrade audio→video |
| Extras only in legacy | ToneScript playback, ACD v1, joinAsViewer/joinAsSharing roles, codec limiting APIs, media-track transform hooks | (v5: conference roles via Conference module; no ToneScript/ACD v1) |
| Billing-relevant | — | v5 login can fail with LoginMauAccessDeniedError (MAU limit) |

## KALFA relevance

KALFA's calling is **outbound PSTN via Management API StartScenarios + VoxEngine** — no browser endpoint is involved, so the Web SDKs are **not on KALFA's critical path**. Where they could matter:
- **Human-agent escalation / operator console**: if a guest asks for a human ("notify_owner" flow), a browser softphone for the event owner or a KALFA operator would be built on Web SDK v5 (Core+Call+Stream modules) with SmartQueue if a queue is ever introduced. Hebrew/RTL is irrelevant to the SDK itself (it is UI-less).
- **In-browser call testing/QA**: a Web SDK user endpoint is the cheapest way to test VoxEngine scenarios (SDK↔scenario legs are free/cheap vs PSTN) — useful for iterating the he-IL conversation flow without dialing +972 numbers.
- **DTMF/SIP INFO semantics**: Web SDK `sendDTMF`/`sendInfo` documents the browser side of the same VoxEngine `ToneReceived`/`InfoReceived` events KALFA's scenario could use for keypad fallback RSVP.
- **MAU billing note**: Web SDK logins count toward Monthly Active Users (LoginMauAccessDeniedError) — a cost dimension only if KALFA ever ships browser calling.
- New project code should target **v5** (legacy 4.x is the older generation; v5 is actively developed — 5.2.0 Jul 2026).

---

# INVENTORY (every page in scope)

## Manifest: references_websdk-v5.txt (315 pages)

- Web SDK v5 [root]
- **Call [module]** — CallEvents [ref_folder]: CallDisconnectReason, CallEvent, CallConnected, CallConnectedPayload, CallDisconnected, CallDisconnectedPayload, CallFailed, CallFailedPayload, CallInfoReceived, CallInfoReceivedPayload, CallMessageReceived, CallMessageReceivedPayload, CallRemoteMediaAdded, CallRemoteMediaAddedPayload, CallRemoteMediaRemoved, CallRemoteMediaRemovedPayload, CallStartRinging, CallStartRingingPayload, CallStatsReport, CallStatsReportPayload, CallStopRinging, CallStopRingingPayload, CallUpgrade, CallUpgradePayload, AnyCallEvent · CallManagerEvents [ref_folder]: CallManagerEvent, CallManagerIncomingCall, CallManagerIncomingCallPayload, AnyCallManagerEvent · Errors [ref_folder]: CallInternalError, CallNotFoundError, CallNotOnHoldError, CallOnHoldError, CallTransferFailedError, CallTransferTimeoutError, CallWrongDirectionError, CallWrongStateError · Call, CallManager, CallSettings [interfaces] · CallLoader [function] · CallDirection, CallState, CallUpgradeStatus, RejectMode, VideoSendingStatus [enums]
- **Conference [module]** — EndpointEvents [ref_folder]: EndpointEvent, EndpointRemoteMediaAdded, EndpointRemoteMediaAddedPayload, EndpointRemoteMediaRemoved, EndpointRemoteMediaRemovedPayload, EndpointStartReceivingAudioStream, EndpointStartReceivingAudioStreamPayload, EndpointStartReceivingVideoStream, EndpointStartReceivingVideoStreamPayload, EndpointStopReceivingAudioStream, EndpointStopReceivingAudioStreamPayload, EndpointStopReceivingVideoStream, EndpointStopReceivingVideoStreamPayload, AnyEndpointEvent · Errors [ref_folder]: ConferenceInternalError, ConferenceWrongStateError, ScreenSharingFailedError, ScreenSharingInternalError, ScreenSharingWrongStateError · Events [ref_folder]: ConferenceDisconnectReason, ConferenceEvent, ConferenceConnected, ConferenceConnectedPayload, ConferenceDisconnected, ConferenceDisconnectedPayload, ConferenceEndpointAdded, ConferenceEndpointAddedPayload, ConferenceEndpointRemoved, ConferenceEndpointRemovedPayload, ConferenceFailed, ConferenceFailedPayload, ConferenceInfoReceived, ConferenceInfoReceivedPayload, ConferenceMessageReceived, ConferenceMessageReceivedPayload, ConferenceScreenSharingFailed, ConferenceScreenSharingFailedPayload, ConferenceScreenSharingStarted, ConferenceScreenSharingStartedPayload, ConferenceStatsReport, ConferenceStatsReportPayload, AnyConferenceEvent · Conference, ConferenceManager, ConferenceSettings, Endpoint [interfaces] · ConferenceLoader [function] · ConferenceState, ScreenSharingFailedCode, SimulcastLayerRid, StreamReceiveStopReason [enums]
- **Core [module]** — ConnectionErrors [ref_folder]: ConnectionError, ConnectionInternalError, ConnectionInterruptedError, ConnectionNetworkError, ConnectionTimeoutError · Errors [ref_folder]: CoreInternalError, InitializationError · Events [ref_folder]: ClientDisconnectReason, ClientEvent, ClientDisconnected, ClientDisconnectedPayload, AnyClientEvent · Logger [ref_folder]: LogLevel, TimeFormat, LogCallbackFunction, LogCallBackProps, LoggerOptions, LogRecordExtraData · LoginErrors [ref_folder]: LoginAccountFrozenError, LoginError, LoginInternalError, LoginInvalidPasswordError, LoginInvalidStateError, LoginInvalidUserError, LoginMauAccessDeniedError, LoginNetworkIssuesError, LoginTimeoutError, LoginTokenExpiredError · SharedErrors [ref_folder]: AudioStreamRequiredError, AuthenticationError, DependencyMissingError, InactiveStreamError, InvalidArgumentsError, InvalidMimeTypeError, ModuleInitOutOfContainer, RequiredParameterError, StreamAlreadySendingError, StreamNotSendingError, StreamTypeMismatchError, StreamUpdateFailedError, WebSDKError · Watchable [ref_folder]: OnValueChangeCallback, ReadonlyWatchable, UnwatchFunction, Watchable, WatchOptions · Core [class] · AccessTokenLoginOptions, Client, ConnectionOptions, CoreInitOptions, ListenerOptions, LoginResult, LoginTokens, OneTimeKeyLoginOptions, PasswordLoginOptions, RefreshTokenOptions, RequestOneTimeKeyOptions [interfaces] · ClientState, ConnectionNode, VideoCodec [enums] · UnknownObject [typedef]
- **Messaging [module]** — Errors [ref_folder]: MessengerErrorCode, MessengerError · Events [ref_folder]: MessengerAction, MessengerEventType, ConversationEventPayload, ConversationListEventPayload, ConversationMessageEventPayload, ConversationServiceEventPayload, IsReadMessageEvent, OnCreateConversationEvent, OnEditConversationEvent, OnEditMessageEvent, OnEditUserEvent, OnRemoveConversationEvent, OnRemoveMessageEvent, OnSendMessageEvent, OnSetStatusEvent, OnSubscribeEvent, OnTypingMessageEvent, OnUnsubscribeEvent, RetransmitEventPayload, StatusEventPayload, SubscriptionEventPayload, UserEventPayload, AnyMessengerEvent, RetransmittableEvents · ConversationParticipant [class] · Conversation, ConversationConfig, ConversationEditOptions, ConversationSendMessageOptions, EditUserOptions, Message, MessageEditOptions, Messaging, Messenger, User [interfaces] · MessagingLoader [function]
- **NoiseSuppressionAggressive [module]** — NoiseSuppressionAggressive [interface], NoiseSuppressionAggressiveLoader [function]
- **NoiseSuppressionBalanced [module]** — NoiseSuppressionBalanced [interface], NoiseSuppressionBalancedLoader [function]
- **PushService [module]** — Errors [ref_folder]: PushServiceCancelledError, PushServiceConnectionClosedError, PushServiceInternalError, PushServiceInvalidTokenError, PushServiceTimeoutError · PushService, PushTokenOptions [interfaces] · PushServiceLoader [function]
- **SmartQueue [module]** — Events [ref_folder]: SmartQueueEvent, CallStatusUpdated, CallStatusUpdatedPayload, CallStatusUpdateFailed, CallStatusUpdateFailedPayload, MessagingStatusUpdated, MessagingStatusUpdatedPayload, MessagingStatusUpdateFailed, MessagingStatusUpdateFailedPayload, AnySmartQueueEvent · SetSmartQueueStatusOptions, SmartQueue [interfaces] · SmartQueueLoader [function] · SmartQueueAgentStatus, SmartQueueCustomStatus, SmartQueueSystemStatus [enums] · SmartQueueStatus [typedef]
- **Statistics [module]** — ConnectionStatsReport, LocalAudioStatsReport, LocalVideoLayerStats, LocalVideoStatsReport, RemoteAudioStatsReport, RemoteVideoStatsReport, StatisticsReport [interfaces] · LocalAudioStreamStatsReport, LocalVideoStreamStatsReport, RemoteAudioStreamStatsReport, RemoteVideoStreamStatsReport [typedefs]
- **Stream [module]** — Errors [ref_folder]: AtLeastOneTrackRequired, AudioProcessorNotInitialized, NotSupportedError · Events [ref_folder]: StreamEvent, StreamEnded, StreamEndedPayload, AnyStreamEvent · AudioRenderer, DevicePermission, Hardware, RendererManager, StreamManager, VideoRenderer [classes] · AudioConstraints, AudioPreset, AudioProcessor, DevicesPermissionState, DeviceTrackerHelper, ExtendedVideoConstraints, InputDevice, LocalScreenSharingStream, LocalStream, OutputDevice, RemoteStream, Renderer, RequestPermissionsOptions, ScreenSharingConfig, Stream, StreamModule, VideoConstraints, VideoResolution, WasmProcessor [interfaces] · StreamLoader [function] · AudioProcessingType, AudioProcessorState, DeviceKind, FrameRate, MediaRendererType, ScreenSharingVideoQuality, StreamHelper, StreamType, VideoQuality [enums] · AnyStreamHelper, AudioConfig, PlainStyles, StreamSource, VideoConfig [typedefs]
- Changelog [changelog]

## Manifest: references_websdk.txt (legacy, 119 pages)

- Web SDK [root]
- **VoxImplant [ref_folder]** — CallEvents [events page] · EndpointEvents [events page] · Events [events page] · **EventHandlers [module]**: ACDErrorEvent, ACDStatusEvent, ActiveUpdated, AuthResult, AuthTokenResult, BeforeMediaRendererRemoved, CallEvent, CallEventWithHeaders, CallStatsReceived, ConnectionFailed, DevicesUpdated, Disconnected, EndpointHandler, EndpointMediaHandler, Failed, IncomingCall, InfoReceived, MediaElementCreated, MediaRenderDisabled, MediaRenderEnabled, MediaRendererAdded, MediaRendererRemoved, MediaRendererUpdated, MessageReceived, MicAccessResult, NetStatsReceived, SDKReady, SIPRegistrationResult, SQErrorEvent, SharingStopped, StateUpdated, Updated, VoiceEnd, VoiceStart · **Hardware [module]**: HardwareEvents, AudioDeviceManager, CameraManager, StreamManager, AudioParams, CameraParams, VideoQuality · **Messaging [module]**: MessengerEvents · EventHandlers [submodule]: CreateConversationEvent, EditConversationEvent, EditMessageEvent, EditUserEvent, ErrorEvent, GetConversationEvent, GetPublicConversationsEvent, GetSubscriptionListEvent, GetUserEvent, MessengerEvent, ReadEvent, RemoveMessageEvent, RetransmitEventsEvent, RetransmittedEvent, SendMessageEvent, SetStatusEvent, SubscribeEvent, TypingEvent, UnsubscribeEvent · Conversation, Message, Messenger [classes] · ConversationParticipant, SerializedConversation, SerializedMessage, User, UserStatus, UserSubscriptions [interfaces] · getInstance [function] · MessengerAction, MessengerError [enums] · **Top-level**: Call, Client, Endpoint, MediaRenderer, SharingCall, ViewerCall [classes] · AudioParams, AudioSourceInfo, CallSettings, CodecDescription, Config, ConnectionStatsReport, DisconnectingFlags, InboundAudioStatsReport, InboundVideoStatsReport, LogRecord, LoginOptions, LoginTokens, MosReport, OutboundAudioStatsReport, OutboundVideoStatsReport, SetOperatorACDStatusOptions, StatsReport, VideoFlags, VideoSourceInfo [interfaces] · getInstance, getMessenger [functions] · ACDErrorCode, AuthResultCode, CallState, ClientState, ConnectionNode, MediaRenderDisablingReason, MediaRendererKind, OperatorACDStatuses, QueueTypes [enums]
- Changelog [changelog]

## Pages fetched (33)
v5: root, core, core.core, core.client, call, call.call, conference, messaging, pushservice, smartqueue, statistics, stream, noisesuppressionaggressive, noisesuppressionbalanced, call.callevents, call.callmanagerevents, core.events, core.loginerrors, core.watchable, core.connectionerrors, conference.events, stream.events, smartqueue.events, messaging.events, changelog.
Legacy: root, voximplant, voximplant.client, voximplant.call, voximplant.events, voximplant.callevents, voximplant.config, changelog (empty extraction).
