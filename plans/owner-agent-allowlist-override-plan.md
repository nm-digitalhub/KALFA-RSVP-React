# תוכנית: אישור ידני ברשימת ההיתר של סוכן הבעלים

תאריך: 2026-09-27 · מצב: **טיוטה לאישור. שום דבר לא יושם.**
בקשת הבעלים (27.9): כפתור בעמוד `/admin/integrations/owner-agent` שמאשר ברשימת ההיתר גם (א) איש צוות שהטלפון שלו לא אומת, וגם (ב) אדם שאינו איש צוות בכלל. **חובה תיעוד בלוג.**

---

## 1. המצב היום [נמדד]

- `owner_agent_allowlist.staff_user_id` הוא NOT NULL עם FK ל-`platform_staff(user_id)` (`supabase/migrations/20260924034054_owner_agent_whatsapp.sql:90-91`). אי אפשר היום להוסיף שורה למי שאינו איש צוות.
- `owner_agent_intake.staff_user_id` הוא NOT NULL עם FK ל-`auth.users` (`:121`). מי שאין לו משתמש במערכת לא יכול לקבל שורת קליטה.
- השער בודק שלושה דברים שכולם תלויים באיש צוות: `is_platform_staff_for_user` (`intake.ts:342-346`), `phone_verified_e164 = e164` (`intake.ts:351-359`), והרשאות לפי `has_platform_permission_for_user` (`reply.ts:227-229`).
- הנמען של התשובה הוא `profiles.phone_verified_e164` של איש הצוות (`reply.ts:211`, `store.ts:186`), לא הטלפון שברשימה.
- התקרה היומית, זיכרון השיחה (`sessions.ts`) וה-audit מזוהים לפי `staff_user_id`.
- פעולות העמוד כבר נרשמות ב-`logActivity` (`src/lib/data/admin/owner-agent.ts:309-464`).

## 2. העיקרון

**הזהות של מי שמדבר עם הסוכן עוברת מ"איש צוות" ל"שורה ברשימת ההיתר".** השורה היא שהבעלים אישר, והיא נושאת את סוג האישור. כך שני המקרים עובדים באותו מסלול, והבעלים נשאר היחיד שיכול לאשר (`requirePlatformOwner`).

סוגי אישור (עמודה `approval_kind`):
- `verified_staff` — המצב של היום: איש צוות + טלפון מאומת. השער לא משתנה.
- `staff_unverified_override` — איש צוות, הטלפון לא אומת, הבעלים אישר ידנית.
- `external_override` — אינו איש צוות, הבעלים אישר ידנית. מזוהה בשם/תווית בלבד.

## 3. שינויים

### 3.1 מסד נתונים (מיגרציה אחת, באישור)
- `owner_agent_allowlist`:
  - `staff_user_id` הופך ל-nullable. CHECK: `approval_kind='external_override'` ⇔ `staff_user_id is null`.
  - עמודות חדשות: `approval_kind text not null default 'verified_staff'`, `approved_by uuid references auth.users`, `approved_at timestamptz`, `approval_note text` (עד 500 תווים, חובה באישור ידני).
  - CHECK: באישור ידני `approved_by`, `approved_at` ו-`approval_note` חובה.
- `owner_agent_intake`:
  - `staff_user_id` הופך ל-nullable; עמודה חדשה `allowlist_entry_id uuid not null references owner_agent_allowlist(id) on delete cascade` (backfill ל-16 השורות הקיימות לפי `staff_user_id`); אינדקס `(allowlist_entry_id, received_at desc)`.
  - grant לפי עמודה ל-`authenticated` מתעדכן לכלול את העמודה החדשה (עדיין בלי `message_text`).
- `owner_agent_audit`: עמודה `allowlist_entry_id` (nullable, `on delete set null`).
- dry run: RLS, ACL (כולל PUBLIC), 0 הפרות CHECK על השורות הקיימות. אחר כך `db push --dry-run` → `db push` → `advisors` → `gen:types`.

### 3.2 השער (route + צרכן)
- `getOwnerAgentRouting` קורא גם `approval_kind` (`intake.ts:126-129`). ההתאמה לטלפון **לא משתנה**: אותו `matchAllowlistedSender`, מספר מדויק בלבד.
- `handleOne` (`intake.ts:337-381`):
  - `verified_staff`: כמו היום.
  - `staff_unverified_override`: בודק `is_platform_staff_for_user`, **מדלג** על בדיקת הטלפון המאומת.
  - `external_override`: מדלג על שתי הבדיקות.
  - בכל המקרים: מתג, קצב, תקרה. הקצב והתקרה נספרים לפי `allowlist_entry_id`.
- `agentGate` ו-`sendGate` (`reply.ts:204-235, 352-359`) — אותו פיצול, מול המצב הנוכחי של השורה.
- **הנמען בשני המקרים הידניים = ה-`e164` של השורה עצמה** (ההודעה הגיעה ממנו, ו-Meta חתמה עליה). ב-`verified_staff` נשאר הטלפון המאומת, כמו היום.
- **הרשאות:**
  - `staff_unverified_override`: ההרשאות של איש הצוות, כמו היום.
  - `external_override`: אין לו הרשאות פלטפורמה, ולכן **אף אחד מ-9 כלי הספירה לא מוצע לו**. נשארים לו שני כלי ה-SQL (`execute_sql`, `list_tables`), שלפי החלטה 2 של תוכנית הקריאה החופשית ניתנים לכל מי שברשימה.
- זיכרון שיחה (`sessions.ts`) ממופתח לפי `allowlist_entry_id`.

### 3.3 מה שאורח בחוץ יכול לראות — לדעת לפני האישור
לפי ההחלטות הקיימות (`plans/owner-agent-free-read-plan.md` §1, החלטות 1–3): הסוכן לא מסתיר כלום, וכלי ה-SQL קורא **את כל המסד, כולל מפתחות וטוקנים ופרטי אורחים**. אדם חיצוני שיאושר יקבל את אותה גישה. זו לא הצעה לשנות את ההחלטה, רק עובדה שצריך לדעת כשמאשרים אדם חיצוני. (אם תרצה, אפשרות עתידית: `external_override` בלי כלי SQL — שורה אחת ב-runner.)

### 3.4 העמוד (`/admin/integrations/owner-agent`)
- בטופס ההוספה: בחירה בין "איש צוות" (רשימה כמו היום) לבין "אדם חיצוני" (שם/תווית + טלפון).
- לשורה של איש צוות שמסומנת "לא תואם לטלפון המאומת": כפתור **"אשר ידנית"**.
- כל אישור ידני פותח דיאלוג אישור בתוך הדף (לא `confirm()`): שדה חובה "סיבת האישור", והסבר של מה נפתח (סעיף 3.3 לאדם חיצוני).
- תג לכל שורה: "מאומת" / "אושר ידנית" / "חיצוני — אושר ידנית", עם מי אישר ומתי.
- כפתור "בטל אישור" שמחזיר את השורה ל-`enabled=false`.
- RTL, מקלדת, מצבי ריק ושגיאה, לפי `building-rtl-ui`.

### 3.5 תיעוד בלוג (חובה)
- **`logActivity`** לכל פעולה, כמו שאר העמוד:
  - `admin.owner_agent.allowlist_override_approved` — `entryId`, `approvalKind`, `staffUserId` (אם יש), אורך הסיבה. **בלי טלפון ובלי טקסט הסיבה** (הסיבה נשמרת בטבלה).
  - `admin.owner_agent.allowlist_override_revoked`.
- **`owner_agent_audit`**: כל הודעה שעברה בזכות אישור ידני נרשמת עם `reason_code` = `override_staff_unverified` / `override_external` ו-`allowlist_entry_id`. כך אפשר לראות בכל רגע מי נכנס בזכות אישור ידני.
- התראת Slack עם מזהים בלבד כשנוצר אישור `external_override`.

## 4. בדיקות
- מטריצת ה-golden של `route.test.ts`: מסלול האורחים זהה לפני ואחרי (השינוי רק בשער, לא בהסטה).
- לכל סוג אישור: עובר/נחסם נכון ב-route, בצרכן ובשליחה. `verified_staff` מתנהג בדיוק כמו היום.
- `external_override` לא מקבל אף כלי ספירה; הנמען הוא ה-`e164` של השורה.
- ביטול אישור באמצע ריצה → לא נשלח (שער השליחה).
- DAL: כל export עם `requirePlatformOwner`; `admin-data-layer-coverage.test.ts`.
- כל הפעולות כותבות `logActivity`; אין טלפון בלוג.
- הזרקת תקלות לכל שומר חדש.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, בדיקת דפדפן של העמוד.

## 5. סדר
1. מיגרציה + backfill (באישור).
2. שער + צרכן + בדיקות.
3. עמוד + לוג + בדיקת דפדפן.
4. deploy (באישור), ואז אישור ידני אחד לבדיקה.
