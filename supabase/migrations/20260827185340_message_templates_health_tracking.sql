-- WhatsApp template health tracking: category (UTILITY/MARKETING/AUTHENTICATION),
-- quality score (GREEN/YELLOW/RED/UNKNOWN), Meta-side status, and rejection
-- reason, kept in sync from Meta's own signals (webhooks + a reconciliation
-- poll), not derived locally. `requested_category` is OUR snapshot of what we
-- asked Meta to classify the template as at submission time — Meta's API
-- itself does not expose "what was originally requested", only the current
-- (and, transiently, the pending/"correct") category, so a downgrade is
-- detected by comparing `category` against this stored value, not a DB
-- constraint. `pending_category_change_at` + `pending_correct_category` carry
-- Meta's ~24h advance warning (template_category_update, "impending" event)
-- before an automatic downgrade takes effect.

alter table public.message_templates
  add column if not exists meta_template_id text,
  add column if not exists category text,
  add column if not exists requested_category text not null default 'UTILITY',
  add column if not exists quality_score text,
  add column if not exists meta_status text,
  add column if not exists rejected_reason text,
  add column if not exists pending_category_change_at timestamptz,
  add column if not exists pending_correct_category text,
  add column if not exists last_synced_at timestamptz;

create index if not exists message_templates_meta_template_id_idx
  on public.message_templates (meta_template_id)
  where meta_template_id is not null;

comment on column public.message_templates.category is
  'Current category as last reported by Meta (UTILITY/MARKETING/AUTHENTICATION). Null = never synced.';
comment on column public.message_templates.requested_category is
  'Category we submitted/intend for this template — our own snapshot, not a Meta field. Compared against `category` to detect a downgrade.';
comment on column public.message_templates.quality_score is
  'Meta message_template_quality_update value: GREEN | YELLOW | RED | UNKNOWN.';
comment on column public.message_templates.meta_status is
  'Meta-side approval status: APPROVED | REJECTED | PENDING | DISABLED | ARCHIVED. Independent of `active` (our own send-activation toggle).';
comment on column public.message_templates.pending_category_change_at is
  'When set, Meta has scheduled an automatic category downgrade for this timestamp (template_category_update "impending" event) — not yet in effect.';
