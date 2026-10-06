-- (name, language) is unique in Meta only among templates that still exist. A
-- template deleted in Meta and re-created under the same name + language gets a
-- NEW id; with a plain UNIQUE(name, language) the mirror sync's upsert of the
-- new id collides with the old row and the whole batch fails. The sync marks
-- templates Meta no longer returns as status 'DELETED' (template-health-sync.ts);
-- uniqueness is enforced only for the rest. The old rows stay: routes/params
-- reference them with ON DELETE RESTRICT.
alter table public.whatsapp_message_templates
  drop constraint whatsapp_message_templates_name_language_key;

create unique index whatsapp_message_templates_name_language_live_key
  on public.whatsapp_message_templates (name, language)
  where status is distinct from 'DELETED';
