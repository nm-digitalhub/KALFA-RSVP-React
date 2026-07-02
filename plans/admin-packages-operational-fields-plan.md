# תוכנית: הרחבת `/admin/packages` לחמשת שדות התצורה התפעוליים

**סטטוס: תוכנית בלבד. לא בוצע שום שינוי קוד/מיגרציה.**

**היקף:** 5 עמודות בטבלת `packages` שאין להן היום כל דרך עריכה מה-UI:
`price_per_reached, channels, outreach_schedule, min_hold_floor, hold_buffer_pct`.
`id`/`created_at` אינם editable מעולם ואינם בהיקף. שאר 8 העמודות
(`name, tier, category, description, price_with_vat, includes, active,
sort_order`) כבר מנוהלות במלואן ב-`/admin/packages` הקיים — לא נוגעים בהן.

---

## §1. עובדות מאומתות מהקוד ומה-DB החי (לא הנחות)

### 1.1 סכימה מדויקת (`information_schema.columns` + `pg_attribute`, נבדק ישירות)

| עמודה | טיפוס מדויק | NULL? | ברירת מחדל |
|---|---|---|---|
| `price_per_reached` | `numeric` | כן | — |
| `channels` | `campaign_channel[]` (enum array אמיתי, לא `text[]`) | כן | — |
| `outreach_schedule` | `jsonb` | כן | — |
| `min_hold_floor` | `numeric` | **לא** | `0` |
| `hold_buffer_pct` | `numeric` | **לא** | `0` |

`campaign_channel` (enum, נבדק ב-`pg_enum`): **`'whatsapp' | 'call'` — שני ערכים
בלבד.** מכיוון ש-`channels` הוא מערך-enum אמיתי ב-DB, ה-DB עצמו כבר חוסם כל ערך
שאינו אחד מהשניים — אין צורך ב-CHECK נוסף לזה.

### 1.2 Constraints קיימים (`pg_constraint`, נבדק ישירות)

`packages`: **רק** `PRIMARY KEY (id)`. שום CHECK constraint, לא על
`price_with_vat` (העמודה הקיימת המקבילה) ולא על שום עמודה אחרת. כלומר: **התקדים
הקיים בפרויקט הזה הוא ולידציה ב-Zod בלבד, לא ב-DB**, גם לשדה הכספי הקיים.

`campaigns`: `FOREIGN KEY (template_id) REFERENCES packages(id)` (ברירת מחדל
RESTRICT — לא ניתן למחוק package שקמפיין כלשהו מפנה אליו, גם קמפיין ישן; זה כבר
כך היום, לא שינוי).

RLS על `packages` (`pg_policies`, נבדק ישירות): `packages_admin_all` (ALL,
`has_role(admin)`) + `packages_public_read` (SELECT, `active=true`). **אין
צורך בשינוי RLS** — המדיניות הקיימת כבר מכסה את כל 15 העמודות ברמת השורה
(Postgres RLS הוא row-level, לא column-level).

### 1.3 כל צרכן של חמשת השדות (grep מלא על `src/`, לא sampling)

- **`price_per_reached`**: נקרא רק בשני מקומות: (א) `listCampaignTemplates()`
  (`campaigns.ts:97-119`) — מסונן `active=true AND price_per_reached IS NOT
  NULL`; (ב) `prepareCampaignHold()` (`campaigns.ts:472,478`) — אך שם זה נקרא
  מתוך **שורת ה-campaign**, לא מ-`packages` (ראו §1.4).
- **`channels`**: נקרא רק ב-`listCampaignTemplates()` (`campaigns.ts:101`).
- **`outreach_schedule`**: נקרא רק ב-`listCampaignTemplates()`
  (`campaigns.ts:101,116-117`). כל שאר השימושים ב-`outreach_schedule`
  בקודבייס (`outreach-engine.ts:94,110`, דפי `/app/events/.../campaign/...`)
  קוראים מ-**`campaigns.outreach_schedule`**, לא מ-`packages` — זו כבר עותק
  נעול (ראו §1.4).
- **`min_hold_floor`, `hold_buffer_pct`**: נקראים **רק** בתוך
  `getHoldSizingKnobs()` (`campaigns.ts:399-441`), הנקראת **רק** מתוך
  `prepareCampaignHold()` (`campaigns.ts:487-488`), הנקראת **רק** מתוך
  `POST /api/campaigns/[id]/authorize` (`authorize/route.ts:147`) — כלומר
  בשלב ה-J5 hold, אחרי אישור הקמפיין. זהו **המקום היחיד בכל הקודבייס** שבו
  שני השדות האלה נקראים.

אין אף צרכן נוסף (לא ב-`(admin)`, לא ב-`(customer)`, לא ב-worker) שלא נמצא
כאן.

### 1.4 Snapshot מול קריאה-חיה — תשובה מדויקת, לפי שדה (זו הנקודה הכי קריטית)

**`price_per_reached`, `channels`, `outreach_schedule` — SNAPSHOT מלא ב-CREATE:**
ב-`createCampaign()` (`campaigns.ts:129-181`), ההערה בקוד עצמה אומרת "locked
copy from the canonical template — the owner chooses nothing" (שורה 124-125).
הערכים מועתקים פיזית לתוך `campaigns.price_per_reached` (שורה 166),
`campaigns.allowed_channels` (שורה 169), `campaigns.outreach_schedule` (שורה
173) בזמן היצירה. **עריכת package אחרי שקמפיין נוצר לא משפיעה על הקמפיין
הזה בכלל** — רק על הקמפיין הבא שייווצר.

**`min_hold_floor`, `hold_buffer_pct` — קריאה חיה מ-`packages`, לא snapshot:**
`getHoldSizingKnobs(templateId, fullUnique)` שולף אותם ב-real time מ-`packages`
לפי `campaign.template_id` (שורות 424-434) — **בכל פעם** ש-`prepareCampaignHold`
רץ. `campaign.template_id` עצמו כן נעול (נקבע ב-create, לא משתנה), אבל
**הערכים** של שני השדות האלה **לא** נעולים.

### 1.5 השפעה רטרואקטיבית על קמפיינים קיימים — מאומת, לא הנחה

- קמפיין **לפני** ביצוע J5 hold (מצבים: `approved`/`scheduled`/`paused` עם
  `capture_status` ב-`null`/`hold_failed`/`hold_review` — ראו את ה-guard
  ב-`lockCampaignForHold`, `campaigns.ts:320-335`, שמאפשר **retry**): עריכת
  `min_hold_floor`/`hold_buffer_pct` **כן** משפיעה על הקמפיין הזה — כל קריאה
  חוזרת ל-`prepareCampaignHold` (כולל retry אחרי hold שנכשל) תשלוף את הערכים
  ה-**עדכניים ביותר** מ-`packages`.
- קמפיין **אחרי** hold מוצלח (`capture_status='authorized'`):
  `prepareCampaignHold` לא נקרא שוב באף נתיב תקין (`activateCampaign`,
  `closeCampaign`, close-charge — אף אחד מהם לא קורא לו). `close-charge.ts`
  קורא אך ורק את `campaign.max_charge_ceiling` **השמור** (הנגזר מ-
  `price_per_reached` הנעול, לא מחושב מחדש). כלומר **אחרי hold, עריכת package
  לא משפיעה בכלל** על אותו קמפיין.
- `prepareCampaignHold` גם שומר מחדש (persist) את `max_contacts`/
  `max_charge_ceiling` בכל קריאה (שורות 508-512) — אבל תמיד לפי ה-`price`
  **הנעול** מהקמפיין, לא ערך חדש מה-package. כלומר התקרה (ceiling) לעולם לא
  זזה בגלל עריכת מחיר בפאקג', רק בגלל שינוי במספר אנשי הקשר.

**מסקנה מאומתת (לא הנחה):** זהו כבר **חוזה מכוון** בקוד הקיים, לא תקלה —
3 מתוך 5 השדות נעולים ב-create, 2 מהם (hold-sizing) נשארים live-read עד
לרגע ה-hold. UI חדש **לא ישנה** את ההתנהגות הזו; אבל UI שהופך את העריכה
לקלה/תכופה מגדיל את הסיכוי המעשי שמישהו יערוך `min_hold_floor`/
`hold_buffer_pct` בזמן שיש קמפיין ב"סטטוס ביניים" (מאושר, לפני hold) —
שווה אזהרה מפורשת בטופס (ראו §4).

### 1.6 משמעות עסקית ל-null/ריק — מאומת לכל שדה

- **`price_per_reached = null`**: `listCampaignTemplates()` מסנן אותו החוצה
  לגמרי (`.not('price_per_reached','is',null)`) — package כזה פשוט לא מופיע
  כמסלול אפשרי. שקט, לא שגיאה.
- **`channels = [] או null`**: אם זה קורה ב-**התבנית הקנונית** (הראשונה
  active+priced לפי sort_order), `createCampaign()` **זורק שגיאה בעברית**
  ("למסלול השירות לא הוגדרו ערוצי פנייה", שורה 154-156) — **חוסם יצירת כל
  קמפיין חדש בכל המערכת** עד שמתקנים.
- **`outreach_schedule = [] או null`**: מתורגם ל-`[]` בשקט (שורה 116-117),
  **אין** בדיקת ריקנות מקבילה לזו של `channels`. קמפיין עם `outreach_schedule:
  []` נוצר בהצלחה היום — 0 touchpoints מתוזמנים. זו התנהגות קיימת לא-חסומה,
  לא הנחה שלי; ראו §4 לגבי אם לשנות זאת.
- **`min_hold_floor`/`hold_buffer_pct` חסרים/לא-תקינים**: `getHoldSizingKnobs`
  עטוף ב-try/catch ונופל בבטחה ל-`0`/`0` (שורות 422-437) אם השורה חסרה,
  `templateId` הוא null, או הערך לא `Number.isFinite`/שלילי. כלומר NULL אף
  פעם לא **מעלה** את סכום ה-hold, רק מוריד/מאפס אותו — fail-safe מכוון וקיים.

### 1.7 `message_key` בתוך `outreach_schedule` — סיכון אמיתי מאומת, לא תיאורטי

`OutreachTouchpoint.message_key` (`campaigns.ts:79-83`) הוא מחרוזת חופשית,
**לא** FK. הוא נפתר ב-**זמן שליחה בפועל**, לא בזמן שמירת package:
`getTemplateByKey(messageKey)` (`message-templates.ts:18-31`) מחזיר `null`
בשקט אם אין שורה תואמת/פעילה — **לא זורק**. ב-`outreach-engine.ts:261-266`,
אם `template` הוא `null` (או הערוץ לא תואם), הצעד **מדלג בשקט**
(`return {action:'skipped'}`) — **אין שום שגיאה גלויה, שום לוג ייעודי, שום
התראה**. כלומר: `message_key` שגוי (טעות הקלדה) בעמודת `outreach_schedule`
של package יגרום להיעדר-שקט של הודעות outreach ללקוחות, ללא שום אינדיקציה.
זהו הסיכון התפעולי המשמעותי ביותר שנמצא בבדיקה הזו.

(לא נבדק: מה קורה בנתיב `call` ל-`message_key` שגוי — זה מגיע ל-worker
ה-AI-calling דרך `scriptKey`, שלא נחקר בהיקף הבדיקה הזו. מסומן כפער-בדיקה
פתוח, לא הנחה.)

### 1.8 תקדים ולידציה קיים (`packageBaseSchema`, `validation/admin.ts:71-114`)

השדה המספרי הקיים (`price_with_vat`) משתמש ב-
`z.coerce.number({error:'...'}).nonnegative({error:'...'})` עם הודעת שגיאה
בעברית. `sort_order` משתמש ב-`z.preprocess` להפוך ריק/undefined ל-`0`
כברירת מחדל, ואז `.coerce.number().int().nonnegative()`. זהו התקדים
המדויק שהתוכנית למטה ממשיכה אותו — לא ממציאה דפוס חדש.

---

## §2. החלטות מוצר שדרושות ממך (לא מוחלטות כאן)

**מושג מרכזי שנדרש עקב §3 בפידבק:** `package.price_per_reached IS NOT NULL`
מגדיר את ה-package כ-**campaign-enabled** (מסלול קמפיין אפשרי, §1.6). package
עם `price_per_reached = null` הוא package **רגיל, לא-קמפיין** (למשל: package
עתידי-בהכנה, או package שאינו מסלול-outreach בכלל) — זהו מצב **תקף וקיים
כבר היום** (§1.6), לא שגיאה. כל הולידציה למטה חייבת להבחין בין שני המצבים —
לא לאכוף שדות-קמפיין על package שאינו campaign-enabled.

1. **`price_per_reached` — המלצה:** `null` = package לא-קמפיין (תקף). אם
   מוזן ערך — חייב להיות **חיובי** (`0` אינו תקף כברירת מחדל). **לא**
   `positive()` גורף שחוסם `null` — ראו §5.1 המתוקן.
   **אזהרה קריטית שנוספה בסבב-בדיקה שני, לפני שמאשרים "קמפיין בחינם"
   (`price=0`):** זו **לא** החלטת-Zod טהורה. אומת ישירות: `prepareCampaignHold`
   (`campaigns.ts:479-481`) **זורק שגיאה קשיחה** על `price <= 0` ("מחיר לאיש
   קשר אינו תקין"), ו-`listCampaignTemplates` (`campaigns.ts:103`) מסנן רק
   `IS NOT NULL`, **לא** `> 0` — כך שpackage עם `price_per_reached=0` יעבור
   כ-canonical, ייכנס ליצירת קמפיין בהצלחה (`createCampaign`), **ויקרוס
   רק בשלב ה-J5 hold**. אם התשובה ל-"קמפיין בחינם" היא כן, ההיקף גדל: צריך
   גם לשנות את ה-guard ב-`prepareCampaignHold` (ואולי את הסינון ב-
   `listCampaignTemplates`), לא רק להתיר `0` ב-Zod של הטופס. אם התשובה היא
   לא (המלצת ברירת המחדל) — `positive()` בטופס מספיק ומונע לחלוטין את
   התרחיש הזה.
2. **`channels`/`outreach_schedule` — חובה רק כשה-package campaign-enabled.**
   כש-`price_per_reached` אינו null: `channels` חייב ≥1 ערך (תואם את הבדיקה
   הקיימת ב-`createCampaign`, §1.6). `outreach_schedule` — האם לחייב ≥1
   touchpoint גם כן? עדיין פתוח, נא להחליט (אין תקדים לכך היום ב-DB/קוד,
   אבל `channels` הריק כבר נחסם באנלוגיה ישירה).
3. **`hold_buffer_pct` — המלצה: `nonnegative()` בלבד, ללא ceiling.** לא
   נמצאה שום עדות בקוד/דאטה לגבול עליון קיים או מכוון — לא תיקבע ceiling
   בלי נתון עסקי.
4. **`message_key` — נדרשים שני מנגנונים משלימים, לא אחד:**
   (א) ולידציה בזמן יצירה/עדכון package מול `message_templates`
   (`message_key` קיים + `active=true` + `channel` תואם ל-touchpoint) —
   תופסת טעות-הקלדה בזמן העריכה.
   (ב) **טיפול גלוי בזמן ריצה** כש-`getTemplateByKey` לא מוצא/לא תואם
   (`outreach-engine.ts:264`) — כרגע `{action:'skipped'}` שקט לגמרי, בלי לוג
   ייעודי/activity event/התראה. (א) לבדה **לא** מספיקה: תבנית יכולה
   להתבטל/להימחק/לשנות ערוץ **אחרי** ששמרתם את ה-package (ה-`outreach_schedule`
   כבר הועתק ל-snapshot בקמפיין קיים, §1.4) — (א) לא תתפוס את זה בזמן אמת.
   שני המנגנונים ביחד הם ההיקף הנדרש, לא רק (א), **אך שניהם מוגבלים בפועל
   ל-whatsapp — הוכרע בסבב-בדיקה רביעי, כבר לא "פער-בדיקה פתוח":** grep מלא
   על `src/`+`worker/` מאשר ש**אין שום קונסיומר ל-`scriptKey`/call-processing
   בקודבייס הזה בכלל** (`outreach-engine.ts:280-293` רק מכניס לתור, בהערה
   "the worker enqueues **C2's** per-contact dial" — שלב עתידי לא-ממומש).
   אין אפוא מה לאמת מולו כרגע. ראו §5.3 המעודכן לניסוח המדויק ולתיעוד
   ההחלטה.
5. **`touchpoint.channel` תת-קבוצה של `channels` ברמת ה-package?** לא נאכף
   היום. המלצה: כן לאכוף, אלא אם יש מדיניות מפורשת של cross-channel outreach
   (הודעת WhatsApp + תזכורת טלפונית על package שה-`channels` שלו הוא
   `['whatsapp']` בלבד) — נא לאשר אם התרחיש הזה אכן רצוי.
6. **CHECK constraints ב-DB — המלצה: אופציה ב' (§6), CHECK מינימלי לערכים
   שליליים בלבד**, אחרי **preflight query** שמוודא שאין כיום שורה חיה
   שסותרת את ה-constraint (ראו §6/§7 המעודכנים) — לא להריץ migration עיוור.

---

## §3. הנחות (מסומנות במפורש, מינימליות)

- מניח ש-**התיעוד היחיד** לגבי מה נחשב "מסלול קנוני" (`resolveCanonicalTemplate`
  — הראשון לפי `sort_order` מבין ה-active+priced) ימשיך להיות אמת-יחידה גם
  אחרי ההרחבה — לא מוצע לשנות את מנגנון הבחירה.
- ~~מניח ש-`outreach_schedule` בטופס יימשך בפורמט טקסט/JSON~~ **תוקן:** ראו
  §5.4 — עורך שורות מובנה (days_before + channel + message_key), לא טקסט/JSON
  חופשי. הגרסה הקודמת של הנחה זו סתרה את §5.4 במפורש; JSON חופשי מחזיר
  בדיוק את סיכון הטעויות-השקטות שמזוהה ב-§1.7, ולכן אינו אופציה סבירה כלל —
  זו כבר לא רק הנחת-סגנון, זו דרישה נובעת ישירות מ-§1.7.
- מניח ש-activity logging (`logActivity`, כבר קיים ב-`admin/packages.ts` עבור
  `package.created`/`package.updated`) צריך להתרחב לכלול את 5 השדות
  החדשים ב-`changedFields`/`fields` — עקבי עם הדפוס הקיים, לא שינוי.

---

## §4. סיכונים פתוחים (מאומתים, לא תיאורטיים)

1. **(גבוה) `message_key` שגוי/מיושן → היעדר-שקט של הודעות** — ראו §1.7.
   אין שום מנגנון קיים שיתפוס את זה. חשוב: ולידציה בזמן שמירת package
   (§2#4-א) תופסת רק טעות-הקלדה **באותו רגע** — היא **לא** מגנה מפני
   דריפט מאוחר יותר (תבנית מנוטרלת/נמחקת/משנה ערוץ **אחרי** ששמרתם, בעוד
   ה-`outreach_schedule` כבר הועתק ל-snapshot של קמפיין קיים, §1.4). לכן
   §2#4 דורש גם מנגנון (ב) — טיפול גלוי בזמן ריצה, לא רק ולידציה מוקדמת.
   מומש כעת ב-§5.6 (סבב-בדיקה שלישי — היה חסר לגמרי בגרסאות הקודמות).
2. **(בינוני) עריכת `min_hold_floor`/`hold_buffer_pct` באמצע-תהליך** — קמפיין
   שאושר אך טרם ביצע hold (כולל retry אחרי כישלון) ייקח את הערך העדכני,
   לא את מה שהיה בזמן האישור. עם UI קל-לעריכה, זה עובר מ"נדיר, ידני-SQL"
   ל"אפשרי בטעות". **דיוק מסבב-בדיקה שני:** אזהרה בטופס + תיעוד הערך הקודם
   ב-activity log הם **מודעות בלבד, לא מניעה** — הם לא עוצרים את ההשפעה על
   קמפיין קיים, רק מתעדים אותה אחרי העובדה. אם נדרשת מניעה אמיתית (למשל
   "נעילת" הערכים בזמן שיש קמפיין ב-`approved`/`scheduled`/`paused` התלוי
   באותו package), זו הרחבה נפרדת שלא נכללת כאן — לא הונח שהיא נדרשת, זו
   רק הבהרת-דיוק למה שהמסמך כבר מציע.
3. **(נמוך-בינוני) `outreach_schedule` ריק לא נחסם** — קמפיין "שקט" (ללא
   touchpoints) ניתן ליצירה כבר היום; UI חדש לא מחמיר את זה, אבל גם לא
   מתקן.
4. **(נמוך) מחיקת package** — חסומה ע"י FK אם קמפיין כלשהו (אפילו ישן,
   סגור) מצביע אליה (`template_id` RESTRICT). זו כבר ההתנהגות הקיימת; ה-UI
   החדש צריך להציג הודעת שגיאה ברורה במקום שגיאת DB גולמית אם admin ינסה
   למחוק package "בשימוש".
5. **(הוכרע בסבב-בדיקה רביעי, כבר לא פער-בדיקה פתוח)** ולידציית `message_key`
   מוגבלת ל-whatsapp בלבד; touchpoints מסוג `call` לא מאומתים מול
   `message_templates` (§5.3) — כי אין היום שום קוד בריפו שצורך `scriptKey`
   בכלל (אומת ב-grep מלא, "C2" הוא שלב עתידי). לא סיכון תפעולי חי כרגע —
   ייבחן מחדש כשמסלול ה-call ייבנה בפועל.

---

## §5. מסלול 1 — הרחבת שכבת האדמין (Zod, data layer, actions, form, defaults, טסטים)

כל השינויים המתוארים כאן הם **תוספות** לצד הקיים (§1.1 הטבלה של 10 העמודות
הקיימות) — לא שינוי מבנה קיים. הכל ממשיך את הדפוסים המאומתים ב-§1.8.

### 5.1 Zod (`src/lib/validation/admin.ts`) — מבני בלבד, ללא async

**תוקן:** אין async refine בתוך ה-schema (ראו נימוק ב-§5.3 — `safeParse`
הקיים לא מריץ אימות אסינכרוני; הפרדה בין ולידציה מבנית ל-DB-ולידציה נפרדת).
אין `PRICE_PER_REACHED_MAX` — אין ראיה לגבול עליון, לכן לא נכלל קבוע-placeholder
בלי החלטה תואמת (§2#3 מכסה את `hold_buffer_pct` בלבד, שגם לו אין ceiling).
הולידציה מבחינה בין package campaign-enabled ללא-campaign-enabled (§2, המושג
המרכזי) דרך `superRefine`, לא דרך `.positive()`/`.min(1)` גורפים:

```ts
const pricePerReachedField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z.union([z.null(), z.coerce.number({ error: 'נא להזין מחיר לאיש קשר תקין' })]),
); // null מותר במפורש — package לא-קמפיין (§1.6/§2#1), לא שדה-חובה

const channelsField = z.array(z.enum(Constants.public.Enums.campaign_channel));
// אין .min(1) כאן — האכיפה תלויה במצב campaign-enabled, ראו superRefine למטה

const outreachTouchpointSchema = z.object({
  days_before: z.coerce.number().int().nonnegative(),
  channel: z.enum(Constants.public.Enums.campaign_channel),
  message_key: z.string().trim().min(1, { error: 'נא לבחור תבנית הודעה' }),
  // בדיקה מול message_templates (§2#4-א) היא ב-Server Action, לא כאן — ראו §5.3
});

const outreachScheduleField = z.array(outreachTouchpointSchema); // מבנה בלבד; חובת-מינימום תלויה ב-§2#2

const minHoldFloor = z.coerce
  .number({ error: 'נא להזין רצפת hold תקינה' })
  .nonnegative({ error: 'רצפת ה-hold לא יכולה להיות שלילית' }); // תקדים זהה ל-price_with_vat

// תוקן בסבב-בדיקה רביעי: תווית-בלבד (סבב 3) לא מנעה קלט פי-10 בפועל —
// `10` עדיין עובר `nonnegative()` ומייצר buffer של 1000%. הטופס מקבל אחוזים
// (§5.4), הממיר-לשבר קורה כאן, לפני ש-`operationalFieldsSchema` מאומת:
const holdBufferPctPercent = z.coerce
  .number({ error: 'נא להזין אחוז buffer תקין (לדוגמה: 10 = תוספת 10%)' })
  .nonnegative({ error: 'האחוז לא יכול להיות שלילי' });
const holdBufferPct = holdBufferPctPercent.transform((percent) => percent / 100); // מאוחסן כשבר — computeHoldAmount (campaigns.ts:66-75) מצפה לשבר, אין שינוי באחסון עצמו

export const operationalFieldsSchema = z
  .object({
    price_per_reached: pricePerReachedField,
    channels: channelsField,
    outreach_schedule: outreachScheduleField,
    min_hold_floor: minHoldFloor,
    hold_buffer_pct: holdBufferPct,
  })
  .superRefine((val, ctx) => {
    const campaignEnabled = val.price_per_reached !== null;
    if (!campaignEnabled) return; // package רגיל — אין דרישות נוספות
    if (val.price_per_reached !== null && val.price_per_reached <= 0) {
      ctx.addIssue({ code: 'custom', path: ['price_per_reached'], message: 'המחיר לאיש קשר חייב להיות חיובי' });
    }
    if (val.channels.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: 'יש לבחור לפחות ערוץ אחד למסלול קמפיין' });
    }
    // outreach_schedule.length === 0 → issue נוסף כאן, רק אם §2#2 נקבע כ"חובה"
  });
```

**שדה נפרד** (`operationalFieldsSchema`), לא מיזוג כפוי ל-`packageBaseSchema`
היחיד — כדי לאפשר להרכיב את שתיהן יחד ב-action (`packageBaseSchema.merge
(operationalFieldsSchema)` או `z.intersection`) בלי לסבך את ה-`superRefine`
התלוי-מצב עם שאר השדות הלא-קשורים.

### 5.2 Data layer (`src/lib/data/admin/packages.ts`)

- `PACKAGE_COLUMNS`: להוסיף את 5 השדות.
- `AdminPackage` (Pick type): להוסיף את 5 השדות ל-`Pick<PackageRow, ...>`.
- `toWritable()`: להוסיף מיפוי 5 השדות (כולל `includesJson`-style cast עבור
  `outreach_schedule` ל-`Json`, מדויק לדפוס הקיים ב-`campaigns.ts:173`).
- `packageChangedFields()`: להוסיף את 5 השדות להשוואה (עבור activity log).
  **תיקון מסבב-בדיקה שני:** `channels`/`outreach_schedule` הם מערכים —
  השוואת `!==` רגילה (כמו לשדות המספריים) תדווח "השתנה" תמיד, בהשוואת-הפניה.
  יש להשוות עם `JSON.stringify`, בדיוק כמו התקדים הקיים ל-`includes`
  (`packages.ts:129`) — לא דפוס חדש, המשך של מה שכבר קיים באותו קובץ.
- `listCampaignTemplates()`/`resolveCanonicalTemplate()` (`campaigns.ts`) —
  **לא לשנות** — הם כבר קוראים ישירות מה-DB ולא תלויים בשכבת האדמין.
- **תוקן בסבב-בדיקה רביעי — סתירה ממשית שנפתרה:** §4 (סיכון #4) התחייב
  ל"הודעת שגיאה ברורה במקום שגיאת DB גולמית" במחיקת package בשימוש, אבל
  §5.3 (בגרסה הקודמת) קבע ש-`deletePackageAction` "לא משתנה" — סתירה. אומת
  ש-`deletePackage()` הקיים (`packages.ts:191-201`) עוטף כל שגיאה בהודעה
  גנרית אחת ("מחיקת החבילה נכשלה") ללא הבחנה בין FK-בשימוש לכשל אחר — לא
  שגיאת-DB-גולמית, אבל גם לא ההודעה הספציפית שה-UI מתחייב לה. **התיקון
  שייך כאן (data layer), לא ב-actions — כך ש-§5.3 נשאר נכון שה-action עצמו
  לא משתנה:**
  ```ts
  const { error } = await supabase.from('packages').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') { // foreign_key_violation — PostgREST/Postgres error code, לא תלוי-project
      throw new Error('לא ניתן למחוק חבילה שמשויכת לקמפיין קיים (גם קמפיין ישן/סגור)');
    }
    throw new Error('מחיקת החבילה נכשלה');
  }
  ```
  זה דפוס **חדש** לפרויקט הזה (לא נמצא תקדים קיים לבדיקת `error.code`
  ספציפי בקודבייס) אך מבוסס על צורת-שגיאה מתועדת ויציבה של Postgrest/
  Postgres, לא המצאה. נדרש טסט: מחיקת package שקמפיין (אפילו ישן/`cancelled`)
  מפנה אליו מחזירה את ההודעה הספציפית, לא הגנרית.

### 5.3 Actions (`src/app/(admin)/admin/packages/actions.ts`)

`readPackageForm()` להרחיב לקרוא את 5 השדות מ-`FormData`. **תיקון קריטי:**
`channels` הוא checkbox מרובה-בחירה — יש לקרוא עם **`formData.getAll('channels')`**,
לא `formData.get('channels')`. `.get()` מחזיר רק ערך יחיד (הראשון) ולא
מבחין בין "לא נבחר כלום" ל"שדה לא נשלח כלל" — שתי טעויות ששוברות את הבחנת
ה-campaign-enabled ב-§5.1.

**תוקן — אין async refine ב-Zod (ראה §5.1):** הזרימה נשארת סינכרונית עם
`safeParse` (לא `safeParseAsync`) לשלב המבני. ולידציית `message_key` מול
`message_templates` (§2#4-א) רצה **אחרי** ה-`safeParse` המוצלח, כצעד DB
נפרד וממוקד:

```ts
// תוקן בסבב-בדיקה שלישי: batch, לא N+1. message_key הוא UNIQUE ב-DB
// (migration 202606290030, שורה 14), אז fetch יחיד + Map מספיקים.
// תוקן בסבב-בדיקה רביעי: מוגבל ל-whatsapp בלבד, ראו נימוק אחרי הקוד.
async function validateOutreachScheduleForPackage(
  schedule: OutreachTouchpoint[],
): Promise<{ index: number; message: string }[]> {
  const whatsappTouchpoints = schedule
    .map((tp, index) => ({ tp, index }))
    .filter(({ tp }) => tp.channel === 'whatsapp');
  const uniqueKeys = [...new Set(whatsappTouchpoints.map(({ tp }) => tp.message_key))];
  const admin = createAdminClient();
  const { data } = await admin
    .from('message_templates')
    .select('message_key, name, language, channel')
    .in('message_key', uniqueKeys)
    .eq('active', true);
  // שומר בדיוק את סמנטיקת getTemplateByKey (message-templates.ts:28-30):
  // name/language/channel ריקים נחשבים "לא נמצא", לא רק active=false/חסר.
  const byKey = new Map(
    (data ?? [])
      .filter((t) => t.name && t.language && t.channel)
      .map((t) => [t.message_key, t]),
  );
  const errors: { index: number; message: string }[] = [];
  whatsappTouchpoints.forEach(({ tp, index }) => {
    const template = byKey.get(tp.message_key);
    if (!template) {
      errors.push({ index, message: `תבנית "${tp.message_key}" לא נמצאה או אינה פעילה` });
    } else if (template.channel !== tp.channel) {
      errors.push({ index, message: `תבנית "${tp.message_key}" מיועדת לערוץ אחר` });
    }
  });
  // touchpoints מסוג call לא מאומתים כלל כאן — ראו נימוק אחרי הקוד.
  return errors;
}
```

**עדכון קריטי (אחרי בדיקה נוספת ביוזמת המשתמש — "יש רק תוכנית אחת, כוללת
גם WhatsApp וגם AI voice"):** אומתתי ישירות מול RPC החי
`try_record_billed_result` — **זו באמת תוכנית אחת, לא שתיים**: `price_per_reached`
יחיד לקמפיין (לא תלוי-ערוץ), חיוב הוא ברמת **contact_id** (`on conflict
(event_id,contact_id) do nothing`) לא ברמת ערוץ — הגעה ב-whatsapp *או*
בשיחה מחייבת פעם אחת בלבד, לא שתיים, ותקרת החיוב משותפת. `call`/AI-voice
(Voximplant) אינו "פחות חשוב" מ-whatsapp — הוא מתוכנן במפורש כחצי-שווה של
אותה תוכנית, גם אם התשתית טרם נבנתה (`channels-client.tsx:193-194,304`:
טאב מנוטרל, "Voximplant (בקרוב)... ייפתח עם בניית הערוץ (C2)" — הצהרה
בקוד עצמו, לא מסקנה מ-grep). **לכן ההחלטה תוקנה:** הטופס **לא חוסם** עריכת
touchpoints מסוג call (זה חלק לגיטימי מהתוכנית האמיתית) — אבל גם **לא
מציג אותם כמאומתים** כמו whatsapp. כל touchpoint מסוג `call` מסומן ב-UI
באופן גלוי כ"לא מאומת — ערוץ ה-AI voice (Voximplant) טרם נבנה (C2)",
במקום פשוט לדלג על ולידציה בשקט. `validateOutreachScheduleForPackage`
עדיין מוגבל ל-whatsapp בפועל (אין מקור-אמת אחר לבדוק מולו כרגע) — הפער
הוא רק בעיצוב, לא בפונקציונליות.

**למה רק whatsapp נבדק בפועל מול `message_templates`:** אומת
ב-full-repo grep (לא רק ב-`outreach-engine.ts`) — `getTemplateByKey`/
`message_templates` נצרכים **אך ורק** בנתיבי whatsapp: `outreach-engine.ts:263`
(הענף `whatsapp`) ו-`outreach.ts:105` (שולח ה-B3 הידני, שגם הוא בודק
`template.channel !== 'whatsapp'` ב-שורה 106 ומבטל אחרת). ענף ה-`call`
(`outreach-engine.ts:280-293`) **אף פעם לא** קורא ל-`getTemplateByKey` —
הוא רק מעביר `scriptKey: tp.message_key` ל-callRequest בתור, בהערה
"the worker enqueues **C2's** per-contact dial" (שם-שלב עתידי, לא ממומש).
חיפוש מלא בריפו (`src/` + `worker/`) אחר צרכן שני ל-`scriptKey`/מנגנון
call-processing **לא העלה שום קובץ** — כלומר **אין עדיין קונסיומר ל-call
בקודבייס הזה בכלל**. יש אמנם שורת `call_1`/`channel='call'` קיימת ב-
`message_templates` החי, אך שום קוד לא קורא אותה — היא לא הוכחה כמקור-אמת.
לכן: להחיל את אותה ולידציה על `call` היה מאמת מול טבלה **שאין לה קשר מוכח**
לכל מה שיקרה בפועל כשמסלול ה-call ייבנה — עלול גם לדחות ערכים תקינים וגם
"לאשר" ערכים שלא יעבדו בפועל. `channels`/`outreach_schedule` **עדיין
תומכים ב-`call`** ברמת הסכימה/הטופס (§5.1/§5.4 לא משתנים — מגבלה זו נוגעת
רק לוולידציית `message_templates`, לא לזמינות הערוץ) — רק שלב האימות הזה
הספציפי מוגבל ל-whatsapp, מתועד כמגבלה מכוונת עד שמסלול ה-call ייבנה
ויאומת חוזהו.

יתרון הגישה הזו (במקום async refine בתוך ה-schema, כפי שהוצע קודם ותוקן):
מפרידה בין ולידציה מבנית (סינכרונית, ללא DB) לבין ולידציית-תוכן (אסינכרונית,
תלוית DB), ומאפשרת להחזיר שגיאת-שדה ממוקדת per-touchpoint במקום שגיאה גורפת.
`createPackageAction`/`updatePackageAction` יקראו לפונקציה הזו רק אם
`operationalFieldsSchema`'s `safeParse` הצליח וה-package campaign-enabled,
ויחזירו `fieldErrors` (בבניית-מפתח ידנית, לא `.flatten()` — ראו §5.4) אם יש
תוצאה לא ריקה — **לפני** קריאה ל-`createPackage`/`updatePackage`.
`deletePackageAction` לא משתנה.

### 5.4 טופס (`package-form.tsx`)

הוספת שדות: קלט מספרי ל-`price_per_reached` (`type=number`, `dir=ltr`,
תואם בדיוק לדפוס `price_with_vat` הקיים), checkboxes ל-`channels` (2
אפשרויות בלבד — whatsapp/call, לא dropdown-חופשי), עורך outreach_schedule
(רשימת שורות דינמית — days_before + channel + message_key; **לא** JSON
חופשי בטקסטאה כדי למנוע טעויות-הקלדה שקטות ב-§1.7), שני קלטי מספר ל-
`min_hold_floor`/`hold_buffer_pct` עם **אזהרה מפורשת שהיא מודעות בלבד, לא
מניעה** (ראו §4.2 המעודכן).

**יחידת `hold_buffer_pct` — תוקנה שנית (סבב-בדיקה רביעי): תווית-בלבד לא
מספיקה.** בסבב הקודם הוצע קלט-שבר + תווית הסבר, בנימוק שהמרה מוסיפה נקודת-
כשל מיותרת. המשוב הרביעי צדק לדחות זאת: `10` **עדיין תקף** תחת `nonnegative()`
ומייצר buffer של 1000% — תווית היא המלצה-לעין, לא אכיפה, ולא פותרת את
הסיכון שכבר הוגדר כ"לא הערת-UX קטנה". **הוכרע סופית:** הטופס מציג ומקבל
**אחוזים** ("Buffer (%)", `type=number`, `min=0`, `step=0.1`) — האדמין
מקליד `10` ומתכוון ל-10%. ההמרה `percent/100` קורית ב-Zod (§5.1,
`holdBufferPctPercent.transform`) **לפני** האחסון — `hold_buffer_pct`
ב-DB **נשאר שבר** (אין שינוי בטבלה/ב-`computeHoldAmount`, רק בשכבת-הקלט).
בעריכת package קיים, הטופס חייב **להמיר בחזרה** לתצוגה (`storedFraction ×
100`) — לא להציג את השבר הגולמי. **טסטים חובה:** (א) round-trip — קלט `10`
→ נשמר `0.1` ב-DB → טעינת טופס-עריכה מציגה `10` מחדש; (ב) `computeHoldAmount`
עם `hold_buffer_pct=0.1` (הערך המאוחסן) מחזיר בדיוק covered×price×1.1
(מכוסה כבר ב-§5.5#4, ללא שינוי — הבדיקה הזו על החישוב עצמה כן נשארה נכונה
משני הסבבים).

**סריאליזציה של `outreach_schedule` — הוכרעה (סבב-בדיקה שלישי, לא עוד
"לבחור בזמן המימוש"):** שדה `hidden` יחיד (`outreach_schedule_json`) שה-JS
בצד הלקוח ממלא מרכיבי-השורה המובנים; `readPackageForm()` מפענח אותו כ-JSON
מבוקר (`JSON.parse` בתוך try/catch, לא Zod ישירות על מחרוזת) ומעביר `array`
ל-`operationalFieldsSchema`. האדמין לא מקליד/עורך JSON גולמי בעצמו — רק
ה-UI המובנה נוגע בטקסט. **הבהרה:** זה **לא** אותו דפוס כמו `includes` (ש-
מפוענח כטקסט-מופרד-שורות בתוך ה-Zod pipe עצמו, `includesFromTextarea`,
`validation/admin.ts:54-67`) — זהו דפוס JSON-בתוך-hidden-field חדש, נקי
ותקין, פשוט שונה מהתקדים הקיים.

**מוסכמת נתיב-שגיאה + חסם קיים שחייב טיפול:** שגיאות per-touchpoint
יוחזרו כ-`outreach_schedule.{index}.{field}` (למשל
`outreach_schedule.0.message_key`). **אבל** `createPackageAction`/
`updatePackageAction` הקיימים (`actions.ts:36`) משתמשים ב-
`parsed.error.flatten().fieldErrors` — `.flatten()` מפיק **רק** מפתחות
ברמה-עליונה, לא נתיבים מקוננים-עם-אינדקס. יש לנטוש `.flatten()` עבור
השגיאות של `outreach_schedule` ולבנות את המפתח ידנית מ-`issue.path.join('.')`
על `parsed.error.issues` (ה-`FormState.fieldErrors` הקיים, `Record<string,
string[]|undefined>` ב-`validation/result.ts:7`, כבר תומך במפתח-מחרוזת
שרירותי — זו הרחבת-בנייה, לא שינוי טיפוס). כנ"ל למיפוי `{index}` המוחזר
מ-`validateOutreachScheduleForPackage` (§5.3 המעודכן) לאותה מוסכמת-מפתח.

### 5.5 טסטים (מיפוי ישיר לדרישת המשתמש)

ב-`src/lib/data/admin/packages.test.ts` (הרחבה) + `src/lib/data/campaigns.test.ts`
(הרחבה, לא קובץ חדש — התנהגות ה-hold כבר נבדקת שם). **שני טסטים נוספו
בסבב-בדיקה רביעי** (מיפוי ישיר לנקודות 2/4 במשוב): (א) מחיקת package
שקמפיין (כולל `cancelled`) מפנה אליו מחזירה את ההודעה הספציפית מ-§5.2, לא
"מחיקת החבילה נכשלה" הגנרית; (ב) round-trip ליחידת `hold_buffer_pct` —
`operationalFieldsSchema.parse({hold_buffer_pct: '10', ...})` מייצר
`hold_buffer_pct: 0.1`, וטעינת טופס-עריכה על package עם `hold_buffer_pct=0.1`
בDB מציגה ערך התחלתי `10`.

1. **יצירה ועריכה של כל 5 השדות** — `createPackage`/`updatePackage` עם ערכים
   מלאים בחמשת השדות; `getPackage` מחזיר אותם שלמים ובלי שינוי-צורה.
2. **דחיית numeric שלילי** — `price_per_reached: -1`, `min_hold_floor: -1`,
   `hold_buffer_pct: -1` → כל אחד נדחה ב-Zod, לא מגיע ל-DB.
3. **שמירת `channels`/`outreach_schedule` בלי שינוי צורה** — round-trip
   test: שמור מערך touchpoints מסוים, קרא בחזרה, `toEqual` מדויק (תופס
   רגרסיית `as unknown as Json` cast, בדיוק כמו הבאג ההיסטורי ב-
   `max_charge_ceiling`).
4. **חישוב ה-hold משתמש בערכים הצפויים** — טסט חדש/מורחב ל-
   `getHoldSizingKnobs`/`prepareCampaignHold`: package עם `min_hold_floor=50,
   hold_buffer_pct=0.1` → `computeHoldAmount` מחזיר בדיוק את הערך הצפוי
   (יש כבר `computeHoldAmount` pure function שניתן לבדוק ישירות בלי mocking
   DB, זה הכי פשוט).
5. **snapshot מול live-read — שלושה טסטים נפרדים, לא אחד (תוקן — הניסוח
   הקודם היה הפוך וגם טכנית שגוי: `min_hold_floor`/`hold_buffer_pct` בכלל
   לא נשמרים בטבלת `campaigns`, אז אי אפשר לבדוק אותם דרך `getCampaign`):**

   - **5א. שדות ה-snapshot ננעלים ב-`createCampaign` ולא זזים אח"כ — תוקן
     שנית (סבב-בדיקה שני תפס שהניסוח הקודם עדיין שבור).** `getCampaign`
     (מחזיר `OwnerCampaign`, `campaigns.ts:22-37`) **לא כולל** `outreach_schedule`
     בכלל (רק `price_per_reached`/`allowed_channels`). `getCampaignForHold`
     (מחזיר `CampaignHoldState`, `campaigns.ts:300-303`) **לא כולל אף אחד**
     משלושת השדות — רק `id, event_id, status, max_charge_ceiling,
     capture_status`. כלומר הטסט **לא יכול** להיכתב דרך שני ה-getters האלה
     כפי שנוסח קודם — זו הייתה עדיין אותה מחלקת-באג (בדיקת שדה דרך getter
     שלא מחזיר אותו), ואם ממומש מילולית **נופל על `tsc`**. הנתיב הנכון:
     שאילתה ישירה (admin client, `select('price_per_reached, allowed_channels,
     outreach_schedule')` על `campaigns`) — בדומה לדפוס ב-`outreach-engine.ts:94`
     (`getCampaignContext`, ששם כן נבחר `outreach_schedule`) — לא הרחבה של
     `getCampaign`/`getCampaignForHold` עצמם (שני אלה מוגדרים בכוונה
     לתפקידם הצר, אין סיבה להרחיב את ה-Pick שלהם רק בשביל טסט). זה עדיין
     בודק את אותו דבר (ה-`as unknown as Json` cast + חוזה ה-snapshot מ-§1.4)
     — רק דרך נתיב-קריאה שבאמת קיים.
   - **5ב. `min_hold_floor`/`hold_buffer_pct` הם live-read — נבדקים דרך
     הפלט של `prepareCampaignHold`, לא דרך עמודת קמפיין.** קרא ל-
     `prepareCampaignHold(campaignId)` עם ערכי package מקוריים, שמור את
     `holdAmount` שהוחזר. שנה את `min_hold_floor`/`hold_buffer_pct` ב-package.
     קרא שוב ל-`prepareCampaignHold` (מדמה retry אחרי `hold_failed`/
     `hold_review`, per §1.5) — ה-`holdAmount` השני חייב לשקף את הערכים
     **החדשים** (שונה מהראשון). זה ה-regression guard לחוזה ה-live-read,
     לא לחוזה ה-snapshot — הפוך ממה שנכתב בגרסה הקודמת.
   - **5ג. אחרי hold מוצלח, שום ניסיון-hold שני לא עובר — פוצל לשניים
     (סבב-בדיקה שלישי: "code-review/grep בלבד" לא מספיק כ-regression guard):**
     - **(i) טסט אוטומטי חובה, לא code-review:** על `lockCampaignForHold`
       (`campaigns.ts:324-334`) ישירות — קמפיין עם `capture_status='authorized'`,
       קריאה ל-`lockCampaignForHold` מחזירה `false` (ה-`.or('capture_status.is
       .null,capture_status.in.(hold_failed,hold_review)')` לא תופס
       `authorized`). זה guard זול-לבדיקה, ישיר, ולא דורש לדמות את כל שרשרת
       ה-route/ownership — מוכיח שקריאה חוזרת ל-`POST /authorize` על קמפיין
       שכבר authorized **לא תגיע בכלל** ל-`prepareCampaignHold` (ה-route
       קורא ל-lock קודם).
     - **(ii) "שום נתיב *אחר* לא קורא ל-`prepareCampaignHold`"** —
       (`activateCampaign`/`closeCampaign`/`close-charge.ts`) היא תכונת
       **היעדר-קורא ברמת-קודבייס**, לא ניתנת להוכחה ע"י טסט יחיד ("אין
       קורא בשום מקום" זו טענה על כל הריפו). נשארת כ-**בדיקה סטטית/grep**
       בשלב המימוש, לא מתערבבת עם (i) — לסמן זאת במפורש ב-PR/commit message.

### 5.6 Runtime template integrity — נוסף בסבב-בדיקה שלישי (היה חסר לגמרי)

§2#4(ב) ו-§4.1 **דורשים** מנגנון-ריצה גלוי כש-`message_key` לא נמצא/לא תואם
— אבל עד לתיקון הזה, §5/§7 כללו רק ולידציית זמן-שמירה (§5.3), בלי אף צעד
שנוגע ב-`outreach-engine.ts`. זה סעיף המימוש שהיה חסר.

**היכן:** `outreach-engine.ts:261-266`, הענף `if (!config || !template ||
template.channel !== 'whatsapp') { return { action: 'skipped' }; }`.

**מה לרשום, ומה *לא* לרשום (קריטי):** לרשום **רק** על `!template` (תבנית
חסרה/לא-פעילה) או `template.channel !== tp.channel` (אי-התאמת ערוץ) —
**לא** על `!config` (תצורת WhatsApp חסרה). `!config` הוא מצב fail-closed
**צפוי** (התצורה נזרעת `active=false` כברירת מחדל, migration —
`app_settings`/`whatsapp_config`), לא כשל-תקינות-תבנית; לוג עליו יציף
אזעקות-שווא בכל סביבה שעדיין לא הפעילה WhatsApp. זו טעות שקל ליפול אליה
אם ממש הענף כמות-שהוא בלי להפריד את שני התנאים.

**Sink חדש נדרש — `logActivity` הקיים לא שמיש כאן:** אומת ש-`logActivity`
(`activity.ts:35-39`) קורא ל-`requireUser()` ולקליינט מבוסס-cookie —
אבל `outreach-engine.ts` רץ ב-worker, **request-free**, בלי session/cookie
בכלל. נדרש sink חדש עם service-role client.

**Dedup אטומי — הוכרע (סבב-בדיקה רביעי, היה "dedup לפי מפתח" בלי מנגנון
אכיפה בפועל):** אומת ישירות ש-`activity_log` (`information_schema.columns`
+ `pg_constraint`, נבדק על ה-DB החי) **אין לה עמודת `campaign_id`, ואין שום
unique constraint** מלבד ה-PK על `id`. לכן select-ואז-insert על הטבלה הזו
**אינו אטומי** — שני workers שתופסים touchpoint שבור באותה מילישנייה
(race אמיתי: `claimStep`, שורה 257, מקדם סמן **פר-נמען**, כך שנמענים שונים
של אותו touchpoint נבדקים על-ידי workers שונים בו-זמנית) עלולים לעבור את
בדיקת ה-"קיים כבר?" גם יחד ולהכפיל את הרישום. הפתרון: **טבלה ייעודית
חדשה**, לא הרחבת `activity_log` המשותפת (שינוי-סכימה לטבלה קיימת בשימוש
נרחב הוא היקף גדול יותר מהנדרש כאן):

```sql
create table public.outreach_template_failures (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  touchpoint_index int not null,
  reason text not null, -- 'template_missing' | 'channel_mismatch'
  message_key text not null,
  channel campaign_channel not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, touchpoint_index, reason)
);
```

**תוקן — syntax שגוי, אומת מול תיעוד Supabase-js החי (context7), לא זיכרון:**
`.insert({...}).onConflict(...)` **אינו קיים** ב-supabase-js — `.onConflict()`
אינו מתודה שרשירה על ה-query builder. הצורה הנכונה ל-"INSERT ... ON CONFLICT
DO NOTHING" היא `.upsert()` עם **שני** אופציות יחד (בלי `ignoreDuplicates`,
`upsert` מבצע DO UPDATE כברירת מחדל, לא DO NOTHING):

```ts
const { error } = await admin.from('outreach_template_failures').upsert(
  { campaign_id: campaignId, touchpoint_index: index, reason, message_key: key, channel },
  { onConflict: 'campaign_id,touchpoint_index,reason', ignoreDuplicates: true },
);
```

זה עדיין **אטומי מבחינת ה-DB עצמו** (התכונה שהייתה נכונה בניסוח הקודם, רק
עם ה-API הלא-נכון) — לא תלוי בבדיקת select מקדימה מצד האפליקציה. זו
migration נוספת, מעבר לזו של §6 (5 השדות התפעוליים) — יש לתעד זאת כשלב
נפרד ב-§7.

**RLS — נוסף בעקבות שאלת המשתמש, היה חסר לגמרי מהמסמך.** לפי CLAUDE.md
("Keep Row Level Security enabled for exposed tables"), חובה RLS גם כאן,
למרות שכל הכתיבה עוברת דרך ה-worker עם `createAdminClient()` (service-role,
עוקף RLS ממילא) — RLS הוא הגנת-עומק, לא המנגנון התפעולי היחיד. אומתתי
תקדים ישיר ב-DB החי (`pg_policies`): `webhook_inbox` — טבלת diagnostics
פנימית ללא צרכן-לקוח, **בדיוק כמו הטבלה החדשה** — מקבלת מדיניות **יחידה**:
`webhook_inbox_admin_all: ALL, has_role(admin)`, ללא owner-read. זאת
בניגוד ל-`campaign_authorized_contacts` (דאטה ששייכת-ללקוח, מקבלת גם
`owner_select` לפי `owns_event`). `outreach_template_failures` דומה ל-
`webhook_inbox`, לא ל-`campaign_authorized_contacts`: זו דיאגנוסטיקה על
תקינות **תצורת package** — משאב מנוהל-אדמין בלבד; בעל האירוע לא יכול
לתקן `message_key` שבור בעצמו, ותוכן השדות (`reason` פנימי, `message_key`
גולמי) לא מיועד ללקוח. **מדיניות מוצעת, זהה בצורה ל-`webhook_inbox`:**
```sql
alter table public.outreach_template_failures enable row level security;
create policy outreach_template_failures_admin_all on public.outreach_template_failures
  for all using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
```
נכלל בתוך אותה migration של §5.6 (לא migration נוספת).

**טסט נדרש (§5.5 מורחב, לא ב-§5.6 עצמו):** touchpoint עם `message_key`
שגוי, ≥2 אנשי-קשר תואמים → (א) `sendOneWhatsApp` **לא** נקרא בכלל, (ב)
נרשם אירוע-כשל **אחד** (לא N), (ג) אירוע חוזר (נמען שלישי אחרי) **לא**
יוצר רישום כפול לאותו `(campaign, touchpoint, reason)`.

---

## §6. מסלול 2 — הגנות מסד (evidence-based, לא bounds שרירותיים)

**המצב הקיים (§1.2): 0 CHECK constraints על `packages`, כולל על
`price_with_vat` הכספי.** זו נקודת מוצא חשובה: הוספת CHECK constraint
לשדות החדשים תהיה **שינוי מדיניות** ביחס לדפוס הקיים בטבלה הזו עצמה, לא
המשך שלו. שתי אופציות, שתיהן לגיטימיות — נדרשת החלטה (§2#6):

**אופציה א' (עקבי עם הקיים): Zod בלבד, כמו `price_with_vat`.** אין CHECK
חדש. הסיכון: כתיבה ישירה ל-DB (SQL ידני, מיגרציה עתידית, סקריפט תיקון)
עוקפת את הולידציה — בדיוק כמו ש-`price_with_vat` חשוף לכך היום.

**אופציה ב' (מחמיר מהקיים): CHECK constraints מינימליים, evidence-based
בלבד** — **תוקן בסבב-בדיקה שלישי:** `price_per_reached IS NULL OR
price_per_reached > 0` (**לא** `>= 0`) — אומת ישירות מול `campaigns.ts:478-481`
(`prepareCampaignHold` זורק על `price <= 0`), ותואם את ברירת-המחדל של §2#1
("אין קמפיין בחינם"). **צימוד מחייב:** אם אי-פעם יאושרו קמפיינים בחינם
(`price=0`), ה-CHECK הזה **וגם** ה-guard ב-`prepareCampaignHold` **וגם**
הסינון ב-`listCampaignTemplates` חייבים להשתנות ביחד — לא רק אחד מהם.
`min_hold_floor >= 0`, `hold_buffer_pct >= 0`. **לא** להוסיף upper bound
ל-`hold_buffer_pct` (אין ראיה לגבול עליון, §2#3), **לא** להוסיף JSON schema
constraint ל-`outreach_schedule` (jsonb גמיש היום, `campaign_channel[]`
כבר אוכף את ה-enum ברמת ה-DB עבור `channels` — זה **כבר** ה-DB-level guard
היחיד שיש ראיה מוצקת בעדו).

בכל מקרה, migration חדשה (לא לגעת ב-`202606280021_org_multitenancy.sql`
או קודמותיה) תחת `supabase/migrations/`, בהתאם למוסכמות הפרויקט.

**נוסף לפי המלצת המשתמש — preflight חובה לפני אופציה ב':** לפני כתיבת ה-
`ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)`, להריץ שאילתת בדיקה על
הנתונים החיים (`select * from packages where price_per_reached < 0 or
min_hold_floor < 0 or hold_buffer_pct < 0`) ולוודא 0 שורות **לפני** שמנסים
להחיל את ה-constraint — כדי שלא תיכשל המיגרציה (או, גרוע יותר, שלא תיכשל
בסביבה אחרת עם דאטה שונה מזו שנבדקה כרגע). זה שלב נפרד ומפורש ב-§7 המעודכן.

---

## §7. רצף מימוש מוצע (לביצוע רק אחרי אישור, לא כעת)

1. קבלת החלטות §2 (6 שאלות, כולל campaign-enabled/message_key/subset-channels).
2. אם אופציה ב' ב-§6 נבחרה: **קודם preflight query** על הדאטה החי (§6),
   ורק אם 0 שורות סותרות — מיגרציה (5 השדות התפעוליים) + `supabase gen types`.
3. **מיגרציה שנייה, נפרדת (נוספה בסבב-בדיקה רביעי):** טבלת
   `outreach_template_failures` עם `UNIQUE(campaign_id, touchpoint_index,
   reason)` **+ RLS מופעל + מדיניות `admin_all`** (§5.6, נוסף בעקבות שאלת
   RLS) + `supabase gen types`.
4. `validation/admin.ts` — `operationalFieldsSchema` עם `superRefine`
   תלוי-campaign-enabled, ללא async, כולל המרת `holdBufferPctPercent→fraction`
   (§5.1).
5. `data/admin/packages.ts` — הרחבת columns/types/toWritable/changedFields
   (§5.2) + פונקציית `validateOutreachScheduleForPackage` מוגבלת-whatsapp
   (§5.3) + טיפול FK-violation ב-`deletePackage` (§5.2).
6. `actions.ts` — הרחבת `readPackageForm` עם `formData.getAll('channels')`,
   קריאה ל-`validateOutreachScheduleForPackage` אחרי `safeParse` מוצלח (§5.3).
7. `package-form.tsx` — עורך touchpoints מובנה + שדה `outreach_schedule_json`
   hidden, checkboxes ל-channels, קלט `hold_buffer_pct` **באחוזים** עם המרה
   דו-כיוונית לתצוגה (§5.4), אזהרת hold-fields (§4.2).
8. `outreach-engine.ts` — Runtime template integrity: insert אטומי
   (`ON CONFLICT DO NOTHING`) לטבלה החדשה, **רק** על תבנית-חסרה/ערוץ-לא-
   תואם, לא על `!config` (§5.6).
9. טסטים (§5.5 + §5.6) — 5א/5ב/(5ג-i אוטומטי, 5ג-ii סטטי) המתוקנים, round-trip
   ל-`channels`/`outreach_schedule`, round-trip ל-`hold_buffer_pct` (%↔שבר),
   דחיית numeric שלילי, מחיקת package בשימוש מחזירה הודעה ספציפית, וטסט
   ה-dedup/no-flood ל-Runtime template integrity.
10. `lint && tsc && test && build`, ואז בדיקת-אמת בדפדפן: (א) יצירת package
    לא-קמפיין (`price_per_reached` ריק) — מוודאים שהיא **לא** נחסמת; (ב)
    יצירת package campaign-enabled מלא + קמפיין חדש שנוצר אחריו נועל את
    הערכים הנכונים (עקבי עם §1.4); (ג) `message_key` שגוי בטופס נחסם
    בזמן שמירה (§2#4-א, whatsapp בלבד); (ד) `message_key` שהתבטל **אחרי**
    שמירת ה-package (דריפט, §4.1) נרשם בטבלה החדשה בלי להציף רשומות; (ה)
    הקלדת `10` בשדה ה-buffer מציגה שוב `10` בעריכה חוזרת, לא `1000` או `0.1`.
