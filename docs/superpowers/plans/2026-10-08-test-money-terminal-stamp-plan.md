# תכנית: רישום המסוף על כל תשלום — כסף בדיקה לא נספר, ואפשר לבדוק שוב ושוב

**סטטוס:** בביצוע. נכתבה ב-8.10.2026 אחרי בדיקה מחמירה (ארבעה בודקים עצמאיים ומבקר; Workflow `wf_3c29f2b1-39d`) ואושרה על ידי הבעלים. שלבים 0–2 בוצעו ונמצאים במסד החי (ראו "התקדמות"); קוד שלב 3 נכתב, נסקר בסקירה עצמאית ותוקן (7א), ועדיין לא נבנה (`npm run build`) ולא הורצה הסוויטה המלאה.
**קשור:** `2026-10-07-cardcom-pilot-plan.md` (הפיילוט שהתכנית הזו נשענת עליו).

**התקדמות (עדכון ביצוע):**
- שלב 0 בוצע ב-8.10: עבודת הפיילוט נשמרה ב-8 commit-ים ונדחפה על ידי הבעלים.
- שלב 1 בוצע ב-8.10: מיגרציה A (`20261008033521_ledger_money_source_stamp`) נוצרה בפקודה הרשמית; הרצה יבשה על המסד החי (בעסקה אחת שמתבטלת) עברה 21 בדיקות ללא כשל; הבעלים הריץ `db push --linked`, `gen:types` ו-`types:check` (עבר); אין סטייה בהיסטוריית המיגרציות; עוצמת האבטחה (advisors) לא הציגה ממצא חדש על האובייקטים ששונו; commit `e05ae520` (נדחף על ידי הבעלים ב-8.10 יחד עם `d8547139` ו-`78c30fe1`). במסד החי: 10 שורות בספר, אפס מסווגות כבדיקה, ההכנסות 200.00.
- שלב 2 בוצע ב-8.10 ואומת בריצה: מיגרציה `20261008040027_cancel_campaign_audit` נוצרה בפקודה הרשמית ונכתבה בסקריפט מהנוסח החי; הבעלים הריץ `db push` והיא הוחלה (בלוק האימות שבקובץ עבר, אחרת הייתה מתבטלת), ואחר כך `gen:types` ו-`types:check` (עבר; ההפרש שורה אחת: `cancel_campaign` קיבלה `p_actor?: string`). **ההרצה היבשה לא רצה לפני ההחלה.** אומת אחרי ההחלה בקריאה בלבד: אין סטייה בהיסטוריה; פונקציה אחת `cancel_campaign(uuid, uuid)`, `security invoker`, `search_path` ריק, הרצה לבעלים ול-`service_role` בלבד; גוף הפונקציה במסד זהה לגוף שבקובץ (2285 תווים); שלושת הטריגרים על `campaigns` פעילים; מצב הקמפיינים לא השתנה ואין אף שורת `campaign.cancelled`; advisors: 46 ממצאים לפני ואחרי, זהים, אף אחד על האובייקטים ששונו.
- בדיקת ההתנהגות אחרי ההחלה (`behavior_check_cancel_audit.sql`, אותם תרחישים של ההרצה היבשה, בעסקה שמתבטלת) הורצה על ידי הבעלים: 17 שורות, כולן PASS, 0 כשלים. הוכח בריצה, כ-`service_role`: הקריאה הישנה (`p_campaign` בלבד) מבטלת וכותבת רישום אחד עם `user_id` ריק; קריאה שנייה מחזירה `already_cancelled` בלי רישום שני; עם `p_actor` הרישום נושא את המשתמש; תשלום בדיקה ממתין חוסם, ושהצליח מאפשר ביטול עם `hadSucceededPayment` ו-`testMoneyOnly` אמת; כסף אמיתי חוסם ו-`update` ישיר נחסם בטריגר (23514); משתמש לא קיים נדחה (23503) והסטטוס חוזר; `anon` ו-`authenticated` נדחים (42501). אחרי הבדיקה אומת בקריאה בלבד שלא נשאר דבר במסד: 10 שורות בספר, 0 מסווגות כבדיקה, הכנסות 200.00, 0 רישומי ביטול, מצב הקמפיינים זהה.
- שלב 3 (קוד) נכתב ב-8.10 באישור הבעלים ("כן, תעבור לשלב 3"), בצעדים קטנים עם בדיקות ממוקדות בכל צעד, ואחר כך נסקר בסקירה עצמאית אחת מוגבלת וקריאה-בלבד (Workflow `wf_d66bf757-fd7`: ארבע עדשות, ואימות נפרד לכל ממצא): שישה ממצאים קלים שאומתו ולא הופרכו, ועוד כמה הערות קטנות; אין חסימות. כולם טופלו חוץ משניים שנדחו בכוונה (7א). מצב: `npx tsc --noEmit` נקי על כל הפרויקט; `eslint --max-warnings 0` נקי על 52 הקבצים ששונו או נוספו; `npm run worker:deps` נקי; 4,664 בדיקות ממוקדות עוברות ב-301 קבצים (`src/lib/payments`, `src/lib/data`, `src/test`, כל אזור הניהול, עמודי האירוע והקמפיין של הלקוח, נתיבי ה-API של קארדקום והקמפיינים), 38 דילוגים קיימים מראש ואף אחד מהם לא בקבצים ששונו; `scripts/ledger-invariants.sql` הורץ על המסד החי: ארבע הבדיקות תקינות. נשמר ב-8.10 בארבעה commit-ים מקומיים (טרם נדחפו): `ad639e82` ליבת התשלומים, `cdfc243d` קמפיינים וביטול, `072746a0` כרטיס הבדיקה הידנית, `39a3ff8f` תוויות לצוות. **טרם הורצו:** `npm run build` והסוויטה המלאה (הבעלים ביקש לחכות להוראתו). ההפרשים מהטבלה שבסעיף 7 מפורטים בסעיף 7א.

## 0. החלטות הבעלים שכבר נקבעו (לא נפתחות מחדש)

1. מסוף 1000 של קארדקום אינו גובה כסף. זו עובדה, לא סיכון.
2. בלי טבלה חדשה. בנתיב הראשי לא נמחקת ולא נערכת אף שורה בספר התשלומים.
3. **06:11, 8.10:** "אין שום צורך אני אחראי על האירוע… תפסיק לעלות מחסומים מיותרים". לכן אין בתכנית סימון של ארבע שורות הפיילוט, ואין חסימת הפעלה, ואין הגנה מפני אנשים אחרים שפועלים על האירוע. ה-₪200 מ-7.10 נשארים בהכנסות (0.16% מתקרת 122,833), ואירוע 5aaf0363 לא ישמש לבדיקות חוזרות. **הסבב הראשון ירוץ על אירוע חדש של הצוות** (לצוות אין מגבלת אירוע אחד לחשבון).
4. מיגרציות נוצרות רק בפקודה הרשמית `npx supabase migration new <שם>`. הבעלים מריץ `npx supabase db push --linked`. אף קובץ לא נקרא או נערך ידנית.
5. אין commit, push, deploy או הרצה מול הספק בלי אישור מפורש לכל שלב.

## 1. המטרה

- כל תשלום נושא את **המסוף שבו נפתח**. תשלום במסוף בדיקה אינו נספר בהכנסות ובבדיקת תקרת עוסק פטור.
- אפשר לבטל קמפיין ששולם **בכסף בדיקה בלבד** ולשלם שוב על אותו אירוע ואותה רשימת אורחים (בלי מחיקה).
- אפשר לדעת **במדויק, לכל תשלום**, באיזה מסוף נעשה: מה ביקשנו, מה קארדקום דיווחה, ומה הסיווג.

## 2. איך זה עובד

| רגע | מה נרשם | מי קובע |
|---|---|---|
| פתיחת תשלום (שורה ממתינה, לפני שנוגע כסף) | `provider_terminal` = המסוף שנשלח ל-Create, מאותו אובייקט הגדרות שבונה את הבקשה; `provider = 'cardcom'` | הקוד בשרת. הדפדפן לא מעביר מסוף |
| אותה שורה | `is_test` = `payment_is_test_terminal(provider_terminal)` (כרגע: `1000`), נקבע על ידי הטריגר, נעול אחר כך | המסד. הקוד לא כותב אותו |
| סגירה (קארדקום ענתה) | `provider_terminal_echo` = `TerminalNumber` מהרמה העליונה של התשובה, אם הגיע ותקין | הקוד, בעמודה משלו, נכתב פעם אחת |
| שורת בת (החזר) | מעתיקה מהאב: ספק, מסוף וסיווג. מה שהקוד שלח מתעלמים ממנו | הטריגר |

**כללי הכרעה בסגירה** (קוד, לא כלל במסד — כדי שמסד לעולם לא יעצור תשלום שאושר):

| המסוף הרשום | מה קארדקום דיווחה | תוצאה |
|---|---|---|
| ריק (SUMIT, שורות ישנות) | כל דבר | כמו היום |
| מסוף בדיקה | אותו מספר | הצליח, נחשב בדיקה |
| מסוף בדיקה | חסר או שונה | **לבדיקה ידנית** + התראת error (לא "הצליח") |
| מסוף אחר | חסר או זהה | הצליח, נחשב אמיתי |
| מסוף אחר | מספר שונה | לבדיקה ידנית + התראת error |

**מה נחשב אמיתי:** כל מה שאינו ברשימת מסופי הבדיקה, כולל ריק. הרשימה היא פונקציה אחת במיגרציה; מסוף חדש נוסף רק במיגרציה חדשה, והיא קובעת במפורש מה קורה לשורות ישנות (שורה נקבעת פעם אחת, בלידתה, ולא מחושבת מחדש).

## 3. פרק אימות

**[VERIFIED]** (נקרא/נמדד, מקור בסוגריים)
1. הדפדפן אינו מעביר מסוף; המסוף נבחר רק ב-`buildCreateLowProfile` מתוך `config.terminalNumber` (`open-fields.ts:69-92,175-207`, `create-request.ts:55`, `cardcom-purchase.ts:111,182-183`).
2. התשובה האמיתית של קארדקום ל-₪200 מ-7.10 23:36 כוללת `TerminalNumber: 1000` ברמה העליונה בלבד; ב-`TranzactionInfo` אין (קריאה ישירה מהשרת שלהם ב-7.10 23:48; נשמרה מוסתרת בתמלול הסשן, n=1, תשלום שהצליח). השורה `01a11814…` תואמת לה במספר עסקה (265515814), אישור (12345), מסמך (15935) וסכום (200.00).
3. `lpResultSchema` (`cardcom-settle.ts:45-86`) זורק את השדה; settle וה-sweeper שואלים עם ההגדרה הנוכחית, לא עם מה שנשמר.
4. הגדרות החיות של הפונקציות נקראו מהמסד ב-8.10 (`pg_get_functiondef`): `payment_operations_before_insert`, `payment_operations_guard_update`, `owner_agent_billing_sums`, `campaign_has_payment_activity`, `cancel_campaign`, `campaigns_guard_cancel`, `payment_operation_lines_guard`. הפרטים בסעיפים 5-6 נגזרים מהן.
5. עמודות חובה ללא ברירת מחדל ב-`payment_operations`: `campaign_id`, `event_id`, `kind` בלבד. אילוצים קיימים: `payment_operations_{amount,card_exp_month,card_exp_year,credit_applied,source}_check` (אין התנגשות עם השמות החדשים).
6. שני כותבי ההחזר היחידים (`cardcom-refund.ts:175-184`, `package-refund.ts:198-208`) מעבירים `parentOperationId`; אין כותב `release` בקוד. לכן "החזר/ביטול חייב אב" לא שובר זרימה קיימת.
7. הפיילוט: `outreach_enabled` ו-`voximplant_live_calls` דולקים; הקמפיין של 5aaf0363 מאושר עם ₪200 ו-0 אורחים (לידיעה בלבד — ראו סעיף 0.3).
8. מבקר: התנגשות השם במיגרציה A, עמודה מחושבת שאינה מתעדכנת, שני הקוראים של "קמפיין אחד לאירוע", מסך הבדיקה ל-SUMIT בלבד — הורצו/נקראו מחדש בנפרד.

**[OPEN]** (יוכרע בשלב המסומן)
- הרצה יבשה של המיגרציה על PostgreSQL 17.6 החי, בתפקיד השירות (שלב 1).
- האם תשובת קארדקום על תשלום שנכשל או ננטש כוללת `TerminalNumber` (לא נמדד; יימדד בבדיקות בשלב 4, מפתחות ומספר בלבד).
- סוג המסמך ש-`Auto` מפיק במסוף האמיתי לעוסק פטור (קבלה בלי מע"מ). שלב 6.
- אם הספרייה ב-SharePoint אוכפת שימור שמונע מחיקה של ההעתק שכבר הועלה (לא נבדק; לא נמחק).
- סדר השורות של `campaigns(...)` המוטמע ב-`event-cancellation.ts:403` ב-PostgREST (אין ערבות; מתקנים בסינון ובמיון מפורש).

## 4. שלבים

| # | שלב | תלוי ב | שער אימות | נקודת עצירה בטוחה | אישור בעלים |
|---|---|---|---|---|---|
| 0 | לשמור (commit) את עבודת הפיילוט לפי נתיבים מפורשים: שלוש המיגרציות שכבר הוחלו אך אינן ב-git, `types.generated.ts`, קוד קארדקום, בדיקות ומסמכים. בלי push | — | `git status` מציג רק את הצפוי | כן — אפס שינוי התנהגות | **כן** |
| 1 | מיגרציה A (סעיף 5): `npx supabase migration new ledger_money_source_stamp`; הרצה יבשה בעסקה שנגמרת ב-ROLLBACK; `db push --linked --dry-run` (חייב להציג רק את הקובץ החדש); `db push --linked`; `migration list --linked` ללא סטייה; `supabase db advisors --linked --type security`; אחר כך `npm run gen:types` + `npm run types:check`; commit למיגרציה ולטיפוסים יחד | 0 | הכישורון `supabase-postgres-best-practices` הופעל מחדש על הקובץ שנוצר בפועל (לפי הנחייתך); בלוק הבדיקה שבסוף המיגרציה עובר; ההפרש מ-gen:types מראה רק את העמודות החדשות והפונקציה | כן — המיגרציה תואמת קוד ישן (שורות חדשות מקוד ישן: ללא מסוף, נחשבות אמיתיות) | **כן** |
| 2 | מיגרציה "ביקורת ביטול" (סעיף 6), בקובץ נפרד, אותו תהליך | 1 | בלוק בדיקה + הרצה יבשה | כן — החתימה החדשה תואמת קריאה ישנה (`p_actor` אופציונלי) | **כן** |
| 3 | קוד (סעיף 7), בצעדים קטנים, בדיקות ממוקדות קודם | 1, 2 | `npm run lint`, `npx tsc --noEmit`, `npm run build` (לא במקביל לבנייה אחרת), כל הבדיקות | כן — אחרי כל קבוצת קבצים | לא (הפריסה אצל הבעלים) |
| 4 | אימות בזמן ריצה על beta (הבעלים מפעיל מחדש עם הפריסה הרגילה): אירוע חדש של הצוות, תשלום במסוף 1000 ← מסך "שולם" ← ביטול ← תשלום שוב ← סבב עם כרטיס נדחה. אחר כך שאילתות קריאה: ההכנסות לא זזו, השורות מסווגות, יש `echo`, סקריפט האינבריאנטות נקי | 3 | כל התנאים בסעיף 8 | כן | **כן** (פריסה והרצה) |
| 5 | סגירת מה שהשינוי מייתר (סעיף 9) | 4 | grep על כל מחרוזת/הערה שנמחקה; בדיקות | כן | **כן** (מחיקות) |
| 6 | מעבר לאוויר, כשהבעלים מחליט: קניית חבילת ה-₪100 הקיימת באירוע חדש של הצוות ← בדיקה שהמסוף שדווח שווה למספר המסוף האמיתי שבלוח של קארדקום ← סוג המסמך קבלה בלי מע"מ ← הכנסות +100 ← החזר דרך זרימת הביטול ← 0 באותו חלון דוח | 4 | רשימת הבדיקות בסעיף 8.4 | — | **כן** |

## 5. מיגרציה A — `ledger_money_source_stamp`

נוצרת עם `npx supabase migration new ledger_money_source_stamp < /dev/null`. הפונקציות המוחלפות נוצרות **מ-`pg_get_functiondef` החי ברגע היצירה** (הנוסחים ששמורים כאן הם של 8.10) ומוצגות כהפרש: הסקירה חייבת להראות בדיוק את העריכות שלהלן, ולא יותר.

```sql
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- תמונת מצב לבדיקת הסיום (נמחקת בקומיט)
create temp table _stamp_before on commit drop as
select (select count(*) from public.payment_operations) as n_rows,
       (select s.charged_amount from public.owner_agent_billing_sums('2026-01-01T00:00:00Z') s) as charged;

-- A1. ההגדרה היחידה של "מסוף בדיקה"
create function public.payment_is_test_terminal(p_terminal integer)
returns boolean language sql immutable parallel safe set search_path = ''
as $$ select coalesce(p_terminal = 1000, false) $$;
revoke execute on function public.payment_is_test_terminal(integer) from public, anon, authenticated;
grant  execute on function public.payment_is_test_terminal(integer) to service_role;
comment on function public.payment_is_test_terminal(integer) is
  'The ONE definition of a no-money CardCom terminal (1000). Evaluated once, when a payment row is born; never reclassifies existing rows. service_role EXECUTE is load-bearing: every ledger INSERT calls it.';

-- A2. עמודות ואילוצים (פקודות נפרדות, שמות מפורשים — ראו התנגשות השם בסעיף 10)
alter table public.payment_operations add column provider_terminal integer;
alter table public.payment_operations add column provider_terminal_echo integer;
alter table public.payment_operations add column is_test boolean not null default false;
alter table public.payment_operations add constraint payment_operations_provider_terminal_positive
  check (provider_terminal is null or provider_terminal > 0);
alter table public.payment_operations add constraint payment_operations_provider_stamp_coherent
  check ((provider = 'cardcom') = (provider_terminal is not null));
comment on column public.payment_operations.provider_terminal is
  'The CardCom terminal the session was asked to open on; written at INSERT; NULL for every other provider and for rows born before this column. Also set on a row whose session never opened.';
comment on column public.payment_operations.provider_terminal_echo is
  'The TerminalNumber CardCom reported in its own answer (top level only); NULL = not reported. Written once, never changed.';
comment on column public.payment_operations.is_test is
  'Set by payment_operations_before_insert from provider_terminal (children: from the parent); frozen; never written by the app.';
```

**A3. הפרשי הפונקציות** (מול הנוסח החי):

`payment_operations_before_insert` — (1) הצהרת משתנים: `v_parent_provider text; v_parent_terminal integer; v_parent_test boolean;`. (2) אחרי קריאת `v_effect`: החזר/שחרור חייבים אב.
```diff
+  if v_effect in ('return', 'void') and new.parent_operation_id is null then
+    raise exception 'operation kind % needs a parent operation', new.kind using errcode = 'check_violation';
+  end if;
```
(3) קריאת האב מרחיבה: `select p.campaign_id, p.outcome, p.provider, p.provider_terminal, p.is_test into v_parent_campaign, v_parent_outcome, v_parent_provider, v_parent_terminal, v_parent_test …`. (4) לפני `new.once_slot := …`:
```diff
+  if new.parent_operation_id is not null then
+    new.provider := v_parent_provider;
+    new.provider_terminal := v_parent_terminal;
+    new.is_test := v_parent_test;
+    new.provider_terminal_echo := null;
+  else
+    new.is_test := public.payment_is_test_terminal(new.provider_terminal);
+  end if;
```
`payment_operations_guard_update` — בתנאי הקפאה ("only outcome, amounts, provider refs…") נוספים:
```diff
      or new.once_slot is distinct from old.once_slot or new.parent_slot is distinct from old.parent_slot
+     or new.provider is distinct from old.provider
+     or new.provider_terminal is distinct from old.provider_terminal
+     or new.is_test is distinct from old.is_test
+     or (old.provider_terminal_echo is not null and new.provider_terminal_echo is distinct from old.provider_terminal_echo)
      then
```
המילוי המאוחר של `card_brand`/`card_issuer` נשאר כפי שהוא (העמודה `is_test` רגילה ולא משתנה, ולכן ההשוואה של השורה כולה תקינה).

`owner_agent_billing_sums` — שומרים את החתימה המלאה (`_until timestamptz default null`, ארבע עמודות `RETURNS TABLE`, `stable`, `set search_path = ''`, בלי `security definer`). עריכה אחת בכל אחת משתי תתי-השאילתות על הספר: אחרי `where o.outcome = 'succeeded'` מוסיפים `and not o.is_test`. ענף הקמפיינים הישנים והמשפט `not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)` לא נוגעים.

`campaign_has_payment_activity` — בתוך ה-`exists`, אחרי `and o.outcome in ('succeeded', 'pending', 'review')`:
```diff
+       and not (o.is_test and o.outcome = 'succeeded')
```
גוף הפונקציה במרכאות דולר: מרכאות רגילות, לא כפולות. חתימה: `language sql stable set search_path = ''`.

**A4. בלוק בדיקה בסוף הקובץ** (מבטל את כל המיגרציה אם משהו לא תקין):
```sql
do $$
declare v_before record;
begin
  if not has_function_privilege('service_role', 'public.payment_is_test_terminal(integer)', 'execute') then
    raise exception 'service_role lost EXECUTE on payment_is_test_terminal'; end if;
  if has_function_privilege('anon', 'public.payment_is_test_terminal(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.payment_is_test_terminal(integer)', 'execute') then
    raise exception 'payment_is_test_terminal is callable by a client role'; end if;
  if exists (select 1 from pg_proc p
              where p.oid in ('public.payment_is_test_terminal(integer)'::regprocedure,
                              'public.payment_operations_before_insert()'::regprocedure,
                              'public.payment_operations_guard_update()'::regprocedure,
                              'public.owner_agent_billing_sums(timestamptz,timestamptz)'::regprocedure,
                              'public.campaign_has_payment_activity(uuid)'::regprocedure)
                and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))) then
    raise exception 'a replaced function lost its search_path or became security definer'; end if;
  select * into v_before from _stamp_before;
  if exists (select 1 from public.payment_operations where is_test) then raise exception 'nothing may be classified by this migration'; end if;
  if (select count(*) from public.payment_operations) <> v_before.n_rows then raise exception 'ledger row count changed'; end if;
  if (select s.charged_amount from public.owner_agent_billing_sums('2026-01-01T00:00:00Z') s) is distinct from v_before.charged then
    raise exception 'revenue changed'; end if;
  if exists (select 1 from public.payment_operations where is_test is distinct from public.payment_is_test_terminal(provider_terminal)) then
    raise exception 'stored class differs from the definition'; end if;
end $$;
```

**A5. הרצה יבשה** (בכותרת הקובץ; הבעלים מריץ בעסקה אחת שנגמרת ב-`rollback`, אחרי `set local role service_role`; דרושים שני קמפיינים בלי שורת `package_purchase`):
a. `payment_is_test_terminal(1000/1001/null)` ← t, f, f. ב. שורות קיימות: אפס `is_test`, וסכום ההכנסות זהה. ג. הוספת `package_purchase` ממתין עם `('cardcom', 1000)` ← `is_test = t`; `('cardcom', 1001)` ← f; `('cardcom', null)` ו-`('sumit', 1000)` ← שגיאה 23514. ד. השלמה ל-`succeeded` עם `provider_terminal_echo = 1000` מצליחה; שינוי `provider_terminal`/`is_test`/הד אחרי שנכתב ← שגיאה; `succeeded → failed` ← שגיאה; מילוי מאוחר של `card_brand` מצליח. ה. שורת `refund` שהקוד שולח כ-`('sumit', 5)` נקראת `('cardcom', 1000, t)`; `refund` בלי אב ← שגיאה. ו. `campaign_has_payment_activity`: false עם שורת בדיקה מצליחה בלבד, true אחרי הוספת שורה ממתינה, true עם שורה אמיתית. ז. `owner_agent_billing_sums`: רק האמיתי נספר; החזר בדיקה לא גורע. ח. `create or replace` של הפונקציה כך ש-1001 בדיקה ← שורה ישנה במסוף 1001 נשארת `f` (ההוכחה שאין סיווג מחדש).

**A6. החזרה לאחור:** להחזיר את ארבע הפונקציות מהנוסח החי שמודבק בבלוק `ROLLBACK` בכותרת הקובץ, אחר כך למחוק את שני האילוצים, אחר כך את `is_test`, `provider_terminal_echo`, `provider_terminal`, ובסוף את הפונקציה. מותר למחוק עמודות רק כל עוד אף שורה לא נושאת מסוף. קוד ישן ממשיך לעבוד גם בלי החזרה.

**A7. בדיקה לפי הכישורון `supabase-postgres-best-practices`** (הופעל ב-8.10 על הטיוטה; יופעל שוב על הקבצים שייווצרו בפועל):

| כלל | תוצאה |
|---|---|
| `schema-constraints` (הוספת אילוץ בבטחה) | שמות האילוצים מפורשים ונבדקו מול `pg_constraint` החי: אין התנגשות. מיגרציה רצה פעם אחת בעסקה אחת, ולכן לא נדרש `if not exists`; עטיפה כזו הייתה מסתירה בדיוק את התנגשות השם שמצאנו. |
| `lock-short-transactions` | `lock_timeout = 5s` ו-`statement_timeout = 30s` לכל מיגרציה. `add column` עם ברירת מחדל קבועה היא שינוי מטא-דאטה בלבד; שני אילוצי `check` נבדקים על 10 שורות בלבד (בטבלה גדולה היו עוברים דרך `not valid` ואחר כך `validate`). |
| `lock-deadlock-prevention` | אין קצה נעילה חדש: הטריגר ממשיך לנעול קודם את שורת הקמפיין; `cancel_campaign` נועלת אותה ראשונה, ורק אחר כך קוראת את הספר וכותבת ליומן. |
| `schema-data-types` | `integer` למספר מסוף (עד 999,999,999), `boolean` לסיווג, `uuid` למזהה המבצע. |
| `schema-foreign-key-indexes` | לא נוספו מפתחות זרים. |
| `security-privileges` / `security-rls-basics` | `revoke … from public, anon, authenticated` ו-`grant … to service_role` בלבד לכל פונקציה חדשה; ה-RLS על הספר ללא שינוי (פעיל, בלי מדיניות, בלי הרשאות ללקוחות); אין הרשאות עמודה חדשות. |
| `query-*` (אינדקסים) | לא נוסף אינדקס על `is_test` או `provider_terminal`: סלקטיביות נמוכה והטבלה קטנה; הסינון `not o.is_test` נוסף לתנאים הקיימים ולא משנה את מסלול הגישה: חיפושי הקמפיין (`campaign_has_payment_activity`, `cancel_campaign`) נשענים על `payment_operations_campaign_idx (campaign_id, occurred_at desc)` הקיים (נבדק ב-`pg_indexes`). |
| `schema-lowercase-identifiers` | כל השמות באותיות קטנות עם קו תחתי. |

## 6. מיגרציה "ביקורת ביטול" — `cancel_campaign_audit` (הוחלה ב-8.10: `20261008040027`)

הסיבה: ביטול קמפיין ששולם בכסף בדיקה הופך לאפשרי (מיגרציה A), ושינוי כזה חייב להשאיר רישום של מי ומתי (כללי הפרויקט). היום אין רישום, והקוד אינו יכול לכתוב אותו באמינות: `logActivity` (`src/lib/data/activity.ts`) רץ בהקשר של המשתמש, נכשל בשקט בכוונה (שורת שגיאה כללית בלבד), ומדיניות ההוספה `al_owner_insert` (`with check user_id = auth.uid()`) מאפשרת לכל משתמש מחובר לכתוב שורה בכל פעולה שיבחר. שורה שנכתבת שם לא מוכיחה דבר; שורה שנכתבת בתוך הפונקציה, באותה עסקה, כן.

**מה הקובץ עושה** (הנוסח המלא בקובץ; זה הנוסח החי של 8.10 פחות השורות המסומנות `[audit]`):

1. `drop function public.cancel_campaign(uuid)` ואחריו `create function public.cancel_campaign(p_campaign uuid, p_actor uuid default null)`. לא `create or replace`: שינוי רשימת ארגומנטים בו משאיר שני עומסים, והקריאה בשם שהקוד מבצע (`rpc('cancel_campaign', { p_campaign })`) הופכת דו-משמעית.
2. `security invoker` (היה `security definer`) עם `search_path` ריק. הקורא היחיד הוא `createAdminClient()` (`service_role`), שמחזיק כבר בכל ההרשאות שהפונקציה משתמשת בהן, ובלוק האימות שבקובץ בודק אותן אחת אחת. זו ברירת המחדל של הפרויקט (זיכרון `supabase-official-tooling`).
3. שורה אחת ב-`activity_log` באותה עסקה: `action = 'campaign.cancelled'`, `user_id = p_actor` (NULL כשהקורא לא העביר), `event_id` של הקמפיין, `meta = { campaignId, statusBefore, hadSucceededPayment, testMoneyOnly }`. אם כתיבת השורה נכשלת, שינוי הסטטוס מתבטל איתה: ביטול בלי רישום לא קורה.
4. אותה הרשאת הרצה כמו קודם: הבעלים ו-`service_role` בלבד (`revoke` מ-`public, anon, authenticated`), והערת פונקציה (`comment on function`) שמתעדת את החוזה.
5. בלוק אימות בסוף הקובץ (העסקה כולה מתבטלת אם אחת נכשלת): פונקציה אחת בלבד; `security invoker` ו-`search_path` ריק; אין מי שמריץ מלבד הבעלים ו-`service_role` (גם לא דרך PUBLIC); לשירות כל ההרשאות הנדרשות; הטריגר `campaigns_guard_cancel` פעיל; שבעה קטעי טקסט בגוף: ששת קטעי הכלל המקוריים (שבדיקות הקוד מצמידות) והוספת השורה ליומן.

הכלל "מתי מותר לבטל", ערכי ההחזרה (`no_campaign`, `already_cancelled`, `not_cancellable`, `cancelled`) והטריגר `campaigns_guard_cancel` לא השתנו. ההפרש מול הפונקציה החיה, וזה כל מה שהשינוי הזה מחזיק:

```diff
--- live-before
+++ file
@@ -1,5 +1,5 @@
-CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign uuid)
+CREATE FUNCTION public.cancel_campaign(p_campaign uuid, p_actor uuid DEFAULT NULL)
  RETURNS text
  LANGUAGE plpgsql
- SECURITY DEFINER
+ SECURITY INVOKER
  SET search_path TO ''
@@ -7,2 +7,3 @@
 declare v public.campaigns;
+        v_paid boolean; v_test_only boolean; -- [audit]
 begin
@@ -23,3 +24,17 @@
   end if;
+  -- [audit] What this cancellation erases. The gate above lets a SUCCEEDED payment row through only when it is test money,
+  -- so a true v_paid always comes with a true v_test_only; both are recorded so that a reader never has to infer it.
+  -- Same effect filter as campaign_has_payment_activity, so the record describes exactly the rows the gate waved through.
+  select count(*) > 0, coalesce(bool_and(o.is_test), false) into v_paid, v_test_only
+    from public.payment_operations o
+    join public.payment_operation_kinds k on k.kind = o.kind
+   where o.campaign_id = v.id and o.outcome = 'succeeded' and k.effect <> 'none';
   update public.campaigns set status='cancelled' where id=p_campaign;
+  -- [audit] Who and when, in the SAME transaction: if this row cannot be written the status change is rolled back with it, so a
+  -- cancellation without a record does not happen. p_actor is the staff member the application verified; NULL = the caller did
+  -- not pass one (old application code).
+  insert into public.activity_log (user_id, event_id, action, meta)
+  values (p_actor, v.event_id, 'campaign.cancelled',
+          jsonb_build_object('campaignId', v.id, 'statusBefore', v.status,
+                             'hadSucceededPayment', v_paid, 'testMoneyOnly', v_paid and v_test_only));
   return 'cancelled';
```

**הבדלים מהטיוטה המקורית של הסעיף הזה** (נקבעו בכתיבת הקובץ): (א) ספירת "שולם" לרישום משתמשת ב-`k.effect <> 'none'`, כמו `campaign_has_payment_activity`, ולא ב-`('collect', 'return')`: הרישום מתאר בדיוק את השורות שהשער העביר; היום התוצאה זהה. (ב) `drop` ואחריו `create function` (בלי `or replace`). (ג) `security invoker` נכתב במפורש. (ד) הערת פונקציה ובלוק אימות מורחב.

**אימות, מה נבדק ומה עוד לא:**

- בלוק האימות שבקובץ עבר (המיגרציה הוחלה).
- אחרי ההחלה, בקריאה בלבד: ראו "התקדמות" בראש המסמך.
- **ההרצה היבשה המתוכננת (`dry_run_cancel_audit.sql`) לא רצה לפני ההחלה.** במקומה, בדיקת התנהגות אחרי ההחלה (`behavior_check_cancel_audit.sql`): אותם תרחישים בדיוק, בעסקה שמתבטלת, כ-`service_role`. היא בודקת: הכלל זהה לטקסט הישן; סגור, כסף אמיתי ואין-קמפיין נשארים `not_cancellable` בלי רישום; הקריאה הישנה (`p_campaign` בלבד) מבטלת וכותבת רישום עם `user_id` ריק; קריאה שנייה מחזירה `already_cancelled` בלי רישום שני; עם `p_actor` הרישום נושא את המשתמש; תשלום בדיקה ממתין חוסם, ושהצליח מאפשר ביטול עם `hadSucceededPayment` ו-`testMoneyOnly`; כסף אמיתי חוסם, ו-`update` ישיר עדיין נחסם בטריגר; משתמש שאינו קיים ב-`p_actor` נדחה והסטטוס חוזר; `anon` ו-`authenticated` לא מריצים. **תוצאה (8.10): 17 שורות, כולן PASS, 0 כשלים** (הכלל הישן והחדש זהים ב-864 תווים). אחרי הבדיקה אומת בקריאה בלבד שלא נשאר דבר במסד.
- הבדיקה האמיתית (`rpc('cancel_campaign')` עם לקוח השירות ו-`p_actor` מהקוד) בשלב 4.

**SECURITY INVOKER ולא DEFINER:** הפונקציה החיה הייתה `security definer`, אבל הקורא היחיד הוא `createAdminClient()` (`service_role`: הרשאות טבלה ו-BYPASSRLS), ולכן העלאת הרשאות מיותרת. זו ברירת המחדל שנקבעה בפרויקט (INVOKER כשהקורא הוא `service_role`; DEFINER רק כשקורא חלש צריך העלאה). ההוכחה בריצה היא קריאה אמיתית בשלב 4, לא רק `prosecdef`.

## 7. שינויי קוד (אחרי שהמיגרציות הוחלו והטיפוסים נוצרו מחדש)

| קובץ | שינוי |
|---|---|
| `src/lib/payments/ledger.ts` | `NewOperation` מקבל `provider?: 'sumit' \| 'cardcom'` ו-`providerTerminal?: number \| null`, שנכתבים **ב-`insertRow` בלבד** (`detailColumns` משותף לעדכונים). `providerTerminalEcho?` נכתב בהשלמה ב-`detailColumns`. `loadOperations` טוען `is_test`, `provider_terminal`, `provider_terminal_echo`. הטיפוס שנוצר מציג את `is_test` כשדה אופציונלי וניתן לכתיבה — לכן בדיקה שמוודאת ש-`insertRow` ו-`detailColumns` אינם פולטים `is_test` או `provider_terminal` בעדכון. |
| `src/lib/payments/status.ts` | `OperationRow.isTest?: boolean`; `PaymentState.testMoney?: boolean` (אופציונלי: חסר = false; נמנע שבירה של כ-30 מקומות בבדיקות). אמת רק אם יש שורת גבייה/החזר מוצלחת אחת לפחות וכולן `isTest`. |
| `src/lib/payments/cardcom-terminal-echo.ts` (חדש, טהור) | `terminalEchoFromCardcom(value: unknown): number \| null` (מספר שלם חיובי, אחרת null) ו-`checkTerminalEcho({ stamp, echo, isTestTerminal }): 'accept' \| 'review'` לפי טבלת סעיף 2. |
| `src/lib/payments/cardcom-purchase.ts` | `beginOperation({ …, provider: 'cardcom', providerTerminal: config.terminalNumber })` מאותו אובייקט `config` שבונה את בקשת ה-Create. `meta.provider` נשאר עד שלב הניקוי. |
| `src/lib/payments/cardcom-settle.ts` | `TerminalNumber: z.unknown().optional()` ברמה העליונה בלבד (לא `z.number()`: צורה בלתי צפויה לא תהפוך תשלום ששולם ל"לא קריא", לפי ההערה בשורות 49-52). בוחר `provider_terminal` יחד עם השורה. **נעילה:** רשום ושונה מההגדרה הנוכחית ← לא שואלים, לא סוגרים כ"נכשל", לבדיקה ידנית עם התראת error (גם ב-`flagPaymentAfterFailure`). שומר את ההד בהשלמה (הצלחה, כישלון או בדיקה) כשהגיע. הכרעה לפי `checkTerminalEcho`. התראות ו-`afterPaid` קוראים את הסיווג **מהשורה הסגורה** (לא מהשורה שנקראה לפני הסגירה); לשורת בדיקה: בלי בדיקת תקרה, כותרת התראה עם "[בדיקה]", דחייה היא info. |
| `src/lib/payments/cardcom-refund.ts` | מסרב (`terminal_changed`) כשהמסוף הרשום ריק או שונה מההגדרה הנוכחית (`CancelDoc` לא שולח מסוף). `package-refund-types.ts` ו-`package-cancellation.ts`: הסיבה והמשפט בעברית. |
| `src/lib/data/campaigns.ts` | `cancelCampaign` מעביר `p_actor` (מזהה המשתמש המאומת שעבר את `requirePlatformPermission('campaigns.runstate')`). `campaigns.test.ts:1264` מצפה היום לקריאה בלי `p_actor` ויעודכן. |
| `src/lib/data/campaign-status.ts` | `isCampaignCancellable`: תשלום `testMoney` אינו חוסם 'collected'; ממתין/בבדיקה חוסמים כמו במסד. תיקון ההערה השגויה בשורות 46-59 (ה-RPC קורא ל-`campaign_has_payment_activity`). בדיקת ההתאמה הקיימת (`campaign-status.test.ts:132`) קוראת היום את `20260630223635_event_lifecycle_state_model.sql` (הנוסח המקורי של הפונקציה) וחותכת מ-`function public.cancel_campaign`; היא תעבור לקרוא את `20261008040027_cancel_campaign_audit.sql` ותעגן ב-`create function public.cancel_campaign(`, כי בקובץ החדש קודם לו `drop function public.cancel_campaign` שאין בו את הכלל. |
| `src/lib/data/admin/payment-review.ts` + `src/app/(admin)/admin/payments/review-card.tsx` | **כרטיס בדיקה ידנית מותאם לקארדקום** (חייב לעלות עם הנעילה): לשורת קארדקום אין בדיקה מול SUMIT ואין נוסח SUMIT; מוצגים מסוף שביקשנו, מסוף שדווח או "לא דווח", מספר מסמך ואסמכתה; "נכשל" דורש הערה שמציינת מה נבדק בלוח של קארדקום; "הצליח" אינו מוצע כשהמסוף שדווח קיים ושונה. |
| `src/lib/data/admin/event-view.ts:80` ו-`src/lib/data/event-cancellation.ts:403-416` | לסנן קמפיינים מבוטלים ולמיין מהחדש לישן (היום `maybeSingle()` נכשל עם שני קמפיינים, ו-`campaigns[0]` בדרך ההחזר היחידה עלול להיות המבוטל). בדיקה עם `[מבוטל, חי]` בכל אחד. |
| תוויות לצוות בלבד (בלי חסימה) | באנר "מסוף בדיקה — לא יחויב כרטיס אמיתי" בטופס; במסך "שולם": "תשלום בדיקה — לא נגבה כסף ולא נספר בהכנסות"; כפתור הביטול בעמוד הקמפיין לכסף בדיקה: "אפס ריצת בדיקה"; ברשימת האירוע של הצוות: "N תשלומי בדיקה, M אמיתיים". `manage-client.tsx` ממשיך להציג את הקמפיין כ"שולם". |
| `src/lib/data/agreement-archive.ts` (אופציונלי, החלטה בשלב 3) | הסריקה הלילית מדלגת (בלי לסמן כמיוצא) על הסכמים של אירוע שסומן כבדיקה ולא נמחק, וסופרת כמה דילגה. סימון האירוע החדש כבדיקה הוא חלק מרשימת הפתיחה של הסבב הראשון. |
| `src/lib/data/cardcom-config.ts`, `src/lib/payments/provider.ts` | הקבוע `CARDCOM_TEST_TERMINAL` נשאר (אין תלות בקריאה נוספת למסד בשער הלקוחות) + בדיקת התאמה שקוראת את טקסט המיגרציה ומוודאת שזה אותו מספר. |
| `scripts/ledger-invariants.sql` (חדש) | שאילתות קריאה בלבד: שורת בדיקה מוצלחת בלי הד שווה; שורת קארדקום בלי מסוף אחרי הגשר; בן שונה מאביו; סכום ההכנסות מול סכום ידני. רצות אחרי כל `db push` ובקבלת מעבר לאוויר: `npx supabase db query --linked -f scripts/ledger-invariants.sql`. |

### 7א. מה נבנה בפועל בשלב 3, והסטיות מהטבלה

- **`checkTerminalEcho`** מחזיר `{ verdict: 'accept' }` או `{ verdict: 'review', reason: 'echo_missing' | 'echo_differs' }` (ולא רק `'accept' | 'review'`), כדי שההערה בשורה והתראת ה-error ידעו להגיד מה קרה בלי לחשב שוב. נוסף `terminalsConflict` (מסוף שנפתח מול מסוף שדווח; לא ידוע = אין התנגשות) באותו קובץ טהור, והוא משמש גם את מסך הבדיקה הידנית.
- **הסיווג "מהשורה הסגורה"**: settle קורא את `is_test` ו-`provider_terminal` מהשורה עצמה בקריאה הראשונה. העמודה קפואה במסד מרגע הלידה, ולכן זו אותה ערך שבשורה הסגורה; הקוד אינו גוזר סיווג ממסוף החיבור הנוכחי בשום מקום. בדיקה מוכיחה זאת: שורה בלי חותמת נשארת כסף אמיתי גם כשהחיבור כבר על מסוף הבדיקה.
- **כותרת "[בדיקה]"** בכל התראה על תשלום בדיקה, מקובץ משותף אחד (`test-money-label.ts`) ששימש גם את ההחזר. דחייה של תשלום בדיקה היא `info`. ב-`activity_log` של רכישה והחזר של כסף בדיקה נוסף `testMoney: true` (רק כשנכון; אף קורא לא תלוי בצורת ה-meta).
- **החזר (`terminal_changed`)** נבדק מיד אחרי "אין תשלום" ו"יותר ממה ששולם" ולפני "חלקי" ו"אין מסמך": תשלום שהחיבור הנוכחי לא יכול לזכות בכלל הוא הדבר הראשון שהאדמין צריך לשמוע. `cardcomRefundSummary.hasCard` הוא `false` באותו מצב, כדי שהמסך לא יבטיח החזר אוטומטי שהשרת יסרב לו. לשורות הפיילוט הישנות (ללא חותמת) אין החזר אוטומטי דרך האפליקציה.
- **מסך הבדיקה הידנית**: לשורת קארדקום מוצגים מסוף שנפתח, מסוף שדווח ("לא דווח"), מספר עסקה, אסמכתה ומספר מסמך; אין כפתור בדיקה ב-SUMIT ואין בו אזכור של SUMIT; מספר המסמך ממולא מראש מהשורה. כשהמסוף שדווח שונה מזה שנפתח אין כפתור "אשר גבייה" והשרת מסרב גם לבקשה שנוצרה ידנית. השרת גם מסרב לחפש שורת קארדקום ברשימת SUMIT. נוסחי האימות בסכמה (`נדרש לציין מה נבדק…`) הפכו לנייטרליים ("אצל חברת הסליקה") כי הסכמה משותפת לשני הספקים.
- **תוויות לצוות**: נבנו שלוש מארבע: באנר על טופס המסוף שמשמש מסוף בדיקה, השורה במסך "שולם", ו"אפס ריצת בדיקה" במקום "ביטול קמפיין" (טקסט הכפתור והאישור נקבעים בפונקציה טהורה `cancelActionCopy`). **לא נבנתה** התווית "N תשלומי בדיקה, M אמיתיים" ברשימת האירוע של הצוות: אין היום שום מסך צוות שמציג תשלומים של אירוע, ומסך האירוע של הצוות מחוייב במפורש לא להציג נתוני חיוב. הוספתה היא מסך חדש ולא תווית.
- **קוראי "קמפיין אחד לאירוע"**: `event-cancellation.ts` משתמש ב-`liveCampaignOf` (ב-`campaign-status.ts`) על קמפיינים ממוינים מהחדש לישן, וגם `getCampaignForEventAdmin` מסנן קמפיינים מבוטלים. `event-view.ts` (הרשאת `view_events`) קורא **`id` בלבד**, מהחדש לישן, שורה אחת: ההרשאה קונה זהות ולא סטטוס או כסף, ובדיקת `permission-separation.test.ts` מעגנת זאת (גרסה ראשונה שלי קראה גם `status` ונכשלה שם; תוקן בקוד ולא בבדיקה). החדש ביותר הוא החי כשיש חי, כי קמפיין חדש נוצר רק כשאין חי (`campaigns_event_noncancelled_uidx`). הפונקציה `currentCampaignOf` שנכתבה לפני כן נמחקה כשנשארה בלי קורא. שאר הקוראים של `campaigns` לפי אירוע נבדקו ונמצאו כבר מסננים מבוטלים או מסדרים לפי `created_at`.
- **דמה הטריגר בבדיקות**: במקום לשכפל את התנהגות הטריגר בשש הבדיקות, נוסף `src/test/ledger-stamp-trigger.ts` (`withLedgerStamp`) שעוטף את הדמה הקיימת בכל אחת מהן, והלקוח המדומה מעביר ל-`beforeInsert` גם את השורות שכבר בטבלה (כדי ששורת בת תקרא את האב). בדיקת התאמה ב-`provider.test.ts` קוראת את הגדרת `payment_is_test_terminal` בנוסח המיגרציה האחרון ומוודאת שהמספר זהה לקבוע בקוד ולדמה.
- **לא נבנה (אופציונלי בתכנית)**: דילוג ארכיון ההסכמים על אירועי בדיקה. כל סבב בדיקה מעתיק הסכם חדש לספריית SharePoint (סעיף 11); ההחלטה אצל הבעלים.
- **הסקירה העצמאית (8.10) וטיפול בממצאים.** שישה ממצאים קלים, כולם תוקנו:
  1. *הד המסוף מקבל מספר שהעמודה לא מחזיקה* (`terminalEchoFromCardcom`): נוסף חסם עליון `2_147_483_647` (העמודה `integer`). בלעדיו תשלום ששולם היה נשאר ממתין בלי התראה אם קארדקום הייתה מחזירה מספר גדול.
  2. *מסך הבדיקה הידנית מחק את קישור המסמך*: אישור עם אותו מספר מסמך שכבר שמור בשורה משאיר את המזהה והקישור כמות שהם; רק מספר שונה מחליף את המסמך (בלי הקישור הישן). שורה שהושלמה קפואה, ולכן אי אפשר היה להחזיר אותו.
  3. *הסלאק ורישום הפעילות של בדיקה ידנית לא סימנו כסף בדיקה*: כותרת "[בדיקה]" ו-`testMoney: true` (רק כשנכון), כמו בשאר ההתראות.
  4. *נוסח ההתנגשות במסוף לא אמר מה לעשות בכסף שנגבה*: טקסט אחד משותף (`terminal-conflict-copy.ts`) לכרטיס ולשרת: לבדוק לאן הגיע הכסף, **להחזיר חיוב שנגבה ידנית בלוח של קארדקום לפני הסימון**, ורק אחר כך לסמן ככושלת (אחרי "נכשל" הלקוח יכול לשלם שוב ואי אפשר להחזיר את השורה מהמערכת). הכרטיס עם התנגשות אומר "לפני שמסמנים ככושלת" ולא "לפני שמאשרים".
  5. *`isCampaignCancellable` הניח לביטול לעבור כשכסף אמיתי הוחזר במלואו, והפונקציה במסד סירבה*: כסף אמיתי שנגבה והוחזר (`collected` / `refunded`) חוסם ביטול גם בקוד. נוספה בדיקת התאמה שמעגנת את סעיפי ה-SQL עצמם (`o.outcome in ('succeeded', 'pending', 'review')` ו-`not (o.is_test and o.outcome = 'succeeded')`).
  6. *`getCampaignForEventAdmin` ו-`resolveCancellationRequest` בחרו קמפיינים שונים כשכל הקמפיינים מבוטלים*: הראשון מסנן מבוטלים. מצב "אין קמפיין פעיל" קיבל הודעה ואישור משלו בטופס הביטול: ביטול מלא אומר שלא תהיה תנועה כספית; חיוב חלקי אומר במפורש שלא יחויב דבר **אבל הלקוח יקבל הודעה על חיוב בסכום שהוזן** (כך נוסח המייל הקיים; ראו סעיף 11).
  
  הערות קטנות שתוקנו: כותרת התראה לפי הסיבה (הד חסר / הד שונה) ולא אחת לשתיהן; שורות בדיקה בלי חותמת מוזנות כ-`provider: 'sumit'` ולא כשורת קארדקום בלי מסוף שהמסד לא יכול להחזיק; הערת הדמה של הטריגר מפרטת את כל מה שהיא מדלגת עליו; תווית "מספר אישור" (כך נקרא ב-CardCom) במקום "אסמכתה"; `<bdi>` סביב הערכים; התג הקיים `Badge` במקום תג בכתיבה ידנית; ניסוח אחיד "מספר המסמך".
  
  **נדחו בכוונה:** (א) איחוד `provider` ו-`providerTerminal` לטיפוס אחד מבדיל: ה-CHECK במסד כבר אוכף את הקשר, והשינוי היה משנה את החתימה של ארבעה קוראים בלי תועלת בהתנהגות; (ב) ניסוח ניטרלי לבאנר "אין כרטיס שמור" כשהחסימה היא `terminal_changed`: הבאנר אומר "אין כרטיס שמור" אף שהסיבה בפועל היא מסוף שונה, אבל ההוראה שבו (להחזיר ידנית אצל חברת הסליקה, או לדחות) נכונה, והסיבה המדויקת מוצגת בהודעת הסירוב עצמה. ניקוי נוסח בלבד.

## 8. בדיקות ושערים

1. **ממוקדות קודם:** `status`, `ledger` (כולל: אין `is_test` בעדכון; הד נכתב בהשלמה), `cardcom-terminal-echo` (מחרוזת, ריק, שלילי, חסר), `cardcom-settle` (כל שורות הטבלה בסעיף 2, הנעילה, סיווג מהשורה הסגורה), `cardcom-refund`, `campaign-status` (התאמה למיגרציה), `event-view`/`event-cancellation` (שני קמפיינים), כרטיס הבדיקה הידנית, תוויות הצוות.
2. **בדיקות כפולות:** שש הבדיקות עם דמה ל-`beforeInsert` (`ledger`, `cardcom-purchase`, `cardcom-refund`, `package-purchase`, `package-refund`, `payment-orphans`) מחקות את הטריגר החדש: העתקה מהאב, `is_test` ממסוף 1000, אחרת הבדיקות החדשות עוברות מהסיבה הלא נכונה.
3. **שערי Definition of Done:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, כל הבדיקות, `npm run types:check`. אזהרות מטופלות; בדיקה אדומה מתוקנת בלי קשר למי שגרם לה.
4. **זמן ריצה (שלב 4 ושלב 6):** באירוע חדש של הצוות. שלב 4: ההכנסות (`owner_agent_billing_sums('2026-01-01')`) לא זזות; השורות `is_test = true`; ל-`provider_terminal_echo` יש 1000; אין התראת תקרה; סקריפט האינבריאנטות נקי; גם סבב עם כרטיס נדחה מתאפס. שלב 6: המסוף שדווח = המספר שבלוח של קארדקום; `meta.cardcom_document_type` = `Receipt` ללא שורת מע"מ; ההכנסות +100 ואחר כך 0 **באותו חלון דוח**; לפני החלפת מסוף: `select count(*) from public.payment_operations where meta->>'provider'='cardcom' and outcome in ('pending','review')` = 0.

## 9. מה השינוי מייתר (נסגר בשלב 5, באישור)

- הערה שגויה ב-`campaign-status.ts` (נתקנת בשלב 3).
- מחרוזות ב-`test-event-section.tsx` שמבטיחות שרישומי החיוב יימחקו (שורות 45, 63, 73): הרישומים לא נמחקים.
- נוסח הטפסים והכרטיס בעמוד הגדרות קארדקום ("מסוף בדיקות" ← "לפי התיעוד של קארדקום").
- ההערה בפיילוט (`cardcom-pilot-plan.md`): "העמודה provider נשארת sumit" ו-D4 — נסומנות כמוחלפות בתכנית הזו.
- אחרי שמתקנים: חמשת הקוראים של `meta.provider` עוברים לעמודת `provider` (`purchase-provider.ts`, `cardcom-pending.ts`, `payment-orphans.ts`, נתיב ה-settle, `cardcom-purchase.ts`), ואז מפסיקים לכתוב `meta.provider`. **לא לפני** שכל שורה חדשה נושאת `provider = 'cardcom'`.
- נהלים קצרים לכתיבה: "הוספת מסוף בדיקה" (מיגרציה שמחליפה את הפונקציה ומציינת מה קורה לשורות ישנות) ו"החלפת מסוף לאמיתי".

## 10. תיקונים לטיוטה המקורית (איך נוצרו, לתיעוד)

1. שם אילוץ כפול (A2 ו-A3 אותו שם אוטומטי) ← שמות מפורשים ופקודות נפרדות.
2. עמודה מחושבת (`generated`) ← עמודה רגילה שנקבעת בטריגר, כי פוסטגרס מחשב עמודה כזו רק בכתיבה.
3. הד מהספק בשתי רמות ובתוך `meta` ← רמה עליונה בלבד, עמודה משלו, קריאה סלחנית.
4. נעילה שמעבירה שורות קארדקום למסך בדיקה ידנית שמדבר רק SUMIT ← כרטיס מותאם.
5. הנחה של קמפיין אחד לאירוע בשני קוראים ← סינון מבוטלים.
6. ביטול קמפיין ששולם בלי רישום ← רישום בתוך הפונקציה.

## 11. נמצא ולא חלק מהשינוי (להחלטה נפרדת, רק אם תרצה)

- **חיוב חלקי באירוע בלי קמפיין פעיל:** `resolveCancellationRequest` מאשר אותו (אין מה לגבות, `capture_outcome = not_applicable`), אבל המייל ללקוח (`CANCELLATION_RESOLUTION_COPY.partial_charge`) אומר "אושרה עם חיוב חלקי של ₪X". זה היה כך גם קודם לאירוע שמעולם לא היה לו קמפיין; הטקסט שבטופס נוסח עכשיו במדויק. אם תרצה, אפשר לחסום את האפשרות בשרת באירוע כזה (שינוי נפרד).
- **דיווח הכנסות בהגדרה ישנה:** כלל סוכן הבעלים (`reply-text.ts:58`) מסכם את הטבלה הישנה בלבד, ולכן אינו רואה כסף של חבילות; הרשאת הקריאה של הסוכן אינה יכולה להריץ את פונקציית ההכנסות, ולכן הכלל צריך להפנות לכלי `billing_summary`. תפקיד `business-ops` השבועי (ימי ראשון 10:00) מחשב מחזור בהגדרה הישנה ויציג 0 לכסף אמיתי של חבילות. `billing_summary` זורק שגיאה כשבחלון דיווח יש החזר בלי הרכישה שלו.
- **ארכיון SharePoint:** כל סבב בדיקה חותם הסכם חדש (לפני התשלום), והסריקה הלילית (03:50) מעתיקה אותו לספרייה המשפטית לשבע שנים; הגיבוי החודשי שומר הכול. ההעתק של 8.10 כבר שם. (דילוג על אירועי בדיקה — סעיף 7, אופציונלי.)
- **מעבר לאוויר:** ברגע שמדליקים מסוף אמיתי, כל לקוח מופנה אליו מיד (אין שלב צוות בלבד, ואין חבילת ₪1 פרטית; החבילות הפעילות ₪100 ו-₪200 גלויות לכולם). לפי הנחייתך לא נבנו חסימות.
- **החלפת מסוף/שם משתמש בזמן תשלום פתוח:** בלי חסימה במסד; הנעילה בקוד (סעיף 7) מונעת רק רישום כושל כ"נכשל". מומלץ לא להחליף כשיש תשלום פתוח (היום אפס).
- **שלושה קבלות ₪1 אמיתיות** מדף האבחון של SUMIT בטבלה `sumit_test_transactions`, מחוץ לספר; אחרי המעבר לאוויר יהיו שתי מערכות קבלות (שאלות ליועץ המס).
- שם, מייל וטלפון של בודקי תשלום נשמרים בשורות שאי אפשר למחוק (מאז המיפוי ב-8.10).
- הקשחה נגד מחיקה פיזית של שורות ספר (היום אפשר למחוק שתי שורות `release` ישנות).
- **`activity_log` בלי אינדקס על המפתחות הזרים:** בטבלה רק המפתח הראשי. `event_id` (מחיקה מדורגת עם האירוע) ו-`user_id` (`set null` עם מחיקת המשתמש) נסרקים מלאים בכל מחיקה כזו. ישן יותר מהשינוי הזה ולא נוסף בו (כלל `schema-foreign-key-indexes`); הטבלה קטנה היום.

## 12. בסיס עובדתי לביקורת (מקורות)

דוחות הבודקים והמבקר: `~/.claude/projects/-var-www-vhosts-kalfa-me-beta/c2472cca-fec1-4673-965a-7e35f4d0a57d/subagents/workflows/wf_3c29f2b1-39d/journal.jsonl`; הדוח המתוקן של בודק האיתות: `…/tool-results/toolu_014ajfqmURW9Nv8fmC2Haiz1.txt`. התכנונים המתחרים (ספר חול, דלת מחיקה מוגבלת) נדחו: ספר נפרד מוסיף טבלאות וכפילות; דלת מחיקה מחלישה את אי-השינוי של הספר ופגה עם המעבר לאוויר.
