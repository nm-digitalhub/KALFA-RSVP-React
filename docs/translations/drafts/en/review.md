# ביקורת התרגום לאנגלית: `public.json`

## 1. פסק דין

**מוכן אחרי תיקונים.** אין שגיאות תרגום, יש ערך אחד לתיקון וחמש העדפות. פסק הדין חל על הקובץ בלבד: לפני שמפעילים אנגלית צריך להחליף את כיוון העמוד, ואורח דובר אנגלית עדיין יראה עברית באותם מסכים (סעיף 5).

## 2. ממצאים

### 2א. ממצאים בתרגום

| מפתח | חומרה | ערך נוכחי | הצעה | סיבה | ראיה |
| --- | --- | --- | --- | --- | --- |
| `site.whatsapp.limits.eyebrow` | should fix (הבעלים מחליט, ראו 2ג) | Good to know up front | Important to know up front | ירידה בחוזק. "מה שחשוב לדעת מראש" חזק יותר מ-"Good to know". הכותרת פותחת את רשימת המגבלות: אישור תבניות, הפסקת הודעות, ומסירה לא מובטחת. בנוסף, הערך כמעט זהה ל-`mistakes.eyebrow` ("שווה לדעת", Good to know), אז שתי עוצמות שונות בעברית הפכו לאותה עוצמה באנגלית. | קוד: `whatsapp/page.tsx`, אזור המגבלות. |
| `site.guestListTemplate.closing.subtitle` | preference | Import this file to send a personal invitation for every row, with automatic reminders only to those who haven't replied yet. | Importing this file, a personal invitation for every row and automatic reminders only for those who haven't replied yet. | בעברית זו רשימה של שלושה דברים שווים, ובאנגלית היא הפכה למשפט של מטרה ותוצאה. המשמעות נשמרה: מייבאים כדי לשלוח. השינוי הוא במבנה בלבד. | קוד: `importGuestsAction` ב-`import-actions.ts` מכניס אורחים, ומצרף אותם לקמפיין אם כבר יש קמפיין פעיל. לכן המשפט הנוכחי אינו שגוי. |
| `site.home.closing.subtitle` | preference | Start managing your event's RSVPs today: tidy, clear and all in one place. | Start managing your event's RSVPs today: organized, clear and all in one place. (חלופה בלי פיצול איות: orderly) | המילון מסמן את "tidy" במובן של מסודר כ-especially British English, והדוגמאות שלו הן שולחן, דירה וחדר. מילון המונחים מבטיח אנגלית ניטרלית. "organize" הוא הערך הראשי גם במילון הבריטי של Oxford, אבל רוב מדריכי הסגנון הבריטיים כותבים organised. לכן זו העדפה ולא תיקון. | [Oxford: tidy](https://www.oxfordlearnersdictionaries.com/definition/english/tidy_1) (read), [Oxford: organize](https://www.oxfordlearnersdictionaries.com/definition/english/organize) (read), [Oxford spelling](https://en.wikipedia.org/wiki/Oxford_spelling) (read) |
| `site.home.solution.subtitle` | preference | Guests, invitations, RSVPs, reminders, statuses and updates: one tidy system that gives you full control. | Guests, invitations, RSVPs, reminders, statuses and updates: one organized system that gives you full control. | אותה סיבה. | כמו בשורה הקודמת. |
| `site.home.trust.subtitle` | preference | The goal is simple: prevent confusion, save time and give the host full, calm control of the process. | The goal is simple: prevent confusion, save time and give the host full control of the process, with peace of mind. | הצירוף "שליטה שקטה" נשמע מתורגם כבר בעברית, והתרגום העתיק אותו מילה במילה. "calm control" מתאר התנהגות של אדם. הכוונה היא שליטה בלי דאגה. הבעיה מתחילה במקור. | קריאה לפי `ai-hebrew-patterns.md`. |
| `error.generic.body`, `site.error.generic.body` | preference | There was a problem loading this page. Please try again, or come back a little later if it keeps happening. | There was a problem loading this page. Please try again, or come back later if it keeps happening. | בתרגום חזרה לעברית מתקבל "קצת מאוחר יותר", והמקור אומר "מאוחר יותר". "a little" מוסיף ציפייה קטנה שהתקלה תיפתר מהר. | מבחן Back-Translation מהרובריקה. |

### 2ב. בעיות במקור העברי (לא נספרות נגד התרגום)

| מפתח | הבעיה | מה לעשות |
| --- | --- | --- |
| `cb.form.contact.label`, `cb.form.contact.placeholder` | העברית סותרת את עצמה. בעברית ישראלית "איך לפנות אליך?" הוא קודם כול שאלה על שם. הטקסט מתחתיה מזמין טלפון או אימייל, אבל השדה נשמר כ-`full_name`, עם `autoComplete="name"`, והשגיאה היא "נא למלא שם". העמוד כבר אומר שנחזור למספר שמסתיים בספרות מסוימות, והקוד קובע שהטופס הזה לא אוסף טלפון. מי שיקליד מספר אחר יחשוב ששינה אותו, והשיחה תגיע למספר המקורי. "Your contact details" נאמן לטקסט העברי, אבל מחזק את אותה טעות. הוא גם לא שאלה, למרות שהכותרת מבטיחה שאלות. | קודם לתקן את העברית לשם בלבד. אחר כך להחליף את שני הערכים ביחד: What should we call you? ו-Your name. החלפת התווית לבדה תיצור סתירה מול הטקסט שמתחתיה. |
| `cb.header.subtitle` | "שתי שאלות קצרות", אבל בטופס יש שלושה או ארבעה שדות: שם, נושא, מועד (כשלא נקבע) והערה. | לתקן בעברית, ואז באנגלית. |
| `r.form.success.updateHint` | "בכל רגע" (at any time) לא נכון תמיד. `can_respond` נסגר אחרי המועד האחרון לתשובה או אחרי יום האירוע, ואז הטופס לא מוצג. התרגום נאמן למקור. | להחליט על נוסח בעברית, ואז לתרגם מחדש. |
| `r.form.showInGuestList.label`, `r.attendees.title` | בעברית התיבה אומרת "מי מגיע" והכותרת אומרת "מי עוד מגיע". באנגלית השמות כבר שווים. | להשוות גם בעברית. |

### 2ג. הסכמה, משפט ופרטיות (דיווח בלבד, הבעלים מחליט)

| מפתח | שינוי בחוזק או בהיקף | אפשרויות |
| --- | --- | --- |
| `r.form.showInGuestList.label` | אין שינוי בחוזק או בהיקף: הסכמה להופיע בשם פרטי בלבד. שם הרשימה הוחלף ל-"Who else is coming", כדי להתאים לכותרת שהאורח רואה. | הנוכחי, או: Show my first name on the "Who else is coming" list |
| `site.about.does.limits` | אין שינוי. "advertising" שומר על היקף המילה "פרסום", ו-"marketing" היה מרחיב אותו. הערת ניסוח: בתוצאות החיפוש mass advertising מופיע כפרסום בכלי תקשורת, ולא כמשהו ששולחים. המילה "messages" לא מרחיבה את ההיקף. | הנוכחי, או: ...it doesn't send mass advertising messages. ([Marketing91](https://www.marketing91.com/mass-marketing) snippet, [Adogy](https://www.adogy.com/terms/mass-marketing/) snippet) |
| `site.home.hero.private` | אין שינוי. | הנוכחי. החלופה בהערות התרגום מוסיפה משמעות שאינה במקור. |
| `site.whatsapp.hero.subtitle` | אין שינוי. | הנוכחי (תיאור), או: the official WhatsApp Business Platform (שם מוצר, טענה מפורשת יותר). |
| `site.whatsapp.limits.title` | אין שינוי. | הנוכחי, או: WhatsApp has rules, and we work within them |
| `site.whatsapp.limits.eyebrow` | **ירידה בחוזק**, ראו 2א. | הנוכחי, או: Important to know up front |

## 3. טענות התרגום שנבדקו

| טענה | תוצאה | ראיה |
| --- | --- | --- |
| הערה 8: השדה הוא `full_name`, הקוד מצפה לשם, ויש שתי קריאות לעברית | עמדה | קוד: `intake-form.tsx`, `inquiries.ts` |
| הערה 2: "marketing" רחב יותר מ-"advertising" | עמדה | [Marketing91](https://www.marketing91.com/mass-marketing) (snippet) |
| מילון: "לתווית Send RSVP לא נמצא מקור" | **לא עמדה.** התווית קיימת. הבחירה ב-Submit RSVP עדיין טובה, ואין ממצא. | [Nearlyweds](https://nearlyweds.freshdesk.com/support/solutions/articles/5000642517-how-do-i-respond-to-rsvp-guest-) (snippet), [Zola](https://help.zola.com/hc/en-us/articles/115002312811) (read) |
| מילון: אנגלית ניטרלית, והימנעות מ-organize | **עמדה חלקית.** האיות אכן ניטרלי, אבל "tidy" מסומן כבריטי, והכלל מחמיר מהנדרש. | ראו 2א |
| מילון: broadcast list, מקור משני בלבד | עמדה, ויש מקור טוב יותר: עמוד עזרה רשמי של WhatsApp. העמוד עצמו החזיר לי 400, ולכן הוא נשאר snippet. | [WhatsApp FAQ](https://faq.whatsapp.com/861663048350950/?cms_platform=android) (snippet) |
| הערה 4: השם WhatsApp Business Platform אומת רק במקורות משניים | **לא עמדה.** השם מופיע גם באתר העסקי של WhatsApp. זה לא משנה את 2ג: הבעלים מחליט. | [WhatsApp for Business](https://whatsappbusiness.com/products/business-platform/) (read) |
| הערה 6: brit milah הצורה הפורמלית, bris הצורה האשכנזית | עמדה. הטענה שאין רבים מוסכם לא נבדקה, כי Merriam-Webster חסם (403). | [Merriam-Webster](https://www.merriam-webster.com/dictionary/brit%20milahs) (snippet) |
| הערה 7: הטבלה נשארת בעברית, ושורת הדוגמה מזוהה לפי התכונה שלה | עמדה. יש רק שורה אחת בלי טלפון. | קוד: `TEMPLATE_SAMPLE_ROWS` |
| הערה 9: "the happy couple" לא מתאים לכל אירוע | עמדה. המשפט מוצג בכל סוג אירוע. הנושא זז מהאנשים ליום, וזה מקובל. אין ממצא. | קוד: `rsvp-form.tsx` |
| הערה 10: "בוטל" תורגם ל-"is no longer active" | עמדה. הסטייה דווחה, והניסוח לא מרמז שהאירוע בוטל. אין ממצא. | קוד: `r/[token]/page.tsx` |
| הערה 11: vendors בארצות הברית, suppliers בבריטניה | **אומתה חלקית.** הצד הבריטי אושר. החיפוש שלי לא אישר את הצד האמריקאי. | [The Wedding Directory](https://theweddingdirectory.co.uk/wedding-suppliers/page/48/) (snippet), [Guides for Brides](https://guidesforbrides.co.uk/wedding-suppliers?page=21) (snippet) |
| הערה 12: `STATUS_LABELS` כתובות בקוד | עמדה | קוד: `rsvp-form.tsx` |
| מילון: נוסח רשמי של Waze ל-Navigate with Waze לא נמצא | עמדה. Google דורשת רק את השם Waze על הכפתור או לידו, והנוסח נפוץ במוצרים אחרים. | [Google](https://developers.google.com/maps/documentation/navigation/connect/launch-navigation-app) (snippet), [Boei](https://boei.help/help/waze) (snippet) |
| סגנון: בלי מקף ארוך ובלי פסיק לפני and ברשימה | עמדה. אפס מקפים ארוכים. כל פסיק לפני and או or מחבר שני משפטים, ולא פריטי רשימה. | בדיקה אוטומטית וקריאה |
| סגנון: מקף ארוך "נשמע מתורגם" באנגלית | **לא הוכח.** למילון אין מקור לטענה, וזו בחירת סגנון. התוצאה טובה, ואין ממצא. | `glossary.md` |
| מילון: התווית הקטנה באותיות גדולות, ולכן FAQ | עמדה. אף תווית כזאת לא מכילה RSVPs. | קוד: המחלקה `uppercase` |

## 4. ספירה וציונים

נבדקו **148 מתוך 148** ערכים, מול העברית ומול הקוד.

| חומרה | מספר |
| --- | --- |
| error | 0 |
| should fix | 1 |
| preference | 5 |
| בעיות במקור (לא נספרות נגד התרגום) | 4 |

הציונים נקבעו לפי ההגדרות של כל רמה ברובריקה.

| בדיקה | קריטריון ברובריקה | ציון | למה לא 5 |
| --- | --- | --- | --- |
| משמעות | Semantic Fidelity | 4 | ירידת חוזק אחת, ושינוי מבנה בשורה אחת. |
| טון | Tone & Formality | 5 | |
| התאמה תרבותית | Cultural & Demographic Sensitivity | 4 | "tidy" ו-"calm control". |
| פעולה | Actionability | 4 | התווית ב-`cb`, שמקורה בעברית. |

ממוצע משוקלל של ארבעת הקריטריונים: 4.23. הסף של הרובריקה הוא 3.5, ו-4.0 לתוכן בעל משמעות משפטית.

מה נבדק מעבר לקריאה:

- המפתחות זהים ב-148 מתוך 148, ו-`{{name}}` נשמר.
- כל 148 המפתחות נמצאו בקוד, וברירות המחדל בקוד זהות לעברית ב-JSON.
- לא נשארה עברית, ואין מקף ארוך או גרשיים מעוגלים.
- שני מקרים של אותה עברית עם אנגלית שונה, ושניהם מוצדקים: "שליחת פנייה" (כותרת מול כפתור) ו"שאלות נפוצות" (כותרת מול תווית קטנה).
- מונחים: guest, host, reply ו-RSVP אחידים בכל הקובץ.
- התאמה בין משפט לכפתור: `join`, `rate`, `site.contact` ו-`r.gift` תקינים. הפער היחיד הוא ב-`cb`, ראו 2ב.
- המספרים בכותרות נכונים: 7 יכולות, 6 צעדים, 5 צעדים ו-4 טעויות.

מקורות ודרך הקריאה:

- **נקראו (read):** שני עמודי Oxford, Wikipedia, Zola ו-whatsappbusiness.com. הורדתי אותם ישירות ב-`curl` וקיבלתי HTTP 200. עמודי Oxford נטענו שוב גם בבדיקה חוזרת, והטקסט שצוטט נמצא בהם.
- **עותקים שמורים:** /tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/268cc31e-bd57-4af1-851f-d02eb1c0f4dc/scratchpad/translations/reviewer-en-work/pages/
- **לא נקראו:** Merriam-Webster (403), וכן business.whatsapp.com ו-faq.whatsapp.com (400). תיקון: קודם כתבתי שעמודי WhatsApp לא נטענו, וזה היה חלקי. אותו תוכן נטען מ-whatsappbusiness.com.
- **סוכן הקריאה:** הדוח שלו לא הגיע אליי, והוא לא מקור לדוח הזה. לפי `team-lead` הוא קיבל 403 מ-Oxford, ואילו `curl` קיבל 200. כנראה שדרך הגישה היא שיצרה את הפער, אבל לא בדקתי זאת.
- **כל השאר:** תוצאות חיפוש בלבד, ומסומנות snippet. Cambridge לא משמש מקור בדוח.

## 5. מגבלות מחוץ לקובץ

התרגום עדיין לא מגיע למשתמשים, כי `getT` קבוע לעברית. לפני שמחברים אותו צריך לטפל בכיוון, בעיצוב ובטקסטים שמחוץ לקובץ.

**כיוון העמוד (נבדק בדפדפן Chromium):**

- `<html lang="he" dir="rtl">` קבוע ב-`app/layout.tsx`, ו-`dir="rtl"` קבוע גם ב-`cb/[token]/page.tsx` וב-`call-me-now-widget.tsx`.
- בכיוון ימין לשמאל סימן הסיום קופץ לצד הלא נכון. כך נראו הערכים: "?Will you be attending". בערך שנשבר לשתי שורות נשארה בשורה השנייה המילה ".do". זה נוגע ל-45 מתוך 148 הערכים, ושלושה מהם ב-`/cb`.
- גם הברכה נשברה: השם העברי הופיע משמאל ל-Hello והפסיק הגיע לקצה השמאלי.
- סוגריים בסוף ערך, כמו "(optional)", הוצגו נכון בשני הכיוונים.
- בכיוון שמאל לימין כל הערכים שנבדקו הוצגו נכון, כולל הברכה עם שם בעברית. לכן אין צורך ב-`<bdi>` בברכה.
- צילום הבדיקה: /tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/268cc31e-bd57-4af1-851f-d02eb1c0f4dc/scratchpad/translations/reviewer-en-work/bidi.png

**עיצוב ותאריכים:**

- `ArrowLeft` מופיע 9 פעמים בכפתורי האתר, בלי וריאנט `rtl:`. באנגלית החץ ליד "Create a new event" יצביע אחורה (נקרא בקוד, לא נבדק בדפדפן).
- `formatEventDateLine` מחזיר יום בשבוע ותאריך עברי בעברית, ואחריהם תאריך ישראלי. התאריך הזה מוצג לאורח ב-`/r`, ב-`/g` וב-`/ty`.
- מספרים: בקובץ אין ספרות ואין מפתחות `count`. שורת ההצלחה ב-`/r` תצטרך `_one` ו-`_other` באנגלית, ו-`_one`, `_two` ו-`_other` בעברית.

**הערה למוצר:** bit ו-PayBox הן אפליקציות ישראליות, ולכן ייתכן שאורח מחו"ל לא יוכל להשתמש בהן. זו הסקה שלא נבדקה.

**טקסטים שיישארו בעברית גם אחרי החיבור:**

- **`/r`:** כפתורי ההגעה (`STATUS_LABELS`), תיאורי הכפתורים של המונים לקוראי מסך, ושורת ההצלחה "נתראה ב…". האורח יראה שאלה באנגלית ותשובות בעברית.
- **כפתור המתנה:** כשמוגדר ספק, `GIFT_BRAND` מחליף את `r.gift.cta` ואת `g.landing.cta` ב"שליחת מתנה ב־bit" או PayBox.
- **`/g`, `/ty`:** ברכות לפי סוג אירוע (`event-theme.ts`).
- **`/rate`:** תוויות הדירוג והמשוב (`OPTIONS`, `FEEDBACK`).
- **`/cb`:** שורת הטלפון, "על מה רצית לדבר?", בחירת הנושא, בחירת המועד, הערת הפרטיות והכותרת התחתונה. העמוד גם קבוע ל-`dir="rtl"`.
- **צד השרת:** הודעות הצלחה ושגיאה מ-Server Actions, והודעות אימות של Zod.
- **האתר:** רוב גוף העמודים, כולל שאלות נפוצות, רשימות היכולות והצעדים, והכותרת הראשית בדף הבית.

## 6. הסקילים שיושמו

כל ארבעת הסקילים נקראו במלואם, כולל הקבצים הנלווים שצוינו בבריף. הם יושמו אחרי הסבב הראשון, וכל הממצאים נבדקו מחדש. לא הורצו סקריפטים של הסקילים, ולא שוכתבה עברית.

| סקיל | מה נבדק | מה הוסיף |
| --- | --- | --- |
| `translation-reframing-audience-shift` והרובריקה | סעיף Validation, בדיקות Cultural/Demographic, ארבעה קריטריונים, ומבחן Back-Translation | ממצאים חדשים: 1 ("a little later"). הציונים עוגנו בהגדרות הרובריקה, ונוסף ממוצע משוקלל מול הסף. מבחן Back-Translation גילה את "a little later" (העדפה חדשה). בדיקת ההנחות הסמויות העלתה את התאריך העברי ואת אפליקציות התשלום (סעיף 5). בקובץ עצמו אין תאריכים, יחידות או מטבע. |
| `hebrew-content-writer` | משלב, מגדר וביטויים במקור | ממצאים חדשים: אין. לא שינה חומרה של אף ממצא. הוא חיזק את הקריאה של "איך לפנות אליך?" כשאלה על שם (2ב). אושרו בהקשר: "בעלי השמחה", "מתנקזות", "שווה לדעת", ו"נחזור אליך" (call back ב-`cb`, ו-get back to you ב-`site.contact`). התאמת המספרים במקור תקינה: שבע יכולות, שישה וחמישה צעדים, ארבע טעויות, שתי שאלות. |
| `hebrew-ai-text-humanizer` ו-`ai-hebrew-patterns.md` | סעיפים A עד E: חיפוש בביטויים רגולריים שכתבתי, ואחריו קריאה של כל הערכים | ממצאים חדשים: 1 (`site.home.trust.subtitle`). אפס התאמות לרוב דפוסי התרגום. CAL11 הופיע פעמיים, ושניהם ניגוד אמיתי שנשמר. REG01 הופיע 6 פעמים ("נא ל", "יש למלא"), וה-Please באנגלית מתאים לטון. 16 מקפים ארוכים, כולם עם רווחים. פנייה מעורבת במקור: רבים ברוב הקובץ, יחיד ב-`cb` וב-`rate`, ולוכסן בשלושה ערכים. "כתוב" בזכר בלבד. באנגלית "you" מכסה הכול, אבל הנושא חשוב לצרפתית. "האם תגיעו?" רשמי, ו-"Will you be attending?" מתאים לו. |
| `hebrew-i18n` ו-`references/bidi.md` | משתנים, מספרים וטקסט דו-כיווני | ממצאים חדשים בתרגום: אין. `{{name}}` הוא המשתנה היחיד והוא נשמר. אין מפתחות `count` ואין ספרות. בדיקת הדפדפן הראתה שכיוון העמוד הוא התנאי המרכזי לפני הפעלה (סעיף 5). היא גם הפריכה הנחה שלי: סוגריים בסוף ערך לא נשברים. הסקיל הפנה גם לחצים שלא מתהפכים. |
