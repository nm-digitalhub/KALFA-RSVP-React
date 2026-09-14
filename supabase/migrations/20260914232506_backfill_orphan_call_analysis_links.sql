-- Backfill call_analysis rows that were stored without their owning attempt.
--
-- WHY THESE ROWS ARE ORPHANS. Every ElevenLabs post-call webhook lands on the
-- sales endpoint — MEASURED on webhook_inbox: 16 `el_analysis_sales` rows and
-- ZERO `el_analysis_rsvp`. That handler rescues a conversation to the RSVP
-- store only when `isRsvpConversation` matches it, and that check reads
-- `call_attempts` alone. An RSVP call carries a real correlation nonce and is
-- rescued; a meeting-confirm or sales-close call is not, so it went to
-- `storeSalesCallAnalysis`, which passed an empty link and wrote NULL into
-- `attempt_table` / `attempt_id` — the very pair added on 2026-09-14 to stop
-- these four personas being orphans for ever.
--
-- The code fix (storeSalesCallAnalysis now resolves the link) only helps rows
-- stored from here on. This repairs the ones already written.
--
-- SCOPE, measured 2026-09-15 before writing this: 22 of 42 rows have a NULL
-- attempt_id. 14 of them match an attempt by el_conversation_id — 10 in
-- callback_request_attempts and 4 in sales_call_attempts. The other 8 match
-- nothing in any of the five tables (4 KALFA-RSVP from 21.07, 2 Sales-Close,
-- 2 customer-service) and are deliberately left alone: there is no attempt row
-- to point at, and inventing one would be worse than an honest orphan.
--
-- `call_attempt_id` is NOT touched. It is a foreign key to `call_attempts`, and
-- every row repaired here belongs to a different table; the polymorphic
-- attempt_table/attempt_id pair is what carries them.
--
-- Idempotent: only rows still NULL are updated, so a re-run is a no-op.

begin;

update public.call_analysis ca
set    attempt_table = 'callback_request_attempts',
       attempt_id    = cra.id,
       linked_at     = coalesce(ca.linked_at, now())
from   public.callback_request_attempts cra
where  ca.attempt_id is null
  and  ca.conversation_id is not null
  and  cra.el_conversation_id = ca.conversation_id;

update public.call_analysis ca
set    attempt_table = 'sales_call_attempts',
       attempt_id    = sca.id,
       linked_at     = coalesce(ca.linked_at, now())
from   public.sales_call_attempts sca
where  ca.attempt_id is null
  and  ca.conversation_id is not null
  and  sca.el_conversation_id = ca.conversation_id;

update public.call_analysis ca
set    attempt_table = 'inbound_agent_attempts',
       attempt_id    = iaa.id,
       linked_at     = coalesce(ca.linked_at, now())
from   public.inbound_agent_attempts iaa
where  ca.attempt_id is null
  and  ca.conversation_id is not null
  and  iaa.el_conversation_id = ca.conversation_id;

update public.call_analysis ca
set    attempt_table = 'voice_purpose_attempts',
       attempt_id    = vpa.id,
       linked_at     = coalesce(ca.linked_at, now())
from   public.voice_purpose_attempts vpa
where  ca.attempt_id is null
  and  ca.conversation_id is not null
  and  vpa.el_conversation_id = ca.conversation_id;

commit;
