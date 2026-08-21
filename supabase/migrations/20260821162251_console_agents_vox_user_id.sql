alter table public.console_agents add column if not exists vox_user_id integer;

comment on column public.console_agents.vox_user_id is
  'Voximplant''s own numeric user id (AddUser result.user_id) — used by DelUser on removal when available, in preference to matching by vox_username.';
