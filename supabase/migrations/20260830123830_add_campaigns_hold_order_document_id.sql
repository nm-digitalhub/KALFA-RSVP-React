-- SUMIT's documented J5 flow issues a draft "Order" document per hold
-- (verified live 2026-08-30, help.sumit.co.il/he/articles/5832974). authorize.ts
-- no longer suppresses it (PreventDocumentCreation removed) and now returns its
-- DocumentID — persist it so a hold is traceable in the SUMIT "תפיסות מסגרת"
-- screen, not just in our own DB. Nullable/no default: existing rows (and any
-- future hold where SUMIT omits it) simply have no reference, same as
-- auth_number/auth_amount today.
alter table public.campaigns
  add column hold_order_document_id bigint;

comment on column public.campaigns.hold_order_document_id is
  'SUMIT Order-document ID for this campaign''s J5 hold (Data.DocumentID on the authorize response). Nullable — absent for holds placed before 2026-08-30 or if SUMIT omits it.';
