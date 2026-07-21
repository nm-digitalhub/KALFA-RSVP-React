-- Drop app_settings.voximplant_groq_api_key.
--
-- The column held the API key for the DTMF scenario's ASR→LLM step. That
-- scenario is retired: the dialogue brain is the ElevenLabs agent inside the
-- RSVPAgent bridge, and app_settings.voximplant_rule_id now points at
-- OutCallAgent (1520915) rather than OutCall (1494311).
--
-- Nothing reads it. The column was removed from every consumer first — the ctx
-- endpoint, the dial gate in dispatchOutreachCall, the admin channel DAL, form
-- and action, and getVoximplantGroqKey() itself — all deployed before this runs.
-- Only the generated types still name it, and regenerating clears that.
--
-- Sequenced deliberately last. Dropping the column before deploying would have
-- broken /admin/channels, which still selected it; and the bridge was given a
-- live production call first (session 6899241664, 61s, ElevenLabs QA 100/100,
-- rsvp captured) so the rollback path stayed open until it had proven itself.
--
-- DESTRUCTIVE: this deletes a real credential value. The key itself remains in
-- the Groq console, so restoring the old path means re-adding the column and
-- re-entering the key — not recovering it from here.
--
-- ROLLBACK:
--   alter table public.app_settings add column voximplant_groq_api_key text;
--   -- then re-enter the key via /admin/channels (the value is NOT recoverable
--   -- from this migration).

alter table public.app_settings
  drop column if exists voximplant_groq_api_key;
