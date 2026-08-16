-- Provenance and de-duplication for contact_messages.
--
-- WHY THIS IS NOT OPTIONAL FOR MAIL INTAKE
--
-- Microsoft Graph redelivers change notifications by design. webhook_inbox's
-- unique (provider, dedupe_key) protects the WEBHOOK leg, but not the
-- contact_messages INSERT the worker performs afterwards — a replayed or
-- manually re-processed inbox row would create a second inquiry, which becomes
-- a second draft, which a human can approve into a second reply to the same
-- customer. The unique index below is what makes that impossible at the only
-- layer that can guarantee it.
--
-- `source` also gives the admin surface something it never had: the ability to
-- tell a contact-form inquiry from an emailed one. Until now 'contact_form' was
-- a literal in the Slack alert (src/lib/data/inquiries.ts) and lived nowhere in
-- the row itself.

alter table public.contact_messages
  add column if not exists source text not null default 'contact_form',
  -- The RFC 5322 Message-ID for mail, NULL for the web form. Deliberately not
  -- Graph's item id: that is mailbox-scoped and CHANGES when the item moves
  -- between folders, so it would let a filed message re-enter as new.
  add column if not exists source_message_id text;

-- Partial: only rows that actually carry an external id participate. Web-form
-- rows all have NULL here and must not collide with each other.
create unique index if not exists contact_messages_source_message_uidx
  on public.contact_messages (source, source_message_id)
  where source_message_id is not null;

comment on column public.contact_messages.source is
  'Where the inquiry entered from: contact_form (web) | outlook (mailbox intake).';
comment on column public.contact_messages.source_message_id is
  'Stable external id for de-duplication. RFC 5322 Message-ID for outlook; NULL for contact_form.';
