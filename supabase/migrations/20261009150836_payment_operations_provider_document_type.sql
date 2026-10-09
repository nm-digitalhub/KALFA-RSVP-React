-- The type of the document a payment operation's provider issued, as its own column.
--
-- WHY: CardCom numbers every document type separately (receipt 6 and credit receipt 6 are two documents), so the document
-- report (cardcom-document-processing.ts) must match a reported document by number, TYPE and terminal. The type is already
-- recorded — by the CardCom purchase in meta.cardcom_document_type ("Receipt"), and from 9.10.2026 by the CardCom refund
-- ("ReceiptRefund") — but inside meta it is neither readable at a glance nor indexable. The owner asked for a column.
--
-- WHAT IT DOES: adds provider_document_type as a STORED GENERATED column computed from meta->>'cardcom_document_type'
-- (PostgreSQL 17, ddl-generated-columns: "always computed from other columns", computed when a row is written, and
-- "cannot be written to directly"). So:
--   - no code writes it and no code can write a wrong value into it; the writers keep writing meta as they do;
--   - the rows that exist get it when the column is added — no backfill UPDATE, so payment_operations_guard_update
--     (a succeeded row is immutable) is not involved;
--   - a row whose meta has no type (the CardCom refund of 9.10.2026 17:40, a SUMIT row) has NULL: unknown, shown as such.
-- An index on (provider, provider_document_number, provider_document_type, provider_terminal) for the report's lookup.
--
-- WHAT IT DOES NOT DO: change meta, any row's outcome, or any privilege. The expression uses only the row itself and
-- immutable operators (->>, btrim, nullif), as a generated column requires.
--
-- ROLLBACK:
--   drop index if exists public.payment_operations_provider_document_idx;
--   alter table public.payment_operations drop column provider_document_type;

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.payment_operations
  add column provider_document_type text
  generated always as (nullif(btrim(meta ->> 'cardcom_document_type'), '')) stored;

comment on column public.payment_operations.provider_document_type is
  'The provider''s name for the document this operation issued (CardCom: Receipt, ReceiptRefund, TaxInvoiceAndReceipt…). '
  'Generated from meta.cardcom_document_type; NULL when the provider gave none. Read-only.';

create index payment_operations_provider_document_idx
  on public.payment_operations (provider, provider_document_number, provider_document_type, provider_terminal)
  where provider_document_number is not null;

-- ── Verification: the column is generated (never written by code) and existing typed rows already carry their type. ──
do $$
declare
  v_generated text;
  v_missing int;
begin
  select attgenerated::text into v_generated
    from pg_attribute
   where attrelid = 'public.payment_operations'::regclass and attname = 'provider_document_type';
  if v_generated is distinct from 's' then
    raise exception 'payment_operations.provider_document_type must be a stored generated column (got %)', v_generated;
  end if;

  select count(*) into v_missing
    from public.payment_operations
   where nullif(btrim(meta ->> 'cardcom_document_type'), '') is not null
     and provider_document_type is distinct from nullif(btrim(meta ->> 'cardcom_document_type'), '');
  if v_missing > 0 then
    raise exception '% rows with a document type in meta did not get it in provider_document_type', v_missing;
  end if;
end $$;
