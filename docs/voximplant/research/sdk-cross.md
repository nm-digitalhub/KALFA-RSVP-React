# Voximplant Docs Research — Group: sdk-cross (React Native SDK + Flutter SDK references)

Scope: entire `references.reactnative` manifest (59 pages) + entire `references.fluttersdk` manifest (107 pages) = 166 pages.
Depth: STRUCTURAL. Fetched 28 pages (roots, folders, core classes, event catalogs, changelogs) via `https://voximplant.com/api/v2/getDoc?fqdn=...`; all remaining pages enumerated from manifests in the INVENTORY below.
Raw dump: `vox-research/raw/sdk-cross.md` (extractor `vox-research/extract2.js` renders the `children` member tree the shared extract.js drops).

Both SDKs are **client-side calling SDKs**: they let a mobile app act as a Voximplant *endpoint* (a "user" that logs in and makes/receives calls into a VoxEngine scenario). They are NOT server-side tools — nothing here starts calls to PSTN numbers by itself; an outbound app-call still lands in a VoxEngine scenario (`Client.call(number)` → CallAlerting in the cloud).

---

## 1. React Native SDK (`references.reactnative`, npm `react-native-voximplant`)

Structure: one big `Voximplant` module (ref_folder) + Changelog. Sub-modules: `Hardware`, `Messaging`. Latest changelog entry: **1.45.0** (changelog body text is empty in the docs API — versions only, no notes).

### Entry points
- `Voximplant.getInstance(clientConfig?)` → singleton `Client`; `Voximplant.getMessenger()` → `Messenger`.

### Client (class)
Key methods: `connect(ConnectOptions)`, `disconnect()`, `getClientState()`, `login(user, password)`, `loginWithToken(user, accessToken)`, `loginWithOneTimeKey(user, hash)`, `requestOneTimeLoginKey(user)`, `tokenRefresh(user, refreshToken)`, `call(number, CallSettings?) -> Promise<Call>`, `callConference(number, CallSettings?)`, `handlePushNotification(obj)`, `registerPushNotificationsToken` / `unregister...` (PushKit VoIP tokens on iOS), `registerIMPushNotificationsTokenIOS`, `setLoggerCallback(fn)`, `on/off(ClientEventTypes)`.
Gotcha (documented): resolving the `call()` promise only means the call was sent to the cloud — connection is signaled by `CallEventTypes.Connected`; promise rejection = app-side error, `Failed` event = telecom-side error.

### Call (class)
`answer(CallSettings?)`, `decline(headers?)` (rejects on ALL user devices), `reject(headers?)` (this device only), `hangup(headers?)`, `hold(bool)`, `sendAudio(bool)` (mic mute), `sendVideo(bool)`, `receiveVideo()` (start-only; stopping receive mid-call unsupported), `sendTone(key)` (DTMF → cloud ToneReceived), `sendInfo(mime, body, headers?)` (SIP INFO → VoxEngine InfoReceived), `sendMessage(text)` (text/plain INFO → VoxEngine MessageReceived), `getDuration()` (seconds), `getEndpoints()`, `currentQualityIssues()`. Props: `callId`, `callKitUUID`, `localVideoStreams`, `qualityIssues` (QualitySubscriber).

### Endpoint (class)
Remote participant: props `id`, `userName`, `displayName`, `sipUri`, `videoStreams`; conference-only `startReceiving/stopReceiving/requestVideoSize(streamId, w, h)`.

### Events catalogs
- `ClientEventTypes`: ConnectionEstablished/Failed/Closed, AuthResult (code, tokens), RefreshTokenResult, IncomingCall (call, headers, video), Reconnecting/Reconnected.
- `CallEventTypes`: Connected (2–3 s possible delay after first audio), Disconnected (answeredElsewhere flag), Failed (code, reason), EndpointAdded, ProgressToneStart/Stop, MessageReceived, InfoReceived, ICECompleted, ICETimeout, CallReconnecting/CallReconnected, CallOperationFailed, Local video stream add/remove.
- `EndpointEventTypes`: InfoUpdated, Removed, remote video add/remove, Start/StopReceiveVideoStream (conference), VoiceActivityStarted/Stopped (conference VAD).
- `QualityEventTypes`: PacketLoss, HighMediaLatency (rtt+jitter based), NoAudioSignal (mic dead), NoAudioReceive / NoVideoReceive, IceDisconnected (CRITICAL, no media until resolved), CodecMismatch, LocalVideoDegradation. Levels via `QualityIssueLevel` (NONE…CRITICAL).

### Interfaces
- `ClientConfig`: enableVideo, enableDebugLogging, enableLogcatLogging, logLevel, preferredVideoCodec (default VP8), forceRelayTraffic (TURN), requestAudioFocusMode, enableCameraMirroring, bundleId (multi-app push).
- `CallSettings`: **`customData` — max 200 bytes**, readable in the cloud from `CallAlerting` and in Call History via HTTP API (the same 200-byte cap KALFA hits with `script_custom_data` in StartScenarios); `extraHeaders` — SIP headers, must start with `X-`, **200-byte limit**; `video`, `preferredVideoCodec`, `setupCallKit`, `enableSimulcast`.
- `ConnectOptions`, `LoginTokens` (accessToken/refreshToken pairs), `VideoFlags`, quality-issue payload interfaces (PacketLoss, NoAudioReceive, …), `CodecMismatch`, `FrameSize`.

### Hardware module
`AudioDeviceManager` (getActiveDevice, getAudioDevices, selectAudioDevice; four CallKit AVAudioSession helpers required for iOS CallKit integration), `AudioFile` (initWithLocalFile — Android needs res/raw; loadFile from URL; play(looped)/stop; must releaseResources), `CameraManager` (switchCamera FRONT/BACK, setCameraResolution, orientation listener), enums `AudioDevice` (BLUETOOTH/EARPIECE/SPEAKER/WIRED_HEADSET/NONE), `AudioFileUsage` (IN_CALL/NOTIFICATION/RINGTONE/UNKNOWN), `CameraType`.

### Messaging module
Full IM subsystem parallel to the Web/iOS/Android SDKs: `Messenger` (users, conversations, subscriptions, presence, push via `MessengerNotification`), `Conversation` (participants w/ per-permission flags canWrite/canManageParticipants…, retransmitEvents for history), `Message` (text + payload, edit/remove), events in `MessengerEventTypes` (CreateConversation, SendMessage, Read, Typing, SetStatus, Subscribe…). Promises reject with the `Error` event type. Conversation removal only via server Messaging API.

### Enums (top level)
`CallError` (ALREADY_IN_THIS_STATE, FUNCTIONALITY_IS_DISABLED, INCORRECT_OPERATION, INTERNAL_ERROR, MEDIA_IS_ON_HOLD, MISSING_PERMISSION, NOT_LOGGED_IN, REJECTED, TIMEOUT, RECONNECTING), `ClientState`, `ConnectionNode` (closest-node selection), `LogLevel`, `QualityIssueLevel`, `RenderScaleType` (SCALE_FILL/FIT for `VideoView`), `RequestAudioFocusMode`, `VideoCodec` (VP8/H264/AUTO), `VideoStreamType` (Video/ScreenSharing), `VideoStreamReceiveStopReason` (AUTOMATIC/MANUAL).

---

## 2. Flutter SDK (`references.fluttersdk`, pub.dev `flutter_voximplant`)

Structure: 4 ref_folders (`call`, `client`, `hardware`, `messaging`) + top-level error classes + `Voximplant` entry class + Changelog (also empty-bodied in the API; versions not even listed — headers only).

### Entry point: `Voximplant` (class)
`getClient(VIClientConfig?)` → `VIClient`; props `messenger` → `VIMessenger`, `audioDeviceManager`, `cameraManager`; `configureFileLogger(path, fileName, sizeLimit)` (Android only; UnimplementedError on iOS); `logListener`.

### client folder
- `VIClient`: `connect(node: VINode, connectivityCheck: bool = false, servers?)` — **explicit `VINode` selection is required in Flutter** (RN hides this in ConnectOptions); `login/loginWithAccessToken/loginWithOneTimeKey/requestOneTimeLoginKey/tokenRefresh`; `call(number, VICallSettings?)`, `conference(...)`; push: `registerForPushNotifications`, `handlePushNotification`, iOS-only IM token register/unregister; state via **`clientStateStream` (Dart Stream)**; callbacks `onIncomingCall`, `onPushDidExpire`. Error surface is exception-based: throws `VIException` with `VIClientError` codes (ERROR_ACCOUNT_FROZEN, ERROR_CLIENT_NOT_LOGGED_IN, ERROR_INVALID_ARGUMENTS, …).
- `VIClientConfig`: bundleId, enableDebugLogging, enableLogcatLogging, audioFocusMode, logLevel, forceRelayTraffic. NOTE: no `enableVideo`/`preferredVideoCodec` at client level (per-call only via VICallSettings) — minor parity difference vs RN.
- `VIAuthResult` (displayName + `VILoginTokens`), enums `VIClientState`, `VILogLevel`, `VINode`, `VIRequestAudioFocusMode`; typedefs `VIIncomingCall`, `VIPushDidExpire`.

### call folder
- `VICall`: same operation set as RN Call (`answer/decline/reject/hangup/hold/sendAudio/sendVideo/receiveVideo/sendTone/sendInfo/sendMessage`), `getCallDuration()` — **milliseconds (RN returns seconds)**; events are **callback props** (`onCallConnected`, `onCallDisconnected`, `onCallFailed`, `onCallRinging` = RN ProgressToneStart, `onCallAudioStarted`, `onCallReconnecting/Reconnected`, `onEndpointAdded`, `onMessageReceived`, `onSIPInfoReceived`, ICE ×2) instead of RN's `on(eventType)` emitter; quality issues via `qualityIssuesStream` (Stream<VIQualityIssue>) + `currentQualityIssues()`; single `localVideoStream` (RN: list).
- `VIEndpoint`: as RN plus `place` (conference tile position) and conference VAD callbacks.
- `VICallSettings`: `customData` (same **200-byte** cap, readable from CallAlerting / Call History), `extraHeaders` (X- prefix), `videoFlags: VIVideoFlags` (sendVideo/receiveVideo — video **disabled by default**, whereas RN uses `video` bool), `preferredVideoCodec` (default AUTO), `enableSimulcast`.
- Quality-issue classes (`VIPacketLoss`, `VINoAudioSignal`, `VINoAudioReceive`, `VINoVideoReceive`, `VIHighMediaLatency`, `VIIceDisconnected`, `VICodecMismatch`, `VILocalVideoDegradation`) + enums `VIQualityIssueType`, `VIQualityIssueLevel`; video: `VIVideoStream`, `VIVideoView` + `VIVideoViewController` (widget + controller pattern), `VIVideoRotation`, `VIVideoCodec`, `VIVideoStreamType`, `VIVideoStreamReceiveStopReason`.

### hardware folder
`VIAudioDeviceManager` (same CallKit AVAudioSession helpers; documented limitation: cannot select Earpiece while wired headset connected; iOS may report mic-less wired headsets as Earpiece), `VIAudioFile` (+`VIAudioFileStopped` typedef, `VIAudioFileUsage`), `VICameraManager`, `VIAudioDevice` enum, `VICameraType`.

### messaging folder
Same IM model as RN, Dart-typed: `VIMessenger`, `VIConversation`(+Config, Participant), `VIMessage`, event classes (`VIConversationEvent`, `VIMessageEvent`, `VIStatusEvent`, `VISubscriptionEvent`, `VIRetransmitEvent`, `VIConversationListEvent`, `VIConversationServiceEvent`, `VIUserEvent`), enums `VIMessengerAction/EventType/Notification`, many callback typedefs (VISendMessage, VITyping, VIIsRead, …).

### top-level error model
`VIException` (thrown everywhere) + per-domain code catalogs: `VIClientError`, `VICallError` (ERROR_ALREADY_IN_THIS_STATE, ERROR_FUNCTIONALITY_IS_DISABLED, ERROR_INCORRECT_OPERATION, ERROR_INTERNAL, ERROR_MEDIA_IS_ON_HOLD, ERROR_MISSING_PERMISSION, ERROR_REJECTED, ERROR_TIMEOUT, ERROR_RECONNECTING…), `VIMessagingError`, `VIAudioFileError`, `VILoggerError`; `VILogListener` typedef.

---

## 3. Capability parity — cross-platform SDKs vs native (FOCUS)

- Both cross-platform SDKs cover the full native calling core: connect/login (password, access+refresh token, one-time key), outgoing/incoming/conference calls, hold, DTMF, SIP INFO/messages into VoxEngine, audio device & camera management, CallKit audio-session hooks, VoIP push (PushKit iOS / FCM Android), quality-issue monitoring, IM messaging.
- Neither exposes: local call recording, screen sharing capture start (RN has `VideoStreamType.ScreenSharing` for receive), camera pre-processing/custom video sources (native iOS/Android have those), or Web-SDK-only features (audio worklets etc.).
- API-style differences: RN = event-emitter `on(EventTypes.X)`; Flutter = callback props + Dart Streams + exceptions (`VIException` w/ typed error catalogs). Data differences: call duration seconds (RN) vs ms (Flutter); RN videoflag = bool `video`, Flutter = directional `VIVideoFlags`; Flutter requires explicit `VINode` in connect.
- Both changelog pages return no body text through the docs API (RN lists version headers 0.2.1→1.45.0; Flutter none) — release detail must come from npm/pub.dev release notes instead.

## 4. KALFA relevance

KALFA's calling is **server-initiated outbound to PSTN (+972) via Management API StartScenarios + VoxEngine** — these two SDKs sit on the opposite (app-endpoint) side and are NOT needed for the current architecture. Relevance is contextual:
- Confirms the **200-byte `customData` cap is platform-wide** (client CallSettings.customData carries the same limit and the same delivery path — CallAlerting event / Call History — as `script_custom_data`), so the Branch A/B compact-payload design cannot be avoided by switching entry points.
- `Call.sendMessage`/`sendInfo` ↔ VoxEngine MessageReceived/InfoReceived is the documented in-call side-channel for payloads larger than 200 bytes — same pattern usable from any SDK endpoint if KALFA ever adds an in-app "call the guest from my phone" feature for owners (RN would fit the Next.js/React skill set).
- Quality-issue event catalog (PacketLoss/HighMediaLatency/NoAudioSignal levels) mirrors what VoxEngine/backend can observe — useful vocabulary for per-reached-contact billing disputes ("reached" vs media-dead calls).
- Otherwise: no CallList, no TTS, no LLM hooks in these SDKs — nothing here changes the CallList/ElevenLabs/Kit evaluations.

---

## INVENTORY (every page in scope)

### references.reactnative (59 pages) — fetched pages marked [F]
- references.reactnative | root | React Native SDK
- references.reactnative.voximplant | ref_folder | Voximplant
- references.reactnative.voximplant.calleventtypes | events | CallEventTypes
- references.reactnative.voximplant.clienteventtypes | events | ClientEventTypes
- references.reactnative.voximplant.endpointeventtypes | events | EndpointEventTypes
- references.reactnative.voximplant.qualityeventtypes | events | QualityEventTypes
- references.reactnative.voximplant.hardware | module | Hardware
- references.reactnative.voximplant.hardware.audiodeviceeventtypes | events | AudioDeviceEventTypes
- references.reactnative.voximplant.hardware.audiofileeventtypes | events | AudioFileEventTypes
- references.reactnative.voximplant.hardware.cameraeventtypes | events | CameraEventTypes
- references.reactnative.voximplant.hardware.audiodevicemanager | class | AudioDeviceManager
- references.reactnative.voximplant.hardware.audiofile | class | AudioFile
- references.reactnative.voximplant.hardware.cameramanager | class | CameraManager
- references.reactnative.voximplant.hardware.audiodevice | enum | AudioDevice
- references.reactnative.voximplant.hardware.audiofileusage | enum | AudioFileUsage
- references.reactnative.voximplant.hardware.cameratype | enum | CameraType
- references.reactnative.voximplant.messaging | module | Messaging
- references.reactnative.voximplant.messaging.messengereventtypes | events | MessengerEventTypes
- references.reactnative.voximplant.messaging.conversation | class | Conversation
- references.reactnative.voximplant.messaging.message | class | Message
- references.reactnative.voximplant.messaging.messenger | class | Messenger
- references.reactnative.voximplant.messaging.conversationconfig | interface | ConversationConfig
- references.reactnative.voximplant.messaging.conversationparticipant | interface | ConversationParticipant
- references.reactnative.voximplant.messaging.user | interface | User
- references.reactnative.voximplant.messaging.messengeraction | enum | MessengerAction
- references.reactnative.voximplant.messaging.messengernotification | enum | MessengerNotification
- references.reactnative.voximplant.audiofile | class | AudioFile
- references.reactnative.voximplant.call | class | Call
- references.reactnative.voximplant.client | class | Client
- references.reactnative.voximplant.endpoint | class | Endpoint
- references.reactnative.voximplant.qualitysubscriber | class | QualitySubscriber
- references.reactnative.voximplant.videostream | class | VideoStream
- references.reactnative.voximplant.videoview | class | VideoView
- references.reactnative.voximplant.callsettings | interface | CallSettings
- references.reactnative.voximplant.clientconfig | interface | ClientConfig
- references.reactnative.voximplant.codecmismatch | interface | CodecMismatch
- references.reactnative.voximplant.connectoptions | interface | ConnectOptions
- references.reactnative.voximplant.framesize | interface | FrameSize
- references.reactnative.voximplant.highmedialatency | interface | HighMediaLatency
- references.reactnative.voximplant.icedisconnected | interface | IceDisconnected
- references.reactnative.voximplant.localvideodegradation | interface | LocalVideoDegradation
- references.reactnative.voximplant.logintokens | interface | LoginTokens
- references.reactnative.voximplant.noaudioreceive | interface | NoAudioReceive
- references.reactnative.voximplant.noaudiosignal | interface | NoAudioSignal
- references.reactnative.voximplant.novideoreceive | interface | NoVideoReceive
- references.reactnative.voximplant.packetloss | interface | PacketLoss
- references.reactnative.voximplant.videoflags | interface | VideoFlags
- references.reactnative.voximplant.getinstance | function | getInstance
- references.reactnative.voximplant.getmessenger | function | getMessenger
- references.reactnative.voximplant.callerror | enum | CallError
- references.reactnative.voximplant.clientstate | enum | ClientState
- references.reactnative.voximplant.connectionnode | enum | ConnectionNode
- references.reactnative.voximplant.loglevel | enum | LogLevel
- references.reactnative.voximplant.qualityissuelevel | enum | QualityIssueLevel
- references.reactnative.voximplant.renderscaletype | enum | RenderScaleType
- references.reactnative.voximplant.requestaudiofocusmode | enum | RequestAudioFocusMode
- references.reactnative.voximplant.videocodec | enum | VideoCodec
- references.reactnative.voximplant.videostreamreceivestopreason | enum | VideoStreamReceiveStopReason
- references.reactnative.voximplant.videostreamtype | enum | VideoStreamType
- references.reactnative.changelog | changelog | Changelog

Fetched [F]: references.reactnative (root), .voximplant, .voximplant.client, .voximplant.call, .voximplant.endpoint, .voximplant.clientconfig, .voximplant.callsettings, .voximplant.calleventtypes, .voximplant.clienteventtypes, .voximplant.audiofile, .voximplant.hardware, .voximplant.messaging, .changelog. (Folder/module pages embed full child-member trees, so hardware/messaging children content was captured via their parent pages.)

### references.fluttersdk (107 pages)
- references.fluttersdk | root | Flutter SDK
- references.fluttersdk.call | ref_folder | call
- references.fluttersdk.call.vicall | class | VICall
- references.fluttersdk.call.vicallaudiostarted | typedef | VICallAudioStarted
- references.fluttersdk.call.vicallconnected | typedef | VICallConnected
- references.fluttersdk.call.vicalldisconnected | typedef | VICallDisconnected
- references.fluttersdk.call.vicallfailed | typedef | VICallFailed
- references.fluttersdk.call.vicallreconnected | typedef | VICallReconnected
- references.fluttersdk.call.vicallreconnecting | typedef | VICallReconnecting
- references.fluttersdk.call.vicallringing | typedef | VICallRinging
- references.fluttersdk.call.vicallsettings | class | VICallSettings
- references.fluttersdk.call.vicodecmismatch | class | VICodecMismatch
- references.fluttersdk.call.viendpoint | class | VIEndpoint
- references.fluttersdk.call.viendpointadded | typedef | VIEndpointAdded
- references.fluttersdk.call.viendpointremoved | typedef | VIEndpointRemoved
- references.fluttersdk.call.viendpointupdated | typedef | VIEndpointUpdated
- references.fluttersdk.call.viframesize | class | VIFrameSize
- references.fluttersdk.call.vihighmedialatency | class | VIHighMediaLatency
- references.fluttersdk.call.viicecompleted | typedef | VIICECompleted
- references.fluttersdk.call.viicedisconnected | class | VIIceDisconnected
- references.fluttersdk.call.viicetimeout | typedef | VIICETimeout
- references.fluttersdk.call.vilocalvideodegradation | class | VILocalVideoDegradation
- references.fluttersdk.call.vilocalvideostreamadded | typedef | VILocalVideoStreamAdded
- references.fluttersdk.call.vilocalvideostreamremoved | typedef | VILocalVideoStreamRemoved
- references.fluttersdk.call.vimessagereceived | typedef | VIMessageReceived
- references.fluttersdk.call.vinoaudioreceive | class | VINoAudioReceive
- references.fluttersdk.call.vinoaudiosignal | class | VINoAudioSignal
- references.fluttersdk.call.vinovideoreceive | class | VINoVideoReceive
- references.fluttersdk.call.vipacketloss | class | VIPacketLoss
- references.fluttersdk.call.viqualityissue | class | VIQualityIssue
- references.fluttersdk.call.viqualityissuelevel | enum | VIQualityIssueLevel
- references.fluttersdk.call.viqualityissuetype | enum | VIQualityIssueType
- references.fluttersdk.call.viremotevideostreamadded | typedef | VIRemoteVideoStreamAdded
- references.fluttersdk.call.viremotevideostreamremoved | typedef | VIRemoteVideoStreamRemoved
- references.fluttersdk.call.visipinforeceived | typedef | VISIPInfoReceived
- references.fluttersdk.call.vistartreceivingvideostream | typedef | VIStartReceivingVideoStream
- references.fluttersdk.call.vistopreceivingvideostream | typedef | VIStopReceivingVideoStream
- references.fluttersdk.call.vivideocodec | enum | VIVideoCodec
- references.fluttersdk.call.vivideoflags | class | VIVideoFlags
- references.fluttersdk.call.vivideorotation | enum | VIVideoRotation
- references.fluttersdk.call.vivideostream | class | VIVideoStream
- references.fluttersdk.call.vivideostreamreceivestopreason | enum | VIVideoStreamReceiveStopReason
- references.fluttersdk.call.vivideostreamtype | enum | VIVideoStreamType
- references.fluttersdk.call.vivideoview | class | VIVideoView
- references.fluttersdk.call.vivideoviewcontroller | class | VIVideoViewController
- references.fluttersdk.call.vivoiceactivitystarted | typedef | VIVoiceActivityStarted
- references.fluttersdk.call.vivoiceactivitystopped | typedef | VIVoiceActivityStopped
- references.fluttersdk.client | ref_folder | client
- references.fluttersdk.client.viauthresult | class | VIAuthResult
- references.fluttersdk.client.viclient | class | VIClient
- references.fluttersdk.client.viclientconfig | class | VIClientConfig
- references.fluttersdk.client.viclientstate | enum | VIClientState
- references.fluttersdk.client.viincomingcall | typedef | VIIncomingCall
- references.fluttersdk.client.vilogintokens | class | VILoginTokens
- references.fluttersdk.client.viloglevel | enum | VILogLevel
- references.fluttersdk.client.vinode | enum | VINode
- references.fluttersdk.client.vipushdidexpire | typedef | VIPushDidExpire
- references.fluttersdk.client.virequestaudiofocusmode | enum | VIRequestAudioFocusMode
- references.fluttersdk.hardware | ref_folder | hardware
- references.fluttersdk.hardware.viaudiodevice | enum | VIAudioDevice
- references.fluttersdk.hardware.viaudiodevicechanged | typedef | VIAudioDeviceChanged
- references.fluttersdk.hardware.viaudiodevicelistchanged | typedef | VIAudioDeviceListChanged
- references.fluttersdk.hardware.viaudiodevicemanager | class | VIAudioDeviceManager
- references.fluttersdk.hardware.viaudiofile | class | VIAudioFile
- references.fluttersdk.hardware.viaudiofilestopped | typedef | VIAudioFileStopped
- references.fluttersdk.hardware.viaudiofileusage | enum | VIAudioFileUsage
- references.fluttersdk.hardware.vicameramanager | class | VICameraManager
- references.fluttersdk.hardware.vicameratype | enum | VICameraType
- references.fluttersdk.messaging | ref_folder | messaging
- references.fluttersdk.messaging.viconversation | class | VIConversation
- references.fluttersdk.messaging.viconversationconfig | class | VIConversationConfig
- references.fluttersdk.messaging.viconversationevent | class | VIConversationEvent
- references.fluttersdk.messaging.viconversationlistevent | class | VIConversationListEvent
- references.fluttersdk.messaging.viconversationparticipant | class | VIConversationParticipant
- references.fluttersdk.messaging.viconversationserviceevent | class | VIConversationServiceEvent
- references.fluttersdk.messaging.vicreateconversation | typedef | VICreateConversation
- references.fluttersdk.messaging.vieditconversation | typedef | VIEditConversation
- references.fluttersdk.messaging.vieditmessage | typedef | VIEditMessage
- references.fluttersdk.messaging.viedituser | typedef | VIEditUser
- references.fluttersdk.messaging.viisread | typedef | VIIsRead
- references.fluttersdk.messaging.vimessage | class | VIMessage
- references.fluttersdk.messaging.vimessageevent | class | VIMessageEvent
- references.fluttersdk.messaging.vimessenger | class | VIMessenger
- references.fluttersdk.messaging.vimessengeraction | enum | VIMessengerAction
- references.fluttersdk.messaging.vimessengerevent | class | VIMessengerEvent
- references.fluttersdk.messaging.vimessengereventtype | enum | VIMessengerEventType
- references.fluttersdk.messaging.vimessengernotification | enum | VIMessengerNotification
- references.fluttersdk.messaging.viremoveconversation | typedef | VIRemoveConversation
- references.fluttersdk.messaging.viremovemessage | typedef | VIRemoveMessage
- references.fluttersdk.messaging.viretransmitevent | class | VIRetransmitEvent
- references.fluttersdk.messaging.visendmessage | typedef | VISendMessage
- references.fluttersdk.messaging.visetstatus | typedef | VISetStatus
- references.fluttersdk.messaging.vistatusevent | class | VIStatusEvent
- references.fluttersdk.messaging.visubscribe | typedef | VISubscribe
- references.fluttersdk.messaging.visubscriptionevent | class | VISubscriptionEvent
- references.fluttersdk.messaging.vityping | typedef | VITyping
- references.fluttersdk.messaging.viunsubscribe | typedef | VIUnsubscribe
- references.fluttersdk.messaging.viuser | class | VIUser
- references.fluttersdk.messaging.viuserevent | class | VIUserEvent
- references.fluttersdk.viaudiofileerror | class | VIAudioFileError
- references.fluttersdk.vicallerror | class | VICallError
- references.fluttersdk.viclienterror | class | VIClientError
- references.fluttersdk.viexception | class | VIException
- references.fluttersdk.viloggererror | class | VILoggerError
- references.fluttersdk.viloglistener | typedef | VILogListener
- references.fluttersdk.vimessagingerror | class | VIMessagingError
- references.fluttersdk.voximplant | class | Voximplant
- references.fluttersdk.changelog | changelog | Changelog

Fetched [F]: references.fluttersdk (root, embeds full tree), .voximplant, .call (folder), .call.vicall, .call.viendpoint, .call.vicallsettings, .client (folder), .client.viclient, .client.viclientconfig, .hardware (folder), .hardware.viaudiofile, .messaging (folder), .vicallerror, .viclienterror, .changelog.

Total pages in scope: 166. Fetched: 28.
