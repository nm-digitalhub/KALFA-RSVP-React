-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the charge at close of a pay-per-result campaign — campaigns.charge_status, charge_auth_number,
-- charge_document_number, charge_document_url, charge_payment_id, charged_at, final_charge_amount,
-- final_invoice_document_id. The CHECK constraint campaigns_charge_status_valid goes with charge_status.
--
-- HISTORY: two campaigns hold charge_status = 'nothing_to_charge', final_charge_amount = 0 and charged_at; each has a
-- succeeded `charge` row of ₪0 in payment_operations at the same instant. Every other column of the group is empty on
-- every campaign (comparison-5-1.md). The check below re-measures both.
--
-- ROLLBACK: re-add charge_status text (CHECK in ('pending','charged','nothing_to_charge','charge_failed',
-- 'charge_review')), charge_auth_number text, charge_document_number integer, charge_document_url text,
-- charge_payment_id integer, charged_at timestamptz, final_charge_amount numeric, final_invoice_document_id integer (all
-- nullable), and fill from the succeeded charge row: 'nothing_to_charge' for amount 0 / 'charged' otherwise, amount,
-- occurred_at, and the provider_* fields.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(charge_status|charge_auth_number|charge_document_number|charge_document_url|charge_payment_id|charged_at|final_charge_amount|final_invoice_document_id)\M';
  if v_readers <> 0 then
    raise exception 'charge columns: % function(s) still read a column', v_readers;
  end if;
end $$;

do $$
declare v_missing integer; v_unexpected integer;
begin
  select count(*) into v_missing
    from public.campaigns c
   where c.charge_status is not null
     and not exists (
       select 1 from public.payment_operations o
        where o.campaign_id = c.id and o.kind = 'charge' and o.outcome = 'succeeded'
          and o.amount = coalesce(c.final_charge_amount, 0)
          and o.occurred_at = c.charged_at);
  select count(*) into v_unexpected
    from public.campaigns c
   where c.charge_auth_number is not null or c.charge_document_number is not null or c.charge_document_url is not null
      or c.charge_payment_id is not null or c.final_invoice_document_id is not null
      or (c.charge_status is not null and c.charge_status <> 'nothing_to_charge');
  if v_missing <> 0 or v_unexpected <> 0 then
    raise exception 'charge columns: % campaign(s) hold a charge the ledger does not, % hold an unmeasured value',
      v_missing, v_unexpected;
  end if;
end $$;

alter table public.campaigns
  drop column charge_status,
  drop column charge_auth_number,
  drop column charge_document_number,
  drop column charge_document_url,
  drop column charge_payment_id,
  drop column charged_at,
  drop column final_charge_amount,
  drop column final_invoice_document_id;
