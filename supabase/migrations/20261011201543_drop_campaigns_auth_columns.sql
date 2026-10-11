-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the SUMIT card-hold authorisation of a pay-per-result campaign — campaigns.auth_amount, auth_number,
-- auth_external_ref, authorized_at.
--
-- HISTORY: two campaigns hold values; each is on its succeeded `authorize` row in payment_operations — amount,
-- provider_auth_ref (auth_number; one column value has a leading space the ledger does not), meta.auth_external_ref,
-- occurred_at (comparison-5-1.md). The check below re-measures that before the drop.
--
-- ROLLBACK: re-add `auth_amount numeric`, `auth_number text`, `auth_external_ref text`, `authorized_at timestamptz`
-- (all nullable, no default) and fill them from the authorize row: amount, provider_auth_ref, meta->>'auth_external_ref',
-- occurred_at.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(auth_amount|auth_number|auth_external_ref|authorized_at)\M';
  if v_readers <> 0 then
    raise exception 'auth columns: % function(s) still read a column', v_readers;
  end if;
end $$;

-- Refuse unless every campaign holding an authorisation has a succeeded authorize row with the same facts.
do $$
declare v_missing integer;
begin
  select count(*) into v_missing
    from public.campaigns c
   where (c.auth_amount is not null or c.auth_number is not null or c.auth_external_ref is not null or c.authorized_at is not null)
     and not exists (
       select 1 from public.payment_operations o
        where o.campaign_id = c.id and o.kind = 'authorize' and o.outcome = 'succeeded'
          and o.amount = c.auth_amount
          and o.provider_auth_ref = trim(c.auth_number)
          and o.meta->>'auth_external_ref' is not distinct from c.auth_external_ref
          and o.occurred_at = c.authorized_at);
  if v_missing <> 0 then
    raise exception 'auth columns: % campaign(s) hold an authorisation the ledger does not', v_missing;
  end if;
end $$;

alter table public.campaigns
  drop column auth_amount,
  drop column auth_number,
  drop column auth_external_ref,
  drop column authorized_at;
