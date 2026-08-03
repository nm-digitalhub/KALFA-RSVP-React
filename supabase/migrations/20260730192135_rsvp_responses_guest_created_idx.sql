-- rsvp_responses: אינדקס-מכסה ל-guest_id+created_at עבור שני ה-RPC-ים
-- הציבוריים העמוסים ביותר במוצר (submit_rsvp idempotency check,
-- get_rsvp_by_token latest-row lookup). שניהם בצורת (guest_id=, ORDER BY
-- created_at DESC, LIMIT 1) או תת-שאילתת-MAX מתואמת שקולה — בדיוק מה
-- ש-btree על (guest_id, created_at DESC) פותר בבדיקה יחידה.
--
-- לא משפר דבר מדיד היום (43 שורות = עמוד אחד, seq scan תמיד ייבחר) —
-- מוצדק ע"י צורת-השאילתה + גדילה אמיתית (append-only, שורה לכל עריכת-RSVP)
-- + עלות ON DELETE CASCADE מ-guests (סריקת-RI בכל מחיקת-אורח).
--
-- זהו האינדקס היחיד שנוסף מתוך סריקה של 41 ממצאי unindexed_foreign_keys —
-- כל שאר העמודות: (א) אפס שימוש-קוד אמיתי, (ב) כבר מכוסות ע"י composite
-- קיים כעמודה-מובילה, או (ג) מאחורי מדיניות RLS מסוג קריאת-פונקציה
-- (can_access_event וכו') שאינה sargable — הנחיית ה-advisor הגורפת
-- "אנדקס עמודות RLS" לא חלה על צורת-מדיניות כזו (הוכחה: events_org_idx,
-- שנוסף בעבר בדיוק מאותו נימוק, idx_scan=0 לצמיתות).
create index rsvp_responses_guest_created_idx
  on public.rsvp_responses (guest_id, created_at desc);
