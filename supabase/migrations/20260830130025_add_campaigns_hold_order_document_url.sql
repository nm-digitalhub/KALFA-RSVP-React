-- Companion to hold_order_document_id/number (20260830123830, 20260830124904):
-- the direct document download link (Data.DocumentDownloadURL). Verified this
-- is a DIFFERENT ID space than the SUMIT UI's browsable CRM entity URL
-- (f<folder>/c<entityId>) — that entity ID is not returned by the authorize
-- response at all, so this URL is the reliable admin-facing "view" link.
-- Mirrors charge_document_url's type (text), the same field for the final
-- receipt (202606290027_charge_findings.sql).
alter table public.campaigns
  add column hold_order_document_url text;

comment on column public.campaigns.hold_order_document_url is
  'SUMIT Order-document download URL for this campaign''s J5 hold (Data.DocumentDownloadURL on the authorize response). Nullable — companion to hold_order_document_id.';
