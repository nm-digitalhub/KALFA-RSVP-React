# ביקורת ארכיטקטורה והחלפת קוד ידני בספריות — נובמבר 2026

שני שלבים, שניהם **קריאה בלבד** (לא נערך קוד, לא הורץ דפדפן, לא נגעו ב-DB החי):

1. **08.11.2026** — 8 סוכנים מיפו בעזרת Serena איפה הקוד לא עומד בכלל הארכיטקטורה של הבעלים
   (בלי קבצים ענקיים, הפרדת UI / לוגיקה / API, פונקציות קטנות לשימוש חוזר). הדוחות הגולמיים:
   [`architecture-audit-2026-11-08/`](architecture-audit-2026-11-08/).
2. **09.11.2026** — 4 סוכנים מומחי-תחום בדקו, ממצא אחר ממצא, האם חבילה שכבר מותקנת ב-`node_modules`
   (או יכולת מובנית של Node/Next) כבר מכילה את הפתרון לקוד שנכתב ביד.

סימונים: **[M]** = נמדד (השורות נקראו / הקוד הורץ בזיכרון) · **[I]** = הסקה.
מספרי שורות לפי מצב הקוד ב-09.11.2026 (קומיט `55f99728`); הם עלולים לזוז.

---

## 1. סיכום פסקי הדין (09.11)

### ניתן להחליף — נבדק עד הסוף

| # | קוד ידני | תחליף שכבר זמין | הערה מרכזית |
|---|---|---|---|
| 1 | `sha256Hex` ×5 | `crypto.hash('sha256', data)` (Node) | פלט זהה בכל סוגי הקלט עד 50MB [M] |
| 2 | `parseEnvFile` (relocation) | `util.parseEnv` (Node) | שונה רק במקרי קצה — ושם מתקן שבירה קיימת (§6.2) |
| 3 | `withTimeout` ב-RDP | `.abortSignal(AbortSignal.timeout(ms))` של supabase-js | היום העבודה ממשיכה ברקע אחרי הדדליין [M] |
| 4 | `withTimeout` בדוחות owner-agent | אותו דבר | שינוי רחב — נוגע בפונקציות משותפות |
| 5 | בניית client של Microsoft Graph ב-`exchange-ews/graph-impl.ts` | `graphClient()` הקיים ב-`microsoft/graph-client.ts` | הקוד זהה לחלוטין [M] |
| 6 | `fetch` גולמי ל-Graph ב-`relocation/external.ts` | חבילת `@microsoft/microsoft-graph-client` עצמה (לא המודול הקיים) | ה-SDK מנסה שוב גם POST — סיכון למנוי כפול [I] |
| 7 | 8 מתוך 16 פניות `fetch` ידניות ל-Meta | `openapi-fetch` + טיפוסים מה-spec של Meta (כבר בשימוש ב-`whatsapp/graph-client.ts`); ליצירת תבנית גם `@kapso` `templates.create` | **הכרעת בעלים:** האם שכבה מוקלדת מה-spec נחשבת "ספרייה" |
| 8 | עזרי שעון ישראל כפולים (G1, G2, G3, G5a–c) | עזרים קיימים בפרויקט / Temporal / date-fns | אפס הבדלים על ~287 אלף רגעים, כולל מעברי שעון קיץ [M] |
| 9 | פורמט `datetime-local` ×3 | `format` של date-fns | date-fns כבר מיובא באותו קובץ |
| 10 | שכבת ה-UI של `PlacesAutocomplete` | `@base-ui/react/autocomplete` | נבדק בקוד המקור, לא בדפדפן; שני הבדלי התנהגות |
| 11 | `PayloadViewer` | למחוק — קוד מת | 0 הפניות [M] |
| 12 | הגבלת קצב ×3 ב-server actions | פונקציה משותפת (`createMiddleware` של next-safe-action) | איחוד פנימי; לספרייה אין rate limit |

### לא ניתן להחליף — נבדק עד הסוף

| קוד | למה |
|---|---|
| `inputClass` ב-34 קבצים | `ui/input` משנה מראה (גובה, פינות, פוקוס); 12 קבצים עם `<select>` דורשים שכתוב |
| זיהוי קישורים ב-`event-edit-dialog.tsx` | `linkifyjs` לא מזהה טלפונים; `linkText` הוא לוגיקת תצוגה שלנו |
| 8 פניות Meta (oauth, smb_app_data, debug_token ×2, מנויי אפליקציה ×3, marketing_messages) | אין מקבילה באף ספרייה מותקנת |
| מודול `microsoft/graph-client.ts` בתוך relocation | `server-only` זורק תחת tsx; פרטי הזדהות במפה ולא ב-`process.env` |
| שעון-קיר → רגע (G4) | כבר מבוסס Temporal |
| שם האזור כנתון (G6) | נתון למערכת חיצונית, לא חישוב |
| `rdp-access/cli/format.ts` (G5d) | פורמט שונה מהעזר הקיים |

---

## 2. Meta / WhatsApp — פניות `fetch` ידניות מול ספריות מותקנות

**על מה בנוי `src/lib/whatsapp/graph-client.ts`:** `openapi-fetch` 0.17.0 (`graph-client.ts:3,27`) עם טיפוסים מ-
`src/lib/whatsapp/generated/*.d.ts`, שנוצרו מה-spec הרשמי של Meta ע"י `scripts/meta-types.mjs` [M]. בשימוש היום ב-
`template-health.ts:49` וב-`add-waba-phone-number.ts:123` [M].

| # | מקום | נקודת קצה ושימוש | פסק דין | ראיות |
|---|---|---|---|---|
| 1 | `data/admin/channels.ts:97` | GET `/{phone}?fields=display_phone_number,verified_name` ("בדוק חיבור", `actions.ts:91`) | **ניתן להחליף** (openapi-fetch) | `account-number.d.ts`: path 7, op 32/217, `fields` 230, שדות 56/61 [M]. פסיק מקודד ל-`%2C` כמו ב-template-health |
| 2 | `whatsapp/health.ts:121`, `:153` | GET `/{phone}?fields=HEALTH_FIELDS`; GET `/{waba}/phone_numbers?fields=id&limit=50`. קורא: `run-health-check.ts:159` | **ניתן להחליף**, בתנאי ש-`throughput` יתווסף ב-`patchSpec` (`meta-types.mjs:103`) | `throughput` חסר ב-`account-number.d.ts:46-132`; השנייה ב-`phone-number-management.d.ts:33,260`; `error.code` ב-180 [M] |
| 3 | `whatsapp/phone-numbers.ts:86`, `:117` | GET `/{waba}/phone_numbers` עם fallback לשדות, מעבר עמודים, appsecret_proof. קוראים: `provider-numbers.ts:312` (קורא `name_status`, `throughput`, `platform_type` ב-333-336), `whatsapp-es.ts:227` | **ניתן להחליף**, עם 3 שינויים | (1) 3 שדות חסרים ב-`phone-number-management.d.ts:72-114` → patchSpec; (2) עמודים לפי `cursors.after` (158-169); (3) proof דרך middleware `onRequest` (`openapi-fetch index.d.ts:152-154`). ב-kapso אין רשימת phone_numbers [M] |
| 4 | `embedded-signup/graph.ts:48` | GET `/oauth/access_token` | **לא ניתן** | אין spec; 0 תוצאות בכל הספריות [M] |
| 5 | `embedded-signup/graph.ts:70` | POST `/{waba}/subscribed_apps` עם proof | **ניתן להחליף**, proof דרך middleware | `subscribed-apps.d.ts:42,338`; `query?: never` ב-340; `success` 112-117 [M] |
| 6 | `embedded-signup/graph.ts:89` | GET `/{phone}?fields=is_on_biz_app,platform_type` עם proof | **ניתן להחליף**, עם middleware | `account-number.d.ts:103,131` [M] |
| 7 | `embedded-signup/graph.ts:131` | POST `/{phone}/smb_app_data` | **לא ניתן** | אין spec; 0 תוצאות [M] |
| 8 | `whatsapp/debug-token.ts:84` | GET `/debug_token`. קוראים: `meta-status.ts:85`, `whatsapp-es.ts:203` | **לא ניתן** | דף ה-spec מחזיר 500 (`meta-types.mjs:18-20`); ב-SDK רק `getAppID` על v22.0 [M] |
| 9 | `whatsapp/subscriptions.ts:99` (GET), `:163` (POST) | `/{app-id}/subscriptions` ברמת האפליקציה | **לא ניתן** | אין spec; ב-SDK קיים אך קשיח ל-v22.0 (`api.js:23-25`) ו-`call()` זורק פרמטרים [M] |
| 10 | `whatsapp/client.ts:342-343` | POST `/{phone}/marketing_messages` (MM Lite) | **לא ניתן — כבר עובר דרך ספרייה** | יוצא דרך `$$apiFetch$$` של whatsapp-api-js (`lib/index.d.ts:178`); רק ה-URL ידני [M] |
| 11 | `relocation/env-validation.ts:251-252` | GET `/debug_token` בלי גרסה (טוקן Ads) | **לא ניתן** | כמו #8 [M] |
| 12 | `relocation/preflight.ts:730` | GET `/{waba}/message_templates`, עמוד אחד | **ניתן להחליף** (openapi-fetch ישירות, כי tsx + `server-only`) | `message-templates.d.ts:19,384,397,402` [M]. kapso לא הוכרע: `templates.list` מסנן `fields` וממיר ל-camelCase |
| 13 | `relocation/external.ts:204` | POST `/{app-id}/subscriptions` עם `fields: "messages"` | **לא ניתן** | כמו #9. ראו §6.4 |
| 14 | `relocation/meta-templates.ts:311` | GET `message_templates` עם עמודים. קוראים: `steps.ts:164,270` | **ניתן להחליף** (openapi-fetch ישירות) | listMessageTemplates עם `after` [M] |
| 15 | `relocation/meta-templates.ts:332` | POST `/{waba}/message_templates`. קורא: `steps.ts:283` | **ניתן להחליף — שתי דרכים** | (א) openapi-fetch `createMessageTemplate` (`message-templates.d.ts:26,537`); (ב) kapso `templates.create` (`d.ts:939`): צריך `graphVersion=GRAPH_API_VERSION` (ברירת מחדל v23.0), timeout דרך fetch מותאם, מיפוי `GraphApiError` [M] |

**מה משתנה בכל מעבר ל-openapi-fetch:** להעביר `Authorization` ב-`params.header` (חובה ב-spec, כמו ב-template-health) [M];
openapi-fetch קורא ל-fetch עם `Request` (`index.d.ts:8`) — בדיקות שקוראות את הארגומנט כמחרוזת יתעדכנו [I].

**`facebook-nodejs-business-sdk` 22.0.3 לא מתאים לאף מקום:** לא תלות ישירה (מגיע דרך `meta-ads-cli@0.1.0`), אין טיפוסים,
גרסה קשיחה v22.0 מול `GRAPH_API_VERSION=v25.0` [M].

**למה שלוש ספריות WhatsApp:**
- `whatsapp-api-js` — שליחה לאורחים (`client.ts`), אימות חתימת webhook (`route.ts:3,304`), הורדת מדיה (`whatsapp-import.ts:18,434`), owner-agent media (`adapter.ts:192-201`).
- `@kapso/whatsapp-cloud-api` — רק requestCode / verifyCode / register / deregister (`phone-numbers.ts:227,241,256,270`).
- `@chat-adapter/whatsapp` — רק owner-agent (`adapter.ts:4`), החלטת בעלים 27.9 (`adapter.ts:10-11`).
- יש חפיפה ביכולות; החלוקה היסטורית [I].

**לא נבדק:** שום דבר בזמן ריצה; שדות ברירת המחדל של message_templates; האם Graph מקבל app token כ-Bearer.

---

## 3. ממשק משתמש

### 3.1 `inputClass` ב-34 קבצים — לא ניתן להחליף בלי שינוי חזותי [M]
השוואה מול `src/components/ui/input.tsx:12`:
- גובה: `h-8` (32px) מול אוטומטי עם `py-2` (~38px; ~42px ב-5 קבצי לקוח בלי text-sm) — מחלקות [M], פיקסלים [I].
- פינות `rounded-lg` 10px מול `rounded-md` 8px (`globals.css:45,136-137`); ריפוד `px-2.5 py-1` מול `px-3 py-2`.
- גופן `text-base md:text-sm` (16px במובייל) מול `text-sm` קבוע.
- פוקוס: `focus-visible:border-ring ring-3 ring-ring/50` מול `focus:border-primary ring-2 ring-primary/15` (19 קבצים), ללא פוקוס (14), `outline-2` (assign-form).
- רקע `bg-transparent` מול `bg-background` (28/34). מצבים חדשים: `aria-invalid`, `disabled:opacity-50`, placeholder muted.
- הוכחה מהמאגר: `PlacesAutocomplete` מקבל `cn(inputClass, 'h-auto')` (`new-event-form.tsx:140`, `edit-event-form.tsx:292`).

חלוקה:
- **א. `<input>` בלבד — התנהגות זהה, שינוי חזותי (12):** agreement-client, agreement-config-form, policy-form, dnc-client, integrations/_components/form-fields, channel-catalog-editor, send-policy-form, voximplant-rule-field, reports-panel, review-card, roles-client, exchange-manager.
- **ב. textarea / read-only — שינוי חזותי נוסף (9):** contract-body-editor, company-form, faq-catalog-editor, voximplant-credentials-form, support-client, templates-client, user-detail-gate (textarea: `field-sizing-content min-h-16` ב-`textarea.tsx:10` — `rows` כנראה מפסיק לקבוע גובה [I]); `_form-fields.tsx`, settings-client (read-only — ל-Input אין סגנון שדה נעול).
- **ג. `<select>` רגיל — לא ניתן (12):** assign-form, allowlist-panel, alerts-client, offer-form, package-form, user-actions, edit-event-form, guest-form, guest-list-controls, celebrant-fields, new-event-form, team-client. `ui/select.tsx` הוא Base UI Select עם API שונה — שכתוב.
- **ד. לא הוכרע (1):** sumit-card-form — סקריפט SUMIT קורא שדות לפי `data-og`.
- `ui/label.tsx:12` שונה במראה מ-55 התוויות המקומיות; `field.tsx` של shadcn לא מותקן.

### 3.2 `PlacesAutocomplete` — שכבת ה-UI בלבד ניתנת להחלפה ב-`@base-ui/react/autocomplete` 1.9.0
נבדק בקוד המקור, לא בדפדפן.
- פריטים מרוחקים: `filter={null}` (`autocomplete/root/AutocompleteRoot.js:61`) [M].
- ערך מבוקר `value`/`onValueChange`; טקסט חופשי נשלח בטופס (`combobox/input/ComboboxInput.js:151`) [M].
- בחירה: `itemToStringValue` (`AutocompleteRoot.js:78,81`); Enter מפעיל `listItem.click()` (`combobox/utils/parts.js:50-57`) [M].
- Enter בלי פריט מודגש משאיר שליחת טופס (`ComboboxInput.js:329`) [M].
- Portal/Positioner, `--anchor-width`, RTL דרך `useDirection` (`useAnchorPositioning.js:98-99`).
- **הבדלים:** (1) Escape כשהרשימה סגורה מוחק את הקלט (`ComboboxInput.js:290-300`) — למנוע עם `details.cancel()` כש-`reason === 'escape-key'` (`AriaCombobox.js:509-513`); (2) `loopFocus` עובר דרך שדה הקלט (`AriaCombobox.d.ts:87-93`).
- נשאר בקוד שלנו: debounce, session token, הגנה מתשובות ישנות, `fetchFields`, נפילה לשדה רגיל, "Powered by Google".
- אין עטיפת shadcn ל-combobox; `places-autocomplete.test.tsx` מקבע את ממשק ה-props.

**מה בנוי ידנית בקובץ היום (508 שורות, נקרא במלואו):** רשימת ההצעות ב-`createPortal` (431-503), חישוב מיקום עם מאזיני
גלילה/שינוי גודל (146-175), ניווט מקלדת (339-364), ARIA combobox (392-410, 465-476), סגירה אחרי 120ms ב-blur (412-427, 474).
הנתונים עצמם מגיעים מ-Google Places API (New) (209-221, 310) — לא ידני.

### 3.3 זיהוי קישורים ב-`event-edit-dialog.tsx` — לא ניתן להחליף [M]
- `find()` של linkifyjs לא מוצא `050-123-4567`, `+972-50-1234567`, `03 123 4567`; הקוד שלנו כן (`PHONE_SRC`, `:166`).
- URL: זהה בעברית צמודה ובפיסוק סופי; `find()` מוסיף דומיינים בלי scheme, מיילים, `ftp:`; טוב יותר ב-`Foo_(bar)`; גרוע יותר במקף en dash.
- `linkText` (`:190`) ממפה נתיבים פנימיים לתוויות בעברית; `BodyWithLinks` (`:219`) מוסיף טקסט ו-`dir="ltr"`.
- linkifyjs 4.4.0 מגיע רק דרך `@tiptap/extension-link`; ייבוא ישיר מחייב תלות רשומה.

### 3.4 `PayloadViewer` — קוד מת [M]
`find_referencing_symbols` ריק (בקרה: `JsonTree` נמצא ב-`webhook-detail.tsx:19,380,394`). `JsonTree` (`:133`) כבר משתמש ב-`react-json-view-lite`.
מסמכים שעדיין מתארים אותו כפעיל: `docs/project/09-admin-panel.md:205`, `docs/design/page-design-briefs.md:786,791,796`,
`docs/design/ui-component-inventory.md:544,550,562`, `docs/design/audit-fragments/area-admin-ops.md:134,139,144,201,207,238`,
`plans/webhook-inspector-plan.md:71,190`, `plans/webhook-ui-wiring-plan.md:34`.

---

## 4. תאריכים ושעון ישראל

53 המופעים של `'Asia/Jerusalem'` ב-`src/lib`: 16 כותרות בקבצים מחוללים (`sms/generated`), 22 הערות, 15 קוד ב-13 שורות [M].
החישובים כבר נשענים על Intl או Temporal — הבעיה היא כפילות.

| קבוצה | מקומות | פסק דין | ראיות |
|---|---|---|---|
| G1 תאריך קלנדרי (YYYY-MM-DD) | עזר קיים `event-date.ts:20` `israelCalendarDay`. עותקים: `date.ts:191,280,309`, `console-calls.ts:147` (בשימוש 161, 775 — למרות שמייבא את העזר ב-14), `run-stats.ts:16,34`, `agreement-archive.ts:75`, `conversation.ts:332,340` | **ניתן להחליף** | 0 הבדלים ב-287,026 רגעים × 7 אזורי זמן, 1948–2040, כל דקה במעברי 2026 [M]. `date.ts` לא יכול לייבא מ-`event-date.ts` (מעגל) — העזר צריך לעבור ל-`date.ts` [I] |
| G2 רכיבי שעון קיר | `send-window.ts:28,35`, `schedule-policy.ts:91,98` (גם `callback-scheduling.ts:153`), `console-calls.ts:153,160`, `date.ts:280,293`, `planner.ts:42,60` | **ניתן להחליף, בתנאי** | 0 הבדלים [M]. **מלכודת:** ב-Temporal `dayOfWeek` 1=שני…7=ראשון — חובה `% 7`, אחרת יום ראשון נחשב סגור בשקט. `schedule-policy.ts:87-89` מתעד החלטה לא להיות תלוי ב-send-window |
| G3 `addCalendarDays` | `schedule-policy.ts:106` מול `date.ts:212` | **ניתן להחליף** | 0 הבדלים ב-47,480 זוגות [M]. בקלט לא תקין schedule-policy גולש בשקט (`'2026-02-30'+1 → '2026-03-03'`), date.ts מחזיר null; לא בר-הגעה [I] |
| G4 שעון קיר → רגע | `event-date.ts:178,194` (Temporal); עטיפות `send-window.ts:55`, `schedule-policy.ts:115`, `planner.ts:128` | **לא ניתן (כבר ספרייה)** | m=1440: הקוד שלנו נותן 00:00 של מחר; Temporal עם hour 24 מצמצם ל-23:00 [M]. `TZDate` לפי רכיבים תלוי באזור השרת — פסול [M] |
| G5a `template-spec` dateFmt/timeFmt | `template-spec.ts:108,114` מול `date.ts:74,80` | **ניתן להחליף** בעזר הקיים | 0 הבדלים מתוך 59,649 × 4 [M] |
| G5b `event-display` weekdayFmt | `event-display.ts:37` | **ניתן**, אם נשמרת הקידומת "יום " | [M] |
| G5c vox `fmtInTz` | `vox-call-history.ts:130` | **ניתן להחליף** (date-fns `format` + TZDate, כמו `graph-impl.ts:190`) | 0 הבדלים מתוך 34,368 × 4 [M] |
| G5d rdp `formatTime` | `rdp-access/cli/format.ts:11` | **לא ניתן באופן זהה** | `12.7.2026, 17:30:05` מול `12.07.2026, 17:30` [M] |
| G6 שם האזור כנתון | `ops/summary.ts:80`, `owner-agent/runner.ts:479`, `consumer/main.ts:51`, `validation/owner-agent-reports.ts:40`, `vox-call-history.ts:46`, `reply-text.ts:57` | **לא ניתן** | זה נתון; הכפילות היחידה היא המחרוזת מול `date.ts:20` `ISRAEL_TIME_ZONE` |
| datetime-local ×3 | `event-edit-dialog.tsx:121`, `calendar-client.tsx:86`, `reschedule-form.tsx:19` | **ניתן להחליף** — date-fns `format(d, "yyyy-MM-dd'T'HH:mm")` | 0 הבדלים מתוך 43,367 × 4 [M]; date-fns כבר מיובא ב-`calendar-client.tsx:5` |

dayjs 1.11.23 מותקן אבל אף קובץ ב-`src` לא מייבא אותו.

---

## 5. שרת

### 5.1 `parseEnvFile` → `util.parseEnv` — ניתן להחליף [M]
- API: `@types/node/util.d.ts:1183-1196`, Stability 1.1, מ-v20.12; בלי ExperimentalWarning בהרצה.
- `process.loadEnvFile` לא מתאים — כותב ל-`process.env` ולא מחזיר מפה (`process.d.ts:1661-1674`).
- קוראים: `steps.ts:149` (~25 שימושים), `install-steps.ts:82,86,527`, `wiring-helpers.ts:67`, `setup-form.ts:258`, `scripts/relocate/cli.ts:69,289`.
- זהה ב: גרשיים, `#` בתוך גרשיים, `=` בערך, CRLF, מפתח כפול, עברית, ערך ריק, JSON.
- שונה ב: `export A=1`, הערה בסוף שורה (נחתכת ב-parseEnv), `https://x/#frag`, `\n` בגרשיים כפולים, ערך רב-שורתי, מפתחות כמו `123BAD`.
- על הקבצים האמיתיים (רק שמות מפתחות הודפסו): `.env.example` — 36 ערכים שונים, כולם בגלל הערה בסוף שורה; `.env.local` — 4 שונים (3 מפתחות `SUMIT_*` מקבלים אצלנו את טקסט ההערה כערך; `VOX_CI_CREDENTIALS` — ראו §6.3).
- `process.loadEnvFile` = parseEnv ב-83/83; Next.js (`@next/env` 16.4.5) תואם parseEnv ב-82/83 ולפרסר שלנו ב-80/83.
- מה ישתנה: טיפוס `Dict<string>` לעומת `Record<string,string>` תחת strict [I]; `preflight.test.ts:46-66`. תקדים: `worker/main.ts:129-140`, `worker/start.mjs:28-36` כבר עברו ל-`loadEnvFile`. מחוץ להיקף: `readEnvVar` ב-`instagram-token-refresh.ts`.

### 5.2 `sha256Hex` ×5 → `crypto.hash` — ניתן להחליף [M]
- API: `@types/node/crypto.d.ts:2880-2884`, פלט ברירת מחדל hex (`:2826-2831`). אין סימון Stability [I]; בלי אזהרה בהרצה.
- מקומות וקלט: `agreements/pdf.ts:50` (Uint8Array), `data/agreement-archive.ts:197` (Uint8Array), `data/vox-log-export.ts:54` (Buffer|string), `security/token-compare.ts:11` (string, מיובא ב-11 קבצים), `fleet/publish-social.ts:46` (Buffer|string).
- שוויון על string, עברית, אימוג'י, Buffer, Uint8Array, ריק, 50MB; אותה מהירות.
- מה ישתנה: mock ב-`agreements.test.ts:15-18,88`; בדיקות `pdf.test.ts:109`, `token-compare.test.ts`, `publish-social.test.ts:68-79`. עוד ~20 מקומות inline של `createHash…digest('hex')` (למשל `otp.ts:20`, `schedule.ts:111`, `webhooks.ts:72`, `token-fingerprint.ts:8`); שניים מחזירים Buffer (`token-compare.ts:21`, `setup-form.ts:95`) → `crypto.hash(..., 'buffer')`.

### 5.3 `withTimeout` → `.abortSignal(AbortSignal.timeout(ms))`
API: `postgrest-js/dist/index.d.mts:1477` (2.119.0).
- **RDP — ניתן להחליף [M]:** `checkRdpTunnel` (`service.ts:191-204`) — RPC אחד, עד פעמיים דרך `retryOnDeadlock`; `decideXrdpLogin` (`xrdp-login.ts:41-65`) — select + RPC. אין עבודה שאינה Supabase. בביטול מתקבל error אחרי ~103ms, ה-catch מחזיר 503 כמו היום.
  - **ההבדל:** postgrest-js מנסה שוב GET/HEAD אחרי 503/520 (1, 2, 4 שניות; `index.mjs:176-233`). במדידה: עם העוטף הנוכחי — 4 קריאות כעבור 7.5 שניות; עם abort — אף קריאה אחרי הביטול.
  - **לא הוכרע:** האם Postgres מבטל משפט שכבר רץ (רלוונטי ל-audit של `rdp_check_tunnel`, לפי המיגרציות `20261006170320_…:505-536`).
- **דוחות — ניתן, שינוי רחב [M]:** 6 cores, ~45 ספירות ו-2 RPC (`rsvp.ts:63-69`, `billing.ts:71-85`). נוגע בפונקציות משותפות (`countActiveCalls` — גם `voximplant-concurrency.ts:28`; `countOpenContacts`; `countNewCallbackRequests`; cores של `owner-agent/tools/*`). השגיאה תשתנה מ-`report_content_timeout` לקוד הכשל של ה-core; `content.test.ts:150-159` ו-`@/test/fake-count-client` יתעדכנו. `db.timeout` של הלקוח מגביל כל fetch לחוד, לא תקציב כולל.

### 5.4 הגבלת קצב ×3 — איחוד, לא ספרייה [M]
`r/[token]/actions.ts` (~35-49), `rate/[token]/actions.ts` (~26-39), `cb/[token]/actions.ts` (~47-57) — אותו רצף: `headers()` → `getClientIp` →
`tokenFingerprint` → `rateLimit(<prefix>:<fp>:<ip>, RATE)` → `returnUserError(t(key, fallback))`. שונים: prefix, קצב, מפתח i18n וטקסט.
`createMiddleware` (`next-safe-action/dist/index.d.mts:10-28`) הוא פונקציית זהות בזמן ריצה (`index.mjs:745-747`) — טיפוסים בלבד.
מפתחות ה-bucket מקובעים בבדיקות; מפתח i18n כמשתנה לא ייאסף ב-`i18next-cli extract` [I].

### 5.5 Microsoft Graph
- **`exchange-ews/graph-impl.ts:60-80` → `graphClient()` — ניתן להחליף [M]:** זהה ל-`graph-client.ts:29-51` (אותם 3 משתני env, credential, scope). `mailboxPath(cfg)` נשאר.
- **relocation (`external.ts:247-297`):** המודול `graph-client.ts` **לא שמיש** — `server-only` זורק תחת tsx (`package.json:75`), פרטי הזדהות במפה ולא ב-`process.env`, singleton עם פרטים ישנים [M]. **ה-`fetch` הגולמי ניתן להחלפה בחבילה עצמה** (אין בה `server-only`) [M]; אבל ה-SDK זורק `GraphError` על כל לא-2xx, timeout דרך `.option('signal', …)` (`GraphRequest.js:257-264`), ו-**RetryHandler מנסה שוב POST** על 429/503/504 עד 3 פעמים (`RetryHandler.js:50-60,189-194`) — סיכון למנוי כפול [I].

---

## 6. באגים שנמצאו בדרך (לא קשורים להחלפה)

1. **[תוקן 09.11]** טופסי היצירה והעריכה בלוח, תאריך הסיום של סדרה וברירת המחדל בטופס התזמון מחדש של שיחה חוזרת
   מציגים וקוראים עכשיו שעון ישראל דרך `ilDateTimeInputValue` ו-`wallClockToDate` (`src/lib/data/event-date.ts`), עם
   בדיקות שרצות כשהמחשב מכוון לניו יורק. `fleet/fleet-goals.tsx` עדיין ממיר בשעון הדפדפן — ממתין להחלטת בעלים אם המסך נחוץ.
   התיאור המקורי: **לוח השנה, אזור זמן של הדפדפן [I — מורכב מחלקים שנמדדו, לא הורץ בדפדפן]:** פורמט ה-datetime-local קורא getters של Date — בדפדפן שלא מכוון לשעון ישראל יוצא שעון הדפדפן (נמדד: אותו רגע 10:30 בשרת NY, 17:30 בישראל). תאי התצוגה השבועית הם TZDate בשעון ישראל (`time-grid.tsx:892,999`, `event-calendar-lib.tsx:30,35`), והשמירה מפרשת `new Date(local)` באזור הדפדפן (`calendar-client.tsx:337`, `event-edit-dialog.tsx:127`). תוצאה: אירוע שנוצר/נערך זז בהפרש האזורים. `wallClockToDate` (`event-date.ts:194`) לא בשימוש במסלולים האלה; `reschedule-form.tsx:9-13` מתעד אותה מגבלה.
2. **אשף העברת השרת — הערה בסוף שורת `APP_ORIGIN` [M]:** `rewriteEnvContent` (`env-rewrite.ts:32-35`) משאיר את ההערה; הפרסר שלנו מחזיר `https://new.example # …`, בדיקת `steps.ts:484` נכשלת ו-`new URL` ב-`cli.ts:79` זורק `ERR_INVALID_URL`. ב-`.env.example` יש הערה כזו; ב-`.env.local` הנוכחי אין. עם `util.parseEnv` שתיהן עוברות.
3. **`.env.local` — שורת `VOX_CI_CREDENTIALS` פגומה [M]:** שתי מחרוזות בגרשיים; כל קורא מקבל ערך אחר. היום אין השפעה (`VOXIMPLANT_CREDENTIALS_FILE` לא מוגדר, והחלופה `vox_ci_credentials.json` היא אותו קובץ).
4. **רישום webhook ל-Meta ב-relocation [I]:** `relocation/external.ts:204` רושם עם `fields: "messages"` בלבד, בעוד `subscriptions.ts` דורש 6 (`WHATSAPP_WEBHOOK_FIELDS`). לא נבדק אם ה-POST מחליף את רשימת השדות אצל Meta.
5. **RDP — כרטיס חד-פעמי עלול להישרף [I]:** כי `withTimeout` לא עוצר את העבודה, `consume` (`xrdp-login.ts:63`) עלול לרוץ אחרי שהכניסה כבר נדחתה ב-503.
6. **מסמכים לא מעודכנים:** `PayloadViewer` מתואר כפעיל ב-6 מסמכים (§3.4).

---

## 7. החלטות פתוחות לבעלים

1. **Meta:** האם `openapi-fetch` עם הטיפוסים שנוצרים מה-spec של Meta נחשב "קוד ספרייה" שמחליף `fetch` ידני (8 מקומות)?
2. **`inputClass`:** מעבר ל-`ui/input` משנה מראה ב-21 קבצים — לאשר שינוי חזותי, או להשאיר?
3. **G2:** `schedule-policy.ts:87-89` מתעד החלטה לא להיות תלוי ב-`send-window` — לאחד בכל זאת לעזר אחד?

---

## 8. ביקורת הארכיטקטורה (08.11) — עיקרי הממצאים

הדוחות המלאים ב-[`architecture-audit-2026-11-08/`](architecture-audit-2026-11-08/) (באנגלית, לפי שהוגשו).

**האם הפרויקט עומד בכלל? לא.**
- **קבצים ענקיים:** לפחות 58 קבצים מעל ~400 שורות. הבולטים: `src/lib/data/console-calls.ts` (3,706 שורות, ≥12 תפקידים),
  `src/lib/relocation/steps.ts` (פונקציה אחת ~980 שורות), `softphone-panel.tsx` (1,054), `manage-client.tsx` (1,003),
  `src/lib/voximplant/core.ts` (1,024 — יוחלף ב-`@voximplant/apiclient-nodejs`), `worker/main.ts`.
- **הפרדת UI / לוגיקה / API:** server actions ודפים ניגשים ישירות ל-DB (למשל `import-actions.ts:56-348`); route handlers מחזיקים לוגיקה
  עסקית (webhook WhatsApp 95-266, `console/event` 110-295); רכיבי דפדפן ניגשים ל-Supabase (softphone: 5 קריאות + כתיבות);
  שכבת `data/` מחזיקה קריאות לספקים וקוד תצוגה.
- **כפילויות:** שלד פקודת שיחה ×6, ~12 קוראי `app_settings`, 3 גרסאות מיסוך טלפון, `settle()` ×3 בתשלומים,
  קריאות SUMIT ×4, `json()` עוטף ב-30 נתיבים, ביטוי הטוקן ×7.
- **עומד:** server actions דרך `actionClient` אחד + Zod, עם בדיקת ההרשאה בשכבת הנתונים; רכיבי לקוח מייבאים מ-`@/lib/data` טיפוסים בלבד.
- **ממצאי אבטחה מ-08.11:** תוקנו מאז — IP בפעולות הקמפיין (`f1874f10`) והכתיבה הכפולה בטופס האישור (`330c923d`).
  **לא נבדקו מחדש:** `agreements.ts:143-160` (סטטוס לפני בדיקת בעלות), `relocation/setup-form.ts:236` (הזרקת שורות ל-`.env.local`),
  `support.ts:104-113,261-273` (כתיבת `support_access_log` בעקיפת `recordStaffAccess`), `auth/callback/route.ts:12-13` (בדיקת redirect מקומית).
- **לא נבדק בכלל:** הכלל "הערה קצרה לכל פונקציה".
