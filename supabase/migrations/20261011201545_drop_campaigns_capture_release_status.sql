-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the state of the SUMIT card hold — campaigns.capture_status and release_status. Their CHECK constraints
-- (campaigns_capture_status_valid, campaigns_release_status_valid) go with them.
--
-- HISTORY: two campaigns hold capture_status = 'authorized' and release_status = 'released'; each has a succeeded
-- `authorize` and a succeeded `release` row in payment_operations (comparison-5-1.md). The check below re-measures it.
--
-- ROLLBACK: re-add both as nullable text with their CHECKs —
--   capture_status in ('pending','authorized','hold_failed','hold_review'), release_status = 'released' —
-- and set capture_status = 'authorized' where a succeeded authorize row exists, release_status = 'released' where a
-- succeeded release row exists.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(capture_status|release_status)\M';
  if v_readers <> 0 then
    raise exception 'capture/release status: % function(s) still read a column', v_readers;
  end if;
end $$;

do $$
declare v_missing integer;
begin
  select count(*) into v_missing
    from public.campaigns c
   where (c.capture_status = 'authorized'
          and not exists (select 1 from public.payment_operations o
                           where o.campaign_id = c.id and o.kind = 'authorize' and o.outcome = 'succeeded'))
      or (c.release_status = 'released'
          and not exists (select 1 from public.payment_operations o
                           where o.campaign_id = c.id and o.kind = 'release' and o.outcome = 'succeeded'))
      or (c.capture_status is not null and c.capture_status <> 'authorized');
  if v_missing <> 0 then
    raise exception 'capture/release status: % campaign(s) hold a state the ledger does not', v_missing;
  end if;
end $$;

alter table public.campaigns
  drop column capture_status,
  drop column release_status;
