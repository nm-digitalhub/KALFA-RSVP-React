# חוזה-נתונים — טבלת `webhook_inbox`

> מקור: מיגרציה `supabase/migrations/202606290035_webhook_inbox.sql` (סכמה),
> `supabase/migrations/202606300036_webhook_claim_skip_locked.sql` (קליטה ע"י worker),
> `docs/schema-and-architecture.md §webhook_inbox`. אומת מול ה-DB החי (13 עמודות).

`webhook_inbox` היא תיבת-קלט עמידה (append-only) לאירועי-webhook מספקים חיצוניים —
WhatsApp/Meta תחילה. הדפוס הוא **persist-then-process**: ה-route מאמת חתימה, מנרמל,
ועושה INSERT לכאן ומחזיר 200 מהר; worker (pg-boss) מעבד את השורות מחוץ-לבקשה כך
שהלוגיקה העסקית לעולם אינה תלויה באורך-חיי ה-HTTP request של Meta.

ה-`payload` הגולמי מכיל **PII** (טלפונים/שמות) → RLS לאדמין-בלבד + כתיבות service-role.
**אסור ללוגג** payload, dedupe_key, message_id, או טלפון.

---

## עמודות

| עמודה | טיפוס | Nullable | משמעות |
|---|---|---|---|
| `id` | `uuid` | לא (PK) | מזהה שורה. ברירת-מחדל `gen_random_uuid()`. |
| `provider` | `text` | לא | מזהה הספק. ברירת-מחדל `'whatsapp'`. חלק מ-UNIQUE. |
| `event_kind` | `text` | לא | סוג האירוע. וואטסאפ: `'message'` (הודעה נכנסת), `'status'` (status callback של הודעה יוצאת), ארבעת סוגי ה-template-health (`template_status` / `template_category` / `template_category_misuse` / `template_quality`), ו**כל שדה Meta אחר שהאפליקציה מנויה עליו — נשמר גנרית תחת שם השדה כפי שהוא** (`account_update`, `business_username_updates`, `phone_number_quality_update`, `user_preferences`, `security`, `calls`, …; שינוי `messages` ללא `messages`/`statuses` נשמר כ-`messages_other`). מאז 2026-09-03 שום שדה חתום שמגיע מ-Meta לא נזרק. ל-worker אין handler לסוגים הגנריים — הוא מסמן אותם `processed` ללא פעולה. |
| `dedupe_key` | `text` | לא | מפתח אידמפוטנטיות לכל אירוע. חלק מ-UNIQUE. ראה תבניות למטה. |
| `message_id` | `text` | כן | ה-wamid של ההודעה. בנכנס — ה-wamid הנכנס; ב-status — ה-wamid של ההודעה היוצאת שעליה הסטטוס. |
| `context_message_id` | `text` | כן | רק לנכנס: `context.id` — ה-wamid היוצא שאליו ההודעה הנכנסת מגיבה (יעד-התגובה). בסיס לזיהוי-תגובה מדויק. |
| `phone_number_id` | `text` | כן | מזהה מספר-הטלפון העסקי ב-WABA שקיבל את האירוע. **מזהה טכני, לא PII** — ניתן לחיפוש. |
| `event_at` | `timestamptz` | כן | חותמת-הזמן שדיווחה Meta על האירוע (לא תמיד קיימת). |
| `payload` | `jsonb` | לא | האירוע הגולמי כפי שהתקבל מ-Meta. **PII** → admin-only RLS, לא נלוגג, מוקרן רק ב-detail. **מאז 2026-09-03:** לשורות `message` מצורף גם `sender_contact` ולשורות `status` — `recipient_contact`: האיבר הראשון של בלוק `value.contacts[]` של Meta (`profile.name`, `profile.username`, `wa_id`, `user_id` = BSUID, `parent_user_id`), כשהוא קיים. המפתחות נבחרו כך שלא יתנגשו ב-`contacts` של הודעה מסוג כרטיס-קשר. |
| `received_at` | `timestamptz` | לא | מתי השורה נקלטה אצלנו. ברירת-מחדל `now()`. מפתח-המיון של הרשימה ושל ה-drain. |
| `processed_at` | `timestamptz` | כן | מתי ה-worker סיים לעבד. `NULL` = טרם עובד (תנאי-ה-claim). |
| `attempts` | `int` | לא | מונה ניסיונות-עיבוד. ברירת-מחדל `0`. תקרת dead-letter = `5` (`attempts < 5` ב-claim). |
| `last_error` | `text` | כן | הודעת-השגיאה מהניסיון האחרון (אם נכשל). `NULL` בהצלחה/ממתין. |

`UNIQUE(provider, dedupe_key)` — ערובת DB לאידמפוטנטיות: retry של Meta על אותו אירוע
= no-op (insert עם `ignoreDuplicates`).

---

## תבניות `dedupe_key`

| `event_kind` | תבנית | דוגמה | למה |
|---|---|---|---|
| `message` | `wa-msg:<wamid>` | `wa-msg:wamid.HBgL...` | הודעה נכנסת אחת = wamid אחד = שורה אחת. |
| `status` | `wa-status:<wamid>:<status>` | `wa-status:wamid.HBgL...:delivered` | אותו wamid מקבל כמה סטטוסים (`sent`→`delivered`→`read`). ה-`<status>` במפתח הופך כל מעבר לשורה נפרדת — אחרת ה-UNIQUE היה בולע את ההיסטוריה. |
| `message`/`status` **ממסירת Test של ה-App Dashboard** (`entry.id = "0"` או `phone_number_id = "123456123"`) | המפתח הרגיל + `:test:<Date.now()>` | `wa-msg:ABGGFlA5Fpa:test:1756930000000` | ה-payload לדוגמה של Meta זהה בכל לחיצה (אותו wamid); בלי הסיומת כל לחיצה אחרי הראשונה הייתה no-op שקט ותרחישי ה-usernames/BSUID לא היו ניתנים לבדיקה. מסירות אמיתיות לעולם לא נושאות את המזהים האלה. |
| `template_*` | `wa-tmpl:<kind>:<template_id>:<entry.time>` | `wa-tmpl:template_status:123:1700000000` | retry של אותה מסירה חוזר על `time` → no-op; שינוי מצב אמיתי מאוחר יותר נושא `time` חדש ונשמר. |
| כל שדה אחר (גנרי) | `wa-field:<kind>:<entry.id>:<entry.time\|na>:<sha256(value)[0:16]>` | `wa-field:business_username_updates:9909...:1756900000:3f2a9c1e7b4d0a5c` | ה-hash של ערך השינוי הופך retry של אותה מסירה ל-no-op, ושני אירועים שונים שחולקים `time` נשמרים שניהם. |

> **מסירות שנדחו** (חתימה לא תקינה → 401, גוף לא-JSON → 400) **לא נכתבות** לטבלה (fail-closed, הגוף לא מאומת) — אבל מאז 2026-09-03 הן מייצרות התראת Slack ids-only (`reason`, `bytes`; לעולם לא הגוף/טלפון/חתימה), כדי שאי-התאמת secret או שולח זר לא ייראו כ"שקט".

ערכי `status` אפשריים: `sent` · `delivered` · `read` · `failed`.

> **שתי שכבות-dedup נפרדות — לא לבלבל:**
> - `webhook_inbox` → **`UNIQUE(provider, dedupe_key)`** (שכבת-הקליטה; מונע כפילות-קליטה של אירועי-Meta).
> - `contact_interactions` → **`UNIQUE(channel, provider_id)`** (שכבת-העיבוד, **טבלה אחרת**; מונע חיוב-כפול כש-worker מעבד אותה הודעה פעמיים).

---

## המעטפה הגולמית — `webhook_deliveries` (מאז 2026-09-03)

`webhook_inbox` מחזיק **אירוע מנורמל אחד לשורה** (הודעה / סטטוס / תבנית / שדה גנרי). המעטפה של
Meta מסביב (`object`, `entry[].id` = WABA, `entry[].time`, `metadata.display_phone_number`,
`contacts[]`, `messaging_product`) נשמרת בנפרד, **פעם אחת לכל POST מאומת**, ב-`webhook_deliveries`:

| עמודה | טיפוס | משמעות |
|---|---|---|
| `id` | `uuid` PK | |
| `provider` | `text` | `'whatsapp'` |
| `body` | `jsonb` | גוף ה-POST כפי שהתקבל, אחרי אימות חתימה. **PII**. |
| `body_sha256` | `text` | `UNIQUE(provider, body_sha256)` — retry זהה של Meta = no-op, אותה שורה. |
| `byte_length` | `int` | אורך הגוף בבייטים. |
| `received_at` | `timestamptz` | |

`webhook_inbox.delivery_id uuid null → webhook_deliveries(id) on delete set null` מקשר כל שורה
מנורמלת למעטפה שלה. `NULL` = שורה מלפני 3.9.2026, או כשל בשמירת המעטפה (המעטפה היא עותק
אבחוני; כשל בה לעולם לא חוסם את האירועים עצמם). RLS: קריאה ל-admin בלבד (`has_role`),
כתיבה service_role. מסירות שנדחו (401/400) **לא** נשמרות — גוף לא מאומת הוא קלט לא אמין.

הפופאפ ב-`/admin/webhooks` מציג את שניהם: "האירוע כפי שנשמר (מנורמל)" ו"מה ש-Meta שלחה בפועל".

## עמודות נלוות שנוספו במיגרציה `20260903214126`

- `contact_interactions.billing_outcome text` — תוצאת ה-RPC `try_record_billed_result` על
  ההודעה הנכנסת שהפעילה אותו (`billed` / `not_active` / `not_authorized` / `already_billed` / …).
  `billable=true` הוא הסיווג; זו התוצאה בפועל. `NULL` = לא טריגר לחיוב, או נרשם לפני 4.9.2026.
- `guest_import_staging.source_message_id text` (+ unique partial index) — ה-wamid הנכנס שממנו
  נקלטה רשימת מוזמנים. עיבוד-מחדש של אותה הודעה = no-op (בלי רשימה כפולה, בלי תשובה נוספת).

## אינדקסים

| אינדקס | הגדרה | משרת |
|---|---|---|
| `webhook_inbox_unprocessed_idx` | `(received_at) WHERE processed_at IS NULL` | מסלול ה-worker: שורות לא-מעובדות, ישנות-קודם. **partial** — קל ככל שהתור מתנקז. |
| `webhook_inbox_received_idx` | `(received_at DESC)` | מסלול רשימת-האדמין: כל השורות, חדשות-קודם. |

---

## אבטחה — RLS וגישה

- **RLS מופעל.** מדיניות יחידה `webhook_inbox_admin_all` (`FOR ALL`): `USING` + `WITH CHECK` = `has_role(auth.uid(), 'admin')`. ללא שום מדיניות, RLS-מופעל מחזיר אפס שורות לתפקיד ה-cookie — אז המדיניות גם נחוצה למקרה גישה דרך session.
- **קורא האדמין** (`src/lib/data/admin/webhook-inbox.ts`) משתמש ב-`createAdminClient` (service-role, **עוקף RLS**) מאחורי `requireAdmin()`. ה-RLS הוא defense-in-depth, לא ההגנה היחידה. הקריאה מקרינה עמודות-תצוגה בלבד; `payload` נשלף רק ב-detail (`getWebhookInboxItem`).
- **ה-worker** קולט שורות דרך RPC `claim_webhook_events(_limit)` — `SECURITY DEFINER` (רץ כ-owner, עוקף את ה-RLS של הטבלה), `EXECUTE` נעול ל-`service_role` בלבד (revoke מ-public/anon/authenticated). ה-RPC מחזיר את הישנות-ביותר ש-`processed_at IS NULL AND attempts < 5`, נועל `FOR UPDATE SKIP LOCKED` כך ש-workers חופפים מקבלים קבוצות זרות.

---

## הרחבת `contact_interactions` (נלווה למיגרציה זו)

באותה מיגרציה הורחבה `contact_interactions` במקום טבלת-יוצא מקבילה (ה-wamid היוצא כבר
נשמר כ-`provider_id`):

- `guest_id uuid → guests(id)` — מאפשר RSVP-מכפתור (קישור אינטראקציה לאורח).
- `context_message_id text` — לנכנס: ה-wamid היוצא שאליו הוא מגיב.
- `delivery_status text` — האחרון מבין `sent/delivered/read/failed` (latest-wins; ה-worker מעדכן על שורת-היוצא).
- `delivery_error_code text` — קוד-השגיאה הגולמי של Meta על `failed`.

אין טבלת `message_statuses` נפרדת: היסטוריית-הסטטוס המלאה חיה ב-`webhook_inbox`
(dedup `<wamid>:<status>`); `contact_interactions.delivery_status` מחזיק רק את האחרון.
