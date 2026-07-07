-- Data-driven, EVENT-TYPE-SCOPED RSVP quick-reply flag on
-- message_templates.components.rsvp_quick_reply — a per-event-type map
-- (mirrors components.variants), e.g. {"brit": true}.
--
-- The OUTBOUND send injects the rsvp_* button payloads (client.ts via
-- sendOneWhatsApp) ONLY for a (message_key, event_type) whose flag is true, so a
-- tap returns button.payload='rsvp_*' instead of the Hebrew LABEL (which the
-- inbound RSVP_BUTTON_MAP would miss). Scoped to event_type ON PURPOSE:
--
--   * Enable ONLY 'brit' — the ONLY event type whose resolved templates were
--     VERIFIED at Meta (2026-07-07) to carry the 3 QUICK_REPLY buttons: the brit
--     invite variant (kalfa_brit_invite_trad_v1 / _media) AND the generic
--     reminder/final that brit falls back to (kalfa_event_reminder_v1 /
--     reminder2_v1 / final_v1).
--   * A NON-verified variant (e.g. a wedding-family template) never injects
--     payloads Meta could reject (132000) — its event type is simply absent here.
--
-- NOT global-by-message_key (would hit every event type), NOT applied to gift
-- (URL button, not RSVP) or call (not WhatsApp). To extend to another event type,
-- verify its variants at Meta then add "<event_type>": true.
--
-- Merges into the existing components jsonb (preserves variants / media_variants).
update public.message_templates
   set components = coalesce(components, '{}'::jsonb)
                    || jsonb_build_object('rsvp_quick_reply', jsonb_build_object('brit', true))
 where channel = 'whatsapp'
   and message_key in ('invite', 'reminder_1', 'reminder_2', 'final');
