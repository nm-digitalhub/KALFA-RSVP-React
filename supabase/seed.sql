-- Seed data for the LOCAL Supabase stack (supabase/config.toml [db.seed]: ./seed.sql).
--
-- Supabase runs this file after every migration, on the first `supabase start` and on every `supabase db reset`
-- (docs: local-development/seeding-your-database). As the guide advises, it holds data only, no schema statements, and
-- every statement can run twice with the same result.
--
-- What the migrations alone leave behind, and the app needs to run its customer flow locally:
--   1. the payment switches. Migration 202606240005 creates the app_settings row with payments_enabled = false, and
--      20261004120126 adds package_model_enabled = false: with either off, the setup has no package step and no payment.
--   2. a package that can be sold. The migrations leave the one active package (tier outcome_whatsapp) at price 0 with
--      no contact quota, so listPackageOffers (src/lib/data/package-offers.ts) offers nothing. The values below are the
--      production row's, read on 29.10.2026. Its name, channels and outreach schedule already equal production's after
--      the migrations (202606240012, 202606240013, 202606240014), so they are not repeated here.
--
-- Deliberately NOT seeded:
--   - users. Supabase documents creating a user on the server with auth.admin.createUser (service role); it does not
--     document inserting into auth.users. Users inserted there directly could not sign in on this stack (GoTrue:
--     "Database error finding user", 29.10.2026). Sign up in the app, or use FixtureScope.createAuthUser
--     (src/lib/testing/local-integration.ts), which calls auth.admin.createUser.
--   - the CardCom connection (cardcom_config). Its API name is a private credential and must not be committed. CardCom's
--     public sample credentials for the test terminal (OpenFields-Backend-Node config.json: terminal 1000,
--     ApiName cardtest1994) are refused by CardCom (LowProfile/Create ResponseCode 603, 29.10.2026). Set it on
--     /admin/integrations/cardcom after a reset; without it a package purchase goes to SUMIT.
--   - platform staff. Nobody has access to /admin after a reset until a role is granted.

-- Each step checks that it changed exactly the row it expects, and fails loudly otherwise: a migration that renames,
-- drops or duplicates that row must stop the reset, not leave a seed that quietly did nothing.
do $seed$
declare
  n integer;
begin
  -- 1. Payment switches (production: both on).
  update public.app_settings
     set payments_enabled      = true,
         package_model_enabled = true
   where id;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'seed: expected the one app_settings row (migration 202606240005), updated %', n;
  end if;

  -- 2. The customer package, as sold in production.
  update public.packages
     set price_with_vat = 200,
         contact_quota  = 200,
         description    = E'ניהול אישורי הגעה בוואטסאפ ובשיחות של סוכן בינה מלאכותית, עם ריכוז התשובות במקום אחד ותמונה ברורה של ההגעה הצפויה לאירוע.\r\n\r\nהאורחים מקבלים הזמנה ותזכורות בוואטסאפ עם קישור אישי לאישור הגעה ולציון מספר המבוגרים והילדים. בהתאם להגדרות האירוע, ניתן לציין גם העדפת אוכל והערות. לצד ההודעות, סוכן בינה מלאכותית מקיים שיחות בעברית ואוסף את פרטי ההגעה.\r\n\r\nהתשובות מתרכזות בעמוד האירוע, שבו אפשר לעקוב אחר אישורי ההגעה, לראות מי עדיין לא השיב ולהיערך מול האולם והקייטרינג לפי הנתונים שנאספו.'
   where tier = 'outcome_whatsapp';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'seed: expected exactly one outcome_whatsapp package (migration 202606240009), updated %', n;
  end if;

  -- The same test listPackageOffers applies: without it the setup would offer no package and only the UI would show it.
  select count(*) into n
    from public.packages
   where tier = 'outcome_whatsapp'
     and active
     and contact_quota >= 1
     and price_with_vat > 0
     and cardinality(channels) > 0;
  if n <> 1 then
    raise exception 'seed: the outcome_whatsapp package is not an offer after the seed (active, quota, price, channels)';
  end if;
end
$seed$;
