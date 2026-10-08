OPEN FIELDS – מרכז התמיכה קארדקום               

[דלג לתוכן העיקרי](#main-content)

[מרכז התמיכה קארדקום](/hc/he "דף הבית") | [מרכז תמיכה למפתחים](https://cardcomapi.zendesk.com/hc/he) | [ממשקים ישן API - Name To Value](https://cardcomapinametovalue.zendesk.com/hc/he)

 

מאמרים בקטגוריית המשנה הזאת

*   [העברה לחשבון בנק מהארנק הדיגיטלי](/hc/he/articles/38950284269458-%D7%94%D7%A2%D7%91%D7%A8%D7%94-%D7%9C%D7%97%D7%A9%D7%91%D7%95%D7%9F-%D7%91%D7%A0%D7%A7-%D7%9E%D7%94%D7%90%D7%A8%D7%A0%D7%A7-%D7%94%D7%93%D7%99%D7%92%D7%99%D7%98%D7%9C%D7%99)
*   [ארנק דיגיטלי](/hc/he/articles/35044025113106-%D7%90%D7%A8%D7%A0%D7%A7-%D7%93%D7%99%D7%92%D7%99%D7%98%D7%9C%D7%99)
*   [OPEN FIELDS](/hc/he/articles/28681992826898-OPEN-FIELDS)
*   [פרופיל נמוך : עיצוב דף מותאם אישית ( גרסה 5) CSS/HTML](/hc/he/articles/27877005167634-%D7%A4%D7%A8%D7%95%D7%A4%D7%99%D7%9C-%D7%A0%D7%9E%D7%95%D7%9A-%D7%A2%D7%99%D7%A6%D7%95%D7%91-%D7%93%D7%A3-%D7%9E%D7%95%D7%AA%D7%90%D7%9D-%D7%90%D7%99%D7%A9%D7%99%D7%AA-%D7%92%D7%A8%D7%A1%D7%94-5-CSS-HTML)
*   [ריכוז ממשקי דיווחים מ קארדקום לשרתי צד ג' - webhook (וובהוק)](/hc/he/articles/27875111757970-%D7%A8%D7%99%D7%9B%D7%95%D7%96-%D7%9E%D7%9E%D7%A9%D7%A7%D7%99-%D7%93%D7%99%D7%95%D7%95%D7%97%D7%99%D7%9D-%D7%9E-%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D-%D7%9C%D7%A9%D7%A8%D7%AA%D7%99-%D7%A6%D7%93-%D7%92-webhook-%D7%95%D7%95%D7%91%D7%94%D7%95%D7%A7)
*   [ממשקי API - אתרי עזרה חדשים לNAME TO VALUE & JSON.](/hc/he/articles/27505861461778-%D7%9E%D7%9E%D7%A9%D7%A7%D7%99-API-%D7%90%D7%AA%D7%A8%D7%99-%D7%A2%D7%96%D7%A8%D7%94-%D7%97%D7%93%D7%A9%D7%99%D7%9D-%D7%9CNAME-TO-VALUE-JSON)
*   [הסבר דוח פעילות פרופיל נמוך (למתכנת)](/hc/he/articles/360007215473-%D7%94%D7%A1%D7%91%D7%A8-%D7%93%D7%95%D7%97-%D7%A4%D7%A2%D7%99%D7%9C%D7%95%D7%AA-%D7%A4%D7%A8%D7%95%D7%A4%D7%99%D7%9C-%D7%A0%D7%9E%D7%95%D7%9A-%D7%9C%D7%9E%D7%AA%D7%9B%D7%A0%D7%AA)

OPEN FIELDS
===========

[דניאל.ע תמיכה קארדקום](/hc/he/profiles/19169135635474-%D7%93%D7%A0%D7%99%D7%90%D7%9C-%D7%A2-%D7%AA%D7%9E%D7%99%D7%9B%D7%94-%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)

לפני 5 חודשים עודכן

עקובאין עדיין עוקבים

קוד לדוגמא - צד לקוח  
[https://github.com/CardCom/OpenFields-FrontEnd](https://github.com/CardCom/OpenFields-FrontEnd)

קוד לדוגמא - צד שרת  
[https://github.com/CardCom/OpenFields-Backend-Node](https://github.com/CardCom/OpenFields-Backend-Node)

🔐 מדריך לשילוב מודול **Open Fields** של CardCom
------------------------------------------------

### 🖥️ צד לקוח (Frontend)

מודול זה מאפשר לשלב את שדות האשראי של CardCom בטופס שלכם בצורה מאובטחת.

מה המודול מאפשר:
----------------

1.  לשלב את שדות כרטיס האשראי וה-CVV של CardCom בתוך הטופס שלך.
    
2.  לעצב את שדות הקלט לפי העדפותיך (CSS מותאם אישית).
    
3.  לבצע תשלום מאובטח בהתאם לתקן **PCI**.
    
4.  להשתמש במודול **3D Secure** לאימות נוסף.
    

שלבי עבודה:
-----------

1.  #### יצירת עסקה מסוג **LowProfile**
    
    בכל פעם שתשלח טופס תשלום, יש ליצור עסקה חדשה מסוג LowProfile. זהו מזהה ייחודי (lowProfileCode) שילווה את התשלום.
    
2.  #### האזנה להודעות מה-iFrame
    
    המודול משתמש ב-**PostMessage** לצורך תקשורת בין הדף שלך ל-iFrame. כל הודעה מכילה שם פעולה (action name). הודעות ללא שם פעולה הן חלק מתהליך 3D Secure ויש להתעלם מהן.
    

סוגי פעולות (Actions):
----------------------

*   ### **מהמשתמש:**
    
    *   `init` – לאתחול ה־iframe. יש לשלוח את `lowProfileCode`, CSS מותאם, ואת האלמנט שבו יופיע שדה הקלט (בתוך איזה אלמנט HTML בדף שלך למקם את ה-iFrame של השדה).
        
    *   `doTransaction` – שליחת התשלום בפועל. יש לצרף: CVV, תוקף, תשלומים, ופרטי משתמש (שם, כתובת וכו').
        
*   ### **מהמערכת:**
    
    *   `HandleSubmit` – מכיל מידע על ביצוע התשלום.
        
    *   `HandleError` – מחזיר שגיאות.
        

### 📌 **שמות מזהי iframe חובה:**

*   `CardComMasterFrame`
    
*   `CardComCardNumber`
    
*   `CardComCvv`
    
*   `CardComCaptchaIframe`
    

* * *

### 🛠️ צד שרת (Backend)

שרת Node.js פשוט לדימוי יצירת עסקת LowProfile.

#### דרישות:

*   NodeJS (המדריך נכתב עם v18.15.0)
    

#### שלבים:

1.  התקנת תלויות:
    
        npm install
        
    
2.  הרצת הקובץ הראשי:
    
        node example
        
    

#### הערות:

*   בקובץ `config.json` מוגדר ברירת מחדל למסוף בדיקות של CardCom (ללא חיוב בפועל).
    
*   לפני העלאה לפרודקשן:
    
    *   שלבו את הלוגיקה הזו בצד השרת שלכם.
        
    *   החליפו למסוף האמיתי שלכם (production terminal).
        

* * *

📱 אינטגרציה עם Google Pay (ארנקים דיגיטליים)
---------------------------------------------

### תהליך התשלום

*   Google Pay מבצע את הרכישה ומפנה אוטומטית ל-Cardcom.
    
*   התשובה חוזרת באותה צורה כמו תשלום בכרטיס אשראי רגיל.
    
*   אין צורך לבצע קריאה ל-`doTransaction` – לאחר קבלת הפרטים מגוגל, התהליך נמשך אוטומטית מול Cardcom.
    
*   **על מנת שהגוגל פיי יעבוד כראוי חייב לעדכן את פרטי בעל הכרטיס כפי שכתוב בלשונית "עדכון פרטי בעל הכרטיס (חייב)"**
    

### ניהול תגובות

*   יש לטפל בתשובה דרך הפונקציות:
    
    *   `handleSubmit`
        
    *   `handleError`
        

### עדכון פרטי בעל הכרטיס (חייב)

*   על מנת שתהליך החיוב של **GOOGLE PAY &** **3D Secure** יצליח, נדרשים פרטים ש-Google Pay לרוב לא מספק:
    
    *   שם בעל הכרטיס
        
    *   טלפון
        
    *   אימייל
        

#### עדכון הפרטים לפני התשלום (חייב):

יש להשתמש בפונקציה הבאה לשם עדכון הנתונים בשביל 3DS ב-iframe:

iframe.contentWindow.postMessage({ action: 'setCardOwnerDetails', data }, '\*')                                                     על מנת לעדכן פרטים אלו טרם התשלום בגוגל פיי. אין צורך לפנות ל doTransaction, לאחר קבלת הפרטים מגוגל התהליך ימשיך אוטומטי ויפנה לקארדקום להשלמת העסקה.

  
**עיצוב CSS  ב 3 דרכים :**  
   
  
 

מאמרים קשורים
-------------

*   [תשלום באמצעות ApplePay & רישום דומיין מול APPLE בשביל IFRAME](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCBI4o3kBBDoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJw%2FgsWGjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIB8y9oYy9oZS9hcnRpY2xlcy80NDA0MzgyMjE4MjU4LSVENyVBQSVENyVBOSVENyU5QyVENyU5NSVENyU5RC0lRDclOTElRDclOTAlRDclOUUlRDclQTYlRDclQTIlRDclOTUlRDclQUEtQXBwbGVQYXktJUQ3JUE4JUQ3JTk5JUQ3JUE5JUQ3JTk1JUQ3JTlELSVENyU5MyVENyU5NSVENyU5RSVENyU5OSVENyU5OSVENyU5Ri0lRDclOUUlRDclOTUlRDclOUMtQVBQTEUtJUQ3JTkxJUQ3JUE5JUQ3JTkxJUQ3JTk5JUQ3JTlDLUlGUkFNRQY7CFQ6CXJhbmtpBg%3D%3D--4f442af99d7bf1f56dd4c4e44e02502b18472c8c)
*   [חיבור והתקנת התוסף סליקה לחנות וורדפרס - Wordpress Woocommerce Payment WOO](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCEnVGNJTADoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJw%2FgsWGjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSICCgEvaGMvaGUvYXJ0aWNsZXMvMzYwMDA3MTI4MzkzLSVENyU5NyVENyU5OSVENyU5MSVENyU5NSVENyVBOC0lRDclOTUlRDclOTQlRDclQUElRDclQTclRDclQTAlRDclQUEtJUQ3JTk0JUQ3JUFBJUQ3JTk1JUQ3JUExJUQ3JUEzLSVENyVBMSVENyU5QyVENyU5OSVENyVBNyVENyU5NC0lRDclOUMlRDclOTclRDclQTAlRDclOTUlRDclQUEtJUQ3JTk1JUQ3JTk1JUQ3JUE4JUQ3JTkzJUQ3JUE0JUQ3JUE4JUQ3JUExLVdvcmRwcmVzcy1Xb29jb21tZXJjZS1QYXltZW50LVdPTwY7CFQ6CXJhbmtpBw%3D%3D--b5d1fa5723048b8447db4c20e559cf39b96e9160)
*   ["חשבוניות ישראל": המדריך המלא - צעד אחר צעד לרישום חברה/עוסק או עמותה](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJKrNDPgGDoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJw%2FgsWGjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSICaQEvaGMvaGUvYXJ0aWNsZXMvMjczNTEyMTA4MzA3MzgtLSVENyU5NyVENyVBOSVENyU5MSVENyU5NSVENyVBMCVENyU5OSVENyU5NSVENyVBQS0lRDclOTklRDclQTklRDclQTglRDclOTAlRDclOUMtJUQ3JTk0JUQ3JTlFJUQ3JTkzJUQ3JUE4JUQ3JTk5JUQ3JTlBLSVENyU5NCVENyU5RSVENyU5QyVENyU5MC0lRDclQTYlRDclQTIlRDclOTMtJUQ3JTkwJUQ3JTk3JUQ3JUE4LSVENyVBNiVENyVBMiVENyU5My0lRDclOUMlRDclQTglRDclOTklRDclQTklRDclOTUlRDclOUQtJUQ3JTk3JUQ3JTkxJUQ3JUE4JUQ3JTk0LSVENyVBMiVENyU5NSVENyVBMSVENyVBNy0lRDclOTAlRDclOTUtJUQ3JUEyJUQ3JTlFJUQ3JTk1JUQ3JUFBJUQ3JTk0BjsIVDoJcmFua2kI--71274f1de4cc1aff05b777b08cc53054b5c7f941)
*   [העברת פרמטרים אל דף אישורית זהב](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCN5H%2BdFTADoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJw%2FgsWGjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSIBvi9oYy9oZS9hcnRpY2xlcy8zNjAwMDUwNjA1NzQtJUQ3JTk0JUQ3JUEyJUQ3JTkxJUQ3JUE4JUQ3JUFBLSVENyVBNCVENyVBOCVENyU5RSVENyU5OCVENyVBOCVENyU5OSVENyU5RC0lRDclOTAlRDclOUMtJUQ3JTkzJUQ3JUEzLSVENyU5MCVENyU5OSVENyVBOSVENyU5NSVENyVBOCVENyU5OSVENyVBQS0lRDclOTYlRDclOTQlRDclOTEGOwhUOglyYW5raQk%3D--bdb704da06bf684a647cba6132f80c81519370c2)
*   [מפתחות API לממשקים](/hc/he/related/click?data=BAh7CjobZGVzdGluYXRpb25fYXJ0aWNsZV9pZGwrCJJKOqovIzoYcmVmZXJyZXJfYXJ0aWNsZV9pZGwrCBJw%2FgsWGjoLbG9jYWxlSSIHaGUGOgZFVDoIdXJsSSJ3L2hjL2hlL2FydGljbGVzLzM4Njg3NjI2MzgxOTcwLSVENyU5RSVENyVBNCVENyVBQSVENyU5NyVENyU5NSVENyVBQS1BUEktJUQ3JTlDJUQ3JTlFJUQ3JTlFJUQ3JUE5JUQ3JUE3JUQ3JTk5JUQ3JTlEBjsIVDoJcmFua2kK--3ccf6a7aceb4ea9bb37354c796be2647d67f8a12)

הערות
-----

0 הערות

[היכנס למערכת](https://cardcomsupporthelp.zendesk.com/access?locale=he&brand_id=360000169194&return_to=https%3A%2F%2Fsupport.cardcom.solutions%2Fhc%2Fhe%2Farticles%2F28681992826898-OPEN-FIELDS) כדי להגיב.

[מופעל על ידי Zendesk](https://www.zendesk.com/service/help-center/?utm_source=helpcenter&utm_medium=poweredbyzendesk&utm_campaign=text&utm_content=%D7%A7%D7%90%D7%A8%D7%93%D7%A7%D7%95%D7%9D)