-- Complete the card details of the two historical campaigns in the payment ledger (public.payment_operations).
--
-- Why: 20261005133213_payments_ledger_backfill_legacy copied the legacy hold/charge columns into the ledger but
-- deliberately left the card out (the campaigns table never stored the last four digits, the brand or the issuer, and
-- the expiry was held back). The ledger rows therefore say "a hold of 152 succeeded" without saying on WHICH card, and
-- the owner asked for the card to be on the row.
--
-- Where the facts come from: SUMIT's own CRM, read-only, on 6.10.2026 (not from our database, which never had them):
--   hold record (folder 1076735289, "תפיסות מסגרת")  ->  Billing_CreditGuyTransaction  (folder 1076735182, "עסקאות")
--                                                    ->  Billing_PaymentMethod          (folder 1076735281, "כרטיסי אשראי ללקוחות")
--   * the hold was matched to the campaign on THREE things at once: the authorization number, the amount and the moment;
--   * last four digits, mask and expiry come from the payment method; brand and issuer are SUMIT's numeric codes from
--     the terminal transaction. They are stored as the codes (text), never as a guessed name: the code -> name table
--     lives in the application (owner-confirmed 6.10.2026: brand 21 = Mastercard, 22 = Visa; issuer 11 = Isracard,
--     16 = Max). The acquirer (6 on every card seen) has no confirmed name, so it is not stored.
--   * the SUMIT record ids are kept in meta.card_source, so each fact can be traced back to where it was read.
--
--   campaign 15a8730e: hold #2127278035, transaction #2127277249, payment method #2127277247 -> card 9183, 07/2031,
--                      brand 21, issuer 11
--   campaign 39334087: hold #2327129326, transaction #2327129321, payment method #2327129072 -> card 9429, 09/2031,
--                      brand 22, issuer 16
--
-- How: the ledger is immutable once a row has succeeded (payment_operations_guard_update), so the rows cannot be
-- edited. They are REPLACED: the six rows written by the previous backfill are deleted in one statement (parent and
-- child together) and written again with the card, in the same order the previous backfill used. Only rows carrying
-- meta.backfill_key are touched; the migration aborts if a campaign has any other ledger row. Each new row keeps its
-- backfill_key and records the id it replaced in meta.replaces_operation_id. The authorize row also carries
-- meta.auth_external_ref (the customer anchor used by close-charge and event cancellation), copied from campaigns.
-- occurred_at, amounts, outcomes, notes and sources are copied unchanged; recorded_at is the time of this migration.
--
-- Still deliberately NOT copied: card_token_ref and the citizen id (Vault). A separate, explicit change.
--
-- Idempotent: the rows to replace are selected only for a campaign whose authorize row still has no card_last4, so a
-- second run finds nothing to do and only re-checks the final state.
--
-- Safety (the migration aborts, and rolls back whole, when any of these fails): the campaign still looks like the one
-- the facts were read for (same authorization number and expiry); the campaign has no ledger row without a backfill_key;
-- every campaign being rebuilt has exactly one authorize row; afterwards the row count, the summed amounts and the
-- summed credit are unchanged, every release points at its campaign's authorize, and the card matches the facts.
--
-- Rollback (data only, by hand): delete the rebuilt rows and run the three INSERT statements of
-- 20261005133213_payments_ledger_backfill_legacy.sql again; they are idempotent and rewrite the card-less rows:
--   delete from public.payment_operations where meta ? 'replaces_operation_id';

do $$
declare
  v_pending int;
begin
  create temp table _card_facts (
    campaign_id   uuid primary key,
    expected_auth text     not null,
    method_type   text     not null,
    last4         text     not null,
    mask          text     not null,
    exp_month     smallint not null,
    exp_year      smallint not null,
    brand         text     not null,
    issuer        text     not null,
    crm           jsonb    not null
  ) on commit drop;

  insert into _card_facts values
    ('15a8730e-df46-43f6-a29f-13a1ea3a0038', '0759469', '1', '9183', 'XXXXXXXXXXXX9183', 7, 2031, '21', '11',
     '{"hold_entity_id": 2127278035, "transaction_id": 2127277249, "payment_method_id": 2127277247}'),
    ('39334087-e68c-4c81-aea4-b465cfc205e2', '055528', '1', '9429', 'XXXXXXXXXXXX9429', 9, 2031, '22', '16',
     '{"hold_entity_id": 2327129326, "transaction_id": 2327129321, "payment_method_id": 2327129072}');

  -- the campaigns are still the ones the facts were read for
  if exists (
    select 1
      from _card_facts f
      left join public.campaigns c on c.id = f.campaign_id
     where c.id is null
        or c.capture_status <> 'authorized'
        or nullif(btrim(c.auth_number), '') is distinct from f.expected_auth
        or c.card_exp_month is distinct from f.exp_month
        or c.card_exp_year is distinct from f.exp_year
        or c.auth_external_ref is null
  ) then
    raise exception 'ledger card details: a campaign no longer matches the card facts read from SUMIT';
  end if;

  -- nothing but the previous backfill may exist for these campaigns
  if exists (
    select 1 from public.payment_operations o join _card_facts f using (campaign_id) where not (o.meta ? 'backfill_key')
  ) then
    raise exception 'ledger card details: a campaign has a ledger row that is not from the backfill';
  end if;

  create temp table _old on commit drop as
  select o.*
    from public.payment_operations o
    join _card_facts f using (campaign_id)
   where o.meta ? 'backfill_key'
     and exists (
       select 1 from public.payment_operations a
        where a.campaign_id = o.campaign_id and a.kind = 'authorize' and a.card_last4 is null
     );

  if exists (
    select 1
      from (select campaign_id from _old group by campaign_id having count(*) filter (where kind = 'authorize') <> 1) x
  ) then
    raise exception 'ledger card details: a campaign does not have exactly one authorize row';
  end if;

  -- parent and child go in one statement, so the parent_operation_id reference is never dangling
  delete from public.payment_operations where id in (select id from _old);

  -- 1. authorize, now with the card
  insert into public.payment_operations
    (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, provider_payment_id, provider_auth_ref,
     provider_document_id, provider_document_number, provider_document_url, source, occurred_at, note,
     payment_method_type, card_last4, card_mask, card_exp_month, card_exp_year, card_brand, card_issuer, meta)
  select o.campaign_id, o.event_id, o.kind, o.outcome, o.amount, o.credit_applied, o.provider, o.provider_payment_id,
         o.provider_auth_ref, o.provider_document_id, o.provider_document_number, o.provider_document_url, o.source,
         o.occurred_at, o.note,
         f.method_type, f.last4, f.mask, f.exp_month, f.exp_year, f.brand, f.issuer,
         o.meta || jsonb_build_object(
           'replaces_operation_id', o.id,
           'auth_external_ref', c.auth_external_ref,
           'card_source', jsonb_build_object('system', 'sumit_crm', 'read_on', '2026-10-06') || f.crm)
    from _old o
    join _card_facts f using (campaign_id)
    join public.campaigns c on c.id = o.campaign_id
   where o.kind = 'authorize';

  -- 2. release (child of the NEW authorize)
  insert into public.payment_operations
    (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, provider_payment_id, provider_auth_ref,
     provider_document_id, provider_document_number, provider_document_url, parent_operation_id, source, occurred_at,
     note, meta)
  select o.campaign_id, o.event_id, o.kind, o.outcome, o.amount, o.credit_applied, o.provider, o.provider_payment_id,
         o.provider_auth_ref, o.provider_document_id, o.provider_document_number, o.provider_document_url, a.id,
         o.source, o.occurred_at, o.note, o.meta || jsonb_build_object('replaces_operation_id', o.id)
    from _old o
    join public.payment_operations a
      on a.campaign_id = o.campaign_id and a.kind = 'authorize' and a.meta ->> 'backfill_key' = o.campaign_id::text || ':authorize'
   where o.kind = 'release';

  -- 3. charge (independent of the authorize)
  insert into public.payment_operations
    (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, provider_payment_id, provider_auth_ref,
     provider_document_id, provider_document_number, provider_document_url, source, occurred_at, note, meta)
  select o.campaign_id, o.event_id, o.kind, o.outcome, o.amount, o.credit_applied, o.provider, o.provider_payment_id,
         o.provider_auth_ref, o.provider_document_id, o.provider_document_number, o.provider_document_url, o.source,
         o.occurred_at, o.note, o.meta || jsonb_build_object('replaces_operation_id', o.id)
    from _old o
   where o.kind = 'charge';

  -- verification: the final state, and (when something was rebuilt) that nothing else moved
  if exists (
    select 1
      from _card_facts f
      join public.payment_operations a on a.campaign_id = f.campaign_id and a.kind = 'authorize'
      join public.campaigns c on c.id = f.campaign_id
     where a.card_last4 is distinct from f.last4
        or a.card_mask is distinct from f.mask
        or a.card_exp_month is distinct from f.exp_month
        or a.card_exp_year is distinct from f.exp_year
        or a.card_brand is distinct from f.brand
        or a.card_issuer is distinct from f.issuer
        or a.payment_method_type is distinct from f.method_type
        or (a.meta ->> 'auth_external_ref') is distinct from c.auth_external_ref::text
  ) then
    raise exception 'ledger card details: an authorize row does not carry the card it should';
  end if;

  select count(*) into v_pending from _old;
  if v_pending > 0 then
    if (select count(*) from public.payment_operations o join _card_facts f using (campaign_id)) <> v_pending then
      raise exception 'ledger card details: the number of ledger rows changed';
    end if;
    if (select coalesce(sum(amount), 0) from _old)
         is distinct from (select coalesce(sum(o.amount), 0) from public.payment_operations o join _card_facts f using (campaign_id))
       or (select coalesce(sum(credit_applied), 0) from _old)
         is distinct from (select coalesce(sum(o.credit_applied), 0) from public.payment_operations o join _card_facts f using (campaign_id)) then
      raise exception 'ledger card details: an amount or a credit changed';
    end if;
    if exists (
      select 1
        from public.payment_operations r
        join _card_facts f using (campaign_id)
       where r.kind = 'release'
         and not exists (
           select 1 from public.payment_operations a
            where a.id = r.parent_operation_id and a.kind = 'authorize' and a.campaign_id = r.campaign_id
         )
    ) then
      raise exception 'ledger card details: a release does not point at its campaign authorize';
    end if;
    if exists (
      select 1
        from public.payment_operations o
        join _card_facts f using (campaign_id)
       where not (o.meta ? 'replaces_operation_id')
          or not exists (select 1 from _old x where x.id = (o.meta ->> 'replaces_operation_id')::uuid)
    ) then
      raise exception 'ledger card details: a rebuilt row does not record the row it replaced';
    end if;
  end if;
end $$;
