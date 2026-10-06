-- WhatsApp templates, step 3 (docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md).
--
-- Three KALFA tables around the Meta mirror (whatsapp_message_templates). All
-- EMPTY after this migration and read by no code yet: sending is unchanged
-- until the backfill (step 5), the equivalence gate (step 6) and the cutover
-- (step 7).
--
-- Enumerated values stay text (no CHECK), like the mirror: they describe parts
-- of Meta's template/send payload, and a value Meta adds must not need a
-- migration.

-- 1. Which Meta template a step sends: per event type, with or without the
--    image header. event_type NULL = the step's default. Resolution order is a
--    code rule (event type+media → default+media → event type → default).
--    Several steps may point to the same template (reminder_1/reminder_2 brit).
create table public.message_template_routes (
  id uuid primary key default gen_random_uuid(),
  message_key text not null
    references public.message_templates (message_key) on update cascade on delete cascade,
  event_type public.event_type,
  with_media boolean not null default false,
  whatsapp_template_id text not null
    references public.whatsapp_message_templates (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_template_routes_key unique nulls not distinct (message_key, event_type, with_media)
);
create index message_template_routes_template_idx
  on public.message_template_routes (whatsapp_template_id);
create trigger set_message_template_routes_updated_at
  before update on public.message_template_routes
  for each row execute function public.set_updated_at();

-- 2. What fills each variable of a Meta template, per TEMPLATE (what {{1}}
--    means is set by that template's text, not by the step). Column names are
--    the keys of Meta's send payload: component `type` (header/body/button),
--    button `sub_type` (url) + `index`, and the parameter's `position` ({{n}},
--    POSITIONAL) or `parameter_name` (NAMED). source_path = a path in the send
--    context the engine builds (e.g. guest.first_name).
create table public.whatsapp_template_parameters (
  id uuid primary key default gen_random_uuid(),
  whatsapp_template_id text not null
    references public.whatsapp_message_templates (id) on delete cascade,
  type text not null,
  sub_type text,
  index integer,
  position integer,
  parameter_name text,
  source_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_template_parameters_addressed
    check (position is not null or parameter_name is not null),
  constraint whatsapp_template_parameters_key
    unique nulls not distinct (whatsapp_template_id, type, index, position, parameter_name)
);
create trigger set_whatsapp_template_parameters_updated_at
  before update on public.whatsapp_template_parameters
  for each row execute function public.set_updated_at();

-- 3. KALFA settings per Meta template. requested_category moves here from the
--    step so the category-downgrade alert covers every routed template
--    (event-type and media variants), not only a step's base template.
create table public.whatsapp_template_settings (
  whatsapp_template_id text primary key
    references public.whatsapp_message_templates (id) on delete cascade,
  requested_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_whatsapp_template_settings_updated_at
  before update on public.whatsapp_template_settings
  for each row execute function public.set_updated_at();

-- Server-only, like the mirror. New tables here are granted to anon /
-- authenticated by the project's default privileges (measured 2026-09-30).
alter table public.message_template_routes enable row level security;
alter table public.whatsapp_template_parameters enable row level security;
alter table public.whatsapp_template_settings enable row level security;
revoke all on table public.message_template_routes from public, anon, authenticated;
revoke all on table public.whatsapp_template_parameters from public, anon, authenticated;
revoke all on table public.whatsapp_template_settings from public, anon, authenticated;

-- 4. Step 1's single-template column and its config copy are the wrong model
--    (a step sends many templates). Both have no reader and no writer
--    (grep of src/worker/scripts, 2026-09-30); whatsapp_template_id is NULL in
--    every row. `components` itself stays until the step-9 cleanup.
drop index if exists public.message_templates_whatsapp_template_id_idx;
alter table public.message_templates
  drop column whatsapp_template_id,
  drop column kalfa_send_config;
