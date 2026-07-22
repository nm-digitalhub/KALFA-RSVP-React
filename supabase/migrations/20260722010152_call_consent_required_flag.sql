-- call_consent_required — admin switch for the AI-call consent gate.
--
-- hasCallConsent() (src/lib/data/outreach-engine.ts) is the ONLY enforcement
-- point that blocks an AI dial when a contact has no recorded prior consent
-- (call_consent_at). This flag lets an admin lift that requirement at runtime
-- from the channels UI, instead of the requirement being hardcoded.
--
-- DEFAULT true = SAFE: consent is required unless an admin deliberately turns it
-- off. Turning it OFF places AI calls to contacts who did not give explicit prior
-- consent, which carries Israeli spam-law (סעיף 30א) exposure — a legal decision
-- surfaced with a warning at the toggle, NOT a technical default. opt-out
-- (contacts.removal_requested), the DNC list, and fail-closed reads are NOT
-- affected by this flag; they always apply.
alter table public.app_settings
  add column if not exists call_consent_required boolean not null default true;

comment on column public.app_settings.call_consent_required is
  'When true (default, SAFE), AI calls require a recorded contacts.call_consent_at. An admin may set false to dial without prior consent (spam-law exposure — surfaced with a legal warning in the channels UI). opt-out + DNC + fail-closed always apply regardless.';
