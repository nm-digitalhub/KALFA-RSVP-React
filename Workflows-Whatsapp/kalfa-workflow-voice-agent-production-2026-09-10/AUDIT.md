# GitHub audit used for this revision

Audited on 2026-09-10 against branch feat/admin-integrations-consolidation at b09240b7a980d81f9ceb2ec89f0116f0039060c7.

## Existing ElevenLabs agents

agents.json contains four separate agents:

- RSVP: agent_9701kxj3n54ye518a3s518cexd48
- Meeting Confirm: agent_3601m0mt3tf3e2cvgqwak2yg54b6
- Sales Close: agent_4101m0my2f2kf4qvhegat60wrgtn
- Customer Service: agent_8801m0d6pgwkfw1rtw3ba25h1q50

The customer-service agent config demonstrates that model, prompt, tools and knowledge already belong to the ElevenLabs agent configuration. It currently references gemini-2.5-flash, an ElevenLabs knowledge-base entry and the KALFA lookup_guest_rsvp tool.

## Existing Voximplant routing

voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/rules.config.json contains:

- OutCall -> RSVP
- OutCallAgent -> RSVPAgent
- OutCallMeetingConfirm -> MeetingConfirmAgent
- OutCallSalesClose -> SalesCloseAgent

RSVPAgent.voxengine.js uses Modules.ElevenLabs / ElevenLabs.createAgentsClient and bridges live media between PSTN and the ElevenLabs agent. It exposes the RSVP client tools save_rsvp, mark_dnc, notify_owner and schedule_callback.

## Existing dispatch path

src/lib/data/outreach-calls.ts already owns production RSVP dialing and all dial-time gates. The workflow action delegates to it instead of calling Voximplant directly.

## Existing post-call persistence

src/lib/data/elevenlabs-webhook-intake.ts accepts verified post_call_transcription events. src/lib/data/elevenlabs-analysis.ts stores the normalized result in call_analysis and links it back to call attempts through the existing correlation fields.

## Existing WhatsApp template stack

src/lib/data/outreach.ts and src/lib/whatsapp/client.ts already implement real approved-template resolution/sending and outbound interaction logging. This package intentionally does not expose a raw template-name workflow action because doing so would bypass the existing campaign/template/compliance boundary.
