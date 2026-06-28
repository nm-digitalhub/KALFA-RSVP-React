-- =====================================================================
-- Agreement (contract) document store — moves the contract OUT of code.
-- The campaign agreement was a hardcoded HTML template in
-- src/lib/agreements/template.ts (clause wording + a draft marker + a
-- 'draft-…' version). This table makes the version, status (draft/approved)
-- and an OPTIONAL custom body editable DATA, managed from /admin/agreement.
--
-- body_html NULL  → render uses the vetted in-code default template (safe).
-- body_html set   → render uses the custom HTML (with {{token}} substitution).
-- The draft marker is appended by the RENDERER when status='draft', so the
-- Approve action removes it regardless of who edited the body.
--
-- Additive + guarded; safe to re-run. RLS: platform staff only (the rendered
-- agreement reaches customers via server-side render, never a direct read).
-- =====================================================================

do $$ begin
  create type agreement_status as enum ('draft','approved');
exception when duplicate_object then null; end $$;

create table if not exists public.agreement_documents (
  id          uuid primary key default gen_random_uuid(),
  version     text not null,
  body_html   text,                                  -- NULL = vetted in-code default
  status      agreement_status not null default 'draft',
  is_active   boolean not null default true,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one active document at a time.
create unique index if not exists agreement_documents_active_uniq
  on public.agreement_documents (is_active) where is_active;

drop trigger if exists agreement_documents_set_updated_at on public.agreement_documents;
create trigger agreement_documents_set_updated_at before update on public.agreement_documents
  for each row execute function public.set_updated_at();

alter table public.agreement_documents enable row level security;
drop policy if exists agreement_documents_admin_all on public.agreement_documents;
create policy agreement_documents_admin_all on public.agreement_documents for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- Seed the active draft document. body_html NULL → the render path falls back
-- to the vetted in-code default template; version mirrors the old constant.
insert into public.agreement_documents (version, body_html, status, is_active)
  select 'draft-2026-06-v2', null, 'draft', true
  where not exists (select 1 from public.agreement_documents where is_active);
