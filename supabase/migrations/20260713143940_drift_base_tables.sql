-- HISTORICAL BASE MIGRATION — repairs schema drift for BOTH drift tables (the full live inventory of 12.10.2026:
-- 125 public tables, 124 created by migrations, exactly two created directly in production — callback_requests and
-- contact_messages — plus one manually-created policy (guest_groups.gg_admin_all) and one manually-created
-- trigger (guests.trg_guests_updated). The version number 20260713143940 deliberately places it ONE TICK BEFORE 20260713143941, the
-- first migration that touches either table.
--
-- WHY: callback_requests was created directly in production (dashboard SQL, July 2026) and no migration file creates
-- it, so every from-scratch replay (shadow DB of `db pull`, local `db reset`, disaster recovery) dies at
-- 20260713143941's `ALTER POLICY cb_admin_all ON public.callback_requests` with SQLSTATE 42P01. Measured 12.10.2026.
--
-- WHAT THIS CONTAINS: the table's state as it was before 13.07.2026 — the 8 base columns (every later column maps
-- exactly to a later migration; see the dossier in the session of 12.10), RLS, the original cb_admin_all (its full
-- text is preserved in 20260720030121's rollback comments, which also DROPS it — as happened in production), and the
-- cb_set_updated_at trigger (live-verified name). cb_insert_anyone is deliberately NOT created: 20260713143941 only
-- SKIPs it and it does not exist in production today.
--
-- ⚠️ NEVER RUN ON PRODUCTION: the table already exists there. On production this file is only RECORDED as applied:
--   supabase migration repair 20260713143940 --status applied
-- It executes only on from-scratch replays (shadow/local/recovery).
--
-- Prerequisites at this point in the chain (verified): app_role + has_role since 202606240002;
-- set_updated_at since 202606240001, hardened by 20260713141127.

CREATE TABLE public.callback_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  topic      text,
  note       text,
  status     text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY cb_admin_all ON public.callback_requests
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cb_set_updated_at
  BEFORE UPDATE ON public.callback_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- contact_messages — the second (and last) drift table. Original contact-form shape: the 6 base columns; every later
-- column is added by migrations with `if not exists` (20260723180000, 20260726093000, 20260816014008, 20260816104851,
-- 20260816110229, 20260825115024, 20260825124143, 20260825133136, 20260825181159), so the minimal base lets the chain
-- rebuild the full live shape. cm_admin_all is required by 20260713143941 (ALTER POLICY) and dropped by
-- 20260720030121, as in production. cm_insert_authenticated was created manually in production (no migration creates
-- it; 20260822175808 drops-and-recreates it WITHOUT `if exists`), so it must exist here for the replay to pass;
-- cm_insert_anyone is deliberately NOT created — no migration ever drops it and it does not exist in production.

CREATE TABLE public.contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text,
  phone      text,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_admin_all ON public.contact_messages
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY cm_insert_authenticated ON public.contact_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ────────────────────────────────────────────────────────────────────────────
-- guest_groups.gg_admin_all — the one manually-created POLICY (the table itself is migration-created). Verified by a
-- positional scan of every create/alter/drop policy across all 350 migrations: this is the only policy ever altered
-- or dropped (without `if exists`) that no migration creates. Original text per 20260713143941's own comment
-- ("orig qual+check: has_role(auth.uid(), 'admin'::app_role)"); 20260720030121 drops it, as happened in production.

CREATE POLICY gg_admin_all ON public.guest_groups
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ────────────────────────────────────────────────────────────────────────────
-- guests.trg_guests_updated — the one manually-created TRIGGER (positional scan of every create/drop/disable
-- trigger across the chain, 12.10.2026). First referenced by 20261005041849 (disable/enable around the seq
-- backfill); definition read verbatim from live pg_get_triggerdef. set_updated_at exists since 202606240001.

CREATE TRIGGER trg_guests_updated
  BEFORE UPDATE ON public.guests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- The dashboard-era FOREIGN KEYS (the last drift class, found by a full pg_constraint diff production↔replica,
-- 12.10.2026): the June 21–22 baseline tables were created in production WITH these constraints (cascading event
-- cleanup, auth.users links), but the first migration files lack them, and 0007's if-not-exists masked three more.
-- Each definition below is the production text verbatim.
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_event_id_fkey;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.event_questions ADD CONSTRAINT event_questions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.events ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE public.events ADD CONSTRAINT events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.events ADD CONSTRAINT events_package_id_fkey FOREIGN KEY (package_id) REFERENCES packages(id);
ALTER TABLE public.guest_groups DROP CONSTRAINT guest_groups_event_id_fkey;
ALTER TABLE public.guest_groups ADD CONSTRAINT guest_groups_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.guests ADD CONSTRAINT guests_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE public.guests DROP CONSTRAINT guests_event_id_fkey;
ALTER TABLE public.guests ADD CONSTRAINT guests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.guests ADD CONSTRAINT guests_group_id_fkey FOREIGN KEY (group_id) REFERENCES guest_groups(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rsvp_responses ADD CONSTRAINT rsvp_responses_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.rsvp_responses ADD CONSTRAINT rsvp_responses_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
