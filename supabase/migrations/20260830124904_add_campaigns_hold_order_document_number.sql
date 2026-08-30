-- Companion to hold_order_document_id (20260830123830): the human-readable
-- document number SUMIT shows in its UI ("הזמנה / 1002"), distinct from the
-- internal DocumentID. Mirrors charge_document_number's type (integer), the
-- same field for the final receipt (202606290027_charge_findings.sql).
alter table public.campaigns
  add column hold_order_document_number integer;

comment on column public.campaigns.hold_order_document_number is
  'SUMIT Order-document human-readable number for this campaign''s J5 hold (Data.DocumentNumber on the authorize response). Nullable — companion to hold_order_document_id.';
