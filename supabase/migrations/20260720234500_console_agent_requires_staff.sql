-- Close the console axis-crossing: a console agent MUST also be platform staff.
--
-- THE HOLE (verified 2026-07-20 from the migrations, no assumptions):
--   `console_agents` is constrained ONLY by
--       primary key (user_id) references auth.users(id) on delete cascade
--   (20260720025656) — there is NOTHING requiring a console agent to be platform
--   staff. `is_console_agent()` gates solely on console_agents membership, and the
--   six console views + their RLS expose every event / campaign / call-analysis with
--   NO ownership filter (a staff-axis pattern — a tenant would see only its own).
--   Net: because the FK points at auth.users, ANY registered user — INCLUDING A
--   TENANT — can be inserted into console_agents, and the moment they are,
--   is_console_agent() returns true and the whole platform's data opens to them.
--
--   That is exactly the staff -> tenant privilege laundering that
--   20260719214054_sever_staff_axis_from_tenant_axis.sql was written to prevent
--   ("staff privilege launders itself into tenant privilege"), re-opened through a
--   back door on a surface added the following day.
--
-- THE FIX: is_console_agent() additionally requires is_staff(). One SECURITY DEFINER
--   function — so all six views AND every RLS policy that already calls it are closed
--   at once, with no per-view / per-policy duplication. is_staff() (20260713171233)
--   is STABLE SECURITY DEFINER and resolves auth.uid() internally, so it composes
--   correctly in both the view and the RLS contexts. is_staff() is evaluated FIRST
--   (a cheap single-row membership probe that short-circuits) before the
--   console_agents existence check.
--
--   This is the OPERATIONAL gate ("are you on the staff console axis at all").
--   Per-action AUTHORITY ("may you issue AI commands") stays OUT of this function --
--   it belongs in the route handler as has_platform_permission('manage_voice'), the
--   same read-vs-write split already used for console_campaign_targets /
--   view_customer_data. Adding a permission here would instead blank the feed for an
--   agent who lacks it -- a regression, not a tightening.
--
-- PRE-APPLY GATE (this IMMEDIATELY removes console access from any non-staff agent):
--   verified at authoring time -> agents = 1, also_staff = 1, would_be_cut_off = 0
--   (no regression). This is a point-in-time fact: RE-VERIFY against the live DB
--   immediately before `db push`. Enrollment (B1c, separate ticket) must ENFORCE that
--   every new console agent is staff so this hole cannot re-open operationally.
--
-- ROLLBACK: restore the prior body
--   ($$ select exists (select 1 from public.console_agents
--                      where user_id = auth.uid()) $$).
-- Grants are preserved by create-or-replace (the anon revoke from 20260720025745
-- stays in force); this migration only changes the function body.

create or replace function public.is_console_agent()
returns boolean language sql stable security definer set search_path = public as
$$ select public.is_staff()
        and exists (select 1 from public.console_agents where user_id = auth.uid()) $$;
