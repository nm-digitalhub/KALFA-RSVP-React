# ספֵק — הקשחת WhatsApp webhook לפרודקשן (KALFA)

**גרסה:** טיוטה 2026-06-29 · **מצב:** לעיון לפני מימוש · **דחיפות:** חוסם חיוב (כל תגובה נכנסת נדחית 401 כרגע).
**מאומת מול:** הקוד בפועל + תיעוד רשמי של Meta (Context7) + בדיקת-שליחה חיה.

---

## 1. מטרה והיקף
להפוך את `api/webhooks/whatsapp` למנגנון production נכון: **persist-then-process** (קליטה מהירה → תור worker → לוגיקה עסקית), זיהוי-תגובה אמין לפי `context.id`, עיבוד `statuses`, RSVP-מכפתורים, וסיווג `wrong_number` שמרני.
**מחוץ להיקף:** מודל-החיוב עצמו (per-reply, J5, תקרה — ללא שינוי); UI הלקוח (דשבורד קורא מצרפי בלבד); ערוץ ה-AI calls (Voximplant — נפרד).

## 2. מצב קיים — מאומת
- **עובד:** GET verification, אימות `X-Hub-Signature-256` (HMAC על raw body — **מימוש נכון**), insert אידמפוטני של נכנסות (`UNIQUE(channel, provider_id)`), recordReached.
- **שבור עכשיו:** כל ה-callbacks מקבלים **401** → הגורם: **אי-התאמת App Secret** (`whatsapp_app_secret` ≠ ה-App Secret של Meta). המימוש תקין; הקלט שגוי. (לפני שהופעל outreach, המסלול המושבת החזיר 200 והסווה זאת.)
- **חסר/שגוי:**
  1. **כל העיבוד העסקי רץ בתוך בקשת Meta** (resolve→interaction→recordReached→removal) — סיכון retry אם DB/RPC איטי.
  2. **`statuses[]` מסווגים אך לא מטופלים** (ה-route מתעלם מהם).
  3. **זיהוי-תגובה לפי טלפון → outbound אחרון** (`interactions.ts:43-75`) על פני כל ה-contacts עם אותו מספר — **ניחוש מסוכן** (אותו טלפון ביותר מאירוע/קמפיין).
  4. **`context.id` לא נקלט** (הטיפוס חסר `context`).
  5. interactive נמפה לפי `.title` (תצוגה) ולא `button_reply.id` (פעולה).
  6. **GET תלוי ב-outreach_enabled** → מחזיר 404 כשהמנוע כבוי, חוסם אימות ב-Meta.
  7. **אין אחסון גולמי** של אירועי-webhook (אין inbox/audit).

## 3. ארכיטקטורת-יעד (persist-then-process)
```
Meta → GET verify (גדור על "Meta מוגדר", לא outreach)
     → POST חתום → אימות HMAC על raw bytes → נרמול messages+statuses
     → INSERT אידמפוטני ל-webhook_inbox → 200 מהיר ל-Meta
worker(pg-boss): טוען לא-מעובד → resolve לפי context.id → reach/RSVP/opt-out/status
     → processed_at
דשבורד: קורא נתונים מצרפיים בלבד (getCampaignResultsSummary)
```

## 4. דרישות Meta (מאומת מתיעוד)
- **GET:** להחזיר את `hub.challenge` כש-`hub.mode=subscribe` ו-`hub.verify_token` תואם. **לגדור על נוכחות תצורת-Meta (verify_token), לא על outreach_enabled.**
- **POST:** `X-Hub-Signature-256: sha256=<hmac>` על **ה-raw body**. לקרוא `arrayBuffer()`→Buffer (בטוח יותר מ-`text()`), לאמת, ורק אז `JSON.parse`. **לעולם לא `request.json()` לפני האימות.**
- **מבנה:** `entry[].changes[].value` = `messages[]` **או** `statuses[]` — לפרק את שניהם.
- **`context.id`** (נכנס): wamid של ההודעה היוצאת שאליה מגיבים. (בשליחה השדה הוא `context.message_id` — לקרוא `context.id` בנכנס.)
- **כפתורים:** `interactive.button_reply.{id,title}` / `list_reply.{id,title}` → למפות פעולה לפי **`id`**. Quick-reply של template → `type:"button"` עם `button.payload`.
- **statuses:** `{id(wamid), status: sent|delivered|read|failed, recipient_id, errors[].code/title}`. אותו wamid מקבל כמה סטטוסים → dedup לפי **`<wamid>:<status>`**, לא wamid בלבד.
- **200 מהיר** אחרת retry ב-backoff.

## 5. מודל-נתונים (מיגרציה — מותנה-אישור, SQL מוצע, לא הורץ)

**טבלה חדשה `webhook_inbox`** (תיבת-קלט append-only, service-role/admin בלבד):
```sql
create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'whatsapp',
  event_kind text not null,              -- 'message' | 'status'
  dedupe_key text not null,              -- 'wa-msg:<wamid>' | 'wa-status:<wamid>:<status>'
  message_id text,                       -- wamid
  context_message_id text,               -- inbound context.id (reply target)
  phone_number_id text,
  event_at timestamptz,
  payload jsonb not null,                -- raw event (PII — admin-only RLS)
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text,
  unique (provider, dedupe_key)
);
create index if not exists webhook_inbox_unprocessed_idx
  on public.webhook_inbox (received_at) where processed_at is null;
alter table public.webhook_inbox enable row level security;
-- policy: admin/service-role only; no customer access (raw payloads hold PII).
```

**הרחבת `contact_interactions`** (במקום טבלת-יוצא מקבילה — [[reuse-existing-no-duplication]]; ה-wamid היוצא כבר נשמר כ-`provider_id`):
```sql
alter table public.contact_interactions
  add column if not exists guest_id uuid references public.guests(id),
  add column if not exists context_message_id text,   -- inbound: the outbound wamid it replies to
  add column if not exists delivery_status text,       -- latest of sent/delivered/read/failed
  add column if not exists delivery_error_code text;   -- Meta error code on failed (raw)
```
*אין טבלת `message_statuses` נפרדת:* היסטוריית-הסטטוס חיה ב-`webhook_inbox` (dedup `<wamid>:<status>`); ה-worker מעדכן `delivery_status` (latest-wins) על שורת-היוצא.

## 6. שינויי-קוד
- **`route.ts`** → **דק**: `runtime='nodejs'`, `dynamic='force-dynamic'`; אימות HMAC על arrayBuffer; נרמול messages+statuses; INSERT אידמפוטני ל-webhook_inbox; 200. **בלי** recordReached/RSVP כאן. GET נגדר על `verify_token` בלבד.
- **`interactions.ts`** → `resolveByContextId(contextId)`: `contact_interactions WHERE provider_id=contextId AND direction='out'` → `{event,campaign,contact,guest}`. ה-resolver-לפי-טלפון נשמר **רק** כ-fallback ל"פניות-שירות" (לא מחייב/לא מעדכן RSVP על ניחוש).
- **`worker/process-whatsapp-event.ts`** (חדש): שולף מ-webhook_inbox → לפי `event_kind`: message → reach/opt-out/RSVP; status → `delivery_status`/op_status/wrong_number → `processed_at`.
- **שליחה יוצאת** (`outreach.ts`/`sendOneWhatsApp`): לשמור גם `guest_id` + הקשר-פעולה על שורת-היוצא, כדי ש-context.id יחזיר את האורח והפעולה.

## 7. RSVP מכפתורי WhatsApp
`interactive.button_reply.id` (למשל `rsvp_yes|rsvp_maybe|rsvp_no`) → דרך `context.id` מאתרים `guest_id` → פונקציה פנימית **`record_rsvp_from_whatsapp`** (service_role) המיישמת את **אותם כללי-עסק כמו הדף הציבורי** (אירוע פעיל, דדליין, אורח פעיל, ולידציית-סטטוס, audit) → `guests.status` + `rsvp_responses`. **לא** משתמשים בטוקן ה-RSVP הציבורי ב-webhook, ו**לא** מאתרים אורח לפי טלפון בלבד.

## 8. סיווג `wrong_number` שמרני
`failed` ≠ בהכרח מספר-שגוי. לשמור `errors[].code` הגולמי. רק קוד-כשל-מספר סופי-ודאי → `op_status='wrong_number'`. אחרת: `delivery_failed` / `retryable_failure` / `provider_config_error` / `unknown_failure`. (תואם: WhatsApp עמום → לרוב "לא-הושג"; החיווי הוודאי למספר-שגוי מגיע מ-Voximplant 404.)

## 9. תצורה + ה-401
- **להישאר עם `app_settings`** (הדפוס הקיים; ההפרדה `whatsapp_app_secret`↔`whatsapp_access_token` כבר קיימת; server-only, אף-פעם NEXT_PUBLIC).
- **תיקון ה-401 (פעולת המשתמש):** להזין מחדש את ה-**App Secret** האמיתי ב-`/admin/channels` (Meta App Dashboard → Settings → Basic → App Secret). **לא אגע בסוד.**
- **הקשחה:** חיווי-בריאות ב-`/admin/channels` ("חתימה אומתה לאחרונה ✓/✗") כדי שסוד-שגוי ייתפס מיד.

## 10. רצף-בנייה (שלבים נפרדים, כל אחד reviewable)
1. **GET independence + טבלת `webhook_inbox`** (מיגרציה מותנית-אישור) + route persist-then-process (אימות+inbox+200).
2. **worker** שמעבד inbox → reach/opt-out (משחזר את ההתנהגות הקיימת, רק מחוץ לבקשה).
3. **resolve לפי `context.id`** + שמירת `guest_id`/הקשר על היוצא.
4. **statuses**: `delivery_status` + `wrong_number` שמרני.
5. **RSVP-מכפתור**: `record_rsvp_from_whatsapp`.
6. חיווי-בריאות ב-admin.
- כל שלב: lint+tsc+vitest+build; בדיקות חדשות (resolver לפי context.id, dedup statuses, persist-then-process, classify).

## 11. Non-goals
אין שינוי במודל-החיוב/תקרה/authorized-set; אין AI-calls כאן; דשבורד קורא מצרפי בלבד; אין טוקן-RSVP ציבורי בתוך webhook; אין resolve-לפי-טלפון לפעולות מחייבות.
