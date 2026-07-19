-- =====================================================================
-- schedule_callback: capture a guest's "call me back later" request on the
-- call attempt. Three additive, nullable-only columns on public.call_attempts.
--
-- No RLS/policy/GRANT changes: call_attempts already has RLS enabled and
-- full table-level grants to authenticated/anon/service_role, which cover
-- new columns automatically (VERIFIED-LIVE 2026-07-19). No index needed --
-- these are per-attempt scalars read via the existing event-scoped access
-- path, not filtered/joined on.
--
--   * callback_requested_at timestamptz -- when the guest asked to be called
--                                           back (server clock at capture).
--   * callback_when_text    text        -- the guest's free-text time, exactly
--                                           as spoken, e.g. 'מחר בערב'. NOT a
--                                           schedule source of truth on its own.
--   * callback_iso          timestamptz -- parsed absolute time when the free
--                                           text could be resolved; nullable
--                                           when parsing is unavailable/ambiguous.
--
-- Convention verified against 20260719170227_el_call_analysis_qa_columns.sql
-- (additive nullable columns on call_attempts, no RLS/GRANT change).
--
-- Rollback:
--   alter table public.call_attempts drop column if exists callback_requested_at;
--   alter table public.call_attempts drop column if exists callback_when_text;
--   alter table public.call_attempts drop column if exists callback_iso;
-- =====================================================================

alter table public.call_attempts
  add column if not exists callback_requested_at timestamptz,
  add column if not exists callback_when_text text,
  add column if not exists callback_iso timestamptz;

comment on column public.call_attempts.callback_requested_at is
  'When the guest asked to be called back later (schedule_callback). Server clock at capture. Nullable.';
comment on column public.call_attempts.callback_when_text is
  'Guest free-text callback time exactly as spoken, e.g. ''מחר בערב''. Human-readable only; not an authoritative schedule source. Nullable.';
comment on column public.call_attempts.callback_iso is
  'Parsed absolute callback time (timestamptz) when the free text could be resolved; NULL when unavailable or ambiguous. Nullable.';
