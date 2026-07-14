-- Move the Voximplant live-dial gate from an env var to an admin-toggleable DB
-- flag. app_settings has admin-only RLS, so only an administrator can flip it.
-- Additive + dark-safe: default false, so nothing changes until an admin enables
-- it. The env var VOXIMPLANT_LIVE_CALLS is retained as an OPS OVERRIDE only —
-- setting it to 'false' hard-disables live calls regardless of this flag (an
-- emergency kill switch); unset (default) lets this flag govern.
alter table public.app_settings
  add column if not exists voximplant_live_calls boolean not null default false;

comment on column public.app_settings.voximplant_live_calls is
  'Admin toggle: permit REAL outbound Voximplant calls. Effective live gate = (env VOXIMPLANT_LIVE_CALLS <> ''false'') AND this flag AND full config AND per-contact consent. Default false (dark).';
