# חקירת הפיצול בין `orders` ל-`campaigns`

תאריך חקירה: 2026-07-09  
סוג עבודה: חקירה ותיעוד בלבד  
הנחיית משתמש: לבחון את `orders` ו-`campaign`, להתחקות אחריהם מהיום שנוצרו, לחקור את התיעוד שנשמר ב-Supabase, לקרוא את הטבלאות ואת הקוד בפועל, ולא לבצע שינויי קוד או DB.

## תקציר מסקנה

הפיצול נוצר כשהמערכת עברה ממודל של "רכישת חבילה / הזמנה" למודל של "אישור קמפיין לאירוע" עם חיוב לפי תוצאה.

- `orders` נולד כמודל תשלום רגיל: הזמנת מסלול, סכום קבוע, תשלום SUMIT מיידי, וסטטוסים כמו `pending`, `paid`, `failed`, `processing`, `payment_review`.
- `campaigns` נולד כמודל תפעולי של קמפיין RSVP, אבל ב-`202606240007_outcome_billing_schema.sql` הורחב להיות גם מודל מסחרי: אישור תנאים, מחיר לפי איש קשר שהושג, תקרה, מסגרת אשראי J5, capture/charge, וחשבונאות סופית.
- לכן הכפילות אינה התחלה של שני שמות לאותו דבר. במקור אלה היו שני רעיונות שונים. הכפילות נוצרה כאשר מודל החיוב החדש של קמפיינים הוטמע ישירות בתוך `campaigns` במקום להחליף או לאחד את `orders`.

## גבולות החקירה

בוצעו פעולות קריאה בלבד:

- קריאת קבצי תיעוד ותכנון.
- קריאת migrations.
- קריאת קוד TypeScript/Route Handlers.
- קריאת סכמת Supabase live דרך כלי Supabase MCP.
- קריאת Git history.
- לא בוצע `apply_migration`.
- לא בוצעו שאילתות DDL.
- לא שונו טבלאות או נתונים.

הקובץ הזה הוא השינוי היחיד שנוצר בעקבות בקשת התיעוד.

## מצב סביבת העבודה לפני שמירת המסמך

לפני יצירת המסמך הזה `git status --short` הראה worktree dirty שאינו קשור לחקירה:

```text
 M src/app/(customer)/app/team/page.tsx
?? .tmp/
?? docs/event-edit-permission-fix-plan-2026-07-08.md
?? plans/org-aware-access-axis-b-audit.md
```

## מתודולוגיית החקירה

### 1. אתחול הקשר Next.js

בהתאם ל-`AGENTS.md`, נבדק שרת Next.js:

```text
Found 1 Next.js server with MCP enabled
port: 3000
url: http://localhost:3000
toolCount: 0
```

לא נעשה שימוש בכלי runtime נוספים כי לא היו tools זמינים בשרת.

### 2. טעינת הנחיית Supabase

נקראה ההנחיה:

```text
/var/www/vhosts/kalfa.me/beta/.agents/skills/supabase/SKILL.md
```

העקרונות הרלוונטיים לחקירה:

- Supabase משתנה תדיר, אך כאן לא בוצעו שינויי DB.
- לשינויים בסכמה יש להשתמש בכלי מתאימים, אך החקירה השתמשה רק ב-read-only queries.
- יש להיזהר מ-`SECURITY DEFINER`, RLS וחשיפת service role. לא נכתבו policies או functions חדשים.

### 3. איתור פרויקט Supabase

נקרא:

```text
supabase/.temp/project-ref
```

מזהה הפרויקט:

```text
cklpaxihpyjbhymqtduv
```

### 4. מיפוי קבצים ראשוני

בוצע חיפוש קבצים רלוונטיים:

```bash
rg --files -g 'package.json' -g 'next.config.*' -g 'supabase/**' -g '*.md' -g '*.sql' -g '*.ts' -g '*.tsx'
```

מקורות מרכזיים שנמצאו:

- `README.md`
- `docs/schema-and-architecture.md`
- `plans/plan-paid.md`
- `plans/billing-controls-complete-plan.md`
- `plans/payment-events-implementation-plan.md`
- `plans/campaign-creation-flows.md`
- `supabase/migrations/*.sql`
- `src/lib/data/orders.ts`
- `src/lib/data/campaigns.ts`
- `src/lib/data/billing.ts`
- `src/lib/data/close-charge.ts`
- `src/app/api/orders/[id]/pay/route.ts`
- `src/app/api/campaigns/[id]/authorize/route.ts`
- `src/app/api/campaigns/[id]/close-charge/route.ts`

### 5. חיפוש גלובלי

בוצע חיפוש:

```bash
rg -n "\b(order|orders|campaign|campaigns)\b" docs plans supabase src worker README.md CLAUDE.md AGENTS.md nevo.md read.md -S
```

ממצאים ראשוניים מהחיפוש:

- `README.md` מתאר שה-DB כבר כולל גם `campaigns` וגם `orders`.
- `docs/schema-and-architecture.md` מתאר את `orders` כ"הזמנת מסלול ותשלום SUMIT".
- אותו מסמך מתאר את `campaigns` כ"קמפיין אישורי הגעה" עם שדות SUMIT מלאים.
- `docs/unnecessary-manual-code-audit-2026-07-02.md` מציין ש-`campaigns/[id]/authorize/route.ts` משכפל במפורש דפוס מה-handler של `orders/[id]/pay`.
- `plans/form-table-wiring-map.md` ממפה:
  - `orders/[id]/pay/payment-form` אל `orders`.
  - `campaign/[id]/payment/hold-form` אל `campaigns`.

## ממצאי Supabase live

### רשימת migrations ב-DB

נקראה דרך Supabase MCP:

```text
mcp__codex_apps__supabase._list_migrations(project_id="cklpaxihpyjbhymqtduv")
```

רצף migrations רלוונטי:

```text
202606240002 order_payment_statuses
202606240003 order_payment_flow
202606240004 orders_user_id_index
202606240007 outcome_billing_schema
202606240009 campaign_templates
202606240014 outreach_schedule
202606260020 campaign_holds_flag
202606290024 billing_authorized_set
202606290025 campaign_auth_external_ref
202606290026 campaign_card_expiry
202606290027 charge_findings
202606290028 billing_backhalf
202606290029 billing_set_membership
202606300038 lock_billing_rpcs
```

משמעות:

- `orders` קיבל שכבת תשלום ב-24 ביוני 2026.
- `campaigns` קיבל שכבת outcome-billing באותו יום, דרך migration נפרד.
- החלקים העמוקים של חיוב קמפיין, authorized set, capture ו-charge הגיעו בעיקר ב-26-29 ביוני 2026.

### סכמת `orders` לפי DB live

שאילתת הסכמה שנבדקה:

```sql
select c.relname as table_name,
       a.attnum,
       a.attname as column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null,
       pg_get_expr(ad.adbin, ad.adrelid) as default_expr,
       col_description(a.attrelid, a.attnum) as comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relname in ('orders','campaigns')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum;
```

עמודות `orders` ב-live DB:

```text
id uuid default gen_random_uuid()
user_id uuid not null
event_id uuid nullable
package_id uuid nullable
with_ai_addon boolean default false
total_with_vat numeric(10,2) not null
vat_rate numeric(4,2) default 18.00
status order_status default 'demo'
terms_accepted boolean default false
privacy_accepted boolean default false
authorization_accepted boolean default false
created_at timestamptz default now()
sumit_document_id integer
paid_at timestamptz
payment_attempt_ref uuid default gen_random_uuid()
payment_processing_started_at timestamptz
```

קריאה:

- זה מודל תשלום קלאסי.
- הסכום שמור על ההזמנה: `total_with_vat`.
- יש מסמך SUMIT יחיד: `sumit_document_id`.
- יש attempt id לתשלום: `payment_attempt_ref`.
- אין ב-`orders` מושגים של `reached`, `authorized contacts`, `campaign window`, `price_per_reached`, או `final_charge_amount`.

### סכמת `campaigns` לפי DB live

עמודות מרכזיות ב-`campaigns`:

```text
id uuid
event_id uuid not null
steps jsonb default []
close_at timestamptz
enabled boolean default false
created_at timestamptz
updated_at timestamptz
status campaign_status default 'draft'
price_per_reached numeric
max_contacts integer not null
max_charge_ceiling numeric
allowed_channels campaign_channel[] default {whatsapp,call}
start_at timestamptz
tos_version text
approved_by uuid
approved_at timestamptz
billing_route billing_route
final_charge_amount numeric
final_invoice_document_id integer
auth_amount numeric
auth_number text
authorized_at timestamptz
auth_expires_at timestamptz
capture_status text
release_status text
sumit_order_document_id integer
card_token_ref text
template_id uuid
outreach_schedule jsonb
auth_external_ref text
card_exp_month smallint
card_exp_year smallint
card_citizen_id text
charge_status text
charged_at timestamptz
sumit_charge_document_id integer
charge_document_number integer
charge_document_url text
charge_auth_number text
charge_payment_id integer
```

קריאה:

- `campaigns` מחזיק היום גם את מחזור החיים התפעולי וגם את מחזור החיים הפיננסי.
- יש בו גם אישור מסחרי (`tos_version`, `approved_by`, `approved_at`), גם מסגרת אשראי (`auth_*`, `capture_status`), וגם חיוב סופי (`charge_*`, `final_charge_amount`).
- זה מראה שהמודל החדש לא נשען על `orders`.

### ספירות נתונים ב-live DB

שאילתה:

```sql
with table_counts as (
  select 'orders'::text as table_name,
         count(*)::int as rows,
         min(created_at) as first_created,
         max(created_at) as last_created
  from public.orders
  union all
  select 'campaigns'::text as table_name,
         count(*)::int as rows,
         min(created_at) as first_created,
         max(created_at) as last_created
  from public.campaigns
), status_counts as (
  select 'orders'::text as table_name, status::text, count(*)::int as rows
  from public.orders
  group by status
  union all
  select 'campaigns'::text as table_name, status::text, count(*)::int as rows
  from public.campaigns
  group by status
)
select jsonb_build_object(
  'table_counts', (
    select jsonb_agg(to_jsonb(table_counts) order by table_name)
    from table_counts
  ),
  'status_counts', (
    select coalesce(jsonb_agg(to_jsonb(status_counts) order by table_name, status), '[]'::jsonb)
    from status_counts
  )
) as investigation_counts;
```

תוצאה:

```json
{
  "table_counts": [
    {
      "rows": 2,
      "table_name": "campaigns",
      "last_created": "2026-07-07T07:17:07.867011+00:00",
      "first_created": "2026-06-28T22:13:45.745593+00:00"
    },
    {
      "rows": 0,
      "table_name": "orders",
      "last_created": null,
      "first_created": null
    }
  ],
  "status_counts": [
    {
      "rows": 1,
      "status": "active",
      "table_name": "campaigns"
    },
    {
      "rows": 1,
      "status": "approved",
      "table_name": "campaigns"
    }
  ]
}
```

קריאה:

- ב-DB החי `orders` קיימת אך ריקה.
- `campaigns` היא הטבלה שבה הזרימה הפעילה חיה בפועל.
- שני הקמפיינים שנבדקו נשאו `capture_status='authorized'`, כלומר הם כבר עברו דרך מסלול hold של קמפיינים.

### דוגמאות שורות `campaigns`

שאילתה:

```sql
select id,
       status::text,
       event_id,
       price_per_reached,
       max_contacts,
       max_charge_ceiling,
       capture_status,
       charge_status,
       created_at
from public.campaigns
order by created_at desc
limit 5;
```

תוצאה:

```text
id=15a8730e-df46-43f6-a29f-13a1ea3a0038
status=active
event_id=294d23e1-6be9-4b4f-ad79-4d10f4a6e31b
price_per_reached=4
max_contacts=38
max_charge_ceiling=152
capture_status=authorized
charge_status=null
created_at=2026-07-07 07:17:07.867011+00

id=bac77347-a2f4-4a6e-a825-933fcbd3d0c7
status=approved
event_id=ec7c68d1-2494-4887-a644-7648dcd74b9a
price_per_reached=4
max_contacts=1
max_charge_ceiling=4
capture_status=authorized
charge_status=null
created_at=2026-06-28 22:13:45.745593+00
```

קריאה:

- ה-live data מוכיח שה-flow הנוכחי אינו יוצר `orders`.
- ה-flow הנוכחי משתמש ב-`campaigns` כמודל מסחרי חי.

### Constraints רלוונטיים

שאילתה:

```sql
select conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.orders'::regclass,
  'public.campaigns'::regclass,
  'public.billed_results'::regclass,
  'public.campaign_authorized_contacts'::regclass
)
order by table_name, conname;
```

תוצאות מרכזיות:

```text
orders_event_id_fkey:
FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL

orders_package_id_fkey:
FOREIGN KEY (package_id) REFERENCES packages(id)

campaigns_event_id_fkey:
FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE

campaigns_template_id_fkey:
FOREIGN KEY (template_id) REFERENCES packages(id)

billed_results_campaign_id_fkey:
FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE

billed_results_event_contact_unique:
UNIQUE (event_id, contact_id)

campaign_authorized_contacts_campaign_contact_unique:
UNIQUE (campaign_id, contact_id)
```

קריאה:

- `orders.event_id ON DELETE SET NULL`: ההזמנה יכולה להישאר רשומת תשלום עצמאית גם אם האירוע נמחק.
- `campaigns.event_id ON DELETE CASCADE`: קמפיין הוא child תפעולי של אירוע.
- `billed_results` ו-`campaign_authorized_contacts` מחוברים ל-`campaigns`, לא ל-`orders`.
- מודל ה-outcome billing נבנה סביב קמפיין ולא סביב הזמנה.

## ממצאי migrations

### `202606240002_order_payment_statuses.sql`

תוכן:

```sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'payment_review';
```

ממצא:

- `orders` קיבל סטטוסים שמתאימים לתשלום מיידי עם ניסיון סליקה ותוצאה לא ודאית.

### `202606240003_order_payment_flow.sql`

תוכן מרכזי:

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sumit_document_id integer,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_attempt_ref uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS payment_processing_started_at timestamptz;
```

הערות בתוך migration:

```text
payment_attempt_ref: unique per attempt, rotated on retry.
Sent to SUMIT as Customer.ExternalIdentifier.
payment_processing_started_at: set at lock time, used to detect stuck
'processing' orders.
```

ממצא:

- זהו מודל payment attempt רגיל על order.
- התשלום מתבצע על סכום קבוע ששמור ב-`orders.total_with_vat`.
- אין קשר ל-contact reached או campaign lifecycle.

### `202606240004_orders_user_id_index.sql`

תוכן מרכזי:

```sql
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders (user_id);
```

הערה:

```text
orders_owner_select (USING user_id = auth.uid()) and listOrders()/getOrder()
all filter by user_id.
```

ממצא:

- מודל `orders` scoped לפי user, לא לפי campaign.
- הוא משרת רשימת הזמנות של משתמש.

### `202606240007_outcome_billing_schema.sql`

כותרת migration:

```text
Outcome-based billing schema (campaign approval + reached-contact).
Spec: plans/plan-paid.md
```

קטע מרכזי:

```sql
alter table public.campaigns
  add column if not exists status campaign_status not null default 'draft',
  add column if not exists price_per_reached numeric,
  add column if not exists max_contacts integer,
  add column if not exists max_charge_ceiling numeric,
  add column if not exists allowed_channels campaign_channel[] not null default '{whatsapp,call}',
  add column if not exists start_at timestamptz,
  add column if not exists tos_version text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists billing_route billing_route,
  add column if not exists final_charge_amount numeric,
  add column if not exists final_invoice_document_id integer,
  add column if not exists auth_amount numeric,
  add column if not exists auth_number text,
  add column if not exists authorized_at timestamptz,
  add column if not exists auth_expires_at timestamptz,
  add column if not exists capture_status text,
  add column if not exists release_status text,
  add column if not exists sumit_order_document_id integer,
  add column if not exists card_token_ref text;
```

הערת RLS:

```text
campaigns RLS: owner read-only (writes via server/admin, like orders).
```

ממצא:

- זו נקודת הפיצול הסכימתית המשמעותית.
- כאן `campaigns` מפסיק להיות רק קמפיין תפעולי ומקבל אחריות מסחרית.
- ההערה "like orders" מלמדת שהכותב ראה דמיון בדפוס הכתיבה: owner read-only, writes via server/admin.
- למרות הדמיון בדפוס הרשאות, המודל העסקי שונה: outcome billing לפי reached contact.

### `202606240009_campaign_templates.sql`

כותרת/הערה:

```text
Commercial templates carry the recommended price-per-reached.
The owner SELECTS a template and APPROVES the price.
The price is read server-side and copied+locked onto the campaign at creation.
```

ממצא:

- `packages` הפכה גם לטבלת templates מסחריים לקמפיין.
- המחיר אינו נשאר רק ב-package/order. הוא מועתק וננעל על `campaigns.price_per_reached`.
- זה מחזק את המעבר ממודל order למודל campaign approval.

### `202606240014_outreach_schedule.sql`

הערה:

```text
Conversion-focused outreach policy: an EVENT-DATE-ANCHORED touchpoint schedule.
Defined on the template, copied+locked onto the campaign at approval.
```

ממצא:

- קמפיין קיבל גם snapshot של policy תפעולי.
- ההיגיון הוא "אישור קמפיין" ולא "רכישת חבילה".

### `202606260020_campaign_holds_flag.sql`

הערה:

```text
Route A (J5 card hold): an independent kill-switch for the campaign
authorization-hold path, separate from the orders `payments_enabled` switch.
```

ממצא:

- יש הפרדה מכוונת בין תשלום orders לבין hold של campaigns.
- `campaign_holds_enabled` נפרד מ-`payments_enabled`.
- זה לא reuse מלא של `orders`, אלא מסלול תשלום חדש לקמפיינים.

### `202606290024_billing_authorized_set.sql`

הערה מרכזית:

```text
Fix: at the credit-frame hold (J5) step, FREEZE the set of authorized contacts.
Every outreach path AND the billing path are bound to that set.
Single authorization + single charge per event: the hold is SECURITY only;
the final amount is settled at campaign close from the contacts actually reached.
```

ממצא:

- מודל החיוב של קמפיין תלוי בסט אנשי קשר מורשה.
- זה לא יכול לשבת טבעית על `orders`, כי order אינו יודע מי הם אנשי הקשר שהורשו לפנייה.

### `202606290025_campaign_auth_external_ref.sql`

הערה:

```text
Fix the J5 hold -> capture flow: persist the SUMIT Customer.ExternalIdentifier.
```

ממצא:

- החיוב של campaign נשען על J5 hold ולא על תשלום מיידי כמו `orders`.
- נשמר `auth_external_ref` ב-`campaigns`, לא ב-`orders`.

### `202606290026_campaign_card_expiry.sql`

הערה:

```text
SUMIT charges a saved CreditCard_Token only when the request ALSO carries
the card's CreditCard_ExpirationMonth/Year.
```

ממצא:

- `campaigns` מחזיק פרטי token/expiry/citizen id הדרושים ל-capture מאוחר.
- `orders` לא צריך את זה כי הוא מבצע charge מיידי.

### `202606290027_charge_findings.sql`

הערה:

```text
Apply the empirically-validated SUMIT capture findings + complete the
charge-side persistence.
```

עמודות שנוספו ל-`campaigns`:

```sql
card_citizen_id
charge_status
charged_at
sumit_charge_document_id
charge_document_number
charge_document_url
charge_auth_number
charge_payment_id
```

ממצא:

- `campaigns` הפך למקור האמת גם לתוצאת החיוב הסופי.
- כאן הכפילות מול `orders.sumit_document_id` נעשית בולטת, אבל הסיבה שונה: charge מאוחר אחרי סגירת קמפיין.

### `202606290028_billing_backhalf.sql`

הערה:

```text
The two billing RPCs the data layer already CALLS but that exist in NO
migration on any ref:
- try_record_billed_result
- campaign_billing_summary
```

ממצא:

- החצי האחורי של חיוב קמפיין נבנה סביב RPCs שמקבלים `campaign_id`.
- `campaign_billing_summary` מסכם `billed_results` לפי קמפיין.
- אין שימוש ב-`orders`.

### `202606290029_billing_set_membership.sql`

הערה:

```text
Phase 2: bind billing to the frozen authorized SET.
contact not in snapshot NEVER bills.
```

ממצא:

- החיוב קשור ל-membership ב-`campaign_authorized_contacts`.
- שוב, זה מודל שאינו מתאים ל-`orders`.

## ממצאי תיעוד

### `README.md`

קטע רלוונטי:

```text
The database already contains the full domain — events, guests,
guest_groups, event_questions, rsvp_responses, campaigns, orders,
packages, profiles, user_roles, ...
```

קריאה:

- כבר במסמך הראשי שני המודלים מופיעים זה לצד זה.
- אין הכרעה שם על איחוד.

### `docs/schema-and-architecture.md`

המסמך מצהיר:

```text
מקור האמת: מסד הנתונים הפרודקשני ... וקוד המקור ב-src/ ו-worker/.
אין הסתמכות על קבצי מיגרציה או תיעוד.
```

הגדרת `orders`:

```text
orders — הזמנת מסלול ותשלום SUMIT.
```

הגדרת `campaigns`:

```text
campaigns — קמפיין אישורי הגעה. כולל steps, enabled, status,
max_contacts, max_charge_ceiling, price_per_reached, allowed_channels,
template_id, outreach_schedule, billing_route, ושדות SUMIT מלאים...
```

ארכיטקטורת חיוב:

```text
כל כתיבת חיוב עוברת דרך נקודת כניסה יחידה — recordReached()
שקוראת ל-RPC try_record_billed_result.
```

ממצא:

- התיעוד העדכני מכיר בכך ששני המודלים קיימים.
- `orders` מוגדר כ-payment/order.
- `campaigns` מוגדר כ-RSVP campaign + billing.
- מקור האמת לחיוב outcome הוא `campaigns` + `billed_results`, לא `orders`.

### `plans/plan-paid.md`

קטע מרכזי:

```text
במערכת אין "הרשאת חבילה" במובן של מנוי חודשי או קרדיטים שנרכשו מראש.
המודל הנכון הוא "אישור קמפיין לאירוע".
```

וגם:

```text
אישור קמפיין כולל:
- האירוע שאליו הוא שייך.
- בעל האירוע המאשר.
- המחיר המוסכם לכל איש קשר שהושג.
- מספר אנשי הקשר הייחודיים המורשים לפניה.
- תקרת חיוב מרבית.
- ערוצי הפניה המותרים.
- מועד התחלה ומועד סגירה.
- גרסת תנאי השירות שאושרה.
- סטטוס הקמפיין.
```

ממצא:

- זהו מסמך הסיבה העסקית לפיצול.
- הוא קובע במפורש שהמודל הנכון אינו order/package entitlement אלא campaign approval.
- לכן הוספת שדות billing ל-`campaigns` היתה ניסיון לממש את המודל הזה.

### `plans/billing-controls-complete-plan.md`

קטע מרכזי:

```text
Outcome billing: סכום = אנשי קשר ייחודיים שהושגו × price_per_reached.
חד-פעמי פר אירוע: hold אחד באישור -> capture יחיד בסגירה.
תפיסת מסגרת = ביטחון בלבד.
גמר חשבון: charge = min(Σ reached × price, ceiling) בסגירת הקמפיין.
```

ממצא:

- החיוב החדש מתואר כחד-פעמי פר אירוע, אבל לא כתשלום upfront.
- ה-hold הוא ביטחון בלבד; final charge נקבע בסגירת הקמפיין.
- זה מסביר מדוע `orders` לא שימש ישירות: order קלאסי מייצג תשלום/רכישה, לא hold+settlement.

### `plans/payment-events-implementation-plan.md`

קטע חשוב:

```text
ל-orders/campaigns כבר יש היום דפוס קיים של שמירת שדות SUMIT
כעמודות ישירות על השורה עצמה ...
payment_events הוא דפוס נוסף ומכוון, לא תחליף.
```

ממצא:

- כבר בתיעוד מאוחר יותר זוהתה כפילות דפוס: גם `orders` וגם `campaigns` שומרים שדות SUMIT על השורה.
- ההבחנה: העמודות הקיימות הן state נוכחי, `payment_events` אמור להיות audit append-only.
- המסמך לא מאחד `orders` ו-`campaigns`; הוא רק מזהה את דפוס שמירת payment state.

### `plans/campaign-creation-flows.md`

קטע מרכזי:

```text
קמפיין אחד לאירוע.
template קנוני אחד.
מחזור-החיים: pending_approval -> חתימת-הסכם -> approved -> תפיסת-מסגרת J5 -> active -> סגירה -> גמר-חשבון.
החיוב זהה: ללא נגיעה.
```

ממצא:

- בשלב מאוחר יותר המערכת מכוונת ל"קמפיין אחד לאירוע".
- ההחלטה היא UX/flow סביב קמפיין, לא סביב order.
- זה מעגן את הבחירה ש-campaign הוא הישות העסקית החדשה.

## ממצאי קוד

### `src/lib/data/orders.ts`

תפקיד הקובץ:

- `listOrders()` מחזיר הזמנות של המשתמש הנוכחי.
- `getOrder(orderId)` קורא הזמנה אחת עם RLS ו-`user_id`.

DTO רלוונטי:

```ts
export type OrderDetail = Pick<
  OrderRow,
  | 'id' | 'status' | 'total_with_vat' | 'vat_rate' | 'with_ai_addon'
  | 'event_id' | 'package_id' | 'sumit_document_id' | 'paid_at'
  | 'payment_attempt_ref' | 'created_at'
>;
```

ממצא:

- הקוד רואה `orders` כ-read model להזמנות ותשלומים.
- אין בו לוגיקת campaign lifecycle.
- אין בו counted contacts, authorized set, reached, close-charge.

### `src/app/api/orders/[id]/pay/route.ts`

תפקיד:

- מקבל `og-token`.
- טוען order.
- בודק סטטוס `pending` או `failed`.
- נועל ל-`processing`.
- קורא `chargeSumit`.
- מעדכן `orders.status='paid'`, `paid_at`, `sumit_document_id`.

קטעים מרכזיים:

```ts
.from('orders')
.update({
  status: 'processing',
  payment_attempt_ref: crypto.randomUUID(),
  payment_processing_started_at: new Date().toISOString(),
})
```

ואחרי הצלחה:

```ts
.update({
  status: 'paid',
  paid_at: new Date().toISOString(),
  sumit_document_id: documentId
})
```

ממצא:

- זו זרימת charge מיידית.
- הסכום נלקח מ-`orders.total_with_vat`.
- אין hold ואין settlement מאוחר.

### `src/lib/data/campaigns.ts`

הערת ראש הקובץ:

```ts
// Campaign = "campaign approval for an event" (outcome-billing).
// Owner sets the commercial terms; the charge ceiling is computed server-side.
// Reads are owner-scoped via RLS (owns_event); writes go through the service-role admin
// client after an explicit ownership check.
```

תפקידים מרכזיים:

- `createCampaign(eventId)`
- `approveCampaign(campaignId, tosVersion)`
- `lockCampaignForHold(campaignId)`
- `recordCampaignHold(...)`
- `prepareCampaignHold(campaignId)`
- `getCampaignForCharge(campaignId)`
- `lockCampaignForCharge(campaignId)`
- `recordCampaignCharge(...)`
- `activateCampaign`, `pauseCampaign`, `closeCampaign`, `cancelCampaign`

ממצא:

- הקוד מגדיר במפורש את `Campaign` כ-"campaign approval for an event".
- זה אינו order.
- עם זאת, הוא כולל הרבה אחריות payment state שפעם היתה נראית שייכת ל-order.

### `createCampaign(eventId)`

ממצאים:

- מחייב אירוע `active`.
- מחייב event date, venue, celebrants.
- בודק מספר unique contacts.
- פותר template קנוני מ-`packages`.
- יוצר `campaigns` עם:
  - `status='pending_approval'`
  - `template_id`
  - `price_per_reached`
  - `max_contacts`
  - `max_charge_ceiling`
  - `allowed_channels`
  - `close_at=event.event_date`
  - `outreach_schedule`

קריאה:

- הקמפיין הוא snapshot של תנאים מסחריים ותפעוליים לאירוע.
- אין יצירת `orders`.

### `prepareCampaignHold(campaignId)`

הערה בקוד:

```ts
// Phase-2 hold preparation. Run at the J5 step AFTER the hold slot is locked and
// BEFORE the card hold is placed.
// FREEZES the authorized SET to the COVERED contacts.
// recomputes max_contacts and max_charge_ceiling.
```

ממצא:

- לפני hold, הקוד מקפיא סט אנשי קשר מורשה.
- זה מאפיין ייחודי לקמפיין outcome-billing.
- `orders` לא מכיל שום מקבילה לזה.

### `src/app/api/campaigns/[id]/authorize/route.ts`

הערת ראש הקובץ:

```ts
// Route A J5 hold: place a SUMIT authorization hold (AutoCapture:false) up to the
// campaign ceiling after the agreement is signed. Mirrors the proven
// orders/[id]/pay handler: fail-closed gate, atomic lock (idempotency), and only
// a verified success persists the hold. The actual charge happens later at
// campaign close (B4) — this only reserves the frame.
```

ממצא:

- הקוד עצמו אומר ש-handler זה "mirrors" את `orders/[id]/pay`.
- זו נקודת שכפול טכנית מודעת: לקחו pattern תשלום מוכח מ-orders והתאימו אותו ל-hold של campaign.
- ההבדל המהותי: `orders` מבצע charge, `campaigns` מבצע hold בלבד.

### `src/lib/data/billing.ts`

הערת ראש:

```ts
// All billing writes go through the try_record_billed_result RPC — the cap +
// window + one-per-(event,contact) dedup live in that locked txn, never in JS.
```

פונקציה מרכזית:

```ts
recordReached(args)
```

היא קוראת:

```ts
admin.rpc('try_record_billed_result', {
  p_event,
  p_campaign,
  p_contact,
  p_channel,
  p_attempt,
  p_evidence,
  p_provider_ref,
})
```

ממצא:

- billing לפי תוצאה נעשה לפי `campaign_id`.
- אין `order_id`.
- מקור האמת לחיוב הוא `billed_results`, שמחובר ל-`campaigns`.

### `src/lib/data/close-charge.ts`

הערה:

```ts
// Close a campaign and charge the held card for the accrued reached-contact total.
// Fail-closed; server-derives amount = min(Σ locked_price, ceiling); charges at
// most once.
```

לוגיקת סכום:

```ts
const accrued = summary?.accrued ?? 0;
const ceiling = campaign.max_charge_ceiling
  ? campaign.max_charge_ceiling
  : (summary?.ceiling ?? 0);
const capped = Math.min(accrued, ceiling);
const amount = Math.max(0, Math.round((capped - credits) * 100) / 100);
```

ממצא:

- החיוב הסופי של הקמפיין מחושב בעת סגירה.
- זה שונה לחלוטין מ-order charge מיידי.

### `src/app/api/campaigns/[id]/close-charge/route.ts`

תפקיד:

- בודק CSRF/auth/ownership.
- בודק feature flags.
- קורא `closeCampaignAndCharge(campaignId)`.

ממצא:

- גם route החיוב הסופי מקבל `campaignId`, לא `orderId`.
- ה-flow החדש עקף לגמרי את `orders`.

## ממצאי Git history

### לוג כללי רלוונטי

פקודה:

```bash
git log --oneline --decorate --all -- supabase/migrations src/lib/data/orders.ts src/lib/data/campaigns.ts src/app/api/orders/[id]/pay/route.ts src/app/api/campaigns/[id]/authorize/route.ts src/app/api/campaigns/[id]/close-charge/route.ts
```

commits מרכזיים:

```text
258b5ba 2026-06-26 13:56 +0300 checkpoint: working-tree snapshot before billing back-half implementation
6981f24 2026-06-26 16:01 +0300 feat(billing): campaign hold data layer (atomic lock + record/fail)
8bb9231 2026-06-26 16:28 +0300 feat(billing): J5 authorize Route Handler (gated, atomic, idempotent)
1b6ff16 2026-06-26 18:47 +0300 feat(billing): close-charge data layer (atomic charge guard + record/outcome) (B4)
8386212 2026-06-26 feat(billing): gated campaign close-charge trigger route (B4)
155eb15 2026-06-29 08:35 +0300 feat(billing): SUMIT charge findings + Phase 0 correctness + completion plan
33948ea 2026-06-29 09:09 +0300 feat(billing): Phase 1 back-half — RPCs + flags live, casts dropped, D4 removal
d648148 2026-06-29 09:52 +0300 feat(billing): Phase 2 frozen-set — reached ⊆ authorized set by construction
80ea4bf 2026-06-29 22:42 +0300 feat(campaign): one-campaign-per-event via 'הפעלת אישורי הגעה' entry
```

### `src/lib/data/orders.ts`

פקודה:

```bash
git log --follow --format='%h %ai %s' -- src/lib/data/orders.ts
```

תוצאה:

```text
6ab8c9d 2026-07-02 22:21:36 +0300 feat: audit fix sweep, packages operational fields, outreach failure sink + broad test coverage
258b5ba 2026-06-26 13:56:07 +0300 checkpoint: working-tree snapshot before billing back-half implementation
```

ממצא:

- `orders.ts` נכנס בפרויקט ב-checkpoint של 26 ביוני.
- אחרי זה היו מעט שינויים יחסית.
- הוא לא עבר את אותה התרחבות כמו `campaigns.ts`.

### `src/lib/data/campaigns.ts`

פקודה:

```bash
git log --follow --format='%h %ai %s' -- src/lib/data/campaigns.ts
```

תוצאות מרכזיות:

```text
258b5ba 2026-06-26 13:56 +0300 checkpoint
6981f24 2026-06-26 16:01 +0300 campaign hold data layer
864ba36 2026-06-26 16:28 +0300 render J5 card-hold form
a448618 2026-06-26 16:58 +0300 campaign lifecycle transitions
1b6ff16 2026-06-26 18:47 +0300 close-charge data layer
155eb15 2026-06-29 08:35 +0300 SUMIT charge findings
33948ea 2026-06-29 09:09 +0300 billing back-half RPCs
d648148 2026-06-29 09:52 +0300 frozen-set
80ea4bf 2026-06-29 22:42 +0300 one-campaign-per-event
```

ממצא:

- `campaigns.ts` עבר סדרת הרחבות משמעותיות סביב billing.
- התרחבות זו לא קרתה ב-`orders.ts`.
- זה מראה שהמודל החדש התפתח סביב `campaigns`.

### commit `258b5ba`

פקודה:

```bash
git show --stat --oneline 258b5ba -- src/lib/data/orders.ts src/lib/data/campaigns.ts supabase/migrations/202606240003_order_payment_flow.sql supabase/migrations/202606240007_outcome_billing_schema.sql supabase/migrations/202606240009_campaign_templates.sql
```

תוצאה:

```text
258b5ba checkpoint: working-tree snapshot before billing back-half implementation
src/lib/data/campaigns.ts                           217 insertions
src/lib/data/orders.ts                               99 insertions
supabase/migrations/202606240003_order_payment_flow.sql 26 insertions
supabase/migrations/202606240007_outcome_billing_schema.sql 201 insertions
supabase/migrations/202606240009_campaign_templates.sql 22 insertions
```

פקודה:

```bash
git show --format=fuller --name-status 258b5ba -- ...
```

תוצאה:

```text
AuthorDate: Fri Jun 26 13:56:07 2026 +0300
CommitDate: Fri Jun 26 13:56:07 2026 +0300

A src/lib/data/campaigns.ts
A src/lib/data/orders.ts
A supabase/migrations/202606240003_order_payment_flow.sql
A supabase/migrations/202606240007_outcome_billing_schema.sql
A supabase/migrations/202606240009_campaign_templates.sql
```

ממצא:

- ב-Git שני המודלים הופיעו יחד ב-checkpoint של 26 ביוני.
- אבל לפי שמות migrations, ההפרדה הסכימתית עצמה תוכננה/נכתבה ב-24 ביוני.
- `orders` ו-`campaigns` כבר נכנסו כישויות נפרדות.

## ציר זמן משולב

### לפני 24 ביוני 2026

המערכת כבר כללה domain בסיסי: events, guests, campaigns, orders, packages וכו'. שני migrations הראשונים הרלוונטיים (`20260621214435`, `20260622000810`) היו ריקים או כמעט ריקים בתוכן המקומי שנבדק, ולכן לא ניתן להסיק מהם על יצירת הטבלאות המקורית.

### 24 ביוני 2026

נוצרו שני מסלולים במקביל:

1. `orders` מקבל payment flow:
   - `order_payment_statuses`
   - `order_payment_flow`
   - `orders_user_id_index`

2. `campaigns` מקבל outcome billing:
   - `outcome_billing_schema`
   - `campaign_templates`
   - `outreach_schedule`

זו נקודת הפיצול העיקרית.

### 26 ביוני 2026

הקוד נכנס ל-Git ב-checkpoint:

- `orders.ts`
- `campaigns.ts`
- migrations של שני המודלים

באותו יום נוספו:

- campaign hold data layer
- J5 authorize route
- campaign lifecycle transitions
- close-charge data layer
- close-charge route

כלומר, המסלול הכספי החדש נבנה סביב campaign.

### 29 ביוני 2026

המודל של campaign billing הושלם/התחזק:

- auth external ref
- card expiry
- charge findings
- billing back-half RPCs
- authorized set membership
- one campaign per event

זו הנקודה שבה `campaigns` הפך בפועל למודל הכספי המרכזי של המוצר החדש.

### 7 ביולי 2026

קיימים ב-live DB קמפיינים אמיתיים:

- אחד `active`
- אחד `approved`
- שניהם עם `capture_status='authorized'`

`orders` עדיין ריקה.

## השוואה פונקציונלית

| ממד | `orders` | `campaigns` |
|---|---|---|
| ישות עסקית | הזמנת מסלול | אישור קמפיין לאירוע |
| תשלום | charge מיידי | hold עכשיו, charge בסגירה |
| סכום | `total_with_vat` קבוע | `min(accrued, ceiling)` |
| מקור סכום | order row | `billed_results`, `price_per_reached`, `max_charge_ceiling` |
| מזהה פעולה | `order_id` | `campaign_id` |
| SUMIT | `sumit_document_id` | `auth_*`, `card_*`, `charge_*` |
| קשר לאירוע | nullable, `ON DELETE SET NULL` | required, `ON DELETE CASCADE` |
| קשר לאנשי קשר | אין | `campaign_authorized_contacts`, `billed_results` |
| סטטוסים | `order_status` | `campaign_status` + capture/charge status |
| קוד מרכזי | `orders.ts`, `orders/[id]/pay` | `campaigns.ts`, `authorize`, `billing`, `close-charge` |

## למה זה נראה היום כמו כפילות

יש כמה נקודות שמייצרות תחושת כפילות אמיתית:

1. שתי הטבלאות שומרות שדות SUMIT על row:
   - `orders.sumit_document_id`
   - `campaigns.sumit_charge_document_id`, `charge_payment_id`, `auth_number`, ועוד.

2. שני route handlers משתמשים באותו דפוס:
   - auth
   - CSRF
   - feature flag
   - lock אטומי
   - קריאה ל-SUMIT
   - persist result

3. `campaigns/[id]/authorize/route.ts` מציין במפורש שהוא mirrors את `orders/[id]/pay`.

4. `packages` משמש גם כ-package להזמנה וגם כ-template מסחרי לקמפיין.

אבל הדמיון הוא בעיקר טכני/תשתיתי. המשמעות העסקית שונה:

- `orders`: תשלום על מוצר/מסלול.
- `campaigns`: הרשאה להפעלת שירות outcome-billing לאירוע.

## הסיבה הסבירה להחלטה המקורית

לפי התיעוד והקוד, הסיבה היתה:

1. המוצר שינה מודל עסקי לחיוב לפי תוצאה.
2. חיוב לפי תוצאה צריך להיות תלוי ב-campaign lifecycle:
   - אישור תנאים.
   - תקרת חיוב.
   - חלון פעילות.
   - אנשי קשר מורשים.
   - תוצאות בפועל.
   - סגירת קמפיין.
3. `orders` לא הכיל את המידע הזה ולא תוכנן סביבו.
4. לכן הוחלט להטמיע את state המסחרי בתוך `campaigns`.
5. זרימת `orders` נשארה במערכת, כנראה כשריד של payment/package flow קודם או כנתיב מקביל שלא הושלם/לא בשימוש כרגע.

## מסקנה סופית

נקודת הפיצול:

- מבחינת DB/migrations: 24 ביוני 2026, בעיקר ב-`202606240003_order_payment_flow.sql` מול `202606240007_outcome_billing_schema.sql`.
- מבחינת Git/code: 26 ביוני 2026, commit `258b5ba`, שבו `orders.ts`, `campaigns.ts` וה-migrations הרלוונטיים נכנסו יחד.
- מבחינת מימוש בפועל: 26-29 ביוני 2026, כאשר J5 hold, close-charge, RPCs ו-frozen authorized set נבנו סביב `campaigns`.

הסיבה:

- `orders` מייצג רכישה/תשלום upfront.
- `campaigns` מייצג אישור קמפיין וחיוב לפי תוצאה.
- כשהמוצר עבר ל-outcome billing, הישות העסקית הנכונה הפכה להיות campaign ולא order.
- במקום לאחד או להחליף את `orders`, המערכת הוסיפה שכבת תשלום מלאה ל-`campaigns`, ולכן היום קיימים שני מודלים שנראים דומים בשמות ובשדות SUMIT, אבל נולדו לצרכים שונים.

## שורה תחתונה למקבלי החלטות

אם היום רוצים לפשט את המערכת, השאלה אינה "איזה שם נכון יותר", אלא איזה מודל עסקי נשאר:

- אם KALFA מוכרת חבילה במחיר קבוע מראש: `orders` מתאים יותר.
- אם KALFA גובה לפי איש קשר שהושג בקמפיין: `campaigns` הוא מקור האמת הנוכחי.

לפי DB live, הקוד והתיעוד, המערכת בפועל כבר בחרה באפשרות השנייה: `campaigns` הוא המודל הפעיל, ו-`orders` כרגע קיים אך ריק.
