-- Supabase security-definer-view lint (0010): public.console_agents_roster runs
-- as its definer (postgres, rolbypassrls=true) instead of the querying user,
-- because two of its four joined tables (console_agent_secrets,
-- console_agent_calendar_presence) have RLS enabled with zero policies —
-- deny-all even for a legitimate console agent. Moving the view to
-- security_invoker requires those two tables to grant real access to
-- 'authenticated' first, which this migration adds — narrowly:
--
--   console_agent_calendar_presence: no sensitive columns (busy_until,
--   show_as, synced_at, last_error_code) — full-table SELECT is fine.
--
--   console_agent_secrets: holds vox_password (a real credential). Column-
--   level GRANT restricts 'authenticated' to user_id only. The view's SELECT
--   list only ever reads cas.user_id (IS NOT NULL, for the `provisioned`
--   flag) — vox_password/created_at/rotated_at are never read by it, so a
--   direct SELECT vox_password by a console agent must still fail even
--   though the row itself becomes visible via RLS.

create policy console_agent_calendar_presence_select
  on public.console_agent_calendar_presence
  for select
  to authenticated
  using (public.is_console_agent());

grant select on public.console_agent_calendar_presence to authenticated;

create policy console_agent_secrets_select
  on public.console_agent_secrets
  for select
  to authenticated
  using (public.is_console_agent());

grant select (user_id) on public.console_agent_secrets to authenticated;

-- Both underlying tables now grant real (row + column) access to a verified
-- console agent, so the view can run as the QUERYING user instead of its
-- definer — closing the security-definer-view lint without losing function,
-- and without ever exposing vox_password through any path.
alter view public.console_agents_roster set (security_invoker = on);
