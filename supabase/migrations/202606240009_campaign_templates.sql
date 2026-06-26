-- Commercial templates carry the recommended price-per-reached (§17). The owner
-- SELECTS a template and APPROVES the price; the price is read server-side and
-- copied+locked onto the campaign at creation (§7, §8.1, §18.7/§18.8) — never
-- entered by the client. `packages` IS the template table (§17).
alter table public.packages
  add column if not exists price_per_reached numeric;

-- Record which template a campaign was created from (the price itself is copied
-- into campaigns.price_per_reached and locked).
alter table public.campaigns
  add column if not exists template_id uuid references public.packages(id);

-- Seed two outcome-based campaign templates so the selector is functional.
-- ⚠️ price_per_reached values here are PLACEHOLDERS (spec example ₪4); KALFA sets
-- the real prices via the admin templates screen (Phase 6). Templates are the
-- active packages that have a non-null price_per_reached.
insert into public.packages
  (name, tier, category, price_with_vat, includes, sort_order, active, price_per_reached)
values
  ('מסלול וואטסאפ — חיוב לפי תוצאה', 'outcome_whatsapp', 'campaign', 0, '[]'::jsonb, 10, true, 4),
  ('מסלול וואטסאפ + שיחות AI — חיוב לפי תוצאה', 'outcome_full', 'campaign', 0, '[]'::jsonb, 11, true, 6)
on conflict do nothing;
