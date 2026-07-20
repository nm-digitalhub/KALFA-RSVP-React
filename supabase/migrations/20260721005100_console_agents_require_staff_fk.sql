-- console_agents: make "a console agent is platform staff" a STRUCTURAL fact.
--
-- WHY THIS EXISTS
-- 20260720234500 made is_console_agent() require is_staff(), which closed the
-- READ hole: a non-staff row in console_agents now grants nothing. It did not,
-- and could not, constrain ENROLMENT. That migration named the gap itself
-- ("Enrollment (B1c, separate ticket) must ENFORCE that every new console agent
-- is staff so this hole cannot re-open operationally"). This is that ticket.
--
-- WHY IT IS A CONSTRAINT AND NOT AN APPLICATION CHECK
-- There is no application write path to console_agents to add a check to --
-- verified by reading the tree, not by sampling: the only occurrences of the
-- table outside supabase/migrations are the generated types in
-- src/lib/supabase/types.ts. No server action, route handler, DAL function,
-- seed, SQL function, or admin UI writes it; the one live row was created
-- out-of-band as postgres/service_role. An enrolment gate in application code
-- would guard a door that does not exist, while the door that IS used -- direct
-- SQL as a privileged role -- stayed open. A constraint binds both.
--
-- WHY A FOREIGN KEY AND NOT A TRIGGER
-- Both patterns exist in this schema (platform_staff itself carries the guard
-- trigger platform_staff_last_owner and the audit trigger platform_staff_audit),
-- so either would be idiomatic. The FK is chosen because it is strictly
-- stronger: a BEFORE INSERT/UPDATE trigger validates at enrolment only and
-- leaves a stale row behind when someone's staff membership is later revoked,
-- whereas `on delete cascade` makes revocation self-healing. It also needs no
-- new function and no new code, and it reuses the exact idiom already present
-- three times in this schema (`references <parent> on delete cascade` on
-- console_agents, platform_staff and organization_members).
--
-- The referenced column is already unique -- platform_staff carries
-- `platform_staff_user_id_key UNIQUE (user_id)` -- so no new index or
-- constraint is needed on the parent side.
--
-- The pre-existing FK to auth.users(id) is deliberately LEFT IN PLACE. This
-- migration is purely additive: it drops nothing. The two are consistent
-- (platform_staff.user_id is itself an FK to auth.users on delete cascade), and
-- deleting an auth user still cascades along both paths.
--
-- VERIFIED LIVE in a rolled-back transaction before applying, all four cases:
--   1. the constraint validates against existing data as it stands (no
--      pre-existing row violates it -- the single console agent is staff);
--   2. enrolling a non-staff auth user is refused with 23503 foreign_key_violation
--      (before this migration the same insert SUCCEEDED -- the hole was real,
--      not theoretical);
--   3. enrolling a genuine staff member still succeeds; and
--   4. deleting that member's platform_staff row cascades their console_agents
--      row away, leaving 0 -- revocation is self-healing.
-- Re-verify `select count(*) from console_agents c where not exists
--   (select 1 from platform_staff s where s.user_id = c.user_id)` is 0
-- immediately before applying; a non-zero count makes this migration fail.
--
-- LOCK NOTE: ADD FOREIGN KEY takes SHARE ROW EXCLUSIVE on both tables. Both are
-- single-digit-row tables here, so the validation scan is instantaneous.
--
-- ROLLBACK:
--   alter table public.console_agents drop constraint console_agents_staff_fkey;

alter table public.console_agents
  add constraint console_agents_staff_fkey
  foreign key (user_id) references public.platform_staff(user_id) on delete cascade;

comment on constraint console_agents_staff_fkey on public.console_agents is
  'A console agent must be platform staff. Structural half of the axis-crossing fix begun in 20260720234500 (which closed the read side via is_console_agent -> is_staff). ON DELETE CASCADE makes revoking staff membership automatically un-enrol the agent.';
