-- Security hardening (defense-in-depth) — NO behavior change.
-- Source: full RLS + function audit 2026-07-13 (all 38 tables CORRECT/BY-DESIGN;
-- zero real security holes). This migration covers only the non-table hygiene:
--   5a. pin search_path=public on two of our own trigger functions (lint 0011).
--   5b/5c. remove the EXECUTE surface of five functions from anon (and, for the
--          two internal trigger/maintenance functions, from authenticated too).
--
-- IMPORTANT — why REVOKE FROM PUBLIC (not just anon): pg_proc ACL shows these
-- functions carry a PUBLIC EXECUTE grant (=X), so `REVOKE ... FROM anon` alone is
-- a NO-OP (anon still executes via PUBLIC). We revoke PUBLIC + anon together.
-- All five functions already fail closed for anon (they RAISE when auth.uid() is
-- NULL), and handle_new_user is an AFTER-INSERT trigger (trigger execution does
-- not check EXECUTE), so this changes no runtime behavior — it only shrinks the
-- directly-callable API surface. Kept callable: authenticated + service_role for
-- the three genuine RPCs; postgres/service_role only for the two internal ones.

-- == 5a. Pin search_path on our SECURITY INVOKER trigger functions ============
alter function public.set_updated_at() set search_path = public;
alter function public.campaign_authorized_set_audit_no_mutate() set search_path = public;

-- == 5b. Genuine RPCs -- remove anon; keep authenticated + service_role =======
revoke execute on function public.accept_invitation(_token text)   from public, anon;
revoke execute on function public.create_organization(_name text)  from public, anon;
revoke execute on function public.claim_first_admin()              from public, anon;

-- == 5c. Internal trigger / maintenance functions -- remove anon + authenticated
--        (not meant to be called via the Data API at all) =====================
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
