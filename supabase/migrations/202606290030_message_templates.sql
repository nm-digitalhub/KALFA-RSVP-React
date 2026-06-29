-- T0: message_templates — the outreach send-content the engine resolves by key.
--
-- The hole: outreach.ts getTemplateByKey reads public.message_templates, but the
-- table did not exist → outreach had nothing to send. C1/C2 depend on it.
--
-- Admin-managed (admin-only RLS); the service-role reader (getTemplateByKey)
-- bypasses RLS. SEEDED FAIL-CLOSED (active=false): nothing resolves/sends until
-- an admin fills the real Meta-APPROVED WhatsApp template name (or reviews the
-- call script) AND activates the row. message_key is UNIQUE so the reader's
-- maybeSingle() resolves exactly one row.

create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  message_key text not null unique,
  channel     public.campaign_channel not null,
  label       text,                            -- admin display (Hebrew)
  name        text not null default '',        -- WhatsApp: Meta-approved template name
  language    text not null default 'he',
  body        text,                            -- call script text / reference
  active      boolean not null default false,  -- fail-closed until configured
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.message_templates enable row level security;

drop policy if exists message_templates_admin_all on public.message_templates;
create policy message_templates_admin_all on public.message_templates for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop trigger if exists set_message_templates_updated_at on public.message_templates;
create trigger set_message_templates_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- Seed the 5 keys the live outreach_schedule references (fail-closed, active=false).
insert into public.message_templates (message_key, channel, label, language) values
  ('invite',     'whatsapp', 'הזמנה ראשונה',  'he'),
  ('reminder_1', 'whatsapp', 'תזכורת ראשונה', 'he'),
  ('reminder_2', 'whatsapp', 'תזכורת שנייה',  'he'),
  ('final',      'whatsapp', 'תזכורת אחרונה', 'he'),
  ('call_1',     'call',     'שיחת AI',       'he')
on conflict (message_key) do nothing;
