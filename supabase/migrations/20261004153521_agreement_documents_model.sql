-- =====================================================================
-- Agreement documents: one contract PER PRICING MODEL.
--
-- The table held a single contract (the pay-per-result one). The fixed-price
-- package model needs its OWN contract, and its wording must be managed from
-- /admin/agreement as data — not hardcoded in code.
--
--   model = 'per_result' : the existing pay-per-result contract (v2…v5).
--                          Exactly as before: one row, is_active, body_html
--                          NULL = "vetted in-code default".
--   model = 'package'    : the fixed-price package contract (2026-10-v6).
--                          ONE row, managed in place. body_html is REQUIRED
--                          (there is no in-code package text). is_active has no
--                          meaning for it: it is offered to a customer only
--                          while status = 'approved'.
--
-- DEPLOY-ORDER SAFETY. The code that is live today reads
--   .eq('is_active', true).maybeSingle()
-- and falls back to the legacy v3 draft when that returns more than one row.
-- So the package row is seeded is_active = FALSE: before the new code ships,
-- the live code still sees exactly one active row (the per-result contract)
-- and nothing changes for customers. The existing unique index
-- agreement_documents_active_uniq is deliberately left alone.
--
-- The seeded package document is a DRAFT. A draft package document is never
-- offered to a customer (the data layer requires status = 'approved'); the
-- owner reviews and approves it in /admin/agreement. Body tokens
-- ({{packagePrice}}, {{contactQuota}}, {{company.*}}, ...) are substituted at
-- render time from the campaign snapshot and admin config, so no figure is
-- written into the text.
--
-- Additive + guarded; safe to re-run.
--
-- ROLLBACK (manual, in this order):
--   delete from public.agreement_documents where model = 'package';
--   drop index if exists public.agreement_documents_single_package_uniq;
--   alter table public.agreement_documents drop constraint if exists agreement_documents_model_shape;
--   alter table public.agreement_documents drop column model;
-- =====================================================================

alter table public.agreement_documents
  add column if not exists model text not null default 'per_result'
  check (model in ('per_result', 'package'));

-- A package document is meaningless without its own body and a package
-- version; a per-result document must not carry the package version.
alter table public.agreement_documents
  drop constraint if exists agreement_documents_model_shape;
alter table public.agreement_documents
  add constraint agreement_documents_model_shape check (
    (model = 'package'    and body_html is not null and version in ('2026-10-v6', 'draft-2026-10-v6'))
    or
    (model = 'per_result' and version not in ('2026-10-v6', 'draft-2026-10-v6'))
  );

-- At most one package document (it is managed in place, like the per-result one).
create unique index if not exists agreement_documents_single_package_uniq
  on public.agreement_documents (model) where model = 'package';

-- Seed the package contract as an inactive DRAFT (token form), only if there is none.
insert into public.agreement_documents (version, body_html, status, is_active, model)
select 'draft-2026-10-v6', $agreement_body$

  <h1>הסכם אישור קמפיין ושירות — KALFA</h1>
  <div class="sub">חבילה במחיר קבוע — תשלום חד‑פעמי · גרסה {{version}}</div>

  <h2>1. הצדדים</h2>
  <p>הסכם זה בין <strong>{{company.name}}</strong> (ח.פ./ע.מ. {{company.id}}), מרחוב {{company.address}} ("נותנת השירות" / "KALFA"), לבין הלקוח המאשר את ההסכם ("הלקוח"), עבור האירוע <strong>{{eventName}}</strong>.</p>
  <p>פרטי קשר לפניות, תמיכה וביטול: טלפון {{company.contactPhone}} · דוא"ל {{company.contactEmail}}.</p>

  <h2>2. תיאור השירות</h2>
  <p>KALFA מפעילה עבור הלקוח קמפיין אישורי הגעה (RSVP) לאורחי האירוע, בשני ערוצי תקשורת: {{channels}}. השירות פונה לאנשי הקשר ברשימת המוזמנים ואוסף את תגובותיהם.</p>

  <h2>3. המחיר והחיוב</h2>
  <dl class="terms">
    <dt>מחיר החבילה</dt><dd>{{packagePrice}} — תשלום אחד, חד‑פעמי. מחיר סופי; לא נגבה מע"מ (עוסק פטור).</dd>
    <dt>מכסת אנשי קשר</dt><dd>עד {{contactQuota}} אנשי קשר שהקמפיין רשאי לפנות אליהם (בהודעה או בשיחה), בין אם השיבו ובין אם לא.</dd>
    <dt>חלון פעילות</dt><dd>{{windowText}}</dd>
  </dl>
  <div class="intent">
    המחיר קבוע ונקבע מראש: הוא אינו תלוי במספר אנשי הקשר שהשיבו בפועל ואינו משתנה במהלך הקמפיין. <strong>הקמפיין פונה לכל היותר למספר אנשי הקשר שבמכסה.</strong> אנשי קשר שנוספו לרשימה מעבר למכסה ממתינים ואינם מקבלים פנייה.
  </div>
  <p>איש קשר נספר במכסה פעם אחת באותו אירוע, גם אם פנינו אליו ביותר מפעם אחת או ביותר מערוץ אחד.</p>

  <h2>4. תשלום</h2>
  <p>הלקוח מאשר חיוב כרטיס האשראי שלו <strong>פעם אחת, בסכום מחיר החבילה ({{packagePrice}})</strong>, במועד הרכישה לאחר אישור תנאים אלה. לא תבוצע תפיסת מסגרת ולא ייגבו דמי הפעלה או תשלום לפי תוצאות. לא יבוצע חיוב נוסף בגין החבילה, למעט שדרוג שהלקוח יבחר בו במפורש. קבלה תישלח לכתובת הדוא"ל של הלקוח.</p>
  <p>פרטי הכרטיס מוזנים בטופס מאובטח של ספק הסליקה. KALFA שומרת אסמכתא (טוקן) לאמצעי התשלום, את ארבע הספרות האחרונות ואת תוקף הכרטיס, ואת מספר הזהות של בעל הכרטיס בכספת מוגנת; מספר הכרטיס המלא וקוד האבטחה (CVV) אינם נשמרים.</p>
  <p>בוטלה העסקה עקב פגם, אי‑התאמה או הפרה של KALFA — יושבו ללקוח מלוא התשלומים ששולמו, בהתאם לחוק הגנת הצרכן. אין באמור בסעיף זה כדי לגרוע מזכויות הביטול שבסעיף 5.</p>

  <h2>5. זכות ביטול (חוק הגנת הצרכן §14ג)</h2>
  <p>הלקוח רשאי לבטל את העסקה בכתב (לפרטי הקשר בסעיף 1) בתוך <strong>14 ימים</strong> ממועד ההתקשרות או מקבלת מסמך זה, לפי המאוחר; ובכל מקרה עד <strong>שני ימים (שאינם ימי מנוחה) לפני מועד הפעלת הקמפיין</strong> — שכן הפעלת הקמפיין מהווה תחילת מתן השירות.</p>
  <p><strong>הארכה:</strong> אדם עם מוגבלות, אזרח ותיק (גיל 65+) או עולה חדש (פחות מ‑5 שנים בישראל) רשאי לבטל בתוך <strong>4 חודשים</strong>, בכפוף לתנאי החוק.</p>
  <p>דמי ביטול: עד 5% מערך העסקה או ₪100.00, לפי הנמוך. החזר כספי יבוצע בתוך 14 ימים מקבלת הודעת הביטול, באמצעי התשלום המקורי. לאחר תחילת מתן השירות, ניתן לחייב על שירות שכבר ניתן.</p>
  <p>לעניין הסכם זה, תחילת מתן השירות היא שליחת ההודעה או ביצוע השיחה הראשונה לאורחים.</p>

  <h2>6. אחריות</h2>
  <p>{{company.warrantyText}}</p>

  <h2>7. פרטיות ומידע אישי</h2>
  <p>נתוני האורחים (טלפונים ותגובות) הם בבעלות הלקוח, שהוא <strong>בעל המאגר</strong> לגביהם; KALFA פועלת כ<strong>מחזיק/מעבד</strong> בשמו. לגבי נתוני האישור של הלקוח (שם, כתובת IP ומזהה דפדפן) KALFA היא בעלת השליטה. עיבוד המידע נעשה למטרת מתן השירות בלבד, ובהתאם ל{{privacyLink}} ול{{termsLink}}.</p>
  <p>בהתאם לחוק הגנת הפרטיות (כולל תיקון 13), <strong>כתובת IP ומזהי מכשיר נחשבים מידע אישי</strong>; הלקוח מאשר את איסופם ושמירתם כמפורט בסעיף 9 (ראיה). KALFA מיישמת אבטחת מידע לפי תקנות הגנת הפרטיות (אבטחת מידע), התשע"ז‑2017.</p>

  <h2>8. הצהרת הלקוח לגבי פנייה לאורחים</h2>
  <p>הלקוח מצהיר ומתחייב כי קיים לו בסיס חוקי לפנות לאורחים אלה, וכי מספרי הטלפון הושגו כדין. ההודעות הן הזמנת RSVP אישית ואינן כוללות פרסום או מיתוג של KALFA. כל בקשת הסרה תכובד בכל ערוץ. הלקוח <strong>משפה</strong> את KALFA בגין כל תביעה הנובעת מהפרת הצהרה זו (לרבות לפי §30א לחוק התקשורת).</p>

  <h2>9. עוגן ראייתי לאישור</h2>
  <p>הצדדים מסכימים כי לצורך הוכחת ההסכמה, KALFA רושמת ושומרת את הראיות הבאות, והלקוח מסכים כי הן מהוות ראיה קבילה להסכמתו: <strong>אישור התנאים באתר, בסימון תיבת האישור</strong>; <strong>זהות המשתמש המחובר</strong>; <strong>כתובת ה‑IP</strong>; <strong>מזהה הדפדפן/מכשיר</strong> (User‑Agent); <strong>חותמת‑זמן השרת</strong>; וכן גרסת ההסכם וטביעת ה‑hash (SHA‑256) של המסמך המאושר.</p>

  <div class="intent">
    10. הצהרת כוונה: הלקוח מצהיר כי קרא והבין הסכם זה, מסכים לתנאיו, ומתחייב באופן מחייב לתשלום כמפורט. האישור באתר, בסימון תיבת האישור, מהווה הסכמה מחייבת.
  </div>$agreement_body$, 'draft', false, 'package'
where not exists (
  select 1 from public.agreement_documents where model = 'package'
);
