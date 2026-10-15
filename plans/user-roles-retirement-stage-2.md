# פרישת `user_roles` — שלב 2 (מחיקת `has_role`, `user_roles`, `app_role`)

נכתב 15.10.2026. **הוחלה במסד החי ב-15.10.2026 (הבעלים הריץ `supabase db push`).** המיגרציה נוצרה בפקודה `supabase migration new retire_user_roles_stage_2` (הקובץ `supabase/migrations/20261015134735_retire_user_roles_stage_2.sql`).

**אומת אחרי ההחלה (מסד חי, 15.10.2026):** `20261015134735` ב-ledger; `has_role`, `user_roles` ו-`app_role` לא קיימים; `platform_staff` שלם (2 שורות); האתר `beta.kalfa.me` תקין (200 / 307) ובלוגים של חמש האפליקציות אין שגיאות על האובייקטים שנמחקו; ה-types הוחזרו (`npm run gen:types`) ואין בהם עוד אזכור; Security Advisor: פונקציות SECURITY DEFINER הניתנות להרצה על ידי משתמש מחובר ירדו מ-23 ל-22 (`has_role`), בלי ממצאים חדשים.

הקובץ הפועל: [`supabase/migrations/20261015134735_retire_user_roles_stage_2.sql`](../supabase/migrations/20261015134735_retire_user_roles_stage_2.sql). הוא כולל בדיקות קדם שמבטלות את המיגרציה אם משהו עדיין בשימוש, `DROP` **בלי `CASCADE`**, והוכחה בסוף באותה טרנזקציה.

## הרקע
שלב 1 (`20261015114659`) הוחל במסד החי ב-15.10 והבילד שלו נפרס באותו יום ב-15:59. מאז הדגל הישן `user_roles.admin` לא מכריע על שום דבר. נשארו רק האובייקטים עצמם.

## מה נבדק מול המסד החי (נמדד, 15.10.2026)

| בדיקה | תוצאה |
|---|---|
| מפתחות זרים **אל** `user_roles` | אין |
| מפתח זר **מ**-`user_roles` | `user_id → auth.users ON DELETE CASCADE`. מחיקת הטבלה לא נוגעת ב-`auth.users`; הכיוון ההפוך (מחיקת משתמש) כבר לא רלוונטי |
| טריגרים על הטבלה | אין |
| views / materialized views תלויים | אין |
| policies שמפנות אליה או ל-`has_role` | רק `ur_self_read` על הטבלה עצמה (נמחקת איתה) |
| פונקציות שמפנות אליהן | אין, חוץ מ-`has_role` עצמה |
| תלויות `pg_depend` ב-`has_role` | אין |
| עמודות מסוג `app_role` | רק `user_roles.role` |
| הרשאות | טבלה: `authenticated` SELECT/REFERENCES/TRIGGER, `service_role` מלא. פונקציה: `authenticated`, `service_role`. נמחקות יחד עם האובייקטים |
| קוד, סקריפטים, worker, edge functions, אשף ההעברה, בדיקות, seed | אפס הפניות. רק types מחוללים ומיגרציות היסטוריות (הן מתנגנות לפי הסדר, ולכן עדיין תקינות) |
| bootstrap / שחזור מנהלים | `claim_first_admin` נמחקה בשלב 1. מנהל ראשון נוצר ב-SQL ל-`platform_staff` (`docs/project/02-auth-and-authorization.md` §6.2) |
| נתונים | 3 שורות, כולן `admin`. ל-2 מהן יש גם שורה ב-`platform_staff`; החשבון השלישי מעולם לא התחבר |

## גיבוי ושחזור של 3 השורות
- גיבוי מחוץ למסד ומחוץ ל-git: `ops-evidence/user_roles-backup-20261015.sql` (הספרייה מוחרגת ב-`.git/info/exclude`, הקובץ בהרשאה 600). הוא כולל `INSERT` לשלוש השורות.
- שחזור מלא: סעיף ה-ROLLBACK בראש קובץ ה-SQL (יוצר מחדש את ה-enum, הטבלה, ה-policy, ההרשאות והפונקציה), ואז הרצת קובץ הגיבוי.
- בדיקת הקדם במיגרציה מסרבת להמשיך אם יש בטבלה שורה שאינה `admin`, כי הגיבוי מכסה רק אותן.

## הוכחה על מסד מקומי (בטרנזקציה שנגמרת ב-ROLLBACK)
1. הרצה נקייה: אחרי המחיקות `has_role=0`, `user_roles` לא קיימת, `app_role=0`. אחרי ה-ROLLBACK המצב חזר לקדמותו.
2. `policy` תלויה ב-`has_role` → המיגרציה **נעצרת** ("1 policy(ies) still reference").
3. `view` תלוי ב-`user_roles` → **נעצרת**.
4. שורה שאינה `admin` → **נעצרת**.
אחרי הבדיקות לא נשאר שום אובייקט זמני.

## מה נשאר
- קומיט ודחיפה של ה-types המחוללים ושל עדכוני התיעוד (`docs/project/02-auth-and-authorization.md` §6.1, `03-database-schema.md`).
- גיבוי 3 השורות נשמר ב-`ops-evidence/user_roles-backup-20261015.sql` למקרה של ROLLBACK; אפשר למחוק אותו כשהבעלים מחליט שאין בו עוד צורך.
- השער `types:check` ב-`npm run deploy` משווה את ה-types למסד החי, ולכן ה-deploy הבא דורש שה-types המעודכנים יהיו בעץ (הם כבר בעץ).
