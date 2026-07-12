-- Wire the brit post-event thank-you to the FORMATTED personal template.
--
-- The 'thankyou' message_templates row maps each event_type → a Meta template
-- name (components.variants) and a positional-parameter contract
-- (components.param_contract). Brit currently points at the generic, UNFORMATTED
-- kalfa_brit_thankyou_v1 ({{1}}=label, {{2}}=celebrants, contract 'thankyou').
--
-- The owner approved (and live-verified rendering to Mevorach Kalfa) the
-- FORMATTED personal template kalfa_brit_thankyou_trad_v2 (APPROVED / MARKETING),
-- which uses the first-person contract: {{1}}=composed thanks sentence,
-- {{2}}="משפחת <surname>". That contract is built by buildBritTradThankyouParams,
-- routed via the new buildBodyParams case 'brit_trad_thankyou'.
--
-- Data-only jsonb re-point (variant NAME + param contract) for brit ONLY; every
-- other event type is untouched. The row is ALSO activated (active=true, owner-
-- approved) — this enables the post-event thank-you feature for every event type
-- (each still resolves its own approved variant); actual sends stay owner-
-- triggered per campaign (sendThankyouAction, gated status='active' && isPast).
update public.message_templates
set
  components = jsonb_set(
    jsonb_set(
      components,
      '{variants,brit}',
      '"kalfa_brit_thankyou_trad_v2"'::jsonb,
      false
    ),
    '{param_contract,brit}',
    '"brit_trad_thankyou"'::jsonb,
    false
  ),
  active = true,
  updated_at = now()
where message_key = 'thankyou'
  and channel = 'whatsapp';
