-- §7 debt #2 — concurrent-safe webhook drain.
--
-- The worker's claim was a plain `select … where processed_at is null` with no row
-- lock, so two overlapping pg-boss runs (webhook cron every minute, max:4) could
-- pull the SAME rows and do duplicate work. The UNIQUE(channel, provider_id) on
-- contact_interactions + recordReached's `fresh` gate already make that
-- double-bill-safe; this removes the wasted double-work.
--
-- claim_webhook_events returns the oldest unprocessed, non-exhausted rows and
-- locks them FOR UPDATE SKIP LOCKED, so concurrent callers receive DISJOINT sets
-- (each skips rows the other has already locked for the duration of the call).
--
-- SECURITY DEFINER so it runs as owner (bypasses webhook_inbox's admin-only RLS);
-- EXECUTE is locked to service_role only (the worker) and revoked from
-- PUBLIC/anon/authenticated — a SECURITY DEFINER function in `public` is otherwise
-- a callable endpoint for every role. search_path pinned to public.

create or replace function public.claim_webhook_events(_limit int)
returns setof public.webhook_inbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select *
    from public.webhook_inbox
    where processed_at is null
      and attempts < 5
    order by received_at asc
    limit _limit
    for update skip locked;
end;
$$;

revoke all on function public.claim_webhook_events(int) from public, anon, authenticated;
grant execute on function public.claim_webhook_events(int) to service_role;
