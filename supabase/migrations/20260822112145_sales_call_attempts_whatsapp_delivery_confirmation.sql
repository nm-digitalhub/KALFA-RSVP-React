-- WhatsApp async-delivery-confirmation columns for sales_call_attempts,
-- supporting send_signup_link's delivery-confirmed flow (superseding the
-- earlier SMS-primary decision -- WhatsApp is now the real, first-attempted
-- channel). Requested by whatsapp-sales-link-real-build, 2026-08-22.
--
-- Shape verified live before building, not taken on request text alone:
--   * contact_interactions.delivery_status / delivery_error_code are both
--     TEXT, nullable, and that table carries ZERO CHECK constraints
--     (pg_constraint, contype='c', empty result) -- the "no CHECK, mirrors
--     contact_interactions" claim is accurate, not assumed.
--   * contact_interactions itself is not directly reusable here, same root
--     cause as call_attempts (A-10 elsewhere in this series): its FKs are
--     campaign_id/event_id/contact_id/guest_id, the same campaign/event
--     model a callback_requests-based lead structurally lacks. Hence new
--     columns on sales_call_attempts (mirroring the SHAPE), not a join to
--     the existing TABLE.
--   * contacts.whatsapp_consent_at exists but has ZERO production callers
--     (recordWhatsAppConsent, contacts.ts:313-324) -- confirmed via prior
--     session finding, re-verified live. It is not an operating consent
--     mechanism to build on top of, and callback_requests has no contact_id
--     FK to reach it through even if it were. wa_consent_confirmed_at below
--     is therefore the FIRST real per-call WhatsApp-consent capture in this
--     codebase, not a mirror of a working pattern -- scoped to this table
--     deliberately (the evidence is this one call's transcript, not a
--     standing per-contact fact).
--
-- wa_message_id: Meta's wamid once sendWhatsAppMarketingTemplate returns
-- {kind:'accepted', providerId}. Unique when set, same partial-index shape
-- as this table's existing el_conversation_id column.
--
-- wa_delivery_status: last known status. No CHECK (see above) -- Meta's
-- real webhook vocabulary (sent/delivered/read/failed) plus one
-- self-minted value, 'accepted', written at send time before any webhook
-- arrives, so the timeout sweep can distinguish "API confirmed queued" from
-- "nothing sent yet". Vocabulary enforcement is an application-layer
-- concern here, same as its contact_interactions namesake.
--
-- wa_status_at: written alongside every wa_delivery_status change,
-- INCLUDING the initial 'accepted' write at send time -- this is the clock
-- the timeout sweep reads, not created_at (the row exists from dispatch
-- time, before the call even connects, so created_at predates any WhatsApp
-- send by an unrelated amount).
--
-- wa_fallback_attempted_at: claim-before-write guard for dispatching the
-- SMS-fallback send, same idiom as callback_requests.no_contact_sms_
-- claimed_at (20260819233736) and this table's own outcome_recorded_at
-- (20260822105346): `UPDATE sales_call_attempts SET
-- wa_fallback_attempted_at = now() WHERE id = $1 AND
-- wa_fallback_attempted_at IS NULL RETURNING id` -- only the caller that
-- gets a row back may send the fallback SMS. Not this migration's job to
-- build that route.
--
-- wa_consent_confirmed_at: written by the send_signup_link route handler
-- immediately before attempting the WhatsApp send, gated on a
-- whatsapp_consent boolean the agent's tool call must pass (application/
-- tool-schema concern, not a column -- the timestamp alone records that
-- consent was captured and when, same non-null-means-yes shape as
-- call_consent_at elsewhere). Per-call (this table), not per-request
-- (callback_requests) or per-contact (contacts) -- deliberately, per above.
--
-- Partial index for the WhatsApp-timeout sweep's candidate query
-- (runSalesWhatsAppConfirmationSweep(), spec confirmed by whatsapp-sales-
-- link-real-build 2026-08-22, added here rather than deferred once the
-- exact predicate was nailed down). NOT simply wa_delivery_status =
-- 'accepted': that value advances to Meta's own 'sent' the moment the first
-- real webhook arrives (informational only, no action taken on it), so a
-- row that reached 'sent' but never progressed to delivered/read/failed
-- would silently fall out of an ='accepted' predicate and never time out.
-- Candidate set is both non-terminal statuses, excluding rows a resolver
-- has already claimed either way (outcome_recorded_at / wa_fallback_
-- attempted_at both null), and excluding wa_delivery_status = 'failed'
-- (claimed synchronously via wa_fallback_attempted_at by the webhook
-- handler itself, never left for this sweep). The sweep's own `AND
-- wa_status_at < now() - interval '15 minutes'` is a runtime predicate, not
-- part of the index -- a partial index can't encode now()-relative
-- conditions.
--
-- outcome_recorded_at's comment (from 20260822105346, already LIVE --
-- cannot be edited in place, migrations are immutable once applied) is
-- corrected here via a fresh COMMENT ON, which safely replaces the prior
-- text: the column now arbitrates ONE terminal claim among up to four
-- possible writers (the agent's live log_outcome tool call, or -- async,
-- out-of-band -- the WhatsApp delivery-webhook resolver, the SMS-fallback-
-- accept resolver, or a both-channels-failed resolver), not just log_outcome
-- alone. The claim mechanism itself is unchanged (a single `WHERE
-- outcome_recorded_at IS NULL` exclusive claim correctly arbitrates any
-- number of racing writers, not just two) -- only the comment describing who
-- might race for it needed updating.
--
-- No RLS/GRANT changes: posture set in the parent migration, unaffected by
-- adding columns.
--
-- Scheduling-sweep interaction hazard this design surfaces (mentioned by
-- whatsapp-sales-link-real-build) went to team-lead separately -- not a
-- schema concern, not addressed here.
--
-- Validated: run inside an explicit BEGIN/ROLLBACK against the linked
-- project (2026-08-22), confirming the ALTER, unique index, and all COMMENT
-- ON statements apply cleanly against the live table, then rolled back. NOT
-- applied outside that transaction -- staged pending explicit go, same
-- process as the rest of this series.
--
-- Rollback: drop index sales_call_attempts_wa_message_id_key; drop index
-- sales_call_attempts_wa_confirm_pending_idx; alter table
-- public.sales_call_attempts drop column wa_message_id, drop column
-- wa_delivery_status, drop column wa_delivery_error_code, drop column
-- wa_status_at, drop column wa_fallback_attempted_at, drop column
-- wa_consent_confirmed_at. (The outcome_recorded_at COMMENT ON is not
-- reversible by dropping anything -- restore the prior text from
-- 20260822105346 by hand if rolling back just the comment.)

alter table public.sales_call_attempts
  add column wa_message_id            text,
  add column wa_delivery_status       text,
  add column wa_delivery_error_code   text,
  add column wa_status_at             timestamptz,
  add column wa_fallback_attempted_at timestamptz,
  add column wa_consent_confirmed_at  timestamptz;

create unique index sales_call_attempts_wa_message_id_key
  on public.sales_call_attempts (wa_message_id)
  where wa_message_id is not null;

create index sales_call_attempts_wa_confirm_pending_idx
  on public.sales_call_attempts (wa_status_at)
  where wa_message_id is not null
    and outcome_recorded_at is null
    and wa_fallback_attempted_at is null
    and wa_delivery_status in ('accepted', 'sent');

comment on column public.sales_call_attempts.wa_message_id is
  'Meta wamid once sendWhatsAppMarketingTemplate returns {kind:accepted, providerId}. Unique when set -- same shape as el_conversation_id.';
comment on column public.sales_call_attempts.wa_delivery_status is
  'Last known WhatsApp delivery status. No CHECK (matches contact_interactions.delivery_status): sent/delivered/read/failed from Meta''s webhook, plus self-minted accepted written at send time before any webhook arrives.';
comment on column public.sales_call_attempts.wa_delivery_error_code is
  'Raw Meta error code on a failed wa_delivery_status -- same meaning as contact_interactions.delivery_error_code.';
comment on column public.sales_call_attempts.wa_status_at is
  'Written alongside every wa_delivery_status change, including the initial accepted write at send time. The timeout sweep''s cutoff clock -- NOT created_at, which predates the WhatsApp send by the dispatch-to-call-connect gap.';
comment on column public.sales_call_attempts.wa_fallback_attempted_at is
  'Claim-before-write guard for the SMS-fallback send, same idiom as callback_requests.no_contact_sms_claimed_at and this table''s own outcome_recorded_at: UPDATE ... SET wa_fallback_attempted_at = now() WHERE id = $1 AND wa_fallback_attempted_at IS NULL RETURNING id -- only the caller that gets a row back may send the fallback SMS.';
comment on column public.sales_call_attempts.wa_consent_confirmed_at is
  'Per-call record that the prospect verbally opted in to a WhatsApp message from this call''s transcript -- NOT a mirror of contacts.whatsapp_consent_at, which has zero production callers and is unreachable here anyway (callback_requests has no contact_id FK). Written by the send_signup_link route immediately before attempting the WhatsApp send.';
comment on column public.sales_call_attempts.outcome_recorded_at is
  'Claim-before-write guard for the ONE terminal write to callback_requests.call_outcome for this call, whoever reaches it first -- the agent''s live log_outcome tool call, or (async, out-of-band) the WhatsApp delivery-webhook resolver, the SMS-fallback-accept resolver, or the both-channels-failed resolver. Idempotent write: UPDATE ... WHERE id = $1 AND outcome_recorded_at IS NULL RETURNING id -- only the winner may call applyCallOutcome().';
