-- Workstream B: event-day WhatsApp reminder to CONFIRMED guests + Bit payment.
-- Seeds the message_key row (active=false → INERT until the 9 Meta templates are
-- approved and an admin flips active=true) and wires per-event-type variant names
-- + param_contract='event_day_pay' (else buildBodyParams falls back to the generic
-- 7-tuple). The Bit link reuses events.gift_payment_url/gift_link_token + /g/[token].
-- Forward-only; idempotent.

insert into public.message_templates (message_key, channel, label, name, language)
values ('event_day_pay', 'whatsapp', 'תזכורת יום האירוע + תשלום ביט', 'kalfa_event_dayofpay_v1', 'he')
on conflict (message_key) do nothing;

update public.message_templates
set components = coalesce(components, '{}'::jsonb)
  || jsonb_build_object(
       'variants',
       coalesce(components->'variants', '{}'::jsonb) || jsonb_build_object(
         'wedding',     'kalfa_wedding_dayofpay_v1',
         'brit',        'kalfa_brit_dayofpay_v1',
         'bar_mitzvah', 'kalfa_barmitzvah_dayofpay_v1',
         'bat_mitzvah', 'kalfa_batmitzvah_dayofpay_v1',
         'britah',      'kalfa_britah_dayofpay_v1',
         'henna',       'kalfa_henna_dayofpay_v1',
         'engagement',  'kalfa_engagement_dayofpay_v1',
         'birthday',    'kalfa_birthday_dayofpay_v1',
         'other',       'kalfa_event_dayofpay_v1'),
       'param_contract',
       coalesce(components->'param_contract', '{}'::jsonb) || jsonb_build_object(
         'wedding','event_day_pay','brit','event_day_pay','bar_mitzvah','event_day_pay',
         'bat_mitzvah','event_day_pay','britah','event_day_pay','henna','event_day_pay',
         'engagement','event_day_pay','birthday','event_day_pay','other','event_day_pay'))
where message_key = 'event_day_pay' and channel = 'whatsapp';
