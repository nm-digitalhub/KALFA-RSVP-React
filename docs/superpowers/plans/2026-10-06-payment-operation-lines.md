# שורות פעולה בספר התשלומים (`payment_operation_lines`) — תכנית יישום

> **למבצעים:** סעיפים בפורמט `- [ ]`. שלב **Expand בלבד**: שום עמודה קיימת לא נמחקת ושום כותב/קורא ישן לא מוחלף כאן. ה-Contract (הסרת `amount`/`credit_applied`) הוא תכנית נפרדת, באישור נפרד של הבעלים.

**מטרה:** כל פעולת כסף שגובה או מחזירה (`collect`/`return`) רושמת את הרכבה כ**שורות חתומות** (כמו ש-SUMIT עצמה מציגה חיוב), ומהן נגזרים ברוטו, זיכוי ונגבה. כך "נסגר ללא חיוב" על חיוב ששולם מקרדיט הופך ל"שולם מקרדיט", וסוג תשלום חדש (גיפט קארד, קופון) הוא עוד שורה ולא שינוי סכימה.

**ארכיטקטורה:** טבלה חדשה, append-only ושרת-בלבד, `payment_operation_lines`. טריגר בסגירת הפעולה מוודא שסכום השורות שווה ל-`amount` ושהשורות השליליות שוות ל-`credit_applied`. ב-TypeScript: `OperationLine`, כתיבת שורות ב-`beginOperation`, וגזירת הזיכוי ב-`loadOperations` (משורות כשיש, אחרת מהעמודה הישנה). `deriveStatus` ו-`paymentBadge` סופרים זיכוי.

**טכנולוגיות:** Supabase Postgres (מיגרציה דרך ה-CLI, הבעלים מפעיל), TypeScript, Vitest עם `createFakeTableClient`.

**מקור ההחלטה:** הבעלים, 6.10.2026: "סכמה פשוטה וגנרית — זה הכי נכון".

## מצב ביצוע (6.10.2026)

| שלב | מצב | הערה |
|---|---|---|
| Task 1 — מיגרציה `20261006031606_payment_operation_lines.sql` | הופעלה על ידי הבעלים | ה-dry-run שתוכנן לפני ההפעלה לא רץ (הבעלים הפעיל ישר). במקומו, אחרי ההפעלה: בדיקת קריאה חזרה (4 שורות, 3 טריגרים חדשים פעילים) ו-8 בדיקות התנהגות שליליות בטרנזקציה שבוטלה (T1–T8), כולן עברו |
| Task 2 — טיפוסים | בוצע על ידי הבעלים | `gen:types` + `types:check` נקיים |
| Task 3 — `status.ts` | בוצע | `credit` בסטטוס ובתווית "שולם מיתרת זיכוי" |
| Task 4 — `ledger.ts` | בוצע | `OperationLine`, `beginOperation` עם `lines`, קריאת הזיכוי ב-`loadOperations`; `package-purchase` כותב שורה אחת |
| תוספת לא מתוכננת | בוצעה | `resolvePaymentReview`: סכום ידני שונה מפירוט השורות נדחה בהודעה ברורה (Review Focus 5), במקום "נסו שוב" |
| Task 5 — שערים | עברו | tsc, lint, worker:deps, בדיקת תווי בקרה, 10506 בדיקות; ללא build |

השם בפועל של עמודת המספור הוא `line_no` (לא `position`).

## מה נמדד (לא הוסק)

| עובדה | מקור |
|---|---|
| SUMIT מייצגת חיוב כשורות עם מחיר חתום; הנגבה הוא סכום השורות | נשלף חי מה-CRM של SUMIT (תיקיות `1076735286`, `1076735277`), 6.10 |
| `payments/charge` מקבל `UnitPrice` שלילי: HTTP 200, `Status 0`, `000`, נגבה ₪1 על `[2, -1]` | תשלום `2412329471`, יומן `sumit_test_transactions` |
| הקוד החי כבר שולח זיכוי כשורה שלילית בשם `קרדיט` | `src/lib/data/close-charge.ts:352-353` |
| `amount` ו-`credit_applied` הם `numeric(12,2)` עם `check >= 0` | `20261004105957_payment_operations_expand.sql` |
| בספר 6 שורות; הזיכוי היחיד נמצא בשורות `charge` (84 ו-200), עם `amount = 0` | שאילתה חיה 6.10 |
| `deriveStatus` מתעלם מזיכוי ו-`paymentBadge` אומר "נסגר ללא חיוב" כש-`collected = 0` | `src/lib/payments/status.ts:77` |
| בגמר חשבון שכוסה במלואו בקרדיט, ללקוח כבר נאמר "כוסו במלואם על ידי קרדיט קיים … לא בוצע חיוב לכרטיס" | `campaign-actions.ts:579-583` |
| רכישת חבילה מסרבת ללקוח עם קרדיט (`credit_unsupported`) כי ניכוי הקרדיט לא נבנה | `src/lib/payments/package-purchase.ts:46,173` |
| הקרדיט נצרך ונספר מהעמודה `campaigns.credit_applied` ב-23 קבצים (`billing.ts`, `admin/users.ts`, `close-charge.ts` ועוד) | `scripts/find-legacy-campaign-payment-columns.mjs` |
| טריגר הכנסה על הספר נועל את שורת הקמפיין; טריגר עדכון חוסם כל שינוי אחרי `succeeded` | `payment_operations_before_insert`, `payment_operations_guard_update` |

## אילוצים כלליים

- Expand בלבד. לא מוחקים `payment_operations.amount`/`credit_applied`, לא נוגעים בכותבים ובקוראים הישנים של `campaigns`.
- הטבלה החדשה: שרת-בלבד (`revoke` מ-`public, anon, authenticated`), RLS פעיל בלי policies, כמו `payment_operations`.
- שורות הן append-only: אין עדכון ואין מחיקה.
- שורות מותרות רק לפעולות שה-`effect` שלהן `collect` או `return`, ורק כשהפעולה `pending` או `review`.
- לא מעתיקים טוקן או תעודת זהות. אין commit, אין deploy, אין `npm run build` על העץ החי.

## Review Focus (מה התכנית חייבת לתפוס, ואיפה הבדיקה שלו)

1. פעולה שמסתיימת ב-`succeeded` עם שורות שסכומן שונה מ-`amount` → נדחית במסד (Task 1, dry-run).
2. שורות על `authorize`/`release` (אין להן תנועת כסף) → נדחות במסד (Task 1, dry-run).
3. פעולה ישנה בלי שורות → ה-credit נגזר מהעמודה הישנה, והתנהגות קיימת לא משתנה (Task 3 ו-4, בדיקות).
4. כתיבת השורות נכשלת אחרי `beginOperation` → הפעולה נסגרת `failed` לפני שהספק נקרא (Task 4, בדיקה).
5. `resolvePaymentReview`: האדמין חייב להזין `amount` ששווה לסכום השורות, אחרת המסד דוחה. לבדוק את ההודעה שהוא רואה (Task 4, הערה).

---

### Task 1: מיגרציה — `payment_operation_lines`, אכיפה, backfill

**קבצים:**
- יצירה: `supabase/migrations/<timestamp>_payment_operation_lines.sql` (השם נוצר ב-CLI: `npx supabase migration new payment_operation_lines`).

**התוכן (בסדר הזה):**
1. `create table public.payment_operation_lines` — `id uuid default extensions.uuid_generate_v7()`, `operation_id` → `payment_operations(id) on delete restrict`, `line_no smallint > 0`, `description text` לא ריק, `quantity numeric(12,3) > 0 default 1`, `unit_price numeric(12,2)` (חתום), `line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored`, `recorded_at`, `unique (operation_id, line_no)` (גם האינדקס של ה-FK).
2. RLS פעיל, `revoke all … from public, anon, authenticated`, בלי policies.
3. טריגר `BEFORE INSERT`: האם לפעולה `effect` של `collect`/`return`, והאם היא `pending`/`review`; אחרת `check_violation`.
4. טריגר `BEFORE UPDATE OR DELETE`: תמיד `check_violation` (append-only).
5. טריגר `BEFORE UPDATE` על `payment_operations` (`payment_operations_check_lines`, רץ לפני `guard_update`): במעבר ל-`succeeded`, אם יש שורות — `Σ line_total = new.amount` ו-`new.credit_applied = coalesce(-Σ line_total בשורות שליליות, 0)`; אחרת `check_violation`.
6. Backfill: לכל פעולת `charge` מה-backfill שאין לה שורות — שורה חיובית בשם `label_he` של הסוג בסכום `amount + credit_applied`, ואם יש זיכוי גם שורה `קרדיט` בסכום `-credit_applied` (אותו שם שהקוד שולח ל-SUMIT). ללא שורות כשהסכום והזיכוי 0. הטריגר מס' 3 מושבת בתוך המיגרציה לשלב הזה ומופעל מחדש מיד אחרי (הפעולות כבר `succeeded`).
7. בדיקת אימות בסוף: לכל פעולה עם שורות, הסכום והזיכוי תואמים; הטריגרים מופעלים; ל-2 הקמפיינים ההיסטוריים יש שורות לפי הצפוי.

**אימות:** dry-run חי כהצהרה אחת שמסתיימת בחריגה מכוונת (כך שום דבר לא נשמר), עם בדיקות השליליות של Review Focus 1 ו-2 בתוכה; לפני ואחרי: מספר השורות ו-hash של המזהים בספר זהים.

### Task 2: טיפוסים

- אחרי שהבעלים מפעיל את המיגרציה: `npm run gen:types && npm run types:check`. לא עורכים `types.generated.ts` ביד.

### Task 3: `status.ts` — זיכוי בסטטוס ובתווית (TDD)

**קבצים:** `src/lib/payments/status.ts`, `src/lib/payments/status.test.ts`, ובדיקות שבונות `PaymentState` בידיים (`.../payment/page.test.tsx`).

- [ ] **Step 1: בדיקות כושלות.** חיוב `collect` עם `amount 0, credit 84` → `credit: 84`; התווית `שולם מקרדיט` (ולא `נסגר ללא חיוב`); `collected 0, credit 0` נשאר `נסגר ללא חיוב`; חיוב מעורב (`150` נגבה, `50` קרדיט) → `collected 150, credit 50`; `refund` מקטין `collected` ולא נוגע ב-`credit`; פעולה שנכשלה לא סופרת קרדיט.
- [ ] **Step 2: מימוש.** `OperationRow.credit: number`; `PaymentState.credit: number`; ב-`deriveStatus` סוכמים `credit` מפעולות `collect` שהצליחו; כל אחד מחמשת ה-`return` מחזיר גם `credit`; `paymentBadge`: `collected === 0 && credit > 0` → `{ label: 'שולם מקרדיט', variant: 'neutral' }`.
- [ ] **Step 3: עדכון fixtures** של `PaymentState` ב-`page.test.tsx` (`credit: 0`), ו-`package-paid.test.ts` אם נדרש.

### Task 4: `ledger.ts` — כתיבה וקריאה של שורות (TDD)

**קבצים:** `src/lib/payments/ledger.ts`, `src/lib/payments/ledger.test.ts`.

- [ ] **Step 1: בדיקות כושלות.** `beginOperation` עם `lines` כותב פעולה `pending` ואז שורות לפי הסדר; `amount` שונה מסכום השורות → נזרק לפני כל כתיבה; שורה בלי תיאור או עם מחיר לא סופי → נזרק; כשהכנסת השורות נכשלת, הפעולה נסגרת `failed` והשגיאה נזרקת; `recordOperation` לא מקבל שורות; `loadOperations` מחשב `credit` משורות שליליות כשיש שורות, ומהעמודה `credit_applied` כשאין.
- [ ] **Step 2: מימוש.** `OperationLine = { description: string; quantity?: number; unitPrice: number }`; `linesTotal`, `linesCredit` (עיגול לאגורות); `NewOperation.lines`; `loadOperations` בוחר `credit_applied, payment_operation_lines(line_total)`.
- [ ] **Step 3:** `package-purchase.ts` מעביר שורה אחת (שם החבילה והמחיר) ל-`beginOperation`, כדי שהמודל ייבחן בנתיב הכותב היחיד שמוכן. הזיכוי עדיין `credit_unsupported`.

### Task 5: שערי אימות

`npx tsc --noEmit`, `npm run lint`, `npx vitest run` (ממוקד ואז מלא), `npm run worker:deps`, `node scripts/check-control-characters.mjs`. בלי `npm run build`.

## מחוץ לתכנית הזו (Contract, אישור נפרד)

1. מעבר כותבי `campaigns` (בראשם `close-charge.ts`) לספר, ומעבר קוראי `credit_applied` ב-23 הקבצים.
2. ניכוי קרדיט ברכישת חבילה (`credit_unsupported`), על בסיס שורה שלילית.
3. הסרת `payment_operations.amount`/`credit_applied` כשהכול נגזר משורות, והסרת העמודות הישנות ב-`campaigns`.
4. יתרת זיכוי וגיפט קארד כמקור נפרד (טבלת מקורות), ושאלת הקבלה מול יועץ המס.
