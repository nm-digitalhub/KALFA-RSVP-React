# תוכנית: כל היכולות של `@chat-adapter/whatsapp` לסוכן הבעלים

תאריך: 2026-09-27 · מצב: **טיוטה לאישור הבעלים. שום דבר לא יושם.**
הקשר: `plans/owner-whatsapp-agent-plan.md`, `plans/owner-agent-free-read-plan.md`. הסוכן באוויר מ-24.9 על 03-330-1505.
מקורות: ארבעה סוכנים מומחים (WhatsApp/Meta, מסד נתונים, תורים ותזמון, הרשאות), בקריאה בלבד, 27.9. כל אחד קרא את הקוד ואת קוד המקור של החבילה (`@chat-adapter/whatsapp@4.41.0`, `chat@4.41.0`, `@chat-adapter/state-pg@4.41.0`).

מקרא: **[נמדד]** נבדק בקוד, בחבילה, ב-DB החי (קריאה בלבד) או בתיעוד רשמי שנשלף היום. **[מוסק]** דורש אימות בשלב שמצוין לידו.

---

## 1. המסקנה המרכזית

**כל היכולות נכנסות, אבל כמעט אף אחת לא דרך מופע Chat SDK.**

- בלי מופע `Chat` ובלי state, חצי מהיכולות של האדפטר לא עושות כלום [נמדד]: `startTyping` (`cawa/dist/index.js:2094-2097`), `onAction`, reactions נכנסות, burst/debounce, cards ו-identity aliasing (`:822, 877, 907, 948, 1094-1098`).
- מופע `Chat` דורש שהוא ינהל את ה-webhook (`handleWebhook`), והוא מעבד **כל** שולח בלי רשימת היתר (`:731-775`), רושם ללוג 500 בתים מהגוף (`:711-713`), ומטפל בהודעה בזיכרון התהליך, בלי עמידות [נמדד]. זה שובר את השער היחיד ואת האינווריאנט "תעבורת האורחים לא משתנה".
- `@chat-adapter/state-pg` יוצר עם ברירות המחדל 5 טבלאות ו-2 sequences ב-`public`, ו-anon מקבל עליהם גישת כתיבה (default ACLs של `public`) [נמדד].
- **רוב היכולות כבר קיימות ב-`whatsapp-api-js` 6.3.0 שמותקן** [נמדד]: `markAsRead(phoneID, messageId, 'text')` = נקרא + "מקליד" (`node_modules/whatsapp-api-js/lib/index.d.ts:120`), `Interactive` עם כפתורים/רשימה/CTA (`lib/messages/interactive.d.ts`), `Reaction`, ו-`sendWhatsAppTemplate` כבר ב-`src/lib/whatsapp/client.ts:205`. דרך הספרייה הזו כל שליחה עוברת ב-`classifyResponse`, שעליו נשען ה-at-most-once.

**לכן:** מתקינים את `@chat-adapter/whatsapp` ומשתמשים בו **רק ל-`downloadMedia`**, שבו הוא עדיף באמת: הורדה רק מ-`fbcdn.net`/`fbsbx.com`/Graph, והטוקן לא עובר ליעד אחר גם אחרי redirect (`:541-554, 1299-1338`). `fetchMedia` של whatsapp-api-js שולח את ה-Bearer לכל URL (`whatsapp-api-js/lib/index.js:442-449`) [נמדד]. כל שאר היכולות נבנות על הספרייה הקיימת ועל הצינור שלנו. **לא מתקינים `chat` כתלות ישירה, לא `state-pg`, ולא מחברים `handleWebhook` לשום route.**

---

## 2. מה נשאר בלי שינוי (חובה)

- `route.ts` הוא ה-webhook הציבורי היחיד. `planOwnerAgentDiversion` ו-`withoutDivertedRows` לא משתנים בשביל מדיה/כפתורים/תגובות: הם כבר מסיטים כל סוג הודעה משולח מורשה (`intake.ts:222-236`), והחסימה היא רק בשער (`intake.ts:380`) [נמדד]. השינוי היחיד בהסטה עצמה הוא BSUID (§4.7).
- השער המלא (מתג, איש צוות, טלפון מאומת, קצב, תקרה), שורת ה-intake, התור, ה-CAS `processing→sending`, ה-audit וה-retention.
- **כל פעולה שמאותתת "חי" (נקרא, מקליד, תגובה, הורדת מדיה) קורית רק אחרי `agentGate`** (`reply.ts:170-176`). הודעה שנחסמה לא מקבלת אף קריאת Graph (החלטה 9.6: שתיקה היא ברירת המחדל).
- כל הודעה יוצאת עוברת ב-`deliver()` או בתאום שלו, עם `to` = הנמען שהשער החזיר.

---

## 3. חוקי יצירת האדפטר (הרשאות)

- `new WhatsAppAdapter({...})` ישירות (`cawa:2219`), **לא** `createWhatsAppAdapter`, שקורא `WHATSAPP_*` מהסביבה לכל שדה חסר, כולל `apiUrl` (`:2177-2215`) [נמדד]. ב-`.env.local` יש `WHATSAPP_ACCESS_TOKEN` ו-`WHATSAPP_PHONE_NUMBER_ID`, והצרכן רץ עם `--env-file` (`consumer/main.ts:11`).
- wrapper שמוודא שכל שדה הוא מחרוזת לא ריקה מ-`getWhatsAppConfig()`; אחרת זורק. `apiUrl` מוצמד ל-`https://graph.facebook.com`, `apiVersion` ל-`GRAPH_API_VERSION`, `phoneNumberId` = `intake.phoneNumberId`.
- לא קוראים ל-`initialize()` ולא ל-`handleWebhook()`. `verifyToken` אקראי לכל תהליך.
- **logger שקט חובה:** ברירת המחדל `ConsoleLogger("info")` רושמת גוף שגיאה של Meta ו-`threadId`, שמכיל את הטלפון (`:1100-1104, 1724-1733`).
- **בדיקות:** ערכי sentinel ב-`WHATSAPP_*` לא מגיעים ל-fetch, ל-URL או ל-header. `appSecret: null` זורק. grep/build: אין `handleWebhook(` או `webhooks.whatsapp` מחוץ לבדיקות, ואין route תחת `src/app/api` שמייבא `@chat-adapter/*`.
- **חסם לבדוק ראשון:** החבילה ESM-only, והצרכן נבנה ל-CJS ב-esbuild (`package.json:53`). ב-`cawa/dist/index.js` אין `import.meta` [נמדד]; את `@chat-adapter/shared` לא בדקנו. probe של build לפני כל התחייבות.

---

## 4. היכולות, אחת-אחת

### 4.1 "נקרא" + "מקליד..."
- `markAsRead(intake.phoneNumberId, intake.wamid, 'text')` של whatsapp-api-js, אחרי `agentGate` ו-`sender`, לפני `runAnswer` (`reply.ts:170-183`). פונקציה חדשה `markReadWithTyping` ב-`client.ts` שלא זורקת, מוזרקת ל-`ReplyDeps`.
- Meta: החיווי נעלם אחרי 25 שניות או עם התשובה [נמדד, תיעוד Meta 27.9]. ריצה נמשכת עד 180 שניות (`budgets.ts:25`). רענון כל 20 שניות מאחורי flag `OWNER_AGENT_TYPING_REFRESH_MS` (0 = כבוי) [מוסק: התיעוד לא אומר אם רענון עובד], עוצר בסוף `runAnswer` ולפני `sendGate`.
- כשל = `quietly` עם timeout של 5 שניות. לא משנה את הזרימה.
- בדיקה חיה אחת לטלפון של הבעלים — **באישור מפורש**.

### 4.2 מדיה נכנסת (תמונה, מסמך, קולי, מיקום)
- **Meta** [נמדד, תיעוד 27.9]: media id תקף 7 ימים (תואם ל-retention של intake); URL פג אחרי 5 דקות; תמונה עד 5MB, אודיו/וידאו 16MB, מסמך 100MB. תקרת האדפטר 25MB [README], ולכן מסמך גדול מקבל `media_too_large` ותשובה קבועה.
- **route/intake:** מרחיבים את `OwnerAgentMessage` (`intake.ts:71-78`) בשדות מדיה/מיקום/כפתור/`contextWamid`/`fromUserId`. בשער (`intake.ts:378-381`) במקום `non_text`: מותרים text, image, document, audio (כולל voice), location, interactive, button. video, sticker, contacts ו-system נחסמים כ-`unsupported_type`. reaction = audit בלבד (§4.5).
- **צרכן:** הורדה ב-`downloadMedia` **אחרי** `agentGate`, לתיקייה זמנית תחת ה-cwd הייעודי, ומחיקה בסוף הריצה. **לא נשמרת** ב-DB, ב-Storage, בלוג או ב-audit. MIME allowlist ותקרת בתים משלנו לפני שהתוכן נכנס לזיכרון. `mediaId` רק מה-intake, לעולם לא מהמודל או מ-state (`rehydrateAttachment` לא בשימוש).
- **העברה ל-`claude -p`:** אין כלי Read (`runner.ts:487-488`), ו**אסור להחזיר אותו**. תמונה/PDF עוברים כ-content blocks ב-base64 דרך `--input-format stream-json` ב-stdin [נמדד שהדגל קיים ב-CLI 2.1.283; ההתנהגות מוסקת — probe מקומי]. תוכן עטוף כ-untrusted, ומשפט ב-system prompt שתוכן תמונה/מסמך הוא נתונים ולא הוראות.
- **מיקום:** הופך לטקסט (קו רוחב/אורך/שם), בלי הורדה.
- **קולי:** Claude לא מקבל אודיו. צריך תמלול, ואין היום קוד STT כללי בריפו [נמדד]. זה ספק חיצוני או ElevenLabs STT, עם הוצאה ושליחת קול לצד שלישי → **החלטת בעלים** (החלטה 1 בסעיף 7). התמליל נשמר בעמודה `transcript`, לא האודיו.

### 4.3 כפתורים, רשימות ו-CTA (יציאה)
- ה-runner מבקש מהמודל פלט מובנה (`--json-schema`, קיים ב-CLI [נמדד]; ההתנהגות מוסקת): `{ answer, followups?: string[] ≤10 }`.
- `deliver()` שולח את הטקסט כמו היום, ואחריו הודעה אינטראקטיבית אחת: עד 3 הצעות = כפתורים, 4–10 = רשימה. אחרי ה-CAS, בלי throw. כשל בה = `partial_send`.
- מגבלות: כפתור עד 3 וכותרת עד 20 תווים, body עד 1024, header עד 60 (`cawa:26-29`) [נמדד]; רשימה עד 10 שורות, כותרת שורה עד 24 [מוסק, לאמת]. CTA רק לקישורים ל-`getAppUrl`.
- `cardToWhatsApp` של האדפטר לא מייצר רשימה בכלל [נמדד], ולכן whatsapp-api-js.

### 4.4 לחיצות שחוזרות (במקום `onAction`)
- **הנחת העבודה:** הלקוח של איש הצוות יכול לשלוח כל id. האדפטר עצמו הופך כל מחרוזת ל-action (`cawa:37-43`) [נמדד].
- ה-id הוא **nonce אטום**: `oa:fu:<intakeId>:<n>`, והטקסט המלא של כל הצעה נשמר בעמודה `followups jsonb` על שורת ה-intake. בלחיצה השרת פותר את ה-id מול ה-DB, בודק שהוא שייך לאותו `staff_user_id`, לא פג ולא נוצל, ושה-`context.id` הוא ה-wamid שלנו. לא סומכים על ה-title.
- id לעולם לא קובע זהות, נמען, הרשאה, event/guest id או דילוג על שער/תקרה.
- לחיצה = הודעה נכנסת לכל דבר: שער מלא, תקרה, שורת intake עם טקסט ההצעה. פותחת חלון 24 שעות.
- כשל = שתיקה + audit (`unknown_action`).

### 4.5 תגובות באימוג'י
- **נכנסות:** משוב על תשובה. אחרי השער, **audit בלבד** (`feedback_up`/`feedback_down`/`reaction_other`/`reaction_removed`), בלי intake, בלי תקרה ובלי ריצה. כדי לקשור משוב לתשובה שומרים את ה-wamid של התשובה (`reply_wamids`); היום `outcome.providerId` נזרק.
- **יוצאות:** `Reaction` של whatsapp-api-js, למשל ✅ על "הפסקת דוחות". רק אחרי השער.

### 4.6 איחוד הודעות רצופות (burst)
- **תיקון לממצא קודם:** ב-24.9 התשובה לכל הודעה יצאה **לפני** שההודעה הבאה הגיעה. המרווח הקצר ביותר בין שאלות היה 26.5 שניות [נמדד, `owner_agent_audit`]. חלון של 1–1.5 שניות (ברירת המחדל של Chat SDK) לא היה מאחד שום דבר. הבעיה שנצפתה היא **ריצת מודל מלאה על "היי"**, לא הודעות חופפות.
- **מה בונים בכל זאת (עמיד, בלי Chat SDK):** `startAfter` על ה-job לפי `app_settings.owner_agent_burst_ms` (ברירת מחדל 0 = כמו היום; מוצע 3000; תקרה 15000 < `STRANDED_AFTER_MS`). בצרכן: שורה שיש אחריה שורה `queued` חדשה יותר של אותו איש צוות נדחית (`deferred`). ההודעה החדשה ביותר היא המנהיג, ובפעולת SQL אחת מסמנת את כל ה-`queued` שלפניה `coalesced` עם `coalesced_into`. ה-turn נבנה מחדש מהקישור, כך ש-retry זהה. זה מכסה גם הודעות שנשלחות בזמן שריצה עדיין רצה.
- **קיצור ל"היי":** תשובה קבועה בלי מודל לברכה בלבד — **החלטת מוצר** (החלטה 6).

### 4.7 זיהוי לפי BSUID (מזהה עסקי במקום טלפון)
- **זה מצב כשל אמיתי היום:** 119 מתוך 119 הודעות נכנסות כוללות `from_user_id`, ו-**3 הגיעו בלי `from` בכלל** [נמדד, `webhook_inbox`]. ההתאמה שלנו רק לפי `from` (`intake.ts:167, 181-189`), ולכן הודעה כזו מאיש הצוות נופלת בשקט למסלול האורחים.
- **קישור:** רק מהודעה חתומה אחת שמכילה **גם** `from` שעובר את כל ההתאמה ואת `phone_verified_e164`, **וגם** `from_user_id` תקין. CAS: `update … set bsuid=$b where id=$e and bsuid is null`. נשמר אצלנו (`owner_agent_allowlist.bsuid`), לעולם לא ב-state של Chat SDK.
- **הודעה עם BSUID בלבד** מוסטת רק אם יש קישור פעיל ו-`bound_from_e164 = phone_verified_e164 = e164`, ונבדקת שלוש פעמים (route, צרכן, שליחה). התשובה תמיד ל-`to` = הטלפון המאומת.
- **רוטציה = ביטול, לא העברה.** `user_id_update` או `user_changed_user_id` על BSUID קשור מבטלים את הקישור ושולחים התראה עם מזהים בלבד. שינוי מספר אומר שהטלפון המאומת כבר לא תקף. (האדפטר עושה את ההפך וממזג previous→current, `cawa:1026-1060`; לא בשימוש להרשאה.) `user_id_update` נשאר בשורות האורחים — **נצפה, לא מוסט**. צריך לוודא שהאפליקציה מנויה לשדה.
- אסור לקשר מהודעה בלי `from`, ואסור לקבל `parent_user_id` כזהות.
- זה שינוי בהסטה עצמה, ולכן בדיקות golden על מסלול האורחים.

### 4.8 דוח יזום (08:00 ו-00:00 שעון ישראל)
- ביקשת את זה מהסוכן ב-25.9 19:00, והוא סירב.
- **איפה נשמר הזמן:** טבלה ב-DB (לא cron של pg-boss לכל איש צוות — אין לסכמה `pgboss` grants, RLS או audit [נמדד]). `owner_agent_report_subscription` (מי, איזה דוח, שעה, אזור זמן, פעיל) ו-`owner_agent_report_run` עם `UNIQUE (subscription, local_date, slot_time)` — זה מה שמבטיח שליחה אחת בלבד.
- **תזמון:** ה-sweep הקיים כל 5 דקות (`main.ts:176`) מריץ גם planner. slot "בשל" עד 60 דקות אחרי השעה, כך שריסטארט לא מאבד דוח. אחרי 60 דקות = `expired`. DST לא רלוונטי: המעבר ב-02:00 [מוסק].
- **תוכן:** מהליבות הדטרמיניסטיות (`src/lib/owner-agent/cores/*`), **לא** `claude -p`: אין עלות מודל, אין משטח הזרקה, שניות ולא דקות. מסונן לפי ההרשאות, שנפתרות מחדש בזמן השליחה. הליבות מקבלות היום רק "מאז" בלי "עד" (`rsvp.ts:86-91`, `campaigns.ts:85-87`) [נמדד], ולכן מוסיפים פרמטר אופציונלי `untilIso` בכל אחת (ברירת מחדל = כמו היום).
- **ערוץ:** בתוך 24 שעות מההודעה האחרונה שלך (פחות 15 דקות מרווח) = טקסט חופשי. אחרת = תבנית מאושרת. fallback אחד מותר: טקסט שנדחה ב-131047 (`definitely_not_sent`) → תבנית, כי מוכח שלא יצא כלום. אם אין תבנית מאושרת: `template_unavailable`, **לעולם לא טקסט מחוץ לחלון**.
- **שערים:** בתחילה ובשליחה, כמו תשובה רגילה, ועוד מתג נפרד `owner_agent_reports_enabled` עם מסך admin. הנמען לא נשמר בטבלה; נגזר בזמן השליחה מהטלפון המאומת.
- **תבנית (טיוטה, לא הוגשה):** `kalfa_owner_daily_report_util_v1`, `he`, UTILITY: "דוח הפעילות שביקשת עבור {{1}}: אירועים חדשים {{2}}, אישורי הגעה חדשים {{3}}, הכנסות {{4}}", וכפתורים "לדוח המלא" ו"הפסקת דוחות" (עם `PayloadComponent`, `client.ts:185-193`). חלופה B קצרה אם A נדחית או מסווגת MARKETING. סיכון: סיווג מחדש ל-MARKETING ואז 131049 (ה-route כבר קולט `template_category_update`). הסיווג המשפטי → `israeli-compliance-advisor`.
- **לחיצה על "לדוח המלא"** עוברת את כל הצינור ופותחת חלון, ולכן הדוח המלא יוצא כטקסט. **"הפסקת דוחות"** מכבה את המנוי, שולחת ✅ ורושמת audit.

### 4.9 כלי הכתיבה הראשון: `set_report_schedule`
- **סותר את התוכנית המאושרת** (`owner-whatsapp-agent-plan.md:28-29, 319, 525`: "אין כלי כתיבה, אין הודעות יזומות") → **דורש אישור מפורש** (החלטה 2).
- **קלט:** `strictObject({ slots: z.array(z.enum(ALLOWED_SLOTS)).max(4) })` בלבד. אין שדה משתמש, טלפון, נמען או טקסט חופשי (טקסט חופשי היה הופך הזרקה לפעולה שחוזרת כל יום).
- **זהות:** `OWNER_AGENT_STAFF_USER_ID` ו-`OWNER_AGENT_INTAKE_ID` ב-env של שרת ה-MCP מה-runner, כמו `OWNER_AGENT_PERMISSIONS` (`runner.ts:435-442`). חסר = הכלי לא נרשם.
- **לא כותב ישר:** רושם שינוי `pending` לפי `intake_id`. השינוי מוחל ב-`deliver()` רק אחרי שהתשובה נשלחה בהצלחה, ובתשובה מצורפת שורת אישור שנבנית **בקוד** ולא מהמודל ("✓ דוח יומי נקבע ל-08:00 ול-00:00").
- **לא נרשם** בריצה שיש בה מדיה, תמליל או title של כפתור, ולא בריצה יזומה. סשן שהיה בו תוכן כזה לא ממשיך לריצה עם הכלי.
- תקרות: עד 4 שעות, מספר שינויים מוגבל ביום, audit עם enums בלבד. annotations משלו (`readOnlyHint:false`), לא `READ_ONLY_TOOL_MCP`.
- **התרחיש הגרוע** (הזרקה דרך הערת אורח ב-`execute_sql`): שינוי שעות הדוח של אותו איש צוות, גלוי בשורת האישור והפיך. אין שליחה לצד שלישי ואין עליית הרשאות.

---

## 5. מסד הנתונים (מיגרציה אחת תוספתית, באישור)

- **`owner_agent_intake`:** `message_text` nullable; עמודות `message_type`, `media_id`, `media_mime`, `media_sha256_b64`, `media_bytes`, `media_voice`, `interactive_id`, `interactive_title`, `location_lat/lng/label`, `reply_to_wamid`, `coalesced_into`, `followups jsonb`, `transcript`, `reply_wamids text[]`. CHECK שקושר סוג↔שדות, ו-`message_type` נשאר פתוח (regex של צורה, לא רשימה סגורה). כל עמודות הטקסט החופשי בלי grant ל-authenticated, כמו `message_text` היום (ה-grant הוא לפי עמודה, ולכן עמודה חדשה מוסתרת אוטומטית) [נמדד]. 16 השורות הקיימות עוברות את ה-CHECK [נמדד].
- **`owner_agent_allowlist`:** `bsuid`, `parent_bsuid`, `bsuid_bound_at`, `bound_from_e164`, `report_opt_in`; `unique(bsuid)` ו-CHECK של תבנית BSUID (`cawa:561`).
- **`owner_agent_report_subscription`**, **`owner_agent_report_run`** (§4.8): RLS, `revoke all from public, anon, authenticated`, select לבעלים בלבד, כתיבה רק ב-service role.
- **`owner_agent_audit`:** עמודות `report_run_id`, `turn_intake_id`. **ה-CHECK לא משתנה** — כל הקודים החדשים עומדים בתבנית הקיימת [נמדד].
- **`app_settings`:** `owner_agent_burst_ms`, `owner_agent_reports_enabled`, שם ושפת התבנית.
- **לא:** `state-pg`, bucket למדיה, סכמה חדשה.
- **dry run** (טרנזקציה עם ROLLBACK): RLS דלוק; anon/authenticated/**PUBLIC** בלי כתיבה (revoke מ-anon לא מסיר מ-PUBLIC); `has_column_privilege` = false לכל עמודות הטקסט החופשי; 0 הפרות CHECK בשורות קיימות. ואז `db push --dry-run` → `db push` → `advisors` → `gen:types`.
- **retention:** intake 7 ימים (העמודות החדשות נמחקות עם השורה). `report_run` 90 יום (החלטה).

---

## 6. סדר ביצוע (כל שלב נפרד, עם אישור לפני כל מיגרציה, התקנה ושליחה חיה)

0. **probe:** build של הצרכן עם `@chat-adapter/whatsapp` (ESM→CJS), `--input-format stream-json` עם תמונה, `--json-schema`. בלי commit.
1. **"נקרא" + "מקליד"** — בלי מיגרציה, מאחורי flag.
2. **מיגרציה** (§5) + הרחבת השער לסוגים חדשים + BSUID + בדיקות golden על מסלול האורחים.
3. **מדיה:** תמונות ומסמכים; מיקום; קולי רק אחרי החלטה 1.
4. **כפתורים ורשימות** + לחיצות חוזרות + תגובות נכנסות.
5. **איחוד הודעות** (+ קיצור ל"היי" אם יוחלט).
6. **דוח יזום:** ליבות עם `untilIso`, planner, תבנית (הגשה ל-Meta באישור), מתג ומסך admin.
7. **כלי הכתיבה** — רק אחרי החלטה 2.

כל שלב: בדיקות ממוקדות, `npm run lint`, `npx tsc --noEmit`, `npm run build` (לא במקביל), `worker:deps`, והזרקת תקלות לכל שומר חדש. הזיכרון `research-use-single-agent-not-workflow`: סוכן מיישם אחד לכל שלב.

**בדיקות חובה (מתוך סקירת ההרשאות):** snapshot של מסלול האורחים על payload מעורב; BSUID (בלי קישור, קישור מהודעה בלי `from`, `parent_user_id`, רוטציה); sentinel ב-`WHATSAPP_*`; state מזויף לא משנה את `to`; nonce זר/מנוצל/פג → שתיקה; שער שנכשל → אפס קריאות Graph; ריצה עם מדיה בלי כלי כתיבה; דוח פעם אחת ל-slot.

---

## 7. החלטות לבעלים

1. **תמלול הודעות קוליות:** איזה ספק, ומאשרים את ההוצאה ואת שליחת הקול לצד שלישי?
2. **כלי כתיבה ראשון** (`set_report_schedule`) — מאשרים לשנות את הכלל "אין כלי כתיבה"? (החלופה: קביעת השעות רק במסך הניהול.)
3. **תקופת הדוח:** 00:00 = היום שהסתיים; 08:00 = הלילה (00:00–08:00) + תמונת מצב?
4. **נוסח התבנית:** טיוטה A (עם מספרים) או B (קצרה)?
5. **התקרה היומית** סופרת הודעות או תורות (אחרי איחוד)?
6. **קיצור ל"היי":** תשובה קבועה בלי מודל לברכה בלבד?
7. **שמירת מדיה:** לא לשמור בכלל (מומלץ)?
8. **BSUID:** קישור אוטומטי מהודעה שהתאימה לפי טלפון (מומלץ) או הזנה ידנית במסך?

---

## 8. אימות בלתי תלוי (27.9, סוכן מאמת נפרד, קריאה בלבד)

**38 טענות נבדקו: 24 אושרו, 10 אושרו חלקית, 3 שגויות, 1 לא ניתנת לאימות.** ההחלטה המרכזית (בלי מופע Chat, בלי state-pg, בלי handleWebhook) מבוססת. התיקונים:

1. **החבילה כבר מותקנת** (`package.json`: `@chat-adapter/whatsapp ^4.41.0`, וגם `mcp-remote ^0.14.3` שלא קשור — לפצל לשינוי נפרד). `chat@4.41.0` כבר קיים כתלות עקיפה של `@mastra/core`. אין אף ייבוא ב-src/worker/scripts.
2. **§3 logger:** ב-constructor הישיר ה-logger **חובה** (בלי ברירת מחדל; השמטה = TypeError שמסתיר את השגיאה האמיתית). ברירת המחדל `ConsoleLogger("info")` קיימת רק ב-factory. הדליפה הרלוונטית ל-downloadMedia היא `graphFetchJson` (`cawa:2148`, גוף שגיאה של Meta). "appSecret null זורק" — רק ב-wrapper שלנו.
3. **§1:** cards **כן** נשלחות בלי Chat (`send()` → `cardToWhatsApp`, `cawa:1347-1368`). burst/debounce יושבים ב-chat core, וברירת המחדל שלו היא `drop` (debounce 1500 רק כשבוחרים אותו). רישום 500 הבתים הוא `debug` ולפני בדיקת החתימה; ברמת error נרשם `bodyPreview` של 200 בתים על JSON לא תקין.
4. **§4.7 BSUID:** מצב כשל **רדום**, לא פעיל. 3 ההודעות בלי `from` הן מסוג `contacts`, על מספר אחר, והשולחים שלהן מופיעים גם עם `from`. איש צוות שמתכתב ב-30 הימים האחרונים שומר על `from`.
5. **§5:** 18 שורות intake (לא 16). הכנסות בדוח דורשות גם שינוי ב-RPC `owner_agent_billing_sums` (`_until`), שחסר במיגרציה.
6. **§4.3:** מגבלות רשימה אומתו מול Meta: עד 10 שורות בסך הכול, כותרת 24, תיאור 72, id 200, body 4096 (1024 חל על כפתורים בלבד). את 10 השורות הכוללות צריך לאכוף אצלנו.
7. **§4.9/§7:** הציטוט הנכון הוא `owner-whatsapp-agent-plan.md:27-29`. התוכנית הופכת **שלוש** החרגות של v1 (כתיבה, הודעות יזומות, מדיה וקולי), ולכל אחת צריך אישור נפרד — לא רק לכלי הכתיבה.
8. **שלב 0:** probe של ESM→CJS כבר עבר (אין `import.meta` או top-level await ב-adapter/chat/shared; באנדל ~4.3MB מתוך תקרה 7MB). נשאר להריץ את סקריפט הבנייה האמיתי ואת `check-owner-agent-bundle`.

**בעיות שהתוכנית לא ראתה:**
- **M1 — הורדת מדיה כבר קיימת ומאומתת:** `src/lib/data/whatsapp-import.ts:373-418` (`downloadDocument`) — `retrieveMedia(id, phoneID)` מתוחם למספר, עם בדיקת `file_size` ותקרה. לפי כלל "reuse existing" עדיף להוסיף לו בדיקת host ו-`redirect:'manual'` במקום תלות חדשה.
- **M2 — `downloadMedia` של האדפטר מחליש את התיחום למספר:** `GET ${graphApiUrl}/${mediaId}` בלי `phone_number_id` (`cawa:1300`), בלי פרמטר תקרה/MIME (25MB קבוע), `file_size` נזרק, ולשלב ה-metadata אין timeout. `mediaId` משורשר בלי encode → regex `^[0-9]{1,32}$` ב-intake.
- **M3 — הכרעה מחדש:** האדפטר עדיף ב-host allowlist, redirect ו-SSRF; נחות בתיחום למספר ובשליטה בתקרה. ההמלצה "להתקין רק בשביל downloadMedia" חלשה. **ההמלצה המעודכנת: להרחיב את `downloadDocument` הקיים, ולא להשתמש באדפטר.**
- **M4:** "נקרא"/"מקליד" לפני הריצה + חסימה ב-`sendGate` אחר כך = "נקרא" ואז שתיקה. לתעד כהחלטה.
- **M5:** לחיצת RSVP של תבנית אורחים ממספר מורשה על מספר הסוכן מוסטת כבר היום (23 מתוך 119 הודעות אורחים הגיעו למספר הסוכן) ותסתיים ב-`unknown_action`. לתעד ולבדוק ב-golden.
- **M6:** `rateLimit` ב-route נצרך גם על reactions שהם audit בלבד — אימוג'י אוכלים מהמכסה של 10 לדקה.
- **M7:** `context.id` של לחיצה הוא ה-wamid של ההודעה האינטראקטיבית — `reply_wamids` חייב לכלול גם אותה, אחרת בדיקת ה-nonce נכשלת.

---

## 9. החלטות הבעלים (27.9)

1. **מאושר:** הודעות יזומות מהסוכן (דוח יומי עם תבנית מאושרת) וקבלת מדיה (תמונה, מסמך, קולי). על כלי הכתיבה (`set_report_schedule`) לא נשאלה שאלה בכלל — הוא פתוח להחלטה, לא נדחה (תיקון 28.9).
2. **משתמשים ב-`@chat-adapter/whatsapp`** כשכבת ה-WhatsApp של הסוכן, והפערים שהמאמת מצא (§8 M2–M3) נסגרים בעטיפה דקה ולא בוויתור על החבילה:
   - **יצירה:** `new WhatsAppAdapter({...})` עם קונפיג מפורש מ-`app_settings` ו-logger שקט (חובה).
   - **הורדת מדיה:** קודם קריאת metadata מתוחמת למספר (`retrieveMedia(id, phoneNumberId)`, כמו `whatsapp-import.ts`) — מדיה של מספר אחר נדחית, `file_size` מעל התקרה נדחה — ורק אז `adapter.downloadMedia`.
   - **שליחה:** `WhatsAppApiError.errorCode` ממופה ל-`DeliveryOutcome` (אותה רשימת `DEFINITELY_NOT_SENT_CODES`), כך שה-at-most-once נשמר.
   - `handleWebhook`/מופע `Chat` עדיין לא מחוברים ל-route הציבורי.
   - ההמלצה ב-§8 M3 ("לא להשתמש באדפטר") מוחלפת בהחלטה הזו.
