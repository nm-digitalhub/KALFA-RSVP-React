> מקור: https://docs.voximplant.ai/voice-ai-orchestration/elevenlabs/outbound
> נשמר: 2026-09-14

# Example: Placing an outbound call

Voice AI Clients
ElevenLabs Agents

Example: Placing an outbound call

Ask a question
|
Copy page
|
View as Markdown
|
More actions

For the complete documentation index, see llms.txt.

This example starts a VoxEngine session, places an outbound PSTN call, and bridges audio to ElevenLabs Agents once the callee answers.

Jump to the Full VoxEngine scenario.

Prerequisites
Store your ElevenLabs API key in Voximplant Secrets under ELEVENLABS_API_KEY.
Store your ElevenLabs Agent ID in Voximplant Secrets under ELEVENLABS_AGENT_ID.
Optional: set ELEVENLABS_BASE_URL in the example if your ElevenLabs account should use a custom Agents endpoint.
Ensure outbound calling is enabled for your Voximplant application and that your caller ID is verified.
Outbound call parameters

The example expects destination and caller ID in customData (read via VoxEngine.customData()):

Custom data example
{"destination":"+15551234567","callerId":"+15557654321"}
Launch the routing rule

For quick testing, you can start this outbound scenario from the Voximplant Control Panel:

Open your Voximplant application and go to the Routing tab.
Select the routing rule that has this scenario attached.
Click Run.
Provide Custom data (max 200 bytes) with destination and callerId:
Custom data example
{"destination":"+15551234567","callerId":"+15557654321"}

For production, start the routing rule via the Management API startScenarios method (pass rule_id, and pass the same JSON string in script_custom_data).

Alternate outbound destinations

This example uses VoxEngine.callPSTN(...) for PSTN dialing. You can also route outbound calls to other destination types in VoxEngine:

SIP (VoxEngine.callSIP): dial a SIP URI to reach a PBX, carrier, SIP trunk, or other SIP endpoint.
WhatsApp (VoxEngine.callWhatsappUser): place a WhatsApp Business-initiated call (requires a WhatsApp Business account and enabled numbers).
Voximplant users (VoxEngine.callUser): calls another app user inside the same Voximplant application such as web SDK, mobile SDK, or SIP user.

Relevant guides:

SIP calling options
Voximplant users calling options
WhatsApp calling options
Connect call audio

After the callee answers, the example creates an ElevenLabs.AgentsClient and bridges audio:

Connect call audio
VoxEngine.sendMediaBetween(call, agentsClient);
Barge-in
Barge-in
agentsClient.addEventListener(ElevenLabs.AgentsEvents.Interruption, () => {
  agentsClient.clearMediaBuffer();
});
Notes

See the VoxEngine API Reference for more details.

Full VoxEngine scenario
voxeengine-elevenlabs-outbound.js
/**
 * Voximplant + ElevenLabs Agents connector demo
 * Scenario: place an outbound PSTN call and bridge it to ElevenLabs Agents.
 */
require(Modules.ElevenLabs);
const MAX_CALL_MS = 2 * 60 * 1000;  // Maximum call duration of 2 minutes
// Optional. Leave empty to use the default ElevenLabs Agents endpoint.
const ELEVENLABS_BASE_URL = "";
VoxEngine.addEventListener(AppEvents.Started, async () => {
    let call;
    let voiceAIClient;
    let hangupTimer;
    try {
        // This can be provided when manually running a routing rule in the Control Panel,
        // or via Management API using the `script_custom_data` parameter.
        // example: {"destination": "+15551234567", "callerId": "+15557654321"}
        const {destination, callerId} = JSON.parse(VoxEngine.customData());
        call = VoxEngine.callPSTN(destination, callerId);
        // Alternative outbound paths (uncomment to use):
        // call = VoxEngine.callUser({username: destination, callerid: callerId});
        // call = VoxEngine.callSIP(`sip:${destination}@your-sip-domain`, callerId);
        // call = VoxEngine.callWhatsappUser({number: destination, callerid: callerId});
        call.addEventListener(CallEvents.Failed, () => VoxEngine.terminate());
        call.addEventListener(CallEvents.Disconnected, () => {
            if (hangupTimer) clearTimeout(hangupTimer);
            VoxEngine.terminate();
        });
        call.addEventListener(CallEvents.Connected, async () => {
            hangupTimer = setTimeout(() => {
                Logger.write("===HANGUP_TIMER===");
                call.hangup();
            }, MAX_CALL_MS);
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
        });
    } catch (error) {
        Logger.write("===UNHANDLED_ERROR===");
        Logger.write(error);
        voiceAIClient?.close();
        VoxEngine.terminate();
    }
});
