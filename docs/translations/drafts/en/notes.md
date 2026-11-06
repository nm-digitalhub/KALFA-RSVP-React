# הערות להחלטת בעלים: תרגום לאנגלית (`public.json`)

סעיפים 1 עד 12 מהסבב הראשון, סעיפים 13 עד 42 מסבב 2, וסעיפים 43 עד 60 מסבב 3. סעיפים 1 עד 5, 21, 32 ו-36 הם ניסוחי הסכמה או הצהרות בעלות משמעות משפטית. הם תורגמו בנאמנות למקור, ואינם מאושרים משפטית עד שהבעלים יאשר. כך גם סעיף 52, שמרכז את הגילויים וההסכמות של הטפסים ושל הווידג'ט, וסעיף 57, שמרכז את `cookieConsent.json`. סעיף 20 מתעד מה נשאר בעברית בקוד בסבב 2, ומה עבר מאז ל-`t()`.

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
- **עברית:** איך לפנות אליך? / השם שלך
- **הבחירה:** What should we call you? / Your name
- **למה זה חשוב:** השדה נשמר כ-`full_name`, עם `autoComplete="name"`, ושגיאת האימות היא "נא למלא שם". הטקסט הקודם הציע גם טלפון ואימייל, ולכן הוא תוקן בעברית ובשתי השפות (`translation-qa`, 5.11.2026, בהוראת הבעלים).

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
- **הבחירה:** Attending / Maybe / Not attending. עדכון סבב 2: האפשרויות עברו ל-`r.form.status.*`, וההמלצה יושמה.
- **חלופה:** Yes / Maybe / Can't make it, או בניסוח רשמי Joyfully accepts / Regretfully declines
- **למה זה חשוב:** האפשרויות כתובות בקוד ולא תורגמו, אז האורח יראה שאלה באנגלית ותשובות בעברית. שיניתי את השאלה ל-"Will you be attending?" כדי שתתאים להן. הזוג Attending ו-Not attending נמצא בטפסים מקוונים ([RSVPify](https://community.rsvpify.com/hc/en-us/community/posts/22893673472020-Not-Attending-RSVP)), וגם "Maybe" מקובל ([schema.org](https://schema.org/RsvpResponseMaybe)). הנוסח "Joyfully accepts" שייך לכרטיסים רשמיים ([Paperlust](https://paperlust.co/blog/wedding-rsvp-wording-examples/)), והוא ארוך לכפתור צר. בכפתור צר צריך גם לבדוק ש-"Not attending" לא נשבר.

## סבב 2: דף האורח

### 13. `r.form.success.summary_one`, `r.form.success.summary_other` (`{{eventType}}`)
- **עברית:** נתראה ב{{eventType}} — נרשמו {{count}} משתתפים.
- **הבחירה:** See you at the {{eventType}}. We've noted {{count}} people.
- **חלופה:** See you there. We've noted {{count}} people. (בלי המשתנה, ולכן דורש שינוי קוד)
- **למה זה חשוב:** `EVENT_TYPE_LABELS` ב-`src/lib/data/event-labels.ts` כתוב בעברית בקוד, אז האורח יראה מילה עברית בתוך משפט אנגלי. כדי שהמשפט יעבוד צריך תוויות מתורגמות באותיות קטנות (wedding, bar mitzvah, brit milah), כי הן מופיעות באמצע משפט אחרי "the". `יום הולדת` ו-`אירוסין` דורשים כנראה party ("the birthday party", "the engagement party"), אחרת "See you at the" לא יעבוד. הערך `other` ("אחר") שבור גם בעברית: "נתראה באחר". באנגלית זה יהיה "the other".
- **עדכון סבב 3:** טופל באנגלית. `{{eventType}}` מגיע עכשיו מ-`guest.eventType.*` (`eventTypeLabels` ב-`event-labels.ts`), והערכים מתורגמים באותיות קטנות. ראו סעיפים 43 ו-44. בעברית "נתראה באחר" עדיין שבור.

### 14. `cb.meta.title` (שם עצם לשיחה חוזרת)
- **עברית:** פרטים לשיחה חוזרת
- **הבחירה:** Return call details
- **חלופה:** Callback details (הנוסח של Locize)
- **למה זה חשוב:** סבב 1 נמנע מ-callback כשם עצם, כי הוא אומת רק במילונים אמריקאיים. זה המקום היחיד שדורש שם עצם, וזו כותרת של לשונית דפדפן בלבד.
- **עדכון סבב 3:** יש מקום שני, `site.contact.form.callbackDisclosure`, ושם נשמר אותו מונח, return call. ראו סעיף 52.

### 15. `r.errors.notFound` ("בוטל")
- **עברית:** קישור אישור ההגעה אינו תקף או בוטל.
- **הבחירה:** This RSVP link is invalid or no longer active.
- **חלופה:** ...or has been revoked
- **למה זה חשוב:** אותה החלטה כמו סעיף 10, כדי ששתי ההודעות על אותו קישור יישמעו אותו דבר.

### 16. `cb.header.phoneHint` (פריסה)
- **עברית:** נחזור אליך למספר שמסתיים ב-<hint>{{phoneHint}}</hint>.
- **הבחירה:** We'll call you back at the number ending in <hint>{{phoneHint}}</hint>.
- **חלופה:** אין. זו הערה על הקוד.
- **למה זה חשוב:** ל-`<hint>` יש `mr-1` ב-`cb/[token]/page.tsx`, שוליים פיזיים שמתאימים לימין לשמאל. בשמאל לימין ייווצר רווח לפני הנקודה. נקרא בקוד, לא נבדק בדפדפן.

### 17. `r.form.status.declined` (רוחב כפתור)
- **עברית:** לא מגיע/ה
- **הבחירה:** Not attending
- **חלופה:** Can't make it
- **למה זה חשוב:** מ-20rem של רוחב טופס הכפתורים עומדים בשלוש עמודות, ולפי חישוב "Not attending" יישבר לשתי שורות בין שתי המילים. זה לא שובר מילה, אבל הכפתור יהיה גבוה יותר. לא נבדק בדפדפן.

## סבב 2: טפסים ואימות

### 18. `validation.name.required` (המשך לסעיף 8)
- **עברית:** נא למלא שם
- **הבחירה:** Please fill in your name
- **חלופה:** אין.
- **למה זה חשוב:** הודעה זו מוצגת גם בשדה `cb.form.contact.label`. סעיף 8 הוכרע: התווית היא `What should we call you?`, ה-placeholder הוא `Your name`, והשדה נשמר כ-`full_name`. לכן ההודעה תואמת לשדה, ולא נשארה שאלה פתוחה.

### 19. `site.callMe.refusal.quietHours` (צאת החג)
- **עברית:** לא ניתן לבצע שיחה בשבת ובחג. נסו שוב לאחר צאת החג.
- **הבחירה:** We can't place calls on Shabbat or Jewish holidays. Please try again once it's over.
- **חלופה:** ...Please try again after the holiday ends. (מילולי)
- **למה זה חשוב:** ההודעה מוצגת גם בשבת, והעברית אומרת רק "צאת החג". "once it's over" מכסה את שני המקרים בלי להוסיף עובדה. הבעיה מתחילה במקור: כדאי לכתוב בעברית "לאחר צאת השבת או החג".

### 20. עברית קבועה בקוד ליד הטפסים (תישאר בעברית בעמוד אנגלי)
- **הבחירה:** לא תורגם, כי המפתחות לא קיימים.
- **למה זה חשוב:** אלה טקסטים בעלי משמעות משפטית או תפעולית, והאורח דובר האנגלית לא יראה אותם בשפתו:
  - `call-me-now-widget.tsx`: גילוי ההקלטה ("השיחה מוקלטת לצורך תיעוד ושיפור השירות"), ומיד מתחתיו הכפתור "Got it, continue". המבקר יאשר טקסט שהוא לא יכול לקרוא.
  - `inquiry-forms.tsx`: `CallbackDisclosureNote` (סוכן קולי אוטומטי והודעת WhatsApp), ומשפט ההסכמה לשיחת מכירות בבחירת הנושא "מכירות".
  - `callback-fields.tsx`: תווית הנושא, אפשרויות המועד, `PrivacyNote` ו-"השאירו שדה זה ריק".
  - `INQUIRY_TOPICS` ב-`inquiries.ts`: הערכים עצמם בעברית ונשמרים כך במסד הנתונים, ולכן צריך להפריד בין ערך לתווית.
  - `api/call-me-now/request-code/route.ts`: הודעות השגיאה מהשרת ("מספר טלפון לא תקין", "יותר מדי בקשות") עוקפות את `site.callMe.errors.sendCodeFailed`.
  - `dir="rtl"` קבוע בווידג'ט, כך שסימני הפיסוק יקפצו כמו שתואר ב-`review.md`, סעיף 5.
- **עדכון סבב 3:** הרשימה למעלה מתארת את הקוד בסבב 2. כל הטקסטים האלה עברו מאז ל-`t()`, ותורגמו (ראו סעיף 52). `INQUIRY_TOPICS` נשאר בעברית כערך של הטופס, ורק התווית מתורגמת. הודעות השגיאה של `request-code/route.ts` הן עכשיו קודים, והווידג'ט מנסח אותן מ-`site.callMe.refusal.*`. `dir="rtl"` הוסר מהווידג'ט, ו-`app/layout.tsx` קובע את הכיוון לפי השפה. הוא עדיין קבוע ב-`cb/[token]/page.tsx`.

## סבב 2: בית ואודות

### 21. הצהרות בעלות משמעות משפטית (תורגמו בנאמנות, לא מאושרות משפטית)
- `site.about.principles.items.dataOwnership.title`, `.body`: Guest data belongs to the host. KALFA processes it on the host's behalf and doesn't sell personal information to third parties. הצהרה על בעלות ועל עיבוד בשם בעל האירוע. "לצד שלישי" תורגם ברבים, "to third parties", כי זו הצורה הרגילה באנגלית, והיקף ההצהרה לא משתנה.
- `site.about.principles.items.openPrice.body`: "when an additional charge applies". התחייבות לגילוי מחיר מראש. החלופה "when a charge is added" קרובה יותר למקור ופחות טבעית.
- `site.about.principles.items.noShabbat.title`, `.body`: התחייבות שלא נשלח דבר בשבת ובחג. "Nothing goes out" רחב כמו "פניות", שכולל גם שיחות. החלופה "No messages" הייתה מצמצמת.
- `site.about.does.items.privateLink.body`: הצהרה שהמוזמן רואה רק את הפרטים שלו. שימו לב שהיא סותרת חלקית את רשימת "Who else is coming" ב-`/r`, שבה אורח שהסכים מופיע בשם פרטי. הסתירה קיימת גם בעברית.
- `site.home.trust.items.privacy.body`: Your guest list and data are kept safe and private. They're yours alone. "שמורים" יכול להיות גם "stored". "kept safe" מבטיח קצת יותר מ-"stored", והחלופה היא "are stored privately".

### 22. `site.about.principles.items.hebrewFirst.title` (הטענה על עברית)
- **עברית:** עברית קודם
- **הבחירה:** Hebrew first
- **חלופה:** למחוק את הפריט מהגרסה האנגלית
- **למה זה חשוב:** בעמוד באנגלית זו טענה מוזרה. גוף הפריט כתוב בעברית בקוד, ואומר שהממשק "לא תורגם", והוא בדיוק מה שמוצג בתרגום. אותה בעיה ב-`DESCRIPTION` של `about/page.tsx` ("מערכת ישראלית בעברית") וב-`d` של `easeOfUse` ב-`page.tsx` ("ממשק בהיר בעברית"). שלושתם נשארו בעברית בכוונה, עד החלטת הבעלים.

### 23. ניסוח עסקי (B2B)
- `site.footer.tagline`: RSVP management for private and business events. בעברית "פרטיים ועסקיים".
- `site.home.audiences.items.company.title`: Company events.
- `site.home.audiences.items.conferences.title`: Conferences.
- **למה זה חשוב:** תורגם בנאמנות, לפי הבריף. KALFA מוגדרת כשירות B2C לאירועים פרטיים, והמשפטים האלה מרחיבים את הקהל. אותו דבר ב-`site.about.hero.intro` וב-`site.home.audiences.subtitle` שעברו ביקורת, ובכל `site.eventType.event.*`.

### 24. `site.footer.legal.terms`, `site.about.moreLinks`, `site.about.operator.body` (תקנון)
- **עברית:** תקנון
- **הבחירה:** Terms of service
- **חלופה:** Terms and conditions
- **למה זה חשוב:** כותרת העמוד היא "תקנון ותנאי שירות". לפי המקורות אין הבדל משפטי קבוע בין התוויות, אבל terms of service נפוץ בשירותי תוכנה. **העמודים `/terms`, `/privacy` ו-`/cookies` נשארים בעברית**, אז הקישורים מעמוד אנגלי מובילים למסמך משפטי שהקורא לא יכול לקרוא.

### 25. `site.about.operator.body` (`{{operator}}`)
- **עברית:** השירות מופעל על ידי {{operator}}. פרטי העסק המלאים מופיעים בתקנון.
- **הבחירה:** The service is operated by {{operator}}. Full business details appear in the terms of service.
- **חלופה:** אין.
- **למה זה חשוב:** הערך מגיע מ-`getCompanyLegal()`, בעברית בזמן ריצה, כולל הכתובת. צריך להחליט אם להציג שם וכתובת באותיות לטיניות בעמוד אנגלי.

### 26. `site.home.closing.title`, `site.home.how.items.arrive.title` (אירוע מסודר)
- **עברית:** אירוע מסודר יותר / מגיעים לאירוע מסודר
- **הבחירה:** A better-run event / Arrive at a well-run event
- **חלופה:** A more orderly event / Arrive at an orderly event
- **למה זה חשוב:** סטייה מכוונת מהמונח orderly שבמילון, רק עבור אירוע. "orderly" נשאר לרשימה ולמערכת. `site.home.features.items.communication.title` תורגם לאותה סיבה ל-"Streamlined communication".

## סבב 2: סוגי אירוע

### 27. `site.eventPage.timing.cadenceBody` (`{{cadence}}`)
- **עברית:** ...לפי תאריך האירוע: {{cadence}}.
- **הבחירה:** Once RSVPs are activated, guests are contacted automatically based on the event date: {{cadence}}.
- **חלופה:** אין.
- **למה זה חשוב:** הערך נבנה ב-`formatOutreachScheduleHe` מתוויות ערוץ ומימים, בעברית בלבד ("יום לפני", "יומיים לפני"). בעמוד אנגלי יופיע משפט אנגלי שמסתיים בעברית. צריך גרסה לכל שפה.

### 28. `site.eventType.event.challenges.eyebrow`, `site.eventType.event.guide.title` (אירוע מאורגן)
- **עברית:** למה אירוע מאורגן שונה / המדריך לאישורי הגעה לאירוע מאורגן
- **הבחירה:** Why a structured event is different / The guide to RSVPs for structured events
- **חלופה:** organized event (מפצל איות), או large event (לא אומר אותו דבר)
- **למה זה חשוב:** העמוד מתאר כנס, ערב חברה ואירוע משפחתי גדול, עם קיבולת ורשימת כניסה. "structured" שומר על הכוונה ועל איות ניטרלי, אבל הוא צירוף פחות שגור.

### 29. `site.eventType.brit.guide.g2.body` (הסבר שנוסף)
- **עברית:** בבריתה או בזבד הבת התאריך גמיש יותר...
- **הבחירה:** For a britah or zeved habat, ceremonies that welcome a baby girl, the date is more flexible...
- **חלופה:** בלי ההסבר
- **למה זה חשוב:** תוספת קטנה שאינה במקור, כי קורא באנגלית עלול לא להכיר את שני המונחים. היא לא מוסיפה עובדה על המוצר. המונח britah מתועד פחות מ-zeved habat, ובמקור היחיד שנמצא הוא משני.

### 30. שמות סטטוס בתוך טקסט שיווקי
- **מפתחות:** `site.eventType.barMitzva.faq.q2.answer` ("Pending"), `site.eventType.event.guide.g2.body`, `site.eventType.event.faq.q2.answer` ("Maybe", "Attending", "Not attending"), `site.eventType.wedding.guide.g1.body`
- **הבחירה:** תורגמו. "Maybe", "Attending" ו-"Not attending" זהים ל-`r.form.status.*`.
- **למה זה חשוב:** האזור האישי של המארגן נשאר בעברית, אז הסינון שהטקסט מתאר ייראה שם בעברית. "Pending" הוא תרגום של "ממתין" בלבד, בלי תווית אנגלית במוצר להשוות אליה.

### 31. דוגמאות לקבוצות בתוך טקסט
- **מפתחות:** `site.eventType.wedding.guide.g3.body` (`"Groom's side"`, `"Bride's side"`, `"Friends"`), `site.eventType.barMitzva.timing.t2`
- **הבחירה:** תורגמו. שם קבוצה הוא טקסט חופשי של המארגן, ולא ערך קבוע בקוד.
- **חלופה:** אין.
- **למה זה חשוב:** רק רישום, לפי הבריף. "צד החתן" ו"צד הכלה" מניחים זוג של חתן וכלה, גם בעברית.

### 32. הצהרות על פרטיות ועל שליחה בעמודי סוגי האירוע (תורגמו בנאמנות)
- `site.eventType.wedding.faq.q3.answer`: מוזמן רואה רק את הפרטים שלו. אותה סתירה מול "Who else is coming", ראו סעיף 21.
- `site.eventType.wedding.faq.q1.answer`, `site.eventType.brit.guide.g3.body`: "no messages are sent on Shabbat or Jewish holidays", "no guest receives a message on Shabbat". התחייבות מוחלטת.
- `site.eventPage.timing.quietHours`, `site.eventType.brit.faq.q2.answer`: התחייבות על שבת, חג ולילה.
- `site.eventType.wedding.timing.t5`: הודעת תודה אוטומטית "to those who came".

### 32א. `site.eventType.wedding.timing.t3` ("למטה")
- **עברית:** ...מספיק זמן לפני תחילת הסבב שמופיע בלוח הזמנים למטה.
- **הבחירה:** ...well before the round in KALFA's sending schedule starts.
- **חלופה:** ...in the schedule below starts. (מילולי)
- **למה זה חשוב:** ב-`event-type-page.tsx` תיבת `cadenceTitle` נמצאת מעל רשימת השלבים או לידה, אף פעם לא מתחתיה. המילה "למטה" שגויה כבר בעברית, וכדאי לתקן אותה שם. האנגלית לא נוקבת במיקום.

## סבב 2: שאר עמודי השיווק

### 33. שמות העמודות בתבנית (`site.guestListTemplate.*`)
- **מפתחות:** `meta.description`, `faq.items.howToBuild.answer`, `faq.items.rowPerInvite.answer`, `mistakes.items.noGroup.title`, `mistakes.items.rowPerPerson.body`, `steps.items.phoneFormat.body`, `steps.items.rowPerInvite.body`
- **הבחירה:** תיאור באנגלית (quantity column, phone column, group column), בלי לצטט את הכותרת העברית.
- **חלופה:** לצטט את הכותרות בעברית, למשל `the "כמות" column`
- **למה זה חשוב:** הכותרות אמיתיות: `TEMPLATE_HEADER` ב-`src/lib/guests/import-template.ts` הוא `שם מלא, טלפון, כמות, קבוצה`, והן מוצגות בטבלה בעמוד ובקובץ שמורד. לכן הקורא יראה טקסט אנגלי לצד כותרות עבריות. `guestImportHeaderKey` ב-`src/lib/data/guest-import-shared.ts` מקבל גם `name`, `phone`, `group` ו-`count`, ולכן המייבא יקרא תבנית עם כותרות באנגלית (נקרא בקוד, לא נבדק בהרצה). `import-template.ts` דורש כרגע קובץ זהה בשני המסכים, ולכן תבנית אנגלית היא החלטה נפרדת. זה ממשיך את סעיף 7.

### 34. `site.guestListTemplate.faq.items.rowPerInvite.answer` (משפחת כהן)
- **עברית:** משפחת כהן מקבלת הזמנה אחת...
- **הבחירה:** The Cohen family gets one invitation covering four people.
- **חלופה:** אין.
- **למה זה חשוב:** הקשר ישראלי שנשאר, לפי הבריף. בטבלה בעמוד השורה מופיעה בעברית, "משפחת כהן".

### 35. `site.guestListTemplate.faq.items.opensInExcel.answer` (הטענה על עברית)
- **עברית:** ...שזה מה שגורם לאקסל להציג עברית כמו שצריך.
- **הבחירה:** ...which is what makes Excel display Hebrew correctly.
- **חלופה:** למחוק את המשפט מהגרסה האנגלית
- **למה זה חשוב:** תורגם בנאמנות ורשום לפי הבריף. הטענה נכונה לקובץ, כי הוא בעברית, אבל נשמעת מוזרה למי שקורא באנגלית. היא תלויה בהחלטה בסעיף 33.

### 36. הצהרות בעמוד וואטסאפ (תורגמו בנאמנות, לא מאושרות משפטית)
- `site.whatsapp.limits.items.approvedTemplate`, `site.whatsapp.faq.items.anyText.answer`: טענה שוואטסאפ מאשרת את מבנה ההודעות מראש.
- `site.whatsapp.limits.items.eventOnly`: Messages are about the specific event and guest, not bulk advertising. התחייבות על תוכן ההודעות. החלופה "not promotional mailings" קרובה יותר ל"דיוור" ופחות מתאימה לוואטסאפ.
- `site.whatsapp.limits.items.stopRequest`: A guest who asks to stop receiving messages stops receiving them. התחייבות מוחלטת.
- `site.whatsapp.limits.items.noGuarantee`: הסתייגות על מסירה.
- `site.whatsapp.faq.items.howToSend.answer`: "WhatsApp's official business platform", אותה החלטה כמו סעיף 4.
- `site.whatsapp.meta.description`: "the official platform".
- `site.whatsapp.faq.items.guestsSeeEachOther.answer`, `site.whatsapp.points.items.personal.body`: מוזמן לא רואה אחרים, ו-"nobody is exposed to the guest list". אותה סתירה מול "Who else is coming", ראו סעיף 21.

### 37. `site.whatsapp.faq.items.noWhatsapp.answer` ("בכל דרך אחרת")
- **עברית:** הקישור האישי שלו ממשיך לעבוד בכל דרך אחרת...
- **הבחירה:** Their personal link still works by any other route...
- **חלופה:** Their personal link still works if you share it another way
- **למה זה חשוב:** העברית לא אומרת איך הקישור מגיע למוזמן. החלופה ברורה יותר, אבל מוסיפה שבעל האירוע הוא שמעביר אותו, ולא אימתתי זאת.

### 38. `site.faq.*` (תוכן השאלות)
- **הבחירה:** תורגמו רק הכותרות, התוויות והקישורים שב-`public.json`.
- **למה זה חשוב:** השאלות והתשובות מגיעות ממסד הנתונים (`getPublishedFaqItems`), וכרטיס המחיר נבנה מ-`summary_he`. בעמוד אנגלי המסגרת תהיה באנגלית והתוכן בעברית. גם `site.eventType.wedding.faq.q5.answer` וקישורי "on the FAQ page" מובילים לתוכן הזה.

## סבב 2: `whatsappErrors.json`

### 39. הקובץ לא בשימוש עדיין
- **הבחירה:** תורגם כולו: 98 ערכים, שהם 96 קודים, `range.200-299` ו-`unknown`.
- **למה זה חשוב:** `src/lib/whatsapp/error-labels.ts` מייבא את `he/whatsappErrors.json` ישירות וקובע `lng: 'he'`. התרגום לא יוצג לאף אחד עד שהקוד ישתנה, וזה תואם לכך שהקהל הוא צוות KALFA.

### 40. פערים בין העברית לבין הטקסט של Meta (תורגמה העברית, כמו שנדרש)
- `131049`: העברית "מגבלת הודעות שיווק לנמען", ו-Meta כותבת "not delivered to maintain healthy ecosystem engagement". האנגלית: Marketing message limit for this recipient.
- `130429`: העברית "חריגה מקצב השליחה", ו-Meta כותבת "message throughput has been reached". האנגלית: Sending rate limit exceeded.
- `131048`: העברית לא מזכירה שהסיבה יכולה להיות הודעות שנחסמו או סומנו כספאם. האנגלית נאמנה לעברית.
- `100`: העברית רחבה מהטקסט של Meta בכוונה, כי הקוד משמש כמה ממשקי API.
- `102`, `3`: הקטלוג של Graph נותן רק "API Session" ו-"API Method", ולכן אין נוסח מלא להשוות אליו.
- `132018`: העברית "משתנים", ו-Meta כותבת "parameters".

### 41. תרגומי Locize ב-`whatsappErrors.json`
- **נבדקו:** 20 מתוך 20. 15 שונו, ו-5 נשארו: `1`, `10`, `102`, `130403`, `130472`.
- **סיבות השינוי:** "application" במקום "app", "token" במקום "access token", "Unauthorized", חוסר אחידות ב-WhatsApp Business Account, ו-`506` שאמר "content" ו-"repeatedly". `130429` היה "Rate limit exceeded", בלי "קצב השליחה".

## סבב 2: כותרת האתר

### 42. `site.header.menu.description`, `site.header.nav.pageAriaLabel` (היקף התפריט)
- **עברית:** תפריט ניווט לעמוד הבית / ניווט בעמוד
- **הבחירה:** Homepage navigation menu / In-page navigation
- **חלופה:** Site navigation menu / Site navigation
- **למה זה חשוב:** שני הערכים נשמעים רק בקורא מסך. התפריט הנפתח ב-`landing-mobile-nav.tsx` מוצג בכל עמודי האתר, וכולל גם קישורים ל-`/faq` ול-`/contact`, ולכן העברית צרה ממה שיש בו. תורגם בנאמנות. אם העברית תשתנה, צריך לעדכן גם כאן.

## סבב 3: דפי אורח ואימות

### 43. `guest.eventType.other` (בעיה במקור)
- **עברית:** אחר
- **הבחירה:** event, ולכן "See you at the event."
- **חלופה:** other, שנותן "See you at the other."
- **למה זה חשוב:** הערך מוצג רק בתוך `r.form.success.summary_*`. המילה "אחר" היא שם של אפשרות בטופס, ובתוך המשפט העברי היא שבורה: "נתראה באחר". באנגלית תרגמתי לפי התפקיד במשפט. כדאי לתקן גם בעברית, למשל "נתראה באירוע". `event-labels.test.ts` מחייב שהעברית כאן תהיה שווה ל-`EVENT_TYPE_LABELS`, ולכן תיקון בעברית דורש ערך נפרד למשפט.

### 44. `guest.eventType.henna`, `guest.heading.henna`, `g.landing.greeting.henna`, `ty.landing.greeting.henna`
- **עברית:** חינה / החינה של {{names}} / ליל חינה שמח! / ליל החינה
- **הבחירה:** henna night, בכל ארבעת המפתחות
- **חלופה:** henna party או henna ceremony
- **למה זה חשוב:** "henna" לבדו נקרא כשם הצבע, ולא כשם אירוע. בעברית כתוב "ליל חינה" בשתי הברכות, ו-henna night הוא התרגום הישיר שלו. שלוש הצורות קיימות במקורות ([Wikipedia](https://en.wikipedia.org/wiki/Henna_ceremony), snippet). במקורות יהודיים באנגלית מצאתי בעיקר henna ceremony ([Jewish Journal](https://jewishjournal.com/community/277707/the-charm-of-jewish-henna-ceremonies/), snippet). לכן החלופה סבירה, אם הבעלים מעדיף אותה.

### 45. `guest.heading.*` (מבנה הכותרת)
- **עברית:** החתונה של {{names}} / בר המצווה של {{names}} / יום ההולדת של {{names}}
- **הבחירה:** The wedding of {{names}}, The engagement of {{names}}, The henna night of {{names}}, The bar mitzvah of {{names}}, The bat mitzvah of {{names}}. ליום הולדת: Birthday party for {{names}}.
- **חלופה:** {{names}}'s wedding
- **למה זה חשוב:** הצורה עם 's קצרה יותר, אבל נשברת בשם שמסתיים ב-s, ונדבקת לשם בכתב עברי (סעיף 49). "The birthday of {{names}}" נשמע נוקשה, ולכן יום ההולדת יוצא מהתבנית. המילה party תואמת ל-`guest.eventType.birthday`.

### 46. `guest.celebrants.parentsHonoring` (לכבוד)
- **עברית:** {{parents}} — לכבוד {{child}}
- **הבחירה:** {{parents}}, celebrating {{child}}
- **חלופה:** {{parents}}, in honor of {{child}}
- **למה זה חשוב:** "in honor of" קרוב יותר למילה העברית, אבל honor/honour מפצל איות בין ארצות הברית לבריטניה, וזה נגד כלל האיות במילון המונחים. הטקסט מוצג אחרי `guest.heading.parents`, למשל "Parents: X, celebrating Y". אם הבעלים יבחר איות אמריקאי, החלופה עדיפה.

### 47. `guest.heading.celebrants` (בעלי השמחה)
- **עברית:** בעלי השמחה: {{names}}
- **הבחירה:** Celebrating {{names}}
- **חלופה:** Celebrants: {{names}}
- **למה זה חשוב:** השורה מוצגת רק באירוע מסוג "אחר" שיש בו שמות. "celebrant" משמש גם למי שעורך את הטקס, ובאוסטרליה זה תפקיד מוגדר בחוק ([Wikipedia](https://en.wikipedia.org/wiki/Celebrant_(Australia)), snippet), ולכן הוא עלול להיקרא כעורך הטקס. הבחירה ממשיכה את סעיף 9: בלי מונח אחד לבעלי השמחה. אם `{{names}}` הוא שם משפחה, למשל "משפחת כהן", המשפט עדיין עובד.

### 48. `g.landing.greeting.*` (מזל טוב)
- **עברית:** מזל טוב!
- **הבחירה:** Mazel tov!
- **חלופה:** Mazal tov! (הצורה הישראלית), או Congratulations!
- **למה זה חשוב:** Merriam-Webster מביא את mazel tov כערך ואת mazal tov כצורה חלופית ([Merriam-Webster](https://www.merriam-webster.com/dictionary/mazel%20tov), snippet). זו ברכה שנכנסה לאנגלית, ולכן בחרתי את האיות שקורא אנגלי מכיר. בסעיף 6 בחרתי brit milah כי זה שם פורמלי של טקס, וכאן אין צורה פורמלית להעדיף. בניגוד ל-simcha (סעיף 9), מילוני אנגלית כלליים מתעדים את הביטוי. אורח שאינו יהודי יבין אותו מההקשר. לא מצאתי מקור לשיעור ההיכרות עם הביטוי.

### 49. שמות בעברית בתוך משפט אנגלי (`{{names}}`, `{{name}}`, `{{parents}}`, `{{child}}`)
- **הבחירה:** תורגם רק הטקסט שמסביב. השמות נשארים כפי שנשמרו.
- **למה זה חשוב:** השמות מוקלדים בידי בעל האירוע בטופס בעברית, ולכן עמוד באנגלית יציג למשל "The wedding of דנה and יואב". נקרא בקוד, לא נבדק בדפדפן. סעיף 25 מעלה את אותה שאלה לגבי `{{operator}}`.

### 50. `validation.rsvp.guests.required` (אורח)
- **עברית:** נא לציין לפחות אורח אחד
- **הבחירה:** Please enter at least one person
- **חלופה:** Please enter at least one guest
- **למה זה חשוב:** הכלל חל כשהאורח בחר "מגיע" ומספר המבוגרים והילדים הוא 0. הספירה כוללת את העונה עצמו, ו-"guest" נשמע כמו אדם נוסף, ולכן זו אותה החלטה כמו `r.form.success.summary_*`.

### 51. `cb.success.honeypot` (בעיה במקור)
- **עברית:** הפרטים נשמרו. נחזור אליך בהקדם.
- **הבחירה:** Your details have been saved. We'll call you back as soon as we can.
- **למה זה חשוב:** ההערה ב-`cb/[token]/actions.ts` אומרת שבוט מקבל את אותה הצלחה, אבל `cb.success.saved` כולל גם "תודה". האנגלית נאמנה להפרש הזה. אם הכוונה היא נוסח זהה, צריך להשוות קודם בעברית.

## סבב 3: אתר, טפסים ווידג'ט

### 52. נוסחי גילוי והסכמה (תורגמו בנאמנות, לא מאושרים משפטית)
"קלפה" נכתב KALFA בכל הנוסחים.

- `site.callMe.disclosure`
  - **עברית:** נחייג אליכם תוך דקות ספורות ונחבר אתכם לנציג מוקד קלפה. השיחה מוקלטת לצורך תיעוד ושיפור השירות.
  - **הבחירה:** We'll call you within a few minutes and connect you with a representative on KALFA's phone line. The call is recorded for documentation and to improve the service.
  - **חלופה:** a KALFA call center representative
  - **למה זה חשוב:** גילוי על הקלטה, שהמבקר מאשר בכפתור "Got it, continue". "מוקד" תורגם ל-phone line, כמו ב-`site.callMe.refusal.concurrency`, כדי לעקוף center/centre. "תיעוד" נשאר documentation, ולא "quality and training" המקובל, כדי לא לשנות את מטרת ההקלטה.
- `site.contact.form.callbackDisclosure`
  - **עברית:** החזרה עשויה להתבצע על ידי נציג אנושי או באמצעות סוכן דיגיטלי/קולי אוטומטי מטעם קלפה. בעקבות השיחה ייתכן שגם תישלח הודעת WhatsApp מטעם קלפה, בכפוף לאישורך במהלך השיחה עצמה.
  - **הבחירה:** The return call may be made by a human representative or through an automated digital/voice agent on behalf of KALFA. Following the call, a WhatsApp message may also be sent on behalf of KALFA, subject to your approval during the call itself.
  - **חלופה:** You may be called back by a human representative or...
  - **למה זה חשוב:** גילוי על סוכן אוטומטי ועל הודעה נוספת. שני הגילויים נשארו נפרדים, וגם התנאי "בכפוף לאישורך". "בעקבות השיחה" תורגם ל-Following, ולא ל-After, כי הוא אומר גם תוצאה ולא רק סדר בזמן. החלופה זורמת יותר, אבל "may" יכול להיקרא כספק אם תהיה שיחה בכלל, ובעברית הספק הוא רק מי יתקשר.
- `site.contact.form.salesConsent`
  - **עברית:** בבחירת נושא "מכירות" אני מבקש/ת שיחזרו אליי בנוגע לרכישת שירותי קלפה, לרבות מידע ופרטים לפני רכישה.
  - **הבחירה:** By choosing the "Sales" topic, I am asking to be called back about purchasing KALFA's services, including information and details before purchase.
  - **חלופה:** ...I am asking you to get back to me about...
  - **למה זה חשוב:** הסכמה לשיחת מכירות. "Sales" זהה ל-`site.contact.form.topics.sales`. "שיחזרו אליי" כללי יותר מ-called back, אבל המשפט מוצג רק בטופס החזרה הטלפונית, ליד הכפתור Call me back. החלופה שומרת על הכלליות, ו-"get back to me" פחות מפורש לגבי שיחה. "מבקש/ת" תורגם ל-"I am asking", בלי קיצור, בגלל משקל המשפט.
- `site.contact.form.privacyNote`
  - **עברית:** הפרטים ישמשו למענה לפנייה בלבד. <privacy>מדיניות פרטיות</privacy>
  - **הבחירה:** Your details will be used only to respond to your request. <privacy>Privacy policy</privacy>
  - **חלופה:** ...to respond to your message.
  - **למה זה חשוב:** התחייבות על מטרת השימוש בפרטים. הערה זו מוצגת בטופס ההודעה, בטופס החזרה הטלפונית וב-`/cb`, ולכן "request" מתאים לכולם, ו-"message" (המונח ל"פנייה" בעמוד יצירת קשר) לא מתאים לבקשת שיחה.

### 53. `site.callMe.smsCode`
- **עברית:** קוד האימות שלך ל-KALFA: {{code}}
- **הבחירה:** KALFA verification code: {{code}}
- **חלופה:** Your KALFA verification code: {{code}}
- **למה זה חשוב:** ה-SMS מחויב לפי מקטעים. הנוסח באורך העברית (25 תווים מול 24, בלי הקוד), וכולו תווי ASCII. ירדה רק המילה "שלך", והמשמעות לא משתנה. החלופה גם היא במקטע אחד. נספר ידנית, לא נשלח SMS.

### 54. `site.legal.companyId`
- **עברית:** ח.פ./ע.מ. {{id}}
- **הבחירה:** Company/business no. {{id}}
- **חלופה:** Company no. {{id}}, או VAT no. {{id}}
- **למה זה חשוב:** העברית מכסה שני סוגי רישום, ואין לכך מקבילה באנגלית. "ח.פ." הוא מספר חברה ו"ע.מ." הוא מספר עוסק. "VAT no." לא מתאים לעוסק פטור, ולכן בחרתי ניסוח כללי. כדאי להחליט לפי סוג הרישום בפועל. גם `site.legal.companyDetails` אומר "Company details", כמו המקור.

### 55. `site.home.preview.*` (תצוגה לדוגמה)
- `site.home.preview.eventMeta`: "אולמי השרון" הוא HaSharon Halls. שם המקום נשמר, ו-"Halls" מובן יותר מתעתיק מלא (Ulamei HaSharon).
- `site.home.preview.guests.levi.name`: Levi family, בלי "The". העיגול בשורה מציג את האות הראשונה של השם (`g.n[0]`), ועם "The" הוא היה מציג T.
- `site.home.preview.invitedTotal`: "340 invited", מקביל ל-"248 confirmed". כאן ההבחנה בין מוזמנים למאשרים חשובה, ולכן לא "340 guests".
- `site.home.preview.stats.responseRate`: "Response rate" ארוך מ"היענות", והאריח צר. לא נבדק בדפדפן אם המילים נשברות לשתי שורות.

### 56. `site.callMe.refusal.badBody`, `site.callMe.refusal.bodyTooLarge` (ניסוח טכני במקור)
- **עברית:** גוף הבקשה אינו תקין / בקשה גדולה מדי
- **הבחירה:** This request isn't valid / This request is too large
- **חלופה:** The request body isn't valid (מילולי)
- **למה זה חשוב:** "גוף הבקשה" הוא מונח טכני שהמבקר לא יכול לעשות איתו דבר. ההודעה מופיעה רק כשהבקשה עצמה פגומה, ולא בגלל טעות של המבקר. הורדתי את "body" באנגלית, והעברית נשארה טכנית.

## סבב 3: באנר העוגיות

### 57. `cookieConsent.json` (כל 20 המפתחות, תורגמו בנאמנות, לא מאושרים משפטית)
- **מפתחות:** `consentModal.*` (6), `preferencesModal.*` (5), `sections.analytics.*` (2), `sections.intro.description`, `sections.marketing.*` (2), `sections.moreInfo.*` (2), `sections.necessary.*` (2).
- **למה זה חשוב:** זה הנוסח שעליו המבקר נותן הסכמה. שתי הקטגוריות נשארו נפרדות בכל מקום, וכך גם ההסתייגויות: "רק אם תאשרו", "אישור האנליטיקה בלבד אינו מפעיל אותו", "כבויה כברירת מחדל" ו"ביטול ההסכמה מוחק". השמות `Google Analytics`, `Google Ads`, `Google Signals`, `Supabase`, `_ga*` והתגים נשמרו. המשלב בלי קיצורים (cannot, does not), כמו המשלב הרשמי של העברית, בניגוד לשאר האתר.
- **מחוץ לתרגום:** `cookie-consent-config.test.ts` מצמיד כל `CONSENT_REVISION` ל-SHA-256 של הקובץ העברי בלבד. באנר באנגלית יציג נוסח שאף גרסת הסכמה לא מצמידה. הבעלים צריך להחליט מה לעשות בזה לפני שמפעילים אנגלית.

### 58. `cookieConsent.json`: החלטות מונחים
- **חיוניות:** essential, ו-Essential only בכפתור. החלופה היא strictly necessary, המונח של ה-ICO הבריטי לפי מקורות משניים ([Hogan Lovells](https://engage.hoganlovells.com/knowledgeservices/news/icos-call-to-action-for-uk-website-cookie-banners), snippet). הוא חזק יותר מהמילה העברית, ולכן לא בחרתי בו.
- **אישור והסכמה:** העברית משתמשת בשתי מילים, ונשמרו שתיים: approve, approval ל"אישור", ו-consent ל"הסכמה". היוצא מהכלל הוא הכפתור "אישור הכול", שתורגם ל-Accept all, הנוסח המקובל. החלופה Approve all אחידה יותר ופחות מוכרת.
- **ביטול ההסכמה:** withdrawing consent. עוקף גם cancelling/canceling.
- **מודעות מותאמות:** tailored ads. "personalized" מפצל איות.
- **פרטים (כפתור):** Details, נאמן למקור, למרות שהכפתור פותח את ההעדפות. החלופה Manage preferences ברורה יותר, אבל אומרת יותר מהעברית.
- **בעליו (של האירוע):** host, לפי המילון.
- **האזור האישי (בתוך משפט):** your account area. התווית באתר היא my account.
- **בחירת הארגון הפעיל:** selection of the active organization. חריג לכלל האיות הניטרלי: זו עוגייה ממשית, `active_org`, ו-`/cookies` מתאר אותה כבחירת ארגון. בנוסח משפטי הנאמנות גוברת על כלל האיות. המונח team נשאר ל-`join.*` בלבד.
- **מרכז המודעות שלי:** My Ad Center, השם של המוצר ב-Google ([Google](https://www.blog.google/technology/safety-security/my-ad-center/), snippet). עמוד העזרה בבריטניה כותב Centre ([Google Help](https://support.google.com/My-Ad-Center-Help/answer/12155154?hl=en-GB), snippet). כאן נשמר השם, ולכן הכלל על איות ניטרלי לא חל. בבאנר זה טקסט רגיל בלי קישור, בניגוד ל-`/cookies`.
- **נכס:** property, המונח של Google Analytics ([Google Analytics Help](https://support.google.com/analytics/answer/9445345?authuser=2), snippet).

### 59. `sections.marketing.description` (מול הקוד)
- **הבחירה:** תורגם כמו המקור: "you can approve one without the other".
- **למה זה חשוב:** ההערה ב-`cookie-consent-config.ts` אומרת שאישור השיווק בלי האנליטיקה לא משפיע בפועל, כי התג נטען רק עם אנליטיקה. `/cookies` אומר זאת במפורש, והבאנר לא. נקרא בקוד, לא נבדק בדפדפן. אם הבעלים ירצה לציין זאת בבאנר, צריך לשנות קודם את העברית.

## סבב 3: תיאור דף הבית

### 60. `site.home.meta.description`
- **עברית:** מערכת אישורי הגעה לחתונה ולכל אירוע: ניהול רשימת מוזמנים ומלווים, שליחת הזמנות ותזכורות בוואטסאפ, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד.
- **הבחירה:** An RSVP system for a wedding or any event: guest list and plus-ones, WhatsApp invitations and reminders, real-time reply tracking and reports, all in one place.
- **חלופה:** ...manage guests and plus-ones, send WhatsApp invitations and reminders, track replies in real time, all in one place.
- **למה זה חשוב:** הערך באורך 160 תווים בדיוק, הגבול של Google. ירדה המילה "ניהול", כדי לשמור על כל הפריטים. החלופה שומרת עליה, אבל מורידה את "דוחות". התיאור נמצא ב-`src/app/layout.tsx`, ולכן הוא מוצג גם בעמוד שאין לו תיאור משלו.

## שינויים במקור העברי

- `r.closed.notice`: המקור שונה ל"למי שהזמין אתכם". האנגלית עכשיו "you can contact the person who invited you". החלופה "whoever invited you" שומרת על סתמיות המספר, אבל נשמעת מזלזלת יותר.
- `site.home.trust.subtitle`: המקור שונה ל"לתת לכם", והאנגלית פונה עכשיו ל-"you". הנוסח הסופי בקטע "יישום הביקורת".

## יישום הביקורת

- `site.whatsapp.limits.eyebrow`: יושם, "Important to know up front".
- `site.guestListTemplate.closing.subtitle`: נשאר. ההצעה היא שבר משפט בלי פועל, והאיברים בה לא מקבילים.
- `site.home.closing.subtitle`: יושמה החלופה "Orderly", כי "organized" מפצל איות. הנקודתיים הוחלפו בנקודה, כמו במקור הנוכחי.
- `site.home.solution.subtitle`: יושם עם "orderly", מאותה סיבה.
- `site.home.trust.subtitle`: יושם והותאם ל-"give you", "full control of the process, with peace of mind".
- `error.generic.body`: יושם, "come back later".
- `site.error.generic.body`: יושם, "come back later".
