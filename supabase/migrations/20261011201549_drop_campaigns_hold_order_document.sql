-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the SUMIT order document of a card hold — campaigns.hold_order_document_id, hold_order_document_number,
-- hold_order_document_url.
--
-- HISTORY: one campaign holds them; the same id, number and url are on its succeeded `authorize` row in
-- payment_operations (provider_document_id, provider_document_number, provider_document_url; comparison-5-1.md). The
-- check below re-measures it.
--
-- ROLLBACK: re-add hold_order_document_id bigint, hold_order_document_number integer, hold_order_document_url text
-- (nullable) and fill them from the authorize row's provider_document_id / _number / _url.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(hold_order_document_id|hold_order_document_number|hold_order_document_url)\M';
  if v_readers <> 0 then
    raise exception 'hold order document: % function(s) still read a column', v_readers;
  end if;
end $$;

do $$
declare v_missing integer;
begin
  select count(*) into v_missing
    from public.campaigns c
   where (c.hold_order_document_id is not null or c.hold_order_document_number is not null or c.hold_order_document_url is not null)
     and not exists (
       select 1 from public.payment_operations o
        where o.campaign_id = c.id and o.kind = 'authorize' and o.outcome = 'succeeded'
          and o.provider_document_id is not distinct from c.hold_order_document_id
          and o.provider_document_number is not distinct from c.hold_order_document_number
          and o.provider_document_url is not distinct from c.hold_order_document_url);
  if v_missing <> 0 then
    raise exception 'hold order document: % campaign(s) hold a document the ledger does not', v_missing;
  end if;
end $$;

alter table public.campaigns
  drop column hold_order_document_id,
  drop column hold_order_document_number,
  drop column hold_order_document_url;
