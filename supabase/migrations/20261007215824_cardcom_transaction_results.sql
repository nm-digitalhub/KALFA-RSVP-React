-- CardCom pilot (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, section 11): the WHOLE answer CardCom gives to
-- GetLpResult for a payment, kept verbatim, one row per ledger operation.
--
-- OWNER DECISION (8.10.2026, "save them all, no exception"): nothing CardCom returns is dropped. That includes the
-- cardholder's name, e-mail, phone and ID number and the reusable card token CardCom returns even for a plain charge.
--
-- WHY A TABLE OF ITS OWN, and not the ledger row:
--   - payment_operations.card_token_ref is read by currentCard() for the SUMIT saved-card refund path; a CardCom token
--     there would be tried against SUMIT.
--   - payment_operations.meta is selected by the admin payment-review screen; a token or an ID in it would travel to a
--     browser.
--   This table is closed to every client role and read by no screen. It is written once, by the server, when a payment is
--   settled, and never edited or deleted (the ledger row it belongs to is itself append-only).
--
-- FAIL-OPEN FOR THE PAYMENT: the application writes this row AFTER the ledger row is closed and treats a failed write as a
-- missing audit copy, never as a failed payment (cardcom-settle.ts).

create table public.cardcom_transaction_results (
  -- RESTRICT, like the ledger's own foreign keys: the money record never vanishes because a copy was deleted. The primary key
  -- is also the index the foreign key needs; ONE answer per operation (the first one settled wins).
  operation_id   uuid primary key references public.payment_operations (id) on delete restrict,
  -- CardCom's identifier of the session this answer was asked for (same bound as cardcom_payment_sessions.low_profile_id).
  low_profile_id text not null check (length(low_profile_id) between 1 and 64),
  -- CardCom's GetLpResult answer exactly as it came: personal data and a card token live here, nowhere else.
  result         jsonb not null check (jsonb_typeof(result) = 'object'),
  fetched_at     timestamptz not null default now()
);
comment on table public.cardcom_transaction_results is 'CardCom GetLpResult answer, verbatim, one per payment operation. Holds cardholder personal data and a card token: server-only, never read by a screen, append-only.';

-- Closed to every client role (three statements: a narrower GRANT is additive, it cannot take a privilege away;
-- 20261007215705 is the precedent). RLS on, no policies: even a future grant would deny.
alter table public.cardcom_transaction_results enable row level security;
revoke all on public.cardcom_transaction_results from public, anon, authenticated;
revoke all on public.cardcom_transaction_results from service_role;
-- What the code does, and nothing more: write once, read back. No UPDATE, no DELETE.
grant select, insert on public.cardcom_transaction_results to service_role;

-- ── DRY RUN (owner, one transaction ending in ROLLBACK) ──
-- a) select has_table_privilege('anon','public.cardcom_transaction_results','select') anon_sel,
--           has_table_privilege('authenticated','public.cardcom_transaction_results','select') auth_sel,
--           has_table_privilege('service_role','public.cardcom_transaction_results','select,insert') sr_rw,
--           has_table_privilege('service_role','public.cardcom_transaction_results','update') sr_upd,
--           has_table_privilege('service_role','public.cardcom_transaction_results','delete') sr_del;
--    expect: f, f, t, f, f
-- b) select count(*) from pg_policies where tablename = 'cardcom_transaction_results';  -- 0
-- c) (ROLLBACK, as service_role) a second row for the same operation_id -> 23505; an operation that does not exist -> 23503;
--    a `result` that is not a JSON object (e.g. '[]'::jsonb) -> 23514; delete from payment_operations of an operation that
--    has a result -> 23503 (RESTRICT)
-- ROLLBACK (manual): drop table public.cardcom_transaction_results;
