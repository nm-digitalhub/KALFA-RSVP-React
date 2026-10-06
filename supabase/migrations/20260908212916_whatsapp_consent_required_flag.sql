-- whatsapp_consent_required — admin switch for the WhatsApp consent gate.
--
-- The exact twin of call_consent_required (20260722010152), for the other
-- outreach channel. Same shape, same default, same reasoning — deliberately
-- mirrored rather than reinvented so the two channels cannot drift.
--
-- WHY IT IS NEEDED. Three independent places refuse a WhatsApp send when the
-- contact has no recorded contacts.whatsapp_consent_at:
--   1. resolveSendableContacts (sendable-contacts.ts) filters them out of the
--      recipient query entirely — they never enter the send list.
--   2. prepareAndSendStep (outreach-engine.ts) re-checks per contact.
--   3. terminalReasonFor returns 'no_whatsapp_consent', which TERMINATES the
--      step rather than retrying it.
-- Nothing in the application writes that column: recordWhatsAppConsent exists
-- and works, but has zero callers (verified 2026-09-09). The only consent in
-- the database — 38 contacts on the July brit event — was written by a single
-- bulk statement, all 38 carrying the identical timestamp 2026-07-07 11:19:15.
-- So in practice the gate is lifted by hand before each campaign, or the
-- campaign silently sends nothing. This flag makes that an explicit, audited,
-- reversible decision instead of an undocumented manual UPDATE.
--
-- DEFAULT true = SAFE: consent stays required unless an admin deliberately
-- turns it off. Turning it OFF sends WhatsApp templates to contacts with no
-- recorded consent, which carries Israeli spam-law (סעיף 30א) exposure — a
-- legal decision surfaced with a warning at the toggle, NOT a technical
-- default. What this flag does NOT affect, ever:
--   • contacts.removal_requested (opt-out) — always blocks.
--   • The frozen campaign_authorized_contacts set — always bounds the send.
--   • Fail-closed reads — a read error still reads as "required".
alter table public.app_settings
  add column if not exists whatsapp_consent_required boolean not null default true;

comment on column public.app_settings.whatsapp_consent_required is
  'When true (default, SAFE), a WhatsApp send requires a recorded contacts.whatsapp_consent_at. An admin may set false to send without prior consent (spam-law exposure — surfaced with a legal warning in the channels UI). opt-out, the frozen authorized set, and fail-closed reads always apply regardless. Twin of call_consent_required.';

-- ROLLBACK:
--   alter table public.app_settings drop column if exists whatsapp_consent_required;
-- Dropping restores the pre-migration behaviour exactly, because every reader
-- treats "anything but an explicit false" as required.
