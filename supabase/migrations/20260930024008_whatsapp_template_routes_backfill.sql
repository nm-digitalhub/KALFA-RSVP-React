-- WhatsApp templates, step 5 (docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md):
-- fill the routing / parameter / settings tables FROM today's data, so the new
-- model describes exactly what is sent today. Nothing reads these tables yet
-- (sending is unchanged until the cutover, step 7).
--
-- Sources, all live:
--   message_templates.name / language      → each step's default route
--   message_templates.components            → variants, media_variant(s), param_contract
--   whatsapp_message_templates (the mirror) → the Meta template id per (name, language)
--   PARAM_CONTRACT_PATHS (template-spec.ts) → the body variables of each layout
--     (VALUES below are GENERATED from that constant, not hand-typed)
--
-- Fails the whole migration (nothing written) if a referenced template is
-- missing from the mirror, or if any template's variables disagree with its
-- body/header text in Meta.

do $$
begin
  if exists (select 1 from public.message_template_routes)
     or exists (select 1 from public.whatsapp_template_parameters)
     or exists (select 1 from public.whatsapp_template_settings) then
    raise exception 'step-5 backfill expects empty target tables';
  end if;
end $$;

create temporary table step_routes as
with steps as (
  select message_key, name, language, components as c
  from public.message_templates
  where channel = 'whatsapp' and name <> ''
)
select message_key, null::text as event_type, false as with_media, name as tname, language,
       null::text as pc
from steps
union all
select s.message_key, v.key, false, v.value #>> '{}', s.language, s.c -> 'param_contract' ->> v.key
from steps s, jsonb_each(coalesce(s.c -> 'variants', '{}'::jsonb)) v
union all
select s.message_key, null, true, s.c ->> 'media_variant', s.language, null
from steps s where s.c ? 'media_variant'
union all
select s.message_key, m.key, true, m.value #>> '{}', s.language, s.c -> 'param_contract' ->> m.key
from steps s, jsonb_each(coalesce(s.c -> 'media_variants', '{}'::jsonb)) m;

create temporary table resolved_routes as
select r.*, w.id as template_id
from step_routes r
left join public.whatsapp_message_templates w
  on w.name = r.tname and w.language = r.language and w.status is distinct from 'DELETED';

do $$
declare missing_names text;
begin
  select string_agg(distinct tname, ', ') into missing_names from resolved_routes where template_id is null;
  if missing_names is not null then
    raise exception 'templates missing from the Meta mirror: %', missing_names;
  end if;
end $$;

-- 1. Routes.
insert into public.message_template_routes (message_key, event_type, with_media, whatsapp_template_id)
select message_key, event_type::public.event_type, with_media, template_id from resolved_routes;

-- 2. One layout per Meta template. The contract is a property of the template
--    (what {1} means is set by its text), so a route's param_contract wins;
--    otherwise the send path's own rules: gift → gift, sales_signup_link → its
--    own layout, a kalfa_wedding_* name → wedding, else generic.
create temporary table template_layout as
select distinct on (template_id)
  template_id,
  coalesce(
    pc,
    case
      when message_key = 'gift' then 'gift'
      when message_key = 'sales_signup_link' then 'sales_signup_link'
      when tname like 'kalfa\_wedding\_%' then 'wedding'
      else 'generic'
    end
  ) as layout
from resolved_routes
order by template_id, (pc is null);

create temporary table layout_paths (layout text, type text, sub_type text, index int, position int, source_path text);
insert into layout_paths values
  ('generic', 'body', null, null, 1, 'guest.greeting_name'),
  ('generic', 'body', null, null, 2, 'event.type_label'),
  ('generic', 'body', null, null, 3, 'event.celebrants_text'),
  ('generic', 'body', null, null, 4, 'event.weekday'),
  ('generic', 'body', null, null, 5, 'event.date_hebrew_and_gregorian'),
  ('generic', 'body', null, null, 6, 'event.time'),
  ('generic', 'body', null, null, 7, 'event.venue'),
  ('wedding', 'body', null, null, 1, 'guest.greeting_name'),
  ('wedding', 'body', null, null, 2, 'event.groom'),
  ('wedding', 'body', null, null, 3, 'event.bride'),
  ('wedding', 'body', null, null, 4, 'event.weekday'),
  ('wedding', 'body', null, null, 5, 'event.date_hebrew_and_gregorian'),
  ('wedding', 'body', null, null, 6, 'event.time'),
  ('wedding', 'body', null, null, 7, 'event.venue'),
  ('gift', 'body', null, null, 1, 'guest.greeting_name'),
  ('gift', 'body', null, null, 2, 'event.type_label'),
  ('gift', 'body', null, null, 3, 'event.celebrants_text'),
  ('gift', 'body', null, null, 4, 'event.gift_payment_url'),
  ('thankyou', 'body', null, null, 1, 'event.type_label'),
  ('thankyou', 'body', null, null, 2, 'event.celebrants_text'),
  ('event_day_pay', 'body', null, null, 1, 'event.time'),
  ('event_day_pay', 'body', null, null, 2, 'event.venue'),
  ('brit_trad_invite', 'body', null, null, 1, 'brit.invite_line'),
  ('brit_trad_invite', 'body', null, null, 2, 'event.weekday'),
  ('brit_trad_invite', 'body', null, null, 3, 'event.date_hebrew'),
  ('brit_trad_invite', 'body', null, null, 4, 'event.date_gregorian'),
  ('brit_trad_invite', 'body', null, null, 5, 'event.time'),
  ('brit_trad_invite', 'body', null, null, 6, 'event.venue'),
  ('brit_trad_invite', 'body', null, null, 7, 'brit.closing'),
  ('brit_trad_reminder', 'body', null, null, 1, 'brit.reminder_line'),
  ('brit_trad_reminder', 'body', null, null, 2, 'event.weekday'),
  ('brit_trad_reminder', 'body', null, null, 3, 'event.date_hebrew'),
  ('brit_trad_reminder', 'body', null, null, 4, 'event.date_gregorian'),
  ('brit_trad_reminder', 'body', null, null, 5, 'event.time'),
  ('brit_trad_reminder', 'body', null, null, 6, 'event.venue'),
  ('brit_trad_thankyou', 'body', null, null, 1, 'brit.thanks_line'),
  ('brit_trad_thankyou', 'body', null, null, 2, 'brit.family_signature'),
  ('sales_signup_link', 'body', null, null, 1, 'lead.full_name');

insert into public.whatsapp_template_parameters (whatsapp_template_id, type, sub_type, index, position, source_path)
select t.template_id, p.type, p.sub_type, p.index, p.position, p.source_path
from template_layout t join layout_paths p on p.layout = t.layout;

-- URL-button suffix: the gift / event-day templates carry the event's gift
-- token, the sales template the attempt reference (today's send paths:
-- outreach.ts urlButtonParam, signup-link route urlButtonParam).
insert into public.whatsapp_template_parameters (whatsapp_template_id, type, sub_type, index, position, source_path)
select distinct r.template_id, 'button', 'url', 0, 1,
  case when r.message_key = 'sales_signup_link' then 'lead.signup_ref' else 'event.gift_link_token' end
from resolved_routes r
where r.message_key in ('gift', 'event_day_pay', 'sales_signup_link');

-- IMAGE header of the media siblings: the event's invite image (today:
-- resolveTemplateMedia, outreach.ts).
insert into public.whatsapp_template_parameters (whatsapp_template_id, type, sub_type, index, position, source_path)
select distinct template_id, 'header', null::text, null::int, 1, 'event.invite_image'
from resolved_routes where with_media;

-- 3. The category each template was requested under = its step's.
insert into public.whatsapp_template_settings (whatsapp_template_id, requested_category)
select distinct on (r.template_id) r.template_id, m.requested_category
from resolved_routes r join public.message_templates m using (message_key)
order by r.template_id, m.message_key;

-- 4. Proof against Meta's own text: every routed template's body/header
--    variables = its {{n}} placeholders, and a URL button with {{1}}
--    exactly when a button parameter exists.
do $$
declare bad text;
begin
  with meta as (
    select w.id,
      (select count(distinct m[1]) from jsonb_array_elements(w.components) c,
         regexp_matches(coalesce(c ->> 'text', ''), '\{\{(\d+)\}\}', 'g') m
       where c ->> 'type' in ('BODY', 'HEADER')) as n_text_vars,
      exists (select 1 from jsonb_array_elements(w.components) c,
                jsonb_array_elements(coalesce(c -> 'buttons', '[]'::jsonb)) b
              where c ->> 'type' = 'BUTTONS' and b ->> 'type' = 'URL'
                and (b ->> 'url') like '%{{1}}%') as has_url_var
    from public.whatsapp_message_templates w
    where w.id in (select template_id from resolved_routes)
  ), ours as (
    select whatsapp_template_id as id,
      count(*) filter (where type = 'body') as n_body,
      bool_or(type = 'button') as has_button
    from public.whatsapp_template_parameters group by 1
  )
  select string_agg(w.name, ', ') into bad
  from meta join ours using (id) join public.whatsapp_message_templates w using (id)
  where meta.n_text_vars <> ours.n_body or meta.has_url_var <> coalesce(ours.has_button, false);
  if bad is not null then
    raise exception 'parameter rows disagree with the Meta template text: %', bad;
  end if;
end $$;

drop table step_routes, resolved_routes, template_layout, layout_paths;
