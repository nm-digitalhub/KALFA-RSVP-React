-- APPROVED by the owner on 12.10.2026 ("תכתוב מגירציה עכשיו שתמחק את העמודה"), after a full code check.
--
-- GROUP: signed_agreements.id_document_ref — a storage-path column for a customer ID document that was NEVER
-- implemented: no code ever wrote it (verified across the whole git history), and migration
-- 202606240016_agreement_otp_and_company.sql already declared it "no longer used" in June 2026. Live, every row holds
-- null (measured 12.10.2026: 0 of 6). The check below re-measures instead of assuming.
--
-- ⚠️ The `id-documents` STORAGE BUCKET STAYS. Despite its name it is the live legal-docs bucket: every approved
-- package-terms PDF is uploaded to it (src/lib/storage/legal-docs.ts, BUCKET = 'id-documents'; the row's pdf_ref holds
-- the path). Only the unused COLUMN is dropped here.
--
-- DEPLOY ORDER: either order is safe. The one reader (the SharePoint archive export, agreement-archive.ts) selects
-- '*' and fail-closed-narrows the row, so a missing key simply becomes null; the code change removing the exported
-- field ships with this migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check
-- leaves the column in place.
--
-- ROLLBACK: alter table public.signed_agreements add column id_document_ref text; every historical value was null,
-- so nothing needs restoring.

set local lock_timeout = '5s';

-- Refuse if any row holds a value (there has never been a writer; this guards against one appearing unnoticed).
do $$
declare v_values integer;
begin
  select count(*) into v_values from public.signed_agreements where id_document_ref is not null;
  if v_values <> 0 then
    raise exception 'id_document_ref: % row(s) hold a value', v_values;
  end if;
end $$;

-- Refuse if any database function names the column.
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\mid_document_ref\M';
  if v_readers <> 0 then
    raise exception 'id_document_ref: % function(s) name the column', v_readers;
  end if;
end $$;

alter table public.signed_agreements drop column id_document_ref;
