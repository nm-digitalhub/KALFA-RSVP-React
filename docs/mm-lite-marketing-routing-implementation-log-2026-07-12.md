# לוג מימוש — ניתוב MM Lite לתבניות MARKETING (תודות)

תאריך: 2026-07-12

## תקציר התוכנית

כל תבניות התודה (thankyou) מסווגות MARKETING על ידי Meta (הוקרה = לא-טרנזקציוני, אין מסלול UTILITY). ה-WABA כבר ONBOARDED ל-MM Lite (`marketing_messages_onboarding_status: "ONBOARDED"`). MM Lite לא עוקף את מגבלת התדירות 131049 — הוא ממטב ניתוב/תזמון *בתוך* המגבלה, לא מבטל אותה. המימוש: `MARKETING_MESSAGE_KEYS` חדש ב-`template-spec.ts`, פונקציה `sendWhatsAppMarketingTemplate` ב-`client.ts` דרך ה-escape hatch המתועד של `whatsapp-api-js` (`$$apiFetch$$`, לא raw fetch/ponyfill), וחיווט ניתוב ב-`sendOneWhatsApp` לפי `messageKey`. אין שינוי DB/מיגרציה — ניתוב בקוד בלבד. שליחות אמת ו-commit/deploy מגודרים לאחר אישור.

## החלטות עיצוב

### מ-mmlite-dev (אומתו אמפירית)
- `$$apiFetch$$` (כפול-דולר, לא בודד) — אומת בקוד: `node_modules/whatsapp-api-js/lib/index.js`, מתודה ציבורית `async $$apiFetch$$(url, options)` המחזירה `Promise<Response>` גולמי (לא JSON מפורש). אין תמיכת SDK native ב-`/marketing_messages` בשום מקום בגרסה 6.2.1.
- `api.v` הוא שדה **private** ב-class (`index.d.ts`) — לא נגיש מבחוץ. פתרון: ייבוא `DEFAULT_API_VERSION` מ-`whatsapp-api-js/types` (v24.0) והעברתו במפורש גם ל-constructor וגם ל-URL, במקום לקרוא שדה פרטי.
- Payload אומת מול תיעוד Meta חי (WebFetch + WebSearch, לא ctx7 — לא נמצא שם): `messaging_product`, `recipient_type:'individual'`, `to`, `type`, `template`, `product_policy` (ערכים באותיות גדולות: `CLOUD_API_FALLBACK`/`STRICT`), `message_activity_sharing` (אופציונלי, יורש ברירת-מחדל ברמת WABA כשלא מוגדר — השארנו לא-מוגדר, כמתוכנן).
- 131055 (חוסר-זכאות ל-MM Lite / ad-sync) אומת (WebSearch) כמצב "עדיין לא זמין" — לא הוספתי אותו ל-`DEFINITELY_NOT_SENT_CODES` (הישאר `unknown` זה מכוון, מתועד בקוד).
- `sendOneWhatsApp` קיבל `messageKey: string` **חובה** (לא אופציונלי) — מיקום: אחרי `config`, לפני `bodyParams`/`extras` (שניהם אופציונליים, אז messageKey חובה חייב לבוא לפניהם ב-TS). עודכנו שלושת הקוראים: `outreach.ts:367` (sendCampaignWhatsApp), `outreach-engine.ts:371,660` (`tp.message_key`), ועוד `scripts/send-one-invite.ts` (MESSAGE_KEY) שנמצא ע"י tsc כקורא רביעי לא-ידוע מראש.

## קבצים שהשתנו

### מ-mmlite-dev
- `src/lib/whatsapp/template-spec.ts` — `MARKETING_MESSAGE_KEYS = new Set(['thankyou'])` + הערת תיעוד.
- `src/lib/whatsapp/client.ts` — חילוץ `buildTemplateMessage()` משותף (הוסר קוד כפול מ-`sendWhatsAppTemplate`), `sendWhatsAppMarketingTemplate` חדשה, הערת 131055.
- `src/lib/data/outreach.ts` — `sendOneWhatsApp(+messageKey: string)` + ענף ניתוב (`MARKETING_MESSAGE_KEYS.has`), קריאה מעודכנת.
- `src/lib/data/outreach-engine.ts` — שני מקומות קריאה מעודכנים עם `tp.message_key`.
- `scripts/send-one-invite.ts` — קריאה מעודכנת עם MESSAGE_KEY הקיים.
- טסטים: `client.test.ts` (5 טסטים חדשים ל-`sendWhatsAppMarketingTemplate`: URL+body מדויק, פרסור Response גולמי, 131055→unknown, fail-closed url+rsvp conflict, throw→unknown), `outreach.test.ts` (mock ל-`sendWhatsAppMarketingTemplate`, תיקון טסט thankyou הקיים שציפה ל-`sendWhatsAppTemplate` + 2 טסטי ניתוב ישירים חדשים ל-`sendOneWhatsApp`), `outreach-engine.test.ts` (עדכון אינדקסים/ארגומנטים positional בעקבות ה-param החדש).

## תוצאות אימות (lint/tsc/build/vitest)

### מ-mmlite-dev (כולן ירוקות, פלט מלא נבדק)
- `npx tsc --noEmit` — עבר נקי (אחרי תיקון `scripts/send-one-invite.ts` שנתפס ע"י tsc).
- `npm run lint` — עבר נקי.
- `npx vitest run` — 1173 עברו, 19 skipped (ללא כשלים), כולל 97 test files.
- `npx next build --webpack` — build הושלם בהצלחה, כל 34 ה-routes נבנו.

### בדיקת סטטוס תבניות Meta (בדיקה חיה, קריאה בלבד — /tmp/kalfa-status/all-thankyou.js + mm-status.js)
- 18/18 תבניות thankyou (כל סוגי האירוע, טקסט+מדיה) = **APPROVED + MARKETING** (`kalfa_rsvp_confirmation`, שאינה thankyou, נשארה UTILITY בצד).
- WABA `marketing_messages_onboarding_status: "ONBOARDED"` (מאומת מחדש חי, לא רק מהתוכנית).

## ממצאי ביקורת

### מ-mmlite-review — סקירה יריבה על commit 625b174, branch feat/mm-lite-marketing-routing
**תוצאה: APPROVE, ללא ממצא חוסם.**

1. **גידור ניתוב** — `MARKETING_MESSAGE_KEYS = Set(['thankyou'])` בלבד (`template-spec.ts:229`). grep על 'thankyou' בכל src מראה: המסלול היחיד שמזין את ה-message_key הזה הוא `campaign-actions.ts:303` → `sendCampaignWhatsApp(campaignId, 'thankyou')` → `sendOneWhatsApp`. שאר ה-message_keys (invite/reminder/gift/event_day_pay/rsvp) לא בסט → ממשיכים ל-`sendWhatsAppTemplate` (`/messages`) ללא שינוי. אין זליגה. הערה: אם admin יגדיר drip touchpoint עם `message_key='thankyou'` דרך executeStep, זה *יינתב נכון* ל-MM Lite גם שם — זו התנהגות רצויה (הניתוב לפי message_key גנרי, לא per call-site), לא באג.
2. **regression בקוראים** — נבדקו 4 מוקדי קריאה ל-`sendOneWhatsApp`: `outreach.ts:367`, `outreach-engine.ts:371,661`, `scripts/send-one-invite.ts:80`. כולם מעבירים את הפרמטר החדש (positional, אחרי config, לפני bodyParams) נכון. אין קורא שנשבר.
3. **`$$apiFetch$$` escape hatch** — נקרא במקור: רק `this.fetch.call(...)`, מחזיר Response גולמי; גם `sendMessage` הרגיל לא בודק ok/status (`getBody` = `(await promise).json()`) → `classifyResponse` מטפל בגוף בלבד, עקבי בין שני המסלולים. try/catch→classifyThrow תקין.
4. **גרסת API** — `DEFAULT_API_VERSION` מיובא מ-`whatsapp-api-js/types`, אותו קבוע שה-constructor הרגיל נופל אליו כברירת מחדל (`index.js:128-134`) — שני המסלולים על אותה גרסה בפועל, ולא ידרוג מול עדכוני הספרייה (כי מיובא, לא hardcoded string).
5. **payload** — הושווה ידנית מול `sendMessage` הפנימי: זהה חוץ מ-`recipient_type` (תוספת לא-מזיקה) ו-`product_policy`. תואם לתיעוד MM Lite בתוכנית.
6. **131055** — מסווג `unknown` (לא ב-`DEFINITELY_NOT_SENT_CODES`), עם קומנט מפורש. תקין ושמרני.
7. **טסטים** — `client.test.ts` בודק URL מלא (regex על `/marketing_messages$`) וגוף מלא (`toEqual`, לא partial). `outreach.test.ts` מוכיח את שני הכיוונים (thankyou→marketing, invite→regular) עם `not.toHaveBeenCalled()` על הצד השני. אין weakened assertions.

**הרצה עצמאית (לא הסתמכות על דיווח dev)**: `npx tsc --noEmit` נקי, `npm run lint` נקי, `npx vitest run` — 1173/1173 עברו (כולל 45 טסטים חדשים/מעודכנים ב-3 קבצים), `next build --webpack` עבר, כל ה-routes נבנו כולל `/api/campaigns/[id]/whatsapp-send`.

מוכן ל-deploy + שליחה מבוקרת (מגודר, per plan §Verification).

### מ-team-lead — Deploy + APPROVE (סגירת מעגל)
- **Deploy ל-beta בוצע (ע"י המשתמש):** branch `feat/mm-lite-marketing-routing` @ 625b174, deploy-id `mri7x5qj`, `/auth/login`=200, pm2 `kalfa-beta`+`kalfa-worker` online. קוד ה-MM Lite אומת נוכח בעץ שנפרס.
- ביקורת mmlite-review: **APPROVE** (7 נקודות, gates עצמאיים ירוקים) — ראה מעלה.

## אימות מסירה חי

### מ-team-lead
שליחת אמת ל-972532743588 דרך `/marketing_messages`:
- הודעה ראשונה (`kalfa_brit_thankyou_trad_v1`): **delivered→read** ✅.
- 2-3 הראשונות בסבב per-event: delivered ✅.
- כל השאר (~8, כולל המעוצבת `trad_v2`): **failed · 131049** ("healthy ecosystem engagement") — עדות מ-`webhook_inbox`.
- **מסקנה מאומתת אמפירית: MM Lite לא עוקף את 131049.** `CLOUD_API_FALLBACK` לא עזר; מגבלת תדירות שיווקית פר-נמען. ~10 הודעות MARKETING לנמען אחד תוך דקות → המכסה נסגרה.
- ממצא צדדי: שמות תבניות Meta ל-3 סוגים מכווצים — `kalfa_barmitzvah_`/`batmitzvah_`/`event_` (לא enum גולמי) — חשוב לחיווט DB.

## פתוחים / מגודר

### מ-mmlite-dev
- אין שינוי DB/מיגרציה — כמתוכנן.
- שליחת אמת מבוקרת + deploy — בסקופ המנהל (main), לא בוצע ע"י mmlite-dev.
- commit מקומי בלבד: branch `feat/mm-lite-marketing-routing`, קומיט 625b174 (לא נדחף, ללא merge).
- 'gift' לא נוסף ל-`MARKETING_MESSAGE_KEYS` (מגודר מפורשות בתוכנית).
- דיווח מלא ל-main נשלח בנפרד.

### מ-team-lead
- **drift מול main:** נפרס מ-feature branch שלא מוזג ל-main → main עדיין בלי הקוד; פריסה עתידית מ-main תדרוס. המלצה: merge ל-main. ממתין להחלטת המשתמש.
- לוג זה עדיין untracked (יצורף ל-merge).
