# פרישת `user_roles` — שלב 2 (מחיקת הטבלה, הפונקציה וה-enum)

נכתב 2026-10-15. **זו תוכנית, לא מיגרציה.** הקובץ הזה במכוון לא נמצא ב-`supabase/migrations/`: `supabase db push`
מחיל כל קובץ ממתין, והמיגרציה הזו חייבת לרוץ רק אחרי ש-deploy של הבילד החדש הושלם.

## הקשר

שלב 1 (`supabase/migrations/20261015114659_retire_user_roles_admin_consumers.sql`) העביר את הצרכנים האחרונים של
`has_role('admin')` — שש פונקציות `fleet_*` ושתי policies של הקול — ל-`has_platform_permission`, מחק את
`claim_first_admin`, ושלל מ-`authenticated` את `org_role_rank`. בקוד נמחקו `requireAdmin()`/`isAdmin()` ועמוד
`/app/admin-access`. אחרי זה `has_role` ו-`user_roles` הם קוד מת: אף policy, פונקציה, trigger, view או קריאת RPC
לא פונים אליהם (נמדד ב-15.10.2026, ראו "מפקד צרכנים").

## תנאים מקדימים (כולם, לפי הסדר)

1. מיגרציית שלב 1 הוחלה ב-DB החי, וה-DO block שבה עבר (המיגרציה נכשלת כולה אם משהו לא תקין).
2. הבילד שמכיל את שינויי הקוד (בלי `isAdmin`/`requireAdmin`/`admin-access`) נפרס. אחרת הבילד הישן, שעדיין קורא
   `rpc('has_role')`, יקבל שגיאה ויסתיר את קישור הניהול בתפריט עד ה-deploy.
3. `npm run gen:types` הורץ אחרי שלב 1 (ה-types לא כוללים עוד `claim_first_admin`).
4. מפקד הצרכנים (למטה) נקי — מורץ מחדש מיד לפני המחיקה, לא נסמך על המדידה הזו.
5. בעל המערכת אישר במפורש (מחיקת טבלה היא SQL הרסני; 3 שורות admin נמחקות).

## מפקד צרכנים — חייב להחזיר 0 בכל השורות

```sql
select 'policy' as kind, tablename || '.' || policyname as name
  from pg_policies
 where schemaname = 'public'
   and (coalesce(qual,'') ilike '%has_role(%' or coalesce(with_check,'') ilike '%has_role(%'
        or coalesce(qual,'') ilike '%user_roles%' or coalesce(with_check,'') ilike '%user_roles%')
   and not (tablename = 'user_roles')            -- המדיניות של הטבלה עצמה נמחקת איתה
union all
select 'function', p.proname
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'has_role'
   and (pg_get_functiondef(p.oid) ilike '%has_role(%' or pg_get_functiondef(p.oid) ilike '%user_roles%')
union all
select 'view', schemaname || '.' || viewname
  from pg_views
 where schemaname = 'public' and (definition ilike '%has_role(%' or definition ilike '%user_roles%')
union all
select 'trigger', c.relname || '.' || t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%has_role%'
union all
select 'fk_into_user_roles', conrelid::regclass::text || '.' || conname
  from pg_constraint where confrelid = 'public.user_roles'::regclass
union all
select 'column_of_type_app_role', c.relname || '.' || a.attname
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_type t on t.oid = a.atttypid
 where t.typname = 'app_role' and a.attnum > 0 and not a.attisdropped
   and c.relnamespace = 'public'::regnamespace and c.relname <> 'user_roles'
   and c.relkind <> 'i';                         -- האינדקס של user_roles עצמו אינו צרכן

-- נמדד על ה-DB החי לפני שלב 1 (15.10.2026): 9 שורות — claim_first_admin, שש פונקציות fleet_*, ושתי ה-policies של הקול;
-- בדיוק מה ששלב 1 מטפל בו. אחרי שלב 1 חייב להחזיר 0 שורות (נבדק על ה-DB המקומי אחרי החלת המיגרציה).
```

ובקוד: `grep -rnE "has_role|'user_roles'|\"user_roles\"" src scripts supabase/functions --include=*.ts --include=*.tsx`
חייב להחזיר רק הערות והטיפוסים המחוללים.

## המיגרציה (לייצר בפקודה `supabase migration new retire_user_roles_stage_2`, ואז למלא)

```sql
-- גיבוי לפני מחיקה (נשמר ב-rollback למטה): select * from public.user_roles;
drop function public.has_role(uuid, public.app_role);
drop table public.user_roles;     -- מוחק איתו את ur_self_read ואת user_roles_user_id_role_key
drop type public.app_role;
```

## Rollback

```sql
create type public.app_role as enum ('admin', 'user');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  constraint user_roles_user_id_role_key unique (user_id, role)
);
alter table public.user_roles enable row level security;
create policy ur_self_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));
create or replace function public.has_role(_user_id uuid, _role public.app_role)
  returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;
-- ואז לשחזר את 3 שורות ה-admin מהגיבוי.
```

(הגדרת `has_role` ו-`ur_self_read` לפי ה-DB החי ב-15.10.2026; לוודא מול `pg_get_functiondef` לפני שימוש ב-rollback.)

## אחרי המחיקה

`npm run gen:types`, הרצת Security Advisor, ועדכון `docs/project/02-auth-and-authorization.md` §6.1 ו-`03-database-schema.md`
(`user_roles`) מ"יצא משימוש" ל"נמחק".
