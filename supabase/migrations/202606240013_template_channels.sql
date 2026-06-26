-- The channels a service track offers are DATA on the template (admin-defined),
-- not hard-coded in the UI. The campaign's allowed_channels must be a subset of
-- the chosen template's channels (enforced server-side). Seed the active
-- template with both channels (§1).
alter table public.packages
  add column if not exists channels public.campaign_channel[];

update public.packages
set channels = '{whatsapp,call}'::public.campaign_channel[]
where price_per_reached is not null;
