-- WhatsApp templates: a table whose columns ARE Meta's message-template keys
-- (docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md, step 1).
--
-- EXPAND ONLY. Nothing existing is renamed, dropped or changed; every current
-- reader of message_templates keeps working untouched.
--
-- Column names = the keys GET /<WABA>/message_templates returns (Graph API
-- reference "WhatsApp Message Template"; live read 2026-09-30, 80 templates),
-- so each column is documented by Meta's own reference. synced_at is the only
-- non-Meta column. Enumerated values stay text (no enum/CHECK): a value Meta
-- adds tomorrow must not break the sync.

create table public.whatsapp_message_templates (
  id text primary key,                          -- Meta: id
  name text not null,                           -- Meta: name
  language text not null,                       -- Meta: language
  status text,                                  -- Meta: status
  category text,                                -- Meta: category
  sub_category text,                            -- Meta: sub_category
  components jsonb,                             -- Meta: components (HEADER/BODY/FOOTER/BUTTONS)
  parameter_format text,                        -- Meta: parameter_format
  quality_score jsonb,                          -- Meta: quality_score ({score, date})
  rejected_reason text,                         -- Meta: rejected_reason
  correct_category text,                        -- Meta: correct_category
  previous_category text,                       -- Meta: previous_category
  message_send_ttl_seconds integer,             -- Meta: message_send_ttl_seconds
  library_template_name text,                   -- Meta: library_template_name
  disable_ios_autofill boolean,                 -- Meta: disable_ios_autofill
  is_primary_device_delivery_only boolean,      -- Meta: is_primary_device_delivery_only
  synced_at timestamptz not null default now(), -- KALFA: last written by the sync
  constraint whatsapp_message_templates_name_language_key unique (name, language)
);

alter table public.whatsapp_message_templates enable row level security;
-- New tables here are granted to anon/authenticated by the project's default
-- privileges (pg_default_acl, measured 2026-09-30) — revoke explicitly. Read and
-- written only server-side (service role).
revoke all on table public.whatsapp_message_templates from public, anon, authenticated;

comment on table public.whatsapp_message_templates is
  'Mirror of Meta WhatsApp message templates (GET /<WABA>/message_templates). Column names are Meta''s keys. Written only by the template sync.';

-- KALFA step config → the Meta template it sends. Nullable until the step-3
-- backfill; ON DELETE RESTRICT so a sync can never silently orphan a live step.
alter table public.message_templates
  add column whatsapp_template_id text
    references public.whatsapp_message_templates (id) on delete restrict;
create index message_templates_whatsapp_template_id_idx
  on public.message_templates (whatsapp_template_id);

-- KALFA's own send config (variants / param_contract) under a name that cannot
-- be confused with Meta's `components`. A COPY: `components` stays, and every
-- current reader keeps reading it until step 4; it is dropped only at step 5.
alter table public.message_templates add column kalfa_send_config jsonb;
update public.message_templates set kalfa_send_config = components where components is not null;
