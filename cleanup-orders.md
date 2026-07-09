בצע cleanup מקיף של מודל orders כי הוא dormant/legacy ולא פעיל עסקית.

כללי חובה:
1. אל תיגע ידנית בקבצים generated, במיוחד src/lib/supabase/types.ts.
2. אל תבצע שינוי DB לפני preflight שמוכיח ש-public.orders ריקה ושאין producer פעיל.
3. אם נדרש שינוי schema: צור migration בלבד, החל אותה, ואז הרץ supabase gen types typescript --linked כדי לעדכן טיפוסים.
4. אין להשאיר מסכים שמציגים "הזמנות" על בסיס orders.
5. אין להשאיר route/API שמשלם או עושה reconcile ל-orders אם הטבלה נמחקת.
6. אין להשאיר imports מתים, constants, schemas, labels או tests שקשורים ל-orders.

שלבי עבודה:
A. Audit:
- הרץ חיפוש מלא:
  rg -n "orders|order_status|listOrders|getOrder|listAllOrders|ORDER_STATUS|payPendingOrder|updateOrderPackage|/app/orders|/admin/orders|/api/orders" src supabase docs plans tests
- הרץ בדיקת producer:
  חפש insert/upsert ל-public.orders בקוד וב-SQL.
- הרץ Supabase read-only:
  ודא count(*) from public.orders = 0.
  ודא שאין triggers/functions/views תלויות ב-orders.

B. Code removal:
- מחק את routes:
  src/app/(customer)/app/orders
  src/app/api/orders
  src/app/(admin)/admin/orders
  src/app/api/admin/orders
- מחק data modules:
  src/lib/data/orders.ts
  src/lib/data/admin/orders.ts
- הסר ניווט:
  src/components/app-shell.tsx
  src/components/admin-shell.tsx
- נקה admin dashboard:
  הסר counts.orders וקישור /admin/orders.
- נקה settings:
  הסר listOrders({ limit: 3 }) ואת אזור recent orders.
- נקה admin users:
  הסר user.orders, updatePlanAction, updateOrderPackage, updatePlanSchema וכל UI של "עדכון תוכנית" שמבוסס על order.
- נקה constants/validation/labels:
  הסר ORDER_STATUS_LABELS אם אינו בשימוש אחר.
  הסר payPendingOrderSchema.
  הסר order_id schemas.
- נקה tests תואמים.

C. DB migration:
- צור migration שמבצעת:
  preflight: fail אם public.orders אינה ריקה.
  drop policies/indexes/table/type הקשורים ל-orders.
- אל תשתמש ב-CASCADE בלי להציג קודם תלות מפורשת. אם אין תלות, drop מסודר עדיף.

D. Regenerate:
- הרץ:
  supabase gen types typescript --linked > src/lib/supabase/types.ts
  או הפקודה הרשמית הקיימת בפרויקט.
- אל תערוך את types.ts ידנית.

E. Gates:
- npx tsc --noEmit
- npm run lint
- npm test / npx vitest run
- npm run build
- rg סופי שלא נשארו references אסורים.

קריטריון סיום:
- אין /app/orders.
- אין /admin/orders.
- אין api/orders.
- אין from('orders') בקוד.
- אין public.orders ב-generated types.
- אין order_status ב-generated types.
- build/test/lint ירוקים.