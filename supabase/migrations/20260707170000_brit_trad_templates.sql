-- Register the personal (first-person) brit WhatsApp templates on the outreach
-- message_keys. DATA-only: message_templates.components is admin-managed jsonb
-- that the /admin/templates UI cannot edit (updateMessageTemplate ignores it),
-- so this migration is the writable path.
--
-- Per-key nested DEEP MERGE (coalesce(existing,'{}') || new) — NOT a top-level
-- `components || {...}`, which would REPLACE the whole `variants` object and drop
-- the existing wedding variant. Each of variants / media_variants / param_contract
-- keeps its other event-type entries; rsvp_quick_reply (already {"brit":true} on
-- these keys) and any other top-level keys are left untouched.
--
-- Contracts (src/lib/whatsapp/template-spec.ts buildBodyParams):
--   brit_trad_invite   → 7 slots: {{1}} first-person opening, {{2}} weekday,
--                        {{3}} Hebrew date, {{4}} Gregorian, {{5}} time,
--                        {{6}} venue, {{7}} first-person closing.
--   brit_trad_reminder → 6 slots: {{1}} first-person reminder line, {{2}}–{{6}}.
-- Media variants activate only when the event has an uploaded invite_image_path;
-- otherwise the text template is used (resolveTemplateMedia).
--
-- Must run AFTER 20260707160000 (rsvp_quick_reply flag). The thankyou template is
-- intentionally NOT registered here: the drip engine rejects post-event
-- touchpoints, so its send path is deferred to a dedicated trigger.

begin;

-- invite → personal brit invite v4 (+ media v4).
update public.message_templates
set components =
  coalesce(components, '{}'::jsonb)
  || jsonb_build_object(
       'variants',
         coalesce(components -> 'variants', '{}'::jsonb)
           || jsonb_build_object('brit', 'kalfa_brit_invite_trad_v4'),
       'media_variants',
         coalesce(components -> 'media_variants', '{}'::jsonb)
           || jsonb_build_object('brit', 'kalfa_brit_invite_trad_media_v4'),
       'param_contract',
         coalesce(components -> 'param_contract', '{}'::jsonb)
           || jsonb_build_object('brit', 'brit_trad_invite')
     )
where message_key = 'invite' and channel = 'whatsapp';

-- reminder_1 + reminder_2 → personal brit reminder v1 (+ media v1).
update public.message_templates
set components =
  coalesce(components, '{}'::jsonb)
  || jsonb_build_object(
       'variants',
         coalesce(components -> 'variants', '{}'::jsonb)
           || jsonb_build_object('brit', 'kalfa_brit_reminder_trad_v1'),
       'media_variants',
         coalesce(components -> 'media_variants', '{}'::jsonb)
           || jsonb_build_object('brit', 'kalfa_brit_reminder_trad_media_v1'),
       'param_contract',
         coalesce(components -> 'param_contract', '{}'::jsonb)
           || jsonb_build_object('brit', 'brit_trad_reminder')
     )
where message_key in ('reminder_1', 'reminder_2') and channel = 'whatsapp';

commit;
