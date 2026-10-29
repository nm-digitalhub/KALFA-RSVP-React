# ניתוח noUncheckedIndexedAccess — ממשק משתמש וסקריפטים

תאריך: 2026-10-28. תחום אחריות: כל הרשומות שסווגו `ui-scripts` בפלט המקורי. זהו דוח ניתוח בלבד; לא שונו קוד, הגדרות או הפלט, ולא הורצו סקריפטים, בדיקות, build או tsc במסגרת ניתוח זה.

## היקף ומדידה

נמצאו **87 אבחנות ב־35 קבצים**, כולן ייחודיות לפי `(file,line,column,code,message)`. נסקרו כל מיקומי המקור המדווחים וההקשר הסמוך, ובמקרים המפורטים בהמשך גם היצרנים של המערכים/המפות. המספרים מתייחסים לפלט שסופק ואינם טענה להרצת compiler חדשה.

| קבוצה | אבחנות | קבצים |
|---|---:|---:|
| סקריפטים | 37 | 11 |
| מסכי app ו־Server Actions סמוכים | 21 | 16 |
| רכיבי React משותפים | 29 | 8 |
| סך הכול | 87 | 35 |

| קוד | כמות |
|---|---:|
| TS2532 | 29 |
| TS18048 | 27 |
| TS2345 | 16 |
| TS2322 | 12 |
| TS2538 | 3 |

הסיווג הגאוגרפי `ui-scripts` כולל גם Server Actions; הוא אינו אומר שכל הקבצים רצים בדפדפן. 20 מתוך 29 אבחנות הרכיבים מרוכזות בארבעת קובצי לוח השנה. 24 מתוך 37 אבחנות הסקריפטים מרוכזות בשלושת כלי ניתוח האודיו.

## מסקנות והבחנות

רוב הדפוסים כאן נובעים מהבדל בין תנאי קיום שהקוד כבר מקיים לבין טיפוס מערך/מילון שאינו מבטא אותם. בדיקת אורך, קשר בין שני מערכים, Regex מוצלח או רשימה קבועה אינם הופכים אוטומטית כל גישת אינדקס לערך ודאי. לכן אין לפרש 87 אבחנות כ־87 תקלות ריצה.

לצד אלה קיימים פערי חוזה שאפשר להגיע אליהם בקלט שהממשק הטיפוסי מאפשר. הבולטים הם CLI עם `--channel` ללא ערך, רכיב SetupStepper עם מערך ריק, ורשימת ימי שבוע שהתרוקנה מסינון. לא בוצע שחזור בדפדפן או בכלי CLI, ולכן אלה מסלולים אפשריים שמוסקים מקריאת הקוד, ולא תקלות שנצפו בפרודקשן.

סימון בטבלת הכיסוי: **I** — תנאי קיום/גבולות נמצא במקור הנוכחי; **C** — החוזה הטיפוסי רחב יותר מהיצרן או שהתלות בין נתונים אינה מיוצגת; **B** — חסרה הכרעה מפורשת על קלט גבול. ייתכנו כמה סימונים לקובץ.

## ממצאים לטיפול ראשון

### 1. ימים ריקים בלוח השנה — P1, חוזה רכיב

`event-calendar-month-view.tsx:124–145` מייצר שבועות, ואם weekends מוסתר מסנן מהם את `settings.weekendDays`. הרשימה המסוננת מועברת ל־child גם אם היא ריקה; ב־343, 347 ו־496 נעשה שימוש ב־`week[0]` בלי בדיקת קיום. הגדרת `weekendDays` היא `number[]` ב־`event-calendar.tsx:193`, וב־353 היא נלקחת מהאפשרויות עם ברירת מחדל, כך שבחירת כל שבעת הימים אפשרית בחוזה הנוכחי. גם טווח חלקי שכל ימיו מוסתרים עשוי לתת שבוע ריק.

יש להגדיר את התנהגות empty בשכבת בניית השבועות/רינדור ההורה, ולתת ל־child חוזה של שבוע לא ריק. מפני שה־child משתמש ב־hooks, אין להוסיף early return מותנה לפני חלק מה־hooks וליצור שינוי במספר ה־hooks בין רינדורים. מסלול ה־ghost ב־610 זקוק לתאריך מאומת. אין להשתמש בתאריך הנוכחי כדי להשתיק את הטיפוס: זה ישנה את מיקום האירוע.

יתר גישות האינדקס בקובץ הן ברובן תלות של מערכים מקבילים (`week`, `offsets`, `hiddenBarKeysByCol`). רשומת עמודה אחת יכולה לשמור את התלות באופן מפורש. בלוח הזמן, לעומת זאת, `colStart/colEnd` מחושבים מאותה איטרציה על days ויש יציאה כשאין התאמה; זו הוכחת קיום שאבדה בטיפוס, ולא אותו פער של week ריק.

### 2. ערך חסר ל־channel — P1, קלט CLI

`analyze-call-pitch.ts:108–116` ו־`analyze-call-prosody.ts:92–112` בודקים אם הדגל קיים, אך לא אם קיים הערך שאחריו. נדרש parser שמחזיר ערוץ מוכר או שגיאת usage לפני פענוח אודיו. עבור prosody, שלוש אבחנות timestamp מקורן ב־split; הקריאה הנוכחית מגיעה מ־Regex המחייב timestamp תקין, ולכן אין לערבב אותה עם הפער האמיתי של ארגומנט חסר.

ב־median/percentile קיימת בדיקת empty. הקריאות הנוכחיות ל־percentile הן 5 ו־95, כך שהאינדקס בטווח; אם הפונקציה תורחב לקבל אחוז חיצוני נדרשת גם בדיקת finite וטווח 0–100. זו המלצה לחוזה, לא תקלה נצפית בקריאות הנוכחיות.

### 3. שורות פלט SQL — P1 לפני שימוש במחולל

`gen-staff-table-rls.ts:83–84,97–98` מפצל טקסט לפי `|` ומניח שני שדות ומפתח מוכר. השאילתות עצמן מסננות לפי tables, אך הטיפוס אינו מייצג חוזה של parser ופלט פגום עלול לפגוע ביצירת המסמך. יש לאמת את השורה ואת bucket לפני שימוש. שגיאה ברורה עדיפה על יצירת SQL חלקי או דילוג שקט. המחולל קורא DB מקומי וכותב קובץ בלבד לפי תיעודו; הוא לא הורץ במסגרת הדוח.

### 4. חוזים בין יצרן לצרכן — P2

- `SetupStepper` מאפשר `steps=[]` ואז `active.key` אינו מוגן. היצרן הנוכחי `src/lib/data/setup-steps.ts:159` בונה שישה שלבים, והמסך ממפה אותם; לכן אין ראיה לנתיב פרודקשן נוכחי שמוסר רשימה ריקה. כדאי לקבע חוזה לא ריק או מצב empty מוסכם.
- `fleet-stream.tsx` צורך `expired-run.events[0]` ואחרון. היצרן `src/lib/fleet/conversation.ts:389–391` דורש לפחות `EXPIRED_RUN_MIN=3`, אבל הטיפוס הוא `MessageEvent[]`. תיקון החוזה אצל היצרן יכול לפתור גם את ניתוח השרת וגם את ה־UI.
- `OfferForm` מאותחל מכל packageChoices, אך `setRow` מקבל כל string וממזג partial על רשומה שאינה מובטחת. יש לשמר PackageRowState מלא ולהכריע מה לעשות כאשר id לא נמצא. אין להחליש בדיקות תמחור שרת כדי לתקן state של טופס.
- ייבוא WhatsApp משתמש ב־rowIndex שהשרת חישב מחדש מתוך אותן rows. `findImportMatches` מחזיר `computeImportMatches(existing, rows)` ושם האינדקס בא מ־forEach. לא נמצא כאן אינדקס שרירותי שמגיע מהלקוח. עדיין נכון לשמור guard בנקודת שימוש, או לשאת את שורת המקור בחוזה של match.
- בתוכנית מיגרציית Voximplant, id ושם rule נבנים יחד ב־planFrom. שינוי לרשומות rule משותפות עדיף על `filter(Boolean)` לשני מערכים בנפרד, העלול לנתק את ההתאמה.

## מלאי מלא לפי קובץ

העמודה ״שורות״ כוללת את כל שורות המקור המדווחות; כמה אבחנות באותה שורה נספרות בנפרד בעמודת הכמות. העמודות אינן כוללות מחדש את כל הודעות TypeScript, המופיעות ביומן האבחנות הכללי.

| קובץ | אבחנות | שורות | סיווג | ממצא | המלצה |
|---|---:|---|---|---|---|
| [`scripts/analyze-call-audio.ts`](../../../scripts/analyze-call-audio.ts) | 7 | 72, 73, 75, 81 | I | לולאה תחומה ב־ends.length ומערכים שנוצרו ב־map; ענף trailing מוכיח starts לא ריק. | לעבור על ends.entries() ולשמור end מקומי; לשלוף start אחרון ולבדוק אותו לפני יצירת Pause. |
| [`scripts/analyze-call-pitch.ts`](../../../scripts/analyze-call-pitch.ts) | 5 | 51, 56, 116 | I+B | median/percentile מוגנים מול מערך ריק; הקריאות ל־percentile הן 5/95. לעומת זאת --channel ללא ערך מחזיר undefined. | לפרק median לערכים מקומיים עם guards; לאמת ערך channel בתחילת CLI. לא להמיר חסר לנתון מספרי שרירותי. |
| [`scripts/analyze-call-prosody.ts`](../../../scripts/analyze-call-prosody.ts) | 12 | 30, 44, 51, 88, 110, 111, 112, 114, 126 | I+B | Regex מחייב timestamp וקבוצות; pct מקבל 5/95; לולאת utts תחומה. --channel ללא ערך אינו נדחה. | לבדוק captures ופורמט זמן; להשתמש ב־entries; לאמת ערך channel לפני sliceF0. |
| [`scripts/gen-staff-table-rls.ts`](../../../scripts/gen-staff-table-rls.ts) | 2 | 84, 98 | B | split של פלט SQL אינו מקודד זוג ושם טבלה ידוע; שתי TS2538 מסתירות גם אפשרות לערך חסר. | לאמת שני שדות ומפתח מוכר, לשלוף bucket מקומי, להפסיק עם שגיאה על שורה לא תקינה לפני כתיבת פלט. |
| [`scripts/send-email-file.ts`](../../../scripts/send-email-file.ts) | 1 | 60 | I | attachments נוצר רק כמערך עם איבר יחיד; הגישה היא בלוג לאחר שליחה. | לשמור attachment או גודל PDF בנפרד, או לבדוק האיבר המקומי. אין צורך לשלוח דוא״ל כדי לאמת טיפוסים. |
| [`scripts/verify-graph-edges.ts`](../../../scripts/verify-graph-edges.ts) | 1 | 50 | I | בדיקה מפורשת דורשת data.length === 1 לפני קריאה. | לחלץ connection ולבדוק קיום בצמוד לבדיקת cardinality; לשמר כשל על אפס/ריבוי תוצאות. |
| [`scripts/verify-graph-provider.ts`](../../../scripts/verify-graph-provider.ts) | 1 | 34 | I | בדיקה מפורשת דורשת data.length === 1 לפני קריאה. | לחלץ connection ולבדוק קיום בצמוד לבדיקת cardinality; לשמר כשל על אפס/ריבוי תוצאות. |
| [`scripts/voximplant/migrate-scenarios-to-application.ts`](../../../scripts/voximplant/migrate-scenarios-to-application.ts) | 2 | 556, 585 | I+C | argv[i+1] נבדק אך נקרא שוב בביטוי מחושב; ruleIds/ruleNames נבנים יחד ב־planFrom ואז מסוננים דרך אינדקסים מקבילים. | לשמור nextArg מקומי; להעדיף רשומות rule עם id/name על מערכים מקבילים, או לאמת את הזוג לפני בניית התוכנית. לא לסנן undefined בשקט. |
| [`scripts/voximplant/outreach-call.ts`](../../../scripts/voximplant/outreach-call.ts) | 1 | 132 | I | לפני campaign[0] נדחים מערך ריק ומספר קמפיינים גדול מאחד. | לחלץ campaign ולשמר בדיקת בדיוק אחד לפני יצירת job; אימות יחידה ללא חיוג אמיתי. |
| [`scripts/voximplant/rotate-console-agent-secret.ts`](../../../scripts/voximplant/rotate-console-agent-secret.ts) | 2 | 38, 39 | I | נדחים אפס או יותר מסוכן יחיד; שני השימושים הם באותו איבר. | לחלץ enrolledAgent מקומי ולבדוק קיומו, בלי להחליש סירוב לאי־בהירות. |
| [`scripts/whatsapp-template-gate.ts`](../../../scripts/whatsapp-template-gate.ts) | 3 | 70, 77, 111 | C | כל ארבעת סוגי celebrants קיימים בפועל; Record<string, Json> מאבד את שלמות קבוצת המפתחות. | להשתמש בקבוצת CelebrantKind הסגורה עם satisfies Record<CelebrantKind, Json>, ולשמר את טיפוס האובייקט. |
| [`src/app/(admin)/admin/analytics/_sections.tsx`](../../../src/app/(admin)/admin/analytics/_sections.tsx) | 1 | 253 | I | האיבר הקודם נלקח באינדקס i-1 כאשר i>0 בתוך map על steps. | לשמור previous מקומי ולחשב אחוז רק כשקיים/count חיובי; לא לשנות סמנטיקת אפס. |
| [`src/app/(admin)/admin/assignments/list-params.ts`](../../../src/app/(admin)/admin/assignments/list-params.ts) | 1 | 22 | I+C | מפתחות מגיעים מ־Object.keys(PATTERNS), אך Record<string,RegExp> אינו מוכיח ערך בגישה חוזרת. | להשתמש ב־Object.entries ו־pattern מהאיטרציה; לשמר whitelist, regex והנתיב הקבוע. |
| [`src/app/(admin)/admin/assignments/void-refusals.ts`](../../../src/app/(admin)/admin/assignments/void-refusals.ts) | 1 | 17 | I+C | Object.hasOwn מגן בזמן ריצה; הוא אינו מצמצם את טיפוס תוצאת Record לקריאת string בטוחה. | לשמור בדיקת own-property ולהחזיר ערך מקומי עם null כאשר חסר; לא להסתפק בגישה המאפשרת prototype keys. |
| [`src/app/(admin)/admin/callbacks/policy/actions.ts`](../../../src/app/(admin)/admin/callbacks/policy/actions.ts) | 1 | 61 | I | Day הוא union של שבע מחרוזות לא ריקות מ־DAYS as const. | להשתמש ב־charAt(0) או מיפוי שמות סגור; אין שינוי נדרש בהרשאה או בסכמת המדיניות. |
| [`src/app/(admin)/admin/callbacks/policy/policy-form.tsx`](../../../src/app/(admin)/admin/callbacks/policy/policy-form.tsx) | 1 | 43 | I | day נגזר מאותו tuple סטטי של שבעה ימים לא ריקים. | אותה המרה כמו actions.ts; לשמור תאימות בין שמות השדות של הטופס לשרת. |
| [`src/app/(admin)/admin/cancellations/sort-menu.tsx`](../../../src/app/(admin)/admin/cancellations/sort-menu.tsx) | 3 | 28, 31, 32 | I+C | OPTIONS מכיל תמיד שתי אפשרויות אך הוצהר כ־ReadonlyArray; fallback של האיבר הראשון נשאר optional. | להצהיר tuple באמצעות as const satisfies או constant של ברירת מחדל ולהשתמש בו ישירות. |
| [`src/app/(admin)/admin/fleet/fleet-stream.tsx`](../../../src/app/(admin)/admin/fleet/fleet-stream.tsx) | 2 | 119, 120 | I+C | layoutStream יוצר expired-run רק עבור לפחות 3 אירועים; StreamItem שומר MessageEvent[] ולכן ההוכחה אובדת. | לקודד non-empty בנקודת הבנייה או לבדוק first/last; לתאם עם backend כדי לתקן חוזה פעם אחת. |
| [`src/app/(admin)/admin/integrations/owner-agent/audit-table.tsx`](../../../src/app/(admin)/admin/integrations/owner-agent/audit-table.tsx) | 1 | 156 | I | Regex meta_<digits> מחייב capture ראשון, אך טיפוס RegExpExecArray אינו מבטיח אותו. | לחלץ metaCode ולבדוק אותו; לשמר fallback לקוד Meta לא מוכר. |
| [`src/app/(admin)/admin/offers/offer-form.tsx`](../../../src/app/(admin)/admin/offers/offer-form.tsx) | 1 | 101 | C | initialRows בונה רשומה לכל packageChoice; setRow מרכיב Partial על prev[id] שעלול להיעדר לפי הטיפוס. | להכריע אם id חסר הוא state לא תקין או package חדש; guard או default מלא של checked/override. לא להרחיב את הרשומה לשדות optional. |
| [`src/app/(admin)/admin/roles/roles-client.tsx`](../../../src/app/(admin)/admin/roles/roles-client.tsx) | 1 | 203 | I | Map של קטגוריה לאינדקס נבנה יחד עם groups; כל גישה תואמת push קודם. | להחזיק Map<string, Group> לאובייקט עצמו או לשמור group מקומי בהסתעפות. |
| [`src/app/(customer)/app/events/[id]/guests/import/import-actions.ts`](../../../src/app/(customer)/app/events/[id]/guests/import/import-actions.ts) | 1 | 143 | I | grid.length < 2 נדחה לפני header=grid[0]. | לחלץ header ולבדוק אותו במפורש; לשמר הודעת CSV ריק ולא להכניס header ריק מלאכותי. |
| [`src/app/(customer)/app/events/[id]/guests/import/whatsapp/actions.ts`](../../../src/app/(customer)/app/events/[id]/guests/import/whatsapp/actions.ts) | 3 | 126, 127, 128 | I+C | rowIndex מחושב מחדש בשרת על rows דרך computeImportMatches ו־forEach; אינו אינדקס שמתקבל מהטופס. | לשמור row מקומי עם guard לפני בניית patch; עדיף חוזה שמקשר match לשורת המקור. לא לדלג בשקט על merge שנבחר. |
| [`src/app/(customer)/app/events/[id]/setup-stepper.tsx`](../../../src/app/(customer)/app/events/[id]/setup-stepper.tsx) | 1 | 92 | C | ה־prop מאפשר []; active.key ייכשל אז. היצרן הנוכחי computeSetupSteps בונה תמיד 6 שלבים. | לקודד מערך לא ריק בגבול היצרן/הרכיב או להגדיר מצב empty מפורש; לא לבחור שלב בדוי. |
| [`src/app/(customer)/app/page.tsx`](../../../src/app/(customer)/app/page.tsx) | 1 | 38 | I | rows.length===1 מגן על האיבר היחיד לפני redirect. | לשלוף firstEvent ולבדוק קיום עם האורך; לשמר ניתוב 0/1/2 אירועים ואת סינון RLS. |
| [`src/app/(customer)/app/team/roles/org-roles-client.tsx`](../../../src/app/(customer)/app/team/roles/org-roles-client.tsx) | 1 | 219 | I | Map של resource לאינדקס נבנה יחד עם groups. | להחזיק קבוצה עצמה ב־Map או משתנה group מקומי, כמו בגרסת staff. |
| [`src/app/(public)/r/[token]/rsvp-form.tsx`](../../../src/app/(public)/r/[token]/rsvp-form.tsx) | 1 | 440 | I | בדיקת GIFT_BRAND[key] קודמת לגישה חוזרת עם expression key; אין משתנה מצומצם יציב. | לחלץ giftBrand פעם אחת ולהשתמש בו בתנאי וב־icon; לשמר Gift fallback. |
| [`src/components/console/softphone-panel.tsx`](../../../src/components/console/softphone-panel.tsx) | 1 | 613 | I | effect יוצא כאשר chatMessages ריק, ואז ניגש לאיבר האחרון. | לחלץ latestMessage ולבדוק אותו לפני יצירת timer; לשמר קריאת unread רק כשהחלונית פתוחה. |
| [`src/components/date-select-il.tsx`](../../../src/components/date-select-il.tsx) | 2 | 75 | I+C | Regex מבטיח שלושה רכיבים לפני split אך string[] אינו tuple; ה־state מקבל string|undefined. | לתת ברירות מחדל ריקות ב־destructuring או parser שמחזיר tuple מאומת; לבדוק שמירת שנה מחוץ לטווח. |
| [`src/components/org-switcher.tsx`](../../../src/components/org-switcher.tsx) | 4 | 38, 49, 52, 73 | I | קיים early return על orgs.length===0; find fallback לאיבר ראשון אינו מצטמצם סטטית. | לחלץ firstOrg ולבדוק אותו, ואז לבחור active; לשמור מצב 0/1/רבים ואישור שרתי בשינוי ארגון. |
| [`src/components/reui/event-calendar/event-calendar-lib.tsx`](../../../src/components/reui/event-calendar/event-calendar-lib.tsx) | 2 | 420, 429 | I | כל lane נוצר ב־??= לפני קריאה/כתיבה, אך האינדקס משתנה בלולאה. | לשמור row שהוחזר מההשמה ולכתוב דרכו; לשמור אלגוריתם packing ולא להוסיף fallback שמסתיר overlap. |
| [`src/components/reui/event-calendar/event-calendar-month-view.tsx`](../../../src/components/reui/event-calendar/event-calendar-month-view.tsx) | 7 | 343, 347, 382, 496, 518, 521, 610 | I+B+C | גישה ל־week[0] ללא guard; סינון weekendDays עשוי להשאיר row ריק. offsets/hiddenBarKeysByCol מקבילים ל־week באינדקס. | לסנן/לטפל בשבוע ריק לפני רינדור child עם hooks; לצרף day/offset/hiddenKeys לרשומה אחת, ולתת ghost day מאומת. |
| [`src/components/reui/event-calendar/event-calendar-recurrence.tsx`](../../../src/components/reui/event-calendar/event-calendar-recurrence.tsx) | 1 | 509 | I | yearlyMonths תמיד לא ריק: חודשים תקפים או חודש העוגן היחיד. | לשמור first/last month במשתנים מאומתים או חוזה non-empty; לא להחליף בחודש שרירותי. |
| [`src/components/reui/event-calendar/event-calendar-time-grid.tsx`](../../../src/components/reui/event-calendar/event-calendar-time-grid.tsx) | 11 | 455, 463, 495, 496, 497, 498, 499, 500, 564, 565, 673 | I+C | lanes מאותחלים; comparator בודק אורכים שווים; drag מחשב colStart/colEnd מתוך days ויוצא אם אין התאמה. | לשמור lane מקומי, להגן על o ב־comparator ולהעביר תאריכי drag עצמם במקום חיפוש חוזר לפי אינדקס; לא להשתמש בהיום כ־fallback. |
| [`src/components/time-select-24.tsx`](../../../src/components/time-select-24.tsx) | 1 | 47 | I+C | Regex מבטיח HH:mm אך split מפיק string[] וה־state נשאר optional. | ברירות מחדל מפורשות ב־destructuring או parser tuple; לשמר דקה היסטורית מחוץ לכפולות 5. |

## דפוסי תיקון מוצעים

1. **גישה לערך עצמו:** לשמור איבר/ערך במשתנה ולבדוק אותו, ואז להשתמש באותו משתנה. זה מתאים ל־first/last, ל־GIFT_BRAND, ול־argv מחושב. בדיקת truthiness מתאימה לאובייקט, אך עבור מספרים יש להבחין ב־undefined כדי לא לדחות 0 חוקי.
2. **איטרציה בלי אינדקס חוזר:** `for...of`/`entries()` על אובייקטים, או `Object.entries()` על מילון, במקום לקבל מפתח ואז לחפש מחדש ערך. מתאים ל־audio, prosody ו־PATTERNS.
3. **חוזה סגור:** tuple עבור OPTIONS קבוע, map לפי union אמיתי עבור CelebrantKind, ומבנה לא ריק רק כאשר הבנאי אכן מבטיח אותו. אין להכריז non-empty באמצעות cast בלי הוכחה בבנאי.
4. **שלמות state/record:** state של הצעה חייב להישאר עם checked ו־override. הוספת optional לשני השדות תעביר את הבעיה לצרכנים ותשנה את החוזה.
5. **בדיקת גבול אמיתית:** parsing של CLI/SQL, שבוע ריק ורכיב שמקבל רשימה ריקה דורשים בחירה התנהגותית. אין להסתפק ב־`!`, `as`, `any` או שינוי flag.

ב־void-refusals יש לשמור את בדיקת own-property: החלפה נאיבית ל־`VOID_REFUSALS[code] ?? null` לבדה עשויה לאפשר שמות מ־prototype במקום קודי הסירוב הסגורים. ב־list-params יש לשמר את whitelist והנתיב הקבוע. תיקון טיפוסים אינו עילה לשינוי הרשאות או להרחבת קלט.

## אימות מומלץ אחרי תיקון עתידי

| תחום | מקרים שמאמתים התנהגות |
|---|---|
| לוח שנה | כל ימי השבוע מוסתרים; שבוע חלקי שמתרוקן; אפס אירועים; אירוע רב־יומי; drag מחוץ לטווח; יציבות hooks במעבר הגדרות; שוויון bars באורך זהה לאחר שינוי title/color. |
| תאריך ושעה | ערך ריק; פורמט פגום; 29 בפברואר; שנה מחוץ לטווח הבחירה; דקה 33; שמירת hidden field ו־RTL. |
| ניווט ורשימות | 0/1/2 אירועים; 0/1/רבים ארגונים; activeOrgId לא נמצא; כל שלבי setup גמורים; steps ריק לפי ההתנהגות שתיבחר. |
| טפסים והרשאות | id חסר ב־OfferForm; קוד סירוב לא מוכר ו־prototype key; query key לא מוכר; match index שאינו קיים. שמירת guards והודעות קיימות. |
| CLI | --channel ללא ערך/ערך לא מוכר; ללא silence; trailing silence; median באורך 0/1/2; SQL row חסר שדה/טבלה לא מוכרת. להשתמש ב־fixtures ולא במערכת חיה. |
| פעולות תפעוליות | תוכנית מיגרציה ללא OutCall/עם OutCall; התאמת rule id/name; 0/1/2 רשומות קמפיין/סוכן. יש לאמת פונקציות טהורות או mocks בלי חיוג, סבב סודות או שליחת הודעות. |

אחרי שינוי קוד יש לבצע typecheck עם הדגל, בדיקות ממוקדות לפי השינויים, ובהתאם ל־Definition of Done גם lint/build. טבלה זו היא תוכנית אימות, לא תוצאת בדיקות. אין צורך להריץ סקריפטים בעלי השפעות חיצוניות לצורך ניתוח האבחנות.

## גבולות האימות והמקורות

כל 35 הקבצים וכל 87 המיקומים נקראו במקור הנוכחי. נבדקו בנוסף יצרני setup steps, fleet stream, import matches, rule targets והגדרות סוף השבוע. הניתוח אינו סקירת כל ענפי הקבצים, ואינו סקירת אבטחה מלאה. לא נבדקו נתוני DB/ספקים חיים ולא בוצע שחזור runtime. מספור השורות מתייחס למצב הקוד בעת הניתוח.

נקראו הנחיות השורש וההנחיות המקומיות של `admin/assignments` ו־`admin/offers`. ההערות לגבי redirect משמרות את הזרימה הקיימת ובהתאם לתיעוד המותקן [`redirect.md`](../../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md): redirect מפסיק את הרינדור באמצעות חריגה פנימית; אין להכניס סביבו catch כללי כחלק מתיקון אינדקס. העבודה היא תיעוד ניתוח ואינה מממשת שינוי OpenSpec.
