# מספר WhatsApp ייעודי לייבוא מוזמנים — תוכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**תאריך:** 2026-09-03
**סטטוס:** תוכנית בלבד — לא בוצעו שינויי קוד, לא הופעלו מיגרציות, לא נשלחו הודעות, לא הותקנו חבילות.

**Goal:** מספר ה-Cloud API השני (`+972 3-330-1505`, `phone_number_id = 1298694319994421`) הופך לערוץ הייבוא היחיד של רשימות מוזמנים, בעוד המספר הקיים (`+972 3-721-9347`, `1018741517998430`) ממשיך לשרת אך ורק את פניות ה-RSVP — וה-worker מנתב כל הודעה נכנסת לפי המספר שקיבל אותה.

**Architecture:** שני מספרים תחת אותה אפליקציית Meta, אותו WABA, אותו טוקן ואותו app secret — לכן ה-route של ה-webhook, אימות החתימה והטוקן לא משתנים. השינוי הוא שכבת ניתוב אחת ב-`processMessage` שמסתעפת על `webhook_inbox.phone_number_id` (שכבר נשמר בכל שורה), שני שדות תצורה חדשים ב-`app_settings` (מזהה מספר הייבוא + המספר לתצוגה) עם ממשק אדמין, ושליחת תשובות הייבוא מהמספר שקיבל את הרשימה. שדה ריק = ההתנהגות של היום, אחד-לאחד.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (`app_settings` singleton, RLS אדמין), pg-boss worker (`worker/main.ts`), `whatsapp-api-js` 6.2.2 (נשאר — `meta-cloud-api` נדחה היום), `libphonenumber-js` דרך `src/lib/phone.ts`, Zod 4, Vitest 4.

**Spec:** הודעת המשימה מ-team-lead (2026-09-03) + העובדות שאומתו בסשן הבעלים מול Graph API v23.0. אין קובץ spec נפרד; §0–§2 להלן הם ה-spec המאומת.

## Global Constraints

- `package.json` הוא מקור האמת: `whatsapp-api-js ^6.2.2`, `zod ^4.5.4`, `libphonenumber-js ^1.13.7`, `vitest ^4.1.9`, `next 16.3.4`. אין SDK חדש.
- ה-SDK משמש **רק** דרך `WhatsAppAPI` (בנייה עם `v` מפורש), מחלקות ההודעות, `verifyRequestSignature`, `retrieveMedia`/`fetchMedia` ו-`$$apiFetch$$`. **לא** `post()`, לא emitters, לא `NextAppMiddleware` — ה-parser שלהם קורא רק `entry[0].changes[0]` ו-`messages[0]`/`statuses[0]` וזורק על שדות template-health (MEASURED בביקורת `docs/whatsapp-api-js-capability-audit-2026-09-03.md`). האיטרציה הידנית על `PostData` ב-`route.ts` נשארת.
- גרסת Graph אחת בבעלות kalfa: `GRAPH_API_VERSION` (`src/lib/whatsapp/graph-version.ts`, משימה 2b) — לכל בנאי `WhatsAppAPI` ולכל `fetch` גולמי **שהתוכנית נוגעת בו**. קבצים שאינם בהיקף (`template-health.ts`, `relocation/*`) — §14 follow-ups, לא נוגעים כאן.
- תצורה עסקית (מזהי מספרים, מספר לתצוגה) יושבת ב-`app_settings` ונערכת ב-`/admin/channels`. **עמודה ב-DB בלי ממשק אדמין ≠ סיום.** אין hardcode של מספר טלפון בשום קובץ.
- מיגרציות רק דרך `npx supabase migration new <name>` → `npx supabase db push --linked` (הרצה = **אישור בעלים מפורש**). `src/lib/supabase/types.generated.ts` נוצר רק ב-`npm run gen:types`; אסור לערוך ידנית; `npm run deploy` נחסם על drift (`scripts/check-supabase-types.mjs`).
- אסור: `@ts-ignore`, `@ts-nocheck`, `as any`, casts לא בטוחים, השתקת בדיקות.
- אין לוגים של payload, טלפון אורח, טוקן או app secret. `phone_number_id` הוא מזהה טכני (לא PII) ומותר בהתראות.
- Worker: `whatsapp-import.ts` ו-`webhook-processing.ts` נארזים ל-`dist/worker.cjs`; אסור להם להגיע ל-`next/headers|navigation|cache` (`.dependency-cruiser.cjs`, נאכף ב-`pretest`).
- UI בעברית, RTL; מספרי טלפון ב-`dir="ltr"`.
- שערים לכל משימה: `npx tsc --noEmit` · `npm run lint` · `npm test -- --run <file>` · ובסוף `npm run build`.
- הודעות commit בסגנון הריפו (`feat(scope): …`, `fix(scope): …`, `docs: …`, `test(scope): …`, `chore(types): …`), עם הטריילרים:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU`
- `npm run deploy` **תמיד** מורץ על ידי הבעלים. שליחות אמיתיות רק באישור מפורש.

---

## §0 תקציר מנהלים (לבעלים)

**מה משתנה.** היום ה-worker לא יודע לאיזה מספר הגיעה הודעה: כל הודעה עוברת את אותו מסלול (`processMessage`) — קודם ניסיון ייבוא, ואז סיווג/חיוב/RSVP. ההוכחה מהיום: ההודעה ששלחת למספר החדש נרשמה כאינטראקציה **חייבת** (`billable = true`) על קמפיין הברית **הסגור**. אחרי התוכנית: הודעה שהגיעה למספר הייבוא נכנסת רק למסלול הייבוא; הודעה שהגיעה למספר ה-RSVP נכנסת רק למסלול ה-RSVP; מספר לא מוכר — מתועד ומתעלמים ממנו. תשובות הייבוא יוצאות מהמספר שקיבל את הרשימה.

**מה צריך להחליט (ברירת המחדל המומלצת מסומנת).**

| # | החלטה | מומלץ | החלופה ומה היא משנה |
|---|---|---|---|
| A | הפרדה קשיחה או תקופת מעבר | **הפרדה קשיחה**: רשימות מתקבלות רק במספר הייבוא. בעלים מאומת ששולח CSV למספר ה-RSVP מקבל **שורת הפניה אחת** מהמספר הזה עם מספר הייבוא וקישור `wa.me`. זר — כלום. | *תקופת מעבר* (שני המספרים קולטים, כל אחד עונה מעצמו): ~10 שורות בשני קבצים + 2 בדיקות מתהפכות (§4 A2). *התעלמות שקטה* במקום הפניה: מחיקת שורה אחת ב-`replyImportPointer` (§4 A3). |
| B | איפה חי המספר לתצוגה | **שדה אדמין** `whatsapp_import_display_number`, לצד מזהה המספר; כפתור "בדיקת חיבור" למספר הייבוא מציג את המספר כפי ש-Meta מחזירה אותו כדי להעתיק/לאמת. | *גזירה מ-Graph API בזמן רינדור*: קריאת רשת בכל טעינת עמוד ללקוח, אין שכבת cache בריפו — נדחה. *שימוש ב-`company_contact_phone`*: היום הוא כבר `033301505` (המספר החדש), אבל זה שדה משפטי מ-`/admin/company` שמופיע בהסכם; קישור המשמעויות יישבר ברגע שיתחלף. נדחה. |
| C | ניקוי 5 שורות env | **למחוק** (בעלים מריץ; §12.5). אף שורת קוד לא קוראת אותן — אומת ב-grep. | להשאיר: אין נזק תפעולי, רק בלבול עתידי (`WHATSAPP_BUSINESS_ACCOUNT_ID` מצביע על ה-WABA השגוי). |
| D | החלפת הטוקן האישי בטוקן System-User | **כן, בצעד נפרד**, דרך `/admin/channels` בלבד, אחרי שהפיצול חי ואומת (§12.6). דדליין טבעי: `data_access_expires_at` של הטוקן האישי = 2026-12-02. | לדחות: הכל ממשיך לעבוד עד 2026-12-02. |

**מה תצטרך לעשות ידנית.** (1) לאשר את המיגרציה (`db push`) — עמודות nullable, אפס השבתה. (2) `npm run deploy`. (3) למלא ב-`/admin/channels` את מזהה מספר הייבוא `1298694319994421` ואת המספר לתצוגה `+972 3-330-1505`, ללחוץ "בדיקת חיבור — מספר ייבוא". (4) ארבע בדיקות חיות מהטלפון שלך (§12.4) — כל אחת עם SQL לאימות. (5) אופציונלי: C ו-D.

**מה עוד נכנס, מביקורת ה-SDK המקבילה (אותם קבצים, אותו deploy).** (1) הורדת קובץ ה-CSV עוברת מ-`fetch` גולמי ל-`retrieveMedia`/`fetchMedia` של ה-SDK, מוגבלת למספר שקיבל את הקובץ (`phone_number_id`), עם timeout ותקרת 1MB כפי שהיא. (2) קבוע גרסת Graph אחד (`GRAPH_API_VERSION`) במקום שלושה מקורות שונים — וזה גם משתיק אזהרה שנכתבת היום ללוג השגיאות **בכל** POST של webhook (59 מופעים נמדדו, האחרון היום 19:12). (3) שאר הממצאים (טיפוס `held_for_quality_assessment`, פינים ב-`template-health`/relocation, תפריט ActionList) — §14 follow-ups, לא כאן.

**מה לא משתנה.** ה-route של ה-webhook (מלבד `v` בבנאי — אין לו השפעה על אימות החתימה), ה-verify token, כל שליחות ה-RSVP/תזכורות/תודה/headcount (כולן ממשיכות מהמספר הקיים), MM Lite, סטטוסי מסירה, החיוב.

---

## §1 אימות מול ה-DB החי ומול הקוד (2026-09-03)

כל השאילתות קריאה בלבד, `pg_catalog` לאילוצים/הרשאות. `supabase migration list --linked` — **אין drift** (כל 219 המיגרציות local == remote).

### 1.1 מה אומת ✅

| טענה | ממצא |
|---|---|
| `webhook_inbox.phone_number_id` קיים ונשמר | 13 עמודות; `phone_number_id text` nullable. ה-route כותב אותו מ-`value.metadata.phone_number_id` (`route.ts:104,115,131`). |
| הודעות מהמספר החדש כבר בתיבה | `1298694319994421`: 2 `message` + 3 `status`, כולן היום, כולן `processed`, אפס שגיאות. `1018741517998430`: 69 `message` + 581 `status` מאז 29.6. בנוסף 3 שורות QA מ-29.6 עם `phone_number_id = 123456123` (מספר בדוי — מדגים את מקרה "מספר לא מוכר"). |
| ההוכחה לתקלה | היום 15:04 UTC: הודעת `text` שהגיעה ל-`1298694319994421` → שורת `contact_interactions` אחת, `direction=in`, `billable=true`, `channel=whatsapp`, על אירוע `brit` בסטטוס `closed` וקמפיין `closed`. זו השורה היחידה של היום. (הודעת text נוספת הגיעה למספר החדש ב-08:27 ולא יצרה אינטראקציה; ב-14:44 הגיעה הודעת `contacts` **למספר ה-RSVP** — כלומר ניסיון ייבוא נעשה היום דווקא במספר הישן.) |
| שום קוד לא קורא `phone_number_id` בעיבוד | `webhook-processing.ts`, `whatsapp-import.ts`, `worker/main.ts` — אפס הפניות. הקורא היחיד: `admin/webhooks/webhook-detail.tsx:100-104` (תצוגה) וחיפוש ב-`admin/webhooks/page.tsx:157`. |
| `app_settings` — הרשאות | RLS פעיל; מדיניות יחידה `app_settings_admin_all` (`FOR ALL`, `authenticated`, `has_role(auth.uid(),'admin')` ב-USING וב-WITH CHECK). Grants ברמת טבלה: `authenticated` SELECT+UPDATE, `service_role` הכל, `postgres` הכל. עמודה חדשה יורשת את זה אוטומטית — **אין צורך ב-GRANT**. |
| מי כותב ל-`app_settings` | `/admin/channels` כותב דרך `createClient()` (cookie, RLS) אחרי `requirePlatformPermission('manage_settings')` (`channels.ts:60-76`). ה-worker והקוראים הציבוריים קוראים דרך `createAdminClient()` (service-role) — `outreach-config.ts:63-99`, `company.ts:31-51`. |
| ערכים חיים (לא סודות) | `whatsapp_phone_number_id = 1018741517998430`, `whatsapp_waba_id = 990921550130385` (ה-WABA הקנוני), טוקן/סוד/verify קיימים. **`company_contact_phone = 033301505`** — המספר החדש כבר משמש כטלפון החברה בהסכם. |
| עמודות `whatsapp_import_*` | **לא קיימות** (לא ב-DB, לא ב-`types.generated.ts`, לא בקוד). |
| הטבלאות לאימות החי | `guest_import_staging(id, event_id, source, sender_phone, file_name, rows, row_count, error_rows, status default 'pending', created_at, resolved_at)`; `billed_results(…, evidence_source, provider_ref, attempt_id, …)`. |
| env | `.env.local`: 118 שורות, האחרונה (`META_APP_ID_WA`) **ללא `\n` סוגר** (`wc -l` = 117). השורות 114–118 הן חמשת מפתחות ה-WA. `grep` על `src/ worker/ scripts/ ecosystem.config.cjs`: אף אחד מהם לא נקרא; היחיד שנקרא הוא `WHATSAPP_GRAPH_VERSION` (`channels.ts:89`) — **נשאר**. |
| Meta (DOCS-ONLY) | דף ה-webhook components מראה `metadata: { display_phone_number, phone_number_id }` בכל `value` של `messages`; `entry.id` = WABA. VERIFIED-LIVE בתיבה: הסטטוסים של הודעה שנשלחה מהמספר החדש חזרו עם `phone_number_id = 1298694319994421` — כלומר **סטטוסי המסירה של תשובה מזהים את המספר ששלח אותה**. זה הבסיס לאימות (ii) ב-§12.4 מתוך ה-DB. |
| מנוי ה-webhook של האפליקציה | MEASURED 2026-09-03 (team-lead, `GET /{app-id}/subscriptions`): שדות המנוי של `whatsapp_business_account` רשומים בגרסה **v25.0**. אין override ברמת WABA/מספר. |
| SDK 6.2.2 — מדיה (MEASURED מ-`node_modules`) | `retrieveMedia(id, phoneID?)` → `GET /{v}/{id}?phone_number_id=…` ומחזיר `{ url, mime_type, sha256, file_size: string, id }` או `{ error }`; `fetchMedia(url)` → `GET` מאומת (Bearer מ-`$$apiFetch$$`) עם `User-Agent` של Googlebot (`lib/index.js:430-437`). לשניהם **אין** פרמטר `signal` — timeout רק דרך `ponyfill.fetch` בבנאי (`lib/types.d.ts:100-104`). |
| אזהרת גרסה ב-route | MEASURED: `route.ts:177` בונה `WhatsAppAPI` בלי `v` ⇒ `console.warn` בכל POST (`lib/index.js:128-133`). `kalfa-beta-error.log`: **59** מופעים של "Cloud API version not defined", האחרון 2026-09-03 19:12 (+03:00); `kalfa-worker-error.log`: 0 (ה-worker עובר דרך `client.ts` שמעביר `v`). |
| פיני Graph בקוד (MEASURED grep) | `client.ts` ×4 = `DEFAULT_API_VERSION` של ה-SDK (**v24.0**); `whatsapp-import.ts:253`, `template-health.ts:16`, `relocation/meta-templates.ts:34`, `channels.ts:89` (fallback) = **v23.0**; `relocation/preflight.ts:720`, `relocation/external.ts:201` = **v21.0** (פקיעה 2027-01-21, הקרובה ביותר). Meta latest = v26.0. **תשובת ה-staging של היום (14:45) יצאה דרך `client.ts` על v24.0 והתקבלו sent/read** — v24.0 מוכח לשליחה על ה-WABA הזה. |

### 1.2 טענות שדרשו דיוק

| # | הטענה | הדיוק |
|---|---|---|
| 1 | "השדות ~340-370 בטופס" | `channels-client.tsx:339-373` — נכון. ה-type המקומי `WhatsAppConfig` בשורות 37-45 **חייב** להתעדכן גם הוא (הוא לא מיובא מה-DAL). |
| 2 | "`getWhatsAppConfig` נקרא ב-9 צרכנים" | נכון; **כולם** שולחים דרך `config.phoneNumberId` (RSVP) או משתמשים רק ב-`wabaId`/`!== null`. אף אחד לא צריך להשתנות (§3.3). |
| 3 | `docs/project/03-database-schema.md:639` — "אין שום פוליסת קריאה ל-authenticated" | לא מדויק: המדיניות `app_settings_admin_all` היא `FOR ALL` ל-`authenticated` עם תנאי אדמין — אדמין מחובר **כן** קורא דרך RLS. לתיקון במשימה 11. |
| 4 | "בדיקת רינדור UI אם יש דפוס" | יש: `settings/page.test.ts` ו-`app/page.test.ts` קוראים ל-Server Component ישירות ובודקים את עץ האלמנטים (`collect()`); `vitest.config.ts` כולל רק `*.test.ts` (אין jsdom). הבדיקות ב-§9–§10 בנויות על הדפוס הזה. |
| 5 | `WhatsAppConfig` מורחב | חמישה קובצי בדיקה בונים את הליטרל המלא ויישברו ב-`tsc`: `api/webhooks/whatsapp/route.test.ts` (2 מקומות), `api/campaigns/[id]/whatsapp-send/route.test.ts`, `lib/data/outreach.test.ts`, `lib/data/outreach-config.test.ts`. ארבעה נוספים (`headcount`, `outreach-engine`, `template-health-sync`, `outreach.worker-cookies`) עושים `mockResolvedValue` — לא נקראו; `tsc` הוא השער (משימה 3). |

### 1.3 מה לא ניתן היה לאמת מכאן

- מצב ה-Meta (WABA, System-User, סוגי טוקנים, health) — מהסשן של הבעלים; לא נבדק מחדש (אין קריאת Graph מהתוכנית).
- שה-System-User token אכן מורשה על **שני** המספרים — יאומת רק ב"בדיקת חיבור" ×2 אחרי ההחלפה (§12.6).

---

## §2 המימוש הנוכחי — הצינור כפי שהוא

```
Meta  ──POST──▶  /api/webhooks/whatsapp  (route.ts)
                  ├─ getOutreachEnabled() + getWhatsAppConfig()        :162-170
                  ├─ verifyRequestSignature(raw, X-Hub-Signature-256)   :177-191  ← app secret אחד לשני המספרים
                  └─ normalizeWebhookRows → insertWebhookEvents          :98-141, 201-204
                        phone_number_id = value.metadata.phone_number_id :104

worker/main.ts handleWebhook()  :487-507   (גם reprocess מ-/admin/webhooks מגיע לכאן — הוא רק מאפס processed_at)
  └─ processWebhookEvent(row)   webhook-processing.ts:76
       └─ processMessage(row)   :182-286
            ├─ stageWhatsAppImport(row)  :189   ← על כל הודעה, בלי קשר למספר
            │     whatsapp-import.ts:289-373
            │       InboxRow = { payload }                       :25-27
            │       config = await getWhatsAppConfig()           :300
            │       safeReply(config, …) ×5  → sendWhatsAppText  :310,325,330,363,367
            │            └─ client.ts:301  api.sendMessage(cfg.phoneNumberId, …)  ← תמיד מספר ה-RSVP
            ├─ classifyMessagePayload → resolveByContextId / resolveInboundContact
            ├─ insertInteraction(billable:true) → recordReached
            └─ removal / RSVP button / headcount
       └─ processStatus(row)    :292-319   ← לפי wamid בלבד; מספר-אגנוסטי
```

`WhatsAppConfig` (`outreach-config.ts:17-23`): `{ phoneNumberId, wabaId, accessToken, appSecret, verifyToken }`. הקורא `getWhatsAppConfig()` עושה `select('*')` בכוונה — עמיד לעמודות שטרם הוגרו (הערת הקובץ, שורות 10-15).

ממשק הלקוח: `add-guests-onboarding.tsx:108-119` — האפשרות הראשית "ייבוא דרך WhatsApp" מקשרת לעמוד הפנימי ולא מציגה מספר; `import/whatsapp/page.tsx:59-64` — "שלחו קובץ CSV או שתפו אנשי קשר לוואטסאפ העסקי" בלי מספר ובלי קישור.

---

## §3 העיצוב

### 3.1 כלל הניתוב (אחד, במקום אחד)

```
classifyInboundChannel(row.phone_number_id, config)
  config == null או config.importPhoneNumberId == null   → 'rsvp'     (legacy: הכל כמו היום)
  row.phone_number_id == importPhoneNumberId              → 'import'
  row.phone_number_id == null או == phoneNumberId         → 'rsvp'
  אחרת                                                    → 'unknown'
```

| ערוץ | מה רץ | מה **לא** רץ |
|---|---|---|
| `import` | `stageWhatsAppImport(row, config)` בלבד. תשובות מ-`importSender(config)` = מספר הייבוא. הודעה שאינה CSV/אנשי קשר (טקסט, ריאקציה, כפתור) — מתעלמים בשקט, `processed_at` נכתב. | סיווג, `resolve*`, `insertInteraction`, `recordReached`, opt-out, RSVP, headcount. |
| `rsvp` + פיצול מוגדר | `replyImportPointer(row, config)` — אם זו רשימה מבעלים מאומת: הפניה אחת ממספר ה-RSVP וסיום. אחרת המסלול הקיים במלואו. | `stageWhatsAppImport` (הפרדה קשיחה). |
| `rsvp` + legacy | בדיוק היום: `stageWhatsAppImport` ואז המסלול הקיים. | — |
| `unknown` | התראת Slack אחת (`rowId`, `phoneNumberId` בלבד) ו-`processed_at`. | הכל. |

**למה "מספר לא מוכר" = התעלמות ולא מסלול RSVP:** המסלול היחיד עם השלכה כספית הוא מסלול ה-RSVP (`billable=true` + `recordReached`). מספר שלישי שיתווסף ל-WABA בעתיד, או מזהה שגוי בטופס, לא אמור לחייב איש בשקט. ההתראה מבטיחה שזה לא נעלם (כלל "אזהרות = חובה לטפל").

**למה `stageWhatsAppImport` מקבל את ה-config מבחוץ:** חוסך קריאת `app_settings` שנייה לכל הודעה, ומאפשר ל-`processMessage` להיות המקום היחיד שמחליט. בתוך המודול נשאר שומר-סף (אם מוגדר מספר ייבוא והשורה הגיעה למספר אחר → `false`) כדי שהמודול יגן על עצמו מקורא עתידי ששכח.

### 3.2 מודל הנתונים

שתי עמודות `text` nullable ב-`app_settings`: `whatsapp_import_phone_number_id`, `whatsapp_import_display_number`. **לא** מתווספים טוקן/סוד/WABA — אותה אפליקציה, אותו WABA, אותו System-User; טוקן שני היה כפילות של סוד בלי סיבה. אין CHECK "שניהם או כלום" ב-DB — נאכף ב-Zod של הטופס (הכותב היחיד) וב-`getWhatsAppImportChannel` (הקורא ללקוח); הושמט בכוונה כדי שגלגול לאחור יהיה `drop column` נקי בלי אילוץ תלוי.

### 3.3 מי לא משתנה (אומת קובץ-קובץ)

`headcount.ts:50,106`, `outreach-engine.ts:389,700`, `outreach.ts:67,207`, `whatsapp-send/route.ts:69`, `sls/tool/signup-link/[token]/route.ts:120-137`, `template-health-sync.ts:25-39` (רק `wabaId`), `ops/integrations.ts:45` (רק `!== null`), `api/webhooks/whatsapp/route.ts` — כולם ממשיכים לשלוח/לבדוק דרך `config.phoneNumberId`. `processStatus` מזהה לפי wamid — סטטוס של תשובת ייבוא לא ימצא שורת `contact_interactions` ויסתיים בשקט (בדיוק מה שקרה היום ל-3 הסטטוסים מהמספר החדש).

---

## §4 החלטה A — פירוט הדלתאות

**A1 (מומלץ, מה שהתוכנית מממשת):** הפרדה קשיחה + הפניה. יתרון: הבעלים אף פעם לא מחכה לקישור שלא יגיע; ההפניה היא הודעה חופשית בתוך חלון 24 השעות שהבעלים עצמו פתח — בלי תבנית, בלי תוכן שיווקי, בלי 131049. עלות: `resolveOwnerActiveEvents` אחת (שכבר רצה היום לסוגים האלה) + שליחה אחת.

**A2 — תקופת מעבר (שני המספרים קולטים, כל אחד עונה מעצמו):**
1. `webhook-processing.ts` ענף `rsvp`: במקום `replyImportPointer` — `if (await stageWhatsAppImport(row, config)) return;` גם כשהפיצול מוגדר.
2. `whatsapp-import.ts`: להסיר את שומר-הסף, ולבחור שולח לפי המספר שקיבל:
   `const from = row.phone_number_id === config.importPhoneNumberId ? importSender(config) : { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken, appSecret: config.appSecret };`
3. בדיקות: "RSVP number under the split: lists are NOT staged" מתהפכת ל-"…are staged and answered from the RSVP number"; בדיקת שומר-הסף נמחקת. `replyImportPointer` נשאר בקוד ללא קורא — או נמחק.

**A3 — התעלמות שקטה במקום הפניה:** ב-`replyImportPointer` להחליף את שלוש השורות האחרונות ב-`return true;` אחרי בדיקת הבעלים (או להשאיר את הפונקציה כ-`return readImportPayload(row.payload) !== null` — אז גם זר וגם בעלים שקטים ואין קריאת DB). בדיקה אחת מתהפכת (`sendWhatsAppText` not called).

---

## File Structure

| קובץ | פעולה | אחריות |
|---|---|---|
| `supabase/migrations/<ts>_whatsapp_import_channel.sql` | ❗ חדש | שתי העמודות + הערות + rollback |
| `src/lib/supabase/types.generated.ts` | 🔄 regen | `npm run gen:types` בלבד |
| `src/lib/whatsapp/channel-routing.ts` | ❗ חדש | לוגיקה טהורה: `classifyInboundChannel`, `importSender`, `waMeUrl`, טיפוסים `WhatsAppSender`/`InboundChannel` |
| `src/lib/whatsapp/channel-routing.test.ts` | ❗ חדש | |
| `src/lib/whatsapp/graph-version.ts` | ❗ חדש | `GRAPH_API_VERSION` — הפין היחיד בבעלות kalfa (+ override מ-`WHATSAPP_GRAPH_VERSION`) |
| `src/lib/whatsapp/graph-version.test.ts` | ❗ חדש | |
| `src/lib/whatsapp/client.ts` | 🔄 | `DEFAULT_API_VERSION` של ה-SDK → `GRAPH_API_VERSION` (4 מקומות) |
| `src/lib/whatsapp/client.test.ts` | 🔄 | ה-mock לוכד את ארגומנטי הבנאי; בדיקת `v` |
| `src/app/api/webhooks/whatsapp/route.ts` | 🔄 | `v: GRAPH_API_VERSION` בבנאי (משתיק את האזהרה; אפס שינוי באימות) |
| `src/app/api/webhooks/whatsapp/route.test.ts` | 🔄 | ליטרלי `WhatsAppConfig` + בדיקה "אין אזהרת גרסה" |
| `src/lib/data/outreach-config.ts` | 🔄 | `WhatsAppConfig` + שני שדות; קריאה מ-`app_settings` |
| `src/lib/data/outreach-config.test.ts` | 🔄 | |
| `src/lib/data/whatsapp-import.ts` | 🔄 | `InboxRow` + `phone_number_id`; config מבחוץ; שומר-סף; `importSender`; `readImportPayload`; `replyImportPointer`; `buildImportPointerReply`; `downloadDocument` דרך ה-SDK מוגבל למספר + timeout |
| `src/lib/data/whatsapp-import.test.ts` | 🔄 | |
| `src/lib/data/webhook-processing.ts` | 🔄 | הניתוב ב-`processMessage` |
| `src/lib/data/webhook-processing.test.ts` | 🔄 | |
| `src/lib/data/admin/channels.ts` | 🔄 | DAL: שני שדות, `importConfigured`, `probePhoneNumber`, `testWhatsAppImportConnection` |
| `src/app/(admin)/admin/channels/actions.ts` | 🔄 | Zod (זיווג + טלפון תקין + שונה ממספר ה-RSVP), `testWhatsAppImportConnectionAction` |
| `src/app/(admin)/admin/channels/actions.test.ts` | 🔄 | |
| `src/app/(admin)/admin/channels/channels-client.tsx` | 🔄 | אקורדיון "מספר ייבוא מוזמנים", כפתור בדיקה שני, `dir` ל-`Field` |
| `src/lib/data/whatsapp-import-channel.ts` | ❗ חדש | קורא ללקוח, נטול סודות: `getWhatsAppImportChannel()` |
| `src/lib/data/whatsapp-import-channel.test.ts` | ❗ חדש | |
| `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.tsx` | 🔄 | prop `importChannel`; קישור `wa.me`; המספר ב-`dir="ltr"` |
| `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts` | ❗ חדש | |
| `src/app/(customer)/app/events/[id]/guests/page.tsx` | 🔄 | טעינת `getWhatsAppImportChannel()` בענף ה-onboarding |
| `src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.tsx` | 🔄 | תיבת "איך שולחים" + `wa.me` |
| `src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts` | ❗ חדש | |
| `src/lib/relocation/install-steps.ts` | 🔄 | טקסט תכנון I12 בלבד |
| `docs/project/07-messaging-channels.md`, `docs/project/03-database-schema.md`, `docs/project/05-guests-and-public-rsvp.md`, `docs/project/09-admin-panel.md`, `docs/webhook-inbox-data-contract.md`, `docs/admin-webhooks-runbook.md` | 🔄 | תיעוד |

לא נוגעים: `interactions.ts`, `headcount.ts`, `outreach*.ts`, `staging-client.tsx`, `import/whatsapp/actions.ts`, `template-health.ts`, `relocation/*` (מלבד טקסט I12), `.env*`. ב-`route.ts` וב-`client.ts` משתנה **רק** מקור ה-`v`.

---

### Task 1: מיגרציה + regen של הטיפוסים

**Files:**
- Create: `supabase/migrations/<timestamp>_whatsapp_import_channel.sql` (נוצר ב-CLI)
- Regen: `src/lib/supabase/types.generated.ts`

**Interfaces:**
- Produces: `app_settings.whatsapp_import_phone_number_id text null`, `app_settings.whatsapp_import_display_number text null`; `Tables<'app_settings'>` מכיל את שניהם (`string | null`). כל המשימות הבאות מסתמכות על זה ב-`tsc`.

- [ ] **Step 1: ליצור את קובץ המיגרציה**

Run: `npx supabase migration new whatsapp_import_channel`
Expected: `Created new migration at supabase/migrations/2026090XXXXXXX_whatsapp_import_channel.sql`

- [ ] **Step 2: תוכן המיגרציה**

```sql
-- Dedicated WhatsApp Cloud API phone number for GUEST-LIST IMPORT, split from
-- the RSVP-outreach number. Both numbers live under the same Meta app and the
-- same WABA and are reached with the same System-User token and app secret,
-- so NO new token/secret/WABA columns: only the routing key (phone_number_id)
-- and the human-readable number customers are told to write to.
--
-- Null = the split is not configured: the worker keeps today's behaviour
-- (lists accepted on the RSVP number, replies from it). Set = hard split:
-- src/lib/data/webhook-processing.ts routes each inbound by
-- webhook_inbox.phone_number_id and src/lib/data/whatsapp-import.ts replies
-- from the import number. Both fields are written together by
-- /admin/channels (Zod enforces the pairing); no DB CHECK on purpose so the
-- rollback below stays a plain drop.
--
-- No GRANT (table-level grants on app_settings already cover authenticated
-- SELECT/UPDATE + service_role, and extend to new columns), no RLS change
-- (app_settings_admin_all is FOR ALL), no index (singleton row).
--
-- Rollback:
--   alter table public.app_settings
--     drop column if exists whatsapp_import_phone_number_id,
--     drop column if exists whatsapp_import_display_number;

alter table public.app_settings
  add column if not exists whatsapp_import_phone_number_id text,
  add column if not exists whatsapp_import_display_number text;

comment on column public.app_settings.whatsapp_import_phone_number_id is
  'Cloud API phone_number_id of the DEDICATED guest-import WhatsApp number. Routing key: an inbound whose webhook_inbox.phone_number_id equals this goes ONLY to the import path (never billing/RSVP). Null = split off (legacy: the RSVP number also accepts lists).';
comment on column public.app_settings.whatsapp_import_display_number is
  'The import number as customers see/dial it (e.g. "+972 3-330-1505"). Shown on the add-guests onboarding + import screens with a wa.me link, and quoted in the pointer reply sent when a list reaches the RSVP number. Must be set together with whatsapp_import_phone_number_id.';
```

- [ ] **Step 3: אישור בעלים והרצה**

Run (בעלים, אחרי אישור מפורש): `npx supabase db push --linked`
Expected: `Applying migration 2026090XXXXXXX_whatsapp_import_channel.sql... Finished supabase db push.` (זכור: exit 1 עם "Finished" = הצליח; ראה memory `parallel-sessions-one-live-db`).

- [ ] **Step 4: אימות חי**

Run:
```bash
npx --no-install supabase db query --linked --output json "select a.attname, format_type(a.atttypid,a.atttypmod) as type, a.attnotnull from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='app_settings' and a.attname like 'whatsapp_import_%' and not a.attisdropped order by a.attnum"
```
Expected: שתי שורות, `text`, `attnotnull=false`.

- [ ] **Step 5: regen + שער drift**

Run: `npm run gen:types && npm run types:check && git diff --stat src/lib/supabase/types.generated.ts`
Expected: `types:check` עובר; ה-diff מוסיף בדיוק 6 שורות (`Row`/`Insert`/`Update` × 2 עמודות) ותו לא.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_whatsapp_import_channel.sql src/lib/supabase/types.generated.ts
git commit -m "feat(db): app_settings gains the dedicated WhatsApp import number

Two nullable text columns (phone_number_id routing key + display number).
Same app/WABA/token as the RSVP number, so no new secrets. Null = legacy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 2: מודול ניתוב טהור — `channel-routing.ts`

**Files:**
- Create: `src/lib/whatsapp/channel-routing.ts`
- Test: `src/lib/whatsapp/channel-routing.test.ts`

**Interfaces:**
- Consumes: `normalizePhone(raw): string | null` מ-`src/lib/phone.ts:11` (E.164 או null).
- Produces:
  - `type WhatsAppSender = { phoneNumberId: string; accessToken: string; appSecret: string | null }`
  - `type ChannelNumbers = { phoneNumberId: string; importPhoneNumberId: string | null }`
  - `type InboundChannel = 'import' | 'rsvp' | 'unknown'`
  - `classifyInboundChannel(rowPhoneNumberId: string | null, numbers: ChannelNumbers | null): InboundChannel`
  - `importSender(config: WhatsAppSender & { importPhoneNumberId: string | null }): WhatsAppSender`
  - `waMeUrl(displayNumber: string): string | null`

- [ ] **Step 1: הבדיקה הנכשלת**

```ts
// src/lib/whatsapp/channel-routing.test.ts
import { describe, expect, it } from 'vitest';

import {
  classifyInboundChannel,
  importSender,
  waMeUrl,
} from './channel-routing';

const SPLIT = { phoneNumberId: 'rsvp-1', importPhoneNumberId: 'imp-1' };
const LEGACY = { phoneNumberId: 'rsvp-1', importPhoneNumberId: null };

describe('classifyInboundChannel', () => {
  it('routes the import number to the import path when the split is configured', () => {
    expect(classifyInboundChannel('imp-1', SPLIT)).toBe('import');
  });

  it('routes the RSVP number to the RSVP path', () => {
    expect(classifyInboundChannel('rsvp-1', SPLIT)).toBe('rsvp');
  });

  it('treats a NULL phone_number_id as the RSVP number (rows without metadata)', () => {
    expect(classifyInboundChannel(null, SPLIT)).toBe('rsvp');
  });

  it('flags a number that is neither as unknown', () => {
    expect(classifyInboundChannel('123456123', SPLIT)).toBe('unknown');
  });

  it('legacy (no import number): EVERYTHING is the RSVP path — including the future import number', () => {
    expect(classifyInboundChannel('imp-1', LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel('123456123', LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel(null, LEGACY)).toBe('rsvp');
  });

  it('no config at all (channel off) → RSVP path, never unknown', () => {
    expect(classifyInboundChannel('imp-1', null)).toBe('rsvp');
  });
});

describe('importSender', () => {
  const base = { phoneNumberId: 'rsvp-1', accessToken: 'tok', appSecret: 'sec' };

  it('sends from the import number when configured, with the SAME token/secret', () => {
    expect(importSender({ ...base, importPhoneNumberId: 'imp-1' })).toEqual({
      phoneNumberId: 'imp-1',
      accessToken: 'tok',
      appSecret: 'sec',
    });
  });

  it('falls back to the RSVP number when the split is off (legacy replies unchanged)', () => {
    expect(importSender({ ...base, importPhoneNumberId: null })).toEqual(base);
  });
});

describe('waMeUrl', () => {
  it('builds the deep link from any Israeli spelling of the number', () => {
    expect(waMeUrl('+972 3-330-1505')).toBe('https://wa.me/97233301505');
    expect(waMeUrl('03-330-1505')).toBe('https://wa.me/97233301505');
    expect(waMeUrl('033301505')).toBe('https://wa.me/97233301505');
  });

  it('returns null for something that is not a dialable number (no broken link)', () => {
    expect(waMeUrl('')).toBeNull();
    expect(waMeUrl('abc')).toBeNull();
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/whatsapp/channel-routing.test.ts`
Expected: FAIL — `Failed to resolve import "./channel-routing"`.

- [ ] **Step 3: המימוש**

```ts
// src/lib/whatsapp/channel-routing.ts
import { normalizePhone } from '@/lib/phone';

// Pure routing rules for the two-number WhatsApp setup (RSVP outreach number
// vs. the dedicated guest-import number). No I/O, no server-only: imported by
// the worker path (webhook-processing / whatsapp-import) AND by admin/customer
// server code, and unit-tested directly.
//
// Both numbers share one Meta app, one WABA, one token and one app secret —
// the ONLY thing that differs is the phone_number_id a message arrived at
// (webhook_inbox.phone_number_id) or is sent from (/{phone_number_id}/messages).

export type WhatsAppSender = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
};

export type ChannelNumbers = {
  phoneNumberId: string; // the RSVP outreach number
  importPhoneNumberId: string | null; // null = split not configured (legacy)
};

export type InboundChannel = 'import' | 'rsvp' | 'unknown';

// Which path an inbound row belongs to. Legacy (no import number, or no
// config at all) is deliberately 'rsvp' for EVERY phone_number_id — exactly
// today's behaviour — so deploying the code before the admin fills the field
// changes nothing. Once the import number is set: the import number → import
// only; the RSVP number (or a row without metadata) → RSVP; anything else →
// unknown (ignored + alerted by the caller, never billed).
export function classifyInboundChannel(
  rowPhoneNumberId: string | null,
  numbers: ChannelNumbers | null,
): InboundChannel {
  if (!numbers?.importPhoneNumberId) return 'rsvp';
  if (rowPhoneNumberId === numbers.importPhoneNumberId) return 'import';
  if (rowPhoneNumberId === null || rowPhoneNumberId === numbers.phoneNumberId) {
    return 'rsvp';
  }
  return 'unknown';
}

// The sender to use for import replies: the import number when configured,
// otherwise the RSVP number (legacy). Same token and secret either way.
export function importSender(
  config: WhatsAppSender & { importPhoneNumberId: string | null },
): WhatsAppSender {
  return {
    phoneNumberId: config.importPhoneNumberId ?? config.phoneNumberId,
    accessToken: config.accessToken,
    appSecret: config.appSecret,
  };
}

// wa.me deep link for the admin-entered display number. Goes through the
// product's one phone normalizer (E.164, IL default) so "03-330-1505" and
// "+972 3-330-1505" produce the same link; null when it does not normalize so
// callers omit the link rather than render a broken one.
export function waMeUrl(displayNumber: string): string | null {
  const e164 = normalizePhone(displayNumber);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}
```

- [ ] **Step 4: להריץ ולראות הצלחה**

Run: `npm test -- --run src/lib/whatsapp/channel-routing.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/channel-routing.ts src/lib/whatsapp/channel-routing.test.ts
git commit -m "feat(whatsapp): pure routing rules for the RSVP vs import number

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 2b: קבוע גרסת Graph אחד — ומשתיקים את האזהרה ב-webhook

**Files:**
- Create: `src/lib/whatsapp/graph-version.ts`
- Test: `src/lib/whatsapp/graph-version.test.ts`
- Modify: `src/lib/whatsapp/client.ts:5, 220, 256, 274, 299`
- Modify: `src/lib/whatsapp/client.test.ts:5-17` + בדיקה חדשה
- Modify: `src/app/api/webhooks/whatsapp/route.ts:1-5, 177-181`
- Modify: `src/app/api/webhooks/whatsapp/route.test.ts` + בדיקה חדשה

**Interfaces:**
- Consumes: `process.env.WHATSAPP_GRAPH_VERSION` (הזרע הקיים מ-`channels.ts:89`).
- Produces: `export const GRAPH_API_VERSION: string` — נצרך במשימות 4 (`downloadDocument`) ו-6 (`probePhoneNumber`).

**למה v24.0 ולא v23.0:** כל שליחה של האפליקציה רצה על v24.0 מאז ש-`client.ts` מעביר את `DEFAULT_API_VERSION` של 6.2.x — כולל תשובת ה-staging של היום (14:45, sent/read התקבלו). זו הגרסה ש-SDK 6.2.2 נבדק מולה, והפקיעה שלה (2028-02-18) רחוקה יותר מזו של v23.0 (2027-10-08). שני ה-`fetch` הגולמיים שהתוכנית נוגעת בהם (probe של המספר, הורדת מדיה) קוראים שדות יציבים שקיימים בשתי הגרסאות; שניהם מתורגלים באימות החי §12.4. ההבדל מהיום: הפין הוא **ליטרל בריפו** ולא ייבוא מהספרייה — עדכון minor של ה-SDK לא יזיז את גרסת ה-Graph של kalfa בלי diff.

- [ ] **Step 1: הבדיקה הנכשלת**

```ts
// src/lib/whatsapp/graph-version.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

// The constant is evaluated at module load, so each case re-imports a fresh
// module after stubbing the env (the file-level rule: tests own their env).
async function load(): Promise<string> {
  vi.resetModules();
  return (await import('./graph-version')).GRAPH_API_VERSION;
}

afterEach(() => vi.unstubAllEnvs());

describe('GRAPH_API_VERSION', () => {
  it('is the kalfa-owned pin when the env override is unset', async () => {
    vi.stubEnv('WHATSAPP_GRAPH_VERSION', '');
    expect(await load()).toBe('v24.0');
  });

  it('honours a well-formed env override (emergency bump without a code change)', async () => {
    vi.stubEnv('WHATSAPP_GRAPH_VERSION', ' v25.0 ');
    expect(await load()).toBe('v25.0');
  });

  it('ignores a malformed override rather than building broken Graph URLs', async () => {
    vi.stubEnv('WHATSAPP_GRAPH_VERSION', '25');
    expect(await load()).toBe('v24.0');
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/whatsapp/graph-version.test.ts`
Expected: FAIL — המודול לא קיים.

- [ ] **Step 3: המימוש**

```ts
// src/lib/whatsapp/graph-version.ts
// The ONE Graph API version kalfa uses for every WhatsApp/Meta call it makes:
// each WhatsAppAPI constructor (client.ts, the webhooks route, the media
// download in whatsapp-import.ts) and the raw fetches that have no SDK method
// (the phone-number probe in admin/channels.ts). Pinned as a literal HERE, not
// imported from whatsapp-api-js's DEFAULT_API_VERSION, so a minor SDK update
// can never move kalfa's Graph version without a diff in this repo.
//
// MEASURED 2026-09-03: SDK 6.2.2 default = v24.0 (every send since the 6.2.x
// upgrade ran on it — today's staging reply included, sent/read received);
// the raw fetches were pinned v23.0; Meta's latest is v26.0; the app's webhook
// subscription reports v25.0 (GET /{app-id}/subscriptions). v24.0 expires
// 2028-02-18 per the capability audit. Bump deliberately, in one place.
//
// WHATSAPP_GRAPH_VERSION (env) was already the override in channels.ts — kept
// as the emergency lever: a restart, not a deploy. Malformed values are ignored
// so a typo cannot turn every Graph URL into a 400.
const PINNED_GRAPH_API_VERSION = 'v24.0';

const override = process.env.WHATSAPP_GRAPH_VERSION?.trim();

export const GRAPH_API_VERSION: string =
  override && /^v\d+\.\d+$/.test(override) ? override : PINNED_GRAPH_API_VERSION;
```

- [ ] **Step 4: `client.ts` — להחליף את מקור ה-`v`**

שורה 5: `import { DEFAULT_API_VERSION } from 'whatsapp-api-js/types';` → `import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';`

שורות 220, 256, 299: `v: DEFAULT_API_VERSION` → `v: GRAPH_API_VERSION`.
שורה 274: `` `https://graph.facebook.com/${DEFAULT_API_VERSION}/${cfg.phoneNumberId}/marketing_messages` `` → `` `https://graph.facebook.com/${GRAPH_API_VERSION}/${cfg.phoneNumberId}/marketing_messages` ``.

ולעדכן את ההערה בשורות 217-219:
```ts
  // secure:false avoids requiring the appSecret for SENDING (the secret is only
  // needed to verify INBOUND webhooks, handled in B2). v is kalfa's own pin
  // (graph-version.ts) — never the library's default, explicitly or implicitly.
```

- [ ] **Step 5: `client.test.ts` — ללכוד את ארגומנטי הבנאי ולבדוק `v`**

שורות 5-17:
```ts
const sendMessage = vi.fn();
// The MM Lite escape hatch — spied so tests assert the exact URL + body sent
// to `/marketing_messages` (there is no native SDK method to call instead).
const apiFetch = vi.fn();
// Every constructor call, so the version pin is asserted rather than assumed.
const ctorArgs: unknown[] = [];
// Only the API transport is mocked (never a real network call). The message
// classes ('whatsapp-api-js/messages') stay REAL so the tests assert the
// actual Cloud API payload shape the SDK builds — not a mock's echo.
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: class {
    constructor(args: unknown) {
      ctorArgs.push(args);
    }
    sendMessage = sendMessage;
    $$apiFetch$$ = apiFetch;
  },
}));

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import { sendWhatsAppMarketingTemplate, sendWhatsAppTemplate } from './client';
```
`afterEach` (שורה 33): `afterEach(() => { vi.clearAllMocks(); ctorArgs.length = 0; });`

בדיקה חדשה בסוף `describe('sendWhatsAppTemplate')`:
```ts
  it('pins kalfa\'s own Graph version on the SDK client (never the library default)', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.v' }] });

    await sendWhatsAppTemplate(cfg, { to: '+972501234567', templateName: 'rsvp_invite', language: 'he' });

    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]).toMatchObject({ token: 'TKN', secure: false, v: GRAPH_API_VERSION });
  });
```
בבדיקה הקיימת ב-`describe('sendWhatsAppMarketingTemplate')` (שורה 233: `expect(url).toMatch(/\/PNID\/marketing_messages$/)` — בודקת רק את הסיומת, אגנוסטית לגרסה) להוסיף שורה אחת מיד אחריה, כך שגם ה-URL של MM Lite נמדד מול הפין:
```ts
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/PNID/marketing_messages`);
```

- [ ] **Step 6: `route.ts` — `v` בבנאי**

שורות 1-5:
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { WhatsAppAPI } from 'whatsapp-api-js';
import type { PostData } from 'whatsapp-api-js/types';

import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
```
שורות 175-181:
```ts
  // Verify with the library's HMAC (no hand-rolled crypto). secure:true derives
  // the key from appSecret and validates X-Hub-Signature-256 over the raw body.
  // `v` is irrelevant to verification (no Graph call happens here) but the SDK
  // warns to stderr on EVERY construction without it — 59 lines in
  // kalfa-beta-error.log by 2026-09-03 — so the shared pin is passed.
  const wa = new WhatsAppAPI({
    token: config.accessToken,
    appSecret: config.appSecret,
    secure: true,
    v: GRAPH_API_VERSION,
  });
```

- [ ] **Step 7: `route.test.ts` — האזהרה לא נכתבת יותר**

בדיקה חדשה (בתוך ה-describe הראשי, אחרי הבדיקה של החתימה התקינה; `route.test.ts` משתמש ב-SDK האמיתי, לכן זו מדידה אמיתית של הבנאי):
```ts
  it('constructs the SDK client with an explicit Graph version — no "version not defined" warning per webhook', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await POST(
        signed(delivery({ messages: [{ id: 'wamid.v', from: '1', type: 'text' }] })),
      );
      expect(res.status).toBe(200);
      expect(
        warn.mock.calls.some((c) => String(c[0]).includes('Cloud API version not defined')),
      ).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
```

- [ ] **Step 8: להריץ**

Run: `npm test -- --run src/lib/whatsapp/graph-version.test.ts src/lib/whatsapp/client.test.ts src/app/api/webhooks/whatsapp/route.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS; `grep -rn "DEFAULT_API_VERSION" src` מחזיר אפס תוצאות מחוץ ל-`node_modules`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp/graph-version.ts src/lib/whatsapp/graph-version.test.ts src/lib/whatsapp/client.ts src/lib/whatsapp/client.test.ts src/app/api/webhooks/whatsapp/route.ts src/app/api/webhooks/whatsapp/route.test.ts
git commit -m "fix(whatsapp): one kalfa-owned Graph API version; webhook route stops warning per POST

GRAPH_API_VERSION (v24.0, env-overridable) replaces the SDK's DEFAULT_API_VERSION
in client.ts and is passed to the webhook route's WhatsAppAPI, which logged
\"Cloud API version not defined\" on every delivery (59 lines measured).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 3: שכבת התצורה — `WhatsAppConfig` מכיר את מספר הייבוא

**Files:**
- Modify: `src/lib/data/outreach-config.ts:17-23` (type), `:63-99` (reader)
- Modify: `src/lib/data/outreach-config.test.ts:49-80`
- Modify (ליטרלים שנשברים ב-`tsc`): `src/app/api/webhooks/whatsapp/route.test.ts:89-95, 233-239`, `src/app/api/campaigns/[id]/whatsapp-send/route.test.ts:71-77`, `src/lib/data/outreach.test.ts:33-39`

**Interfaces:**
- Consumes: העמודות ממשימה 1.
- Produces: `WhatsAppConfig` = `{ phoneNumberId: string; wabaId: string | null; accessToken: string; appSecret: string | null; verifyToken: string | null; importPhoneNumberId: string | null; importDisplayNumber: string | null }`. `WhatsAppConfig` מקיים מבנית את `WhatsAppSender` ואת `ChannelNumbers` ממשימה 2.

- [ ] **Step 1: הבדיקות הנכשלות** — להחליף את ה-`describe('getWhatsAppConfig')` ב-`outreach-config.test.ts:49-80` ב:

```ts
describe('getWhatsAppConfig', () => {
  it('returns the config when phone-number-id and token are present (import fields null when absent)', async () => {
    mockAdmin({
      data: {
        whatsapp_phone_number_id: 'PNID',
        whatsapp_access_token: 'TKN',
        whatsapp_app_secret: 'SEC',
        whatsapp_verify_token: 'VT',
      },
      error: null,
    });
    await expect(getWhatsAppConfig()).resolves.toEqual({
      phoneNumberId: 'PNID',
      wabaId: null,
      accessToken: 'TKN',
      appSecret: 'SEC',
      verifyToken: 'VT',
      importPhoneNumberId: null,
      importDisplayNumber: null,
    });
  });
  it('carries the import number + display number when set', async () => {
    mockAdmin({
      data: {
        whatsapp_phone_number_id: 'PNID',
        whatsapp_access_token: 'TKN',
        whatsapp_import_phone_number_id: 'IMP',
        whatsapp_import_display_number: '+972 3-330-1505',
      },
      error: null,
    });
    await expect(getWhatsAppConfig()).resolves.toMatchObject({
      importPhoneNumberId: 'IMP',
      importDisplayNumber: '+972 3-330-1505',
    });
  });
  it('treats an empty/whitespace import field as NOT configured (legacy routing)', async () => {
    mockAdmin({
      data: {
        whatsapp_phone_number_id: 'PNID',
        whatsapp_access_token: 'TKN',
        whatsapp_import_phone_number_id: '   ',
        whatsapp_import_display_number: '',
      },
      error: null,
    });
    await expect(getWhatsAppConfig()).resolves.toMatchObject({
      importPhoneNumberId: null,
      importDisplayNumber: null,
    });
  });
  it('null when the phone-number-id is missing', async () => {
    mockAdmin({ data: { whatsapp_access_token: 'TKN' }, error: null });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
  it('null when the token is missing', async () => {
    mockAdmin({ data: { whatsapp_phone_number_id: 'PNID' }, error: null });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
  it('null on error / pre-migration', async () => {
    mockAdmin({ data: null, error: { message: 'x' } });
    await expect(getWhatsAppConfig()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/data/outreach-config.test.ts`
Expected: FAIL ב-3 הבדיקות הראשונות (`importPhoneNumberId` חסר / undefined).

- [ ] **Step 3: המימוש** — ב-`outreach-config.ts`:

להחליף את שורות 17-23:
```ts
export type WhatsAppConfig = {
  phoneNumberId: string; // the RSVP outreach number — every campaign/thankyou/headcount send
  wabaId: string | null; // WhatsApp Business Account id — template CRUD node
  accessToken: string;
  appSecret: string | null; // only needed to verify inbound webhooks (B2)
  verifyToken: string | null; // webhook GET challenge (B2)
  // Dedicated guest-import number (same app/WABA/token). null = split not
  // configured → legacy: the RSVP number also accepts lists and replies from
  // itself. Set → webhook-processing.ts routes inbound rows by
  // webhook_inbox.phone_number_id and whatsapp-import.ts replies from here.
  importPhoneNumberId: string | null;
  // The import number as customers see it (admin-entered, e.g. "+972 3-330-1505").
  importDisplayNumber: string | null;
};
```

להוסיף מעל `getWhatsAppConfig` (אחרי שורה 60):
```ts
// A non-empty, trimmed string or null. The admin form maps '' → null already
// (channels.ts), but the worker must not depend on that: whitespace in a
// routing key would silently turn the split off.
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
```

ולהחליף את ה-`return` בשורות 82-95:
```ts
    return {
      phoneNumberId,
      wabaId:
        typeof row.whatsapp_waba_id === 'string' ? row.whatsapp_waba_id : null,
      accessToken,
      appSecret:
        typeof row.whatsapp_app_secret === 'string'
          ? row.whatsapp_app_secret
          : null,
      verifyToken:
        typeof row.whatsapp_verify_token === 'string'
          ? row.whatsapp_verify_token
          : null,
      importPhoneNumberId: nonEmptyString(row.whatsapp_import_phone_number_id),
      importDisplayNumber: nonEmptyString(row.whatsapp_import_display_number),
    };
```

- [ ] **Step 4: לתקן את הליטרלים בבדיקות האחרות** — בכל אחד מארבעת המקומות להוסיף שתי שורות לאובייקט:

`src/app/api/webhooks/whatsapp/route.test.ts:89-95` וגם `:233-239`:
```ts
    verifyToken: null,
    importPhoneNumberId: null,
    importDisplayNumber: null,
```
`src/app/api/campaigns/[id]/whatsapp-send/route.test.ts:71-77`:
```ts
      verifyToken: 'v',
      importPhoneNumberId: null,
      importDisplayNumber: null,
```
`src/lib/data/outreach.test.ts:33-39`:
```ts
  verifyToken: null,
  importPhoneNumberId: null,
  importDisplayNumber: null,
```

- [ ] **Step 5: להריץ בדיקות + tsc**

Run: `npm test -- --run src/lib/data/outreach-config.test.ts && npx tsc --noEmit`
Expected: PASS (11 tests); `tsc` נקי. אם `tsc` מדווח על `WhatsAppConfig` בקובץ בדיקה נוסף (`headcount.test.ts`, `outreach-engine.test.ts`, `template-health-sync.test.ts`, `outreach.worker-cookies.test.ts` לא נקראו בתכנון) — להוסיף לו את אותן שתי שורות `null`. אין להשתמש ב-cast.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/outreach-config.ts src/lib/data/outreach-config.test.ts src/app/api/webhooks/whatsapp/route.test.ts "src/app/api/campaigns/[id]/whatsapp-send/route.test.ts" src/lib/data/outreach.test.ts
git commit -m "feat(whatsapp): WhatsAppConfig carries the import number and its display form

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 4: מודול הייבוא — עונה מהמספר שקיבל, ומפנה כשהגיע למספר הלא נכון

**Files:**
- Modify: `src/lib/data/whatsapp-import.ts:1-27` (imports + `InboxRow`), `:286-383` (`stageWhatsAppImport` + `safeReply`)
- Modify: `src/lib/data/whatsapp-import.test.ts:1-20, 245-261`

**Interfaces:**
- Consumes: `WhatsAppConfig` (משימה 3), `importSender`, `waMeUrl`, `WhatsAppSender` (משימה 2), `GRAPH_API_VERSION` (משימה 2b), `sendWhatsAppText(cfg, {to, body})` (`client.ts:295`), `resolveOwnerActiveEvents` (קיים, `:57`), ומה-SDK: `WhatsAppAPI#retrieveMedia(id, phoneID?)`, `WhatsAppAPI#fetchMedia(url)`, `ponyfill.fetch`.
- Produces:
  - `type InboxRow = { payload: Json | null; phone_number_id: string | null }` (פרטי — `WebhookInboxRow` מקיים אותו מבנית)
  - `stageWhatsAppImport(row: InboxRow, config: WhatsAppConfig | null): Promise<boolean>`
  - `replyImportPointer(row: InboxRow, config: WhatsAppConfig): Promise<boolean>`
  - `buildImportPointerReply(displayNumber: string | null): string | null` (טהור)
  - פרטי: `downloadDocument(mediaId: string, accessToken: string, phoneNumberId: string | null): Promise<Uint8Array | null>` — דרך ה-SDK, מוגבל למספר שקיבל, timeout 15s, תקרת 1MB כפולה (גודל מדווח + בייטים בפועל)

- [ ] **Step 1: הבדיקות הנכשלות** — להחליף את ה-`describe('stageWhatsAppImport')` בשורות 245-261 ב:

```ts
// ---------------------------------------------------------------------------
// Two-number split (2026-09-03). A from()-router double that resolves ONE
// verified owner with ONE active event, an empty staging table (no dupes) and
// a recording insert — the minimum for a reply to be composed.
function cfg(over: Partial<WhatsAppConfig> = {}): WhatsAppConfig {
  return {
    phoneNumberId: 'main-1',
    wabaId: null,
    accessToken: 'tok',
    appSecret: null,
    verifyToken: null,
    importPhoneNumberId: 'imp-1',
    importDisplayNumber: '+972 3-330-1505',
    ...over,
  };
}

function wireImportClient() {
  const inserted: unknown[] = [];
  const ok = { data: [], error: null };
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        then: (res: (v: unknown) => unknown) =>
          res({ data: [{ id: 'user-1', phone: '0501234567' }], error: null }),
      };
    }
    if (table === 'events') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (res: (v: unknown) => unknown) =>
          res({
            data: [{ id: 'evt-1', name: 'ברית של נועם', event_type: 'brit', created_at: '2026-09-01T00:00:00Z' }],
            error: null,
          }),
      };
    }
    if (table === 'organization_members') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (res: (v: unknown) => unknown) => res(ok),
      };
    }
    if (table === 'guest_import_staging') {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        insert: vi.fn((row: unknown) => {
          inserted.push(row);
          return { then: (res: (v: unknown) => unknown) => res({ error: null }) };
        }),
        then: (res: (v: unknown) => unknown) => res(ok),
      };
      return builder;
    }
    throw new Error(`unexpected table in import test: ${table}`);
  });
  vi.mocked(createAdminClient).mockReturnValue(
    { from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
  );
  return { inserted, from };
}

const CONTACTS_PAYLOAD = {
  type: 'contacts',
  from: '972501234567',
  contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972 50-123-4567' }] }],
};
const DOCUMENT_PAYLOAD = {
  type: 'document',
  from: '972501234567',
  document: { id: 'm1', filename: 'guests.csv' },
};

describe('stageWhatsAppImport', () => {
  beforeEach(() => {
    // Call counts are asserted below (createAdminClient / sendWhatsAppText):
    // the earlier describes in this file already drove both mocks.
    vi.clearAllMocks();
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
    vi.mocked(sendWhatsAppText).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.r' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('ignores non-import message types without touching the DB', async () => {
    expect(
      await stageWhatsAppImport(
        { payload: { type: 'text', from: '972501111111' } as never, phone_number_id: 'imp-1' },
        cfg(),
      ),
    ).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('ignores an import from an UNKNOWN sender (no matching owner profile)', async () => {
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await stageWhatsAppImport(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'imp-1' },
      cfg(),
    );
    expect(res).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('stages a list that reached the IMPORT number and replies FROM the import number', async () => {
    const { inserted } = wireImportClient();

    const res = await stageWhatsAppImport(
      { payload: CONTACTS_PAYLOAD as never, phone_number_id: 'imp-1' },
      cfg(),
    );

    expect(res).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ event_id: 'evt-1', source: 'whatsapp_contacts', row_count: 1 });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const [sender, message] = vi.mocked(sendWhatsAppText).mock.calls[0];
    expect(sender).toEqual({ phoneNumberId: 'imp-1', accessToken: 'tok', appSecret: null });
    expect(message.to).toBe('+972501234567');
    expect(message.body).toContain('ברית של נועם');
    expect(message.body).toContain('https://beta.kalfa.me/app/events/evt-1/guests/import/whatsapp');
  });

  it('legacy (no import number configured): still stages and replies from the RSVP number, whatever number received it', async () => {
    wireImportClient();

    const res = await stageWhatsAppImport(
      { payload: CONTACTS_PAYLOAD as never, phone_number_id: 'main-1' },
      cfg({ importPhoneNumberId: null, importDisplayNumber: null }),
    );

    expect(res).toBe(true);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][0]).toMatchObject({ phoneNumberId: 'main-1' });
  });

  it('refuses to stage a list that reached ANOTHER number once the import number is configured (no DB, no reply)', async () => {
    const res = await stageWhatsAppImport(
      { payload: CONTACTS_PAYLOAD as never, phone_number_id: 'main-1' },
      cfg(),
    );

    expect(res).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('consumes an owner list without replying when the channel is off (config null)', async () => {
    wireImportClient();
    const res = await stageWhatsAppImport(
      { payload: CONTACTS_PAYLOAD as never, phone_number_id: 'imp-1' },
      null,
    );
    expect(res).toBe(true);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe('buildImportPointerReply', () => {
  it('quotes the display number and its wa.me link', () => {
    const body = buildImportPointerReply('+972 3-330-1505');
    expect(body).toContain('+972 3-330-1505');
    expect(body).toContain('https://wa.me/97233301505');
  });

  it('is null when no display number is configured (nothing useful to say)', () => {
    expect(buildImportPointerReply(null)).toBeNull();
  });
});

describe('replyImportPointer — a list sent to the RSVP number under the hard split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendWhatsAppText).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.p' });
  });

  it('a verified owner gets ONE pointer FROM the RSVP number; nothing is staged', async () => {
    const { inserted } = wireImportClient();

    const res = await replyImportPointer(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'main-1' },
      cfg(),
    );

    expect(res).toBe(true);
    expect(inserted).toHaveLength(0);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const [sender, message] = vi.mocked(sendWhatsAppText).mock.calls[0];
    expect(sender).toMatchObject({ phoneNumberId: 'main-1' });
    expect(message.to).toBe('+972501234567');
    expect(message.body).toContain('+972 3-330-1505');
    expect(message.body).toContain('https://wa.me/97233301505');
  });

  it('a stranger gets nothing and the row is NOT consumed', async () => {
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await replyImportPointer(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'main-1' },
      cfg(),
    );
    expect(res).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('a plain text is not a list — false without touching the DB', async () => {
    const res = await replyImportPointer(
      { payload: { type: 'text', from: '972501234567' } as never, phone_number_id: 'main-1' },
      cfg(),
    );
    expect(res).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
```

ובנוסף, describe לנתיב ההורדה דרך ה-SDK (אחרי `describe('replyImportPointer …')`):

```ts
describe('downloadDocument (via stageWhatsAppImport, document payload) — SDK media path', () => {
  const CSV = new TextEncoder().encode('שם מלא,טלפון\nמשפחת כהן,0501234567\n');

  beforeEach(() => {
    vi.clearAllMocks();
    sdkCtorArgs.length = 0;
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
    vi.mocked(sendWhatsAppText).mockResolvedValue({ kind: 'accepted', providerId: 'wamid.d' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('retrieves the media SCOPED to the number that received it, fetches it through the SDK, and stages the rows', async () => {
    const { inserted } = wireImportClient();
    retrieveMedia.mockResolvedValue({
      messaging_product: 'whatsapp',
      id: 'm1',
      url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=m1',
      mime_type: 'text/plain',
      sha256: 'x',
      file_size: String(CSV.byteLength),
    });
    fetchMedia.mockResolvedValue(new Response(CSV));

    const res = await stageWhatsAppImport(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'imp-1' },
      cfg(),
    );

    expect(res).toBe(true);
    expect(retrieveMedia).toHaveBeenCalledWith('m1', 'imp-1');
    expect(fetchMedia).toHaveBeenCalledWith('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=m1');
    expect(inserted[0]).toMatchObject({ source: 'whatsapp_document', file_name: 'guests.csv', row_count: 1 });
    // The SDK client is built with kalfa's version pin and a timeout-bearing fetch.
    expect(sdkCtorArgs[0]).toMatchObject({ token: 'tok', secure: false, v: GRAPH_API_VERSION });
    expect(typeof (sdkCtorArgs[0] as { ponyfill?: { fetch?: unknown } }).ponyfill?.fetch).toBe('function');
  });

  it('refuses a file Meta reports above 1MB BEFORE fetching the body, and tells the owner', async () => {
    wireImportClient();
    retrieveMedia.mockResolvedValue({
      messaging_product: 'whatsapp',
      id: 'm1',
      url: 'https://lookaside.fbsbx.com/x',
      mime_type: 'text/plain',
      sha256: 'x',
      file_size: '1000001',
    });

    const res = await stageWhatsAppImport(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'imp-1' },
      cfg(),
    );

    expect(res).toBe(true);
    expect(fetchMedia).not.toHaveBeenCalled();
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('עד 1MB');
  });

  it('a Graph error body (media of another number, expired id) is a read failure, not a crash', async () => {
    wireImportClient();
    retrieveMedia.mockResolvedValue({
      error: { message: 'Unsupported get request', type: 'GraphMethodException', code: 100, error_data: { messaging_product: 'whatsapp', details: '' }, fbtrace_id: 't' },
    });

    const res = await stageWhatsAppImport(
      { payload: DOCUMENT_PAYLOAD as never, phone_number_id: 'imp-1' },
      cfg(),
    );

    expect(res).toBe(true);
    expect(fetchMedia).not.toHaveBeenCalled();
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('לא הצלחנו לקרוא');
  });
});
```

ולעדכן את ראש הקובץ (שורות 1-20):
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));
// Only the SDK's media transport is mocked (never a real Graph/CDN call); the
// constructor is recorded so the version pin + timeout ponyfill are asserted.
const { retrieveMedia, fetchMedia, sdkCtorArgs } = vi.hoisted(() => ({
  retrieveMedia: vi.fn(),
  fetchMedia: vi.fn(),
  sdkCtorArgs: [] as unknown[],
}));
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: class {
    constructor(args: unknown) {
      sdkCtorArgs.push(args);
    }
    retrieveMedia = retrieveMedia;
    fetchMedia = fetchMedia;
  },
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import type { WhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import { createMockSupabase } from '@/test/supabase-mock';
import {
  buildAmbiguousEventReply,
  buildImportPointerReply,
  buildSingleEventReply,
  contactsToStagedRows,
  eventImportLabel,
  parseCsvToStagedRows,
  replyImportPointer,
  resolveOwnerActiveEvents,
  resolveReplyOrigin,
  stageWhatsAppImport,
} from './whatsapp-import';
```
(השורה `vi.mock('@/lib/data/outreach-config', …)` נמחקת — המודול כבר לא מייבא את `getWhatsAppConfig`.)

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/data/whatsapp-import.test.ts`
Expected: FAIL — `buildImportPointerReply`/`replyImportPointer` אינם export; `stageWhatsAppImport` מתעלם מהארגומנט השני.

- [ ] **Step 3: המימוש** — ב-`whatsapp-import.ts`:

שורות 1-12 (imports):
```ts
import 'server-only';

import { WhatsAppAPI } from 'whatsapp-api-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { WhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import {
  importSender,
  waMeUrl,
  type WhatsAppSender,
} from '@/lib/whatsapp/channel-routing';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import { decodeCsvBuffer, parseCsv, sniffSpreadsheetBinary } from '@/lib/csv';
import { normalizePhone, repairIsraeliLocalPhone } from '@/lib/phone';
import { importRowSchema } from '@/lib/validation/guests';
import { guestImportHeaderKey } from '@/lib/data/guest-import-shared';
import { ISRAELI_PHONE_RE } from '@/lib/constants';
import { EVENT_TYPE_LABELS } from '@/lib/data/event-labels';
import type { Enums, Json } from '@/lib/supabase/types';
```

שורות 19-27 (הערת המודול + `InboxRow`):
```ts
// WhatsApp guest-import channel: a VERIFIED owner sends the business number a
// CSV document or shared contact cards → the worker parses them into PENDING
// guest_import_staging rows and replies with a review link. Guests are
// created ONLY when confirmed in the app. Unmapped senders are ignored
// entirely (no download, no reply — nothing leaks about the system).
//
// Two-number split (2026-09-03): when app_settings names a dedicated import
// number, webhook-processing.ts sends ONLY rows that arrived there to
// stageWhatsAppImport, and rows that arrived on the RSVP number to
// replyImportPointer. Replies leave from the number that received the list
// (importSender). With no import number configured everything behaves as
// before — the RSVP number stages and answers.

type InboxRow = {
  payload: Json | null;
  phone_number_id: string | null;
};

// The two import-bearing inbound shapes, with the sender already normalized.
type ImportPayload = {
  type: 'document' | 'contacts';
  from: string; // E.164
  document?: { id?: string; filename?: string };
};

// Narrow a persisted inbound payload to an import; null for every other
// message type, or when the sender phone does not normalize.
function readImportPayload(payload: Json | null): ImportPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as {
    type?: string;
    from?: string;
    document?: { id?: string; filename?: string };
  };
  const type =
    p.type === 'document' ? 'document' : p.type === 'contacts' ? 'contacts' : null;
  if (!type) return null;
  const from = typeof p.from === 'string' ? normalizePhone(p.from) : null;
  if (!from) return null;
  return { type, from, document: p.document };
}
```

להחליף את `MAX_DOC_BYTES` (שורה 36) ואת `downloadDocument` (שורות 247-267):
```ts
const MAX_DOC_BYTES = 1_000_000; // same cap as the screen upload
const MEDIA_TIMEOUT_MS = 15_000; // same budget as template-health.ts
```
```ts
// Download an owner-sent CSV through the SDK, SCOPED to the business number
// the message arrived at: Graph refuses `GET /{media-id}?phone_number_id=X`
// when the media belongs to another number, so a media id can never be
// replayed across the RSVP/import numbers. The 1MB cap is enforced twice —
// on Meta's reported size before the body is fetched, and on the real byte
// length after. Neither SDK media method takes a signal, so the timeout rides
// the fetch ponyfill (the SDK's documented hook), covering both requests.
// Same token as every other call; never logged.
async function downloadDocument(
  mediaId: string,
  accessToken: string,
  phoneNumberId: string | null,
): Promise<Uint8Array | null> {
  const api = new WhatsAppAPI({
    token: accessToken,
    secure: false,
    v: GRAPH_API_VERSION,
    ponyfill: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) }),
    },
  });
  try {
    const meta = await api.retrieveMedia(mediaId, phoneNumberId ?? undefined);
    // `url` exists only on the success branch of ServerMediaRetrieveResponse;
    // `file_size` is a STRING there (SDK typing) — compare numerically.
    if (!('url' in meta) || Number(meta.file_size) > MAX_DOC_BYTES) return null;
    const res = await api.fetchMedia(meta.url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength <= MAX_DOC_BYTES ? buf : null;
  } catch {
    return null;
  }
}
```

להוסיף אחרי `buildAmbiguousEventReply` (אחרי שורה 170):
```ts
// Pointer for a list that reached the RSVP number under the hard split: names
// the import number (from admin config — never hardcoded) with its deep link.
// null when no display number is configured — there is nothing useful to say.
export function buildImportPointerReply(displayNumber: string | null): string | null {
  if (!displayNumber) return null;
  const link = waMeUrl(displayNumber);
  return (
    `רשימות מוזמנים מתקבלות במספר הייבוא של KALFA: ${displayNumber}\n` +
    (link ? `${link}\n` : '') +
    'שלחו לשם את הקובץ או את אנשי הקשר, ותקבלו משם קישור לסקירה ולאישור.'
  );
}
```

להחליף את `stageWhatsAppImport` + `safeReply` (שורות 286-383):
```ts
// Entry point from the webhook processor. Returns true when the inbound was
// CONSUMED as an import (mapped owner + document/contacts) — the caller then
// skips the campaign/billing path entirely. `config` is passed in (not read
// here) so the router reads app_settings once per message and stays the single
// place that decides which number handles what.
export async function stageWhatsAppImport(
  row: InboxRow,
  config: WhatsAppConfig | null,
): Promise<boolean> {
  const p = readImportPayload(row.payload);
  if (!p) return false;

  // Belt-and-braces for the split: once an import number exists, a list that
  // arrived on any OTHER number is never staged from here. webhook-processing
  // is the primary gate; this keeps the module safe against a future caller.
  if (config?.importPhoneNumberId && row.phone_number_id !== config.importPhoneNumberId) {
    return false;
  }

  const sender = p.from;
  const events = await resolveOwnerActiveEvents(sender);
  if (events.length === 0) return false; // stranger → silently not-an-import

  if (!config) return true; // consumed (owner intent) but channel off

  // Replies leave from the number that received the list: the import number
  // when configured, the RSVP number in legacy mode. Same token either way.
  const from = importSender(config);
  const origin = resolveReplyOrigin();

  // More than one active event the sender may manage: NEVER guess which one
  // (misroute incident 2026-07-06 — a brit guest list landed on a newer active
  // event because "newest wins"). Stage nothing; ask the owner to upload the
  // file on the correct event's import screen.
  if (events.length > 1) {
    await safeReply(from, sender, buildAmbiguousEventReply(events, origin));
    return true;
  }

  const ownerEvent = events[0];

  let staged: StagedRow[] = [];
  let errors: Array<{ row: number; message: string }> = [];
  let fileName: string | null = null;

  if (p.type === 'document') {
    fileName = p.document?.filename ?? null;
    const mediaId = p.document?.id;
    // Scoped to the number that received the file (row.phone_number_id) —
    // the import number under the split, the RSVP number in legacy mode.
    const bytes = mediaId
      ? await downloadDocument(mediaId, config.accessToken, row.phone_number_id)
      : null;
    if (!bytes) {
      await safeReply(from, sender, 'לא הצלחנו לקרוא את הקובץ (עד 1MB, CSV בלבד). נסו לשלוח שוב.');
      return true;
    }
    const parsed = parseCsvToStagedRows(bytes);
    if ('error' in parsed) {
      await safeReply(from, sender, parsed.error);
      return true;
    }
    staged = parsed.rows;
    errors = parsed.errors;
  } else {
    staged = contactsToStagedRows(row.payload);
    if (staged.length === 0) return true;
  }

  const admin = createAdminClient();
  // Retry-safe: identical pending content from the same sender is the same
  // inbox message being retried — reply with the link again, insert nothing.
  const { data: dupes } = await admin
    .from('guest_import_staging')
    .select('id, rows')
    .eq('event_id', ownerEvent.id)
    .eq('sender_phone', sender)
    .eq('status', 'pending');
  const stagedJson = JSON.stringify(staged);
  const isDupe = (dupes ?? []).some((d) => JSON.stringify(d.rows) === stagedJson);
  const { error } = isDupe
    ? { error: null }
    : await admin.from('guest_import_staging').insert({
    event_id: ownerEvent.id,
    source: p.type === 'document' ? 'whatsapp_document' : 'whatsapp_contacts',
    sender_phone: sender,
    file_name: fileName,
    rows: staged as unknown as Json,
    row_count: staged.length,
    error_rows: errors as unknown as Json,
  });
  if (error) {
    await safeReply(from, sender, 'קליטת הרשימה נכשלה — נסו שוב בעוד רגע.');
    return true;
  }

  await safeReply(
    from,
    sender,
    buildSingleEventReply(ownerEvent, staged.length, errors.length, origin),
  );
  return true;
}

// Hard-split companion to stageWhatsAppImport: a VERIFIED owner sent a list to
// the RSVP number after the dedicated import number was configured. Nothing is
// staged; the owner gets ONE pointer FROM the RSVP number — a free-form reply
// inside the 24h window the owner just opened (no template, no marketing
// content). Strangers get nothing (same rule as staging). Returns true when
// the inbound was consumed (an import-shaped message from a mapped owner) so
// the caller skips the campaign/billing path.
export async function replyImportPointer(
  row: InboxRow,
  config: WhatsAppConfig,
): Promise<boolean> {
  const p = readImportPayload(row.payload);
  if (!p) return false;
  const events = await resolveOwnerActiveEvents(p.from);
  if (events.length === 0) return false;
  const body = buildImportPointerReply(config.importDisplayNumber);
  if (body) await safeReply(config, p.from, body);
  return true;
}

async function safeReply(
  from: WhatsAppSender,
  to: string,
  body: string,
): Promise<void> {
  // replies are best-effort — sendWhatsAppText no longer throws (it classifies
  // into a DeliveryOutcome); the result is intentionally ignored here.
  await sendWhatsAppText(from, { to, body });
}
```

- [ ] **Step 4: להריץ**

Run: `npm test -- --run src/lib/data/whatsapp-import.test.ts && npx tsc --noEmit`
Expected: PASS (הבדיקות הישנות + 14 חדשות). `tsc` ידווח שגיאה אחת ב-`webhook-processing.ts:189` (`stageWhatsAppImport(row)` — ארגומנט חסר) — היא נסגרת במשימה 5. אם רוצים commit ירוק: לבצע את משימות 4 ו-5 באותו commit. `grep -n "graph.facebook.com" src/lib/data/whatsapp-import.ts` חייב להחזיר אפס — אין יותר `fetch` גולמי במודול.

- [ ] **Step 5: Commit** (יחד עם משימה 5, ראה שם)

---

### Task 5: הניתוב ב-`processMessage`

**Files:**
- Modify: `src/lib/data/webhook-processing.ts:1-51` (imports), `:171-192` (ראש `processMessage`)
- Modify: `src/lib/data/webhook-processing.test.ts:1-100` (mocks) + describe חדש

**Interfaces:**
- Consumes: `getWhatsAppConfig` (משימה 3), `classifyInboundChannel` (משימה 2), `stageWhatsAppImport(row, config)` ו-`replyImportPointer(row, config)` (משימה 4), `sendSlackAlert` (כבר מיובא, שורה 42).
- Produces: התנהגות בלבד; אין ממשק חדש.

- [ ] **Step 1: הבדיקות הנכשלות** — ב-`webhook-processing.test.ts`:

להוסיף אחרי שורה 20 (mocks):
```ts
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/data/whatsapp-import', () => ({
  stageWhatsAppImport: vi.fn(async () => false),
  replyImportPointer: vi.fn(async () => false),
}));
```
להוסיף לייבואים (אחרי שורה 36):
```ts
import { getWhatsAppConfig, type WhatsAppConfig } from '@/lib/data/outreach-config';
import { replyImportPointer, stageWhatsAppImport } from '@/lib/data/whatsapp-import';
```
להוסיף ב-`beforeEach` (אחרי שורה 77 `vi.clearAllMocks();`):
```ts
  // Legacy by default: no import number → every existing test keeps today's path.
  vi.mocked(getWhatsAppConfig).mockResolvedValue(null);
  vi.mocked(stageWhatsAppImport).mockResolvedValue(false);
  vi.mocked(replyImportPointer).mockResolvedValue(false);
```
ולהוסיף describe חדש לפני `describe('processWebhookEvent — status'` (שורה 379):
```ts
// ---------------------------------------------------------------------------
// Two-number split: the row's phone_number_id decides the path.
const SPLIT: WhatsAppConfig = {
  phoneNumberId: 'p1',
  wabaId: null,
  accessToken: 't',
  appSecret: null,
  verifyToken: null,
  importPhoneNumberId: 'imp-1',
  importDisplayNumber: '+972 3-330-1505',
};

describe('processWebhookEvent — routing by phone_number_id', () => {
  it('legacy (no import number): the importer is offered every inbound first, then billing runs as before', async () => {
    await processWebhookEvent(messageRow());

    expect(stageWhatsAppImport).toHaveBeenCalledTimes(1);
    expect(stageWhatsAppImport).toHaveBeenCalledWith(expect.objectContaining({ id: 'row-1' }), null);
    expect(replyImportPointer).not.toHaveBeenCalled();
    expect(recordReached).toHaveBeenCalledTimes(1);
  });

  it('IMPORT number: only the importer runs — even for a billable RSVP button tap', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);
    vi.mocked(stageWhatsAppImport).mockResolvedValue(true);

    await processWebhookEvent(
      messageRow({
        phone_number_id: 'imp-1',
        payload: { type: 'button', from: '972501234567', button: { payload: 'rsvp_attending' } },
      }),
    );

    expect(stageWhatsAppImport).toHaveBeenCalledWith(expect.objectContaining({ phone_number_id: 'imp-1' }), SPLIT);
    expect(replyImportPointer).not.toHaveBeenCalled();
    expect(resolveByContextId).not.toHaveBeenCalled();
    expect(resolveInboundContact).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('IMPORT number: free text the importer declines is simply dropped — no interaction, no billing', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);

    await processWebhookEvent(
      messageRow({ phone_number_id: 'imp-1', payload: { type: 'text', from: '972501234567', text: { body: 'שלום' } } }),
    );

    expect(stageWhatsAppImport).toHaveBeenCalledTimes(1);
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
  });

  it('RSVP number under the split: a list is NOT staged; a mapped owner gets the pointer and the row is consumed', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);
    vi.mocked(replyImportPointer).mockResolvedValue(true);

    await processWebhookEvent(
      messageRow({ payload: { type: 'document', from: '972501234567', document: { id: 'm1' } } }),
    );

    expect(replyImportPointer).toHaveBeenCalledWith(expect.objectContaining({ phone_number_id: 'p1' }), SPLIT);
    expect(stageWhatsAppImport).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(recordReached).not.toHaveBeenCalled();
  });

  it('RSVP number under the split: a normal reply bills exactly as before (and the importer is never consulted)', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);

    await processWebhookEvent(messageRow());

    expect(stageWhatsAppImport).not.toHaveBeenCalled();
    expect(replyImportPointer).toHaveBeenCalledTimes(1);
    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'k1', evidence: 'whatsapp_inbound_message' }),
    );
  });

  it('NULL phone_number_id under the split: treated as the RSVP number (rows without metadata)', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);

    await processWebhookEvent(messageRow({ phone_number_id: null }));

    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('UNKNOWN number under the split: nothing runs, one ids-only alert, no phone in it', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue(SPLIT);

    await processWebhookEvent(
      messageRow({ phone_number_id: '123456123', payload: { type: 'text', from: '972501234567', text: { body: 'הסר' } } }),
    );

    expect(stageWhatsAppImport).not.toHaveBeenCalled();
    expect(replyImportPointer).not.toHaveBeenCalled();
    expect(resolveByContextId).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert.fields).toMatchObject({ rowId: 'row-1', phoneNumberId: '123456123' });
    expect(JSON.stringify(alert)).not.toContain('972501234567');
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/data/webhook-processing.test.ts`
Expected: FAIL — הבדיקות החדשות (הקוד עדיין קורא `stageWhatsAppImport(row)` על כל הודעה ואינו קורא `getWhatsAppConfig`).

- [ ] **Step 3: המימוש** — ב-`webhook-processing.ts`:

להוסיף לייבואים (ליד שורות 44-46):
```ts
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { classifyInboundChannel } from '@/lib/whatsapp/channel-routing';
import { replyImportPointer, stageWhatsAppImport } from '@/lib/data/whatsapp-import';
```
(ולמחוק את השורה הקיימת `import { stageWhatsAppImport } from '@/lib/data/whatsapp-import';`.)

להחליף את שורות 171-192 (הערת `processMessage` + הראש שלה עד `classifyMessagePayload`):
```ts
// An inbound human message. FIRST the row is routed by the business number it
// arrived at (webhook_inbox.phone_number_id): the dedicated import number goes
// ONLY to the guest-list importer; the RSVP number (or a legacy row with no
// metadata) goes to the billing/RSVP path below; anything else is ignored with
// an ids-only alert. With no import number configured (legacy) every row takes
// the RSVP path and the importer is offered every message first — today's
// behaviour, unchanged.
//
// On the RSVP path this bills the reach when it is a billable type AND it
// resolves to a contact we targeted. Resolution prefers the precise Meta
// context.id binding (the reply quotes the exact outbound wamid we sent); it
// falls back to the sender phone when the reply carries no context — a plain
// typed-in reply (the common "כן אגיע" / "הסר" case, not a swipe/button) — so a
// billable reach AND any opt-out it carries are never silently dropped (this
// restores the pre-rework billing surface; the context.id path adds precision on
// top of it). Double-bill-safe either way: insertInteraction's
// UNIQUE(channel, provider_id) on this inbound message_id + the `fresh` gate bill
// at most once. Only when NEITHER context nor phone resolves is it recorded
// processed without billing.
async function processMessage(row: WebhookInboxRow): Promise<void> {
  const messageId = row.message_id;
  if (!messageId) return;

  const payload = (row.payload ?? {}) as InboundMessagePayload;
  const config = await getWhatsAppConfig();
  const channel = classifyInboundChannel(row.phone_number_id, config);

  if (channel === 'import') {
    // Dedicated import number: an owner's CSV / contact cards → staging + a
    // reply from that number. Anything else sent there (free text, reactions,
    // button taps) is deliberately dropped: no interaction, no billing, no
    // RSVP, no headcount — that number never sends outreach, so nothing on it
    // is a reply to us.
    await stageWhatsAppImport(row, config);
    return;
  }

  if (channel === 'unknown') {
    // Neither configured number. Never bill on it; say so once (ids only — a
    // phone_number_id is a technical Meta id, not a guest phone).
    await sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'webhook-processing',
      title: 'הודעת WhatsApp נכנסת ממספר עסקי לא מוגדר — לא עובדה',
      detail:
        'webhook_inbox.phone_number_id אינו מספר ה-RSVP ואינו מספר הייבוא שב-/admin/channels. השורה סומנה כמעובדת בלי אינטראקציה, חיוב או RSVP. אם המספר שלנו — לתקן את המזהים ב-/admin/channels ולעבד מחדש מ-/admin/webhooks.',
      fields: { rowId: row.id, phoneNumberId: row.phone_number_id ?? 'null' },
    });
    return;
  }

  // channel === 'rsvp'
  if (config?.importPhoneNumberId) {
    // Hard split: the RSVP number no longer stages lists. A verified owner who
    // still sends one here gets a one-line pointer to the import number.
    if (await replyImportPointer(row, config)) return;
  } else if (await stageWhatsAppImport(row, config)) {
    // Legacy: owner-sent guest lists are an IMPORT, not a campaign interaction
    // — consumed before any billing logic.
    return;
  }

  const { billable, removal, replyId } = classifyMessagePayload(payload);
  if (!billable) return;
```
(השאר — מ-`const contextId = row.context_message_id;` ואילך — ללא שינוי.)

- [ ] **Step 4: להריץ**

Run: `npm test -- --run src/lib/data/webhook-processing.test.ts src/lib/data/whatsapp-import.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS (כל הבדיקות הקיימות + 7 חדשות); `tsc` ו-`lint` נקיים.

- [ ] **Step 5: לוודא שהחבילה של ה-worker עדיין נבנית ולא נוגעת ב-Next**

Run: `npm run worker:deps && npm run worker:build`
Expected: `depcruise` בלי הפרות; `check-worker-bundle: dist/worker.cjs ok`. (`channel-routing.ts` מייבא רק `@/lib/phone` — טהור.)

- [ ] **Step 6: Commit (משימות 4+5)**

```bash
git add src/lib/data/whatsapp-import.ts src/lib/data/whatsapp-import.test.ts src/lib/data/webhook-processing.ts src/lib/data/webhook-processing.test.ts
git commit -m "feat(whatsapp): route inbound by the business number that received it

Import number → staging only, replies from the import number. RSVP number →
billing/RSVP path; under the split a list sent there gets a pointer instead
of being staged. Unknown number → ignored with an ids-only alert. No import
number configured → today's behaviour, unchanged. CSV download now goes
through the SDK (retrieveMedia scoped to the receiving number + fetchMedia)
with a 15s timeout; the 1MB cap is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 6: אדמין — DAL, Server Actions, ולידציה

**Files:**
- Modify: `src/lib/data/admin/channels.ts` (כל הקובץ, 113 שורות)
- Modify: `src/app/(admin)/admin/channels/actions.ts:1-79`
- Modify: `src/app/(admin)/admin/channels/actions.test.ts:8-11, 31, 38-43, 57-83`

**Interfaces:**
- Consumes: `isValidPhone`, `normalizePhone` (`src/lib/phone.ts`), `requirePlatformPermission('manage_settings')`.
- Produces:
  - `WhatsAppChannelConfig` + `whatsapp_import_phone_number_id: string`, `whatsapp_import_display_number: string`, `importConfigured: boolean`
  - `UpdateWhatsAppChannelInput` + שני השדות
  - `testWhatsAppImportConnection(): Promise<ConnectionTestResult>`
  - `testWhatsAppImportConnectionAction(prev: FormState, fd: FormData): Promise<FormState>`

- [ ] **Step 1: בדיקות נכשלות** — ב-`actions.test.ts`:

שורות 8-11 (mock ה-DAL):
```ts
vi.mock('@/lib/data/admin/channels', () => ({
  updateWhatsAppChannelConfig: vi.fn(),
  testWhatsAppConnection: vi.fn(),
  testWhatsAppImportConnection: vi.fn(),
}));
```
שורה 31 + 38-43 (ייבואים):
```ts
import { updateWhatsAppChannelConfig, testWhatsAppImportConnection } from '@/lib/data/admin/channels';
import {
  updateWhatsAppChannelAction,
  testWhatsAppImportConnectionAction,
  updateVoximplantLiveCallsAction,
  updateCallConsentRequiredAction,
  updateChannelCatalogAction,
} from './actions';
```
שורות 57-63 (`FIELDS`):
```ts
const FIELDS = {
  whatsapp_phone_number_id: '',
  whatsapp_waba_id: '',
  whatsapp_access_token: '',
  whatsapp_app_secret: '',
  whatsapp_verify_token: '',
  whatsapp_import_phone_number_id: '',
  whatsapp_import_display_number: '',
};
```
describe חדש אחרי שורה 83:
```ts
describe('updateWhatsAppChannelAction — dedicated import number', () => {
  const BASE = { ...FIELDS, whatsapp_phone_number_id: '1018741517998430', whatsapp_access_token: 'tok' };

  it('saves both import fields together, trimmed', async () => {
    const result = await updateWhatsAppChannelAction(
      null,
      fd({
        ...BASE,
        whatsapp_import_phone_number_id: ' 1298694319994421 ',
        whatsapp_import_display_number: ' +972 3-330-1505 ',
      }),
    );

    expect(updateWhatsAppChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsapp_import_phone_number_id: '1298694319994421',
        whatsapp_import_display_number: '+972 3-330-1505',
      }),
    );
    expect(result?.notice).toBeTruthy();
  });

  it('saves with both import fields empty (legacy routing)', async () => {
    await updateWhatsAppChannelAction(null, fd(BASE));
    expect(updateWhatsAppChannelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsapp_import_phone_number_id: '',
        whatsapp_import_display_number: '',
      }),
    );
  });

  it('rejects an import id WITHOUT a display number, and does NOT write', async () => {
    const result = await updateWhatsAppChannelAction(
      null,
      fd({ ...BASE, whatsapp_import_phone_number_id: '1298694319994421' }),
    );
    expect(result?.fieldErrors?.whatsapp_import_display_number).toBeTruthy();
    expect(updateWhatsAppChannelConfig).not.toHaveBeenCalled();
  });

  it('rejects a display number WITHOUT an import id', async () => {
    const result = await updateWhatsAppChannelAction(
      null,
      fd({ ...BASE, whatsapp_import_display_number: '+972 3-330-1505' }),
    );
    expect(result?.fieldErrors?.whatsapp_import_phone_number_id).toBeTruthy();
    expect(updateWhatsAppChannelConfig).not.toHaveBeenCalled();
  });

  it('rejects a display number that is not a dialable phone', async () => {
    const result = await updateWhatsAppChannelAction(
      null,
      fd({ ...BASE, whatsapp_import_phone_number_id: '1298694319994421', whatsapp_import_display_number: 'call us' }),
    );
    expect(result?.fieldErrors?.whatsapp_import_display_number).toBeTruthy();
    expect(updateWhatsAppChannelConfig).not.toHaveBeenCalled();
  });

  it('rejects an import id equal to the RSVP id (one number cannot be both)', async () => {
    const result = await updateWhatsAppChannelAction(
      null,
      fd({ ...BASE, whatsapp_import_phone_number_id: '1018741517998430', whatsapp_import_display_number: '+972 3-721-9347' }),
    );
    expect(result?.fieldErrors?.whatsapp_import_phone_number_id).toBeTruthy();
    expect(updateWhatsAppChannelConfig).not.toHaveBeenCalled();
  });
});

describe('testWhatsAppImportConnectionAction', () => {
  it('maps ok → notice and failure → error', async () => {
    vi.mocked(testWhatsAppImportConnection).mockResolvedValueOnce({ ok: true, message: 'מחובר (+972 3-330-1505)' });
    expect(await testWhatsAppImportConnectionAction(null, fd({}))).toEqual({ notice: 'מחובר (+972 3-330-1505)' });

    vi.mocked(testWhatsAppImportConnection).mockResolvedValueOnce({ ok: false, message: 'לא הוגדר מספר ייבוא' });
    expect(await testWhatsAppImportConnectionAction(null, fd({}))).toEqual({ error: 'לא הוגדר מספר ייבוא' });
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(testWhatsAppImportConnection).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(testWhatsAppImportConnectionAction(null, fd({}))).rejects.toBe(NEXT_REDIRECT);
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run "src/app/(admin)/admin/channels/actions.test.ts"`
Expected: FAIL — `testWhatsAppImportConnectionAction` אינו export; שדות הייבוא לא מגיעים ל-DAL; הזיווג לא נאכף.

- [ ] **Step 3: המימוש ב-`channels.ts`** — להחליף את הקובץ כולו:

```ts
import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { normalizePhone } from '@/lib/phone';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// Admin: guest-OUTREACH provider config (WhatsApp Cloud API; Voximplant ships
// with C2). Stored on the app_settings singleton (admin-only RLS). Secrets
// (access token, app secret) are returned to the admin form shown masked with a
// reveal toggle — the same gateway-plugin pattern as the SUMIT/SMTP keys in
// settings.ts. They are sent ONLY to this requireAdmin HTTPS page and never
// logged. `outreach_enabled` is the shared master switch for all channels.
//
// Two numbers, one credential set: the RSVP outreach number
// (whatsapp_phone_number_id) and the OPTIONAL dedicated guest-import number
// (whatsapp_import_phone_number_id + its display form). Both live under the
// same Meta app and WABA, so the token, app secret and verify token are shared.

export type WhatsAppChannelConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string; // '' when unset (form-friendly)
  whatsapp_waba_id: string; // '' when unset — WABA id (template CRUD node, not secret)
  whatsapp_access_token: string; // '' when unset — permanent System-User token
  whatsapp_app_secret: string; // '' when unset — webhook X-Hub-Signature-256
  whatsapp_verify_token: string; // '' when unset — webhook GET challenge
  whatsapp_import_phone_number_id: string; // '' when unset — dedicated import number (routing key)
  whatsapp_import_display_number: string; // '' when unset — the import number as customers see it
  configured: boolean; // derived: the minimum to send (phone id + token)
  importConfigured: boolean; // derived: the split is on (import id + display number)
};

const SETTINGS_ID = true;

export async function getWhatsAppChannelConfig(): Promise<WhatsAppChannelConfig> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'outreach_enabled, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_app_secret, whatsapp_verify_token, whatsapp_import_phone_number_id, whatsapp_import_display_number',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות הערוץ נכשלה');

  const phoneNumberId = data?.whatsapp_phone_number_id ?? '';
  const accessToken = data?.whatsapp_access_token ?? '';
  const importPhoneNumberId = data?.whatsapp_import_phone_number_id ?? '';
  const importDisplayNumber = data?.whatsapp_import_display_number ?? '';
  return {
    outreach_enabled: data?.outreach_enabled ?? false,
    whatsapp_phone_number_id: phoneNumberId,
    whatsapp_waba_id: data?.whatsapp_waba_id ?? '',
    whatsapp_access_token: accessToken,
    whatsapp_app_secret: data?.whatsapp_app_secret ?? '',
    whatsapp_verify_token: data?.whatsapp_verify_token ?? '',
    whatsapp_import_phone_number_id: importPhoneNumberId,
    whatsapp_import_display_number: importDisplayNumber,
    configured: !!phoneNumberId && !!accessToken,
    importConfigured: !!importPhoneNumberId && !!importDisplayNumber,
  };
}

export type UpdateWhatsAppChannelInput = {
  // NOTE: no `outreach_enabled` here — the shared global master switch is written
  // ONLY by the hoisted outreach-master action, never by this channel DAL.
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  whatsapp_import_phone_number_id: string;
  whatsapp_import_display_number: string;
};

export async function updateWhatsAppChannelConfig(
  input: UpdateWhatsAppChannelInput,
): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      whatsapp_phone_number_id: input.whatsapp_phone_number_id || null,
      whatsapp_waba_id: input.whatsapp_waba_id || null,
      whatsapp_access_token: input.whatsapp_access_token || null,
      whatsapp_app_secret: input.whatsapp_app_secret || null,
      whatsapp_verify_token: input.whatsapp_verify_token || null,
      whatsapp_import_phone_number_id: input.whatsapp_import_phone_number_id || null,
      whatsapp_import_display_number: input.whatsapp_import_display_number || null,
    })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון הגדרות הערוץ נכשל');
}

export type ConnectionTestResult = { ok: boolean; message: string };

// Read-only credential check shared by both numbers: GET the phone number's
// display number via the Graph API (a phone-number node — the SDK has no
// method for it, so this stays a raw fetch on kalfa's own version pin).
// Validates token + phone id WITHOUT sending a message. Never logs the token;
// returns a privacy-safe message plus Meta's own display form so the import
// wrapper can compare it to the admin's entry.
async function probePhoneNumber(
  phoneNumberId: string,
  accessToken: string,
): Promise<ConnectionTestResult & { displayPhoneNumber: string | null }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        phoneNumberId,
      )}?fields=display_phone_number,verified_name`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      display_phone_number?: string;
      error?: { message?: string };
    } | null;
    if (!res.ok || !body || body.error) {
      return { ok: false, message: 'החיבור נכשל — בדקו את הטוקן והמזהה', displayPhoneNumber: null };
    }
    const display = body.display_phone_number ?? null;
    return {
      ok: true,
      message: `מחובר${display ? ` (${display})` : ''}`,
      displayPhoneNumber: display,
    };
  } catch {
    return { ok: false, message: 'שגיאת תקשורת מול Meta', displayPhoneNumber: null };
  }
}

export async function testWhatsAppConnection(): Promise<ConnectionTestResult> {
  await requirePlatformPermission('manage_settings');
  const cfg = await getWhatsAppChannelConfig();
  if (!cfg.configured) {
    return { ok: false, message: 'חסרים מזהה מספר או טוקן' };
  }
  const { ok, message } = await probePhoneNumber(cfg.whatsapp_phone_number_id, cfg.whatsapp_access_token);
  return { ok, message };
}

// Same probe against the IMPORT number with the SAME token (one System-User
// covers every number in the WABA). Also compares Meta's display form with the
// admin-entered one, so a typo in what customers are told to dial is visible
// here rather than on a customer screen.
export async function testWhatsAppImportConnection(): Promise<ConnectionTestResult> {
  await requirePlatformPermission('manage_settings');
  const cfg = await getWhatsAppChannelConfig();
  if (!cfg.whatsapp_import_phone_number_id) {
    return { ok: false, message: 'לא הוגדר מספר ייבוא' };
  }
  if (!cfg.whatsapp_access_token) {
    return { ok: false, message: 'חסר טוקן' };
  }
  const probe = await probePhoneNumber(cfg.whatsapp_import_phone_number_id, cfg.whatsapp_access_token);
  if (!probe.ok) return { ok: false, message: probe.message };
  const meta = probe.displayPhoneNumber ? normalizePhone(probe.displayPhoneNumber) : null;
  const entered = normalizePhone(cfg.whatsapp_import_display_number);
  if (meta && entered && meta !== entered) {
    return {
      ok: true,
      message: `${probe.message} — שימו לב: המספר לתצוגה שהוזן (${cfg.whatsapp_import_display_number}) שונה מהמספר ש-Meta מחזירה`,
    };
  }
  return { ok: true, message: probe.message };
}
```

- [ ] **Step 4: המימוש ב-`actions.ts`** — שורות 1-79:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  updateWhatsAppChannelConfig,
  testWhatsAppConnection,
  testWhatsAppImportConnection,
} from '@/lib/data/admin/channels';
import { isValidPhone } from '@/lib/phone';
```
(שאר הייבואים הקיימים בשורות 11-26 ללא שינוי.)

```ts
// Form-friendly: every field is an optional string; the master toggle is a
// checkbox. Trimmed; '' is an intentional unset (mapped to null in the DAL).
const whatsappChannelSchema = z
  .object({
    whatsapp_phone_number_id: z.string().trim().max(64).default(''),
    whatsapp_waba_id: z.string().trim().max(64).default(''),
    whatsapp_access_token: z.string().trim().max(512).default(''),
    whatsapp_app_secret: z.string().trim().max(256).default(''),
    whatsapp_verify_token: z.string().trim().max(256).default(''),
    whatsapp_import_phone_number_id: z.string().trim().max(64).default(''),
    whatsapp_import_display_number: z
      .string()
      .trim()
      .max(32)
      .refine((v) => v === '' || isValidPhone(v), 'מספר טלפון לא תקין')
      .default(''),
  })
  .superRefine((val, ctx) => {
    // The import number is all-or-nothing: routing needs the id, the customer
    // screens and the pointer reply need the display number. One without the
    // other is a half-configured channel that silently does half the job.
    const hasId = val.whatsapp_import_phone_number_id !== '';
    const hasDisplay = val.whatsapp_import_display_number !== '';
    if (hasId !== hasDisplay) {
      ctx.addIssue({
        code: 'custom',
        path: [hasId ? 'whatsapp_import_display_number' : 'whatsapp_import_phone_number_id'],
        message: 'מזהה מספר הייבוא והמספר לתצוגה חייבים להיות מוגדרים יחד (או שניהם ריקים)',
      });
    }
    if (hasId && val.whatsapp_import_phone_number_id === val.whatsapp_phone_number_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['whatsapp_import_phone_number_id'],
        message: 'מספר הייבוא חייב להיות שונה ממספר ה-RSVP',
      });
    }
  });

export async function updateWhatsAppChannelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = whatsappChannelSchema.safeParse({
    whatsapp_phone_number_id: formData.get('whatsapp_phone_number_id') ?? '',
    whatsapp_waba_id: formData.get('whatsapp_waba_id') ?? '',
    whatsapp_access_token: formData.get('whatsapp_access_token') ?? '',
    whatsapp_app_secret: formData.get('whatsapp_app_secret') ?? '',
    whatsapp_verify_token: formData.get('whatsapp_verify_token') ?? '',
    whatsapp_import_phone_number_id: formData.get('whatsapp_import_phone_number_id') ?? '',
    whatsapp_import_display_number: formData.get('whatsapp_import_display_number') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // This form only persists WhatsApp config. The global outreach switch is owned
  // solely by updateOutreachMasterSwitchAction — this action no longer reads or
  // writes `outreach_enabled` (dropping it here + from the DAL SET prevents every
  // WhatsApp save from clobbering the shared switch to false).
  try {
    await updateWhatsAppChannelConfig(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/channels');
  return { notice: 'הגדרות הערוץ נשמרו' };
}

export async function testWhatsAppConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const r = await testWhatsAppConnection();
    return r.ok ? { notice: r.message } : { error: r.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'בדיקת החיבור נכשלה' };
  }
}

export async function testWhatsAppImportConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const r = await testWhatsAppImportConnection();
    return r.ok ? { notice: r.message } : { error: r.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'בדיקת החיבור למספר הייבוא נכשלה' };
  }
}
```

- [ ] **Step 5: להריץ**

Run: `npm test -- --run "src/app/(admin)/admin/channels/actions.test.ts" && npx tsc --noEmit`
Expected: PASS (הישנות + 8 חדשות). `tsc` ידווח על `channels-client.tsx` (ה-type המקומי `WhatsAppConfig` בשורות 37-45 לא כולל את השדות החדשים והוא מקבל את `getWhatsAppChannelConfig()`) — נסגר במשימה 7. commit יחד עם 7.

---

### Task 7: אדמין — הטופס ב-`/admin/channels`

**Files:**
- Modify: `src/app/(admin)/admin/channels/channels-client.tsx:25-45` (imports + type), `:73-108` (`Field`), `:252-300` (hooks), `:376-409` (אקורדיון + כפתור בדיקה)

**Interfaces:**
- Consumes: `testWhatsAppImportConnectionAction` (משימה 6), `WhatsAppChannelConfig` עם השדות החדשים.
- Produces: UI בלבד.

- [ ] **Step 1: ייבוא ה-action וה-type**

שורות 25-35:
```ts
import {
  updateWhatsAppChannelAction,
  testWhatsAppConnectionAction,
  testWhatsAppImportConnectionAction,
  updateVoximplantChannelAction,
  testVoximplantConnectionAction,
  updateOutreachMasterSwitchAction,
  updateVoximplantLiveCallsAction,
  updateCallConsentRequiredAction,
  updateMeetingConfirmChannelAction,
  updateSalesCallChannelAction,
} from './actions';
```
שורות 37-45:
```ts
type WhatsAppConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  whatsapp_import_phone_number_id: string;
  whatsapp_import_display_number: string;
  configured: boolean;
  importConfigured: boolean;
};
```

- [ ] **Step 2: `Field` מקבל `dir`** — שורות 73-108:

```tsx
function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  help,
  errors,
  dir,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  help?: string;
  errors?: string[];
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>
      <input
        id={name}
        name={name}
        dir={dir}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}
```

- [ ] **Step 3: hook לבדיקת מספר הייבוא** — אחרי שורות 270-273:

```ts
  const [importTestState, importTestAction] = useActionState(
    testWhatsAppImportConnectionAction,
    null,
  );
```

- [ ] **Step 4: אקורדיון חדש** — להוסיף בין `AccordionItem value="creds"` (נסגר בשורה 376) ל-`AccordionItem value="webhook"` (שורה 378):

```tsx
            <AccordionItem value="import-number">
              <AccordionTrigger>
                מספר ייבוא מוזמנים {whatsapp.importConfigured ? '✓' : '(לא מוגדר)'}
              </AccordionTrigger>
              <AccordionPanel>
                <div className="space-y-4 text-foreground">
                  <p className="text-xs text-muted-foreground">
                    מספר Cloud API שני, תחת אותה אפליקציה ואותו WABA, שמקבל רק רשימות
                    מוזמנים (CSV / אנשי קשר). כשהוא מוגדר: הודעות שמגיעות אליו נכנסות
                    למסלול הייבוא בלבד (בלי חיוב ובלי RSVP), התשובות יוצאות ממנו,
                    ומספר ה-RSVP מפסיק לקלוט רשימות — בעלים שישלח לשם רשימה יקבל
                    הפניה לכאן. ריק = ההתנהגות הקודמת (מספר ה-RSVP קולט גם רשימות).
                    אותו טוקן ואותו App Secret משרתים את שני המספרים.
                  </p>
                  <Field
                    name="whatsapp_import_phone_number_id"
                    label="Phone Number ID — ייבוא"
                    dir="ltr"
                    defaultValue={whatsapp.whatsapp_import_phone_number_id}
                    placeholder="מזהה המספר השני ב-WhatsApp Manager"
                    help="Meta App › WhatsApp › API Setup › בחרו את מספר הייבוא › Phone number ID. חייב להיות שונה ממזהה מספר ה-RSVP שלמעלה."
                    errors={e?.whatsapp_import_phone_number_id}
                  />
                  <Field
                    name="whatsapp_import_display_number"
                    label="המספר כפי שהלקוחות רואים אותו"
                    dir="ltr"
                    defaultValue={whatsapp.whatsapp_import_display_number}
                    placeholder="+972 3-330-1505"
                    help="מוצג ללקוחות במסך הוספת המוזמנים ובמסך הייבוא, עם קישור wa.me, ומצוטט בהודעת ההפניה. חובה יחד עם המזהה. לחיצה על ״בדיקת חיבור — מספר ייבוא״ מציגה את המספר כפי ש-Meta מחזירה אותו — העתיקו משם."
                    hint="שני השדות נשמרים יחד: או שניהם מלאים או שניהם ריקים."
                    errors={e?.whatsapp_import_display_number}
                  />
                </div>
              </AccordionPanel>
            </AccordionItem>
```

- [ ] **Step 5: כפתור בדיקה שני** — אחרי טופס הבדיקה הקיים (שורות 400-409):

```tsx
        <form action={importTestAction} className="mt-2 space-y-2">
          <FormError message={importTestState?.error} />
          <FormNotice message={importTestState?.notice} />
          <button
            type="submit"
            disabled={!whatsapp.whatsapp_import_phone_number_id}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40 disabled:opacity-50"
          >
            בדיקת חיבור — מספר ייבוא
          </button>
        </form>
```

- [ ] **Step 6: שערים + בדיקה ידנית בדפדפן (beta, אחרי deploy)**

Run: `npx tsc --noEmit && npm run lint`
Expected: נקי. אחרי הפריסה (§12): `/admin/channels` → הטאב WhatsApp → אקורדיון "מספר ייבוא מוזמנים" מוצג RTL, שני השדות `ltr`, שמירה עם מזהה בלי מספר → שגיאת שדה בעברית מתחת למספר לתצוגה; שמירה תקינה → "הגדרות הערוץ נשמרו"; "בדיקת חיבור — מספר ייבוא" → `מחובר (+972 3-330-1505)`.

- [ ] **Step 7: Commit (משימות 6+7)**

```bash
git add src/lib/data/admin/channels.ts "src/app/(admin)/admin/channels/actions.ts" "src/app/(admin)/admin/channels/actions.test.ts" "src/app/(admin)/admin/channels/channels-client.tsx"
git commit -m "feat(admin): /admin/channels configures the dedicated WhatsApp import number

Two paired fields (phone_number_id + display number), Zod all-or-nothing +
distinct-from-RSVP, and a second read-only connection test that also compares
Meta's display number with the one entered.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 8: קורא ללקוח, נטול סודות — `getWhatsAppImportChannel`

**Files:**
- Create: `src/lib/data/whatsapp-import-channel.ts`
- Test: `src/lib/data/whatsapp-import-channel.test.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `waMeUrl` (משימה 2).
- Produces: `type WhatsAppImportChannel = { displayNumber: string; waMeUrl: string }`, `getWhatsAppImportChannel(): Promise<WhatsAppImportChannel | null>`.

- [ ] **Step 1: הבדיקה הנכשלת**

```ts
// src/lib/data/whatsapp-import-channel.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { getWhatsAppImportChannel } from './whatsapp-import-channel';

type Row = Record<string, unknown>;

function mockAdmin(result: { data: Row | null; error: { message: string } | null }) {
  const { client, builder } = createMockSupabase<Row>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe('getWhatsAppImportChannel', () => {
  it('returns the display number and its wa.me link when the split is configured', async () => {
    const builder = mockAdmin({
      data: { whatsapp_import_phone_number_id: '1298694319994421', whatsapp_import_display_number: '+972 3-330-1505' },
      error: null,
    });

    await expect(getWhatsAppImportChannel()).resolves.toEqual({
      displayNumber: '+972 3-330-1505',
      waMeUrl: 'https://wa.me/97233301505',
    });
    // Secret-free by construction: only the two public columns are selected.
    expect(builder.select).toHaveBeenCalledWith(
      'whatsapp_import_phone_number_id, whatsapp_import_display_number',
    );
  });

  it('null when the import id is missing (split off) even if a display number lingers', async () => {
    mockAdmin({ data: { whatsapp_import_display_number: '+972 3-330-1505' }, error: null });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('null when the display number is missing or does not normalize (no broken link)', async () => {
    mockAdmin({ data: { whatsapp_import_phone_number_id: 'x', whatsapp_import_display_number: 'call us' }, error: null });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
    mockAdmin({ data: { whatsapp_import_phone_number_id: 'x' }, error: null });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });

  it('null on a read error — the customer screen degrades to the legacy copy', async () => {
    mockAdmin({ data: null, error: { message: 'boom' } });
    await expect(getWhatsAppImportChannel()).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run src/lib/data/whatsapp-import-channel.test.ts`
Expected: FAIL — המודול לא קיים.

- [ ] **Step 3: המימוש**

```ts
// src/lib/data/whatsapp-import-channel.ts
import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { waMeUrl } from '@/lib/whatsapp/channel-routing';

// Customer-facing, SECRET-FREE view of the dedicated guest-import number: the
// number as customers see it and its wa.me deep link. Read with the admin
// client because app_settings has no general authenticated read policy (the
// only policy is admin-only) — same pattern as getCompanyLegal (company.ts).
// Selects ONLY the two public columns; the token/app secret never enter this
// module. null = split not configured (or a read failure): callers render the
// legacy copy with no number and no link — a config hiccup must not 500 the
// guests page.
export type WhatsAppImportChannel = {
  displayNumber: string;
  waMeUrl: string;
};

export async function getWhatsAppImportChannel(): Promise<WhatsAppImportChannel | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('whatsapp_import_phone_number_id, whatsapp_import_display_number')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return null;
  const displayNumber = data.whatsapp_import_display_number?.trim() ?? '';
  if (!data.whatsapp_import_phone_number_id || !displayNumber) return null;
  const url = waMeUrl(displayNumber);
  return url ? { displayNumber, waMeUrl: url } : null;
}
```

- [ ] **Step 4: להריץ**

Run: `npm test -- --run src/lib/data/whatsapp-import-channel.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/whatsapp-import-channel.ts src/lib/data/whatsapp-import-channel.test.ts
git commit -m "feat(guests): secret-free reader for the customer-facing import number

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 9: מסך "הוספת מוזמנים" מציג את המספר ופותח את WhatsApp

**Files:**
- Modify: `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.tsx:1-13, 26-40, 42-83, 85-90, 107-119`
- Modify: `src/app/(customer)/app/events/[id]/guests/page.tsx:16, 264-271`
- Test: `src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts`

**Interfaces:**
- Consumes: `WhatsAppImportChannel`, `getWhatsAppImportChannel` (משימה 8).
- Produces: `AddGuestsOnboarding({ eventId, eventName, stage, importChannel: WhatsAppImportChannel | null })`.

- [ ] **Step 1: הבדיקה הנכשלת**

```ts
// src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts
import { describe, expect, it } from 'vitest';

import { AddGuestsOnboarding } from './add-guests-onboarding';

const EVENT_ID = '9f1c2d4e-6b0a-4c58-9a1e-7d3b5f8c2a10';
const CHANNEL = { displayNumber: '+972 3-330-1505', waMeUrl: 'https://wa.me/97233301505' };

// Flatten the returned React element tree (same helper shape as
// app/page.test.ts) — component elements are collected with their props, so an
// <Option href external> is visible without rendering it.
function collect(node: unknown, out: Array<{ props?: Record<string, unknown> }> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { props?: Record<string, unknown> & { children?: unknown } };
  out.push(el);
  collect(el.props?.children, out);
  return out;
}

function hrefs(tree: unknown): string[] {
  return collect(tree)
    .map((el) => el.props?.href)
    .filter((h): h is string => typeof h === 'string');
}

// Every string node reachable through props.children AND through the
// `description` prop (a ReactNode on <Option>) — no JSON.stringify on React
// elements (they carry dev-only fields that are not plain data).
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  const el = node as { props?: { children?: unknown; description?: unknown } };
  texts(el.props?.children, out);
  texts(el.props?.description, out);
  return out;
}

describe('AddGuestsOnboarding — WhatsApp import option', () => {
  it('with the import number configured: the primary option opens wa.me externally, shows the number, and keeps a path to the review screen', () => {
    const tree = AddGuestsOnboarding({ eventId: EVENT_ID, eventName: 'ברית', stage: null, importChannel: CHANNEL });

    const primary = collect(tree).find((el) => el.props?.primary === true);
    expect(primary?.props).toMatchObject({ href: CHANNEL.waMeUrl, external: true });
    expect(texts(tree)).toContain('+972 3-330-1505');
    expect(hrefs(tree)).toContain(`/app/events/${EVENT_ID}/guests/import/whatsapp`);
  });

  it('without it: today\'s behaviour — internal link, no number, no wa.me anywhere', () => {
    const tree = AddGuestsOnboarding({ eventId: EVENT_ID, eventName: 'ברית', stage: null, importChannel: null });

    const primary = collect(tree).find((el) => el.props?.primary === true);
    expect(primary?.props).toMatchObject({ href: `/app/events/${EVENT_ID}/guests/import/whatsapp` });
    expect(primary?.props?.external).toBeFalsy();
    expect(hrefs(tree).some((h) => h.includes('wa.me'))).toBe(false);
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run "src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts"`
Expected: FAIL — `importChannel` לא קיים ב-props; ה-primary תמיד פנימי.

- [ ] **Step 3: המימוש** — ב-`add-guests-onboarding.tsx`:

שורות 1-12 (ייבוא type):
```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FileSpreadsheet, Info, UserPlus } from 'lucide-react';

import { WhatsappIcon } from '@/components/icons/mdi-whatsapp';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STAGE_VARIANTS,
  type CampaignStage,
} from '@/lib/data/event-labels';
import type { WhatsAppImportChannel } from '@/lib/data/whatsapp-import-channel';
```
שורות 26-40 (props):
```tsx
interface AddGuestsOnboardingProps {
  eventId: string;
  eventName: string;
  stage: CampaignStage | null;
  /** The dedicated import number (display + wa.me), or null when the split
   *  is not configured — then the option links to the internal screen as before. */
  importChannel: WhatsAppImportChannel | null;
}

interface OptionProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  cta: string;
  /** The recommended path: filled button, tinted card, "הכי מהיר" tag. */
  primary?: boolean;
  /** An external destination (wa.me): a plain anchor in a new tab, not next/link. */
  external?: boolean;
}
```
בתוך `Option` — להחליף את בלוק ה-`<Link>` (שורות 71-80):
```tsx
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ variant: primary ? 'default' : 'outline' }),
            'h-11 w-full',
            !primary && 'border-primary/50 text-primary hover:text-primary',
          )}
        >
          {cta}
        </a>
      ) : (
        <Link
          href={href}
          className={cn(
            buttonVariants({ variant: primary ? 'default' : 'outline' }),
            'h-11 w-full',
            !primary && 'border-primary/50 text-primary hover:text-primary',
          )}
        >
          {cta}
        </Link>
      )}
```
(ולהוסיף `external` לפירוק ה-props של `Option` בשורה 42.)

חתימת הרכיב (שורות 85-89) + האפשרות הראשית (שורות 108-119):
```tsx
export function AddGuestsOnboarding({
  eventId,
  eventName,
  stage,
  importChannel,
}: AddGuestsOnboardingProps) {
  const reviewHref = `/app/events/${eventId}/guests/import/whatsapp`;
```
```tsx
        {/* With a dedicated import number the CTA does what its label says —
            opens a WhatsApp chat with that number. The number itself is shown
            (dir=ltr inside RTL prose) so the owner can also dial/save it. The
            review screen stays one tap away for lists already sent. Without a
            configured number: the internal screen, exactly as before. */}
        <Option
          primary
          href={importChannel ? importChannel.waMeUrl : reviewHref}
          external={Boolean(importChannel)}
          /* The registry component defaults to fill=none + stroke, but the MDI
             path is a SOLID glyph — stroking it outlines the silhouette twice.
             Fill it and drop the stroke; both are spread props, so the generated
             file stays untouched. */
          icon={<WhatsappIcon size={20} fill="currentColor" strokeWidth={0} />}
          title="ייבוא דרך WhatsApp"
          description={
            importChannel ? (
              <>
                שלחו אנשי קשר או קובץ CSV למספר{' '}
                <span dir="ltr" className="font-medium text-foreground">
                  {importChannel.displayNumber}
                </span>{' '}
                וקבלו קישור לסקירה
              </>
            ) : (
              'שלחו אנשי קשר או קובץ ל־KALFA וקבלו קישור לסקירה'
            )
          }
          cta="פתיחת וואטסאפ"
        />
        {importChannel ? (
          <Link
            href={reviewHref}
            className="-mt-1 text-center text-xs text-muted-foreground hover:underline"
          >
            כבר שלחתם? לסקירת הרשימות שהתקבלו
          </Link>
        ) : null}
```

- [ ] **Step 4: הזרקה מהעמוד** — `guests/page.tsx`:

שורה 16 (אחרי הייבוא הקיים):
```ts
import { getWhatsAppImportChannel } from '@/lib/data/whatsapp-import-channel';
```
שורות 264-271:
```tsx
  // FIRST RUN: the whole content area becomes "how do you want to add guests?".
  // The campaign + the import-number config are loaded ONLY here, so the
  // populated list costs no extra query.
  if (view === 'onboarding') {
    const [stage, importChannel] = await Promise.all([
      getCampaignStageForEvent(eventId),
      getWhatsAppImportChannel(),
    ]);
    return (
      <AddGuestsOnboarding
        eventId={eventId}
        eventName={event.name}
        stage={stage}
        importChannel={importChannel}
      />
    );
  }
```

- [ ] **Step 5: להריץ**

Run: `npm test -- --run "src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts" && npx tsc --noEmit && npm run lint`
Expected: PASS (2 tests); נקי.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.tsx" "src/app/(customer)/app/events/[id]/guests/add-guests-onboarding.test.ts" "src/app/(customer)/app/events/[id]/guests/page.tsx"
git commit -m "feat(guests): first-run screen shows the import number and opens WhatsApp to it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 10: מסך הייבוא מוואטסאפ מציג את המספר

**Files:**
- Modify: `src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.tsx:1-64`
- Test: `src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts`

**Interfaces:**
- Consumes: `getWhatsAppImportChannel` (משימה 8), `buttonVariants`, `cn`.

- [ ] **Step 1: הבדיקה הנכשלת**

```ts
// src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/guests', () => ({ findImportMatches: vi.fn(async () => []) }));
vi.mock('@/lib/data/whatsapp-import-channel', () => ({ getWhatsAppImportChannel: vi.fn() }));
vi.mock('./actions', () => ({
  confirmWhatsappImportAction: vi.fn(),
  discardWhatsappImportAction: vi.fn(),
}));
vi.mock('./staging-client', () => ({
  StagingActions: (props: unknown) => ({ type: 'StagingActions', props }),
}));

import { createClient } from '@/lib/supabase/server';
import { getWhatsAppImportChannel } from '@/lib/data/whatsapp-import-channel';
import { createMockSupabase } from '@/test/supabase-mock';
import WhatsappImportPage from './page';

const EVENT_ID = '9f1c2d4e-6b0a-4c58-9a1e-7d3b5f8c2a10';

function collectHrefs(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectHrefs(n, out));
    return out;
  }
  const el = node as { props?: { href?: unknown; children?: unknown } };
  if (typeof el.props?.href === 'string') out.push(el.props.href);
  collectHrefs(el.props?.children, out);
  return out;
}

// String nodes only — no JSON.stringify on React elements.
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  texts((node as { props?: { children?: unknown } }).props?.children, out);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  const { client } = createMockSupabase<never[]>({ data: [], error: null });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
});

describe('WhatsappImportPage — the import number', () => {
  it('configured: shows the number and a wa.me button, with no pending lists', async () => {
    vi.mocked(getWhatsAppImportChannel).mockResolvedValue({
      displayNumber: '+972 3-330-1505',
      waMeUrl: 'https://wa.me/97233301505',
    });

    const tree = await WhatsappImportPage({ params: Promise.resolve({ id: EVENT_ID }) });

    expect(collectHrefs(tree)).toContain('https://wa.me/97233301505');
    expect(texts(tree)).toContain('+972 3-330-1505');
  });

  it('not configured: the legacy empty-state copy, no number, no wa.me', async () => {
    vi.mocked(getWhatsAppImportChannel).mockResolvedValue(null);

    const tree = await WhatsappImportPage({ params: Promise.resolve({ id: EVENT_ID }) });

    expect(collectHrefs(tree).some((h) => h.includes('wa.me'))).toBe(false);
    expect(texts(tree).some((t) => t.includes('לוואטסאפ העסקי'))).toBe(true);
  });
});
```

- [ ] **Step 2: להריץ ולראות כישלון**

Run: `npm test -- --run "src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts"`
Expected: FAIL — אין `wa.me` בעץ; `getWhatsAppImportChannel` לא נקרא.

- [ ] **Step 3: המימוש** — `import/whatsapp/page.tsx`, שורות 1-64:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { findImportMatches, type ImportMatch } from '@/lib/data/guests';
import type { StagedRow } from '@/lib/data/whatsapp-import';
import { getWhatsAppImportChannel } from '@/lib/data/whatsapp-import-channel';
import { cn } from '@/lib/utils';
import {
  confirmWhatsappImportAction,
  discardWhatsappImportAction,
} from './actions';
import { StagingActions } from './staging-client';

export const metadata: Metadata = { title: 'ייבוא מוואטסאפ' };

interface PageProps {
  params: Promise<{ id: string }>;
}

// Review screen for guest lists sent to the business WhatsApp (CSV documents
// or shared contact cards). Nothing lands in the guest list until confirmed
// here; reads ride the staging RLS (guests.view/create per phase 3). When a
// dedicated import number is configured it is shown here with a wa.me link —
// the number comes from admin config, never from code.
export default async function WhatsappImportPage({ params }: PageProps) {
  const { id: eventId } = await params;
  await requireEventAccess(eventId, 'guests', 'create');

  const supabase = await createClient();
  const [{ data: pending }, importChannel] = await Promise.all([
    supabase
      .from('guest_import_staging')
      .select('id, source, file_name, rows, row_count, error_rows, created_at')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    getWhatsAppImportChannel(),
  ]);

  // Per staging list, detect incoming rows that are the SAME person as an
  // existing guest (by phone, or by name when the existing one is phone-less) —
  // surfaced on the review screen as per-field merge choices.
  const pendingList = pending ?? [];
  const matchesByStaging = new Map<string, ImportMatch[]>();
  await Promise.all(
    pendingList.map(async (s) => {
      const rows = (s.rows ?? []) as StagedRow[];
      matchesByStaging.set(s.id, await findImportMatches(eventId, rows));
    }),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ייבוא מוואטסאפ</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה למוזמנים
        </Link>
      </div>

      {importChannel ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            שלחו קובץ CSV או שתפו אנשי קשר למספר הייבוא{' '}
            <span dir="ltr" className="font-medium">
              {importChannel.displayNumber}
            </span>
            {' '}— הרשימה תופיע כאן לאישור.
          </p>
          <a
            href={importChannel.waMeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline' }), 'shrink-0')}
          >
            פתיחת וואטסאפ
          </a>
        </div>
      ) : null}

      {pendingList.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          {importChannel
            ? 'אין רשימות ממתינות.'
            : 'אין רשימות ממתינות. שלחו קובץ CSV או שתפו אנשי קשר לוואטסאפ העסקי — והרשימה תופיע כאן לאישור.'}
        </p>
      ) : null}
```
(מ-`{pendingList.map((s) => {` ואילך — ללא שינוי.)

- [ ] **Step 4: להריץ**

Run: `npm test -- --run "src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts" && npx tsc --noEmit && npm run lint`
Expected: PASS (2 tests); נקי.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.tsx" "src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.test.ts"
git commit -m "feat(guests): WhatsApp import screen names the import number with a wa.me link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 11: תיעוד + הערת הרילוקיישן

**Files:**
- Modify: `docs/project/07-messaging-channels.md` (§2 הקליטה, §6 טבלת המפתחות שורה 325)
- Modify: `docs/project/03-database-schema.md:639` (§14 `app_settings`)
- Modify: `docs/project/05-guests-and-public-rsvp.md` (סעיף חדש אחרי "ייבוא CSV בכמות", שורה ~148)
- Modify: `docs/project/09-admin-panel.md:26, 137, 156-162`
- Modify: `docs/webhook-inbox-data-contract.md:27`
- Modify: `docs/admin-webhooks-runbook.md:103`
- Modify: `src/lib/relocation/install-steps.ts:461`

- [ ] **Step 1: `07-messaging-channels.md`** — בטבלת §6 להחליף את שורת WhatsApp:

```markdown
| WhatsApp / outreach | `outreach_enabled`, `whatsapp_phone_number_id` (מספר ה-RSVP), `whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`, `whatsapp_import_phone_number_id` + `whatsapp_import_display_number` (מספר הייבוא הייעודי, אופציונלי, נשמרים יחד) | `src/lib/data/outreach-config.ts` (`getWhatsAppConfig`) | `/admin/channels` (`src/lib/data/admin/channels.ts`) |
```
ובסוף §2 (הקליטה) להוסיף תת-סעיף:

```markdown
### 2.4 ניתוב לפי המספר שקיבל (2026-09-03)

`processMessage` (`src/lib/data/webhook-processing.ts`) מסווג כל שורה לפי
`webhook_inbox.phone_number_id` באמצעות `classifyInboundChannel`
(`src/lib/whatsapp/channel-routing.ts`):

| `phone_number_id` בשורה | ערוץ | מה רץ |
|---|---|---|
| = `whatsapp_import_phone_number_id` | `import` | `stageWhatsAppImport` בלבד; תשובות מהמספר הזה (`importSender`). הודעה שאינה CSV/אנשי קשר — מתעלמים. |
| = `whatsapp_phone_number_id` או `NULL` | `rsvp` | מסלול החיוב/RSVP. אם מוגדר מספר ייבוא — רשימה מבעלים מאומת מקבלת הפניה (`replyImportPointer`) ואינה נקלטת. |
| אחר | `unknown` | כלום; התראת Slack (`send_health`) עם `rowId` + `phoneNumberId`. |

מספר ייבוא לא מוגדר ⇒ הכל `rsvp`, כולל קליטת רשימות במספר ה-RSVP — ההתנהגות הקודמת. שני המספרים חולקים אפליקציה, WABA, טוקן ו-app secret; ה-route וחתימת ה-webhook אינם משתנים.

הורדת קובץ ה-CSV (`downloadDocument`) עוברת דרך ה-SDK: `retrieveMedia(mediaId, row.phone_number_id)` — Graph מסרב כשהמדיה שייכת למספר אחר — ואז `fetchMedia(url)`, עם timeout של 15 שניות דרך `ponyfill.fetch` ותקרת 1MB.
```

ובהערות §6 להחליף את הנקודה על גרסת ה-Graph:

```markdown
- גרסת ה-Graph לכל קריאת WhatsApp/Meta של האפליקציה היא קבוע אחד — `GRAPH_API_VERSION` ב-`src/lib/whatsapp/graph-version.ts` (פין v24.0; `WHATSAPP_GRAPH_VERSION` ב-env דורס ערך תקני בלבד). משמש את `client.ts`, את ה-route של ה-webhook, את הורדת המדיה ואת ה-probe ב-`/admin/channels`. `template-health.ts` ו-`relocation/*` עדיין מקודדים ידנית (v23.0/v21.0) — follow-up.
```

- [ ] **Step 2: `03-database-schema.md` §14** — להחליף את המשפט "אין שום פוליסת קריאה ל‑authenticated" ב:

```markdown
מאז 0006 **אין פוליסת קריאה כללית ל‑authenticated**; הפוליסה היחידה, `app_settings_admin_all`, היא `FOR ALL` ל‑authenticated בתנאי `has_role(auth.uid(),'admin')` (אומת מול `pg_policy` 2026-09-03) — כלומר אדמין מחובר קורא וכותב דרך RLS, וכל קריאה אחרת היא צד‑שרת (service‑role).
```
ולהוסיף לרשימת העמודות: `whatsapp_import_phone_number_id text`, `whatsapp_import_display_number text` (2026-09-03, מספר ייבוא ייעודי; ראו 07 §2.4).

- [ ] **Step 3: `05-guests-and-public-rsvp.md`** — סעיף חדש אחרי "ייבוא CSV בכמות":

```markdown
### ייבוא דרך WhatsApp

בעלים מאומת (`profiles.phone`) שולח CSV או אנשי קשר משותפים למספר הייבוא של KALFA
(`app_settings.whatsapp_import_phone_number_id`, מוצג ללקוחות כ‑`whatsapp_import_display_number`
עם קישור `wa.me` במסך "הוספת מוזמנים" ובמסך `/guests/import/whatsapp`). ה‑worker
(`src/lib/data/whatsapp-import.ts`) מנתב לאירוע הפעיל היחיד של השולח (יותר מאחד ⇒ שואל, לא
מנחש), יוצר שורת `guest_import_staging` בסטטוס `pending` ומשיב **מאותו מספר** עם קישור
לסקירה. המוזמנים נוצרים רק באישור במסך. רשימה שנשלחה למספר ה‑RSVP מקבלת הפניה למספר
הייבוא ואינה נקלטת (ראו 07 §2.4).
```

- [ ] **Step 4: `09-admin-panel.md`** — בשורה 26 להוסיף "+ מספר ייבוא ייעודי"; בשורה 137 להוסיף `whatsapp_import_*`; ב-§"מסך /admin/channels — פירוט" להוסיף נקודה:

```markdown
- אקורדיון "מספר ייבוא מוזמנים": `whatsapp_import_phone_number_id` + `whatsapp_import_display_number`, נשמרים יחד (Zod: או שניהם או אף אחד, ושונה ממזהה ה‑RSVP). כפתור "בדיקת חיבור — מספר ייבוא" מריץ את אותו probe (`testWhatsAppImportConnection`) ומשווה את המספר ש‑Meta מחזירה למספר שהוזן.
```

- [ ] **Step 5: `webhook-inbox-data-contract.md:27`** — להחליף את תא המשמעות:

```markdown
| `phone_number_id` | `text` | כן | מזהה מספר-הטלפון העסקי ב-WABA שקיבל את האירוע. **מזהה טכני, לא PII** — ניתן לחיפוש. **מפתח הניתוב** של `processMessage` (2026-09-03): מספר הייבוא ⇒ ייבוא בלבד; מספר ה-RSVP/`NULL` ⇒ מסלול RSVP; אחר ⇒ התעלמות + התראה. ב-`status` הוא מזהה את המספר **ששלח** את ההודעה היוצאת. |
```

- [ ] **Step 6: `admin-webhooks-runbook.md`** — אחרי שורה 103 להוסיף:

```markdown
- סינון לפי `phone_number_id` מפריד בין שני המספרים: `1018741517998430` = RSVP, מספר הייבוא = הערך שב-`/admin/channels`. הודעה עם מספר שלישי מסומנת מעובדת בלי פעולה ומקפיצה התראת `send_health` — לתקן את המזהים ואז "עיבוד מחדש".
```

- [ ] **Step 7: `install-steps.ts:461`** — הרחבת טקסט התכנון של I12 בלבד (ללא שינוי לוגיקה; מספר הייבוא אופציונלי ולכן בדיקת הנוכחות נשארת על שני המפתחות הקיימים):

```ts
        "NOT env keys (owner note 2026-08-23): WhatsApp Cloud API (phone-number-id, access token, WABA id, app secret; optional dedicated import number + its display form), SUMIT billing credentials, ExtrA SMS, SMTP identity and Voximplant service account all live in the app_settings ROW — entered via the running app's own admin: /admin/settings + /admin/channels",
```

- [ ] **Step 8: Commit**

```bash
git add docs/project/07-messaging-channels.md docs/project/03-database-schema.md docs/project/05-guests-and-public-rsvp.md docs/project/09-admin-panel.md docs/webhook-inbox-data-contract.md docs/admin-webhooks-runbook.md src/lib/relocation/install-steps.ts
git commit -m "docs: two-number WhatsApp routing — import number, admin fields, inbox contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AhZn4GLpoocva9fALP9KnU"
```

---

### Task 12: שער סופי, פריסה, אימות חי, החלטות C ו-D

**Files:** אין שינוי קוד. כל צעד מסומן **[בעלים]** מבוצע על ידי הבעלים.

- [ ] **Step 1: השער המלא**

Run: `npx tsc --noEmit && npm run lint && npm test -- --run && npm run build`
Expected: הכל ירוק (`pretest` מריץ גם `worker:deps` ו-`check:control-chars`). אין `next build` מקבילי (ראה memory `concurrent-build-collision`).

- [ ] **Step 2: [בעלים] פריסה**

Run: `npm run deploy`
Expected: `types:check` עובר (המיגרציה כבר נדחפה במשימה 1), build, `pm2 restart kalfa-beta`, `worker:build` (עם `check-worker-bundle ok`), `pm2 restart kalfa-worker`. **בשלב הזה השדה ריק ⇒ ההתנהגות זהה להיום** — אין חלון שבו משהו נשבר.

אימות שהאזהרה נעלמה (אחרי ש-Meta שלחה לפחות webhook אחד — למשל אחרי בדיקה (i) למטה):
```bash
grep -c "Cloud API version not defined" ~/.pm2/logs/kalfa-beta-error.log   # המספר לפני הפריסה (59 ב-2026-09-03 19:12)
# … אחרי webhook חי:
tail -n 200 ~/.pm2/logs/kalfa-beta-error.log | grep -c "Cloud API version not defined"   # 0
```

- [ ] **Step 3: [בעלים] הפעלת הפיצול ב-`/admin/channels`**

1. טאב WhatsApp → אקורדיון "מספר ייבוא מוזמנים".
2. Phone Number ID — ייבוא: `1298694319994421`. המספר לתצוגה: `+972 3-330-1505`. שמירה → "הגדרות הערוץ נשמרו".
3. "בדיקת חיבור — מספר ייבוא" → `מחובר (+972 3-330-1505)` בלי אזהרת אי-התאמה.
4. "בדיקת חיבור" (הרגיל) → עדיין `מחובר (+972 3-721-9347)`.

אימות ב-DB:
```sql
select whatsapp_phone_number_id, whatsapp_import_phone_number_id, whatsapp_import_display_number
from app_settings where id = true;
-- 1018741517998430 | 1298694319994421 | +972 3-330-1505
```

- [ ] **Step 4: [בעלים] ארבע בדיקות חיות** — לכל בדיקה: לשלוח מהטלפון של הבעלים, לחכות ~90 שניות (drain של דקה), להריץ את ה-SQL. ה-worker חייב להיות מופעל מחדש (Step 2) לפני שמתחילים.

**(i) טקסט חופשי למספר הייבוא (`+972 3-330-1505`) → שום אינטראקציה.**
```sql
select event_kind, phone_number_id, payload->>'type' as msg_type,
       processed_at is not null as processed, last_error is not null as errored
from webhook_inbox
where provider = 'whatsapp' and received_at > now() - interval '10 minutes'
order by received_at;
-- שורה אחת: message | 1298694319994421 | text | true | false

select count(*) as new_inbound_interactions
from contact_interactions
where channel = 'whatsapp' and direction = 'in' and created_at > now() - interval '10 minutes';
-- 0
```

**(ii) CSV (או שיתוף איש קשר) למספר הייבוא → שורת staging + תשובה שמגיעה מ-`+972 3-330-1505`.**
```sql
select source, row_count, status, created_at
from guest_import_staging
where created_at > now() - interval '10 minutes';
-- שורה אחת, status = pending

-- ההוכחה שהתשובה יצאה מהמספר הנכון: סטטוסי המסירה של התשובה נושאים את המספר ששלח אותה
select phone_number_id, payload->>'status' as status, received_at
from webhook_inbox
where provider = 'whatsapp' and event_kind = 'status' and received_at > now() - interval '10 minutes'
order by received_at;
-- sent / delivered / read, כולם עם phone_number_id = 1298694319994421

select count(*) from contact_interactions
where channel = 'whatsapp' and direction = 'in' and created_at > now() - interval '10 minutes';
-- 0
```
בטלפון: התשובה (עם קישור הסקירה) מופיעה בשיחה עם `+972 3-330-1505`. לפתוח את הקישור → הרשימה במסך → "מחיקה" (זו בדיקה).
**לשלוח דווקא קובץ CSV (לא רק איש קשר):** זו הבדיקה החיה היחידה של נתיב המדיה החדש (`retrieveMedia` מוגבל ל-`1298694319994421` + `fetchMedia` עם ה-UA של ה-SDK, על v24.0). אם התשובה היא "לא הצלחנו לקרוא את הקובץ" על קובץ תקין קטן — לעצור, לא להמשיך ל-(iii), ולבדוק את `last_error`/Slack; הגלגול לאחור של הנתיב הזה הוא revert של הקומיט של משימות 4+5 (השדות באדמין יכולים להישאר).

**(iii) CSV למספר ה-RSVP (`+972 3-721-9347`) → אין staging; מגיעה הפניה מהמספר הזה (החלטה A1).**
```sql
select count(*) as new_staging
from guest_import_staging where created_at > now() - interval '10 minutes';
-- 0

select phone_number_id, payload->>'status' as status
from webhook_inbox
where provider = 'whatsapp' and event_kind = 'status' and received_at > now() - interval '10 minutes'
order by received_at;
-- הסטטוסים של ההפניה: phone_number_id = 1018741517998430

select count(*) from contact_interactions
where channel = 'whatsapp' and direction = 'in' and created_at > now() - interval '10 minutes';
-- 0  (document אינו סוג חייב, וגם נצרך לפני הסיווג)
```
בטלפון: בשיחה עם `+972 3-721-9347` מופיע: "רשימות מוזמנים מתקבלות במספר הייבוא של KALFA: +972 3-330-1505 …" עם קישור `wa.me`.

**(iv) תשובת RSVP למספר ה-RSVP → כמו קודם.** דורש קמפיין **פעיל** עם הודעה יוצאת אל הטלפון של הבעלים (אירוע QA); על קמפיין סגור יירשם `contact_interactions` אך לא `billed_results` — בדיוק כמו היום (השורה מ-15:04).
```sql
select ci.kind, ci.billable, ci.context_message_id is not null as by_context, ci.created_at,
       br.evidence_source, br.provider_ref is not null as billed
from contact_interactions ci
left join billed_results br on br.provider_ref = ci.provider_id
where ci.channel = 'whatsapp' and ci.direction = 'in' and ci.created_at > now() - interval '10 minutes'
order by ci.created_at;
-- שורה אחת, billable = true; billed = true אם הקמפיין פעיל

select event_kind, phone_number_id, payload->>'type' as msg_type
from webhook_inbox
where provider = 'whatsapp' and event_kind = 'message' and received_at > now() - interval '10 minutes';
-- button/interactive/text | 1018741517998430
```

בנוסף (בקרה שלילית לערוץ `unknown`): ב-`/admin/webhooks` לבחור את אחת משורות ה-QA עם `phone_number_id = 123456123` מ-29.6 → "עיבוד מחדש" → תוך דקה: `processed_at` חדש, אין שורת `contact_interactions` חדשה, והתראת `send_health` אחת בסלאק עם `phoneNumberId: 123456123`.

- [ ] **Step 5: [בעלים] החלטה C — ניקוי `.env.local`** (אופציונלי, בכל שלב אחרי Step 2)

לוודא קודם מה נמחק (מפתחות בלבד, בלי ערכים):
```bash
sed -n '114,118p' .env.local | cut -d= -f1
# WHATSAPP_BUSINESS_ACCOUNT_ID
# WHATSAPP_PHONE_NUMBER_ID
# WHATSAPP_ACCESS_TOKEN
# META_APP_SECRET_WA
# META_APP_ID_WA
```
אם חמשת השמות תואמים בדיוק:
```bash
cp .env.local .env.local.bak-2026-09-03 && sed -i '114,118d' .env.local && tail -c1 .env.local | xxd
```
- לא לגעת ב-`META_APP_ID` / `META_APP_SECRET` (שורות 69-70; אפליקציית האינסטגרם, `src/lib/relocation/*`).
- **מלכודת ה-`\n`:** הקובץ מסתיים היום בלי שורה-חדשה. אחרי המחיקה השורה האחרונה החדשה (113) כן מסתיימת ב-`\n` — `xxd` יציג `0a`. אם אי פעם מוסיפים שורה ב-`echo >>`, לוודא קודם `tail -c1`.
- אין צורך ב-restart: אף תהליך לא קורא את המפתחות האלה. למחוק את `.env.local.bak-2026-09-03` אחרי אימות (מכיל סודות).

- [ ] **Step 6: [בעלים] החלטה D — מעבר לטוקן System-User** (צעד נפרד, אחרי ש-Step 4 ירוק; דדליין טבעי 2026-12-02)

1. לשמור בצד את הטוקן הנוכחי (העתקה מהשדה החשוף ב-`/admin/channels` → מנהל סיסמאות; לא לקובץ בריפו).
2. `/admin/channels` → Access Token → להדביק את טוקן ה-System-User → שמירה.
3. "בדיקת חיבור" → `מחובר (+972 3-721-9347)`; "בדיקת חיבור — מספר ייבוא" → `מחובר (+972 3-330-1505)`. שתיהן חייבות לעבור — זו ההוכחה שה-System-User מורשה על **שני** המספרים.
4. שליחה אמיתית אחת: לחזור על בדיקה (ii) (CSV למספר הייבוא) — מכסה הורדת מדיה + שליחה עם הטוקן החדש. אם יש קמפיין QA פעיל: גם תבנית אחת אליך דרך המסלול הרגיל.
5. גלגול לאחור: להדביק חזרה את הטוקן הקודם ולשמור; "בדיקת חיבור". חתימת ה-webhook לא תלויה בטוקן (app secret) — הקליטה לא נפגעת בשום שלב.

- [ ] **Step 7: ניקוי דאטה (שאלה לבעלים)**

שורת ה-`contact_interactions` מהיום (15:04 UTC, `billable = true`, קמפיין הברית הסגור, הטלפון של הבעלים) נשארת; אין לה `billed_results`. היא תופיע במוני "השיבו" של האירוע הסגור. מחיקה = `DELETE` ידני עם אישור מפורש — לא חלק מהתוכנית.

---

## §12 סיכונים וגלגול לאחור

| משימה | סיכון | הקטנה | גלגול לאחור |
|---|---|---|---|
| 1 מיגרציה | drift בין ריפו ל-DB | `types:check` חוסם deploy | `drop column` ×2 (בכותרת המיגרציה) |
| 3 תצורה | ליטרל `WhatsAppConfig` בקובץ בדיקה שלא נסקר | `tsc` בשער; אין casts | revert הקומיט |
| 4–5 ניתוב | רגרסיה במסלול ה-RSVP | כל 40+ הבדיקות הקיימות של `webhook-processing` רצות ללא שינוי במצב legacy; 7 חדשות למצב הפיצול; בדיקה (iv) | **גלובלי:** לרוקן את שני שדות הייבוא ב-`/admin/channels` ⇒ `classifyInboundChannel` מחזיר `rsvp` לכל שורה ⇒ ההתנהגות של היום, בלי deploy. העמודות נשארות. |
| 5 `unknown` | מספר שלישי אמיתי נופל | התראה per-row; "עיבוד מחדש" אחרי תיקון המזהים | כנ"ל |
| 4 הפניה | הודעה חופשית מחוץ לחלון 24h | לא ייתכן: ההפניה היא תשובה להודעה שהבעלים שלח זה עתה | — |
| 6–7 אדמין | שמירה חצי-מוגדרת | Zod זיווג + שונה ממספר ה-RSVP; `importConfigured` נגזר | ריקון השדות |
| 8–10 לקוח | קישור `wa.me` שבור | `waMeUrl` דרך `normalizePhone`; null ⇒ הטקסט הישן | — |
| 2b גרסה | מעבר ה-probe/המדיה מ-v23.0 ל-v24.0 | שדות יציבים; v24.0 מוכח לשליחה על ה-WABA הזה; שניהם מתורגלים ב-§12.4 (בדיקת חיבור + CSV) | `WHATSAPP_GRAPH_VERSION=v23.0` ב-env + restart, בלי deploy |
| 4 מדיה | `fetchMedia` שולח `User-Agent` של Googlebot (עקיפה של ה-SDK, סיבה לא מתועדת); timeout חדש של 15s | הנתיב מתורגל ב-(ii) עם CSV אמיתי; timeout זהה ל-`template-health.ts` | revert קומיט 4+5 |
| 12 D טוקן | System-User לא מורשה על מספר אחד | שתי בדיקות חיבור לפני שליחה | הדבקת הטוקן הקודם |

## §13 הערות אבטחה

- כל ה-Server Actions של האדמין עוברות `requirePlatformPermission('manage_settings')` בשכבת ה-DAL (`channels.ts`), ו-RLS `app_settings_admin_all` היא שכבה שנייה. השדות החדשים אינם סוד ומוצגים גלוי; הטוקן וה-app secret נשארים ב-`SecretField` ממוסך.
- הקורא ללקוח (`whatsapp-import-channel.ts`) בוחר במפורש רק את שתי העמודות הציבוריות — הטוקן לעולם לא נטען למודול שמזין Server Component של לקוח. נבדק בבדיקה (`builder.select` toHaveBeenCalledWith).
- אין לוג של payload/טלפון/טוקן. ההתראה היחידה החדשה נושאת `rowId` + `phoneNumberId` (מזהה Meta טכני) — נבדק ש-`from` של השולח לא נכלל.
- `route.ts` של ה-webhook לא נגע: אותו `X-Hub-Signature-256`, אותו app secret, אותו verify token — האפליקציה אחת. `GET` verification ללא שינוי.
- הודעת ההפניה נשלחת רק לשולח שמופה ל-`profiles.phone` מאומת עם אירוע פעיל — זר לא מקבל שום אות שהמערכת קיימת (הכלל הקיים של המודול נשמר). היא הודעה חופשית בתוך חלון 24h שהשולח פתח, ללא תוכן שיווקי — אין חשיפה ל-131049 ואין שאלת הסכמה (הפונה הוא הלקוח עצמו).
- מספר הייבוא לא שולח outreach לעולם; לכן הודעה שהגיעה אליו אינה יכולה להיות "מענה" חייב, וההתעלמות מטקסט חופשי שם היא fail-closed מבחינת חיוב.
- הורדת מדיה מוגבלת ל-`phone_number_id` של השורה: מזהה מדיה שנלכד/הוזרק לא יכול למשוך קובץ ששייך למספר אחר (Graph מסרב). הטוקן עובר ל-SDK כפי שעבר ל-`fetch` — לא נלוגג, לא בהודעת שגיאה.

---

## §14 Follow-ups (מחוץ להיקף — מביקורת ה-SDK, נוגעים בקבצים אחרים)

| # | פריט | קובץ | למה לא כאן |
|---|---|---|---|
| F1 | `template-health.ts:16` — `GRAPH = 'https://graph.facebook.com/v23.0'` → `GRAPH_API_VERSION` | `src/lib/whatsapp/template-health.ts` | לא נוגע במספרים; שינוי גרסה בלי צורך תפעולי — סקירה נפרדת |
| F2 | פיני `v21.0` (פקיעה **2027-01-21**, הקרובה ביותר) ו-`v23.0` ב-relocation → `GRAPH_API_VERSION` | `src/lib/relocation/preflight.ts:720`, `external.ts:201`, `meta-templates.ts:34` | קוד רילוקיישן, מורץ ידנית; לתזמן לפני ינואר 2027 |
| F3 | לטפס את תוצאת השליחה כ-`ServerMessageResponse` ולקרוא `messages[0].message_status === 'held_for_quality_assessment'` (היום מסווג `accepted`) | `src/lib/whatsapp/client.ts:83-98` | נתיב התשובות של הייבוא מתעלם מהתוצאה בכוונה (`safeReply` best-effort) ולא רושם אותה — אין מקום שבו הטיפוס משנה התנהגות בתוכנית זו. דורש החלטה סמנטית קטנה: דגל על ה-outcome / ב-`contact_interactions`, בלי לשנות resend |
| F4 | `message._type` → ליטרל `'template'` ב-`sendWhatsAppMarketingTemplate` | `client.ts:268-269` | קוסמטי |
| F5 | תשובת "יש לך כמה אירועים פעילים — לאיזה?" כתפריט `Interactive` + `ActionList` (בתוך חלון 24h; `inbound.ts:79-86` כבר קורא `list_reply.id`) במקום רשימת קישורים | `whatsapp-import.ts:157-170`, `webhook-processing.ts` | UX; דורש תכנון של מיפוי `list_reply.id` → אירוע ומנגנון "המתנה לבחירה" בערוץ הייבוא — תוכנית נפרדת (P2) |
| F6 | `on.sent` emitter כנקודת audit מרכזית נטולת PII | `client.ts` | ארכיטקטורה; לא נדרש לפיצול |
| F7 | שער גודל לפני קריאת הגוף: `Content-Length > 3MB` ⇒ `413` (תקרת ה-payload של Meta היא 3MB, DOCS-ONLY) לפני `request.text()` | `src/app/api/webhooks/whatsapp/route.ts:172` | הקשחה של ה-route שאינה תלויה במספרים; ה-route בהיקף הזה משתנה רק ב-`v`. לשים לב: 413 ≠ 200 ⇒ Meta תנסה שוב עד 7 ימים — להחליט אם 200-והתעלמות עדיף |
| F8 | BSUID watch: Meta מעבירה מזהי משתמש עסקיים (BSUID) — `payload.from` עלול להפסיק להיות E.164 בעתיד (ה-SDK 6.2.2 מצהיר "doesn't include BSUID support"). `normalizePhone(p.from)` ב-`readImportPayload` ו-`resolveInboundContact` יחזירו null ⇒ הודעה כזו תיפול בשקט | `whatsapp-import.ts`, `interactions.ts:52-56`, `inbound.ts:45-48` | אין שינוי בפועל היום; לרשום מטריקה/התראה כש-`from` לא מנרמל, ולעקוב אחרי שחרור SDK עם BSUID |

---

## Self-Review

**1. Spec coverage** (מול סעיפי המשימה 1–11 של team-lead):

| דרישה | משימה |
|---|---|
| 1 מודל נתונים: עמודות, rollback, למה בלי טוקן/WABA, RLS/grants, regen, `install-steps` | 1 (+§3.2, §1.1 RLS) ; `install-steps` → 11 Step 7 |
| 2 שכבת תצורה: `importPhoneNumberId`, helper לשולח, null = legacy | 2 (`importSender`), 3 |
| 3 ניתוב: import-only / rsvp / unknown; `processStatus` מספר-אגנוסטי | 5 ; §3.3 |
| 4 מודול ייבוא: `InboxRow`, שולח, `resolveOwnerActiveEvents` לא נגע, כל `safeReply` | 4 (5 קריאות `safeReply` הוחלפו ל-`from`) |
| 5 אדמין: שדות, zod, DAL, בדיקת חיבור לייבוא, `actions.test.ts` | 6, 7 |
| 6 לקוח: onboarding + עמוד ייבוא, `dir="ltr"`, מ-DB, מצב לא-מוגדר | 8, 9, 10 |
| 7 בדיקות: ניתוב, שולח, ולידציה, UI | 2, 3, 4, 5, 6, 8, 9, 10 |
| 8 תיעוד | 11 |
| 9 runbook: סדר, בעלים, אימות (i)–(iv) עם SQL | 12 |
| 10 סיכונים/גלגול | §12 |
| 11 אבטחה | §13 |
| החלטות A–D | §0, §4, 12 Steps 5–6 |
| ביקורת SDK #1 — מדיה דרך `retrieveMedia`/`fetchMedia`, מוגבל ל-`phone_number_id`, 1MB, timeout | 4 (`downloadDocument` + 3 בדיקות), 12 Step 4 (ii) |
| ביקורת SDK #2 — `GRAPH_API_VERSION` אחד ל-`client.ts`, `route.ts`, המדיה וה-probe; שאר הפינים כ-follow-up | 2b, 4, 6, §14 F1–F2 |
| ביקורת SDK #3 — `held_for_quality_assessment` | §14 F3 (נתיב התשובות אינו רושם outcome) |
| ביקורת SDK #4 — אין `post()`/emitters; ניתוב לפי `row.phone_number_id` | Global Constraints, 5 |
| ביקורת SDK #5 — מנוי webhook ב-v25.0 (MEASURED) | §1.1, הערת `graph-version.ts` |
| ביקורת SDK #6 — ActionList לשאלת "איזה אירוע" | §14 F5 |

**2. Placeholder scan:** אין "TBD"/"similar to"/"add validation". שני מקומות מציינים במפורש קבצים שלא נקראו (משימה 3 Step 5 — ארבעה קובצי בדיקה; `tsc` הוא השער) — זו הצהרת אי-ודאות, לא placeholder.

**3. Type consistency:**
- `WhatsAppSender` (משימה 2) = הפרמטר של `safeReply` (4) ושל `sendWhatsAppText` (`client.ts:296`, מבנית זהה).
- `WhatsAppConfig` (3) מקיים מבנית `ChannelNumbers` ו-`WhatsAppSender & { importPhoneNumberId }` — לכן `classifyInboundChannel(row.phone_number_id, config)` ו-`importSender(config)` מתקמפלים בלי המרות; גם `config | null` תואם ל-`ChannelNumbers | null`.
- `stageWhatsAppImport(row, config: WhatsAppConfig | null)` — נקרא כך ב-5 ובבדיקות של 4 ו-5. `replyImportPointer(row, config: WhatsAppConfig)` — נקרא רק אחרי `config?.importPhoneNumberId` ולכן `config` אינו null במקום הקריאה (narrowing של TS על `config?.x` truthy ⇒ `config` מוגדר).
- `WebhookInboxRow` (`Tables<'webhook_inbox'>`) מכיל `phone_number_id: string | null` ⇒ מקיים את `InboxRow` הפרטי.
- `WhatsAppChannelConfig.importConfigured` (6) הוא מה ש-`channels-client.tsx` (7) קורא; ה-type המקומי שם עודכן זהה.
- `WhatsAppImportChannel` (8) הוא ה-prop ב-9 וה-value ב-10; שניהם `import type` בלבד מהמודול ה-`server-only`.
- `testWhatsAppImportConnection` מיוצא מ-`channels.ts` (6), מיובא ב-`actions.ts` (6) וב-mock של `actions.test.ts` (6).
- `GRAPH_API_VERSION` (2b) מיובא ב-`client.ts`, `route.ts`, `whatsapp-import.ts` (4) ו-`channels.ts` (6) — אותו שם, אותו נתיב `@/lib/whatsapp/graph-version`. `graph-version.ts` הוא עלה טהור (רק `process.env`) ולכן בטוח גם לחבילת ה-worker.
- `downloadDocument(mediaId, accessToken, phoneNumberId)` (4) נקרא עם `row.phone_number_id: string | null` — תואם; ה-SDK מקבל `phoneID?: string` ולכן `?? undefined`.
- ה-mock של `whatsapp-api-js` ב-`whatsapp-import.test.ts` (4) מגדיר `retrieveMedia`/`fetchMedia` בלבד — `client.ts` ממוקק בנפרד באותו קובץ (`sendWhatsAppText`), ולכן שום קוד בבדיקה לא מגיע ל-`sendMessage` של המחלקה המדומה.
