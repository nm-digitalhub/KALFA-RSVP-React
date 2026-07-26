-- support-drafter activation prerequisite: cap draft_reply length at the DB
-- level — defense-in-depth on top of the 4000-char limit the `draft-reply` CLI
-- verb already enforces in app code (scripts/fleet-agent-cli.ts, DRAFT_REPLY_MAX).
--
-- Additive + safe: every draft_reply is currently NULL (no drafts written yet),
-- so no existing row can violate the constraint.
alter table public.contact_messages
  add constraint contact_messages_draft_reply_len
  check (draft_reply is null or char_length(draft_reply) <= 4000);
