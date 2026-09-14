> מקור: https://docs.voximplant.ai/voice-ai-orchestration/elevenlabs/inbound
> נשמר: 2026-09-14

# Example: Answering an incoming call

Voice AI Clients
ElevenLabs Agents

Example: Answering an incoming call

Ask a question
|
Copy page
|
View as Markdown
|
More actions

For the complete documentation index, see llms.txt.

This example answers an inbound Voximplant call and bridges audio to ElevenLabs Agents for real-time speech-to-speech conversations.

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
Optional: set ELEVENLABS_BASE_URL in the example if your ElevenLabs account should use a custom Agents endpoint.
Session setup

ElevenLabs Agents are configured in the ElevenLabs console. In VoxEngine, you only need the API key and agent ID.

In the full example, the client is created with:

Create Agents client
const agentsClientParameters = {
    xiApiKey: VoxEngine.getSecretValue("ELEVENLABS_API_KEY"),
    agentId: VoxEngine.getSecretValue("ELEVENLABS_AGENT_ID"),
};
if (ELEVENLABS_BASE_URL) {
    agentsClientParameters.baseUrl = ELEVENLABS_BASE_URL;
}
agentsClient = await ElevenLabs.createAgentsClient(agentsClientParameters);
Configure prompts and tools in ElevenLabs

Prompts, voices, and tools live in your ElevenLabs Agent configuration. Update them in the ElevenLabs console and reuse the same agent ID in VoxEngine.

Connect call audio

Once you have an ElevenLabs.AgentsClient, bridge audio both ways between the call and the agent:

Connect call audio
VoxEngine.sendMediaBetween(call, agentsClient);
Barge-in

To keep the conversation interruption-friendly, the example listens for ElevenLabs.AgentsEvents.Interruption and clears the media buffer so any in-progress TTS audio is canceled when the caller starts talking:

Barge-in
agentsClient.addEventListener(ElevenLabs.AgentsEvents.Interruption, () => {
  agentsClient.clearMediaBuffer();
});
Events

The scenario logs transcripts and key lifecycle events. For example:

Events (example from the scenario)
agentsClient.addEventListener(ElevenLabs.AgentsEvents.UserTranscript, (event) => {
  const payload = event?.data?.payload || event?.data || {};
  const text = payload.text || payload.transcript || payload.user_transcript;
  if (text) Logger.write(`USER: ${text}`);
});
Notes

See the VoxEngine API Reference for more details.

Full VoxEngine scenario
voxeengine-elevenlabs-inbound.js
/**
 * Voximplant + ElevenLabs Agents connector demo
 * Scenario: answer an incoming call and bridge it to ElevenLabs Agents.
 */
require(Modules.ElevenLabs);
// Optional. Leave empty to use the default ElevenLabs Agents endpoint.
const ELEVENLABS_BASE_URL = "";
VoxEngine.addEventListener(AppEvents.CallAlerting, async ({call}) => {
    let voiceAIClient;
    // Termination handlers
    call.addEventListener(CallEvents.Disconnected, () => VoxEngine.terminate());
    call.addEventListener(CallEvents.Failed, () => VoxEngine.terminate());
    try {
        call.answer();
        // call.record({hd_audio: true, stereo: true}); // Optional: record the call
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
