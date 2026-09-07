-- Voice-ops visibility for agent-mode calls (2026-09-07, owner-approved).
--
-- THE GAP. The ElevenLabs bridge writes the guest's RSVP in-call via save_rsvp
-- (real counts, straight to the guest row) and its terminal callback carries
-- rsvp_method='agent' with NO digit — by design (the digit path would overwrite
-- real counts with 1/0 defaults). But every /admin/voice counter and the
-- per-attempt "תוצאת RSVP" column read ONLY rsvp_digit, so production agent
-- calls showed 0 confirmations while the guest list showed the RSVPs. The
-- attempt row simply never learned what the call concluded.
--
-- 1) rsvp_outcome: what THIS call's save_rsvp concluded (attending/declined/
--    maybe). Written by processCallRsvp — the one place that holds both the
--    attempt id and the validated answer — on every apply, last write wins
--    (a mid-call correction is a later row and should win).
alter table public.call_attempts
  add column rsvp_outcome text
  check (rsvp_outcome is null or rsvp_outcome in ('attending', 'declined', 'maybe'));

comment on column public.call_attempts.rsvp_outcome is
  'RSVP answer captured by THIS call''s save_rsvp (agent bridge), independent of the digit path. Written by processCallRsvp, last write wins within the call. NULL = the call captured no answer (or pre-2026-09 row not covered by the backfill).';

-- 2) Backfill from the durable inbox: every save_rsvp body was persisted to
--    webhook_inbox (provider=voximplant, event_kind=call_rsvp, message_id =
--    attempt id) — take the LATEST answer per attempt. Idempotent.
with latest as (
  select distinct on (w.message_id)
         w.message_id, w.payload->>'status' as status
  from public.webhook_inbox w
  where w.provider = 'voximplant'
    and w.event_kind = 'call_rsvp'
    and w.payload->>'status' in ('attending', 'declined', 'maybe')
  order by w.message_id, w.event_at desc
)
update public.call_attempts a
   set rsvp_outcome = l.status
  from latest l
 where a.id::text = l.message_id
   and a.rsvp_outcome is null;

-- Legacy-boolean bodies (attending true/false, no status key) — same source.
with latest as (
  select distinct on (w.message_id)
         w.message_id,
         case when (w.payload->>'attending')::boolean then 'attending' else 'declined' end as status
  from public.webhook_inbox w
  where w.provider = 'voximplant'
    and w.event_kind = 'call_rsvp'
    and w.payload->>'status' is null
    and w.payload->>'attending' is not null
  order by w.message_id, w.event_at desc
)
update public.call_attempts a
   set rsvp_outcome = l.status
  from latest l
 where a.id::text = l.message_id
   and a.rsvp_outcome is null;

-- 3) Repair the analysis linkage. Since ~2026-08-19 every ElevenLabs post-call
--    delivery has arrived at the SALES endpoint (single workspace webhook), so
--    RSVP analyses were stored by the sales path — which deliberately skips the
--    RSVP linker — leaving call_attempt_id NULL even where call_attempts holds
--    the matching el_conversation_id. Link what is linkable. Idempotent.
update public.call_analysis ca
   set call_attempt_id = att.id,
       event_id = att.event_id,
       linked_at = now()
  from public.call_attempts att
 where ca.call_attempt_id is null
   and att.el_conversation_id = ca.conversation_id;
