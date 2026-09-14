# Production architecture map

## Existing agents

The repository agent manifest contains separate ElevenLabs agents for RSVP, meeting confirmation, sales close and customer service. Their configuration belongs in agents.json / agent_configs and ElevenLabs, not in workflow diagrams.

## Existing voice path

For RSVP calls the runtime path is:

Workflow action
  -> dispatchWorkflowRsvpAiCallback
  -> dispatchOutreachCall
  -> getVoximplantConfig
  -> Voximplant StartScenarios
  -> OutCallAgent rule
  -> RSVPAgent.voxengine.js
  -> ElevenLabs.createAgentsClient
  -> live bidirectional media

The RSVP VoxEngine client tools remain the source of truth for save_rsvp, mark_dnc, notify_owner and schedule_callback.

## Existing post-call path

ElevenLabs post_call_transcription
  -> /api/elevenlabs/rsvp/update
  -> verified webhook intake
  -> provider inbox
  -> call analysis processor
  -> call_analysis

The workflow action does not write a duplicate transcript/conversation table.

## Separate future trigger

If WorkflowBuilder needs post-call automation, add a separate trigger such as trigger.elevenlabs_call_completed after the webhook has persisted a trusted call_analysis row. That change should generalize workflow_runs.trigger_source and planRuns/createRunIfNew rather than keeping a worker open until a phone call finishes.
