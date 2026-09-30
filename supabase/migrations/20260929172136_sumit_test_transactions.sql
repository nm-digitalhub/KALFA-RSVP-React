-- /admin/sumit-test: persist EVERY field SUMIT returns for a diagnostic charge, one column per field.
--
-- Until now the diagnostic screen stored nothing: a J5 hold made there left no AuthNumber / CustomerID /
-- token anywhere, so the hold could never be referenced again — and "capture the J5 by CreditCardAuthNumber"
-- (SUMIT support, 2026-09-29; plan docs/superpowers/plans/2026-09-29-capture-j5-hold.md) could not be tested.
--
-- Columns mirror the /billing/payments/charge/ response exactly (src/lib/sumit/types.generated.ts,
-- Response_…PaymentsController_Payments_Charge_Response → Data → Payment → PaymentMethod), prefixed by level:
--   (top)            Status, UserErrorMessage, TechnicalErrorDetails
--   data_*           Data.CustomerID / DocumentID / DocumentNumber / DocumentDownloadURL
--   payment_*        Data.Payment.*
--   payment_method_* Data.Payment.PaymentMethod.*
-- plus the full body in `response`. Enum fields (Status, Currency, PaymentMethod.Type) are stored as the raw
-- value SUMIT sent (the live API returns numbers, while the swagger types them as "Success (0)" strings).
--
-- NEVER stored, even if SUMIT echoes them: PaymentMethod.CreditCard_Number (full PAN), CreditCard_CVV,
-- CreditCard_Track2 — card-industry rules forbid keeping them. They are stripped from `response` too.
--
-- Staff-only: RLS on with no policies, no grants for anon/authenticated. Written and read only by the
-- service-role client behind requirePlatformPermission('manage_billing').
--
-- Rollback: drop table if exists public.sumit_test_transactions;

create table public.sumit_test_transactions (
  id                                   uuid primary key default gen_random_uuid(),
  created_at                           timestamptz not null default now(),
  created_by                           uuid not null,

  -- What was sent
  operation                            text not null check (operation in ('charge', 'hold', 'capture')),
  parent_id                            uuid references public.sumit_test_transactions (id) on delete restrict,
  request_amount                       numeric,
  request_authorize_amount             numeric,
  request_auto_capture                 boolean,          -- null = not sent (SUMIT default: capture)
  request_credit_card_auth_number      text,             -- capture: the hold's AuthNumber
  request_customer_id                  bigint,
  request_external_identifier          text,
  request                              jsonb not null,   -- safe summary (credentials/token/CitizenID redacted)

  -- HTTP
  http_status                          integer,

  -- Response (top level)
  status                               text,
  user_error_message                   text,
  technical_error_details              text,

  -- Response.Data
  data_customer_id                     bigint,
  data_document_id                     bigint,
  data_document_number                 bigint,
  data_document_download_url           text,

  -- Response.Data.Payment
  payment_id                           bigint,
  payment_customer_id                  bigint,
  payment_date                         text,
  payment_valid_payment                boolean,
  payment_status                       text,
  payment_status_description           text,
  payment_amount                       numeric,
  payment_currency                     text,
  payment_auth_number                  text,
  payment_first_payment_amount         numeric,
  payment_non_first_payment_amount     numeric,
  payment_recurring_customer_item_ids  jsonb,

  -- Response.Data.Payment.PaymentMethod (no PAN / CVV / Track2)
  payment_method_id                    bigint,
  payment_method_customer_id           bigint,
  payment_method_last_digits           text,
  payment_method_expiration_month      integer,
  payment_method_expiration_year       integer,
  payment_method_citizen_id            text,
  payment_method_card_mask             text,
  payment_method_token                 text,
  payment_method_direct_debit_bank     integer,
  payment_method_direct_debit_branch   integer,
  payment_method_direct_debit_account  bigint,
  payment_method_direct_debit_expiration_date text,
  payment_method_direct_debit_maximum_amount  integer,
  payment_method_type                  text,

  -- Full body (PAN / CVV / Track2 removed); null when SUMIT returned non-JSON
  response                             jsonb,
  response_text                        text              -- only for a non-JSON body
);

create index sumit_test_transactions_created_at_idx on public.sumit_test_transactions (created_at desc);
create index sumit_test_transactions_parent_idx on public.sumit_test_transactions (parent_id);

alter table public.sumit_test_transactions enable row level security;
revoke all on table public.sumit_test_transactions from public, anon, authenticated;
