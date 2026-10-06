# מטרת כל נקודות הקצה של SUMIT, בעברית פשוטה

נבנה ב-5.10.2026 מ-`openapi/sumit.openapi.json` (זהה ל-`swagger.json`): 84 נקודות, כולן `POST`.
הסימן ✓ מציין נקודה שקוד האפליקציה קורא לה היום (10 נקודות). חלק מהתיאורים בחוזה דלים, ולכן המטרה של נקודות כאלה נאמדה משמן ומסומנת "(התיאור דל)".
מפות נלוות: [sumit-api-endpoints-by-topic-2026-10-05.md](sumit-api-endpoints-by-topic-2026-10-05.md) (שימוש בקוד לכל נקודה) ו-[sumit-crm-endpoints-map-2026-10-05.md](sumit-crm-endpoints-map-2026-10-05.md) (פירוט ה-CRM).

## הנהלת חשבונות ומסמכים (22)

- `accounting/customers/create` ✓: יוצר לקוח חדש או מוצא קיים.
- `accounting/customers/update`: מעדכן פרטי לקוח.
- `accounting/customers/getdetailsurl`: קישור לדף הלקוח ב-SUMIT.
- `accounting/customers/createremark`: מוסיף הערה לכרטיס לקוח.
- `accounting/documents/create` ✓: מפיק מסמך: חשבונית, קבלה, הצעת מחיר ועוד.
- `accounting/documents/getdetails`: פרטי מסמך אחד.
- `accounting/documents/getpdf`: מוריד מסמך כ-PDF.
- `accounting/documents/list`: רשימת מסמכים לפי תאריכים או מספרים.
- `accounting/documents/send`: שולח מסמך במייל.
- `accounting/documents/cancel`: מבטל מסמך קיים.
- `accounting/documents/movetobooks`: הופך טיוטה למסמך סופי בספרים.
- `accounting/documents/addexpense`: מוסיף הוצאה (חשבונית ספק).
- `accounting/documents/getdebt`, `getdebtreport`: חוב של לקוח, ודוח חובות של כל הלקוחות.
- `accounting/general/getvatrate`, `getexchangerate`: שיעור מע"מ בתאריך, ושער מטבע.
- `accounting/general/verifybankaccount`: בודק פרטי חשבון בנק.
- `accounting/general/getnextdocumentnumber`: המספר הבא למסמך מסוג מסוים.
- `accounting/general/setnextdocumentnumber`: קובע את המספר הבא (מסוכן, פוגע ברצף המסמכים).
- `accounting/general/updatesettings`: הגדרות הנהלת חשבונות (מייל מסמכים, רואה חשבון).
- `books/transactions/createbatch`: פקודות יומן לפי חשבונות.
- `scheduleddocuments/documents/createfromdocument`: מתזמן מסמכים מחזוריים לפי מסמך קיים (התיאור דל).

## פריטים ומלאי (3)

- `accounting/incomeitems/list`, `create`: קטלוג פריטים, רשימה ויצירה (בשלב אלפא, עלול להשתנות).
- `stock/stock/list`: כמויות מלאי (התיאור דל).

## סליקה ותשלומים (25)

- `billing/payments/charge` ✓: מחייב כרטיס אשראי.
- `billing/payments/list` ✓: רשימת תשלומים.
- `billing/payments/get`: פרטי תשלום אחד לפי מזהה.
- `billing/payments/multivendorcharge`: חיוב עבור כמה מוכרים.
- `billing/payments/beginredirect`: פותח עמוד תשלום בהפניה.
- `billing/paymentmethods/setforcustomer`, `getforcustomer`, `remove`: שמירה, קריאה ומחיקה של אמצעי תשלום שמור.
- `billing/recurring/charge`, `listforcustomer`, `update`, `cancel`, `updatesettings`: תשלומים חוזרים: יצירה, רשימה, עדכון, ביטול והגדרות.
- `billing/generalbilling/openupayterminal`, `setupaycredentials`: מסוף אשראי דרך Upay, וחיבור חשבון Upay קיים.
- `creditguy/billing/load`, `process`, `getstatus`: חיוב קבוצתי: טעינה, הרצה ובדיקת מצב (אחרי `process` אי אפשר לעצור).
- `creditguy/gateway/transaction`: עסקת אשראי ישירה, נדיר, מקבל פרטי כרטיס מלאים.
- `creditguy/gateway/gettransaction`, `getreferencenumbers`, `beginredirect`: פרטי עסקה, מספרי אסמכתא והפניה לעמוד תשלום של השער.
- `creditguy/vault/tokenize`, `tokenizesingleuse`, `tokenizesingleusejson`: הופכים פרטי כרטיס לטוקן (חד-פעמי בעיקר ל-payments.js).

## CRM ואוטומציה (17)

- `crm/schema/listfolders` ✓: רשימת התיקיות.
- `crm/views/listviews` ✓: תצוגות של תיקייה.
- `crm/data/listentities` ✓: הרשומות בתיקייה.
- `crm/schema/getfolder`: השדות של תיקייה.
- `crm/data/getentity`: רשומה אחת.
- `crm/data/createentity`, `updateentity`, `archiveentity`, `deleteentity`: יצירה, עדכון, ארכוב ומחיקה של רשומה.
- `crm/data/countentityusage`: כמה פעמים רשומה בשימוש.
- `crm/data/getentitieshtml`, `getentityprinthtml`: גרסת הדפסה או PDF.
- `triggers/triggers/subscribe` ✓, `unsubscribe` ✓: SUMIT תשלח הודעה לכתובת שלנו כשרשומה משתנה, וביטול ההרשמה.
- `deals/adddeal`, `createremark`: יוצר עסקה (ולפעמים לקוח), והערה על עסקה.
- `customerservice/tickets/create`: פותח פנייה (התיאור דל).

## הודעות ותקשורת (8): אף אחת לא בשימוש

- `emailsubscriptions/mailinglists/list`, `add`: רשימות תפוצה במייל.
- `sms/mailinglists/list`, `add`: רשימות תפוצה ב-SMS.
- `sms/sms/listsenders`, `send`, `sendmultiple`: שמות שולח, שליחת SMS ושליחה לרבים.
- `fax/fax/send`: שליחת פקס.

## אתר, חברה ומשתמשים (9)

- `website/companies/getdetails` ✓: פרטי החברה שלנו (משמש לבדיקת תקינות).
- `website/companies/listquotas`: מכסות שימוש (התיאור דל).
- `website/companies/update`: מעדכן פרטי ארגון.
- `website/companies/create`: יוצר ארגון חדש (מחזיר מפתח וסיסמה).
- `website/companies/installapplications`: מתקין יישומים, דורש אמצעי תשלום פעיל.
- `website/permissions/set`, `remove`: מוסיף ומסיר הרשאת משתמש.
- `website/users/create`, `loginredirect`: יצירת משתמש וכניסה בהפניה.

## מה מתאים לניהול מתוך KALFA

לפי שני הסוכנים שחקרו: רק פעולות צפייה: פרטי חברה ומכסות (`companies/getdetails`, `listquotas`), מסמכים וחשבוניות (`documents/getdetails`, `getpdf`, `list`), כרטיס לקוח (`customers/getdetailsurl`), וחיפוש תשלום (`payments/get`, `list`). הודעות, תשלומים חוזרים, שערי סליקה, כספת, משתמשים והרשאות אינם מתאימים. ביטול מסמך והעברה לספרים רק אחרי יועץ המס.
