# הערות להחלטת בעלים: תרגום לאנגלית (`public.json`)

12 סעיפים. סעיפים 1 עד 5 הם ניסוחי הסכמה או הצהרות בעלות משמעות משפטית. הם תורגמו בנאמנות למקור, ואינם מאושרים משפטית עד שהבעלים יאשר.

## ניסוחי הסכמה והצהרות

### 1. `r.form.showInGuestList.label` (הסכמה)
- **עברית:** להופיע ברשימת "מי מגיע" — שם פרטי בלבד
- **הבחירה:** Show me on the "Who else is coming" list (first name only)
- **חלופה:** Show my first name on the "Who else is coming" list
- **למה זה חשוב:** זו הסכמה של אורח לחשיפת שמו הפרטי לאורחים אחרים. בעברית השם בתיבה ("מי מגיע") שונה מהכותרת שהאורח רואה (`r.attendees.title`: "מי עוד מגיע"). באנגלית השוויתי ביניהם, כדי שיהיה ברור על איזו רשימה מדובר.

### 2. `site.about.does.limits` (הצהרה על אופן השליחה)
- **עברית:** מה היא לא עושה: היא לא מנהלת את האולם, את הספקים או את התקציב, ולא שולחת פרסום המוני. ההודעות יוצאות רק אל המוזמנים של האירוע, ורק בנוגע אליו.
- **הבחירה:** What it doesn't do: it doesn't manage your venue, vendors or budget, and it doesn't send mass advertising. Messages go only to the event's invited guests, and only about that event.
- **חלופה:** "mass marketing" במקום "mass advertising"
- **למה זה חשוב:** התחייבות פומבית על מי מקבל הודעות ועל מה. "advertising" קרוב יותר ל"פרסום". "marketing" רחב יותר, ולכן מרחיב את ההתחייבות.

### 3. `site.home.hero.private` (הצהרת אבטחה)
- **עברית:** פרטי ומאובטח
- **הבחירה:** Private and secure
- **חלופה:** Your data stays private
- **למה זה חשוב:** הצהרת אבטחה ופרטיות שיווקית, ללא הסתייגות. החלופה צרה יותר, אבל מוסיפה משמעות שהמקור לא אומר, ולכן לא בחרתי בה.

### 4. `site.whatsapp.hero.subtitle` (הצהרה על הפלטפורמה)
- **עברית:** הזמנה אישית לכל מוזמן דרך הפלטפורמה העסקית הרשמית של וואטסאפ — לא קבוצה, לא רשימת תפוצה, ולא שליחה ידנית מהטלפון שלכם.
- **הבחירה:** A personal invitation for every guest through WhatsApp's official business platform. No group, no broadcast list, no sending by hand from your own phone.
- **חלופה:** "the official WhatsApp Business Platform", בשם המוצר המדויק ובאותיות גדולות
- **למה זה חשוב:** שימוש בשם של Meta. הבחירה מתארת את הפלטפורמה ולא משתמשת בשם המוצר, כמו המקור. החלופה מדויקת יותר, אבל היא טענה מפורשת על מוצר ספציפי. השם "WhatsApp Business Platform" אומת רק במקורות משניים, לא בעמוד רשמי של Meta ([RightCom](https://rightcom.com/blog/meta-launched-cloud-based-api-on-the-whatsapp-business-platform)).

### 5. `site.whatsapp.limits.title` (הצהרת ציות)
- **עברית:** וואטסאפ היא פלטפורמה עם כללים, ואנחנו עובדים לפיהם
- **הבחירה:** WhatsApp is a platform with rules, and we follow them
- **חלופה:** WhatsApp has rules, and we work within them
- **למה זה חשוב:** הצהרה פומבית על עמידה בכללים של צד שלישי. שתי הגרסאות מחייבות באותה מידה. החלופה רק קצרה יותר.

## החלטות ניסוח

### 6. `site.about.hero.intro` (ברית)
- **עברית:** ...בריתות...
- **הבחירה:** brit milah ceremonies
- **חלופה:** bris (ברבים brises), או brit milah (bris) כדי לשרת את שתי הקבוצות
- **למה זה חשוב:** "bris" היא ההגייה האשכנזית ונפוצה בדיבור. "brit milah" היא ההגייה הספרדית והישראלית, והיא הצורה הפורמלית. [Merriam-Webster](https://www.merriam-webster.com/dictionary/brit%20milahs) מביא את שתיהן, ו[קהילת Or VeShalom](https://www.orveshalom.org/?p=469) כותבת brit milah בהגייה הספרדית והישראלית. לרבים באנגלית אין צורה מוסכמת, ולכן "ceremonies". הצורה "Brit Milah (Bris)" מופיעה ב-[My Jewish Learning](https://www.myjewishlearning.com/article/planning-a-brit-milah-bris/), אבל ארוכה יותר. גם `EVENT_TYPE_LABELS` ודף `/brit` יצטרכו להשתמש באותו מונח כשיתורגמו.

### 7. `site.guestListTemplate.file.sampleNote` (שם שורת הדוגמה)
- **עברית:** שורת "סבתא רחל" בלי טלפון היא דוגמה מכוונת: אפשר לנהל גם מוזמן שאין לו מספר, הוא פשוט לא יקבל הודעה אוטומטית.
- **הבחירה:** The row with no phone number is there on purpose: you can still manage a guest who has no number. They just won't get an automatic message.
- **חלופה:** The "Grandma Rachel" row has no phone number on purpose: ...
- **למה זה חשוב:** הטבלה בעמוד נבנית מ-`TEMPLATE_SAMPLE_ROWS` ונשארת בעברית, כי הקובץ חייב להתאים למייבא. "Grandma Rachel" לא היה תואם למה שרואים על המסך, אז זיהיתי את השורה לפי התכונה שלה ולא לפי השם. **להחלטה:** האם אורח דובר אנגלית אמור לקבל קובץ עם כותרות עמודות בעברית. `site.guestListTemplate.hero.subtitle` מבטיח "the right columns", וזה נכון, אבל הכותרות עצמן בעברית.

### 8. `cb.form.contact.label` ו-`cb.form.contact.placeholder` (משמעות השדה)
- **עברית:** איך לפנות אליך? / לדוגמה: שם, טלפון או אימייל
- **הבחירה:** Your contact details / For example: your name, phone or email
- **חלופה:** What should we call you? / Your name
- **למה זה חשוב:** בעברית יש שתי קריאות: "איך לקרוא לך" או "איך ליצור איתך קשר". השדה נשמר כ-`full_name`, עם `autoComplete="name"`, ושגיאת האימות היא "נא למלא שם", כלומר הקוד מצפה לשם. אבל הטקסט המוצג מציע גם טלפון ואימייל. בחרתי כותרת שמתאימה לשלוש הדוגמאות, כי "How can we reach you?" לא מסתדר עם "your name". אם הכוונה לשם בלבד, צריך את החלופה, וכדאי לתקן גם את הטקסט בעברית.

### 9. `r.gift.prompt` (בעלי השמחה)
- **עברית:** רוצים לשמח את בעלי השמחה?
- **הבחירה:** Would you like to add to the joy of the day?
- **חלופה:** Want to add to the simcha?
- **למה זה חשוב:** המשפט מוצג בכל סוג אירוע, ולכן "the happy couple" לא מתאים. "simcha" הוא האיות הנפוץ, ופירושו אירוע שמח כמו חתונה או בר מצווה ([Wikipedia](https://en.wikipedia.org/wiki/Simcha), [Wiktionary, עותק](https://wiki.neonvagabond.xyz/content/wiktionary_en_all_nopic_2024-05/A/simcha)). לא מצאתי מקור לשימוש במילה על הזמנות באנגלית. הוא חם ונכון לקהל יהודי, אבל אורח שאינו יהודי או אינו מכיר את המילה לא יבין אותו. הבחירה עובדת לכולם, ומשאירה את המשחק "שמחה" בלי מילה עברית.

### 10. `r.invalidLink` ("בוטל")
- **עברית:** קישור אישור ההגעה אינו תקף, פג תוקפו או בוטל.
- **הבחירה:** This RSVP link is invalid, has expired or is no longer active.
- **חלופה:** ...or has been revoked
- **למה זה חשוב:** סטייה קטנה מהמקור. "canceled" או "cancelled" מפצל בין ארצות הברית לבריטניה. "is no longer active" רך וכללי. "has been revoked" נאמן יותר ל"בוטל" ובלי פיצול באיות, אבל נשמע רשמי יותר לאורח.

### 11. `site.about.does.limits` (ספקים)
- **עברית:** ...את הספקים...
- **הבחירה:** vendors
- **חלופה:** suppliers
- **למה זה חשוב:** בדיקה ברשת הראתה פיצול אמיתי: [The Wedding Directory UK](https://theweddingdirectory.co.uk/wedding-suppliers/page/48/) כותב "wedding suppliers", ו-[The Knot](https://www.theknot.com/content/wedding-vendor-checklist) בארצות הברית כותב "wedding vendors". לא נמצאה השוואה ישירה. אין מילה ניטרלית טובה באותו אורך. המשפט פונה לבעלי אירועים, לא לאורחים, ולכן ההחלטה תלויה בקהל המארחים שהבעלים מכוון אליו.

### 12. `STATUS_LABELS` ב-`rsvp-form.tsx` (אפשרויות ההגעה, מחוץ ל-`public.json`)
- **עברית:** מגיע/ה / אולי / לא מגיע/ה
- **הבחירה (המלצה לכשיחולצו):** Attending / Maybe / Not attending
- **חלופה:** Yes / Maybe / Can't make it, או בניסוח רשמי Joyfully accepts / Regretfully declines
- **למה זה חשוב:** האפשרויות כתובות בקוד ולא תורגמו, אז האורח יראה שאלה באנגלית ותשובות בעברית. שיניתי את השאלה ל-"Will you be attending?" כדי שתתאים להן. הזוג Attending ו-Not attending נמצא בטפסים מקוונים ([RSVPify](https://community.rsvpify.com/hc/en-us/community/posts/22893673472020-Not-Attending-RSVP)), וגם "Maybe" מקובל ([schema.org](https://schema.org/RsvpResponseMaybe)). הנוסח "Joyfully accepts" שייך לכרטיסים רשמיים ([Paperlust](https://paperlust.co/blog/wedding-rsvp-wording-examples/)), והוא ארוך לכפתור צר. בכפתור צר צריך גם לבדוק ש-"Not attending" לא נשבר.

## שינויים במקור העברי

- `r.closed.notice`: המקור שונה ל"למי שהזמין אתכם". האנגלית עכשיו "you can contact the person who invited you". החלופה "whoever invited you" שומרת על סתמיות המספר, אבל נשמעת מזלזלת יותר.
- `site.home.trust.subtitle`: המקור שונה ל"לתת לכם". האנגלית עכשיו "give you full, calm control", במקום "give the host".
