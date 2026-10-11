-- Hardening per Supabase Advisor lints 0028/0029, APPROVED by the owner on 12.10.2026 ("כן, תיצור").
--
-- sync_campaign_window_from_event() is a SECURITY DEFINER trigger function (RETURNS trigger) serving exactly one
-- trigger: trg_sync_campaign_window_from_event on public.events (after a real event_date change it updates the
-- event's campaigns' close_at / thankyou_send_at). Verified live 12.10.2026: its ACL granted EXECUTE to PUBLIC,
-- anon, authenticated and service_role — wider than a trigger-only function needs. PostgREST does not expose
-- RETURNS-trigger functions as RPC, so the practical risk was low; this closes the lint finding anyway.
--
-- Firing a trigger does NOT check the DML user's EXECUTE on the trigger function, so revoking cannot break the
-- event-date sync. The self-check below proves the trigger is still attached after the revoke.
--
-- ROLLBACK: grant execute on function public.sync_campaign_window_from_event() to anon, authenticated, service_role;

revoke all on function public.sync_campaign_window_from_event() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.events'::regclass
       and t.tgname = 'trg_sync_campaign_window_from_event'
       and not t.tgisinternal
  ) then
    raise exception 'trg_sync_campaign_window_from_event is missing from public.events';
  end if;
end $$;
