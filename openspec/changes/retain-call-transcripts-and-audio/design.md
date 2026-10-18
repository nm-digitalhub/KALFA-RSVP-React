# Design

## Context

See `proposal.md` for the motivation. The facts below are what the design rests on; each was read in the code or measured on the live database on 18.10.2026 unless marked otherwise.

- **Intake.** `src/app/api/elevenlabs/rsvp/update/route.ts` verifies the signature, stores the whole delivery as one `webhook_inbox` row (`elevenlabs-webhook-intake.ts` copies `payload` untouched) and answers 200. The worker (`elevenlabs-analysis-processing.ts`) then runs `normalizeCallAnalysisWebhook`, which keeps metadata only, and upserts `call_analysis` on `(provider, conversation_id)` with `ignoreDuplicates`. Every post-call delivery of the workspace currently arrives at the sales endpoint; the processor classifies the persona by data, not by URL.
- **`webhook_inbox`.** Admin-only RLS; 29 ElevenLabs rows, all `el_analysis_sales`, all with transcript and guest variables, oldest 1.9.2026. No job deletes from it. The largest real delivery measured on 1.9.2026 was about 86 KB, under the route's 256 KiB cap.
- **Attempt linking.** `resolveAttempt` finds the attempt in any of five attempt tables, by correlation token or `el_conversation_id`, and returns table, id, event and guest. `call_analysis` stores that as the polymorphic pair `attempt_table` + `attempt_id` and copies `event_id`.
- **Audio today.** `call_attempts.recording_url` holds a validated Voximplant link (`recording-url.ts`; 15 of 20 live attempts, 14.7–7.9.2026). The hosts are `storage-gw-<region>-<nn>.voximplant.com`. `log-download.ts` already downloads from those hosts with an SSRF-hardened path: https only, port 443, host allowlist, DNS private-range rejection, no redirects, a size cap, and the Management JWT attached only after a 401/403. ElevenLabs holds its own audio (`record_voice: true`, `retention_days: -1`, `delete_audio: false` on all four agents).
- **Precedents to reuse.** `console_call_pii` (RLS on, zero policies, all client grants revoked: service-role only); `call_analysis` (owner/admin SELECT only, writes by service role); `support_access_log` (append-only staff-read audit with a break-glass reason); `vox-log-export.ts` (durable export of provider data into a private bucket, daily cron, row lease, bounded attempts, `RETENTION_DAYS` purge, alert only on systemic failure); `archive-backup` (private bucket with no `storage.objects` policies).
- **Not present.** The app holds no ElevenLabs API key (`src/lib/security/elevenlabs-webhook.ts` constructs the SDK with a placeholder for signature verification only). The ElevenLabs SDK in `package.json` (`^2.73.0`) does expose `conversationalAi.conversations.audio.get(conversationId)`, returning a byte stream.
- **In-flight overlap.** The change `staff-tables-permission-rls` (5 of 29 tasks) reworks platform-staff permissions, which this design extends with one new permission.

## Goals / Non-Goals

**Goals:**
- One governed copy of call content, scoped to the event and attempt, readable only by authorized staff, audited, and bounded by retention.
- Reuse the existing patterns above; add no parallel mechanism.
- Nothing is lost while a gate is still open: where a decision is missing, the system keeps the raw inbox payload.

**Non-Goals:**
- Provider-side retention settings, the `post_call_audio` webhook, owner-facing display of call content, LLM analysis of transcripts (see proposal).
- Changing what `call_analysis` holds.

## Decisions

**D1. A separate content store; `call_analysis` stays metadata-only.**
`call_analysis` has an owner SELECT policy through `can_access_event`, so adding transcript columns would expose guest speech to event owners. New tables are service-role only (the `console_call_pii` posture). *Alternative rejected:* columns on `call_analysis` behind a view or column privileges; one missed grant leaks every transcript.

**D2. Tables.** All have RLS on, zero policies, and all grants revoked from `anon` and `authenticated`.
- `call_transcripts`: unique on `(provider, conversation_id)`; `attempt_table`, `attempt_id`, `event_id`, `guest_id` copied at link time (nullable); `turns` (ordered array of speaker, text, offset); `guest_vars`; `rationales` (evaluation and data-collection reasons); `call_at` (the call's own time, used for retention); timestamps.
- `call_audio`: unique on `(attempt_table, attempt_id)`; same link columns; `status` in `pending | stored | failed | source_unavailable | no_source`; `source` (`voximplant | elevenlabs`); `storage_path`, `size_bytes`, `content_type`, `sha256`; `attempts`, `lease_until`, `last_error` (a failure class, never a URL or body); timestamps.
- `call_content_access_log` and `call_content_purge_log`: append-only, no content.
`event_id` and `guest_id` are real foreign keys with `on delete cascade` on the two content tables, so deleting a guest or an event removes the rows with no application code (spec: deletion requirement). The two log tables carry plain ids without foreign keys, so the audit survives the deletion it records. *Alternative rejected:* only the polymorphic pair; PostgreSQL cannot cascade through it.

**D3. Capture pipeline.** A new pure extractor (beside `normalizeCallAnalysisWebhook`, same input, separate output) produces the content record. The metadata normalizer is untouched, so the PII boundary that protects `call_analysis` is not widened. In the existing processor the order is: `call_analysis` upsert, then transcript upsert, then inbox redaction (D9). Each step is idempotent and any failure throws to the existing retry path. Re-analysis uses an upsert that replaces `rationales` and never touches `turns`.

**D4. Audio source: Voximplant recording first, ElevenLabs audio only as a fallback.**
Voximplant is chosen because: the reference is already captured and validated; it records both parties as stereo HD (what happened on the line); the hardened download and Management JWT already exist; and no new secret is needed. ElevenLabs conversation audio needs a new server-side API key and holds only the agent-side session. The fallback is built only if the pre-apply check finds finished calls with a conversation but no Voximplant recording (only `RSVPAgent.voxengine.js` is confirmed to call `call.record`; the other scenarios are not checked). *Alternatives rejected:* the `post_call_audio` webhook (256 KiB cap, event removed 1.9.2026, would need streaming to storage); fetching both for every call (double storage, double PII, no benefit).

**D5. Audio fetch job.** Modeled on `vox-log-export.ts`: a worker queue with a daily sweep plus a post-call enqueue, an atomic per-row lease, `MAX_PER_RUN`, bounded attempts with growing delay, a size cap, per-row isolation, and a Slack alert only when every processed row failed. It reuses the hardened download and extends its allowlist deliberately, not by wildcard. Bytes go to a private `call-audio` bucket with no `storage.objects` policies, at a path derived from the attempt (not the guest or the phone), with `sha256` recorded. Size is bounded, so the file is buffered, not streamed.

**D6. Storage objects outlive foreign-key cascades.** Deleting a database row does not delete the object. A trigger on `call_audio` deletion writes the path to a removal queue table; the worker drains it through the Storage API. Purge and erasure both go through this one path, so there is a single way an object is removed.

**D7. Access.** A new dedicated platform permission, `view_call_content`, granted only to the platform owner by default; it is separate from `view_customer_data` because call content is more sensitive than the support view. A server action checks the permission and a non-empty reason, appends the access row, then returns the transcript or a signed URL valid for a few minutes, created with the service client. The URL is never stored or logged. Event owners get no read path in this change. *Alternative rejected:* reuse `view_customer_data`; it would silently grant every support agent audio of guests.

**D8. Retention.** One setting in the existing admin configuration store, null by default. While null, capture is paused (spec: capture withheld) and the inbox payload is kept, so waiting loses nothing. A daily purge deletes content whose `call_at` is older than the period, writes a purge row with counts, and queues storage removals (D6). The period counts from the call, not from the fetch, so a back-filled July recording is purged on the same rule as a new one.

**D9. Inbox redaction.** After D3 succeeds, the matching inbox row loses `data.transcript` (replaced by a redaction marker with the time), every `rationale` under `analysis`, and every `conversation_initiation_client_data.dynamic_variables` entry except our own `kalfa_*` correlation keys. The normalizer reads the correlation token and the turn counts, so a Reprocess still works for rows not yet stored; rows already stored are idempotent no-ops. Redaction runs only when both the `call_analysis` row and the transcript row exist.

**D10. Back-fill.** One idempotent job with a dry-run default: inbox rows to transcripts (then redaction, as a separate confirmed step), and stored `recording_url` values to audio, newest first. The audio part is time-sensitive because the provider's retention for recordings is not verified (see Risks).

**D11. Provider-retention status shown to staff is read from the committed snapshots.** The deletion report (spec) needs to say whether the provider still retains audio. The only source the app can read without a new secret is `agent_configs/*.json`, so the report states the value as of the last `agents pull`, labelled with that date, never as live. *Alternative rejected:* a live ElevenLabs read, which needs the same new API key as the audio fallback in D4 and is not needed to tell staff the truth.

## Risks / Trade-offs

- **Third-party personal data and call-recording rules (gate).** The speakers are guests who never signed up. → Review by `israeli-compliance-advisor` and the attorney before apply: lawful purpose, the notice given on the call (whether the agent announces recording is not yet verified), retention length, and whether a guest can ask for deletion. No migration is applied before that.
- **Provider copies persist.** ElevenLabs retains indefinitely, so KALFA's erasure is partial. → The deletion report says so (spec); provider retention is a follow-up change through the CLI round-trip, after our copy is verified.
- **Older recordings may already be gone.** Voximplant session logs expire in about a month (`vox-log-export.ts`); the retention of recordings is not verified, and the oldest stored reference is from 14.7.2026. → First task of apply is a read-only check of what still resolves; the audio back-fill runs before anything else.
- **Larger blast radius if the service key leaks.** All content becomes reachable. → Private bucket, no client grants anywhere, staff-only reads with reason and audit, retention bound, and alerts that carry identifiers only.
- **Irreversible redaction.** Redacting `webhook_inbox` removes the only copy of the raw payload. → It is a separate migration step, run only after counts match between inbox and store, and it needs its own approval.
- **Guest removal semantics unverified.** If guests are soft-deleted or `call_attempts.guest_id` is not a cascading reference, the `guest_id` cascade never fires. → Task: read the guest-removal path and the foreign keys before writing the migration; hook the soft-delete path if that is what exists.
- **Permission model is moving.** `staff-tables-permission-rls` changes the same area. → Sequence the new permission after it, or coordinate in one migration set.
- **Storage growth is unmeasured.** → Record sizes during the back-fill and put the figure in the apply report; the size cap bounds the worst case per file.

## Migration Plan

1. Gates cleared: compliance review, retention period chosen, audio source confirmed against live documentation.
2. Read-only checks: which recordings still resolve; guest-removal semantics; which scenarios record.
3. Migrations (each needs approval to deploy): new tables and bucket, access and purge logs, the removal trigger and queue, the permission. Types regenerated with `npm run gen:types`, never by hand.
4. Code: extractor, processor change, audio queue, purge, access actions, admin surfaces. Capture stays paused until the retention setting is written.
5. Back-fill in dry-run, review the counts, then run; audio first.
6. Redact the inbox (separate approved step). Update the contract comments and the audit note.
7. Verify: lint, typecheck, build, focused tests, and a live call whose transcript and audio are read back through the staff action.

**Rollback:** drop the new tables and trigger, empty and delete the bucket, remove the permission. Redaction is the one step that cannot be undone from the inbox; it can only be reconstructed from `call_transcripts`, which is why it comes last.

## Open Questions

Deferrable; none changes the specs or the approach.
- Exact values: size cap per file, signed-URL lifetime, `MAX_PER_RUN`, attempt count.
- Where the staff surface lives: a tab on the existing recordings page or on the call detail.
- Whether the audio back-fill should also try ElevenLabs for the old calls without a recording, decided from the pre-apply check.
