# Proposal

## Why

Owner ruling 18.10.2026: everything a voice call produces — the transcript, what the guest said, and the audio — is kept under KALFA's own control. Today none of it is.

Measured 18.10.2026 against the code and the live database:
- **`call_analysis` is metadata-only by design** (`src/lib/validation/elevenlabs-payloads.ts`, `src/lib/data/elevenlabs-analysis.ts`). Transcript turns, guest `dynamic_variables` and the per-criterion rationales are dropped on the way in.
- **The raw delivery is stored anyway, in the wrong place.** `src/app/api/elevenlabs/rsvp/update/route.ts` persists the whole `post_call_transcription` payload into `webhook_inbox.payload` before the worker normalizes it. The live table holds 29 such rows (1.9–12.10.2026), every one with the full transcript and the guest variables. `webhook_inbox` is an admin-only intake queue: no link to the event owner, no search, and no job that deletes from it.
- **The audio is not in KALFA at all.** ElevenLabs keeps it on all four agents (`record_voice: true`, `retention_days: -1`, `delete_audio: false` in `agent_configs/*.json`). Voximplant keeps its own recording (`call.record({ stereo: true, hd_audio: true })` in `RSVPAgent.voxengine.js`). KALFA stores only a validated link, `call_attempts.recording_url` (15 of 20 attempts on the live table), and the files sit at a provider under that provider's expiry.

So the content exists in three places KALFA does not govern (an inbox queue and two vendors), and in none that has an owner scope, a retention rule or an access record.

## What Changes

- **A PII-isolated transcript store.** A new service-role-only table holds the transcript turns (speaker, text, offset in the call), the guest variables of the call, and the evaluation and data-collection rationales. It is keyed by provider and conversation, and linked to the attempt row (the polymorphic `attempt_table` + `attempt_id` pair that `call_analysis` already uses) and to the event.
- **An audio store.** A private storage bucket holds the audio file; a metadata table records what was stored, its size, its hash and where it came from. A worker job fetches the audio after the call ends, with retries and a lease, the way `vox-log-export.ts` exports Voximplant session logs.
- **One governed copy.** After the transcript row is written, the transcript and guest variables are redacted from the matching `webhook_inbox` row, and the 29 existing rows are back-filled into the new store and then redacted. `call_analysis` stays metadata-only and unchanged.
- **Access and audit.** Reading a transcript or playing audio is limited to platform staff holding an explicit permission, requires a stated reason, and writes an append-only access row (the `support_access_log` precedent). No customer-facing view of call content is introduced.
- **Retention and erasure.** A scheduled purge deletes transcripts and audio after a retention period the owner sets, and deleting a guest or an event removes the call content with it. The period is an open decision recorded in design; apply is blocked until it is set.
- **Contract comments retired.** The comments that say the transcript "NEVER" reaches storage (`elevenlabs-payloads.ts`, `elevenlabs-analysis.ts`) and the open privacy risk in `docs/voice-agent/production-wiring-audit-2026-07-20.md` are updated to say where the content now lives.

**Gates, recorded in design and not decided here:**
- Israeli privacy and call-recording review (the people on these calls are third-party guests) by `israeli-compliance-advisor` and the attorney, before apply.
- The audio source: Voximplant recording, ElevenLabs conversation audio, or both. Verified against live documentation before apply.
- The retention period, and whether the event owner may ever read call content.

**Non-goals:**
- Changing any ElevenLabs or Voximplant setting. Provider-side retention (`retention_days: -1`, `delete_audio: false`) is revisited only after our own copy is verified, and only through the CLI round-trip required for `agent_configs/*.json`.
- Re-enabling the `post_call_audio` webhook. The route caps the body at 256 KiB, and the audio event was removed from the workspace on 1.9.2026.
- Any customer-facing display of transcripts or recordings, or LLM analysis of them.

## Capabilities

### New Capabilities
- `voice-call-transcripts`: what is captured from a finished call (turns, guest variables, rationales), where it is held, how it is linked to the attempt and the event, and the single-copy rule for the webhook inbox.
- `voice-call-audio`: fetching a call's audio into a private bucket, what is recorded about each file, and how a missing or expired source is handled.
- `voice-call-data-access-and-retention`: who may read call content, the audit of every read, the retention period and purge, and erasure when a guest or event is deleted.

### Modified Capabilities
- None. `openspec/specs/` is empty; nothing is archived yet.

## Impact

- **Code:** `src/lib/validation/elevenlabs-payloads.ts` (a separate extractor beside the metadata normalizer), `src/lib/data/elevenlabs-analysis-processing.ts`, a new audio export module, `worker/main.ts` (queue and purge schedule), `src/lib/voximplant/log-download.ts` (reuse of the hardened download), `/admin/recordings` and the admin call surfaces.
- **Database:** new tables for transcripts, audio metadata and the access log, and one new private bucket, with RLS on and no client grants. A one-off back-fill and redaction of existing `webhook_inbox` rows. Migrations are not deployed without explicit approval.
- **Secrets:** an ElevenLabs API key on the server, only if ElevenLabs conversation audio is chosen as a source (the app holds no such key today; `src/lib/security/elevenlabs-webhook.ts` uses a placeholder key for signature checks only).
- **Privacy:** this change deliberately increases the personal data KALFA holds. Every read path is staff-only, audited and bounded by retention.
- **Docs:** `docs/voice-agent/` privacy notes and the 20.7.2026 audit's open risk.
