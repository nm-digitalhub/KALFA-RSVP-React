-- Backfill the payment ledger (payment_operations) from the legacy payment columns on public.campaigns.
--
-- Why: the ledger is the single source of payment state for the fixed-price package model, and the legacy columns
-- (capture_status, charge_status, release_status, auth_*, charge_*, hold_order_document_*, credit_applied, ...) are
-- scheduled for removal. Their history exists only on those columns: until it is copied, the ledger cannot replace them.
--
-- What it writes, per campaign that has a legacy hold (capture_status IS NOT NULL), in this order:
--   1. authorize  <- capture_status, auth_amount, auth_number, authorized_at, hold_order_document_*
--   2. charge     <- charge_status, final_charge_amount, credit_applied, charged_at, charge_* (independent: no parent).
--                    nothing_to_charge is a SUCCESSFUL charge of 0 that carries the applied credit.
--   3. release    <- release_status = 'released'. Parent = the authorize row. Time = the sumit-hold-reconcile
--                    activity_log row when one exists (source provider_sync); otherwise unknown, written as
--                    authorized_at + 1 second with source manual_backfill and a note saying so.
-- charge and release are written only when the authorize succeeded (a failed hold has nothing to charge or release).
--
-- Deliberately NOT copied: card_token_ref, card expiry and the citizen id (Vault). A hold that was released or whose
-- campaign is closed has no further use for them, and copying a sensitive value into a second table is not needed to
-- preserve the payment history. A future need is a separate, explicit change.
--
-- Idempotent: every row carries meta.backfill_key = '<campaign id>:<kind>' and a row is inserted only when its key is
-- absent, so a re-run (or a partial failure followed by a re-run) inserts only what is missing. The insert trigger
-- (payment_operations_before_insert) locks the campaign row, derives event_id and snapshots once_slot/parent_slot.
--
-- Safety guards (the migration aborts, and rolls back whole, if either fails):
--   * a cancellation request that already carries a SUMIT document has no ledger kind of its own and is not
--     reconstructed here; it needs its own mapping first;
--   * after the inserts, the number of backfilled authorize rows and the summed amounts must equal the legacy columns.
--
-- Rollback (data only, run by hand if ever needed; children first because of parent_operation_id):
--   delete from public.payment_operations where meta ? 'backfill_key' and kind = 'release';
--   delete from public.payment_operations where meta ? 'backfill_key';

do $$
begin
  if exists (select 1 from public.event_cancellation_requests where sumit_document_id is not null) then
    raise exception 'payments backfill: a cancellation request with a SUMIT document exists; map it before backfilling';
  end if;
end $$;

-- 1. authorize
insert into public.payment_operations
  (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, provider_auth_ref,
   provider_document_id, provider_document_number, provider_document_url, source, occurred_at, meta)
select c.id, c.event_id, 'authorize',
       (case c.capture_status
          when 'authorized' then 'succeeded'
          when 'hold_failed' then 'failed'
          when 'hold_review' then 'review'
          when 'pending' then 'pending'
          else 'review'
        end)::public.payment_operation_outcome,
       coalesce(c.auth_amount, 0), 0, 'sumit', nullif(btrim(c.auth_number), ''),
       c.hold_order_document_id, c.hold_order_document_number, c.hold_order_document_url,
       'app', coalesce(c.authorized_at, c.created_at),
       jsonb_build_object('backfill_key', c.id::text || ':authorize')
  from public.campaigns c
 where c.capture_status is not null
   and not exists (select 1 from public.payment_operations o where o.meta ->> 'backfill_key' = c.id::text || ':authorize');

-- 2. charge (independent of the authorize: no parent)
insert into public.payment_operations
  (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, provider_payment_id, provider_auth_ref,
   provider_document_id, provider_document_number, provider_document_url, source, occurred_at, meta)
select c.id, c.event_id, 'charge',
       (case c.charge_status
          when 'charged' then 'succeeded'
          when 'nothing_to_charge' then 'succeeded'
          when 'charge_failed' then 'failed'
          when 'charge_review' then 'review'
          else 'pending'
        end)::public.payment_operation_outcome,
       coalesce(c.final_charge_amount, 0), coalesce(c.credit_applied, 0), 'sumit',
       c.charge_payment_id, c.charge_auth_number,
       c.sumit_charge_document_id, c.charge_document_number, c.charge_document_url,
       'app', coalesce(c.charged_at, c.authorized_at, c.created_at),
       jsonb_build_object('backfill_key', c.id::text || ':charge')
  from public.campaigns c
  join public.payment_operations a
    on a.meta ->> 'backfill_key' = c.id::text || ':authorize' and a.outcome = 'succeeded'
 where c.charge_status in ('charged', 'nothing_to_charge', 'charge_failed', 'charge_review', 'pending')
   and not exists (select 1 from public.payment_operations o where o.meta ->> 'backfill_key' = c.id::text || ':charge');

-- 3. release (child of the authorize)
insert into public.payment_operations
  (campaign_id, event_id, kind, outcome, amount, credit_applied, provider, parent_operation_id,
   source, occurred_at, note, meta)
select c.id, c.event_id, 'release', 'succeeded', 0, 0, 'sumit', a.id,
       case when s.released_at is not null then 'provider_sync' else 'manual_backfill' end,
       coalesce(s.released_at, coalesce(c.authorized_at, c.created_at) + interval '1 second'),
       case when s.released_at is not null
            then 'seen released by sumit-hold-reconcile'
            else 'seen released in SUMIT; release time unknown, written as authorized_at + 1 second'
       end,
       jsonb_build_object('backfill_key', c.id::text || ':release')
  from public.campaigns c
  join public.payment_operations a
    on a.meta ->> 'backfill_key' = c.id::text || ':authorize' and a.outcome = 'succeeded'
  left join lateral (
       select min(l.created_at) as released_at
         from public.activity_log l
        where l.action = 'campaign.hold_released_synced' and l.meta ->> 'campaignId' = c.id::text
       ) s on true
 where c.release_status = 'released'
   and not exists (select 1 from public.payment_operations o where o.meta ->> 'backfill_key' = c.id::text || ':release');

-- 4. verification: the ledger must now hold exactly what the legacy columns say
do $$
declare
  v_expected_auth int; v_actual_auth int;
  v_expected_sum numeric; v_actual_sum numeric;
  v_expected_credit numeric; v_actual_credit numeric;
begin
  select count(*), coalesce(sum(auth_amount), 0) into v_expected_auth, v_expected_sum
    from public.campaigns where capture_status is not null;
  select count(*), coalesce(sum(amount), 0) into v_actual_auth, v_actual_sum
    from public.payment_operations where kind = 'authorize' and meta ? 'backfill_key';
  if v_actual_auth <> v_expected_auth or v_actual_sum <> v_expected_sum then
    raise exception 'payments backfill: authorize mismatch (campaigns % rows / % sum, ledger % rows / % sum)',
      v_expected_auth, v_expected_sum, v_actual_auth, v_actual_sum;
  end if;

  select coalesce(sum(c.credit_applied), 0) into v_expected_credit
    from public.campaigns c
    join public.payment_operations a on a.meta ->> 'backfill_key' = c.id::text || ':authorize' and a.outcome = 'succeeded'
   where c.charge_status in ('charged', 'nothing_to_charge', 'charge_failed', 'charge_review', 'pending');
  select coalesce(sum(credit_applied), 0) into v_actual_credit
    from public.payment_operations where kind = 'charge' and meta ? 'backfill_key';
  if v_expected_credit <> v_actual_credit then
    raise exception 'payments backfill: credit mismatch (campaigns %, ledger %)', v_expected_credit, v_actual_credit;
  end if;
end $$;
