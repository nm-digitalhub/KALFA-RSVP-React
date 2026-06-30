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
| `event_kind` | `text` | לא | סוג האירוע: `'message'` (הודעה נכנסת) או `'status'` (status callback של הודעה יוצאת). |
| `dedupe_key` | `text` | לא | מפתח אידמפוטנטיות לכל אירוע. חלק מ-UNIQUE. ראה תבניות למטה. |
| `message_id` | `text` | כן | ה-wamid של ההודעה. בנכנס — ה-wamid הנכנס; ב-status — ה-wamid של ההודעה היוצאת שעליה הסטטוס. |
| `context_message_id` | `text` | כן | רק לנכנס: `context.id` — ה-wamid היוצא שאליו ההודעה הנכנסת מגיבה (יעד-התגובה). בסיס לזיהוי-תגובה מדויק. |
| `phone_number_id` | `text` | כן | מזהה מספר-הטלפון העסקי ב-WABA שקיבל את האירוע. **מזהה טכני, לא PII** — ניתן לחיפוש. |
| `event_at` | `timestamptz` | כן | חותמת-הזמן שדיווחה Meta על האירוע (לא תמיד קיימת). |
| `payload` | `jsonb` | לא | האירוע הגולמי כפי שהתקבל מ-Meta. **PII** → admin-only RLS, לא נלוגג, מוקרן רק ב-detail. |
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

ערכי `status` אפשריים: `sent` · `delivered` · `read` · `failed`.

> **שתי שכבות-dedup נפרדות — לא לבלבל:**
> - `webhook_inbox` → **`UNIQUE(provider, dedupe_key)`** (שכבת-הקליטה; מונע כפילות-קליטה של אירועי-Meta).
> - `contact_interactions` → **`UNIQUE(channel, provider_id)`** (שכבת-העיבוד, **טבלה אחרת**; מונע חיוב-כפול כש-worker מעבד אותה הודעה פעמיים).

---

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
