-- Follow-up to 20260816051419_faq_items.sql, driven by a spec addendum that
-- landed after that migration was applied:
--
-- 1. Token syntax unification. The app has exactly ONE `{{token}}`
--    substitution mechanism (src/lib/text/substitute-tokens.ts, extracted
--    from src/lib/agreements/template.ts's existing regex) — the FAQ page no
--    longer has its own parallel `{single_brace}` engine. The two seeded rows
--    that embed {channels_list} (about, "מה זה KALFA?" and "באילו ערוצים
--    נשלחות ההזמנות") are rewritten here to the double-brace form so the live
--    content matches the code that now renders it.
--
-- 2. `is_structural`: a general protection flag, generalizing the ad-hoc
--    item_key='pricing_no_response' special-case from the first migration.
--    `is_structural = true` marks a row whose WORDING carries legal weight
--    the admin UI must not let disappear silently:
--      - no delete button, ever (enforced in the DAL, not just the UI)
--      - every edit is written to activity_log (src/lib/data/activity.ts)
--      - the admin form shows a persistent warning banner
--    This is a STRICT SUPERSET of, not a replacement for, the item_key
--    check: `pricing_no_response` is is_structural=true AND ALSO gets the
--    additional Tier-1 lockout (its `answer` column holds only an optional
--    supplement, never the mandatory sentence; `published` cannot be
--    unset) — that extra layer stays keyed on item_key specifically, in the
--    DAL, because it is not generic "be careful editing this" but a hard
--    legal requirement for exactly one row.
--
--    Two rows are marked is_structural here:
--      - pricing_no_response (already Tier-1 via item_key; now also flagged
--        so the admin UI's generic "structural" banner/no-delete/audit
--        logic covers it via the same mechanism as the row below, rather
--        than two separate code paths).
--      - the §14ג cancellation-rights row (legal_support, "אפשר לבטל אחרי
--        שחתמתי?") — free DB text (no live-data gate applies to it, unlike
--        the pricing rows), but the wording is a statutory disclosure
--        (Consumer Protection Law §14ג), so it gets the warning+audit+
--        no-delete treatment WITHOUT the extra answer-field lockout that is
--        specific to the pricing disclosure.
--
-- Additive + idempotent; safe to re-run.

alter table public.faq_items
  add column if not exists is_structural boolean not null default false;

update public.faq_items
  set answer = replace(answer, '{channels_list}', '{{channels_list}}')
  where answer like '%{channels_list}%'
    and answer not like '%{{channels_list}}%';

update public.faq_items
  set is_structural = true
  where item_key = 'pricing_no_response';

update public.faq_items
  set is_structural = true
  where category = 'legal_support'
    and question = 'אפשר לבטל אחרי שחתמתי?';
