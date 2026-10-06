> מקור: https://docs.voximplant.ai/api-reference/voxengine/elevenlabs/overview
> נשמר: 2026-09-14

# ElevenLabs

VoxEngine
Voice AI
ElevenLabs
ElevenLabs
Agents WebSocket client for ElevenLabs conversational AI scenarios.
Ask a question
|
Copy page
|
View as Markdown
|
More actions

ElevenLabs provides a VoxEngine client for connecting a call or media unit to the ElevenLabs Agents WebSocket API.

Use ElevenLabs.createAgentsClient(...) to create an AgentsClient for the current scenario.

Related guides
ElevenLabs connector overview

Learn how ElevenLabs Agents fits into a VoxEngine call flow.

Contents
 Usage: required module import and basic flow.
 Factory functions: create the ElevenLabs Agents client.
 Methods: conversation, tools, and contextual client messages.
 Events: WebSocket media bridge events.
 AgentsEvents: ElevenLabs Agents event names and payload fields.
Usage

Add the module before using the namespace:

require(Modules.ElevenLabs);

Create the client, bridge media, and listen for ElevenLabs Agents events.

Factory functions
 createAgentsClient

Creates a new ElevenLabs.AgentsClient instance.

createAgentsClient(parameters: AgentsClientParameters): Promise<ElevenLabs.AgentsClient>

Parameters

Parameter	Type	Req.	Description
parameters	AgentsClientParameters	✓	

Returns

Type	Description
Promise<ElevenLabs.AgentsClient>	Resolves to the ElevenLabs.AgentsClient instance.
 createRealtimeTTSPlayer

Creates a new ElevenLabs.RealtimeTTSPlayer instance with the specified text (TTS is used to play the text). You can attach media streams later via the ElevenLabs.RealtimeTTSPlayer.sendMediaTo or VoxEngine.sendMediaBetween methods. NOTE: this method uses 11labs initializeConnection method internally.

createRealtimeTTSPlayer(text: string, parameters?: RealtimeTTSPlayerParameters): RealtimeTTSPlayer

Parameters

Parameter	Type	Req.	Description
text	string	✓	
parameters	RealtimeTTSPlayerParameters	✗	

Returns

Type	Description
RealtimeTTSPlayer	The requested RealtimeTTSPlayer value.
AgentsClient
Methods
 addEventListener

Adds a handler for the specified ElevenLabs.AgentsEvents or ElevenLabs.Events event. Use only functions as handlers; anything except a function leads to the error and scenario termination when a handler is called.

addEventListener(event: ElevenLabs.Events | ElevenLabs.AgentsEvents | string, callback: (event: object) => any): void

Parameters

Parameter	Type	Req.	Description
event	ElevenLabs.Events | ElevenLabs.AgentsEvents | string	✓	Event constant or event name to subscribe to.
callback	(event: object) => any	✓	Function called when the event is emitted.

Returns

Type	Description
void	Does not return a value.
 clearMediaBuffer

Clears the ElevenLabs WebSocket media buffer.

clearMediaBuffer(parameters?: ClearMediaBufferParameters): void

Parameters

Parameter	Type	Req.	Description
parameters	ClearMediaBufferParameters	✗	

Returns

Type	Description
void	Does not return a value.
 clientToolResult

Result of the client tool call. https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Client-Tool-Result

clientToolResult(parameters: Object): void

Parameters

Parameter	Type	Req.	Description
parameters	Object	✓	

Returns

Type	Description
void	Does not return a value.
 close

Closes the ElevenLabs connection (over WebSocket) or connection attempt.

close(): void

Parameters

This method does not accept parameters.

Returns

Type	Description
void	Does not return a value.
 contextualUpdate

Allows to send non-interrupting background information to the conversation. https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Contextual-Update

contextualUpdate(parameters: Object): void

Parameters

Parameter	Type	Req.	Description
parameters	Object	✓	

Returns

Type	Description
void	Does not return a value.
 conversationInitiationClientData

Defines what can be customized when starting a conversation. https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Conversation-Initiation-Client-Data

conversationInitiationClientData(parameters: Object): void

Parameters

Parameter	Type	Req.	Description
parameters	Object	✓	

Returns

Type	Description
void	Does not return a value.
 id

Returns the AgentsClient id.

id(): string

Parameters

This method does not accept parameters.

Returns

Type	Description
string	The requested string value.
 removeEventListener

Removes a handler for the specified ElevenLabs.AgentsEvents or ElevenLabs.Events event.

removeEventListener(event: ElevenLabs.Events | ElevenLabs.AgentsEvents | string, callback?: (event: object) => any): void

Parameters

Parameter	Type	Req.	Description
event	ElevenLabs.Events | ElevenLabs.AgentsEvents | string	✓	Event constant or event name to subscribe to.
callback	(event: object) => any	✗	Function called when the event is emitted.

Returns

Type	Description
void	Does not return a value.
 sendMediaTo

Starts sending media from the ElevenLabs (via WebSocket) to the media unit. ElevenLabs works in real time.

sendMediaTo(mediaUnit: VoxMediaUnit, parameters?: SendMediaParameters): void

Parameters

Parameter	Type	Req.	Description
mediaUnit	VoxMediaUnit	✓	
parameters	SendMediaParameters	✗	

Returns

Type	Description
void	Does not return a value.
 stopMediaTo

Stops sending media from the ElevenLabs (via WebSocket) to the media unit.

stopMediaTo(mediaUnit: VoxMediaUnit): void

Parameters

Parameter	Type	Req.	Description
mediaUnit	VoxMediaUnit	✓	

Returns

Type	Description
void	Does not return a value.
 userMessage

Allows to send user text messages to the conversation. https://elevenlabs.io/docs/agents-platform/customization/events/client-to-server-events#user-messages

userMessage(parameters: Object): void

Parameters

Parameter	Type	Req.	Description
parameters	Object	✓	

Returns

Type	Description
void	Does not return a value.
 webSocketId

Returns the ElevenLabs WebSocket id.

webSocketId(): string

Parameters

This method does not accept parameters.

Returns

Type	Description
string	The requested string value.
Events

These events describe audio received through the ElevenLabs WebSocket media bridge.

 Events.WebSocketMediaStarted

Triggered when the audio stream sent by a third party through an ElevenLabs WebSocket is started playing.

Event constant: Events.WebSocketMediaStarted

Payload

Field	Type	Req.	Description
client	AgentsClient	✓	The ElevenLabs.AgentsClient instance.
tag	string	✗	Special tag to name audio streams sent over one WebSocket connection. With it, one can send 2 audios to 2 different media units at the same time.
encoding	string	✗	Audio encoding formats.
customParameters	{ [key: string]: string }	✗	Custom parameters.
 Events.WebSocketMediaEnded

Triggers after the end of the audio stream sent by a third party through an ElevenLabs WebSocket (1 second of silence).

Event constant: Events.WebSocketMediaEnded

Payload

Field	Type	Req.	Description
client	AgentsClient	✓	The ElevenLabs.AgentsClient instance.
tag	string	✗	Special tag to name audio streams sent over one WebSocket connection. With it, one can send 2 audios to 2 different media units at the same time.
mediaInfo	WebSocketMediaInfo	✗	Information about the audio stream that can be obtained after the stream stops or pauses (1 second of silence).
AgentsEvents

These events mirror server messages from the ElevenLabs Agents WebSocket API. The data field contains the provider event payload.

Unknown
HTTPResponse
ConversationInitiationMetadata
Ping
UserTranscript
AgentResponse
AgentResponseCorrection
Interruption
ContextualUpdate
ClientToolCall
VadScore
InternalTentativeAgentResponse
WebSocketError
ConnectorInformation
AgentToolResponse

## קישורים חיצוניים

- [initializeConnection](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input#send.initializeConnection)
- [https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Client-Tool-Result](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Client-Tool-Result)
- [https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Contextual-Update](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Contextual-Update)
- [https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Conversation-Initiation-Client-Data](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#send.Conversation-Initiation-Client-Data)
- [https://elevenlabs.io/docs/agents-platform/customization/events/client-to-server-events#user-messages](https://elevenlabs.io/docs/agents-platform/customization/events/client-to-server-events#user-messages)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#conversation_initiation_metadata)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#ping)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#user_transcript)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#agent_response)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#agent_response_correction)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#receive.Interruption)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#receive.Contextual-Update)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#client_tool_call)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#vad_score)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/api-reference/agents-platform/websocket#receive.Internal-Tentative-Agent-Response)
- [[ללא טקסט/אייקון]](https://elevenlabs.io/docs/agents-platform/customization/events/client-events#agent_tool_response)
