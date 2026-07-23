-- Extend contact_messages into the single customer-inquiry entity:
-- status workflow (same app-level vocabulary as callback_requests),
-- optional link to the signed-in submitter, and support-drafter fields.
-- Additive + nullable/default only; table has 0 rows in production —
-- zero behavior change for existing readers (they select explicit columns).

alter table public.contact_messages
  add column if not exists status text not null default 'new',
  add column if not exists topic text,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists handled_at timestamptz,
  add column if not exists internal_note text,
  add column if not exists draft_reply text,
  add column if not exists draft_created_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists sent_reply text;

comment on column public.contact_messages.status is
  'App-level vocabulary (validation/admin.ts CALLBACK_STATUSES): new / in_progress / done / cancelled. Free text by design, like callback_requests.status.';
comment on column public.contact_messages.user_id is
  'Signed-in submitter, attached server-side from the session — never client-supplied. NULL = anonymous public form.';
comment on column public.contact_messages.draft_reply is
  'support-drafter proposed reply. Draft only — never auto-sent to the customer.';
comment on column public.contact_messages.sent_reply is
  'The reply actually sent to the customer (by a human action); replied_at is its timestamp.';

-- FK lookups + admin status filtering.
create index if not exists contact_messages_user_id_idx on public.contact_messages (user_id);
create index if not exists contact_messages_status_idx on public.contact_messages (status);

-- RLS: deliberately UNCHANGED. INSERT stays authenticated-only
-- (cm_insert_authenticated); anonymous submissions go through the
-- service-role Server Action, never straight to PostgREST.
