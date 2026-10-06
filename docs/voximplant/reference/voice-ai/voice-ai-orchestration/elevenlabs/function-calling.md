> מקור: https://docs.voximplant.ai/voice-ai-orchestration/elevenlabs/function-calling
> נשמר: 2026-09-14

# Example: Function calling

Voice AI Clients
ElevenLabs Agents

Example: Function calling

Ask a question
|
Copy page
|
View as Markdown
|
More actions

For the complete documentation index, see llms.txt.

This example answers an inbound Voximplant call, connects it to ElevenLabs Agents, and handles client-side tool calls inside VoxEngine.

Jump to the Full VoxEngine scenario.

Prerequisites
Set up an inbound entrypoint for the caller:
Phone number
WhatsApp
SIP user / SIP registration
App user
Create a routing rule that points the destination (phone number / WhatsApp / SIP username / app user alias) to this scenario.
Store your ElevenLabs API key in Voximplant Secrets under ELEVENLABS_API_KEY.
Store your ElevenLabs Agent ID in Voximplant Secrets under ELEVENLABS_AGENT_ID.
Optional: set ELEVENLABS_BASE_URL in the example if your ElevenLabs account should use a custom Agents endpoint - i.e.: "https://api.eu.residency.elevenlabs.io"
Configure a client tool in your ElevenLabs Agent named get_weather that expects a location parameter.
Tool handling

ElevenLabs Agents send tool requests via ElevenLabs.AgentsEvents.ClientToolCall. The example extracts the tool name and parameters, runs a stub implementation, and sends the result back using clientToolResult:

Tool handling
agentsClient.addEventListener(ElevenLabs.AgentsEvents.ClientToolCall, (event) => {
  const payload = event?.data?.payload || event?.data || {};
  const toolName = payload.tool_name || payload.toolName || payload.name;
  const toolCallId = payload.tool_call_id || payload.toolCallId || payload.id;
  if (toolName !== "get_weather") return;
  const result = { location: "San Francisco", temperature_f: 72, condition: "sunny" };
  agentsClient.clientToolResult({
    tool_call_id: toolCallId,
    tool_name: toolName,
    result,
  });
});
Barge-in
Barge-in
agentsClient.addEventListener(ElevenLabs.AgentsEvents.Interruption, () => {
  agentsClient.clearMediaBuffer();
});
Notes

See the VoxEngine API Reference for more details.

Full VoxEngine scenario
voxeengine-elevenlabs-tool-call.js
/**
 * Voximplant + ElevenLabs Agents connector demo
 * Scenario: answer an incoming call and handle ElevenLabs tool calls.
 */
require(Modules.ElevenLabs);
const TOOL_NAME = "get_weather";
// Optional. Leave empty to use the default ElevenLabs Agents endpoint.
const ELEVENLABS_BASE_URL = "";
VoxEngine.addEventListener(AppEvents.CallAlerting, async ({call}) => {
    let voiceAIClient;
    call.addEventListener(CallEvents.Disconnected, () => VoxEngine.terminate());
    call.addEventListener(CallEvents.Failed, () => VoxEngine.terminate());
    try {
        call.answer();
        // Create client and connect to ElevenLabs Agents
        const agentsClientParameters = {
            xiApiKey: VoxEngine.getSecretValue("ELEVENLABS_API_KEY"),
            agentId: VoxEngine.getSecretValue("ELEVENLABS_AGENT_ID"),
            onWebSocketClose: (event) => {
                Logger.write("===ElevenLabs.WebSocket.Close===");
                if (event) Logger.write(JSON.stringify(event));
                VoxEngine.terminate();
            },
        };
        if (ELEVENLABS_BASE_URL) {
            agentsClientParameters.baseUrl = ELEVENLABS_BASE_URL;
        }
        voiceAIClient = await ElevenLabs.createAgentsClient(agentsClientParameters);
        // Bridge media between the call and ElevenLabs Agents
        VoxEngine.sendMediaBetween(call, voiceAIClient);
        // ---------------------- Event handlers -----------------------
        // Barge-in: keep conversation responsive
        voiceAIClient.addEventListener(ElevenLabs.AgentsEvents.Interruption, () => {
            Logger.write("===BARGE-IN: ElevenLabs.AgentsEvents.Interruption===");
            voiceAIClient.clearMediaBuffer();
        });
        // Handle user transcripts
        voiceAIClient.addEventListener(ElevenLabs.AgentsEvents.UserTranscript, (event) => {
            const payload = event?.data?.payload || event?.data || {};
            const text = payload.text || payload.transcript || payload.user_transcript;
            if (text) {
                Logger.write(`===USER=== ${text}`);
            } else {
                Logger.write("===USER_TRANSCRIPT===");
                Logger.write(JSON.stringify(payload));
            }
        });
        // Handle tool calls
        voiceAIClient.addEventListener(ElevenLabs.AgentsEvents.ClientToolCall, (event) => {
            const payload = event?.data?.payload || event?.data || {};
            const toolName = payload.tool_name || payload.toolName || payload.name;
            const toolCallId = payload.tool_call_id || payload.toolCallId || payload.id;
            if (!toolName || !toolCallId) {
                Logger.write("===TOOL_CALL_MISSING_FIELDS===");
                Logger.write(JSON.stringify(payload));
                return;
            }
            let args = {};
            const rawArgs = payload.parameters || payload.args || payload.arguments;
            if (typeof rawArgs === "string") {
                try {
                    args = JSON.parse(rawArgs);
                } catch (error) {
                    Logger.write("===TOOL_ARGS_PARSE_ERROR===");
                    Logger.write(rawArgs);
                    Logger.write(error);
                }
            } else if (rawArgs && typeof rawArgs === "object") {
                args = rawArgs;
            }
            if (toolName !== TOOL_NAME) {
                voiceAIClient.clientToolResult({
                    tool_call_id: toolCallId,
                    tool_name: toolName,
                    result: {error: `Unhandled tool: ${toolName}`},
                });
                return;
            }
            const location = args.location || "Unknown";
            const result = {
                location,
                temperature_f: 72,
                condition: "sunny",
            };
            voiceAIClient.clientToolResult({
                tool_call_id: toolCallId,
                tool_name: toolName,
                result,
            });
        });
        voiceAIClient.addEventListener(ElevenLabs.AgentsEvents.AgentResponse, (event) => {
            const payload = event?.data?.payload || event?.data || {};
            const text = payload.text || payload.response || payload.agent_response;
            if (text) {
                Logger.write(`===AGENT=== ${text}`);
            } else {
                Logger.write("===AGENT_RESPONSE===");
                Logger.write(JSON.stringify(payload));
            }
        });
        // Consolidated "log-only" handlers - key ElevenLabs/VoxEngine debugging events
        [
            ElevenLabs.AgentsEvents.ConversationInitiationMetadata,
            ElevenLabs.AgentsEvents.AgentResponseCorrection,
            ElevenLabs.AgentsEvents.ContextualUpdate,
            ElevenLabs.AgentsEvents.AgentToolResponse,
            ElevenLabs.AgentsEvents.VadScore,
            ElevenLabs.AgentsEvents.Ping,
            ElevenLabs.AgentsEvents.HTTPResponse,
            ElevenLabs.AgentsEvents.WebSocketError,
            ElevenLabs.AgentsEvents.ConnectorInformation,
            ElevenLabs.AgentsEvents.Unknown,
            ElevenLabs.Events.WebSocketMediaStarted,
            ElevenLabs.Events.WebSocketMediaEnded,
        ].forEach((eventName) => {
            voiceAIClient.addEventListener(eventName, (event) => {
                Logger.write(`===${event.name}===`);
                if (event?.data) Logger.write(JSON.stringify(event.data));
            });
        });
    } catch (error) {
        Logger.write("===UNHANDLED_ERROR===");
        Logger.write(error);
        voiceAIClient?.close();
        VoxEngine.terminate();
    }
});
