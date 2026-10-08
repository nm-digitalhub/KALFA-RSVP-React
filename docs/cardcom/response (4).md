שלב 3 - חיוב של אסימון \\ תפיסת מסגרת \\ חיוב פרטי אשראי בממשק ישיר. (Do Transaction) – מרכז תמיכה למפתחים               

[דלג לתוכן העיקרי](#main-content)

 [![דף הבית במרכז התמיכה של מרכז תמיכה למפתחים](/hc/theming_assets/01JY3EYD9JHX10BHMPX3SEXP5T) מרכז תמיכה למפתחים](/hc/he "דף הבית") | [מרכז התמיכה קארדקום](https://support.cardcom.solutions/hc/he) | [ממשקים Name To Value (API 10)](https://cardcomapinametovalue.zendesk.com/hc/he)

 

מאמרים בקטגוריית המשנה הזאת

*   [קבלת Webhook מדף פרופיל נמוך ישירות לקוד](/hc/he/articles/37382816284050-%D7%A7%D7%91%D7%9C%D7%AA-Webhook-%D7%9E%D7%93%D7%A3-%D7%A4%D7%A8%D7%95%D7%A4%D7%99%D7%9C-%D7%A0%D7%9E%D7%95%D7%9A-%D7%99%D7%A9%D7%99%D7%A8%D7%95%D7%AA-%D7%9C%D7%A7%D7%95%D7%93)
*   [שלב 1+2 - יצירת דף לתשלום & שליחת בקשה לקבלת פרטי עסקה (Iframe/ Redirect)](/hc/he/articles/25264402497426-%D7%A9%D7%9C%D7%91-1-2-%D7%99%D7%A6%D7%99%D7%A8%D7%AA-%D7%93%D7%A3-%D7%9C%D7%AA%D7%A9%D7%9C%D7%95%D7%9D-%D7%A9%D7%9C%D7%99%D7%97%D7%AA-%D7%91%D7%A7%D7%A9%D7%94-%D7%9C%D7%A7%D7%91%D7%9C%D7%AA-%D7%A4%D7%A8%D7%98%D7%99-%D7%A2%D7%A1%D7%A7%D7%94-Iframe-Redirect)
*   [שלב 3 - חיוב של אסימון \\ תפיסת מסגרת \\ חיוב פרטי אשראי בממשק ישיר. (Do Transaction)](/hc/he/articles/25269208059282-%D7%A9%D7%9C%D7%91-3-%D7%97%D7%99%D7%95%D7%91-%D7%A9%D7%9C-%D7%90%D7%A1%D7%99%D7%9E%D7%95%D7%9F-%D7%AA%D7%A4%D7%99%D7%A1%D7%AA-%D7%9E%D7%A1%D7%92%D7%A8%D7%AA-%D7%97%D7%99%D7%95%D7%91-%D7%A4%D7%A8%D7%98%D7%99-%D7%90%D7%A9%D7%A8%D7%90%D7%99-%D7%91%D7%9E%D7%9E%D7%A9%D7%A7-%D7%99%D7%A9%D7%99%D7%A8-Do-Transaction)
*   [מניעת עסקאות כפולות בחיוב אסימונים](/hc/he/articles/26981976399122-%D7%9E%D7%A0%D7%99%D7%A2%D7%AA-%D7%A2%D7%A1%D7%A7%D7%90%D7%95%D7%AA-%D7%9B%D7%A4%D7%95%D7%9C%D7%95%D7%AA-%D7%91%D7%97%D7%99%D7%95%D7%91-%D7%90%D7%A1%D7%99%D7%9E%D7%95%D7%A0%D7%99%D7%9D)
*   [שחרור מסגרת אשראי MTI=420](/hc/he/articles/26984290317714-%D7%A9%D7%97%D7%A8%D7%95%D7%A8-%D7%9E%D7%A1%D7%92%D7%A8%D7%AA-%D7%90%D7%A9%D7%A8%D7%90%D7%99-MTI-420)

# שלב 3 - חיוב של אסימון \\ תפיסת מסגרת \\ חיוב פרטי אשראי בממשק ישיר. (Do Transaction)

![](https://support.cardcom.solutions/system/photos/27160828654610/קארדקום_זנדסק.png)

[דניאל.ע תמיכה קארדקום](/hc/he/profiles/19169135635474-%D7%93%D7%A0%D7%99%D7%90%D7%9C-%D7%A2-%D7%AA%D7%9E%D7%99%D7%9B%D7%94-%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)

לפני 3 חודשים עודכן

עקובאין עדיין עוקבים

## **מתי להשתמש בפונקציה זו?**

פונקציה זאת בדרך כלל תהיה בשימוש לאחר שלב 1 + 2, 

בתי עסקים שרוצים לעשות מנויים, עובדים עם אסימונים ועם תפיסות מסגרות ישתמשו בפונקציה זאת.

בנוסף, הפונקציה מיועדת לביצוע חיובים במודל של ממשק ישיר.

### מה זה "ממשק ישיר"?

ממשק ישיר מיועד למערכות סגורות ומאובטחות או לאפליקציות נייטיב (iOS / Android) סגורות. חיוב באמצעות ממשק ישיר מתבצע ללא הפניה לדף סליקה של קארדקום בתקן PCI.

חשוב לציין: מודל ממשק ישיר לא מיועד לאתרים באינטרנט (WEB). למערכות כאלה יש להשתמש במודול "פרופיל נמוך".

**בממשק ישר, בWEB חייב תקן PCI, בלי זה העסק חשוף לפריצות ולהונאות.**

**באפליקציות, תקן PCI פחות חשוב, כי פריצה לאפליקציה לא מהווה פריצה לפרטים של כל שאר הלקוחות.**

### תהליך החיוב בממשק ישיר.

במהלך העבודה עם ממשק ישיר, אין אפשרות לקבל את תקן PCI של קארדקום, ולכן יש להשיג את תקן PCI ישירות מחברת האשראי. בנוסף, אין לשמור את פרטי האשראי במערכת, אלא רק להעבירם בממשק. כמו כן, אסור לשמור את ה-CVV.

### פעולות נפוצות בפונקציה "Do Transaction".

בפונקציה "Do Transaction" ניתן לבצע את הפעולות הבאות:

*   חיוב וזיכוי של אסימונים.
*   חיוב חוזר של אסימון (הוראות קבע).
*   חיוב ושחרור של מסגרת שנתפסה בשלב הראשון.
*   חיוב באמצעות פרטי כרטיסי אשראי (ממשק ישיר).

**הערה:** **לחיוב אסימון חייב להיות מסוף ללא חובה ל-CVV בחברות האשראי,**  
**מסוף בתצורה כזו לא בודק תוקף העיקר שיהיה עתידי, לא בודק CVV, ובדיקת תעודת הזהות היא אופציונלית תלוי בהסכם מול חברת האשראי.**

#### **דרישות & מודלים נחוצים.**

מסוף ללא דרישה לCVV - בשביל מודל אסימונים.

מודל אסימונים - בשביל חיוב וזיכוי אסימון.

מודל ממשק ישיר - בשביל ביצוע עסקאות במערת סגורה IOS.

## **שלב שלוש - חיוב אסימון & חיוב פרטי אשראי - Do Transaction.**

#### **להלן קישור לפונקציה בJSON.**

שיטת בקשה POST.

[Do Transaction](https://secure.cardcom.solutions/Api/v11/Docs#tag/Transactions/operation/Transactions_Transaction)

https://secure.cardcom.solutions/api/v11/Transactions/Transaction

**להלן הפרמטרים שצרים להעביר בפונקציה Do Transaction.**

**מקרא:**

**פרמטר אדום - חובה**

**פרמטר מודגש - מומלץ**

פרמטר לא אדום ולא מודגש - אופציונלי

**מספר**

**שם פרמטר**

**ערכים אפשריים לדוגמא**

**תיאור**

1

TerminalNumber

1000

המסוף שמבצע את הפעולה. יש לקבל פרמטר זה מבית העסק. - **מספר מסוף פנימי לא שבא.**

2

ApiName

Cardcomtest26

שם משתמש ממשקים. יש לקבל פרמטר זה מבית העסק. 

3

Amount

100

הסכום לחיוב.

4

**CardNumber**

"4580280000000008"

מספר כרטיס אשראי לחיוב- נועד למודול ממשק ישיר (ללא תקן PCI)

5

**Token**

"4cf8e168-261e-4613-8d20-000332986b24"

האסימון לחיוב

6

CardExpirationMMYY

"1226"

תאריך תוקף של האסימון - חיוני

7

**CVV2**

"078"

שלוש ספרות אבטחה של הכרטיס אשראי- עובד רק עם מספר אשראי (לא טוקן)

8

**ExternalUniqTranId**

"h9rZs#4VxTp!7kLb0wUeG3zC"

מזהה עסקה ייחודי חיצוני, **חיוני** לשלוח את המזהה העסקה הייחודי שלך כדי למנוע **עסקה כפולה**. אם אותו מזהה עסקה ייחודי חיצוני יישלח שוב, תקבל קוד שגיאה 608. ראה 'ExternalUniqTranIdResponse'.

9

ExternalUniqUniqTranIdResponse

boolean - true \\ false

false - יחזיר קוד שגיאה 608 אם אותו 'ExternalUniqTranId' ישתמש שוב,

true - לא יחייב את הכרטיס, אבל יחזיר את התגובה המקורית של העסקה.

10

NumOfPayments

12

מספר תשלומים לעסקה.

11

CardOwnerInformation

אובייקט עם פרמטרים.

Phone

"0522222222"

\---------------------------------

FullName

"דניאל טסט"

\---------------------------------

IdentityNumber

"321654987"

\---------------------------------

CardOwnerEmail

"test@gmail.com"

\---------------------------------

AvsZip

"string"

\---------------------------------

AvsAddress

"string"

\---------------------------------

AvsCity

"string"

Phone

מספר טלפון של הלקוח.

\---------------------------------

FullName

שם הלקוח.

\---------------------------------

IdentityNumber

מספר תעודת זהות של הלקוח.

\---------------------------------

CardOwnerEmail

האימייל של הלקוח.

\---------------------------------

AvsZip

AVS פעיל רק ק מסופי EMV .( מסוף EMV – כול המסופים שנפתחו משנת 9.2017 והלאה, אחרת יש לבדוק מול התמיכה של קארדקום לביצוע הסבה.)

מיקוד הלקוח.

\---------------------------------

AvsAddress

AVS פעיל רק ק מסופי EMV .( מסוף EMV – כול המסופים שנפתחו משנת 9.2017 והלאה, אחרת יש לבדוק מול התמיכה של קארדקום לביצוע הסבה.)

כתובת הלקוח.

\---------------------------------

AvsCity

AVS פעיל רק ק מסופי EMV .( מסוף EMV – כול המסופים שנפתחו משנת 9.2017 והלאה, אחרת יש לבדוק מול התמיכה של קארדקום לביצוע הסבה.)

עיר הלקוח.

12

ISOCoinId

1 - שקל

2 - דולר

לקודי מטבע נוספים - [רשימת קודי מטבעות](https://cardcomapinametovalue.zendesk.com/hc/he/articles/27007815744402-%D7%A8%D7%A9%D7%99%D7%9E%D7%AA-%D7%A7%D7%95%D7%93%D7%99-%D7%9E%D7%98%D7%91%D7%A2%D7%95%D7%AA-Currency-code-list)

מטבע לחיוב העסקה.

13

CustomFields

מערך עם אובייקטים בתוכו.

Id (integer) - 1

Value (string) - "ערך לדוגמא"

שדות מותאמות אישית. מצוין אם רוצים להעביר מידע נוסף של עסקה הלאה לצורך דיווחים ולצורך איסוף מידע.

Id - המספר המזהה של השדה מותאם אישית

Value - הערך של השדה המותאם אישית

זה מע��ך שבתוכו יש אובייקטים.

**ערכים של אובייקט Advanced (14).**

**פרמטר אדום - חובה**

**פרמטר מודגש - מומלץ**

פרמטר לא אדום ולא מודגש - אופציונלי

**מספר**

**שם פרמטר**

**ערכים אפשריים לדוגמא**

**תיאור**

1

ApiPassword

"kzFKfohEvL6AOF8aMEJz"

סיסמת API, מיועד לזיכוי וביטול עסקאות.

2

**IsRefund**

boolean - true \\ false

האם זו הייתה עסקה זיכוי

3

ISOCoinName

ILS \\ USD \\ EUR

המקביל לפרמטר ISOCoinId, בפרמטר הזה מקבלים את השם מטבע ולא את המספר מטבע.

4

**JValidateType**

(integer) - 2 \\ 5

איזו סוג פעולה לעשות על הפרטי אשראי \\ אסימון.

2 - J2 האם לעשות בדיקת כרטיס בלבד.

5 - J5 האם לעשות תפיסת מסגרת ובדיקת אשראי.

5

SapakMutav

(string) \\ 1234

מספר לקוח בעבודה ברב מוטב

6

CreditType

1 - חיוב רגיל

6 - קרדיט בתשלומים  
במידה ולא מעבירים את הפרמטר אז מבוצע חיוב רגיל או תשלומים רגילים

**שים לב!  
1\. חברות האשראי מגבילות את מספר התשלומים למינימום 3.  
במקרה זה אנו מסדרים את מספר התשלומים למינימום 3 באופן אוטומטי.  
2\. חברות האשראי מגבילות את הסכום המינימלי לחיוב עסקאות קרדיט. יש לדאוג להעביר סכום מתאים. במקרה זה הלקוח יועבר לדף כישלון.**

7

**MTI**

420 (ערך קבוע)

פרמטר לשחרור מסגרת אשראי. דרוש להעביר אתו את המספר אישור, שזה מספר העסקה בקארדקום של התפיסת מסגרת בפועל. (**ApprovalNumber)**

8

AccountIdToGetCardNumber

123

לשים בערך של הפרמטר את הערך של AccountID (מזהה כרטיס לקוח)

ייתן את מספר הכרטיס ותאריך התפוגה מהחשבון, אם אתה צריך את המידע על החשבון עבור החשבונית, עליך לשלוח את מזהה החשבון באובייקט המסמך: Document.AdvancedDefinition.AccountID ו-Document.AdvancedDefinition.IsLoadInfoFromAccountID=true.

9

**ApprovalNumber**

12345

מספר אישור **חד פעמי** שמתקבל בעת יצירת אסימון עם בדיקה מסוג J5 בשלב 1.  
במקרה ורוצים לחייב תפיסת מסגרת שנעשתה בשלב, צריך להעביר את מספר אישור זה, ביחד עם הטוקן והסכום לחיוב.

10

FirstPayment

50

אופציונאלי - סכום תשלום ראשון בתשלומים לב! הסכומים הם באגורות - ראה הערה בסוף הטבלה

11

ConstPayment

20

אופציונאלי - סכום שאר התשלומים לב! הסכומים הם באגורות - ראה הערה בסוף הטבלה

12

IsAutoRecurringPayment

boolean - true \\ false

כאשר TRUE, הסוג חיוב בממשק יהפוך להיות סוג חיוב הוראת קבע במקום פרופיל נמוך - אך זה לא יקים הוראת קבע.

נועד בעיקר למוחלפים, בשביל שיהיה עליו סוג חיוב הוראת קבע, והכרטיס יכנס לשירות מוחלפים.

יש להעביר פרמטר זה כ true  רק כאשר המסוף מוגדר **מסוף הוראת קבע בחברת** **האשראי** ו ש.ב.א.  
ראו סוגים :[סוגי מסופים מול חברות האשראי](https://support.cardcom.solutions/hc/he/articles/360002653654?source=search&auth_token=REDACTED)

אם המסוף מוגדר טלפוני/ רגיל ללא CVV   
אין להעביר פרמטר זה.  
  
מסוף הו"ק נועד אם רוצים לקבל קובץ **מוחלפים** מחברות האשראי .והעסקאות יוצגו למחזיק הכרטיס כ עסקת הוראת קבע . [עדכון קובץ מוחלפים מחברת האשראי  
  
](http://kb.cardcom.co.il/article/AA-00473)

אין הגבלה בסוג הכרטיס בשימוש בהוראת קבע , המערכת מזהה את סוג הכרטיס ופועלת בהתאם.( כרטיס דואר , חיוב מיידי וכו)

13

IsCreateToken

boolean - true \\ false

האם ליצור אסימון מפרטי האשראי? 

14

SendNote

boolean - true \\ false

האם לשלוח פתקית של העסקה שבוצעה. 

**ערכים של אובייקט Document (15).**

**\*\*דגש חשוב! אמנם מערך של products הוא לא חובה אך בלעדיו לא יופק המסמך ולכן מסומן כמומלץ**

**פרמטר אדום - חובה**

**פרמטר מודגש - מומלץ**

פרמטר לא אדום ולא מודגש - אופציונלי

**מספר**

**שם פרמטר**

**ערכים אפשריים לדוגמא**

**תיאור**

1

**DocumentTypeToCreate**

"Auto" - אוטומטי, לפי מה שיש בהגדרות 3->4.

"TaxInvoiceAndReceipt" – חשבונית מס וקבלה

"TaxInvoiceAndReceiptRefund" – חשבונית זיכוי והחזר כספים

"Receipt" – קבלה מלכ''ר

"ReceiptRefund" – קבלה מלכ"ר זיכוי ( החזר כספים)

"Quote" – הצעת מחיר

"Order" – הזמנה

"OrderConfirmation" – אישור הזמנה - מאתר

"OrderConfirmationRefund" – זיכוי אישור הזמנה - מאתר

"DeliveryNote" – תעודת משלוח

"DeliveryNoteRefund" – תעודת החזרה

"ProformaInvoice" – חשבון עסקה

"DemandForPayment" – דרישה לתשלום

"DemandForPaymentRefund" – ביטול דרישה לתשלום

"ProformaDealInvoice" – חשבון קבלה פרופורמה

"ProformaDealInvoiceRefund" –חשבון קבלה זיכוי

"TaxInvoice" – חשבונית מס

"ProformaInvoiceRefund" – זיכוי חשבון עסקה

"TaxInvoiceRefund" – חשבונית מס זיכוי

"ReceiptForTaxInvoice" – קבלה (לחשבונית)

"DonationReceipt" – קבלה על תרומה

"DonationReceiptRefund" – זיכוי קבלה תרומה (החזר כספים)

"ReceiptForTaxInvoiceRefund" – החזר כספים לקוחות (קבלה זיכוי) 

סוג המסמך להפקה.

2

Name

"מר טסט"

שם הלקוח.

3

TaxId

040617640

מספר ת.ז. או ח.פ חברה

**4**

**Email**

israel@gmail.com

כתובת דואר הלקוח , שלשם ישלח המסמך. (ניתן לשרשר כמה מיילים באמצעות נקודה פסיק ; )

5

IsSendByEmail

true \\ false

האם לשלוח מסמך בדואר אלקטרוני.

6

AddressLine1

"Saharov 22"

כתובת לקוח , שורה ראשונה.

7

AddressLine2

"P.O. 1234"

כתובת לקוח, שורה שנייה.

8

City

Reshin-Le-Zion

עיר

9

Mobile

03-9619611

טלפון קווי

10

Phone

0549876543

טלפון נייד (במודול SMS ישלח SMS לנייד זה)

11

Comments

דוגמא: אחריות של שנה מיום החשבונית (עד 250 תווים )

הערות למסמך - יודפסו במסמך למטה

12

IsVatFree

true = מע"מ 0  
False = מע"מ 18

האם המסמך כולו הוא ללא מע"מ - מתאים ללקוח חו"ל

13

DepartmentId

123  (int)

**קוד מחלקה** להצגה בדוחות והעברה להנח"ש  
ראה הגדרת המחלקות במסוף : [מיון מסמכים ושימוש במחלקות](https://support.cardcom.solutions/hc/he/search/click?data=BAh7CzoHaWRsKwhmuiDTUwA6D2FjY291bnRfaWRpA572IToJdHlwZUkiDGFydGljbGUGOgZFVDoIdXJsSSIBy2h0dHBzOi8vc3VwcG9ydC5jYXJkY29tLnNvbHV0aW9ucy9oYy9oZS9hcnRpY2xlcy8zNjAwMjQ0MjMwMTQtJUQ3JTlFJUQ3JTk5JUQ3JTk1JUQ3JTlGLSVENyU5RSVENyVBMSVENyU5RSVENyU5QiVENyU5OSVENyU5RC0lRDclOTUlRDclQTklRDclOTklRDclOUUlRDclOTUlRDclQTktJUQ3JTkxJUQ3JTlFJUQ3JTk3JUQ3JTlDJUQ3JUE3JUQ3JTk1JUQ3JUFBBjsIVDoOc2VhcmNoX2lkSSIpMGI0NjAzNzktZjAyMy00N2IwLTg3NDgtZDdlN2FkODQ5ZDk4BjsIRjoJcmFua2kH--457d9e136b5126e2ab7112b31cb922f5dcfd07c6)

14

**AdvancedDefinition**

אובייקט עם פרמטרים בתוכו.

IsAutoCreateUpdateAccount (bool) -

**false** \- כל הלקוחות ירשמו על "לקוחות שונים".  
  
**true** \- יפתח כרטיס לקוח לכל עסקה , ומידה וקים יבוצע שיוך ללקוח לפי ההסבר.

 ------------------------------

AccountForeignKey (string) - לדוגמא 300

 ------------------------------

SiteUniqueId (string) 

 ------------------------------

AccountID (integer) - 123

 ------------------------------

IsLoadInfoFromAccountID (boolean) - true \\ false

**IsAutoCreateUpdateAccount (bool) -**

האם ליצור ללקוח כרטיס לקוח במערכת.  
**מצב זה חובה להעביר את פרמטר**: **InvoiceHead.CompID** - **ת.ז. / ח.פ.** של הלקוח.  
אם הלקוח כבר קיים **לא** יפתח כרטיס חדש.

במידה ולא מועבר יתבצע איתור לפי  **מפתח זר** ולאחר מכן לפי **מזהה ייחודי אתר** ואז לפי  **EMAIL** לקוח. (הפרמטר הראשון שנמצע בשרת מוצלב ולא ממשיך לחפש עוד )

 ------------------------------

AccountForeignKey (string)  - 

מספר מפתח זר של הלקוח - פעיל רק אם יוצר ללקוח כרטיס לקוח. (מספר הנח"ש)

 ------------------------------

SiteUniqueId (string) -

 **מזהה ייחודי לאתר** - פרמטר אינפורמטיבי.

**(מזהה נוסף)**

 ------------------------------

**AccountID (integer) - 123 -** מספר הלקוח במערכת אישורית זהב לשיוך המסמך  
(לא פעיל בעסקה מושהית )

 ------------------------------

IsLoadInfoFromAccountID (boolean) - אם יש AccountID. אפשר לקחת מהכרטיס לקוח שמשויך למספר לקוח את הנתונים ולהכניס אותם למסמך.

15

**Products**

מערך עם אובייקטים בתוכו.

ProductID (string) - ZZASA AASSA - 12

 ------------------------------

Description (string) - קורס אינטרנטי

 ------------------------------

Quantity (integer) - 2

 ------------------------------

UnitCost (integer) - 50.57

 ------------------------------

TotalLineCost (integer) - 51

 ------------------------------

IsVatFree (boolean) - true \\ false

ProductID (string) -

קוד פריט , מק"ט , קוד מוצר  - מומלץ להעביר לשם דוחות , ניתן לראות ב [דוח פריטים במסמך](https://secure.cardcom.solutions/ReportsInv/InvItems.aspx)

במקרה של שני פריטים ניתן להפריד כך:

InvoiceLines1.ProductID=AAA

InvoiceLines2.ProductID=BBB

 ------------------------------

**Description (string) -** תיאור המוצר

 ------------------------------

Quantity (integer) - 

כמות הפריטים  
בהעברה של כמות מעל 1 , יש להכפיל במחיר ולשלוח אמצעי תשלום מתאים.

 ------------------------------

**UnitCost (integer) -** מחיר יחידה.

 -----------------------------**TotalLineCost (integer)**\- מומלץ במקרה וכמות המוצרים הוא מספר לא שלם. זה יכול למנוע בעיות עיגול מחיר.

 -----------------------------

**IsVatFree (boolean)** - האם המוצר הזה יהיה עם מע''מ או בלי מע''מ.

16

ExternalId

(String)

 מזהה מערכת חיצוני ברמת מסמך בלבד  
(לא נשמר ברמת כרטיס לקוח)

17

ManualNumber

585177

מספור ידני של המסמך. ניתן לשימוש רק ביצירת מסמך ללא חיוב. יש לבקש הרשאה מיוחדת לשימוש בפרמטר זה. ראה הערות בסוף המאמר.

במקרים נדירים ניתן להעביר את מספר החשבוניות שהמערכת תיצור במקום להשתמש במונה הפנימי של המערכת. שם לב! במידה וישנה התנגשות במונים החשבונית לא תיוצר , יש לבקש הרשאה מיוחדת לשימוש בפרמטר זה.

18

DocumentDateDDMMYYYY

"05/03/2025"

תאריך הפקת מסמך.

19

ValueDate

"12/03/2025"

תאריך ערך של המסמך (נועד להפקדות יומן)

20

Languge

"he" \\ "en"

שפת מסמך

21

IsSendSMS

boolean - true \\ false

האם לשלוח את המסמך בסמס? (דורש מודל סמס)

**RESPONSE של Do Transaction.**

לאחר ששולחים POST לפונקציה זאת יתקבלו הערכים הבאים בRESPONSE:

**מספר**

**שם פרמטר**

**ערכים אפשריים לדוגמא**

**תיאור**

1

ResponseCode

0

**0 - הפעולה תקינה  
,אחרת שגוי - שגיאת פיתוח.**

2

Description

"העסקה בוצעה בהצלחה"

תיאור התשובה , במידה ומתקבל תשובה שונה, העסקה לא בוצעה בהצלחה.

3

TranzactionId

654354685

מספר ייחודי של עסקה שבוצעה בעת חיוב אשראי.  
גודל התשובה יכול להיות Int64/ BigInt

4

TerminalNumber

1001

מספר מסוף

5

Amount

100.50

הסכום לחיוב.

6

CoinId

1 - שקל

2 - דולר

לקודי מטבע נוספים - [רשימת קודי מטבעות](https://support.cardcom.solutions/hc/he/articles/360020404379-%D7%A8%D7%A9%D7%99%D7%9E%D7%AA-%D7%A7%D7%95%D7%93%D7%99-%D7%9E%D7%98%D7%91%D7%A2%D7%95%D7%AA-Currency-code-list)

מטבע לחיוב העסקה.

7

CouponNumber

38022395

מספר שובר של הפתקית. לפעמים יכול לשמש להתאמות

8

CreateDate

"2025-03-12T08:46:45"

תאריך יצירת עסקה

9

Last4CardDigits

5796

ארבע ספרות אחרונות של אשראי

INT

10

Last4CardDigitsString

"5796"

ארבע ספרות אחרונות של אשראי

string

12

FirstCardDigits

440066

שש ספרות ראשונות.

13

JParameter

*   0 - ברירת מחדל לפי הגדרות חברות האשראי.
*   2 - בדיקה בלבד של ספרת ביקורת
*   5 - קבלת אישור מול חברות האשראי

J- פרמטר , סוג בדיקה לביצוע על הכרטיס

14

CardMonth

12

חודש כרטיס

15

CardYear

2021

שנת כרטיס

16

**ApprovalNumber**

009491B

מספר אישור. חיוני במקרה של J5. אם יש J5 והבית עסק ירצה לחייב מאוחר יותר את מסגרת התפוסה, **המספר אישור**, יהיה חיוני לחיוב המסגרת.

17

FirstPaymentAmount

50.00

סכום תשלום הראשון

18

ConstPaymentAmount

20.00

 סכום מספר התשלומים הנוספים

19

NumberOfPayments

5

 מספר התשלומים

20

CardInfo

"Israeli" "NonIsraeli" "FuelCard" "ImmediateChargeCard" "GiftCard"

סוג הכרטיס

21

CardOwnerName

"daniel"

שם בעל הכרטיס

22

CardOwnerPhone

"0522222222"

מספר טלפון של בעל הכרטיס

23

CardOwnerEmail

"test@gmail.com"

אימייל בעל הכרטיס

24

CardOwnerIdentityNumber

"213654987"

מספר תעודת זהות

25

Token

"4cf8e168-261e-4613-8d20-000332986b24"

��ספר האסימון, חוה לשמור בבסיס הנתונים.

26

CardName

"ויזה רגיל"

שם כרטיס

27

SapakMutav

1234

מספר לקוח בעבודה ברב מוטב

28

Uid

"21121517002429612920744"

מזהה עסקה יחודי.

אם עושים זיכוי \\ חיוב מחוץ לעסקה, למשל כעסקה חדשה עם אסימון, הUID יהיה חדש ושונה מהעסקה המקורית.

29

ConcentrationNumber

מספר ריכוז.

מספר הפקדה / ריכוז

30

DocumentNumber

300394

מספר מסמך

31

DocumentType

"Auto" - אוטומטי, לפי מה שיש בהגדרות 3->4.

"TaxInvoiceAndReceipt" – חשבונית מס וקבלה

"TaxInvoiceAndReceiptRefund" – חשבונית זיכוי והחזר כספים

"Receipt" – קבלה מלכ''ר

"ReceiptRefund" – קבלה מלכ"ר זיכוי ( החזר כספים)

"Quote" – הצעת מחיר

"Order" – הזמנה

"OrderConfirmation" – אישור הזמנה - מאתר

"OrderConfirmationRefund" – זיכוי אישור הזמנה - מאתר

"DeliveryNote" – תעודת משלוח

"DeliveryNoteRefund" – תעודת החזרה

"ProformaInvoice" – חשבון עסקה

"DemandForPayment" – דרישה לתשלום

"DemandForPaymentRefund" – ביטול דרישה לתשלום

"ProformaDealInvoice" – חשבון קבלה פרופורמה

"ProformaDealInvoiceRefund" –חשבון קבלה זיכוי

"TaxInvoice" – חשבונית מס

"ProformaInvoiceRefund" – זיכוי חשבון עסקה

"TaxInvoiceRefund" – חשבונית מס זיכוי

"ReceiptForTaxInvoice" – קבלה (לחשבונית)

"DonationReceipt" – קבלה על תרומה

"DonationReceiptRefund" – זיכוי קבלה תרומה (החזר כספים)

"ReceiptForTaxInvoiceRefund" – החזר כספים לקוחות (קבלה זיכוי) 

סוג מסמך

32

Rrn

"500301575449"

מספר זיהוי אצל חברות האשראי

33

Brand

"PrivateCard" "MasterCard" "Visa" "Maestro" "AmericanExpress" "Isracard" "JBC" "Discover" "Diners"

מותג כרטיס

34

Acquire

"Unknown" "Isracard" "CAL" "Diners" "AmericanExpress" "Laumicard" "CardCom" "PayPal" "Upay" "PayMe"

חברה סולקת 

35

Issuer

"NonIsrael" "Isracard" "CAL" "Diners" "AmericanExpress" "JCB" "Laumicard"

חברה מנפיקה

36

PaymentType

"Unknown" "Standard" "SpecialCredits" "ImmediateCharge" "CreditClub" "SuperCredit" "InstallmentCredit" "Payments" "ClubPatments"

סוג אשראי - חיוב רגיל \\ תשלום \\ קרדיט \\ ניכיון

37

CardNumberEntryMode

"MagneticStip" "SelfService" "GasStationSelfService" "Contactless" "EmvContactless" "MobileContactless" "EmvMobileContactless" "MobileNumber" "Emv" "Phone" "SignatureOnly" "Internet" "Fallback" "EmptyCandidateList"

מקור עסקה - אינטרנטית \\ EMV \\ טלפונית...

38

DealType

"Information" "Debit" "Discharge" "ForcedCharge" "CashBack" "CashTransaction" "Recurring" "BalanceQuery" "Cancel" "Refund" "Recharge"

סוג + מקור עסקה - ביטול \\  חיוב \\ הוראת קבע \\ זיכוי

39

IsRefund

boolean - true \\ false

האם זו הייתה עסקה זיכוי

40

DocumentUrl

נותן את הURL של המסמך

נותן את הURL של המסמך

41

CustomFields 

מערך של אובייקטים.

Id - 20

Value - "value" 

הערכים של השדות המותאמים אישית.

42

IsAbroadCard

boolean (true\\false)

האם הכרטיס הוא כרטיס מחו''ל?

## **להלן קודים לדוגמא על השתמשות באסימונים.**

**חיוב אסימון שנוצר בשלב 1:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"Token": "4cf8e168-261e-4613-8d20-000332986b24",
"CardExpirationMMYY": "0628",
"ExternalUniqTranId": "h7rZ3#קV3Tp!7kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1
}
```

**חיוב אסימון שנוצר בשלב 1 והפקת מסמך:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"Token": "4cf8e168-261e-4613-8d20-000332986b24",
"CardExpirationMMYY": "0628",
"ExternalUniqTranId": "h7rZ3#קV3Tp!7kL-b0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1,
"Document": {
"DocumentTypeToCreate": "TaxInvoiceAndReceipt",
"Name": "תעבוד",
"TaxId": "040617640",
"Email": "test@gmail.com",
"IsSendByEmail": false,
"IsVatFree": false,
"Products": [
{
"Description": "hey",
"Quantity": 1,
"UnitCost": 200
}
]
}
}
```

**חיוב מסגרת שנתפסה בשלב 1:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"Token": "4cf8e168-261e-4613-8d20-000332986b24",
"CardExpirationMMYY": "1225",
"ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1,
"Advanced": {
"ApprovalNumber": 204394904
}
}
```

**חיוב מסגרת שנתפסה בשלב 1 והפקת מסמך:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"Token": "4cf8e168-261e-4613-8d20-000332986b24",
"CardExpirationMMYY": "1225",
"ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1,
"Advanced": {
"ApprovalNumber": 204394904
},
"Document": {
"DocumentTypeToCreate": "TaxInvoiceAndReceipt",
"Name": "תעבוד",
"TaxId": "040617640",
"Email": "test@gmail.com",
"Products": [
{
"Description": "hey",
"Quantity": 1,
"UnitCost": 30
}
]
}
}
```

**שחרור מסגרת שנתפסה בשלב 1:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"Token": "4cf8e168-261e-4613-8d20-000332986b24",
"CardExpirationMMYY": "1225",
"ExternalUniqTranId": "h7rZ3#קV3Tp4!76-kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1,
"Advanced": {
"ApprovalNumber": 204394904,
"MTI": 420
}
}
```

**חיוב אשראי (ממשק ישיר):**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"CardNumber": "4580000000000000",
"CardExpirationMMYY": "0628",
"CVV2": "569",
"ExternalUniqTranId": "h7rZs#4V3Tp!7kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1
}
```

**חיוב אשראי והפקת מסמך:**

```auto
{
"TerminalNumber": 1001,
"ApiName": "test2025",
"Amount": 200,
"CardNumber": "4580000000000000",
"CardExpirationMMYY": "0628",
"CVV2": "569",
"ExternalUniqTranId": "h7rZs#4V3Tp!7kLb0wUeG3zC",
"ExternalUniqUniqTranIdResponse": false,
"NumOfPayments": 1,
"Document": {
"DocumentTypeToCreate": "TaxInvoiceAndReceipt",
"Name": "בדיקה",
"TaxId": "040617640",
"Email": "t@t.com",
"IsSendByEmail": false,
"IsVatFree": false,
"Products": [
{
"Description": "מוצר בדיקה",
"Quantity": 1,
"UnitCost": 200
}
]
}
}
```

## מאמרים קשורים

*   [שלב 1+2 - יצירת דף לתשלום & שליחת בקשה לקבלת פרטי עסקה (Iframe/ Redirect)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJJ%2FvFP6FjoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCJKNK3L7FjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSICHwEvaGMvaGUvYXJ0aWNsZXMvMjUyNjQ0MDI0OTc0MjYtJUQ3JUE5JUQ3JTlDJUQ3JTkxLTEtMi0lRDclOTklRDclQTYlRDclOTklRDclQTglRDclQUEtJUQ3JTkzJUQ3JUEzLSVENyU5QyVENyVBQSVENyVBOSVENyU5QyVENyU5NSVENyU5RC0lRDclQTklRDclOUMlRDclOTklRDclOTclRDclQUEtJUQ3JTkxJUQ3JUE3JUQ3JUE5JUQ3JTk0LSVENyU5QyVENyVBNyVENyU5MSVENyU5QyVENyVBQS0lRDclQTQlRDclQTglRDclOTglRDclOTktJUQ3JUEyJUQ3JUExJUQ3JUE3JUQ3JTk0LUlmcmFtZS1SZWRpcmVjdAY7CFQ6CXJhbmtpBg%3D%3D--ab3eb900d7060dfc34b6059c1469964eee86fff8)
*   [מניעת עסקאות כפולות בחיוב אסימונים](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCBJdHjuKGDoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCJKNK3L7FjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIB1y9oYy9oZS9hcnRpY2xlcy8yNjk4MTk3NjM5OTEyMi0lRDclOUUlRDclQTAlRDclOTklRDclQTIlRDclQUEtJUQ3JUEyJUQ3JUExJUQ3JUE3JUQ3JTkwJUQ3JTk1JUQ3JUFBLSVENyU5QiVENyVBNCVENyU5NSVENyU5QyVENyU5NSVENyVBQS0lRDclOTElRDclOTclRDclOTklRDclOTUlRDclOTEtJUQ3JTkwJUQ3JUExJUQ3JTk5JUQ3JTlFJUQ3JTk1JUQ3JUEwJUQ3JTk5JUQ3JTlEBjsIVDoJcmFua2kH--934d35f71175664c1698917448c92db036096148)
*   [Step 1+2 – Creating a payment page & sending a request to retrieve transaction details (Iframe/Redirect)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJLkBZ3fGToYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCJKNK3L7FjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIBgS9oYy9oZS9hcnRpY2xlcy8yODQ0ODIwMjgxMDUxNC1TdGVwLTEtMi1DcmVhdGluZy1hLXBheW1lbnQtcGFnZS1zZW5kaW5nLWEtcmVxdWVzdC10by1yZXRyaWV2ZS10cmFuc2FjdGlvbi1kZXRhaWxzLUlmcmFtZS1SZWRpcmVjdAY7CFQ6CXJhbmtpCA%3D%3D--aa562ba0dc7490880615c381bda7fd346aa4f268)
*   [ממשק Api JSON + SWAGGER](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCBL8ygmLGDoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCJKNK3L7FjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSJNL2hjL2hlL2FydGljbGVzLzI2OTg1NDQzODE4NTE0LSVENyU5RSVENyU5RSVENyVBOSVENyVBNy1BcGktSlNPTi1TV0FHR0VSBjsIVDoJcmFua2kJ--f22e23453ae9aff7f1f071d77b7fb4928eead711)
*   [רשימת עסקאות (List of Transactions)](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJKYI%2FonFzoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCJKNK3L7FjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSJ8L2hjL2hlL2FydGljbGVzLzI1NDYwNDY3ODAwMjEwLSVENyVBOCVENyVBOSVENyU5OSVENyU5RSVENyVBQS0lRDclQTIlRDclQTElRDclQTclRDclOTAlRDclOTUlRDclQUEtTGlzdC1vZi1UcmFuc2FjdGlvbnMGOwhUOglyYW5raQo%3D--84c88be00ca50e59f5b3d97f4fc0c12b60623747)

## הערות

0 הערות

[היכנס למערכת](https://cardcomsupporthelp.zendesk.com/access?locale=he&brand_id=25139821419794&return_to=https%3A%2F%2Fcardcomapi.zendesk.com%2Fhc%2Fhe%2Farticles%2F25269208059282-%25D7%25A9%25D7%259C%25D7%2591-3-%25D7%2597%25D7%2599%25D7%2595%25D7%2591-%25D7%25A9%25D7%259C-%25D7%2590%25D7%25A1%25D7%2599%25D7%259E%25D7%2595%25D7%259F-%25D7%25AA%25D7%25A4%25D7%2599%25D7%25A1%25D7%25AA-%25D7%259E%25D7%25A1%25D7%2592%25D7%25A8%25D7%25AA-%25D7%2597%25D7%2599%25D7%2595%25D7%2591-%25D7%25A4%25D7%25A8%25D7%2598%25D7%2599-%25D7%2590%25D7%25A9%25D7%25A8%25D7%2590%25D7%2599-%25D7%2591%25D7%259E%25D7%259E%25D7%25A9%25D7%25A7-%25D7%2599%25D7%25A9%25D7%2599%25D7%25A8-Do-Transaction) כדי להגיב.

[מופעל על ידי Zendesk](https://www.zendesk.com/service/help-center/?utm_source=helpcenter&utm_medium=poweredbyzendesk&utm_campaign=text&utm_content=%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)