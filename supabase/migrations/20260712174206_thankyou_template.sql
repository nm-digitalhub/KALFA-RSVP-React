-- Feature 2: post-event thank-you WhatsApp message. Seeds the message_key row
-- (active=false → INERT until the 9 Meta templates are approved and an admin
-- flips active=true) and wires per-event-type variant names + param_contract=
-- 'thankyou' (else buildBodyParams falls back to the generic 7-tuple, which
-- this message does NOT satisfy — no venue/date positions). Mirrors
-- 20260712124239_event_day_pay_template.sql. Forward-only; idempotent.

insert into public.message_templates (message_key, channel, label, name, language)
values ('thankyou', 'whatsapp', 'תודה פוסט-אירוע', 'kalfa_event_thankyou_v1', 'he')
on conflict (message_key) do nothing;

update public.message_templates
set components = coalesce(components, '{}'::jsonb)
  || jsonb_build_object(
       'variants',
       coalesce(components->'variants', '{}'::jsonb) || jsonb_build_object(
         'wedding',     'kalfa_wedding_thankyou_v1',
         'brit',        'kalfa_brit_thankyou_v1',
         'bar_mitzvah', 'kalfa_barmitzvah_thankyou_v1',
         'bat_mitzvah', 'kalfa_batmitzvah_thankyou_v1',
         'britah',      'kalfa_britah_thankyou_v1',
         'henna',       'kalfa_henna_thankyou_v1',
         'engagement',  'kalfa_engagement_thankyou_v1',
         'birthday',    'kalfa_birthday_thankyou_v1',
         'other',       'kalfa_event_thankyou_v1'),
       'param_contract',
       coalesce(components->'param_contract', '{}'::jsonb) || jsonb_build_object(
         'wedding','thankyou','brit','thankyou','bar_mitzvah','thankyou',
         'bat_mitzvah','thankyou','britah','thankyou','henna','thankyou',
         'engagement','thankyou','birthday','thankyou','other','thankyou'))
where message_key = 'thankyou' and channel = 'whatsapp';
