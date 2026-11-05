# ביקורת תרגום: צרפתית (fr)

## 1. פסק דין

**מוכן אחרי תיקונים.** התרגום טוב, טבעי ועקבי. צריך לתקן טעות אחת של הבטחה שנוספה ושלושה ערכים נוספים.

שני תנאים בקוד, לפני שמציגים צרפתית לאורחים (פירוט בסעיף 3):

1. כיוון הדף חייב להשתנות לשמאל לימין. אחרת סימני הפיסוק בסוף המשפט קופצים להתחלה. זה נמדד בדפדפן.
2. חלק מהטקסט כתוב ישירות בקוד ויישאר בעברית, כולל כפתורי התשובה בטופס האישור.

סעיף 6 מפרט אילו סקילים הופעלו ומה כל אחד הוסיף.

## 2. ממצאים

ספירה: טעות 1, כדאי לתקן 3, העדפה 5. נתיבים שמתחילים ב־`cb/` או ב־`r/` הם תחת `src/app/(public)`.

| מפתח | חומרה | ערך נוכחי | הצעה | סיבה | ראיה |
| --- | --- | --- | --- | --- | --- |
| `site.whatsapp.hero.subtitle` | **טעות** (דורש החלטת בעלים) | Chaque invité reçoit son invitation personnelle via la plateforme professionnelle officielle de WhatsApp : ni groupe, ni liste de diffusion, ni envoi manuel depuis votre téléphone. | הצעה בלבד: Une invitation personnelle pour chaque invité, via la plateforme professionnelle officielle de WhatsApp : ni groupe, ni liste de diffusion, ni envoi manuel depuis votre téléphone. | העברית אומרת "הזמנה אישית לכל מוזמן", בלי פועל. הצרפתית אומרת "כל מוזמן מקבל". זו הבטחת מסירה שאין במקור, והיא סותרת את אותו דף. הסיבה כנראה במבנה העברי: רשימה בלי פועל, ובצרפתית נוסף פועל. | `src/app/(public)/(site)/whatsapp/page.tsx`: שורה 20 (הדף לא מבטיח מסירה), שורה 156 ("לא מובטחת לכל מספר"), שורה 68 (מי שאין לו וואטסאפ לא יקבל). |
| `cb.form.contact.label` | **כדאי לתקן** | Comment vous joindre ? | Comment vous appeler ? | בעברית "איך לפנות אליך" הוא קודם כול הביטוי ל"איך לקרוא לך". בצרפתית הנוכחית השאלה היא רק "איך להשיג אותך". השדה בקוד הוא שדה שם, והטלפון כבר ידוע לנו. Comment vous appeler יכול להתפרש גם כ"איך לקרוא לך" וגם כ"איך להתקשר אליך", כמו העברית, ומתאים לטקסט המסייע הקיים. אין צורך לשנות אותו. | `cb/[token]/intake-form.tsx` שורות 86, 88, 109. הודעת השגיאה "נא למלא שם": `src/lib/validation/inquiries.ts:11`. הערך נשמר כשם: `src/lib/data/callback-scheduling.ts:215`. הטלפון מוצג בדף: `cb/[token]/page.tsx:92`. לא מצאתי מקור ברשת לניסוח. |
| `site.guestListTemplate.file.sampleNote` | **כדאי לתקן** | La ligne « Mamie Rachel », sans téléphone, est un exemple voulu : vous pouvez aussi gérer une personne invitée sans numéro. Elle ne recevra simplement pas de message automatique. | La dernière ligne, sans téléphone, est un exemple voulu : vous pouvez aussi gérer une personne invitée sans numéro. Elle ne recevra simplement pas de message automatique. | הקורא מחפש בטבלה את "Mamie Rachel" ולא ימצא, כי בטבלה כתוב "סבתא רחל". זו השורה האחרונה בטבלה, ולכן הניסוח המוצע נכון גם בלי שינוי בקוד וגם אם השורות יתורגמו בעתיד. הבעיה נובעת מהקוד, לא מהתרגום. | `src/lib/guests/import-template.ts:29`. |
| `site.guestListTemplate.closing.subtitle` | **כדאי לתקן** | Importez ce fichier, envoyez une invitation personnelle pour chaque ligne et un rappel automatique uniquement aux personnes qui n’ont pas encore répondu. | Importez ce fichier : une invitation personnelle pour chaque ligne et un rappel automatique uniquement aux personnes qui n’ont pas encore répondu. | זה אותו מבנה כמו בממצא על וואטסאפ: העברית היא רשימה של שמות עצם, והצרפתית הוסיפה פועל בציווי. כך נוצר "שלחו תזכורת אוטומטית", שזו סתירה: הקורא לא שולח תזכורת אוטומטית. ההצעה קרובה יותר למקור וקצרה יותר (146 תווים במקום 153). | קריאת הערך מול העברית. |
| `site.about.hero.intro` | העדפה | KALFA est une plateforme israélienne de gestion des confirmations de présence pour les événements privés : mariages, bar-mitsva et bat-mitsva, brit-mila, fêtes de famille et événements d’entreprise. Elle fait une seule chose : aider la personne qui organise l’événement à savoir qui vient, sans tableurs ni coups de fil à n’en plus finir. | KALFA est une plateforme israélienne de gestion des confirmations de présence pour les événements privés : mariages, bar-mitsva et bat-mitsva, brit-mila, fêtes de famille et événements d’entreprise. Elle fait une seule chose : aider la personne qui organise l’événement à savoir qui vient, sans tableurs ni dizaines de coups de fil. | בעברית "עשרות שיחות טלפון". בצרפתית "שיחות בלי סוף". הכמות השתנתה, ובמבחן התרגום חזרה לעברית זה נראה מיד. זה הערך היחיד מתוך 45 שבו מילת כמות או שלילה השתנתה. | קריאת הערך מול העברית. קריטריון Semantic Fidelity במחוון: שמירה על כמויות. |
| `r.invalidLink` | העדפה | Ce lien de réponse n’est pas valide, a expiré ou a été annulé. | Ce lien d’invitation n’est pas valide, a expiré ou a été annulé. | הצירוף lien de réponse מובן, אבל נשמע מתורגם. גם ב־glossary.md כתוב שהצירוף לא נמצא בעמודים שנקראו. lien d’invitation מתאים גם למי שמסרב. | glossary.md, שורת "קישור". |
| `site.home.audiences.subtitle` | העדפה | De la fête de famille intime au grand congrès d’entreprise, KALFA s’adapte à la taille et au style de votre événement. | De la fête de famille intime à la grande convention d’entreprise, KALFA s’adapte à la taille et au style de votre événement. | congrès מרמז על אירוע בינלאומי, ובעברית אין רמז כזה. המילה לא שגויה. | [1001 Salles](https://www.1001salles.com/pro/blog/article/488/panorama-des-differents-types-d-evenements-pour-une-entreprise), נקרא: "un évènement à visée internationale". ההגדרה של convention לפי תקציר בלבד. |
| `site.home.features.subtitle` | העדפה | Sept outils qui fonctionnent ensemble, de la liste d’invités au rapport final. | Sept fonctionnalités qui travaillent ensemble, de la liste d’invités au rapport final. | אותה מילה עברית (יכולות) מתורגמת בשורה שמעל כ־Fonctionnalités, וזה גם המונח ב־glossary.md. הנוסח הנוכחי קריא וטוב. | glossary.md, שורת "יכולות"; `site.home.features.eyebrow`. |
| `site.contact.contactSection.title`, `site.contact.form.submitContact` | העדפה | Envoyer une demande | Envoyer un message | הכפתור יתאים יותר ל־Écrivez-nous ול־Votre message. כיום demande היא גם המטרייה וגם אחד משלושת הפריטים בכותרת המשנה. הבחירה הנוכחית תקינה. | `site.contact.subtitle`, `site.contact.form.message`. |

### משפטי הסכמה, פרטיות והתחייבות

בדקתי רק שינוי בעוצמה או בהיקף. הניסוח הסופי הוא החלטת הבעלים.

| מפתח | תוצאה |
| --- | --- |
| `site.whatsapp.hero.subtitle` | **העוצמה עלתה.** נוספה הבטחת קבלה. ראו טבלת הממצאים. |
| `site.whatsapp.limits.title` | שינוי קטן. nous les respectons מעט חזק יותר מ"עובדים לפיהם". ההיקף זהה. |
| `r.form.showInGuestList.label` | אין שינוי. "שם פרטי בלבד" נשמר. |
| `site.about.does.limits` | אין שינוי. שתי ההגבלות נשמרו: רק למוזמנים, ורק בנוגע לאירוע. |
| `site.home.hero.private` | אין שינוי. |
| `r.form.success.updateHint` | אין שינוי מול העברית. הבעיה במקור, ראו סעיף 3. |
| `cb.form.lockedNotice` | אין שינוי. לא מופיע ב־notes.md, ובדקתי אותו בנוסף. |

## 3. מה שלא נובע מהתרגום

### בעיות במקור העברי

התרגום נאמן בכל אלה. אם העברית תשתנה, גם הצרפתית תצטרך עדכון.

- `cb.form.contact.placeholder`: הטקסט המסייע מציע "שם, טלפון או אימייל", אבל השדה הוא שדה שם.
- `cb.header.subtitle`: כתוב "שתי שאלות קצרות", אבל בטופס שלושה או ארבעה שדות.
- `r.form.success.updateHint`: כתוב "בכל רגע", אבל אחרי המועד האחרון הטופס נסגר.
- `site.home.audiences.title` ו־`site.home.audiences.subtitle`: "מאות אירועים" ו"כנס חברה גדול" לא מתאימים למוצר פרטי שמשלמים עליו לפי אירוע.
- **פנייה לא אחידה לקורא:** 7 מפתחות ב־`cb.*` וב־`rate.*` פונים בלשון יחיד, 3 מפתחות משתמשים בלוכסן (`בחר/י`), ובשאר הדפים הפנייה ברבים. בצרפתית זה לא מפריע, כי vous מכסה הכול. בשפות אחרות זה עלול להפריע.

### כיוון הטקסט

זה התנאי החשוב ביותר לפני העלאת צרפתית. הקוד קובע היום `<html lang="he" dir="rtl">` (`src/app/layout.tsx:76`).

הצגתי בדפדפן Chromium דוגמאות מהקובץ, פעם בעמוד מימין לשמאל ופעם בעמוד משמאל לימין:

- **מימין לשמאל:** סימן הפיסוק בסוף המשפט קופץ להתחלה, למשל `? Serez-vous là` ו־`,Bonjour Dana Levy`. זה נוגע ל־49 מתוך 148 ערכים. סוגריים נשארים תקינים.
- **משמאל לימין:** הכול תקין, גם שם עברי בתוך `{{name}}` עם הפסיק שאחריו.

לכן צרפתית צריכה `lang="fr"` ו־`dir="ltr"`. צריך לטפל גם בכיוון הקבוע ב־`cb/[token]/page.tsx:58` וב־`src/components/site/call-me-now-widget.tsx:136`.

החץ `ArrowLeft` בכפתורים לא מתהפך לפי הכיוון, ולכן בצרפתית הוא יצביע אחורה. זה לפי קריאת הקוד, ולא נבדק בדפדפן.

### עברית שנשארת בדף

הטקסטים האלה כתובים ישירות בקוד ואינם בקובץ התרגום. לכן הם יוצגו בעברית גם בגרסה הצרפתית:

- **טופס האישור:** שלושת כפתורי התשובה (`r/[token]/rsvp-form.tsx:25`), הודעת ההצלחה ושורת "נתראה ב…".
- **תאריך האירוע:** שורת התאריך בדפי האורח (`src/lib/data/event-display.ts:47`).
- **כפתור המתנה:** עם bit או PayBox מוצג הנוסח העברי במקום `r.gift.cta` ו־`g.landing.cta` (`src/lib/data/event-display.ts:21`).
- **דף החזרה הטלפונית:** הדף קבוע לכיוון ימין לשמאל, וגם נושא הפנייה, העדפת השעה, הערת הפרטיות ושורת מספר הטלפון בעברית.
- **דף הדירוג:** שלוש אפשרויות הדירוג והתגובה להן.
- **דפי השיווק:** הכותרת הראשית של דף הבית, וכל הרשימות והשאלות והתשובות.
- **תבנית הרשימה:** כותרות העמודות ושורות הדוגמה, גם בקובץ שמורידים.

## 4. טענות מ־glossary.md ומ־notes.md שבדקתי

| טענה | תוצאה |
| --- | --- |
| `r.form.submit`: אותו כפתור שולח גם "אולי" וגם "לא מגיע/ה" | **נכון.** אומת בקוד. Envoyer ma réponse היא הבחירה הנכונה. |
| `r.form.success.updateHint`: אחרי המועד הטופס נסגר | **נכון.** אומת בקוד. |
| `sampleNote`: שורות הדוגמה בעברית | **נכון.** אומת בקוד. אין צורך בשתי החלופות שבהערה, כי אפשר פשוט לא לנקוב בשם. |
| הערה 3, `site.whatsapp.hero.subtitle`: הסיכון הוא שם המוצר | **חלקי.** ההערה צודקת ששם המוצר לא מופיע בעברית, אבל היא לא מזכירה את הבטחת המסירה. |
| הערה 10, `cb.form.contact.label`: הבחירה נעשתה לפי הטקסט המסייע, והחלופה דורשת גם לשנות אותו | **חלקי.** הדו־משמעות אמיתית, אבל ארבעה סימנים בקוד מצביעים על שם ורק הטקסט המסייע מצביע אחרת. החלופה Comment vous appeler עובדת גם עם הטקסט המסייע הקיים. |
| Larousse: עדיף conserver la maîtrise de על garder le contrôle de | **נכון.** נקרא ישירות, והמילון אומר זאת במפורש. [Larousse](https://www.larousse.fr/dictionnaires/francais/contr%C3%B4ler) |
| bar-mitsva קבועה גם ברבים | **נכון, עם הסתייגות.** Larousse כותב "nom féminin invariable" (נקרא). [האקדמיה](https://dictionnaire-academie.fr/annexes/orthographes-recommandees10.html) ממליצה באיות החדש על barmitsva, ברבים barmitsvas (נקרא). המילון לא מזכיר זאת. אין צורך בשינוי. [Larousse](https://www.larousse.fr/dictionnaires/francais-anglais/bar%2Dmitsva/8003) |
| Torah-Box כותב brit-mila | **נכון.** נקרא: Brit-Mila עם מקף 50 פעמים, ובלי מקף פעם אחת. [Torah-Box](https://www.torah-box.com/vie-juive/cycle-vie-juive/brit-mila/la-brit-mila-ou-le-retour-a-la-perfection-originelle_12412.html) |
| vos hôtes בהקשר של מי שהזמין | **נכון.** נקרא: "remercier vos hôtes de leur invitation", במכתב תודה לזוג. [Modèle Lettre](https://www.modele-lettre-gratuit.com/modele-de-lettre/discours-allocutions/remerciement/remercier-et-feliciter-les-maries-apres-le-mariage-1628.html) |
| baalé simha לא נמצא בצרפתית | **נכון, לפי חיפוש אחד נוסף.** נמצאה רק הכתיבה האנגלית baalei simcha, בתקציר. |
| Faites-vous rappeler, ו־demande כמונח כללי | **נכון.** נקרא בטופס של [Generali](https://www.generali.fr/agence/dax/aquitaine/assurance/contact-form). |
| liste de diffusion | **נכון.** תקציר בלבד: [Blog du Modérateur](https://www.blogdumoderateur.com/whatsapp-comment-utiliser-listes-diffusion/). לא נמצא עמוד העזרה הרשמי של WhatsApp. |
| facultatif מתאר את השדה ולכן לא משתנה | **סביר.** לא מצאתי כלל כתוב. לא דיווחתי על "Remarque (facultatif)" כטעות. |
| Y aller avec Waze הוא ביטוי טבעי | **סביר, לא אומת.** לא מצאתי מקור ששם הכפתור ב־Waze הוא Y aller. גם ב־glossary.md זה מסומן כלא מאומת. |
| המקורות מ־Mariages.net (accompagnants, confirmer leur présence) | **לא נבדק מחדש.** האתר החזיר לי 403. |
| המילון: הערה תמיד remarque | **סטייה תקינה.** `rate.form.comment.label` משתמש ב־commentaire, וזה נכון יותר בטופס דירוג. |

## 5. סיכום

**ערכים שנבדקו:** 148 מתוך 148, מול העברית ומול הקוד. המעבר הראשון נעשה לפני קריאת `glossary.md` ו־`notes.md`.

**בדיקה אוטומטית של הקובץ:** אותם מפתחות באותו סדר, `{{name}}` נשמר, אין אותיות עבריות, אין גרש ישר או מירכאות ישרות, וכל 28 המקומות שדורשים רווח קשיח כוללים אותו. ערכים עבריים זהים קיבלו תמיד תרגום זהה.

**בדיקת כמויות ושלילות:** עברתי על 45 ערכים שסומנו בחיפוש מילים של שלילה, הגבלה, מספר או הבטחה. כולם נשמרו, חוץ מ"עשרות" ב־`site.about.hero.intro`, ומלבד הבטחת המסירה שנוספה ב־`site.whatsapp.hero.subtitle`.

**לא נבדק:** הדפים עצמם לא הוצגו בדפדפן. בדפדפן בדקתי רק דוגמאות של כיוון טקסט. התאמה למסך צר נבדקה לפי הקוד בלבד: לא מצאתי כפתור או תווית שגולשים. `site.home.hero.eyebrow` ארוך פי שניים מהעברית ומוצג באותיות גדולות, ולכן יתפרס על כמה שורות בטלפון, בלי לפגוע בקריאה.

הציונים נקבעו לפי ההגדרות של המחוון בסקיל התרגום:

| בדיקה | קריטריון במחוון | ציון |
| --- | --- | --- |
| משמעות | Semantic Fidelity | 4 |
| טון | Tone & Formality Appropriateness | 5 |
| התאמה תרבותית | Cultural & Demographic Sensitivity | 4 |
| פעולה | Actionability | 4 |

הממוצע המשוקלל הוא 4.23. זה מעל סף 4.0 שהמחוון קובע לטקסט רגיש, ו־Semantic Fidelity מעל הסף המינימלי 3.

## 6. הסקילים שהופעלו

קראתי את כל הקבצים שהבריף מונה, במלואם. ארבעת הסקילים נוספו לבריף אחרי שכתבתי את הגרסה הראשונה של הביקורת, ולכן הפעלתי אותם בסבב נפרד על כל 148 הערכים. פסק הדין לא השתנה. כל הסקילים יחד הוסיפו ממצא העדפה אחד.

| סקיל | נקרא | מה הוא הוסיף | מה השתנה בממצאים |
| --- | --- | --- | --- |
| `translation-reframing-audience-shift` | כן: `SKILL.md` ומחוון ההערכה | הציונים עוגנו בארבעה קריטריונים במחוון. מבחן התרגום חזרה לעברית מצא ש"עשרות" הפך ל"בלי סוף". | **נוסף ממצא העדפה אחד:** `site.about.hero.intro`. הציונים עצמם לא השתנו. הבדיקה התרבותית הוסיפה: כלום. אין בקובץ תאריכים או יחידות מידה, והביטוי jour J מוכר לקהל הזה. |
| `hebrew-content-writer` | כן: `SKILL.md` | "איך לפנות אליך" הוא קודם כול הביטוי ל"איך לקרוא לך". | **ממצא חדש: אין.** הסיבה ב־`cb.form.contact.label` התחזקה, והחומרה לא השתנתה. בדיקת המשלב, המין והמספרים הוסיפה: כלום. pagaille מתאים למשלב של בלגן, כפתורים עבריים בצורת שם עצם נכון להפוך לשם פועל, והתאמת המין במספרים בעברית תקינה. |
| `hebrew-ai-text-humanizer` | כן: `SKILL.md` ו־`references/ai-hebrew-patterns.md`. קריאה בלבד: הסקריפטים לא הורצו והעברית לא שוכתבה. | שורש משותף לשני ממצאים: רשימה עברית בלי פועל, שאליה נוסף בצרפתית פועל. בדיקת 45 ערכים של שלילה, הגבלה, מספר והבטחה. הערה על פנייה לא אחידה בעברית (סעיף 3). | **ממצא חדש: אין.** נוסף הסבר ל־`site.whatsapp.hero.subtitle` ול־`site.guestListTemplate.closing.subtitle`, והחומרה לא השתנתה. המשלב הרשמי ב־16 מפתחות הוסיף: כלום, כי הוא לא עבר לצרפתית. גם 16 הקווים הארוכים הוסיפו: כלום, כי לא אבד קשר בין חלקי המשפט. |
| `hebrew-i18n` | כן: `SKILL.md` ו־`references/bidi.md`. חלק `next-intl` לא הופעל, לפי הבריף. | בדיקת כיוון בדפדפן, שהעלתה שני ממצאי קוד: כיוון הדף והחץ בכפתורים (סעיף 3). נוספה גם שורת התאריך לרשימת העברית שנשארת בדף. | **ממצא תרגום חדש: אין, ואף ערך לא משתנה.** נוסף תנאי בקוד לפני הצגת צרפתית. המשתנים והמספרים הוסיפו: כלום. `{{name}}` תקין, ואין בקובץ ספרות או מפתחות של צורות רבים. |

קבצים שהבריף לא מונה ולא קראתי: `resources/template.md` ו־`resources/methodology.md` של סקיל התרגום, `references/hebrew-grammar-quick-ref.md` של `hebrew-content-writer`, `references/channel-grammar-gender.md` ו־`references/domain-checklist.md` של `hebrew-ai-text-humanizer`, ו־`references/pluralization.md` של `hebrew-i18n`.
