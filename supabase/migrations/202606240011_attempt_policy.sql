-- Attempt/escalation policy (§10 + §17). The ADMIN defines it on the template;
-- it is copied + locked onto the campaign at creation. Sequence is WhatsApp-first
-- → wait → AI call; a verified human response stops everything (§301). The owner
-- does NOT set these — they belong to the chosen service track.

-- Policy on templates (packages).
alter table public.packages
  add column if not exists whatsapp_attempts            integer,
  add column if not exists whatsapp_reminder_gap_hours  integer,
  add column if not exists escalation_delay_seconds     integer,
  add column if not exists call_attempts                integer,
  add column if not exists call_retry_gap_hours         integer;

-- Standard profile defaults on the campaign templates (placeholders; admin tunes
-- per track in Phase 6): WhatsApp initial + 1 reminder @24h → escalate after 48h
-- → up to 2 calls @4h.
update public.packages
set whatsapp_attempts           = 2,
    whatsapp_reminder_gap_hours = 24,
    escalation_delay_seconds    = 172800, -- 48h
    call_attempts               = 2,
    call_retry_gap_hours        = 4
where price_per_reached is not null;

-- Locked copy on campaigns (escalation_delay_seconds already exists from _0007).
alter table public.campaigns
  add column if not exists whatsapp_attempts            integer,
  add column if not exists whatsapp_reminder_gap_hours  integer,
  add column if not exists call_attempts                integer,
  add column if not exists call_retry_gap_hours         integer;
