# סוכני הצי — מהרשאת-על להרשאה מינימלית

**תאריך:** 2026-09-10 · **סטטוס:** תוכנית. לא בוצע דבר; אין מיגרציה, אין תפקיד חדש, אין טוקן.

**Goal:** סוכני הצי יפסיקו לרוץ כ-`service_role`. במקומו תפקיד Postgres ייעודי עם הרשאות על עשר טבלאות בלבד — כך ש-RLS חל עליהם, וטעות של סוכן אינה יכולה להגיע לאורחים או לסודות.

---

## §1 המפה — מדוד 2026-09-10

### מה שסוכן יכול לגעת בו

| | |
|---|---|
| טבלאות ב-`public` | **88** |
| מהן שסוכן יכול `INSERT/UPDATE/DELETE` | **88** |
| טבלאות עם RLS דלוק | 88 |
| מדיניות RLS בסך הכל | 110 |
| **מדיניות שכולה רלוונטית ל-`service_role`** | **1** |

`service_role` הוא `BYPASSRLS`. 109 מדיניות — כולל 21 שנכתבו מחדש באותו בוקר במיגרציה `20260910090301` כשציר ההרשאות אוחד — **אינן נבדקות עבורו כלל**.

**12 עמודות סוד ב-`app_settings` לבדה:** `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`, `voximplant_callback_secret`, `voximplant_account_callback_token_hash`, `voximplant_service_account_json` (מפתח RSA מלא), `sumit_api_key`, `sumit_api_public_key`, `slack_bot_token`, `extra_sms_token`, `smtp_password`, `elevenlabs_api_key`.

**מידע אישי:** 47 אורחים, 45 אנשי קשר, 8 פרופילים, 8 משתמשי auth.

### מה שסוכן באמת נוגע בו

`scripts/fleet-agent-cli.ts`, ספירת `.from()`:

```
14×  fleet_requests                2×  platform_staff
 6×  fleet_social_posts            2×  inquiry_messages
 3×  contact_messages              2×  fleet_request_slack_threads
 1×  packages · fleet_goals · faq_items · callback_requests
```

**עשר טבלאות. 12 קריאות כתיבה. אפס גישות ל-`app_settings`.**

### מה שהפער אומר

הפער בין 10 ל-88 הוא שטח התקיפה כולו, **והאיום אינו סוכן זדוני**. הוא `UPDATE` בלי `where`, טבלה שנמחקת בטעות, סוד שנכתב ללוג בדיבוג. מפתח שמתיר הכל הופך טעות בת שורה לאירוע.

---

## §2 העיצוב — למה לא טבלת `ai_agents`

הפיתוי הוא לבנות `ai_agents` + `ai_agent_permissions` + `ai_agent_audit_log`, לרשום בהן מה מותר לכל סוכן, ולהרגיש מוגן.

**זה לא היה משנה דבר.** כל עוד הסוכן מחזיק `service_role`, טבלת הרשאות היא **מוסכמה שהוא יכול להתעלם ממנה** — בדיוק כמו ש-`provider_number_roles` הייתה חסרת ערך אילו ה-resolvers לא היו קוראים ממנה. שלוש טבלאות היו מייצרות תחושת שליטה בלי לצמצם מה שסוכן **יכול** להגיע אליו, וזה גרוע מכלום: זה מסתיר את הפער.

**התובנה:** `service_role` אינו "המפתח של Supabase". הוא **תפקיד Postgres אחד** שמוגדר `BYPASSRLS`. תפקיד אחר, בלי הדגל הזה ועם הרשאות מצומצמות, הופך את "מה מותר לסוכן" ממוסכמה בקוד **לחוק במסד**.

**מאומת מול התיעוד הרשמי** (`guides/auth/signing-keys`, `guides/database/postgres/roles`): ה-claim `role` ב-JWT ממופה לתפקיד Postgres קיים — *"Ensure the role matches an existing Postgres role"* — ו-`create role "role_name"` הוא המנגנון המתועד.

---

## §3 היישום

### Step 1 — תפקיד ומענקים (מיגרציה)

```sql
-- NOLOGIN: אין התחברות ישירה, רק דרך ה-claim ב-JWT. אין BYPASSRLS — זו כל הנקודה.
create role fleet_agent nologin;
grant usage on schema public to fleet_agent;

-- בדיוק מה שנמדד, ובדיוק הפעלים שבשימוש. הרשימה נגזרת מספירת ה-.from() ב-§1
-- ולא מהערכה — כל תוספת עתידית היא מיגרציה, וזה הרצוי.
grant select, insert, update on public.fleet_requests            to fleet_agent;
grant select, insert, update on public.fleet_social_posts        to fleet_agent;
grant select, insert         on public.fleet_request_slack_threads to fleet_agent;
grant select                 on public.fleet_goals               to fleet_agent;
grant select, update         on public.contact_messages          to fleet_agent;
grant select, update         on public.inquiry_messages          to fleet_agent;
grant select                 on public.callback_requests         to fleet_agent;
grant select                 on public.platform_staff            to fleet_agent;
grant select                 on public.packages                  to fleet_agent;
grant select                 on public.faq_items                 to fleet_agent;

-- ⚠️ ללא ALTER DEFAULT PRIVILEGES. טבלה חדשה לא תהיה נגישה לסוכן אלא במענק מפורש —
-- ההפך מהברירת-מחדל של Supabase, ובכוונה: זה מה שמונע מהרשימה להתרחב בשקט.
```

RLS חל עכשיו, ולכן כל טבלה ברשימה צריכה מדיניות ל-`fleet_agent` — אחרת הסוכן יראה אפס שורות. זו לא תקלה, זו הנקודה: **צריך להצהיר במפורש מה מותר.** לדוגמה:

```sql
create policy fleet_agent_own_requests on public.fleet_requests for all
  to fleet_agent
  using (true) with check (true);   -- הצי הוא הבעלים של הטבלה הזו
```

לעומת:

```sql
-- contact_messages: קריאה בלבד של פניות שטרם נענו, לא ההיסטוריה כולה
create policy fleet_agent_open_messages on public.contact_messages for select
  to fleet_agent using (answered_at is null);
```

**הכתיבה של המדיניות היא העבודה האמיתית כאן**, לא ה-`grant`. היא דורשת החלטה לכל טבלה: מה סוכן צריך לראות, ולא "הכל".

### Step 2 — טוקן

`jsonwebtoken` כבר dependency ישיר (`package.json:114`) — אין מה להתקין.

```ts
// scripts/mint-fleet-token.ts — מורץ פעם אחת ע"י הבעלים
jwt.sign(
  { role: 'fleet_agent', iss: 'kalfa-fleet', sub: 'fleet-agent' },
  process.env.SUPABASE_JWT_SECRET!,
  { algorithm: 'HS256', expiresIn: '365d' },
)
```

הטוקן נשמר ב-`.claude/fleet/.token.env` (chmod 600, כבר gitignored — ראו `fleet-docs-and-capability-plans`), **לא** ב-`.env.local`.

### Step 3 — הקליינט

```ts
// src/lib/supabase/fleet.ts
export function createFleetClient() {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${process.env.FLEET_AGENT_TOKEN}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

ב-`scripts/fleet-agent-cli.ts`: שבע קריאות `createAdminClient()` → `createFleetClient()`.

### Step 4 — האימות שקובע אם זה עבד

```sql
-- כסוכן: חייב להיכשל
select count(*) from public.guests;         -- 42501
select whatsapp_access_token from public.app_settings;  -- 42501
-- כסוכן: חייב לעבוד
select count(*) from public.fleet_requests; -- מספר
```

בדיקה אוטומטית: להריץ את סוויטת הצי הקיימת (`smoke-test`) מול הטוקן החדש. **אם היא עוברת, הרשימה של עשר הטבלאות מלאה. אם משהו נכשל ב-42501 — מצאנו טבלה שהמפה פספסה, וזו בדיוק התועלת.**

---

## §4 מה זה לא פותר — במפורש

**מי שיכול לחתום טוקן יכול לחתום גם `service_role`.** `SUPABASE_JWT_SECRET` נשאר ב-`.env.local`, וכל תהליך שקורא אותו יכול לייצר לעצמו הרשאת-על. התוכנית הזו **מצמצמת את רדיוס הפיצוץ של האישור שהסוכן מחזיק**, לא את גבול המכונה.

זה עדיין שווה: הסוכן רץ אוטונומית ומחזיק אישור לאורך זמן, בעוד ה-JWT secret נקרא רק ע"י תהליכי השרת. **טעות של סוכן** — התרחיש הריאלי — נעצרת ב-42501 במקום למחוק טבלה.

**תשעה סקריפטים אחרים** (`rotate-console-agent-secret`, `sync-voximplant-sa`, `send-one-invite`, …) גם הם קוראים `createAdminClient()`. הם **נשארים** — הם מורצים ידנית ע"י הבעלים לפעולה אחת, לא רצים אוטונומית, וחלקם באמת צריכים לכתוב סודות. הגבול הוא **אוטונומיה**, לא סוג הקליינט.

---

## §5 הסדר, וההחלטה שקודמת לו

1. **מנגנון בקשות ההרשאה** על `fleet_requests` (`kind='approval'`, סיבה חובה, אישור בעלים, פקיעה, **זהות מבקש נקבעת בשרת**) — כבר ניסח אותו הבעלים. הוא הופך סוכן מ"עושה מה שהקוד אומר" ל"מבקש, ואתה מאשר", **בלי טבלה חדשה אחת**.
2. התפקיד והמענקים (§3 Step 1) — מיגרציה, אישור בעלים.
3. הטוקן והקליינט (Steps 2–3).
4. אימות (Step 4).

**הכרעה נדרשת לפני 1:** האם `fleet_agent` יחיד, או תפקיד לכל שכבה (`fleet_agent_read` / `fleet_agent_write`)? המלצה: **אחד**. חמישה תפקידים שאיש לא מאייש הם בדיוק הטעות שכבר עלתה בסשן הזה — ראו [[never-design-for-todays-roster]] — והפיצול נעשה ביום שבו סוכן אחד באמת צריך פחות מאחר.
