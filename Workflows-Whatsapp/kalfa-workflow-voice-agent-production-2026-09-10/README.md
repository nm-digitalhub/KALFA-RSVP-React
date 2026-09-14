# KALFA Workflow: production RSVP voice-agent wiring

Date: 2026-09-10
Repository: nm-digitalhub/KALFA-RSVP-React
Target branch: feat/admin-integrations-consolidation
Audited branch head: b09240b7a980d81f9ceb2ec89f0116f0039060c7

This package replaces the previous preview-only AI-node concept with KALFA's real production architecture.

## What changed

The old preview design modelled AI as an inline LLM/RAG pipeline:

- data.load_knowledge
- transform.compose_prompt
- ai.generate_answer
- transform.sanitize_answer
- logic.whatsapp_window
- action.send_whatsapp_template
- action.append_conversation_log

That is not how KALFA's production AI works. The real system already has ElevenLabs agents whose model, prompt, tools and knowledge are configured in the agent, and Voximplant scenarios bridge PSTN audio to those agents.

This package therefore adds one live workflow action:

- action.start_rsvp_ai_callback

The action does not contain a provider, model, knowledge-base id, ElevenLabs API key, agent id, phone number or arbitrary recipient. It resolves the current event/contact server-side and delegates to the existing RSVP call dispatcher. That dispatcher in turn uses the configured Voximplant production rule, which is expected to route through OutCallAgent -> RSVPAgent -> ElevenLabs.

## Async boundary

A voice call is not an inline request/response node. The workflow action finishes when call dispatch reaches a stable dispatcher result. It never waits for a generated answer or transcript.

Post-call analysis remains owned by the existing ElevenLabs post_call_transcription webhook and call_analysis persistence path. A future workflow that reacts to call outcome must start from a separate call-completed trigger; it must not resume this workflow run after a long external call.

## Retry and duplicate-call protection

The workflow engine is at-least-once and may reclaim a step after its lease. A naive isManual dispatch would allocate a fresh touchpoint on retry and could place a second phone call.

The new action prevents that by deriving a deterministic UUID dispatch_id from runId + nodeId. Before dispatch it checks call_attempts for that dispatch_id. If a prior attempt exists, it returns that attempt instead of calling Voximplant again. Only a genuinely new workflow step reaches dispatchOutreachCall.

The actual dispatch still goes through KALFA's existing gates: outreach enabled, live calls enabled, dial hours, call consent, DNC, event state, active campaign/call channel, concurrency, campaign-hour cap, Voximplant balance and atomic call-attempt creation.

## What this package deliberately does not add

It does not recreate an AI provider selector, model selector, prompt composer, knowledge loader or conversation logger inside WorkflowBuilder.

It also does not expose a new generic WhatsApp-template node in this patch. KALFA already has a real approved-template sending stack; exposing it in WorkflowBuilder should reuse that campaign/template resolver and its compliance rules rather than bypass it with a raw template-name field. The previous preview node is therefore removed from the design rather than falsely marked production-ready.

## Apply

From the repository root:

```bash
/path/to/kalfa-workflow-voice-agent-production-2026-09-10/apply.sh
```

The installer verifies Git blob hashes for every file it edits. It aborts before writing if the working tree no longer matches the audited branch files. It also refuses to run if the old preview AI overlay is already present; in that case merge from the current branch rather than layering the two models.

After application run:

```bash
npx tsc --noEmit
npm run lint
npm run worker:deps
npm test
npm run build
```

No production call is made by this package or its verification script.

## Audited file guards

The installer pins the current Git blobs of every edited file, including the 2026-09-10 updates to schemas.ts, dry-run.ts and steps/index.ts. This is stricter than the previous archive and prevents applying against its stale baseline.
