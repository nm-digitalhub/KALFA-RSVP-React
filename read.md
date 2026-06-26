קראתי את כל התוכנית. הכיוון העסקי נכון, אבל אין לאשר יישום שלה כפי שהיא. יש בה ארבע חסימות קריטיות.

1. אינטגרציית payments.js אינה תואמת לתיעוד הרשמי

לפי תיעוד SUMIT, הקובץ הוא:

<script src="https://app.sumit.co.il/scripts/payments.js"></script>

וההפעלה המתועדת היא באמצעות:

OfficeGuy.Payments.BindFormSubmit({
  CompanyID: ...,
  APIPublicKey: ...,
});

הטופס צריך לכלול data-og="form", והשדות משתמשים בערכים קטנים כגון:

data-og="cardnumber"
data-og="expirationmonth"
data-og="expirationyear"
data-og="cvv"
data-og="citizenid"

לא מופיעים בתיעוד OGPayments, CreateSingleUseToken, כתובת ה-CDN שהצעת, או שמות כמו CardNumber. בנוסף, SUMIT מתעדת שהספריה מוסיפה לטופס שדה בשם og-token לאחר הטוקניזציה.  

לכן שלב 9 אינו מאומת ועלול לא לעבוד בכלל.

גם CompanyID אינו יכול להיחשב סודי בהקשר הזה, כי SUMIT עצמה דורשת להעביר אותו לדפדפן באתחול הספריה. רק SUMIT_API_KEY חייב להישאר סודי לחלוטין.

2. הטופס כפי שנכתב לא מפעיל את ה-Server Action

בקוד שלך נוצרים:

const [state, formAction, isPending] = useActionState(...)

אבל הטופס אינו כולל:

<form action={formAction}>

לכן payOrderAction לא יופעל.

בנוסף, requestSubmit() מתוך handleSubmit() יפעיל שוב את אותו onSubmit, מה שיוצר לולאת טוקניזציה במקום שליחה לשרת.

React ו-Next מצפים שהפעולה תועבר אל action של הטופס, אל formAction של כפתור, או שתופעל ידנית בתוך transition.  

3. חסר מנגנון נגד חיוב כפול

כרגע שני חלונות דפדפן, שתי לחיצות מהירות, או timeout אחרי ש-SUMIT קיבלה את הבקשה יכולים ליצור שני חיובים.

הזרימה הנוכחית היא:

pending
-> charge SUMIT
-> mark paid

זו אינה אטומית.

צריך קודם “לתפוס” את ההזמנה בצורה אטומית:

pending
-> processing
-> charge SUMIT
-> paid

אם יש ניתוק תקשורת אחרי שליחת החיוב, אסור להציג “נסו שוב”, כי ייתכן שהכרטיס כבר חויב. במצב כזה צריך לעבור לסטטוס כגון:

payment_review

ולבצע reconciliation מול SUMIT לפי מזהה ניסיון תשלום או reference פנימי.

המיגרציה הנוכחית אינה מספיקה. נדרש לפחות מנגנון ניסיון תשלום ייחודי לכל הזמנה, מצב עיבוד, ומזהה reconciliation. אין לשמור PAN, CVV או og_token במסד הנתונים או ביומנים.

4. RLS קיים אינו מספיק לעדכון “שולם”

המשפט “לא נדרש RLS חדש” אינו בטוח.

אם משתמש מחובר יכול לבצע UPDATE להזמנה שלו, הוא עלול לנסות לעדכן בעצמו:

status = paid
paid_at = ...
sumit_document_id = ...

RLS עוסק בעיקר בגישה לשורות, ולא מבטיח בפני עצמו שהלקוח לא ישנה שדות רגישים. יש לבדוק grants, מדיניות UPDATE, ו-WITH CHECK.  

העדכון ל-“paid” צריך להתבצע רק דרך לקוח Supabase נפרד, server-only, בעל secret או service role, לאחר אימות בעלות ההזמנה בשרת. מפתח service role עוקף RLS ולכן אסור לחשוף אותו לדפדפן או להשתמש בו דרך לקוח SSR שמשתף session של משתמש.  

תיקונים נדרשים לפני כתיבת הקוד

1. לבנות POC קטן ונפרד עם payments.js הרשמי של SUMIT, בדיוק לפי התיעוד.
2. לאמת בפועל את מבנה ה-request וה-response של:

/billing/payments/charge/

ב-Swagger העדכני, לפני כתיבת charge.ts.

3. להחליף את מודל התשלום למצב:

pending -> processing -> paid
                    -> failed
                    -> review

4. להוסיף מזהה ניסיון תשלום ייחודי או reference פנימי לפני הקריאה ל-SUMIT.
5. להשתמש ב-server-only admin client לעדכון status, paid_at ו-sumit_document_id.
6. לא להשתמש ב-Number() עבור סכומי כסף. יש לשמור ולהעביר סכומים בצורה עשרונית מדויקת, לפי הפורמט ש-SUMIT דורשת ב-Swagger.
7. להחליט מראש כיצד הלקוח מקבל קבלה או חשבונית. כרגע:

SendDocumentByEmail: false
תעדכן לtrue
נדרש לעדכן true
משמעותו שלא נשלח מסמך אוטומטי, והזרימה אינה כוללת חלופה.

8. להוסיף בדיקות עבור timeout לאחר חיוב, ניסיון תשלום כפול, הזמנה שכבר processing, והזמנה של משתמש אחר.

המסקנה: שלבים 1 עד 6 יכולים להתחיל רק לאחר תיקון חוזה SUMIT. שלב 9, שלב 7, והמיגרציה צריכים להשתנות לפני כתיבה או הרצה בפרודקשן.
תבחן https://help.sumit.co.il/he/articles/5893615-payments-javascript-api


-----
התוכנית המתוקנת טובה בהרבה, אבל עדיין אינה מוכנה לפרודקשן. יש חמישה תיקונים מהותיים לפני שמריצים את המיגרציה או כותבים את הזרימה.

מה תוקן נכון

הבחירה בנתיב של טופס HTML רגיל עם BindFormSubmit ו-Route Handler נכונה. התיעוד הרשמי של SUMIT אכן מציג payments.js, את OfficeGuy.Payments.BindFormSubmit, את data-og="form", את שמות השדות באותיות קטנות, ואת השדה og-token שנוסף לטופס לאחר הטוקניזציה.  

גם המעבר ממצב יחיד של pending למצב ביניים processing הוא הכיוון הנכון למניעת חיוב כפול.

1. אין לחשוף את פונקציות התשלום ללקוח

זהו החסם החשוב ביותר שנותר.

הפונקציות הבאות, אם הן זמינות ל-authenticated, מאפשרות ללקוח לקרוא להן ישירות:

lock_order_for_payment
mark_order_paid
mark_order_failed
mark_order_payment_review

לקוח זדוני עלול לנעול הזמנה שלו ואז לקרוא ישירות ל:

mark_order_paid

עם מזהה מסמך מומצא, בלי חיוב אמיתי.

הפתרון המומלץ בפרויקט שלך:

* למחוק הרשאות EXECUTE מ-anon, authenticated ו-public.
* לא לקרוא לפונקציות האלה עם Supabase client של המשתמש.
* ליצור createAdminClient() נפרד, server-only, עם מפתח service role.
* ה-Route Handler מבצע requireUser(), ואז משתמש ב-admin client לעדכון אטומי עם התנאים: id, user_id, וסטטוס צפוי.

Supabase מבדילה בין grants לבין RLS: גם אם RLS מוגדר היטב, הרשאות על פונקציות קובעות מי בכלל מסוגל לקרוא להן.  

כלומר, עדיף להחליף את מעטפות ה-RPC הנוכחיות בעדכונים אטומיים server-only, למשל לוגית:

update orders
set status = processing
where id = order_id
  and user_id = authenticated_user_id
  and status = pending
returning id

אם לא חזרה שורה, ההזמנה כבר אינה זמינה לחיוב.

2. יש לפצל את המיגרציה לשתי מיגרציות

כרגע אתה מוסיף ערכי enum ואז משתמש בהם מיד באותה מיגרציה בתוך פונקציות.

ב-PostgreSQL, ערך חדש שנוסף ל-enum בתוך transaction אינו ניתן לשימוש לפני commit. לכן המיגרציה עלולה להיכשל בעת יצירת הפונקציות שמשתמשות ב-processing וב-payment_review.  

פצל כך:

202606240002_add_order_payment_statuses.sql

מכיל רק:

alter type order_status add value if not exists 'processing';
alter type order_status add value if not exists 'payment_review';

ואחריו:

202606240003_orders_payment_flow.sql

מכיל עמודות, מדיניות RLS, אינדקסים, constraints ופונקציות.

3. כל Redirect מתוך Route Handler חייב להיות 303

הטופס שולח POST.

NextResponse.redirect() ללא status מפיק בדרך כלל 307, כלומר הדפדפן ישמור את בקשת ה-POST גם בכתובת היעד. למשל, אחרי תשלום מוצלח הוא עלול לנסות:

POST /app/orders?paid=1

במקום לטעון את העמוד ב-GET.

יש להשתמש בכל החזרות מה-Route Handler ב:

return NextResponse.redirect(
  new URL('/app/orders?paid=1', request.url),
  303,
);

קוד 303 מחייב את הדפדפן להמשיך באמצעות GET, והוא מתאים במיוחד לאחר POST.  

זה חל גם על redirect להתחברות, token חסר, payment review, שגיאת חיוב והזמנה שכבר שולמה.

4. מסלול retry כרגע אינו עובד

העמוד מאפשר לשלם גם הזמנה במצב:

failed

אבל ה-Route Handler מאפשר חיוב רק כאשר:

if (order.status !== 'pending')

לכן לחיצה על “שלם עכשיו” עבור failed תיכשל.

יש לבחור אחת משתי דרכים:

* לפני הצגת טופס התשלום, כפתור “נסו שוב” שולח POST נפרד שמבצע failed -> pending, מחליף payment_attempt_ref, ואז מפנה לעמוד התשלום.
* או להחליף את פעולת הנעילה כך שתתמוך אטומית גם ב:

failed -> processing

ותחליף reference באותה פעולה.

הדרך השנייה נקייה יותר, כל עוד כל הפעולה נשארת server-only.

5. payment_attempt_ref עדיין אינו משמש reconciliation אמיתי

כרגע הוא נוצר ונשמר במסד הנתונים, אבל לא נשלח ל-SUMIT ולא מוחזר ממנה בתשובה.

במקרה של timeout או תקלה אחרי שנשלחה בקשת חיוב, תהיה לך הזמנה במצב payment_review, אבל ללא מפתח שאפשר לחפש איתו באופן אמין מול SUMIT.

לפני פיתוח charge.ts, צריך לבדוק ב-Swagger המקומי האם פעולת Charge תומכת בשדה reference, external reference, customer reference, או מזהה פנימי מקביל. לא ראיתי את תוכן swagger.json עצמו בשיחה זו, ולכן אי אפשר לאשר את שמות השדות Customer, PreventDocumentCreation או מבנה התשובה בלי להשוות אותם לחוזה המקומי.

בנוסף, הוסף לפחות:

alter table public.orders
  alter column payment_attempt_ref set not null;
create unique index orders_payment_attempt_ref_unique
  on public.orders (payment_attempt_ref);
create unique index orders_sumit_document_id_unique
  on public.orders (sumit_document_id)
  where sumit_document_id is not null;

עדיף אף יותר ליצור טבלת payment_attempts, כדי לשמור היסטוריה של retries, תקלות, זמני התחלה, מצב reconciliation ומזהה המסמך של SUMIT.

תיקונים נוספים נדרשים

lazyOnload אינו מתאים לטופס תשלום. Next מגדירה אותו לטעינה בזמן idle, לאחר משאבי העמוד. טופס תשלום צריך לטעון את הספריה מוקדם יותר, להשבית את הכפתור עד שה-binding הסתיים, ולהציג שגיאה אם הטעינה נכשלה. השתמש ב-afterInteractive וב-state מסוג ready.  

אין עדיין הוכחה ש-jQuery חייבת להיטען בנפרד. התיעוד של SUMIT מציג עטיפה של jQuery(...), אך אינו קובע במפורש אם payments.js כוללת אותה. בצע POC קטן: טעינת payments.js בלבד, אימות window.jQuery, ואז ניסיון binding. רק אם נכשל, הוסף jQuery.

אל תכניס שמות name לשדות כרטיס, CVV או תעודת זהות. השדות צריכים להישאר קריאים רק ל-payments.js; השרת אמור לקבל רק og-token.

אל תעביר את הודעת SUMIT הגולמית בתוך query string:

?error=${encodeURIComponent(err.message)}

העבר רק קודי שגיאה קבועים כגון:

payment_declined
payment_review
payment_unavailable

ורשום את השגיאה הטכנית בצד השרת יחד עם payment_attempt_ref.

יש להוסיף בדיקת Origin ל-POST של התשלום, כדי למנוע בקשה חוצת-אתרים שמשנה סטטוס הזמנה.

החלטה

אפשר להמשיך כעת רק עם:

1. POC של payments.js.
2. אימות מלא של חוזה Charge מול ה-Swagger המקומי.
3. תיקון ארכיטקטורת ההרשאות כך שרק server-only admin client מסוגל לשנות סטטוס תשלום.
4. פיצול המיגרציה.
5. תיקון כל ה-redirects ל-303.

רק לאחר חמשת אלה אפשר לאשר migration לפרודקשן.

--------
התוכנית כעת בנויה נכון מבחינת הכיוון: payments.js עם BindFormSubmit, Route Handler, נעילה אטומית, admin client, פיצול מיגרציות, ו-redirect מסוג 303. SUMIT אכן מתעדת את data-og="form", שמות השדות הקטנים, ואת הוספת og-token לפני שליחת הטופס.  

גם פיצול ה-enum לשתי מיגרציות הוא נכון. PostgreSQL קובע שערך enum חדש שנוסף בתוך transaction אינו זמין לשימוש עד לאחר commit.  

אבל עדיין יש ארבעה תיקונים הכרחיים לפני מיגרציה ופרודקשן.

1. כל HTTP שאינו הצלחה צריך לעבור ל-payment_review

בקוד הנוכחי:

if (!res.ok) {
  throw new Error('מערכת התשלום החזירה שגיאה');
}

יגרום ל-Route Handler לסמן את ההזמנה כ-failed.

זו אינה הנחה בטוחה. גם תשובת חמש מאות, חמש מאות ושתיים או timeout עשויים להגיע אחרי שהבקשה כבר הגיעה ל-SUMIT. במצב כזה אסור לאפשר retry אוטומטי.

החלף לוגית ל:

if (!res.ok) {
  throw new SumitNetworkError('לא התקבל אישור חד משמעי ממערכת התשלום');
}

סטטוס failed צריך להינתן רק כאשר SUMIT מחזירה תשובה עסקית מפורשת שמוכיחה שלא בוצע חיוב, למשל דחיית כרטיס או שגיאת ולידציה ידועה.

2. עדכון ל-paid חייב לוודא ששורה באמת עודכנה

כרגע אתה בודק רק:

if (paidErr) {

אבל עדכון SQL יכול להסתיים ללא שגיאת SQL ובלי לעדכן אף שורה, למשל אם הסטטוס כבר השתנה.

עדכון paid, failed ו-payment_review חייב להיות מוגבל גם לפי:

id
user_id
status = processing
payment_attempt_ref

ובעדכון paid יש להחזיר שורה ולעצור אם לא חזרה שורה:

.select('id')
.maybeSingle()

כך אתה מוודא שהתגובה מ-SUMIT משויכת בדיוק לניסיון התשלום שננעל, ולא לניסיון ישן או למצב ששונה במקביל.

3. בדיקת ה-CSRF הנוכחית פתוחה כאשר Origin חסר

כעת התנאי שלך הוא:

if (origin && !ALLOWED_ORIGINS.includes(origin)) {

כלומר, בקשה בלי כותרת Origin עוברת.

הבדיקה צריכה להיות fail-closed:

* קרא Origin.
* אם חסר, קרא Referer וחלץ ממנו origin.
* אם שניהם חסרים, החזר 403.
* השווה מול APP_ORIGIN סרוורי, למשל https://beta.kalfa.me.

OWASP ממליצה להשוות origin מקור מול origin יעד, להשתמש ב-Referer כגיבוי, ולחסום כאשר שניהם חסרים.  

עדיף להשתמש במשתנה:

APP_ORIGIN=https://beta.kalfa.me

ולא להסתמך על NEXT_PUBLIC_APP_URL כמקור אבטחה.

4. יש anchor ל-reconciliation, אך עדיין אין reconciliation

Customer.ExternalIdentifier עם payment_attempt_ref הוא פתרון נכון לזיהוי ניסיון התשלום.

אבל חסר המנגנון שמטפל בפועל בהזמנות payment_review.

נדרש endpoint אדמיניסטרטיבי או job סרוורי שמבצע:

payment_review
-> חיפוש ב-SUMIT לפי ExternalIdentifier
-> נמצא DocumentID: paid
-> אין תשובה חד משמעית: נשאר payment_review

אסור להחזיר הזמנה ל-pending רק מפני שלא נמצאה תשובה מיידית. עד שלא קיימת ודאות שלא נוצר חיוב, היא נשארת חסומה מ-retry.

שני תיקונים קטנים אך חשובים

SendDocumentByEmail: true לא צריך להישלח עם:

customerEmail: user.email ?? ''

אם אין כתובת אימייל תקינה, עצור לפני הנעילה והחיוב, או בחר במפורש לא לשלוח מסמך בדוא”ל.

בנוסף, createAdminClient() הוא הכיוון הנכון, אך הוא חייב להיות server-only לחלוטין. מפתח service role או secret key עוקף RLS ונותן גישה מלאה לנתונים, ולכן אסור שיופיע ב-client bundle, ביומן, או בכל import שמגיע לקומפוננטת client. Supabase ממליצה כיום על secret key חדש כאשר הוא זמין, ומגדירה את service_role כמפתח legacy בעל הרשאות elevated.  

לגבי jQuery

ה-POC עדיין נדרש. תיעוד SUMIT מציג jQuery(...), אך אינו מבהיר אם הספריה כוללת jQuery בעצמה. טען את payments.js רק בעמוד התשלום, בדוק ש-BindFormSubmit קיים, ודא שנוסף og-token, ושבקשת ה-POST אל KALFA אינה כוללת מספר כרטיס, CVV או תעודת זהות. afterInteractive מתאים יותר מ-lazyOnload לטופס תשלום, משום ש-lazyOnload נטען רק בזמן idle של הדפדפן.  

לאחר ארבעת התיקונים הראשיים, אפשר לאשר כתיבת הקוד וה-POC. את שתי המיגרציות יש להריץ בפרודקשן רק לאחר אישור מפורש.

---
התוכנית בשלה מאוד, אבל עדיין לא הייתי מאשר מיגרציה לפרודקשן לפני חמשת התיקונים הבאים.

1. מנגנון בירור חייב לכלול גם הזמנה שנתקעה ב-“בעיבוד”.

אם השרת נופל אחרי הנעילה ולפני ה-“catch”, ההזמנה תישאר ב-“בעיבוד”, לא ב-“לבירור”. כרגע מסלול הבירור מטפל רק ב-“לבירור”.

הוסף עמודה:

payment_processing_started_at timestamptz

בעת הנעילה:

status = 'processing',
payment_attempt_ref = gen_random_uuid(),
payment_processing_started_at = now()

מסלול הבירור למנהל צריך לאפשר בדיקה של:

payment_review

וגם של:

processing

אך רק אם עבר פרק זמן מוגדר, למשל עשר דקות. אסור לאפשר ניסיון תשלום חוזר אוטומטי במקרה כזה.

2. כל עדכון לאחר הנעילה חייב להיות מוגבל לאותו ניסיון תשלום בדיוק.

בעדכוני “נכשל” ו-“לבירור” חסר כרגע סינון לפי:

user_id
payment_attempt_ref

השתמש בכל עדכון שלאחר החיוב בתנאים:

.eq('id', orderId)
.eq('user_id', user.id)
.eq('status', 'processing')
.eq('payment_attempt_ref', paymentAttemptRef)

כך תגובת SUMIT לעולם לא תוכל לשנות ניסיון תשלום אחר.

3. הנעילה צריכה להחזיר גם סכום ומע”מ.

כרגע אתה טוען את ההזמנה, ואז נועל אותה, ואז מחייב לפי נתוני הקריאה הראשונה. עדיף שהעדכון האטומי יחזיר:

.select('payment_attempt_ref, total_with_vat, vat_rate')

ואת החיוב לבצע לפי הערכים שחזרו מהנעילה, לא לפי אובייקט order שנקרא קודם.

לפני הקריאה ל-SUMIT, ודא שהסכום והמע”מ חיוביים וסופיים:

const totalWithVat = Number(locked.total_with_vat);
const vatRate = Number(locked.vat_rate);
if (!Number.isFinite(totalWithVat) || totalWithVat <= 0) {
  throw new Error('סכום הזמנה לא תקין');
}

4. מסלול הבירור עדיין אינו מאומת עד הסוף.

אימתת ש-Customer.ExternalIdentifier נשלח בפעולת החיוב, וזה נכון כעוגן זיהוי. אבל עדיין צריך לאמת ב-Swagger את הפעולה המדויקת שמאפשרת לחפש מסמך או חיוב לפי אותו מזהה.

ההחלטה אינה יכולה להיות רק:

חפש ב-SUMIT לפי ExternalIdentifier

צריך להגדיר במפורש:

כתובת הפעולה
מבנה הבקשה
שדה הסינון
מבנה התשובה
מיקום DocumentID בתשובה

בלי פעולת חיפוש מוכחת, הזמנות ב-“לבירור” יישארו ללא דרך אמיתית להכרעה.

5. לפני מחיקת מדיניות orders_owner, יש לבצע audit של כל הכותבים לטבלת orders.

החלפת מדיניות ALL ל-SELECT בלבד היא נכונה מבחינת הגנה על סטטוס התשלום, אבל היא עלולה לשבור יצירה או עדכון קיים של הזמנות.

לפני המיגרציה, חפש בפרויקט:

grep -RInE "from\\(['\"]orders['\"]\\).*(insert|update|upsert|delete)" src

כל כתיבה קיימת חייבת להיות מאומתת כפעולה סרוורית, או לעבור ל-createAdminClient()/פעולת שרת מוגנת.

שני תיקונים קטנים נוספים:

* הסר את ברירת המחדל מתוך APP_ORIGIN. אם המשתנה חסר, החזר שגיאת שרת או עצור את ההפעלה. משתנה אבטחה לא צריך fallback שקט.
* עדכן גם את טיפוסי Insert ו-Update של orders, לא רק את Row; אחרת עדכוני admin עשויים להיכשל בבדיקת טיפוסים.

הבחירה ב-payments.js, ב-BindFormSubmit, בטופס עם data-og="form" ובשדה og-token תואמת לתיעוד SUMIT. התיעוד גם מבהיר שהחיוב עצמו אמור להתבצע מהשרת לאחר הטוקניזציה.  

הטיפול שלך ב-303 לאחר POST נכון. ה-POC של jQuery עדיין נדרש: יש לאמת שהטופס נטען, ש-BindFormSubmit קיים, שנוצר og-token, ושבקשת ה-POST לשרת אינה כוללת פרטי כרטיס, CVV או מספר תעודת זהות.  
