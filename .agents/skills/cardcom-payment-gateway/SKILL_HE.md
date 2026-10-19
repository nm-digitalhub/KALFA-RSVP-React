# שער תשלומים קארדקום

## הבהרה משפטית

זהו מדריך אינטגרציה טכני חינמי, הפועל באמצעות מודל בינה מלאכותית. הוא מסביר איך לקרוא ל-API של קארדקום ואיך כללי החשבוניות בישראל משליכים על כך. כל תוצריו מופקים באופן אוטומטי על ידי מודל בינה מלאכותית, ללא מעורבות, בדיקה או אישור של יועץ מס, רואה חשבון או עורך דין. אין כאן חוות דעת מס ואין ייעוץ מקצועי, ומודל בינה מלאכותית עלול לשגות, להשמיט נתונים או להציג מסקנה שגויה.

המסמכים שהאינטגרציה הזאת מפיקה הם מסמכי מס. האחריות להפיק אותם כראוי, לדווח ולשלם את המס היא שלכם, החישוב המחייב הוא של רשות המסים, וייצוג מול רשות המסים שמור למי שרשאי לכך לפי דין. השאלה אם חשבונית מסוימת טעונה מספר הקצאה, והשאלה אם ניתן לקזז מס תשומות, הן קביעות של רואה החשבון שלכם על העובדות שלכם בפועל. תנו ליועץ מס או לרואה חשבון לבדוק את תצורת החשבוניות לפני עלייה לאוויר, וטפלו בנתוני כרטיסי אשראי בהתאם ל-PCI DSS. כל שימוש בפלט של הסקיל הוא באחריותו הבלעדית של המשתמש.

## סקירה

קארדקום היא חברת סליקה ישראלית עם יתרון ייחודי אחד: הפקת חשבוניות וקבלות משולבת בתשלום, לפי חוק המס הישראלי. שערי תשלום אחרים מטפלים רק בתשלום עצמו, אבל קארדקום יכולה להפיק אוטומטית חשבוניות מס וקבלות כחלק מתהליך התשלום, דבר שעסקים ישראליים חייבים לספק לפי חוק.

הסקיל מכסה את REST API V11 של קארדקום לתשלומים, טוקניזציה, חיובים חוזרים ומסמכים. שמות ה-endpoints והשדות לקוחים ממפרט ה-OpenAPI הרשמי של V11.

תיעוד רשמי נמצא בכתובת `https://secure.cardcom.solutions/Api/v11/Docs`, מרכז התמיכה בכתובת `https://support.cardcom.solutions`. V11 הוא ה-API הנוכחי נכון ל-2026, אין V12 פומבי.

קארדקום בנוף הישראלי: מתחרה בטרנזילה ובשערי תשלום ישראליים אחרים. קארדקום מפרסמת עמלה שמתחילה בכ-1.2% ויורדת בהתאם למחזור; זו רצפה ולא הצעת מחיר, אז תפנו את המשתמש לקארדקום לקבלת מספר אמיתי. היתרון הייחודי נשאר הפקת מסמכי מס מובנית. לאינטגרציה עם טרנזילה, השתמשו ב-`tranzila-payment-gateway` במקום.

## הוראות

### שלב 1: בחירת דפוס אינטגרציה

| דפוס | טיפול בנתוני כרטיס | מתאים ל- |
|---------|-------------------|----------|
| **Low Profile (iframe/redirect)** | קארדקום מטפלת בהזנת הכרטיס | רוב האינטגרציות, היקף PCI מינימלי (SAQ-A) |
| **Transaction (שרת-לשרת)** | נתוני כרטיס גולמיים או טוקן | חיוב טוקנים שמורים, חיובים חוזרים |
| **CreateDocument (שרת-לשרת)** | ללא נתוני כרטיס | הפקת חשבונית/קבלה עצמאית |

רוב בתי העסק הישראליים משתמשים ב-Low Profile לתשלום הראשון ויצירת טוקן, ואז ב-endpoint של Transaction עם הטוקן השמור לחיובים חוזרים. כל זרימות התשלום יכולות להפיק חשבוניות אוטומטית על ידי צירוף אובייקט `Document`.

### שלב 2: הגדרת אימות

פרטי הגישה ל-Cardcom API V11:
- `TerminalNumber` (מספר שלם), מזהה המסוף שלכם (`1000` הוא מסוף הבדיקות של קארדקום, ראו למטה)
- `ApiName` (מחרוזת), שם משתמש API
- `ApiPassword` (מחרוזת), סיסמת API. כלל האצבע: **פעולות שקוראות או פועלות על נתונים ברמת החברה דורשות אותה, ופעולות שמחייבות כרטיס בודד לא.** היא נדרשת, בין השאר, ב-`Transactions/ListTransactions`, ב-`RefundByTransactionId`, ב-`SpecialTransactions`, ב-`Documents/CreateDocument`, ב-`CancelDoc` ובדוחות `Financial/*`. היא לא שדה ברמה העליונה של `LowProfile/Create` או של `Transactions/Transaction`, אז אל תשלחו אותה שם. רשימת הסכמות שדורשות אותה משתנה בין גרסאות של המפרט (ראו מלכודות נפוצות), אז תבדקו את מערך ה-`required` של סכמת הבקשה ב-[מפרט ה-OpenAPI של V11](https://secure.cardcom.solutions/swagger/v11/swagger.json) ולא תסתמכו על רשימה.

**סביבת בדיקות (לפי עמוד המידע למתכנתים של קארדקום עצמה):**
- מסוף `1000`. שם המשתמש והסיסמה לממשקים במסוף הזה לא מפורסמים: מבקשים אותם מהתמיכה של קארדקום.
- כרטיס בדיקה ישראלי `4580280000000008` (תומך תשלומים וקרדיט); כרטיס בדיקה תייר `4580000000000000` (לא תומך תשלומים וקרדיט). כל תוקף עתידי, CVV `123`, כל מספר ת.ז.
- בכרטיסי הבדיקה, עסקאות מתחת ל-5,000 ש"ח ידמו הצלחה ועסקאות מעל 5,000 ש"ח ידמו כישלון, אז כישלון של חיוב בדיקה גדול הוא צפוי ולא באג.
- עסקאות במסוף הבדיקות עוברות את כל תהליך הסליקה בלי לחייב את הכרטיס בפועל. כרטיס אמיתי שמשמש לבדיקה לא מחויב, אבל נתפסת בו מסגרת בגובה הסכום לשלושה ימים, אז לעולם אל תבדקו עם כרטיס של לקוח.

**תתייחסו ל-`ApiName`, ל-`ApiPassword` ולכל טוקן שמור כסודות.** ל-`Transactions/Transaction` מספיקים `TerminalNumber`, `ApiName` ו-`Amount`, כך ש-`ApiName` יחד עם טוקן יכולים לחייב כרטיס שמור. שמרו אותם במשתני סביבה של צד השרת בלבד (ב-Next.js לעולם לא `NEXT_PUBLIC_*`), פנו לקארדקום רק מקוד שרת, ואל תכתבו ללוג תגובה מלאה (היא נושאת את הטוקן ואת מספר הזהות של בעל הכרטיס).

### שלב 3: מימוש זרימת התשלום

#### אינטגרציית Low Profile (מומלץ)

זה תהליך בשני שלבים.

**שלב 3א: יצירת דף התשלום**

```
POST https://secure.cardcom.solutions/api/v11/LowProfile/Create
Content-Type: application/json

{
  "TerminalNumber": 1000,
  "ApiName": "your-api-name",
  "Operation": "ChargeAndCreateToken",
  "ReturnValue": "unique-order-id",
  "Amount": 100.00,
  "SuccessRedirectUrl": "https://example.com/success",
  "FailedRedirectUrl": "https://example.com/failed",
  "WebHookUrl": "https://example.com/webhook",
  "ISOCoinId": 1,
  "Language": "he",
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "שם הלקוח",
    "Email": "customer@example.com",
    "Products": [
      { "Description": "שם המוצר", "UnitCost": 100.00, "Quantity": 1 }
    ]
  }
}
```

התגובה היא `CreateLowProfileResponse`: תבדקו `ResponseCode == 0` (הצלחה), תקראו את `Description` בכשלון. בהצלחה היא מחזירה `LowProfileId` (תשמרו אותו) ו-`Url` (תפנו לשם את הלקוח או תטמיעו כ-iframe). `UrlToBit` ו-`UrlToPayPal` מוחזרים גם הם כשהאמצעים האלה מופעלים במסוף שלכם.

השדה `Operation` שולט בהתנהגות: `ChargeOnly` (ברירת מחדל), `ChargeAndCreateToken`, `CreateTokenOnly`, `SuspendedDeal`, `Do3DSAndSubmit`.

**שורות ה-`Document` חייבות להסתכם בדיוק ב-`Amount`** (קארדקום: "יש לדאוג שסה\"כ שורות החשבונית שווה לסכום החיוב"), ולכן מחירי השורות נרשמים כסכומים שהלקוח משלם בפועל, כולל מע"מ. אי-התאמה עלולה להשאיר כרטיס מחויב בלי חשבונית, כי קארדקום נותנת עדיפות לחיוב.

**שלב 3ב: קבלת התוצאות**

אחרי שהתשלום מסתיים, קארדקום קוראת ל-`WebHookUrl` שלכם, או שאתם עושים שאילתה:

```
POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult
{
  "TerminalNumber": 1000,
  "ApiName": "your-api-name",
  "LowProfileId": "id-from-step-3a"
}
```

התגובה היא `LowProfileResult`, וה-`ResponseCode` ברמה העליונה שלה אינו תוצאת התשלום. המפרט מתאר אותו כשגיאת מפתח: הוא אומר שהבקשה נבנתה נכון, וזה הכול. תוצאת הכרטיס נמצאת ב-`TranzactionInfo` המקונן, שלפי המפרט אינו null רק בפעולות ChargeOnly ו-ChargeAndCreateToken, כלומר הוא כן null כשהלקוח נטש את הדף.

**לפני שמספקים משהו, כל חמשת התנאים האלה חייבים להתקיים:**

1. סטטוס HTTP הוא 200. תשובת 404 מחזירה `{"Message": "No HTTP resource was found..."}` בלי `ResponseCode` בכלל, אז בדיקה של `ResponseCode == 0` לבדה קוראת שגיאת ניתוב כ-`None`.
2. `ResponseCode` ברמה העליונה שווה 0.
3. `TranzactionInfo` אינו null.
4. `TranzactionInfo.ResponseCode` שווה 0 (700 ו-701 הם הצלחה רק ל-J2 ו-J5).
5. `TranzactionInfo.Amount` שווה לסכום שציפיתם לו, ו-`ReturnValue` תואם למזהה ההזמנה שלכם.

תבדקו גם את `TranzactionInfo.IsRefund` ואת `DealType`: החזר הוא עסקה מוצלחת ויעבור בדיקה נאיבית של `ResponseCode == 0`. אם ביקשתם מסמך, גם `DocumentInfo` חייב להיות לא-null, כי חיוב שהצליח עם `DocumentInfo: null` פירושו שלקחתם את הכסף ולא הפקתם חשבונית מס. (קארדקום נותנת עדיפות לחיוב כשהפקת החשבונית נכשלת.) הסקריפט `scripts/validate_cardcom_response.py --expect charge --amount <n> --return-value <order-id> --with-document` מחיל את כל זה ונכשל בברירת מחדל בטוחה.

אף פעם אל תספקו על סמך נחיתת הדפדפן ב-`SuccessRedirectUrl`, שנמצא בשליטת הלקוח, או על סמך גוף ה-webhook. `TokenInfo` נושא את ה-`Token` השמור עם `CardMonth`/`CardYear`, ו-`SuspendedInfo` מכסה עסקאות ממתינות.

**ה-handler של ה-webhook (השדה `WebHookUrl` הוא חובה ב-`LowProfile/Create`):** מפרט V11 לא מגדיר לו חתימה, סוד משותף או HMAC, ולא מתעד את מבנה הגוף שלו או את מדיניות השליחה החוזרת. תתייחסו לכל פנייה כאות לא מאומת, שעלול להגיע יותר מפעם אחת:

1. מחפשים את ה-`LowProfileId` שבפנייה בין המזהים ששמרתם בעצמכם מ-`LowProfile/Create`. מזהה לא מוכר מתעלמים ממנו, לא שולפים אותו.
2. קוראים ל-`GetLpResult` עם פרטי הגישה שלכם ומריצים את חמש הבדיקות שלמעלה. לעולם לא קוראים סכום או סטטוס מגוף ה-webhook.
3. מספקים באופן אידמפוטנטי (מסמנים שההזמנה סופקה באותה טרנזקציה שבודקת את זה), כי אותו אירוע יכול להגיע יותר מפעם אחת. התיעוד של קארדקום לממשק הישן `IndicatorUrl` אומר שהיא שולחת שוב עד 7 פעמים כשהשרת שלכם לא עונה HTTP 200; תניחו שגם V11 יכול לחזור.
4. כותבים את הפנייה לאחסון עמיד, ורק אז מחזירים HTTP 200 (תשובת 200 עוצרת את השליחות החוזרות של קארדקום). בנוסף סורקים הזמנות ממתינות עם `GetLpResult` במקום לחכות ל-webhook שאולי לא יגיע; קוד הדף פג 24 שעות אחרי היצירה. עוד ב-`references/production-checklist.md`.

#### אמצעי תשלום חלופיים

השדות `UrlToBit` ו-`UrlToPayPal` בתגובת `LowProfile/Create` הם כתובות נפרדות שאפשר להציג ליד טופס הכרטיס; Google Pay ו-Apple Pay מופיעים ככפתורי ארנק בתוך הדף המתארח אחרי שמפעילים אותם במסוף. **Apple Pay לא תומך בשמירת אסימון או בהוראות קבע** (לפי קארדקום, בהוראת קבע הכפתור עשוי להופיע אבל אי אפשר להשלים בו את התשלום), אז דף מנוי מסוג `ChargeAndCreateToken` לא ניתן לתשלום בו, ובתוך iframe הוא דורש רישום של הדומיין שלכם מול Apple דרך התמיכה של קארדקום. פירוט: `references/api-endpoints.md`.

### שלב 4: הפקת מסמכי מס ישראליים

סוג המסמך נקבע באמצעות השדה **`DocumentTypeToCreate`**, שהוא enum מסוג מחרוזת (לא מספר שלם). ערכים נפוצים:

| ערך | סוג | מתי משתמשים |
|-------|--------|-------------|
| `Auto` | אוטומטי | ברירת מחדל, משתמש בהגדרות לוח הבקרה שלכם |
| `TaxInvoiceAndReceipt` | חשבונית מס / קבלה | B2C עם תשלום (הנפוץ ביותר) |
| `TaxInvoice` | חשבונית מס | B2B, כשהקבלה מונפקת בנפרד |
| `Receipt` | קבלה | אישור תשלום בלבד |
| `TaxInvoiceAndReceiptRefund` | זיכוי חשבונית מס / קבלה | ביטול של `TaxInvoiceAndReceipt` |
| `TaxInvoiceRefund` | זיכוי חשבונית מס | ביטול של `TaxInvoice` |

ל-enum המלא של `DocumentToCreate` יש 25 ערכים, והם מפורטים ב-`references/document-types.md`. אין `QuoteRefund` ואין `OrderRefund`, אז אל תמציאו גרסת החזר על ידי הוספת `Refund` לשם.

איך לכלול מסמך בתהליך תשלום: תוסיפו את אובייקט `Document` לבקשת `LowProfile/Create` או `Transaction`. קארדקום מפיקה את המסמך אוטומטית כשהתשלום מצליח.

הפקת מסמך עצמאית:

```
POST https://secure.cardcom.solutions/api/v11/Documents/CreateDocument
{
  "ApiName": "your-api-name",
  "ApiPassword": "your-api-password",
  "Document": {
    "DocumentTypeToCreate": "TaxInvoice",
    "Name": "שם הלקוח בעמ",
    "TaxId": "123456789",
    "Email": "customer@example.com",
    "IsSendByEmail": true,
    "Languge": "he",
    "ISOCoinID": 1,
    "Products": [
      { "Description": "שירותי פיתוח אתרים", "UnitCost": 5000.00, "Quantity": 1 }
    ]
  }
}
```

התגובה היא `DocumentInfo`: תבדקו `ResponseCode == 0`, ואז תקראו את `DocumentType`, `DocumentNumber`, `AccountId` ו-`DocumentUrl` (קישור ל-PDF).

איות השדות שונה בין שלושת אובייקטי המסמך (`Languge` לעומת `Language`, ו-`ISOCoinID` קיים רק ב-`Document` העצמאי הזה, לעולם לא בתוך מסמך של Low Profile או של Transaction); ראו מלכודות נפוצות ואת `references/document-types.md` לרשימת השדות המלאה. `TaxId` מחליף את `VAT_Number` הישן ו-`IsSendByEmail` מחליף את `SendByEmail`.

### שלב 4.5: מספר הקצאה בחשבוניות מס

**אל תחפשו שדה של מספר הקצאה ב-API של המסמכים. אין כזה, וזו לא השמטה.** מערכת המסמכים של קארדקום מחוברת לרשות המסים ומבקשת את המספר בעצמה כשהיא מפיקה חשבונית מס מעל הסף. לא בקשת `CreateDocument` ולא תגובת `DocumentInfo` נושאות אותו; המספר מודפס על המסמך תחת הכותרת "מספר הקצאה:", אז קוראים אותו מקובץ ה-PDF שב-`DocumentUrl`.

**זה עובד רק אחרי רישום שפג תוקפו.** בלי מספר, הלקוח שלכם לא יכול לקזז מע"מ תשומות על חשבונית שסכומה לפני מע"מ עולה על הסף. לפי המדריך של קארדקום עצמה:

1. בעל העסק מזדהה באזור האישי באתר רשות המסים, ונרשם אם צריך.
2. חברה בע"מ או איחוד עוסקים מבצעים שם רישום פרטי תאגיד.
3. במערכת הניהול של קארדקום: הגדרות, אחר כך מסמכים, אחר כך שירות חשבוניות ישראל. מפיקים קוד אימות ומועברים לרשות המסים להזדהות. רק בעל העסק, או מי שבעל העסק נתן לו הרשאה לפעולות דיגיטליות, יכול לבצע את זה.
4. לוחצים על "בדיקת קבלת מספר הקצאה" כדי לוודא שמספרים באמת מונפקים.

קוד האימות תקף **לשלושה חודשים**. אחרי שהוא פג, חשבוניות מונפקות בלי מספר; נרשמים מחדש ואז מדפיסים מחדש את המסמך כדי לצרף מספר. לכן job מתוזמן שמפיק חשבוניות גדולות חייב לבדוק שהשירות פעיל, לא להניח את זה. שגיאה `Not Acceptable (406)` פירושה שלמשתמש שהזדהה אין הרשאה מול רשות המסים עבור העסק הזה: בעל העסק נותן אותה תחת "הרשאות לפעולות דיגיטליות", ובוחר את שני הנושאים "חשבוניות ישראל – אימות מספר הקצאה בחשבונית ספק" ו-"חשבוניות ישראל – בקשת מספר הקצאה עבור חשבונית ללקוח".

קארדקום מתעדת גם שלא יונפק מספר כאשר: חסר מספר הזהות או ח.פ. של הלקוח (`TaxId`); הספק והלקוח הם אותו ח.פ.; או שחשבונית מס קבלה לא כוללת מע"מ.

**מתווה התקרות (לפני מע"מ; החוק כותב `עולה על`):**

| נכון מ | תקרה |
|---------|------|
| מאי 2024 | 25,000 ש"ח |
| ינואר 2025 | 20,000 ש"ח |
| 1.1.2026 | 10,000 ש"ח |
| 1.6.2026 | **5,000 ש"ח (בתוקף עכשיו)** |

הסף נקבע לפי התאריך של כל מסמך; ראו `references/document-types.md` למסמכים ישנים, עוסק פטור וחשבוניות בשיעור אפס. גם כשהכול מוגדר, מספר יכול להיעצר: לפי סעיף 47(א2)(3) המנהל רשאי להחליט שלא להקצות מספר כשיש לו יסוד סביר לחשש שהחשבונית תוצא שלא כדין (החלטה מקדמית, עם שימוע בתוך שני ימי עסקים), וסעיף 47(א2)(4) מאפשר לעוסק לבקש מספר גם לאחר הוצאת החשבונית. תוודאו שהמספר מופיע על המסמך לפני שאתם מסתמכים עליו.

### שלב 4.6: מניעת כפילות, ואישור מול גבייה

**תשלחו `ExternalUniqTranId` בכל קריאה ל-`Transactions/Transaction`.** זה מזהה ייחודי משלכם
לחיוב, והמפרט מפורש: אם יישלח אותו `ExternalUniqTranId` פעם נוספת, תקבלו שגיאה 608. בלי זה,
קרון שהקריאה שלו נכשלה בטיימאאוט אחרי שקארדקום כבר חייבה את הכרטיס ינסה שוב ויחייב את הלקוח
פעמיים.

**608 אומר "המזהה הזה כבר קיבל תשובה תקינה מהכרטיס", לא "התשלום נכשל".** לפי ההנחיות של קארדקום לממשק חיוב האסימונים, המזהה נצרך כשקריאה מקבלת תשובת חיוב (0), J2 (701) או J5 (700), כך ש-608 לא מוכיח שנגבה כסף. לעולם אל תנסו שוב עם מזהה חדש: אחרי כל 608, טיימאאוט או תוצאה לא ברורה, תקראו ל-`POST /api/v11/Transactions/GetTransactionByExternalUniqTran` ותחליטו לפי ה-`ResponseCode` של הרשומה ההיא (0 = חויב; 700/701 = רק נבדק או נתפס). חיוב שנדחה לא צורך את המזהה, אז אפשר לנסות שוב עם אותו מזהה; חכו לתשובה (עד 7 שניות) לפני שליחה חוזרת. לגבייה תנו מזהה משלה, לעולם לא את המזהה של התפיסה.

**שימו לב: J2 ו-J5 אינם אותו דבר, ו-700/701 לא אומרים שהלקוח לא נגוע.** השדה `JValidateType` חל על הפעולות `CreateTokenOnly` ו-`SuspendedDeal`, ובוחר בין J2 (אימות כרטיס פשוט, שום דבר לא נתפס) לבין J5 (אישור, שתופס את הסכום במסגרת של בעל הכרטיס). ב-`LowProfile/Create` ברירת המחדל שלו היא `5`, כך שדף `CreateTokenOnly` תופס J5 על `Amount` אלא אם שולחים `AdvancedDefinition.JValidateType: 2`. גבייה של J5 נעשית בחיוב הטוקן כש-`Advanced.ApprovalNumber` מכיל את ה-`TokenInfo.TokenApprovalNumber` שקיבלתם (במפרט: גבייה של בקשת J5). אישור שלא נגבה משאיר את כספי הלקוח תפוסים עד שהוא פג, אז אם אתם משתמשים ב-J5 חייב להיות לכם שלב גבייה ומסלול שחרור (קארדקום מתעדת `MTI=420` עם מספר העסקה של התפיסה; במסוף הבדיקות אי אפשר לבצע J5 בכלל, ראו `references/production-checklist.md`).

### שלב 5: תשלומים חוזרים מבוססי טוקן

למנויים וחיובים חוזרים (הוראות קבע), קארדקום תומכת בשתי גישות:

- **הוראת קבע על כרטיס אשראי**, חיוב של `Token` שמור על מחזור קבוע. מטופל בשלב הזה.
- **הוראת קבע בנקאית דרך מס"ב**, חיוב ישיר מחשבון הבנק הישראלי של הלקוח. מנוהל דרך ה-endpoints של `RecuringPayments` (`RecuringPayments/GetRecurringPayment`, `GetRecurringPaymentHistory`, `IsBankNumberValid`). תשתמשו בזה כשהלקוח מעדיף חיוב בנקאי על פני חיוב כרטיס או כשאין כרטיס זמין. ההוראה עצמה מוקמת מלוח הבקרה של קארדקום.

לתשלום חוזר מבוסס כרטיס, קודם תוודאו שלבית העסק יש מודול אסימונים של קארדקום ומסוף שלא מחייב CVV (במסוף שמחייב CVV כל חיוב טוקן דורש מספר אישור J5 חד-פעמי), ובלי המודול קארדקום שומרת טוקן רק 6 חודשים, לצורכי זיכויים (`references/production-checklist.md`).

1. **יצירת טוקן בתשלום הראשון.** תשתמשו ב-Low Profile עם `Operation: "ChargeAndCreateToken"` (או `"CreateTokenOnly"`). ה-`LowProfileResult` מחזיר `TokenInfo` עם `Token`, `CardMonth`, `CardYear` ו-`TokenExDate` (התאריך שבו הטוקן נמחק ממערכת קארדקום).

2. **אחסון הטוקן בצורה מאובטחת.** תשמרו את מחרוזת ה-`Token`, תפוגת הכרטיס ו-4 הספרות האחרונות. הטוקן קשור למסוף שלכם.

3. **חיוב הטוקן** דרך endpoint של Transaction:

```
POST https://secure.cardcom.solutions/api/v11/Transactions/Transaction
{
  "TerminalNumber": 1000,
  "ApiName": "your-api-name",
  "Token": "token-uuid",
  "CardExpirationMMYY": "1227",
  "Amount": 99.00,
  "ISOCoinId": 1,
  "ExternalUniqTranId": "sub-8841-2026-10",
  "Document": {
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "Name": "שם המנוי",
    "Email": "customer@example.com",
    "IsSendByEmail": true,
    "Products": [
      { "Description": "מנוי חודשי", "UnitCost": 99.00, "Quantity": 1 }
    ]
  }
}
```

ה-`ExternalUniqTranId` הוא מזהה אחד לכל מנוי בכל מחזור חיוב, כך שניסיון חוזר של אותו מחזור נחסם (608) והחיוב של החודש הבא עובר. התגובה היא `TransactionInfo`: רק `ResponseCode == 0` הוא חיוב (`700`/`701` הם תשובות לבדיקות J2/J5, שבהן לא חויב דבר), ואז תקראו את `TranzactionId`, `Token`, `DocumentNumber` ו-`DocumentUrl`. כל חיוב טוקן יכול להפיק ולשלוח חשבונית במייל אוטומטית כשמצורף אובייקט `Document`; אם חסר `DocumentNumber`, הכרטיס חויב אבל החשבונית לא הופקה, אז תפיקו אותה עם `CreateDocument` ולא תחייבו שוב.

### שלב 6: ביצוע החזרים

החזר עסקה לפי מזהה העסקה של קארדקום:

```
POST https://secure.cardcom.solutions/api/v11/Transactions/RefundByTransactionId
{
  "ApiName": "your-api-name",
  "ApiPassword": "your-api-password",
  "TransactionId": 219282004,
  "PartialSum": 100.00,
  "CancelOnly": false,
  "AllowMultipleRefunds": false
}
```

`ApiPassword` נדרשת להחזרים. `PartialSum` מחזיר חלק מהעסקה (תשמיטו אותו כדי להחזיר את הסכום המלא). `CancelOnly: true` מבטל עסקה לפני שהיא הופקדה. התגובה היא `RefundByTransactionIdResp`: תבדקו `ResponseCode == 0`, ואז תקראו את `NewTranzactionId` (מזהה עסקת ההחזר).

כדי להנפיק את מסמך הזיכוי התואם, תקראו ל-`Documents/CreateDocument` עם `DocumentTypeToCreate` של זיכוי כמו `TaxInvoiceAndReceiptRefund` או `TaxInvoiceRefund`, ותקשרו אותו לעסקת הזיכוי דרך `DealNumbers: [{"DealNumber": <NewTranzactionId>}]`, לא לעסקת החיוב המקורית. ההנחיות של קארדקום לממשק הישן אומרות זאת במפורש: אחרי זיכוי פונים שוב ל-API להפקת מסמך זיכוי ומצליבים אותו לעסקת הזיכוי. אל תקראו בנוסף ל-`Documents/CancelDoc` עבור אותו זיכוי: לפי סיכום המפרט הוא מבטל מסמך ומזכה את כרטיס האשראי, הוא מקבל `ApiName`, `ApiPassword`, `DocumentNumber` ו-`DocumentType` שהוא מספר שלם, ומחזיר `NewDocumentNumber`, כך ששילוב שלו עם `RefundByTransactionId` מסכן זיכוי כפול. בזיכוי מלא של מכירה שיש לה מסמך, `CancelDoc` לבדו הוא החלופה שקשורה למסמך; `AllowMultipleRefunds` (ברירת מחדל `false`) הוא ההגנה שלכם מפני זיכוי כפול של אותה עסקה.

### שלב 6.5: שליפת עסקאות לדוחות

כדי למשוך טווח תאריכים של עסקאות (התאמות, דוחות חודשיים, דשבורדים):

```
POST https://secure.cardcom.solutions/api/v11/Transactions/ListTransactions
{
  "ApiName": "your-api-name",
  "ApiPassword": "your-api-password",
  "FromDate": "01062026",
  "ToDate": "30062026",
  "TranStatus": "Success",
  "Page": 1,
  "Page_size": 100
}
```

השדות `ApiPassword`, `FromDate`, `ToDate` (מחרוזות `DDMMYYYY`, כך ש-`01062026` הוא 1 ביוני 2026), `Page` (מ-1) ו-`Page_size` (10 עד 2000) כולם חובה. אין שדה `TerminalNumber`; לצמצום למסוף אחד תשתמשו ב-`LimitForTerminal`.

התגובה היא `GetTranzactionsResp`: תבדקו `ResponseCode == 0`, ואז תקראו את `Tranzactions` (מערך של `TransactionInfo`), יחד עם `Page` ו-`Page_size` שמוחזרים בחזרה. תמשיכו לבקש את העמוד הבא עד שעמוד מחזיר פחות שורות מ-`Page_size`.

נקודת הקצה `Transactions/SpecialTransactions` היא נקודת קריאה בלבד למרות השם (ראו `references/api-endpoints.md`).

### שלב 7: עסקאות מושהות

עסקה מושהית מאשרת כוונת תשלום בלי חיוב מיידי:

1. תיצרו סשן Low Profile עם `Operation: "SuspendedDeal"`.
2. ה-`LowProfileResult` מחזיר `SuspendedInfo` עם `SuspendedDealId`.
3. מחייבים אותה מאוחר יותר בלוח הבקרה של קארדקום או עם `POST /api/v11/SuspendedDeals/Charge`, שהשדות היחידים שלו (כולם חובה, `additionalProperties: false`) הם `TerminalNumber`, `ApiName` ו-`SuspendedDealID`. **שימו לב לאותיות:** אובייקט התוצאה כותב `SuspendedDealId`, הבקשה `SuspendedDealID`; תשלחו את הכתיב של הבקשה. `SuspendedDeals/Cancel` ו-`GetSuspendedDealInfo` מקבלות את אותם שלושה שדות; בקבוצה יש גם `GetSuspendedDeals` ו-`UpdateSuspendedDealInfo`.

שימושי להרשאות מראש ולשירותים שמחויבים אחרי אספקה. גם כאן חל `JValidateType`, וברירת המחדל שלו ב-`LowProfile/Create` היא `5` (J5), כך שעסקה מושהית בדרך כלל תופסת את הסכום בכרטיס: תבטלו את אלה שלא תחייבו.

### שלב 8: טיפול בשגיאות

כל endpoint שהסקיל משתמש בו מחזיר מספר שלם `ResponseCode` ומחרוזת `Description` (כמה אחרים, כמו `GetTransactionInfoById` ושאילתות `CompanyOperations`, מחזירים במקום זאת מערך או ערך בוליאני). `ResponseCode == 0` משמעו הצלחה, כל ערך שאינו אפס הוא שגיאת מפתח/עסקה ו-`Description` נושא את הסיבה הקריאה לאדם.

```python
import requests

BASE = "https://secure.cardcom.solutions/api/v11"
payload["ExternalUniqTranId"] = order_id  # same id on every retry of THIS charge

try:
    r = requests.post(f"{BASE}/Transactions/Transaction", json=payload, timeout=30)
except requests.RequestException:
    r = None  # outcome unknown: the card MAY have been charged

if r is None or r.status_code != 200:
    # Never re-charge blind. Ask Cardcom whether the charge went through.
    q = requests.post(f"{BASE}/Transactions/GetTransactionByExternalUniqTran",
                      json={"TerminalNumber": payload["TerminalNumber"],
                            "ApiName": payload["ApiName"],
                            "ExternalUniqTranId": order_id}, timeout=30)
    resp = q.json() if q.status_code == 200 else None
else:
    resp = r.json()

code = resp.get("ResponseCode") if resp else None
if code == 0:
    deal_id = resp["TranzactionId"]
elif code == 608:
    mark_for_lookup(order_id)  # id already answered: look the record up, never re-charge
else:
    log_error(f"Cardcom error {code}: {resp.get('Description') if resp else 'no response'}")
```

תמיד תבדקו גם את סטטוס ה-HTTP (200 משמעו שהבקשה התקבלה) וגם את `ResponseCode` (0 משמעו שהפעולה הצליחה). שמרו את `ApiName`/`ApiPassword` בצד השרת בלבד; אף אחת מהקריאות האלה לא רצה מ-JavaScript בדפדפן. התיעוד הרשמי בכתובת `https://secure.cardcom.solutions/Api/v11/Docs` נושא את מדריך השגיאות המספרי המלא, אל תקודדו מיפוי קבוע של קוד שגיאה להודעה, תקראו את `Description` במקום. ראו את `references/api-responses.md` לדפוס הטיפול.

## דוגמאות

### דוגמה 1: checkout לחנות מקוונת עם חשבונית
המשתמש אומר: "אני צריך לקבל תשלומים באתר המסחר האלקטרוני הישראלי שלי ולהפיק חשבוניות מס אוטומטית"
פעולות:
1. תבחרו Low Profile עם `DocumentTypeToCreate: "TaxInvoiceAndReceipt"`.
2. תיצרו את דף ה-Low Profile דרך `LowProfile/Create` עם פרטי המוצרים באובייקט `Document`.
3. תממשו handler ל-`WebHookUrl` שקורא ל-`LowProfile/GetLpResult`.
תוצאה: הלקוח משלם ומקבל אוטומטית חשבונית מס/קבלה במייל כ-PDF.

### דוגמה 2: מנוי SaaS חודשי
המשתמש אומר: "אני מפעיל מוצר SaaS, אני צריך לחייב משתמשים 149 שח בחודש ולשלוח להם חשבוניות"
פעולות:
1. תשלום ראשון: `LowProfile/Create` עם `Operation: "ChargeAndCreateToken"`.
2. תשמרו את ה-`Token`, `CardMonth`, `CardYear` מתוך `TokenInfo`.
3. cron חודשי: `Transactions/Transaction` עם הטוקן, `ExternalUniqTranId` חדש לכל מחזור חיוב, ואובייקט `Document`.
תוצאה: חיוב חוזר אוטומטי עם הפקת חשבונית חודשית.

### דוגמה 3: חשבונית עצמאית בלי תשלום
המשתמש אומר: "אני צריך להפיק חשבונית מס על העברה בנקאית שכבר קיבלתי"
פעולות:
1. תשתמשו ב-`Documents/CreateDocument` (בלי עיבוד תשלום).
2. תגדירו `DocumentTypeToCreate: "TaxInvoice"`.
3. תכללו `Name`, `TaxId`, `Products[]`, תגדירו `IsSendByEmail: true` עם מייל הלקוח.
תוצאה: חשבונית מס מופקת ונשלחת במייל בלי לעבד כרטיס אשראי.

### דוגמה 4: ביצוע החזר עם מסמך זיכוי
המשתמש אומר: "לקוח רוצה החזר על הזמנה מספר 5678, צריך גם להנפיק חשבונית זיכוי"
פעולות:
1. תקראו ל-`Transactions/RefundByTransactionId` עם `TransactionId` ו-`ApiPassword`.
2. תבדקו `ResponseCode == 0` ותקראו את `NewTranzactionId`.
3. תקראו ל-`Documents/CreateDocument` עם `DocumentTypeToCreate: "TaxInvoiceAndReceiptRefund"` ועם `DealNumbers: [{"DealNumber": <NewTranzactionId>}]`.
תוצאה: ההחזר מעובד ומסמך הזיכוי התואם מופק.

### דוגמה 5: קבלת תשלום Bit, Apple Pay ו-Google Pay
המשתמש אומר: "אני רוצה לאפשר ללקוחות לשלם גם עם Bit, Apple Pay ו-Google Pay בנוסף לכרטיס אשראי"
פעולות:
1. מפעילים כל אמצעי במסוף, ואז יוצרים את דף ה-Low Profile כרגיל.
2. מציגים את `UrlToBit` ליד טופס הכרטיס; Apple Pay ו-Google Pay מופיעים בתוך הדף (Apple Pay רק בחיובים חד-פעמיים, לא בדף שיוצר טוקן).
תוצאה: הלקוחות בוחרים אמצעי תשלום; אותו תהליך webhook.

## ספריות קהילתיות

- **@tsdiapi/cardcom** (TypeScript/Node.js), לקוח V11 קהילתי שלא נבדק על ידינו. `npm install @tsdiapi/cardcom`
- **CardCom/OpenFields-FrontEnd-React** ו-**CardCom/OpenFields-Backend-Node**, דוגמאות OpenFields רשמיות של קארדקום (קישורים למטה).

## קישורים לחומרי עזר

| משאב | כתובת |
|----------|-----|
| תיעוד API V11 (מדריך OpenAPI) | `https://secure.cardcom.solutions/Api/v11/Docs` |
| מרכז התמיכה של קארדקום | `https://support.cardcom.solutions` |
| דוגמת OpenFields ב-React | `https://github.com/CardCom/OpenFields-FrontEnd-React` |
| דוגמת OpenFields ב-Node.js | `https://github.com/CardCom/OpenFields-Backend-Node` |

## משאבים מצורפים

### חומרי עזר
- `references/api-endpoints.md`, מדריך endpoints של Cardcom REST API V11: נתיבי LowProfile, Transactions, Documents, RecuringPayments, Financial ו-CompanyOperations עם שדות הבקשה/תגובה המרכזיים שלהם. תסתכלו עליו כשאתם בונים אינטגרציות API.
- `references/api-responses.md`, דפוס התגובה `ResponseCode` + `Description` של V11, אובייקטי התגובה לכל פעולה, וזרימת הטיפול המומלצת בשגיאות. תסתכלו עליו כשאתם מדבגים קריאות API שנכשלו.
- `references/document-types.md`, ה-enum המחרוזתי `DocumentTypeToCreate`, רשימת השדות של אובייקט `Document`, וטיפול במעמ לפי חוק המס הישראלי. תסתכלו עליו כשאתם מחליטים איזה סוג מסמך להפיק.
- `references/production-checklist.md`, תנאים למנויים, סכום שורות המסמך, שחרור J5, מצב ה-webhook, אידמפוטנטיות וסודות. לקרוא לפני עלייה לאוויר.
- `references/domain-checklist.md`, רשימת הכיסוי שמולה הסקיל נבדק.

### סקריפטים
- `scripts/validate_cardcom_response.py`, מאמת תגובת API של קארדקום V11, גם `LowProfileResult` וגם תגובה שטוחה (`Transaction`, `CreateDocument`, `RefundByTransactionId`). הדגל `--expect {charge,token,document,refund,validation}` נכשל בבטחה כשהתוצאה הצפויה חסרה, `--amount` ו-`--return-value` משווים מול ההזמנה שלכם, ו-`--with-document` מכשיל חיוב שהחשבונית שלו לא הופקה. רק `ResponseCode` 0 נחשב הצלחה; הקודים 700/701 נדחים אלא אם מוסיפים `--validation-only`, כי הם אומרים שבדיקת כרטיס מסוג J2/J5 עברה ושום דבר לא חויב. קוד 608 מדווח ככפילות שנחסמה. להרצה: `python scripts/validate_cardcom_response.py --help`

## מלכודות נפוצות
- בדיקת ההצלחה ב-V11 היא `ResponseCode == 0`, לא `DealResponse == 0`. `DealResponse` לא קיים ב-V11, סוכנים שאומנו על דוגמאות קארדקום ישנות ממציאים אותו. נקודות הקצה שבסקיל מחזירות `ResponseCode` יחד עם מחרוזת `Description`.
- השדה `DocumentTypeToCreate` (באובייקטי `Document`) והשדה `DocumentType` ב-`CreateDocumentUrl` הם enum מסוג מחרוזת (`"TaxInvoiceAndReceipt"`, `"TaxInvoice"`, ...). אבל כמה נקודות קצה של מסמכים ב-V11 מקבלות סוג מסמך כמספר שלם: `CancelDoc.DocumentType`, `SendAllDocumentsToEmail.DocumentType`, `GetReport.DocType` והשדות של `CrossDocument`. המפרט לא מפרסם את המיפוי ממספר לשם, אז קחו את הערך מקארדקום (או ממסמך שכבר יש לכם) ואל תנחשו.
- ה-`TerminalNumber` חייב להישלח כמספר שלם, לא כמחרוזת. סוכנים נוטים לעטוף אותו במירכאות.
- **רשימת ה-`ApiPassword` משתנה בין גרסאות של המפרט, אז לעולם אל תענו מהזיכרון.** הסקיל הזה אמר פעם שאין `ApiPassword` ב-`Documents/ExternalShopCreateDocument`; המפרט הנוכחי מחייב אותה, ונתיב `TapTransactions` שהוא ציטט כבר לא קיים. תקראו את הסכמה של נקודת הקצה. המקרה ההפוך: `ApiPassword` אינו שדה ברמה העליונה של `LowProfile/Create` או `Transactions/Transaction`, אבל הוא כן נדרש בתוך `Advanced` / `AdvancedDefinition` כשמסמנים `IsRefund` / `IsRefundDeal` (מסלול ההחזר עם טוקן או כרטיס, כשאין `TransactionId` מקורי).
- **ה-webhook אינו מאומת.** אין שדה חתימה או סוד בשום מקום ב-`LowProfile/Create`, והשדה `WebHookUrl` הוא חובה ולא אופציונלי. כל מי שיודע את הכתובת יכול לשלוח אליה POST, ולכן היא רשאית רק להפעיל שליפת `GetLpResult` עבור `LowProfileId` שאתם יצרתם (שלב 3ב).
- נקודות הקצה לדוחות `ListTransactions` ו-`SpecialTransactions` לא מקבלות `TerminalNumber`, ואף אחת מהסכמות לא מגדירה אותו (שתיהן מסומנות `additionalProperties: false`), אז אל תשלחו אותו. תצמצמו למסוף מסוים עם `LimitForTerminal` ב-`ListTransactions`. התאריכים שלהן הם מחרוזות `DDMMYYYY`, ו-`ListTransactions` דורשת בנוסף `Page` ו-`Page_size` בטווח 10 עד 2000.
- שימו לב לאיות האמיתי של השדות ב-V11: `ISOCoinID` / `ISOCoinId`, `IsSendByEmail` (לא `SendByEmail`), `TaxId` (לא `VAT_Number`). **שדה השפה מאויית אחרת לפי אובייקט המסמך שבו אתם נמצאים, וכל סכמה מגדירה רק את הכתיב שלה (`additionalProperties: false`), כך שהכתיב האחר במקרה הטוב מתעלמים ממנו:** `Document` (בקריאת `CreateDocument` העצמאית) ו-`DocumentTran` (ב-`Transaction`) משתמשים באיות השגוי `Languge`, בעוד `DocumentLP`, המסמך שמצרפים ל-`LowProfile/Create`, משתמש באיות התקין `Language`. שימוש ב-`Languge` בכל מקום אומר ששפת המסמך ב-Low Profile לא נקבעת כפי שהתכוונתם.
- שיעור המע"מ הנוכחי בישראל הוא 18% (מינואר 2025; לפני כן הוא היה 17%, אז מסמך שמופק מחדש לתקופה קודמת צריך את השיעור שהיה בתוקף בתאריך שלו). קארדקום מחשבת מעמ בצד השרת, אז סכומי המסמך מטופלים לפי דגל `IsVatFree`.
- **היקף PCI**: Low Profile מארח שומר אתכם ב-SAQ-A. שרת-לשרת `Transaction` עם `CardNumber`/`CVV2` גולמיים נופל ל-SAQ-D. התקן הנוכחי הוא PCI DSS v4.0.1, ו-51 הדרישות הדחויות שלו בתוקף מאז 31 במרץ 2025. עדיף להישאר עם Low Profile או טוקנים אלא אם יש סיבה אמיתית לגעת בנתוני כרטיס גולמיים.
- **לוח הסליקה הכספית** נקבע ברמת המסוף, לא בכל בקשה, ולא נקבע דרך ה-API. קארדקום מפרסמת מסלולי זיכוי חודשי, שבועי ודו-חודשי (התאריכים ב-`references/api-endpoints.md`); תוודאו איזה מסלול מוגדר במסוף של בית העסק לפני שמבטיחים לו יום מסוים.

## פתרון בעיות

### שגיאה: `ResponseCode` שאינו אפס ב-`LowProfile/Create`
סיבה: בעיית אימות או ולידציה בבקשה.
פתרון: תקראו את מחרוזת ה-`Description` בתגובה, היא מציינת את הבעיה המדויקת. תוודאו ש-`TerminalNumber` הוא מספר שלם ו-`ApiName` נכון. מדריך השגיאות המספרי המלא נמצא בכתובת `https://secure.cardcom.solutions/Api/v11/Docs`.

### שגיאה: "דף Low Profile נטען אבל התשלום נכשל"
סיבה: במסוף הבדיקות, סכומים מעל 5,000 ש"ח בכרטיסי הבדיקה מדומים ככישלון (לפי עמוד הבדיקות של קארדקום). אחרת, תוצאת הכרטיס נמצאת ב-`TranzactionInfo.Description`; סיבות אחרות לא אומתו בסקיל הזה.
פתרון: בודקים מתחת ל-5,000 ש"ח, ואז קוראים את `TranzactionInfo.ResponseCode` ואת `Description` מ-`GetLpResult`. התיעוד של קארדקום מבקש כתובות redirect ו-notify חיצוניות ב-HTTPS (לא localhost), אז בפיתוח משתמשים ב-tunnel.

### שגיאה: "החזר מחזיר `ResponseCode` שאינו אפס"
סיבה: `ApiPassword` חסרה, או שהעסקה כבר הופקדה ושלחתם `CancelOnly: true`.
פתרון: תכללו `ApiPassword` בכל בקשת החזר. תשתמשו ב-`CancelOnly: true` רק לפני הפקדה, אחרי הפקדה תשלחו החזר אמיתי (תשמיטו את `CancelOnly` או תגדירו אותו `false`).

### שגיאה: "חשבונית נוצרה אבל לא נשלחה במייל"
סיבה: `IsSendByEmail` הוגדר במפורש כ-`false` (ברירת המחדל שלו היא `true`), או ש-`Email` חסר או לא תקין.
פתרון: תשאירו את `IsSendByEmail` על `true` ותכללו `Email` תקין באובייקט `Document`. תבדקו בתיקיית ספאם, קארדקום שולחת מהדומיין שלה.

### שגיאה: `ResponseCode` 608 בחיוב טוקן
סיבה: אותו `ExternalUniqTranId` כבר שימש בקריאה שקיבלה תשובה תקינה מהכרטיס, חיוב או בדיקת J2/J5 (במפרט: שליחה חוזרת של אותו ExternalUniqTranId תחזיר שגיאה 608).
פתרון: אל תחייבו שוב עם מזהה חדש. תקראו ל-`Transactions/GetTransactionByExternalUniqTran` ותחליטו לפי ה-`ResponseCode` של הרשומה: 0 אומר שהלקוח כבר חויב, 700/701 אומרים שהקריאה הקודמת הייתה רק בדיקת J2/J5.

### שגיאה: "חיוב טוקן מצליח אבל אין חשבונית"
סיבה: אובייקט `Document` חסר מבקשת ה-`Transaction`.
פתרון: תכללו את אובייקט `Document` המלא עם `DocumentTypeToCreate`, `Name` ו-`Products` בכל חיוב טוקן. הפקת מסמכים היא opt-in לכל עסקה.
