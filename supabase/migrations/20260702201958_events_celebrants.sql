-- Per-event-type celebrant names (חתן/כלה, חתן בר-מצווה, הורים+תינוק, ...).
-- Feeds the WhatsApp template parameters ({{2}}/{{3}} — see
-- docs/whatsapp-templates-meta-submission.md) and the event UI.
--
-- Nullable by decision: a regular event can be created without celebrants;
-- they become REQUIRED only when enabling the RSVP campaign (the gate lives
-- in createCampaign, app layer). Shape is validated by Zod per event_type
-- (src/lib/validation/schemas.ts, celebrantsSchemaFor) — the column is
-- intentionally schemaless jsonb, same precedent as packages.outreach_schedule
-- and message_templates.components. No RLS change: events' existing owner/org
-- policies already cover the new column (RLS is row-level).
alter table public.events
  add column if not exists celebrants jsonb;

comment on column public.events.celebrants is
  'Per-event-type celebrant names as DATA. Shape (couple/single/parents/free) is keyed on event_type and validated by src/lib/validation/schemas.ts. NULL = not filled yet (blocks campaign enablement only).';
