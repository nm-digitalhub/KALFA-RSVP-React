# מילון מונחים: עברית לאנגלית (`public.json`)

קהל היעד: אורחים דוברי אנגלית באירועים ישראליים ויהודיים, מארצות הברית ומבריטניה. אנגלית בינלאומית ניטרלית.

המקורות נבדקו בחיפוש ברשת ב-5.11.2026. כל קישור הוחזר בחיפוש ולא נכתב מהזיכרון. "משני" פירושו שלא נמצא עמוד רשמי. כשלא נמצא מקור, כתוב שלא נמצא.

הקישורים שנוספו בסבב 2 הוחזרו בחיפוש, אבל העמודים עצמם לא נפתחו, ולכן הם ברמת snippet גם כשלא צוין כך בשורה.

## מונחים

| עברית | אנגלית | למה | Source |
| --- | --- | --- | --- |
| אישור הגעה, אישורי הגעה | RSVP, RSVPs | שם עצם שפירושו תשובה להזמנה. הרבים הוא RSVPs. | [Wiktionary](https://en.wiktionary.com/wiki/RSVP), [Britannica](https://www.britannica.com/dictionary/RSVP) |
| שליחת אישור (כפתור) | Submit RSVP | הטופס שולח גם סירוב, ולכן לא "Confirm". גם "Send RSVP" קיים, ו-"Submit your RSVP" נמצא ב-Joy. | [Joy](https://withjoy.com/help/en/articles/8314954-how-do-i-rsvp), [Nearlyweds](https://nearlyweds.freshdesk.com/support/solutions/articles/5000642517-how-do-i-respond-to-rsvp-guest-) |
| האם תגיעו? | Will you be attending? | השאלה הבסיסית בטפסי RSVP, ומתאימה לכל מגדר ומספר. | [Joy](https://withjoy.com/blog/25-must-ask-wedding-rsvp-questions-for-a-perfect-guest-list-in-2026/), [WedSites](https://docs.wedsites.com/rsvp/form/customizing-rsvp-form-wording) |
| מגיע/ה, אולי, לא מגיע/ה (`r.form.status.*`) | Attending, Maybe, Not attending | עברו ל-`public.json` בסבב 2. ניסוח ניטרלי, בלי שדה מגדר. "Joyfully accepts" שייך לכרטיסים רשמיים. | [RSVPify](https://community.rsvpify.com/hc/en-us/community/posts/22893673472020-Not-Attending-RSVP), [schema.org](https://schema.org/RsvpResponseMaybe), [Paperlust](https://paperlust.co/blog/wedding-rsvp-wording-examples/) |
| מי עוד מגיע | Who else is coming | תרגום ישיר וטבעי. לנוסח עצמו לא נמצא מקור, ו-Evite קורא לרשימה guest list. | [Evite](https://support.evite.com/products/invitations/manage-and-edit-guest-list/hide-guest-list) |
| מוזמן, מוזמנים, אורח, אורחים | guest, guests | באנגלית אין הבחנה טבעית. "invited guests" רק כשההבחנה חשובה (`site.about.does.limits`). | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/guest) |
| מלווים | plus-ones | המונח המקובל למי שמגיע יחד עם המוזמן. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/plus-one), [Dictionary.com](https://dictionary.com/browse/plus-one) |
| בעל האירוע, בעלי אירועים | host, hosts | מי שמזמין ומארח אורחים. ניטרלי מגדרית, ועוקף את הפיצול organizer/organiser. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/host_1?q=host), [Merriam-Webster](https://www.merriam-webster.com/simple/host) |
| בעלי השמחה | לא תורגם כמונח (ראו `notes.md`, סעיף 9) | אין מילה אנגלית אחת לכל סוגי האירועים. "the happy couple" נכון רק לחתונה. | [Wikipedia: Simcha](https://en.wikipedia.org/wiki/Simcha) |
| בר ובת מצווה | bar and bat mitzvahs | "bat" הוא הערך הראשי, ו-"bas" צורה פחות נפוצה. הרבים האנגלי מובן לאורח כללי יותר מ-"b'nei mitzvah". | [Merriam-Webster](https://www.merriam-webster.com/dictionary/bat%20mitzvah), [Wiktionary](https://en.wiktionary.com/wiki/bar_mitzvah) |
| ברית, בריתות | brit milah, ברבים brit milah ceremonies | הצורה הישראלית והפורמלית, ו-bris היא הצורה האשכנזית (ראו `notes.md`, סעיף 6). לרבים באנגלית אין צורה מוסכמת. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/brit%20milahs), [My Jewish Learning](https://www.myjewishlearning.com/article/planning-a-brit-milah-bris/) |
| חתונה | wedding | ללא שינוי. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/wedding) |
| אירועים משפחתיים | family celebrations; family gathering בתוך `audiences.subtitle` | "family gathering" מתועד במילון. הצירוף "family celebrations" לא נבדק במילון, ונבחר כי הוא חם יותר מ-family events. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/gatherings), [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/gathering) |
| אירועי חברה, כנס חברה | company events, company conference | נרדף פשוט ל-corporate event, שהוא המונח בענף. נבחר כי הוא פחות רשמי. | [Curated Events](https://curatedevents.com/blog/what-is-a-corporate-event/) (משני) |
| הזמנה; הזמנת האירוע (`alt`) | invitation; Event invitation | ללא שינוי. | [Dictionary.com](https://dictionary.com/browse/invite?qsrc=2446) |
| קישור | link | הצורה הקצרה של hyperlink. | [Dictionary.com](https://www.dictionary.com/browse/hyperlink?r=66) |
| אינו תקף או שאינו זמין עוד | invalid or no longer available | "no longer available" הוא ניסוח כללי נפוץ, שאינו מגלה את הסיבה. | [Mozilla Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=1000131) |
| תשובה, תגובה | reply, replies | מילה אחת לשתי המילים העבריות. "reply card" הוא המונח לכרטיס התשובה. | [The Knot](https://www.theknot.com/content/do-i-include-reply-cards-if-guests-rsvp-online) |
| תזכורת | reminder | ללא שינוי. | [iCustomLabel](https://icustomlabel.com/blogs/wedding-decor-and-gifts/rsvp-reminder-message-and-response-examples) |
| רשימת מוזמנים | guest list | המונח המילוני. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/guest%20list) |
| גיליון, גיליונות | spreadsheet, spreadsheets | כך נקרא הקובץ בתבניות רשימת אורחים. "sheet" לבדו לא ברור. | [Spreadsheet Daddy](https://spreadsheetdaddy.com/templates/wedding-guest-list-spreadsheet) |
| אולם | venue | המקום שבו האירוע מתקיים, ומתאים גם למקום שאינו אולם. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/venue) |
| מסודר, מסודרת | orderly לרשימה ולמערכת; Streamlined לתקשורת (`communication.title`); well-run לאירוע | "tidy" מסומן כבריטי, ו-"organized" מפצל איות בין המדינות. "orderly" לא שגור עם תקשורת או עם אירוע. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/tidy_1) |
| ספקים | vendors | בארצות הברית vendors, בבריטניה suppliers. פיצול אמיתי, ראו `notes.md`, סעיף 11. | [The Knot](https://www.theknot.com/content/wedding-vendor-checklist), [The Wedding Directory UK](https://theweddingdirectory.co.uk/wedding-suppliers/page/48/) |
| העדפת תפריט | Meal preference | נאמן למקור. נפוצים גם Meal choice (בחירה מרשימה) ו-Dietary requirements, אבל השדה הוא טקסט חופשי, ו-requirements מוסיף מחויבות שאינה במקור. | [Paperlust](https://paperlust.co/blog/meal-choice-wording-wedding-rsvp/), [The Knot](https://www.theknot.com/content/reception-entree-options-on-invites) |
| ילדים | Children | כרטיסי RSVP מפרידים בין adults ל-children. המקור הוא פורום. | [WeddingWire](https://www.weddingwire.com/wedding-forums/rsvp-card-wording-helphow-can-we-ask-how-many-childreninfants-are-coming/ea539ec03ad8802b.html) |
| לא חובה | optional | הצורה המקובלת בטפסים, בסוגריים אחרי התווית. | [Adobe Spectrum](https://spectrum.adobe.com/page/field-label) |
| ניווט (קישור Waze) | Navigate with Waze | תיאור ישיר של הפעולה, עם השם Waze על הכפתור. נוסח רשמי של Waze לא נמצא. | [Google Navigation Connect](https://developers.google.com/maps/documentation/navigation/connect/launch-navigation-app) |
| ניווט ויומן (כפתור) | Directions & calendar | אלה השמות בהזמנות מקוונות: Directions ו-Add to calendar. | [Punchbowl](https://help.punchbowl.com/article/424-how-do-i-add-directions-for-my-guests), [Eventinfo](https://eventinfo.freshdesk.com/en/support/solutions/articles/1000333867-using-the-add-to-calendar-button) |
| שליחת מתנה | Send a gift | ברור וקצר. לא נכתב "money" כי המקור לא אומר זאת. | לא נמצא מקור לנוסח המדויק |
| אזור אישי | my account | תווית מוכרת באתרים באנגלית. "personal area" הוא תרגום מילולי. | [Baymard](https://baymard.com/ecommerce-design-examples/57-my-account-drop-down) |
| לוח ניהול | dashboard | המונח המקובל למסך שמרכז נתונים. | [Lenovo](https://www.lenovo.com/us/en/glossary/dashboard/) (משני) |
| תמונת מצב | At a glance | משמעו מבט מהיר, ומשמש גם לסיכום. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/a%20glance), [Dictionary.com](https://www.dictionary.com/e/slang/at-a-glance) |
| מערכת | KALFA, the system; the site בהודעות שגיאה | "the system" בפני עצמו נשמע קר, ואורח חושב על "אתר". | אין מקור: החלטת סגנון |
| פנייה (בעמוד יצירת קשר) | message | "inquiry" רשמי מדי, ויש לו גם פיצול enquiry/inquiry. | [City of Winnipeg Design System](https://legacy.winnipeg.ca/designsystem/form-templates/contact-forms) |
| שליחת פנייה | Send us a message בכותרת; Send message בכפתור | אותה עברית, תפקיד שונה בממשק. "Send message" נמצא. לכותרת המדויקת לא נמצא מקור. | [City of Winnipeg Design System](https://legacy.winnipeg.ca/designsystem/form-templates/contact-forms) |
| בקשת חזרה טלפונית | Ask us to call you back | תואם לכפתור Call me back. שם העצם callback מתועד במילונים אמריקאיים, ולא מצאתי לו אישור במילון בריטי. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/Callback), [Oxford American](https://www.oxfordlearnersdictionaries.com/definition/american_english/call-back) |
| חזרו אליי | Call me back | קצר וברור לכפתור. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/call-back) |
| דף הבית | homepage | מילה אחת, כמו ב-AP וב-The Guardian. המילונים חלוקים בין homepage ל-home page. | [Computer Hope](https://www.computerhope.com/jargon/h/homepage.htm), [Plainspell](https://plainspell.com/styleguide/home-page-vs-homepage/) |
| רשימת תפוצה | broadcast list | שם התכונה בוואטסאפ. | [Callbell](https://www.callbell.eu/en/broadcast-list-whatsapp/) (משני) |
| נשלחו יותר מדי בקשות | Too many requests | נאמן למקור, וזה הניסוח הכללי. "attempts" משמש לניסיונות כושלים, ומרמז על סיבה שהמקור לא אומר. | [Stytch](https://stytch.com/docs/api-reference/consumer/api/errors/429) |
| שאלות נפוצות | Frequently asked questions בכותרת העמוד; FAQ בתווית קטנה | התווית הקטנה מוצגת באותיות גדולות (`uppercase`), והנוסח הארוך צר בה. | [Oxford Learner's](https://www.oxfordlearnersdictionaries.com/definition/english/faq?q=faq), [Merriam-Webster](https://merriam-webster.com/dictionary/FAQ) |
| וואטסאפ, אקסל, גוגל שיטס | WhatsApp, Excel, Google Sheets | שמות מוצרים. עמודי מותג רשמיים לא נמצאו. | [Linguix](https://linguix.com/english/common-mistake/whats_app), [TechTerms](https://www.techterms.com/definition/excel), [Wikipedia](https://www.Wikipedia.org/wiki/Google_Sheet) (משני) |
| KALFA | KALFA | שם המותג, באותיות לטיניות. | אין מקור: דרישת הבריף |
| משתתף, משתתפים (`r.form.success.summary`) | person, people | המספר הוא מבוגרים ועוד ילדים, וכולל את העונה עצמו. "guests" נשמע כאילו מדובר באנשים נוספים עליו. | אין מקור: החלטת סגנון |
| ארגון (`join.*`) | team; בלי שם עצם ב-`join.invited` | תואם ל-`join.title` שעבר ביקורת ("Join the team"), ועוקף את הפיצול organization/organisation. | אין מקור: החלטת סגנון |
| שיחה חוזרת, החזרה (שם עצם) | call you back בפועל; Return call ב-`cb.meta.title`; return call ב-`site.contact.form.callbackDisclosure` | ממשיך את החלטת הסבב הראשון: בלי שם העצם callback. | אין מקור: החלטת סגנון |
| שבת, חג, שבת ובחג | Shabbat, Jewish holiday, Shabbat and Jewish holidays | "Shabbat" נפוצה יותר בקרב רוב הקוראים, ו-"Shabbos" נפוצה בקהילות אורתודוקסיות ממוצא מזרח־אירופי. "Jewish" מוסיף רק מה שהעברית מניחה, כי "holiday" לבדו לא ברור מחוץ לישראל. לא נמצאה הכרעה של מדריך סגנון. | [Seattle Times](https://archive.seattletimes.com/archive/20031219/hanukkah19/can-you-spell-hanukkah-sure-any-way-you-want) (snippet), [Etymonline](https://www.etymonline.com/word/Shabbat) (snippet, לתיארוך בלבד) |
| נציג | representative | אין פיצול באיות, ומתאים לשירות טלפוני. | אין מקור: החלטת סגנון |
| המוקד עמוס | Our phone lines are busy | עוקף את הפיצול call center/call centre. | אין מקור: החלטת סגנון |
| קוד אימות | verification code | המונח הרגיל בטפסי SMS. | אין מקור: החלטת סגנון |
| ...אינו תקין (טופס) | isn't valid | קצר וישיר בשגיאת שדה. "invalid" נשמר בהודעות הקישור שעברו ביקורת. | אין מקור: החלטת סגנון |
| תמונת מצב (שם עצם בתוך משפט) | overview; live overview | "At a glance" נשאר רק לתווית הקטנה שעברה ביקורת. "snapshot" קופא ברגע אחד, ולכן לא מתאים למשהו שמתעדכן. | אין מקור: החלטת סגנון |
| מארגן (במובן בעל האירוע) | host | אותו מונח כמו בעל האירוע, ועוקף את הפיצול organizer/organiser. | אין מקור: החלטת סגנון |
| אירוע מסודר | a well-run event | "orderly" נשאר לרשימה ולמערכת. "orderly event" נשמע כמו תיאור של קהל. | אין מקור: החלטת סגנון |
| תקנון | Terms of service | כותרת העמוד עצמו היא "תקנון ותנאי שירות", והמסמך כולל תמחור וביטול. תוצאות החיפוש ציינו ש-terms of service נפוץ יותר בשירותי תוכנה, בלי שאפשר לייחס זאת לעמוד מסוים. | [Enzuzo](https://www.enzuzo.com/blog/terms-of-service-vs-terms-of-use-vs-terms-and-conditions) (snippet), [Sprintlaw UK](https://www.sprintlaw.co.uk/articles/terms-of-use-vs-terms-and-conditions) (snippet) |
| פנייה (יוצאת למוזמן, כל ערוץ) | anything that goes out; message כשהערוץ ברור | "פנייה" כוללת גם שיחה, ו-"message" לבדו היה מצמצם את הטענה. | אין מקור: החלטת סגנון |
| חלון השליחה | sending window | תיאור ישיר, ומובן בלי הסבר. | אין מקור: החלטת סגנון |
| ממתינים (בגוף טקסט) | those who haven't replied yet | הנוסח שעבר ביקורת ב-`site.guestListTemplate.closing.subtitle`. | אין מקור: החלטה קודמת |
| היענות | response rates | שיעור המענה, ולא התשובות עצמן. "responses" חופף ל-RSVPs. | אין מקור: החלטת סגנון |
| אישורי הגעה ל... (כותרת עמוד) | Wedding RSVPs, Bar and bat mitzvah RSVPs, Brit milah RSVPs, Event RSVPs | הכותרת משמשת גם בקישורים הקשורים, בפירורי לחם וב-`{{h1}}, all in one place`, ולכן היא צריכה לעמוד לבד. | אין מקור: החלטת סגנון |
| בריתה | britah | משאירים את המונח, ומסבירים פעם אחת ב-`brit.guide.g2.body`. המקור מציין שזו הצורה הנקבית של brit. | [NOA Project](https://www.noa-project.eu/?p=5094) (משני) |
| זבד הבת | zeved habat | הצורה הראשית ב-Wikipedia. נמצאו גם Zeved HaBat ו-zeved ha-bat. | [Wikipedia](https://en.wikipedia.org/wiki/Zeved_habat), [JOFA](https://www.jofa.org/article/zeved-habat/) |
| עלייה לתורה | aliyah to the Torah; aliyah בכותרת | "aliyah" לבדו יכול להתפרש גם כהגירה לישראל, ולכן בגוף הטקסט כתוב במלואו. | [My Jewish Learning](https://www.myjewishlearning.com/article/aliyah/), [The JC](https://www.thejc.com/judaism/jewish-words/aliyah-d8fmz9ap) |
| בעלי השמחה (שדה באירוע) | the celebrant | רק ב-`barMitzva.faq.q3.answer`, שם מדובר בשדה `celebrants`. שאר ההחלטה בסעיף 9 לא משתנה. | [Jewish Australia](https://jewishaustralia.com/aliyah.asp) (משני) |
| אירוע מאורגן | structured event | עוקף organized/organised. ראו `notes.md`, סעיף 28. | אין מקור: החלטת סגנון |
| ערב חברה, אירוע עסקי | company evening, business event | "company" תואם למילון, ו-"business" תואם ל"עסקי". | אין מקור: החלטת סגנון |
| סבב, סבב אישורי ההגעה | round, RSVP round | תיאור ישיר של גל שליחה. | אין מקור: החלטת סגנון |
| לוח השליחה, לוח זמנים | sending schedule, schedule | מילה אחת לשני הצירופים. | אין מקור: החלטת סגנון |
| נקודות הזמן (בלוח השליחה) | the points still left in the sending schedule | תיאור ישיר. | אין מקור: החלטת סגנון |
| הפעלת אישורי ההגעה | activate RSVPs | מילת הפעולה במוצר. | אין מקור: החלטת סגנון |
| קישור אישי, קישור פרטי | personal link, private link | נשמרת ההבחנה של העברית. | אין מקור: החלטת סגנון |
| טיוטת הייבוא | import draft | תיאור ישיר. | אין מקור: החלטת סגנון |
| בלחיצה | with a tap | התשובה ניתנת בטלפון. | אין מקור: החלטת סגנון |
| קייטרינג | the caterer | מי שמקבל את המספרים, ולא השירות. | אין מקור: החלטת סגנון |
| חברי הכיתה, קבוצת הכיתה | classmates, the class group | ללא שינוי. | אין מקור: החלטת סגנון |
| רשימת כניסה | entry list | ללא פיצול באיות. | אין מקור: החלטת סגנון |
| שכנים | people who live nearby | עוקף neighbors/neighbours. | אין מקור: החלטת סגנון |
| שולחים אישורי הגעה | ask for RSVPs, collect RSVPs | RSVP הוא התשובה של האורח, ולכן בעל האירוע לא "שולח" אותו. | אין מקור: מסקנה מהגדרת המונח במילון |
| עמודת כמות, עמודת טלפון, עמודת קבוצה | quantity column, phone column, group column | תיאור, לא ציטוט של הכותרת. ראו `notes.md`, סעיף 33. | אין מקור: החלטת סגנון |
| טלפון נייד | mobile number | מובן בארצות הברית ובבריטניה. | אין מקור: החלטת סגנון |
| בן או בת הזוג | partner | מילה אחת, ניטרלית מגדרית. | אין מקור: החלטת סגנון |
| ביוזמת העסק | business-initiated | המונח הנפוץ להודעה שהעסק פותח בה. לא נמצא בעמוד רשמי של Meta בנוסח הזה. | [Braze](https://braze.com/docs/user_guide/message_building_by_channel/whatsapp/overview/) (משני) |
| תבנית (הודעת וואטסאפ) | template | מובחן מ-Guest list template לפי ההקשר. | אין מקור: החלטת סגנון |
| דיוור פרסומי | bulk advertising | "advertising" כמו בסעיף 2. "bulk" נושא את המשמעות של דיוור בלי המילה mailing, שלא מתאימה ל-WhatsApp. | אין מקור: החלטת סגנון |
| הטרדה (`remindersOnly.body`) | nuisance | "harassment" חזק מדי באנגלית ובעל משמעות משפטית. | אין מקור: החלטת סגנון |
| מנוהל באמצעות | Managed with | נאמן למקור. "Powered by" מוכר יותר, אבל מתאר טכנולוגיה ולא ניהול. | אין מקור: החלטת סגנון |
| תפריט, תפריט משתמש | Menu, User menu | תוויות נגישות של הכפתורים בכותרת האתר. | אין מקור: החלטת סגנון |
| ניווט ראשי, ניווט בעמוד | Main navigation, In-page navigation | תוויות נגישות של `<nav>`. "Page navigation" נקרא כמו מעבר בין עמודי תוצאות. | אין מקור: החלטת סגנון |
| התנתקות | Log out | הזוג של `site.header.login`, "Log in". | אין מקור: החלטה קודמת |
| עזרה ותמיכה | Help and support | "and" כמו ב-"Contact and support" וב-"Legal and support". | אין מקור: החלטה קודמת |
| מזל טוב | Mazel tov | הערך במילון, ו-mazal tov היא הצורה החלופית. ברכה שנכנסה לאנגלית, ולא שם פורמלי של טקס. ראו `notes.md`, סעיף 48. | [Merriam-Webster](https://www.merriam-webster.com/dictionary/mazel%20tov) (snippet), [Dictionary.com](https://dictionary.com/browse/mazel-tov) (snippet) |
| חינה, ליל חינה | henna night | התרגום הישיר של "ליל חינה". "henna" לבדו נקרא כשם הצבע. ראו `notes.md`, סעיף 44. | [Wikipedia](https://en.wikipedia.org/wiki/Henna_ceremony) (snippet) |
| אירוסין (בתוך `{{eventType}}`) | engagement party | לפי הבריף, כי "See you at the engagement" לא עובד. בברכות נשאר engagement. | אין מקור: דרישת הבריף |
| יום הולדת (בתוך `{{eventType}}`) | birthday party | לפי הבריף. | אין מקור: דרישת הבריף |
| אחר (סוג אירוע, `guest.eventType.other`) | event | הערך מוצג רק בתוך משפט. ראו `notes.md`, סעיף 43. | אין מקור: החלטת סגנון |
| בעלי השמחה (שורת משנה) | Celebrating {{names}} | ממשיך את סעיף 9. "Celebrants" עלול להיקרא כעורך הטקס. ראו `notes.md`, סעיף 47. | [Wikipedia](https://en.wikipedia.org/wiki/Celebrant_(Australia)) (snippet) |
| לכבוד | celebrating | עוקף honor/honour. ראו `notes.md`, סעיף 46. | אין מקור: החלטת סגנון |
| הוספה ליומן | Add to calendar | אותו שם כמו בשורת "ניווט ויומן". | [Eventinfo](https://eventinfo.freshdesk.com/en/support/solutions/articles/1000333867-using-the-add-to-calendar-button) |
| יומן Google, יומן Apple | Google Calendar, Apple Calendar | שמות מוצרים. לא נמצא עמוד רשמי בחיפוש. | לא נמצא מקור |
| קובץ יומן | calendar file | תיאור ישיר. ב-`guest.calendar.hint.icsDownload` נשאר `.ics`. | אין מקור: החלטת סגנון |
| דפדפן פנימי של אפליקציה | a browser inside an app | "in-app browser" הוא המונח הטכני, אבל אורח לא בהכרח מכיר אותו. | אין מקור: החלטת סגנון |
| רגע… (מצב המתנה בכפתור) | Just a moment… | אותו נוסח כמו `site.callMe.busy`. | אין מקור: החלטה קודמת |
| תשובה (לשאלה בטופס) | answer | כמו `r.errors.invalidAnswers`. "reply" נשאר למה שהאורח שולח כולו. | אין מקור: החלטה קודמת |
| שליחת מתנה ב־{{brand}} | Send a gift with {{brand}} | "with" כמו ב-"Navigate with Waze". | אין מקור: החלטה קודמת |
| נציג מוקד קלפה | a representative on KALFA's phone line | "phone line" כמו ב-"Our phone lines are busy". עוקף center/centre. | אין מקור: החלטה קודמת |
| נציג אנושי, סוכן דיגיטלי/קולי אוטומטי | human representative, automated digital/voice agent | נאמן למקור. הלוכסן נשמר, כדי לא להכריע בין "או" ל"וגם". | אין מקור: החלטת סגנון |
| נושא הפנייה (תווית) | Topic | תואם ל-"Please choose a topic". | אין מקור: החלטה קודמת |
| מכירות, תמיכה, חיוב ותשלום, אחר (נושאים) | Sales, Support, Billing and payment, Other | "Sales" מצוטט ב-`site.contact.form.salesConsent`, והשניים חייבים להיות זהים. | אין מקור: דרישת הבריף |
| בשעות הפעילות | during business hours | הצירוף הרגיל לשעות שירות. | אין מקור: החלטת סגנון |
| ח.פ./ע.מ. | Company/business no. | ראו `notes.md`, סעיף 54. | אין מקור: החלטת סגנון |
| דוא״ל | Email | אותה מילה כמו `site.contact.form.email`. | אין מקור: החלטה קודמת |
| מושבת זמנית | Temporarily disabled | תיאור ישיר של מצב הקטגוריה. | אין מקור: החלטת סגנון |
| היענות (תווית) | Response rate | צורת היחיד של response rates. | אין מקור: החלטה קודמת |
| אישרו, ממתין, לא מגיע (תצוגה לדוגמה) | Confirmed, Pending, Not attending | כמו `site.about.does.items.snapshot.body` וכמו `r.form.status.declined`. | אין מקור: החלטה קודמת |
| אולמי השרון | HaSharon Halls | שם בדוי. ראו `notes.md`, סעיף 55. | אין מקור: החלטת סגנון |
| עוגיות | cookies | ללא שינוי. | אין מקור: החלטה קודמת |
| עוגיות חיוניות, רק חיוניות | Essential cookies, Essential only | תרגום ישיר של "חיוני". strictly necessary חזק יותר. ראו `notes.md`, סעיף 58. | [Hogan Lovells](https://engage.hoganlovells.com/knowledgeservices/news/icos-call-to-action-for-uk-website-cookie-banners) (snippet, לחלופה בלבד) |
| אישור (בעוגיות), הסכמה | approve, approval; consent | נשמרו שתי מילים, כמו בעברית. | אין מקור: החלטת סגנון |
| אישור הכול | Accept all | הנוסח המקובל בכפתור. | אין מקור: החלטת סגנון |
| ביטול ההסכמה | withdrawing consent | בלי פיצול באיות. | אין מקור: החלטת סגנון |
| מודעות מותאמות | tailored ads | עוקף personalized/personalised. | אין מקור: החלטת סגנון |
| שיווק ורימרקטינג | Marketing and remarketing | שם הקטגוריה, ומצוטט ב-`sections.analytics.description`. | אין מקור: החלטת סגנון |
| נכס (Google Analytics) | property | המונח של Google. | [Google Analytics Help](https://support.google.com/analytics/answer/9445345?authuser=2) (snippet) |
| מרכז המודעות שלי | My Ad Center | שם המוצר. | [Google](https://www.blog.google/technology/safety-security/my-ad-center/) (snippet) |
| האזור האישי (בתוך משפט) | your account area | התווית נשארת my account. | אין מקור: החלטת סגנון |
| הארגון הפעיל (`sections.necessary.description`) | the active organization | חריג לכלל האיות, כמו My Ad Center. עוגייה ממשית (`active_org`) בנוסח משפטי, ולכן הנאמנות גוברת. שאר ה"ארגון" נשאר team ב-`join.*`. | אין מקור: החלטת הביקורת |

## מונחים ב-`whatsappErrors.json`

הקהל הוא צוות KALFA. המקור לכל השורות, אלא אם צוין אחרת, הוא הקטלוג ב-`docs/whatsapp-errors/error-codes.md`, שנשמר מ[עמוד קודי השגיאה של Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes). הקישור נלקח מהשדה `sourceUrl` בקטלוג שבריפו, ולא מחיפוש ברשת.

| עברית | אנגלית | למה |
| --- | --- | --- |
| חשבון הוואטסאפ העסקי | WhatsApp Business Account | שם המוצר אצל Meta, באותיות גדולות. |
| הפלטפורמה העסקית של וואטסאפ | WhatsApp Business Platform | שם מוצר, כי הקהל הוא צוות. בעמודים הציבוריים נשאר הניסוח התיאורי, ראו `notes.md`, סעיף 4. |
| מגבלת קצב, מגבלת קצב הבקשות | rate limit, API call rate limit | המונח של Meta. |
| נתון (בבקשה) | parameter | המונח של Meta. |
| משתנים, ערכים (בתבנית) | variables, values | נאמן לעברית. Meta כותבת גם parameters. |
| טוקן, טוקן גישה | access token | המונח של Meta, גם כשהעברית כותבת רק "טוקן". |
| קוד PIN של האימות הדו-שלבי | two-step verification PIN | המונח של Meta. |
| שם תצוגה | display name | המונח של Meta. |
| רישום, ביטול רישום | registration, deregistration | המונח של Meta. |
| העברה (של מספר או חשבון) | migration | המונח של Meta. "ownership transfer" רק בקוד 2593085. |
| מחיר מרבי | max price | המונח של Meta ב-`docs/whatsapp-errors/pricing.md`. בקוד ה-API זה `bid_spec`. |
| מזהה עסקי | business-scoped user ID | המונח של Meta. |
| תובנות על תבניות | template insights | המונח של Meta. |
| סיווג שגוי | misclassification | המונח של Meta, ללא פיצול באיות. |
| סנכרון | sync, syncing | עוקף synchronization/synchronisation. |
| הצטרפות (לקוח, חשבון) | onboarding, onboard | המונח של Meta. |
| דרך השליחה | sending route | העברית כללית בכוונה, כי תווית אחת משרתת כמה ממשקי API. |
| אין הרשאה | No permission | שלושה מפתחות, אותו נוסח. עוקף unauthorized/unauthorised. |

## כללי סגנון

| נושא | בחירה | למה |
| --- | --- | --- |
| איות | מילים בלי הבדל בין ארצות הברית לבריטניה | נמנעתי מ-organize, personalize, canceled, color. שני חריגים ב-`cookieConsent.json`: השם My Ad Center, והמילה organization, כי שם הנאמנות גוברת. |
| מקף ארוך (—) | לא בשימוש | בעברית הוא טבעי, באנגלית הוא נשמע מתורגם. הוחלף בנקודתיים, בפסיק או בנקודה. |
| פסיק לפני and ברשימה | לא בשימוש | אחיד בכל הקובץ. |
| מרכאות וסימן פיסוק | פסיק ונקודה מחוץ למרכאות | כך הטקסט המצוטט נשאר מדויק, ואחיד בכל הקובץ. |
| פנייה לאורח | you, you're | לא חושף מגדר או מספר. "you" מכסה את ההטיות של העברית (תגיעו, בחר/י, ספר/י). |
| מספרי טלפון ושמות מותג | בלי U+200E ובלי U+2011 | התווים האלה נחוצים רק בעברית. נבדק בסקריפט. |
| גוף שלישי לאדם לא מוגדר | they | שפה ניטרלית (`site.guestListTemplate.file.sampleNote`). |
| אורך ל-Google | `*.meta.title` עד 52 תווים, `*.meta.description` עד 160 | `layout.tsx` מוסיף ` \| KALFA` לכותרת. |
