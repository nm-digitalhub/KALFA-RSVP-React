# בדיקה חיה של 8 פעולות הצפייה של SUMIT

בוצעה ב-5.10.2026 בהוראת הבעלים, מול החשבון החי. **קריאות צפייה בלבד** (list/get). לא בוצעה שום כתיבה, ולא בוצעה `getpdf` עם `Original:true` (עלול לצרוך את העותק המקורי).
הפלט נבדק כך שלא הודפסו סודות, קישורים, שמות, כתובות, מיילים, טלפונים או פרטי כרטיס: רק מבנה (שמות שדות וסוגים), מספרים ושדות לא רגישים.
סקריפט הבדיקה היה זמני ומחוץ לפרויקט (נבנה ב-esbuild עם `getSumitServerConfig`), ולא נשמר ב-repo.
רקע: [sumit-api-endpoints-purposes-he-2026-10-05.md](sumit-api-endpoints-purposes-he-2026-10-05.md) ו-[sumit-api-endpoints-by-topic-2026-10-05.md](sumit-api-endpoints-by-topic-2026-10-05.md).

## תוצאות

כל 8 הפעולות החזירו `HTTP 200` ו-`Status=0` (מספר, לא מחרוזת), תוך 40 עד 1,140 מילי-שניות.

| נקודה | תשובה | מה נמצא |
|---|---|---|
| `website/companies/getdetails` | `Data.Company` | 18 שדות: שם, מייל, מייל מסמכים, מדינה, כתובת, טלפון, ח.פ, שמות באנגלית, לוגו, אתר, ו-`CompanyType=1`. לפי החוזה `1 = VATExemptDealer`, כלומר עוסק פטור, תואם למצבנו |
| `website/companies/listquotas` | `Data.Data[]` (לא `Quotas`) | 4 שורות: `OutgoingEmails/Mails` 0 מתוך 40,000; `Files/Storage` 1 מתוך 10,000; `ActionsBilling/Operations` 0 מתוך 400; `ActionsBilling/Obligo` 0 מתוך 351,720 |
| `accounting/documents/list` | `Data.Documents[]`, `Data.HasNextPage` | 10 מסמכים בטווח 60 יום (התבקשו 5: גודל עמוד מינימלי כנראה 10), ויש עמוד נוסף. 7 מסוג `Order (8)` (מספרים 1000-1006) ו-3 מסוג `InvoiceAndReceipt (1)` (מספרים 40107-40109). לכל שורה: `DocumentID`, `DocumentNumber`, `Date`, `Type`, `Currency`, `IsDraft`, `IsClosed`, `ExternalReference` (ריק במסמכים אלה), `DocumentValue`, `CompanyValue`, ו**גם** `CustomerName`, `DocumentDownloadURL`, `DocumentPaymentURL` |
| `accounting/documents/getdetails` | `Data.Document`, `Items[]`, `Payments`, URLs | כולל אובייקט לקוח מלא: שם, טלפון, מייל, ח.פ, מזהה לקוח |
| `accounting/documents/getpdf` (`Original:false`) | `HTTP 200`, `application/pdf` | **קובץ PDF ישיר, לא מעטפת JSON** (78KB, כשנייה, מתחיל ב-`%PDF`). שגיאה כנראה תחזור כ-JSON, ולכן הלקוח חייב להבחין לפי `content-type` |
| `accounting/customers/getdetailsurl` | `Data.CustomerHistoryURL` | קישור על `pay.sumit.co.il`, 4 מקטעי נתיב, בלי פרמטרים (אסימון בנתיב): כנראה כתובת-יכולת, ולכן **סוד**. לא נפתח, ולא ידוע אם דורש התחברות |
| `billing/payments/list` | `Data.Payments[]`, `HasNextPage` | 20 תשלומים בטווח 60 יום: 11 תקינים (`ValidPayment=true`, קוד 000; סכומים בין ₪1 ל-₪400) ו-9 שנכשלו (קודים 006, OG_20, 004; כולם ₪1). `StatusDescription` הוא רק " (קוד …)" ללא טקסט. כל שורה כוללת אובייקט `PaymentMethod` |
| `billing/payments/get` | `Data.Payment` | כמו בשורת הרשימה, ובתוכה `PaymentMethod` עם ארבע ספרות, תוקף, מסכה, **טוקן כרטיס ותעודת זהות** |

## הפתעות מול החוזה והציפיות

- מכסות: המערך נמצא ב-`Data.Data`.
- `getpdf`: אין סכמת תגובה בחוזה, והתשובה בפועל היא בינארית.
- `documents/list`: `Paging.PageSize` קטן מ-10 לא מקטין את התשובה.
- `StatusDescription` בתשלומים ריק מטקסט: השם נוצר אצלנו, כמו בשאר הקודים של SUMIT.
- `documents/list` מחזירה בכל שורה כתובות הורדה ותשלום ושם לקוח, ולכן קריאה כללית אסורה בלי הקרנה (projector) לשדות מותרים.

## מסקנות לתכנון

1. ללקוח ה-SUMIT הממוזג (`src/lib/sumit/client.ts`) דרושה הקרנה מפורשת לשדות מותרים בכל תשובת רשימה או פרטים: בלי שם לקוח, בלי URL, בלי אובייקט `PaymentMethod`.
2. `getpdf` מחזיר בינארי: הלקוח צריך מצב "בינארי", ובדיקה של `content-type`/`%PDF` לפני שמניחים הצלחה.
3. `customers/getdetailsurl` מטופל כסוד: הרשאה מוגבלת, בלי לוג, בלי שמירה.
4. `CompanyType` שווה לעוסק פטור ב-SUMIT: כדאי להציג אותו במסך הניהול, כי כל מסמך בלי מע"מ תלוי בו.

## לא נבדק

- `getpdf` עם `Original:true`, והאם הורדה ראשונה מבטלת את המקור.
- שמירה של `ExternalReference` ביצירת מסמך (נדרשת כתיבה).
- האם `CustomerHistoryURL` דורש התחברות.
- כל פעולות הכתיבה, ההודעות, והתשלומים.

## תיקון (5.10, ערב)

בגרסה הראשונה של המסמך כתבתי שכל המסמכים הם הזמנות ושכל התשלומים נכשלו, והסתמכתי על 5 השורות הראשונות בלבד בהדפסה. הנתונים המלאים מופיעים למעלה (3 מסמכי חשבונית-קבלה, ו-11 תשלומים תקינים מתוך 20). ההדפסה הראשונה הסתירה ערכים בכוונה, והבעלים ביקש ערכים אמיתיים.
