-- WhatsApp template components (RSVP subset): Payload / Body / Header / URL.
--
-- Additive + reversible: a nullable jsonb describing, per template, which
-- send-time components it carries and which send-context value each binds to.
-- NULL ⇒ a bare template (today's behavior), so existing rows are unaffected.
-- Shape + validation live in src/lib/whatsapp/template-spec.ts (Zod is the
-- single source of truth; the column is intentionally schemaless jsonb so the
-- app validates on write). No RLS change — message_templates is already
-- admin-managed under its existing policies.

alter table public.message_templates
  add column if not exists components jsonb;

comment on column public.message_templates.components is
  'Per-template WhatsApp send-time component spec (header/body_vars/buttons) as DATA. Shape validated by src/lib/whatsapp/template-spec.ts. NULL = bare template.';
