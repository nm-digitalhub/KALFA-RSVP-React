-- Enable the WhatsApp RSVP quick-reply buttons for EVERY event type, not just brit.
--
-- THE BUG. message_templates.components.rsvp_quick_reply is a per-event-type map
-- read by rsvpQuickReplyFlag() (src/lib/data/message-templates-resolve.ts). When
-- it is true, the send injects the rsvp_* payloads (RSVP_QUICK_REPLY_PAYLOADS)
-- as the template's quick-reply button parameters, and a tap comes back as
-- button.payload = 'rsvp_attending' | 'rsvp_declined' | 'rsvp_maybe', which
-- RSVP_BUTTON_MAP turns into a guest status. When it is false, Meta stores NO
-- payload on a template QUICK_REPLY button, so the tap echoes the Hebrew LABEL
-- ("מגיע/ה") instead — the inbound map misses, and the guest stays 'pending'
-- while believing they answered.
--
-- All four button-bearing rows currently read {"brit": true}, so on a wedding /
-- bar mitzvah / bat mitzvah / britah / henna / engagement / birthday / other,
-- EVERY RSVP tap is silently discarded, across all four touchpoints.
--
-- REPRODUCED LIVE 2026-09-08 22:34 and 22:37: the invite was sent through the
-- production path to a guest on the active wedding campaign, from both business
-- numbers; both were delivered and read; the guest tapped "מגיע/ה" both times;
-- the inbound webhooks carry button.payload = "מגיע/ה" (the label, not a code)
-- and the guest row stayed status='pending'.
--
-- WHY IT IS SAFE TO ENABLE NOW. The flag was scoped to brit because only that
-- variant's approved Meta layout had been verified to carry the 3 buttons —
-- injecting payloads for a layout without them is rejected by Meta. That
-- verification is now done for all of them. MEASURED 2026-09-08 against
-- GET /{waba}/message_templates?fields=components on WABA 990921550130385:
--   kalfa_event_invite_v2         APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
--   kalfa_event_invite_media_v1   APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
--   kalfa_event_reminder_v1       APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
--   kalfa_event_reminder2_v1      APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
--   kalfa_event_final_v1          APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
--   kalfa_brit_invite_trad_v4     APPROVED  QUICK_REPLY מגיע/ה · לא מגיע/ה · אולי
-- Identical buttons, identical order, matching RSVP_QUICK_REPLY index 0..2
-- (attending / declined / maybe). No template is re-submitted by this migration
-- and no template content changes — only the admin flag that decides whether
-- KALFA attaches its own payloads at send time.
--
-- SCOPE. Exactly the four rows whose approved layout carries buttons. The rows
-- without buttons (gift, thankyou, event_day_pay, sales_signup_link) are left
-- untouched: enabling the flag there would attach payloads to buttons that do
-- not exist and Meta would reject the send.
--
-- SHAPE. jsonb_set on the single 'rsvp_quick_reply' key, so every sibling key in
-- components (variants, media_variants, media_variant, param_contract) survives
-- untouched. Idempotent: re-running writes the same object.

update public.message_templates
set components = jsonb_set(
  coalesce(components, '{}'::jsonb),
  '{rsvp_quick_reply}',
  jsonb_build_object(
    'wedding',     true,
    'bar_mitzvah', true,
    'bat_mitzvah', true,
    'brit',        true,
    'britah',      true,
    'henna',       true,
    'engagement',  true,
    'birthday',    true,
    'other',       true
  ),
  true
)
where message_key in ('invite', 'reminder_1', 'reminder_2', 'final');

-- Fail loudly if the four rows were not all updated (a renamed message_key would
-- otherwise leave the bug in place silently).
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.message_templates
  where message_key in ('invite', 'reminder_1', 'reminder_2', 'final')
    and components -> 'rsvp_quick_reply' ->> 'wedding' = 'true';
  if n <> 4 then
    raise exception 'rsvp_quick_reply not enabled on all 4 button-bearing templates (got %)', n;
  end if;
end $$;

-- ROLLBACK (restores the pre-migration brit-only behaviour exactly):
--   update public.message_templates
--   set components = jsonb_set(components, '{rsvp_quick_reply}', '{"brit": true}'::jsonb)
--   where message_key in ('invite', 'reminder_1', 'reminder_2', 'final');
