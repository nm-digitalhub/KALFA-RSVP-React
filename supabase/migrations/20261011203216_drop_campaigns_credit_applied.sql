-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תוסיף" — add campaigns.credit_applied
-- to the drops; "אין בעיה ליצור את מגרייצית המחיקה").
--
-- GROUP: campaigns.credit_applied — the credit a pay-per-result campaign's charge at close used. The payment ledger
-- records the same figure on each charge row (payment_operations.credit_applied), and the package purchase records it
-- there only.
--
-- ⚠️ DEPLOY ORDER: the APPLICATION FIRST, then this migration. Before the commit that makes creditConsumedByCampaign
-- read the ledger only, billing.ts and admin/users.ts selected this column; against that code the drop breaks the
-- credit check of every purchase and the admin user page.
--
-- HISTORY: two campaigns hold a value (₪84, ₪200); each is the credit_applied of its succeeded `charge` row. Every other
-- campaign holds 0 (comparison-5-1.md). The check below re-measures it.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check leaves
-- the column in place.
--
-- ROLLBACK: alter table public.campaigns add column credit_applied numeric not null default 0; then set it, per
-- campaign, to the sum of credit_applied of its succeeded collect rows (payment_operations joined to
-- payment_operation_kinds where effect = 'collect').

set local lock_timeout = '5s';

-- Refuse if a function reads campaigns.credit_applied. The two functions that name credit_applied read the LEDGER's
-- column (owner_agent_billing_sums, payment_operations_check_lines); any other function naming it stops the drop.
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\mcredit_applied\M'
     and p.proname not in ('owner_agent_billing_sums', 'payment_operations_check_lines');
  if v_readers <> 0 then
    raise exception 'credit_applied: % other function(s) name the column', v_readers;
  end if;
end $$;

-- Refuse unless every campaign's credit is the credit of its succeeded collects in the ledger.
do $$
declare v_missing integer;
begin
  select count(*) into v_missing
    from public.campaigns c
   where c.credit_applied <> coalesce((
           select sum(o.credit_applied)
             from public.payment_operations o
             join public.payment_operation_kinds k on k.kind = o.kind
            where o.campaign_id = c.id and o.outcome = 'succeeded' and k.effect = 'collect'), 0);
  if v_missing <> 0 then
    raise exception 'credit_applied: % campaign(s) hold a credit the ledger does not', v_missing;
  end if;
end $$;

alter table public.campaigns drop column credit_applied;
