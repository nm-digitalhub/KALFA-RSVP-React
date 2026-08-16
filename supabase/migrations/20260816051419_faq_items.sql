-- FAQ items: DB-managed content for the public /faq page + the /admin/faq
-- management screen (scope-change 16.8.2026 — hardcoded FAQ copy is the same
-- violation as hardcoded business facts, and the owner extended the
-- no-hardcoded-facts rule to cover this page's copy itself).
--
-- Modeled on `packages` (the only other table with anon-readable rows,
-- verified live 16.8.2026: policy `packages_public_read`, roles
-- {anon,authenticated}, qual `(active = true)`):
--   - anon/authenticated SELECT gated by a DATA COLUMN (`published = true`),
--     not just app-layer filtering — RLS defends even if a caller queries
--     the table directly via PostgREST.
--   - admin write gated by has_role(...,'admin'), written directly in the
--     initplan-optimized scalar-subquery form the project standardized on
--     (migration 20260713143941_gap1_rls_initplan_optimization.sql) instead
--     of the plain form `packages` originally shipped with and had to be
--     ALTERed later — no separate optimization pass needed here.
--
-- Grants are TIGHTER than the `packages` precedent, deliberately.
-- `packages` currently grants anon INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER — not exploitable today only because RLS is the sole layer
-- blocking it (verified live 16.8.2026: `anon`/`authenticated` hold the full
-- write set via `has_table_privilege`/information_schema). That is the same
-- shape this project has revoked elsewhere on purpose (see
-- 20260719212652_revoke_write_grants_platform_rbac_tables.sql and
-- 20260721193019_revoke_app_settings_default_grants.sql) rather than repeat.
-- Schema-level default privileges hand a brand-new table the full write set
-- on anon+authenticated automatically, so this migration explicitly revokes
-- and re-grants only what is used: anon gets SELECT only; authenticated gets
-- SELECT plus the writes the admin UI needs (INSERT/UPDATE/DELETE) — RLS
-- still decides WHO among authenticated may actually write. Nobody but
-- postgres/service_role gets TRUNCATE/REFERENCES/TRIGGER.
--
-- `item_key` marks the ONE row (`pricing_no_response`) that carries the
-- legally-mandated unconditional-activation-fee disclosure (Consumer
-- Protection Law price-misrepresentation review, 2026-07-26 — the ₪200
-- activation fee must read as charged regardless of outcome). Its `answer`
-- column holds ONLY an optional supplementary note; the mandatory sentence
-- itself is code-owned (buildBusinessFacts().summary_he in
-- src/lib/fleet/business-facts.ts), so it can never go stale in the DB and
-- can never be edited, unpublished, or deleted from the admin UI
-- (src/app/(admin)/admin/faq/actions.ts re-reads item_key server-side by row
-- id before applying any patch — never trusts a client-submitted field for
-- that check).
--
-- `category` is a fixed 4-value enum (not free text) so the public page's IA
-- (4 fixed sections) can never silently fragment into ad-hoc categories.
--
-- `sort_order` is scoped WITHIN category (mirrors event_questions.sort_order,
-- which is scoped within one event) — not a single global ordering.
--
-- Additive + guarded; safe to re-run.

do $$ begin
  create type faq_category as enum ('about', 'pricing', 'how_it_works', 'legal_support');
exception when duplicate_object then null; end $$;

create table if not exists public.faq_items (
  id          uuid primary key default gen_random_uuid(),
  item_key    text unique,                 -- NULL for ordinary rows; set only for the protected item
  category    faq_category not null,
  question    text not null,
  answer      text not null default '',    -- '' allowed: the protected row's mandatory sentence is code-owned
  sort_order  int not null default 0,      -- scoped WITHIN category, like event_questions.sort_order
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists faq_items_category_sort_idx
  on public.faq_items (category, sort_order);

drop trigger if exists faq_items_set_updated_at on public.faq_items;
create trigger faq_items_set_updated_at before update on public.faq_items
  for each row execute function public.set_updated_at();

alter table public.faq_items enable row level security;

drop policy if exists faq_items_public_read on public.faq_items;
create policy faq_items_public_read on public.faq_items for select
  to anon, authenticated
  using (published = true);

drop policy if exists faq_items_admin_all on public.faq_items;
create policy faq_items_admin_all on public.faq_items for all
  to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)));

-- Grants — see header note; deliberately NOT the `packages` precedent.
revoke all on public.faq_items from anon;
revoke all on public.faq_items from authenticated;
grant select on public.faq_items to anon, authenticated;
grant insert, update, delete on public.faq_items to authenticated;

-- Seed the 12 DB-owned rows. Of the platform's 14 FAQ questions, 2 are fully
-- code-owned and never become rows at all (the price card and the
-- "guest/contact/reached" unit explainer — both derived live from
-- buildBusinessFacts(), see src/lib/faq/page-model.ts), and 1 more
-- (pricing_no_response, below) is only PARTIALLY DB-owned. Content sourced
-- verbatim from the fleet content-gathering pass (16.8.2026).
-- {channels_list} is a live token substituted at render
-- (src/lib/faq/tokens.ts) from packages.channels — never a hardcoded channel
-- name, so a future channel addition/removal updates this copy automatically.
insert into public.faq_items (item_key, category, question, answer, sort_order, published)
select * from (values
  (null::text, 'about'::faq_category, $q$מה זה KALFA?$q$,
    $q$KALFA היא מערכת לניהול אישורי הגעה (RSVP) לאירועים פרטיים ועסקיים. יוצרים אירוע, מעלים רשימת מוזמנים, שולחים הזמנות ב־{channels_list}, ועוקבים בזמן אמת אחרי מי מגיע, מי לא, וכמה מלווים — הכול במקום אחד, בלי גיליונות ובלי הודעות מפוזרות.$q$,
    1, true),
  (null, 'about', $q$לאילו סוגי אירועים אפשר להשתמש ב-KALFA?$q$,
    $q$לכל סוג אירוע: חתונה, בר מצווה, בת מצווה, ברית, בריתה, חינה, אירוסין, יום הולדת — וגם אירועים שאינם ברשימה, כמו כנסים ואירועי חברה, תחת הקטגוריה "אירוע אחר".$q$,
    2, true),
  (null, 'about', $q$באילו ערוצים נשלחות ההזמנות, ואיך אורחים מגיבים?$q$,
    $q$פנייה נעשית בערוצים: {channels_list}. בהודעת הוואטסאפ האורח לוחץ על אחד משלושה כפתורים מהירים — "מגיע/ה", "לא מגיע/ה", "אולי" — ובשיחת הטלפון עונה ישירות לסוכן ה-AI. אין צורך בהתקנת אפליקציה או הרשמה מצד האורח.$q$,
    3, true),
  (null, 'about', $q$האם האורחים צריכים להתקין משהו?$q$,
    $q$לא. האורחים רק עונים להודעת וואטסאפ רגילה או לשיחת טלפון — שום התקנה, שום הרשמה. בעל האירוע מנהל הכול מהדפדפן.$q$,
    4, true),

  ('pricing_no_response', 'pricing', $q$אם אף אחד לא יענה, האם עדיין אני משלם?$q$,
    $q$$q$,
    1, true),
  (null, 'pricing', $q$איך התשלום מתבצע בפועל?$q$,
    $q$באישור הקמפיין חותמים על הסכם דיגיטלי (עם אימות טלפון וחתימה אלקטרונית), ומאשרים אמצעי תשלום. הסכום נתפס כתפיסת מסגרת עד לתקרה המוסכמת בלבד, ולא נגבה באותו רגע. דמי ההפעלה נגבים כשהקמפיין מופעל בפועל; הפרש (אם יש) נגבה בסגירת הקמפיין לפי מספר הנענים בפועל — ולעולם לא מעבר לתקרה שאושרה.$q$,
    2, true),

  (null, 'how_it_works', $q$איך מוסיפים או מייבאים רשימת אורחים?$q$,
    $q$אפשר להוסיף אורחים ידנית, לייבא קובץ CSV, או לייבא ישירות מוואטסאפ. המערכת בונה טיוטת ייבוא שסוקרים ומאשרים לפני שהיא נכנסת לרשימה, ומזהה כפילויות מול אורחים קיימים.$q$,
    1, true),
  (null, 'how_it_works', $q$מתי נשלחות ההזמנות והתזכורות?$q$,
    $q$לוח זמנים קבוע: הזמנה 10 ימים לפני, תזכורת 6 ימים לפני, תזכורת נוספת 3 ימים לפני (וואטסאפ); שיחת AI יומיים לפני; הודעת וואטסאפ אחרונה יום לפני. לא נשלח בשבתות ובחגים — מתוזמן מחדש אוטומטית.$q$,
    2, true),
  (null, 'how_it_works', $q$איך יוצרים אירוע ומתחילים?$q$,
    $q$נרשמים בחינם, יוצרים אירוע (שם/תאריך/מקום), ממלאים פרטי בעלי השמחה, מוסיפים/מייבאים אורחים, ואז מפעילים אישורי הגעה — שלב שדורש חתימה על הסכם ואישור אמצעי תשלום. עד לאותו שלב לא נגבה דבר.$q$,
    3, true),

  (null, 'legal_support', $q$אפשר לבטל אחרי שחתמתי?$q$,
    $q$כן. זכות ביטול בכתב תוך 14 יום ממועד ההתקשרות או מקבלת ההסכם (המאוחר), ובכל מקרה עד יומיים (שאינם ימי מנוחה) לפני הפעלת הקמפיין. אנשים עם מוגבלות/אזרחים ותיקים (65+)/עולים חדשים (פחות מ־5 שנים) — עד 4 חודשים. דמי ביטול אפשריים: עד 5% או ₪100 — הנמוך מביניהם. החזר תוך 14 יום.$q$,
    1, true),
  (null, 'legal_support', $q$מי הבעלים של נתוני האורחים שלי, והאם הם בטוחים?$q$,
    $q$נתוני האורחים שייכים לכם. KALFA פועלת כמעבד מידע בשמכם ולא מוכרת מידע אישי לצד שלישי. פרטים מלאים במדיניות הפרטיות.$q$,
    2, true),
  (null, 'legal_support', $q$מה עושים אם יש שאלה או בעיה?$q$,
    $q$פנייה דרך עמוד יצירת הקשר — טופס פנייה או בקשת חזרה טלפונית.$q$,
    3, true)
) as v(item_key, category, question, answer, sort_order, published)
where not exists (select 1 from public.faq_items);
