# מיפוי i18n: אזור admin

מפה מלאה לפי מחרוזת של 259 הקבצים ב-`files-admin.txt`. הרשומות ב-`admin.jsonl`. כאן: הטבלה לפי קובץ, ארבע תשובות הגודל, והסעיפים שהתדריך דורש.

קיצורים: `A/` = `src/app/(admin)/admin/`, `D/` = `src/lib/data/admin/`. ב-JSONL הנתיבים מלאים.

יחידת המדידה: מחרוזת = literal עברי אחד בקוד (טקסט JSX, string או template), בלי הערות, לפי עץ התחביר של TypeScript. כל literal קיבל רשומה אחת. ספירה עצמאית שנייה, בסורק נפרד, נתנה 4,112, כלומר הפרש של פחות מ-0.5%.

## סיכום

| מדד | ערך |
|---|---|
| קבצים | 259 (49,951 שורות), 88 מהם `'use client'` |
| רשומות | 4,127 |
| מפתחות ייחודיים | 3,746 |
| טקסטים ייחודיים לתרגום | 3,196, כ-16,500 מילים |
| `action` | convert 2,979, restructure 1,033, keep 97, decide 18 |
| `scope` | render 3,307, module 820 (ב-119 קבצים) |
| `ns` | admin 4,016, common 4, ריק 107 (רשומות `keep` ו-10 רשומות לוגיקה בלי מפתח) |
| `audience` | staff 4,027, internal 96, customer 4 |
| `kind` | jsx-text 1,907, const 679, jsx-attr 474, action-result 328, other 308, error-thrown 268, zod 65, metadata 61, log 36, outbound 1 |
| `flags` | dynamic-key 665, concat 376, logic 217, rich-text 189, plural 83, legal 24, gender-slash 1, outbound 1, legal-signed 0, worker 0, b2b-wording 0 |

**ממה מורכב `restructure` (1,033):**

| סיבה | רשומות |
|---|---|
| מנגנון 4: טקסט ב-module scope | 679 |
| מנגנון 1: הודעה שנזרקת ומגיעה לצוות דרך שער עברית | 203 |
| מנגנון 7: הודעת Zod ב-module scope | 63 |
| מנגנון 5: `metadata` סטטי | 57 |
| לוגיקה: טקסט שמשווים אליו, בלי מפתח תרגום | 10 |
| מקרים בודדים, ההסבר ב-`note` | 21 |

**ממה מורכב `keep` (97):**

| סיבה | רשומות |
|---|---|
| `throw` בנתיב render בלבד: בפרודקשן מוצג error boundary כללי | 56 |
| כותרות Slack, כולל 3 תוויות שנכנסות רק לכותרת | 36 |
| `throw` בפונקציה בלי קורא בפרודקשן (`getWebhookInboxItem`) | 1 |
| גוף SMS הבדיקה (`outbound`) | 1 |
| דוגמת מילות התנגדות בעברית ב-`A/offers/offer-form.tsx:338` | 1 |
| שם אירוע לדוגמה שלא מוצג ב-`D/agreements.ts:122` | 1 |
| הערה שנשמרת בשורת התשלום ב-`D/payment-review.ts:294` | 1 |

**`decide` (18):** כולן הטקסט ההיסטורי המתוארך ב-`A/debug/_panels.tsx`, שורות 655-681. החלטת בעלים 6.

**למה שלושה דגלים הם 0:**

- `legal-signed`: נוסח החוזה לא נמצא בקוד. `D/agreements.ts` קובע במפורש שאין נוסח ברירת מחדל, והנוסח יושב ב-`agreement_documents`. הטקסט במסכי העריכה הוא ממשק, וסומן `legal` כשהוא נוגע בחוזה או בהסכמה.
- `worker`: כל הקבצים הם pages, Server Actions או DAL עם שער הרשאה, כלומר רצים בתוך בקשה (מוסק מהקוד, לא נבדק בריצה).
- `b2b-wording`: חיפוש "אירועי חברה" ו"כנס חברה" על כל הרשומות נתן 0.

למה המספרים שונים ממקורות אחרים:

- **lint:** מצא 1,124 ממצאים בקבצים האלה (1,081 בעברית), כ-27% מהמחרוזות. הוא לא רואה מה שמחוץ ל-JSX, והוא מפספס טקסט בתוך רכיבים כמו `CardTitle`, `TableHead`, `AlertTitle` (נמדד). הסיבה כנראה ברירת המחדל של `acceptedTags` בתיעוד של i18next-cli (מוסק).
- **instrument:** דיווח 565, אבל הספירה שלו לא מוגבלת לעברית: ל-`src/components/ui/button.tsx`, שאין בו עברית, הוא רושם 13 (נמדד). הערך של עברית ב-module scope הוא 820.
- **הרשומה בזיכרון "3,498 שורות ב-218 קבצים":** יחידה אחרת (שורות, לא מחרוזות) ומדידה קודמת. אין סתירה.

## 1. גודל לפי תיקייה

| תיקייה | קבצים | מחרוזות | module scope | convert | restructure | keep | decide | client |
|---|---|---|---|---|---|---|---|---|
| `integrations` | 57 | 985 | 199 | 783 | 201 | 1 | 0 | 29 |
| `lib/data/admin` | 41 | 583 | 188 | 96 | 394 | 93 | 0 | 0 |
| `voice` | 16 | 269 | 65 | 202 | 65 | 2 | 0 | 6 |
| `fleet` | 14 | 178 | 34 | 144 | 34 | 0 | 0 | 6 |
| `calendar` | 6 | 174 | 65 | 109 | 65 | 0 | 0 | 3 |
| `assignments` | 7 | 164 | 31 | 133 | 31 | 0 | 0 | 2 |
| `analytics` | 5 | 153 | 11 | 142 | 11 | 0 | 0 | 1 |
| `cancellations` | 5 | 150 | 35 | 114 | 36 | 0 | 0 | 2 |
| `callbacks` | 9 | 140 | 10 | 130 | 10 | 0 | 0 | 4 |
| `webhooks` | 4 | 130 | 30 | 100 | 30 | 0 | 0 | 1 |
| `templates` | 7 | 129 | 20 | 105 | 24 | 0 | 0 | 2 |
| `debug` | 4 | 123 | 7 | 98 | 7 | 0 | 18 | 1 |
| `settings` | 6 | 95 | 5 | 90 | 5 | 0 | 0 | 3 |
| `users` | 6 | 91 | 2 | 89 | 2 | 0 | 0 | 3 |
| `rdp-access` | 10 | 82 | 11 | 71 | 11 | 0 | 0 | 3 |
| `packages` | 8 | 71 | 3 | 68 | 3 | 0 | 0 | 3 |
| `dnc` | 3 | 61 | 17 | 44 | 17 | 0 | 0 | 1 |
| `agreement` | 6 | 60 | 1 | 59 | 1 | 0 | 0 | 3 |
| `relocation` | 4 | 60 | 17 | 43 | 17 | 0 | 0 | 1 |
| `offers` | 6 | 51 | 3 | 47 | 3 | 1 | 0 | 2 |
| `events` | 3 | 47 | 5 | 42 | 5 | 0 | 0 | 1 |
| `payments` | 4 | 46 | 17 | 29 | 17 | 0 | 0 | 1 |
| `roles` | 3 | 44 | 13 | 31 | 13 | 0 | 0 | 1 |
| `contacts` | 6 | 41 | 6 | 35 | 6 | 0 | 0 | 3 |
| `support` | 2 | 38 | 1 | 37 | 1 | 0 | 0 | 1 |
| `faq` | 3 | 35 | 3 | 32 | 3 | 0 | 0 | 1 |
| `cookie-consent` | 3 | 28 | 1 | 27 | 1 | 0 | 0 | 1 |
| `activity` | 1 | 22 | 5 | 17 | 5 | 0 | 0 | 0 |
| `company` | 3 | 22 | 1 | 21 | 1 | 0 | 0 | 1 |
| `recordings` | 1 | 20 | 11 | 9 | 11 | 0 | 0 | 0 |
| שורש `admin/` | 4 | 17 | 1 | 16 | 1 | 0 | 0 | 2 |
| `campaigns` | 1 | 12 | 1 | 11 | 1 | 0 | 0 | 0 |
| `access-log` | 1 | 6 | 1 | 5 | 1 | 0 | 0 | 0 |
| **סה"כ** | **259** | **4,127** | **820** | **2,979** | **1,033** | **97** | **18** | **88** |

הקבצים הכבדים ביותר:

| קובץ | מחרוזות | module scope | client |
|---|---|---|---|
| `A/debug/_panels.tsx` | 119 | 7 | לא |
| `A/integrations/owner-agent/audit-table.tsx` | 118 | 104 | לא |
| `A/analytics/page.tsx` | 114 | 1 | לא |
| `D/labels.ts` | 107 | 105 | לא |
| `A/callbacks/[id]/page.tsx` | 73 | 1 | לא |
| `A/cancellations/[id]/page.tsx` | 73 | 8 | לא |
| `A/integrations/owner-agent/reports-panel.tsx` | 71 | 27 | כן |
| `D/activity.ts` | 70 | 42 | לא |
| `A/assignments/[id]/page.tsx` | 67 | 10 | לא |
| `A/webhooks/webhook-detail.tsx` | 64 | 0 | לא |

לא נדרש שינוי `'use client'` באף קובץ: `getT` הוא פונקציה רגילה, ו-`rating-form.tsx`, שהוא `'use client'`, כבר משתמש בה (נבדק בקריאה, לא בריצה).

## 2. קבצי admin שחשובים גם אם admin נשאר בעברית

### קוד שאינו admin ומייבא מ-admin

נבדק ב-`find_referencing_symbols`, בלי קובצי בדיקה.

| קובץ admin | מי מייבא מבחוץ | קהל | מה עושים אם admin נשאר בעברית |
|---|---|---|---|
| `D/labels.ts`: `DELIVERY_STATUS_LABELS`, `deliveryStatusLabel`, `deliveryStatusVariant` | `guests/labels.ts` (re-export), `guests/page.tsx`, `guests/[guestId]/page.tsx`, `campaign/[campaignId]/manage-client.tsx` | **לקוח** | 4 מחרוזות (נשלח, נמסר, נקרא, נכשל) עוברות ל-`common`. ב-JSONL הן כבר `ns: common`, `audience: customer`, מפתחות `deliveryStatus.*`. הן ב-module scope, אז נדרש restructure |
| `D/labels.ts`: `aiCallSourceLabel`, `callAnalysisSuccessfulLabel`, `salesDispatchStatusLabel` | `src/lib/callbacks/activity-timeline.ts` | צוות | כלום. הקובץ הזה מיובא רק מ-admin |
| `D/campaigns.ts` (4 מחרוזות) | `campaign/[campaignId]/page.tsx` | אף אחד בפועל | כלום. ארבעתן `throw` בנתיב render, ולכן `keep` |
| `D/events.ts` (7: שש הודעות וכותרת Slack) | `campaign/campaign-actions.ts`, פעולה שמוגדרת שם כ-Staff-only | צוות, בתוך נתיב לקוח | החלטת בעלים 3 |
| `D/access-log.ts` (3) | `src/lib/data/campaigns.ts`, `api/campaigns/[id]/status/route.ts` | צוות, בתוך נתיב לקוח | החלטת בעלים 3 |
| `D/callbacks.ts` (7) | `src/lib/data/exchange-connections.ts` | צוות | כלום. הכותרת של הקובץ מגדירה אותו כ-NOT CUSTOMER-FACING |

ללא עברית, ולכן ללא השפעה: `D/rdp-access`, `D/nav-counts`, `D/nav-visibility` (type בלבד ב-`admin-shell.tsx`). הקובץ היחיד מחוץ ל-admin שמייבא מ-`src/app/(admin)` הוא בדיקה: `src/lib/auth/permissions.local-it.test.ts`.

### טקסט משותף ש-admin מייבא

admin מייבא ישירות 84 קבצים חיצוניים שיש בהם עברית (1,277 מחרוזות). הם שייכים לאזורים אחרים, ואין לספור אותם כאן. בטבלה רק הקבצים שמשותפים גם ללקוח או לציבור. המשמעות: אחרי שיומרו ל-`t()` הם יציגו את שפת הבקשה גם בתוך admin, אלא אם admin ננעל ל-`he` (מנגנון 2).

| קובץ משותף | מחרוזות | קבצי admin שמייבאים |
|---|---|---|
| `src/lib/date.ts` | 104 | 29 |
| `src/lib/validation/schemas.ts` | 74 | 6 |
| `src/lib/data/event-labels.ts` | 52 | 8 |
| `src/components/payments/campaign-payments.tsx` | 34 | 1 (`A/cancellations/[id]/page.tsx`) |
| `src/lib/data/event-cancellation.ts` | 31 | 4 |
| `guests/labels.ts` (לקוח) | 19 | 1 (`D/support.ts`) |
| `src/lib/data/celebrant-display.ts` | 11 | 1 |
| `src/lib/faq/page-model.ts` | 8 | 4 |
| `src/components/pagination.tsx` | 7 | 2 |
| `src/lib/agreements/template.ts` | 6 | 3 |
| `src/components/forms.tsx` | 1 | 66 |
| `src/lib/safe-action.ts` | 1 | 37 |

### קוד של admin בלבד שרשום אצל אזורים אחרים

36 קבצים עם 539 מחרוזות מיובאים רק מ-admin (לפי גרף imports סטטי ב-`src`, מוסק לגבי קריאות מחוץ ל-`src`). הם לא ברשימה הזו ולא ב-`admin.jsonl`. אם admin נשאר בעברית, האזורים האחרים יכולים לדלג עליהם.

הגדולים: `src/lib/rdp-access/copy.ts` 120, `src/components/admin-shell.tsx` 43, `src/lib/validation/owner-agent.ts` 37, `src/lib/whatsapp/value-labels.ts` 37, `src/lib/exchange-ews/category-colors.ts` 25, `src/lib/data/exchange-connections.ts` 24, `src/lib/fleet/conversation.ts` 20.

`src/lib/validation/admin.ts` אינו בקבוצה הזו: מייבאים אותו גם שני routes של Voximplant ו-`callback-scheduling.ts`.

## 3. איזה טקסט ב-admin גם לקוחות ואורחים רואים

**סוג 1: טקסט ממשק של admin שמגיע ללקוח.** רק מחרוזות המסירה ב-`D/labels.ts` (סעיף 2). מתוך 47 הסמלים ב-`D/labels.ts`, אלה היחידים שמגיעים למסך לקוח (נמדד).

**סוג 2: תוכן שנכתב במסכי admin, נשמר ב-DB ומוצג ללקוח.** `t()` לא יכול לתרגם אותו, ולכן אין לו רשומה ב-JSONL. נדרש אחסון לפי שפה, בלי קשר להחלטה על admin. זו ההחלטה החשובה ביותר בסעיף הזה.

| מסך | טבלה | לאן זה מגיע |
|---|---|---|
| `A/faq` | `faq_items` | `src/lib/data/faq.ts` ואז `/faq` הציבורי |
| `A/packages` | `packages`: `name`, `description`, `includes` | `src/lib/data/package-offers.ts`, דרך `src/lib/data/campaigns.ts` ו-`public-business-facts.ts`, לעמודי approve ו-payment ולטוקנים של FAQ. התצוגה בפועל מוסקת מהטופס ("מוצגת ללקוחות") |
| `A/company` | `company_profile` | `src/lib/data/company.ts` ואז `_legal.tsx`, about, cookies, privacy, דף הבית ו-`package-terms-step.tsx` |
| `A/agreement` | `agreement_documents` | `src/lib/data/agreements-doc.ts` ואז `package-terms-step.tsx`. זה נוסח חתום, נשאר כמו שהוא |
| `A/agreement/agreement-config-form.tsx` | עמודות `agr_*`, טקסט חופשי כמו "5 ימי עסקים" | `getAgreementConfigTokens` ואז `package-terms-step.tsx` ו-`src/lib/data/agreements.ts` (נבדק ב-LSP). נכנס לנוסח החתום, נשאר כמו שהוא |

**סוג 3: טקסט יוצא שמורכב ב-admin.** בקוד יש מחרוזת יוצאת אחת: גוף SMS הבדיקה ב-`A/integrations/extra-sms/actions.ts:67` (`outbound`, `keep`). שאר המסלולים הם טקסט שצוות מקליד או תוכן DB, ולכן אין להם רשומה:

- מענה לפנייה: `A/contacts`, דרך `inquiryReplyEmail` ב-`D/contacts.ts`.
- הודעת החלטת ביטול במייל: `A/cancellations/[id]/resolve-form.tsx:322`.
- תבניות WhatsApp: `A/templates`.

**סוג 4: ענפי צוות בתוך נתיבי לקוח.** 9 הודעות: 6 ב-`D/events.ts` ו-3 ב-`D/access-log.ts`. לקוח לא רואה אותן, אבל איש צוות על כתובת לקוח באנגלית יראה אותן בעברית. 4 המחרוזות ב-`D/campaigns.ts` נזרקות בנתיב render, ובפרודקשן לא מגיעות למסך.

**מסכי admin שמציגים טקסט משותף:**

- `A/cancellations/[id]`: `campaign-payments.tsx`, `event-cancellation.ts`.
- `A/support`: `guests/labels.ts`, `celebrant-display.ts`.
- `A/agreement`: תצוגה מקדימה של החוזה דרך `src/lib/agreements/template.ts`.
- `A/faq`: המשפט המשפטי מ-`buildProtectedPricingMandatorySentence`.
- `A/templates`, `A/campaigns`: `event-labels.ts`.

**לא נכלל, אחרי בדיקה:**

- `A/offers`: שם ההצעה הוא לצוות בלבד, לפי הטופס עצמו.
- קטלוג הערוצים: `src/lib/data/channel-catalog.ts` מיובא רק מ-admin.
- `A/cookie-consent`: חולק רק את הקבוע `CONSENT_REVISION`. טקסט הבאנר נשאר ב-`cookie-consent-config.ts`.

## 4. עלות: לתרגם מול להשאיר בעברית

| | לתרגם את admin | להשאיר בעברית |
|---|---|---|
| קוד | 4,012 מחרוזות ב-259 קבצים (2,979 convert, 1,033 restructure), עוד 18 לפי החלטה, ועוד 539 ב-36 קבצי admin-only | 4 מחרוזות עוברות ל-`common` |
| שינוי מבנה | 1,033 ברשימה, ועוד 341 ב-module scope ב-36 הקבצים. בנוסף 189 רשומות טקסט מפוצל סביב אלמנט, 376 רשומות שנבנות סביב ערך ו-83 רשומות plural | אין |
| תרגום | 3,196 טקסטים ייחודיים, כ-16,500 מילים לכל שפה. עם 36 הקבצים כ-18,300 מילים לשפה, כ-36,600 בשתי השפות, ועוד סקירה עצמאית לכל שפה. להשוואה, ב-`public` יש היום 148 מפתחות ו-783 מילים | 0 |
| מנגנון שגיאות | חובה לשנות (מנגנון 1): 203 הודעות נזרקות ב-admin תלויות בו | לא נדרש בשביל admin. נדרש ממילא בשביל הלקוח |
| תחזוקה | כל שינוי ב-admin מוסיף מפתחות לתרגום. ב-90 הימים האחרונים 254 מתוך 1,186 commits נגעו ב-admin, לעומת 105 בלקוח ו-41 בציבורי | אין |
| תוצאה | עדיין חלקית: שמות חבילות, גוף תבניות, FAQ, חוזים, תוויות תפקידים והרשאות, שמות ערוצים ומחלקות ומונחי חוק ישראלי נשארים בעברית | admin עברי ו-RTL לגמרי |
| מגבלה | | איש צוות שלא קורא עברית לא יכול לעבוד. 9 הודעות עבריות בענפי צוות בתוך נתיבי לקוח |
| הפיכות | | אפשר לתרגם בכל שלב מאוחר יותר. שום דבר בהשארה לא חוסם את זה |

מספר המילים של 36 הקבצים מגיע ממדידת הגודל. הם לא מופו כאן.

במילים פשוטות: תרגום admin גדול פי כ-23 ממה שתורגם עד היום, המחיר נמשך בכל שינוי, והתוצאה תישאר חלקית. ההשארה זולה והפיכה, אבל סוגרת את admin בפני מי שלא קורא עברית. ההכרעה תלויה בהחלטת בעלים 1.

## פריטים שאינם טקסט (נראו, לא תוקנו)

נספר על הקוד בלי הערות.

- **`he-IL`:** 10 מופעים ב-6 קבצים: `A/analytics/_sections.tsx` 4, `A/voice/_meters.tsx` 2, `A/cancellations/[id]/page.tsx`, `A/offers/offer-form.tsx`, `A/templates/templates-client.tsx`, `A/webhooks/webhook-detail.tsx`. ב-`webhook-detail.tsx` זה `Intl.DateTimeFormat` ב-module scope. 29 קבצים תלויים ב-`src/lib/date.ts`.
- **locale קשיח אחר:** `localeCompare(..., 'he')` ב-`D/activity.ts` (2, אחד מהם בזמן טעינת המודול) וב-`D/owner-agent.ts`; `new Intl.DisplayNames(['he'])` ב-`A/integrations/numbers/add-number-wizard.tsx`; `JSON_FORMS_I18N` עם `locale: 'he'` ב-`A/templates/template-admin-client.tsx`; `locale={he}` ו-`weekStartsOn={0}` ו-`ISRAEL_WEEKEND` ב-`A/calendar/calendar-client.tsx`; דפוסי date-fns עם ב קשיחה ב-`A/calendar`.
- **מטבע:** `₪` או `'ILS'` קשיחים ב-10 קבצים. `$` קשיח ב-`D/voximplant-channel.ts:391`, בדיקת החיבור.
- **חצים פיזיים:** 39 אייקונים (`ArrowLeft/Right`, `ChevronLeft/Right`) ב-18 קבצים. בנוסף 22 חצים מוקלדים בתוך טקסט (`← → ▸`) ב-16 קבצים, והם חלק מהמחרוזת. למשל "← חזרה למוקד", ו-`D/contacts.ts`: "מערכת ותפעול ← הגדרות".
- **`dir`:** 224 `ltr` ב-75 קבצים, 9 `auto`, 3 `rtl` קשיח: `A/agreement/contract-body-editor.tsx`, `A/faq/faq-catalog-editor.tsx`, `A/packages/package-copy-field.tsx`. ה-`ltr` על מזהים, טלפונים ומפתחות, ושם הוא נכון בכל שפה (נראה בקריאה).
- **צד פיזי:** `side="right"` ב-`A/webhooks/webhook-inspector-client.tsx`, `side` פיזי ב-`A/integrations/numbers/add-number-wizard.tsx`, `mr-2` ב-`A/users/[id]/user-actions.tsx`.
- **`lang`:** אין. **`DirectionProvider`:** אין בקבצי הרשימה. ב-`A/agreement/agreement-config-form.tsx` וב-`A/fleet/fleet-goals.tsx` הוא מופיע רק בהערה. ה-provider עצמו ב-`src/components/admin-shell.tsx`, מחוץ לרשימה.
- **תאריך עברי:** אין שימוש ישיר. מונחי לוח יהודי במסכי מדיניות השליחה דורשים הערה למתרגם.
- **אנגלית קשיחה ליד העברית:** Debug Mode, Data collection, Evaluation, Phone Number ID, ו-`reserve … · low …`, `echo:`, `bytes`. לא במפה כי אין בהן עברית.

## סיכוני לוגיקה

הטקסט משמש גם להשוואה, ולכן תרגום ישנה התנהגות:

- `A/integrations/numbers/actions.ts:55`, `:98`: `message.startsWith('חסרים')`. המחרוזות עצמן ב-`D/integrations/number-registration.ts` וב-`D/integrations/provider-numbers.ts`.
- `A/integrations/numbers/actions.ts:145`: `message === 'המספר שנבחר אינו קיים'`, מ-`D/integrations/provider-numbers.ts:222`.
- `A/integrations/numbers/actions.ts:183`: `isUserFacing` בודק אות עברית. שער שני, נפרד מ-`safe-action.ts`.
- `A/integrations/owner-agent/actions.ts`: `isOwnerAgentUserError` ו-`isOwnerAgentReportUserError` משווים להודעות המדויקות. הטקסט ב-`src/lib/validation/owner-agent.ts`, מחוץ לרשימה.
- `A/templates/template-admin-client.tsx:212`: `p.startsWith('חסר ערך')`.
- `A/templates/template-admin-client.tsx:266`: `GROUP_ORDER` בעברית מושווה לשמות הקבוצות ב-`src/lib/whatsapp/value-labels.ts`.
- `A/templates/view-model.ts:103`: `problem.startsWith('התבנית כוללת')`, ובשורה 105 הטקסט נכנס ל-`code: mapping:${problem}`.
- `D/platform-roles.ts:587`: שלילת תפקיד מעבירה הלאה `error.message` בקוד `P0001`. הטקסט מגיע בעברית מטריגר ב-DB, ואינו במפה.
- `D/offers.ts:62`: `OfferFloorError` בונה את ההודעה בבנאי, ו-`A/offers/actions.ts:45` מציג `err.message`.
- `D/coupon-assignments.ts`: `e.action in EVENT_ACTION_LABELS` משתמש במפה גם כקבוצת מפתחות. המפה הסטטית של המפתחות חייבת להישאר.
- `D/activity.ts`: `ACTIVITY_ACTION_OPTIONS` ו-`ACTIVITY_ENTITY_OPTIONS` נבנים בזמן טעינת המודול, והשני גם ממוין בעברית.
- `A/calendar/actions.ts`: `fixedMessage(...)` רץ בזמן טעינת המודול, וערך ברירת מחדל `success = 'נשמר'` בחתימה.
- כותרות Slack: מפתח ה-dedup הוא `level|title|source` (`src/lib/alerts/slack.ts:93`), והן נשמרות ב-`ops_alerts` ומוצגות ב-`alerts-history` כמו שנכתבו. הן נשארות `keep`.

**כתיבה ל-DB:** literal אחד נכתב ל-DB: `D/payment-review.ts:294`, `הוכרע ידנית: …` בעמודת `note` של `payment_operations`. נבדק על כל מקומות הקריאה ב-literals של הרשימה. יומן הפעילות אינו סיכון כזה: `logActivity` כותב מפתחות באנגלית, והעברית נוצרת רק בתצוגה ב-`D/activity.ts`. סיבת ביקורת בעברית נמצאה מחוץ לרשימה: `src/app/api/campaigns/[id]/status/route.ts`, `reason: 'השהיית קמפיין מהקונסולה'`.

**תוויות מה-DB שמוצגות ב-admin ונשארות בעברית:** `platform_roles.label`, `platform_permission_definitions.label`, `channels.display_name`, `console_queues` (`nameHe`), `payment_operation_kinds.label_he`, `message_templates.label`.

## מנגנונים משותפים

1. **`src/lib/safe-action.ts`: הודעה שנזרקה מגיעה למשתמש רק אם יש בה עברית.** הקוד הוא `HEBREW.test(error.message) ? error.message : GENERIC_ACTION_ERROR`. אם הודעה שנזרקת תתורגם, המשתמש יקבל "הפעולה נכשלה. נסו שוב." במקום ההודעה. זה נוגע ב-203 הודעות נזרקות ב-admin, ולפי ההערה בקובץ ב-542 ב-`src/lib/data`, גם בפעולות לקוח. עטיפה ב-`t()` לא מספיקה. התיעוד של next-safe-action מדגים `handleServerError` עם `error instanceof <מחלקת שגיאה>`. ב-`D/payment-review.ts` כבר יש מחלקה כזו, `PaymentReviewError`, ו-`A/payments/actions.ts` בודק אותה ב-`instanceof`. זה הדפוס לחיקוי. אותו שינוי צריך לכסות את `isUserFacing` ואת ההשוואות שבסעיף סיכוני לוגיקה.
2. **נעילת admin ל-`he`.** היום `getT` מחזיר `getFixedT('he', ...)` לכולם. כשהשפה תגיע מהבקשה, רכיבים משותפים יתחלפו גם בתוך admin ויווצר מסך מעורב, ו-`lang`/`dir` של ה-root layout יושפעו. צריך כלל מפורש: `/admin` תמיד `he`, אם זו ההחלטה. עוד לא תוכנן כי ניתוב השפות עצמו לא נבנה.
3. **`lint.ignore`.** מתועד ב-i18next-cli: globs נוספים להתעלמות ב-lint. אם admin נשאר בעברית, זה מסיר 1,124 מתוך 1,863 ממצאים (60%). הצעה בלבד, לא בוצע.
4. **מפות תוויות.** 679 רשומות. ב-`D/labels.ts` כבר יש פונקציה לכל מפה (`deliveryStatusLabel` וכדומה), אז `getT` יכול להיכנס לתוכן, עם מפה סטטית של מפתחות. כך גם `dynamic-key` (665) נפתר: המפתחות נכתבים סטטית, ו-`extract` מוצא אותם. לכל הסוגים שנבנים מהמפה (picklists, `Object.keys`) צריך רשימת מפתחות סטטית.
5. **`metadata` סטטי.** 57 מופעים. תיעוד Next: מטא-דאטה דינמי דורש `generateMetadata`, ואי אפשר לייצא את שניהם מאותו segment.
6. **טקסט מפוצל סביב אלמנט.** 189 רשומות, ו-`Trans` לא מותקן. ה-lead בדק `Trans` על עותק, ולפי הבדיקה הזו נדרש `react-i18next` כתלות ישירה (לא נבדק כאן). כשיש שני משפטים שלמים סביב בלוק, שני מפתחות מספיקים, וזה מסומן ב-`note`.
7. **הודעות Zod.** 65 רשומות, 63 ב-module scope. תיעוד Zod: `error` מקבל פונקציה שרצה בזמן הפענוח, ולכן `{ error: () => t(key, hebrew) }` מתאים גם לסכמה ב-module scope. צורות כמו `.min(10, 'טקסט')` צריכות לעבור לצורה הזו.
8. **plurals.** 83 רשומות. תיעוד i18next: בוחרים צורה לפי `count` עם סיומות `_one`, `_two`, `_other` וכדומה. לעברית יש `two`, ולפי בדיקת ה-lead כל plural צריך גם ערך ברירת מחדל רגיל, אחרת מוצג המפתח.

## החלטות בעלים

1. האם יעבדו ב-admin אנשי צוות שלא קוראים עברית? זה מה שקובע אם לתרגם את admin.
2. אם admin נשאר בעברית: האם `/admin` תמיד בעברית, גם למי שבחר שפה אחרת באתר?
3. איש צוות על כתובת לקוח בשפה אחרת: האם מקובל ש-9 הודעות בענפי הצוות יישארו בעברית?
4. תוכן שנשמר ב-DB (FAQ, חבילות, `company_profile`): האם נשמר לפי שפה, או נשאר בעברית? ההחלטה נדרשת בכל מקרה. החוזה ופרמטרי ההסכם לא בכלל הזה.
5. מענים שצוות מקליד ללקוח (פניות, החלטות ביטול): באיזו שפה נכתבים ללקוח שבחר אנגלית או צרפתית?
6. הטקסט ההיסטורי ב-`A/debug/_panels.tsx` (18 רשומות): לתרגם, להשאיר בעברית או למחוק?
7. אם admin מתורגם: האם להחריג מסכי בעלים בלבד (`debug`, `relocation`, `integrations/owner-agent`, `integrations/meta-whatsapp/connect`, `rdp-access/requests`)? ביחד 610 מחרוזות.

## כיסוי

259 of 259 files read. כל קובץ נקרא במלואו דרך Serena, עד השורה האחרונה, עם סימון של כל literal בשורה שלו. אף קובץ לא נכשל בקריאה.

בדיקות על הקובץ הסופי: 4,127 רשומות, כמספר ה-literals. לכל רשומת convert ו-restructure יש מפתח, חוץ מ-10 רשומות לוגיקה. אין מפתח אחד עם שני טקסטים שונים.

בדיקות מול שאר המפות והקוד:

- מול חמש המפות האחרות (`customer-auth`, `lib-data`, `lib-other`, `public`, `shared`): אין `(ns, key)` עם טקסט שונה, ואין קובץ שממופה פעמיים.
- כל `catch` בקבצי `A/` שאינם `actions.ts`: אף דף לא מציג `err.message` של פונקציה שסומנה `keep`. `A/debug/page.tsx` מציג `err.message` רק מפונקציות שמחוץ לרשימה, ו-`A/packages/new/page.tsx` כותב אותו ללוג בלבד.

מה מוסק ולא נבדק בריצה:

- `throw` בנתיב render נחשב כזה שלא מגיע למסך בפרודקשן. המסלולים נקבעו לפי קוראים ב-LSP, וההתנהגות לפי תיעוד Next.
- 203 רשומות מנגנון 1 סווגו לפי סוג הקורא: action קורא לפונקציה. לא נבדק לכל action בנפרד. חלק מה-actions תופסים את השגיאה ומחזירים טקסט קבוע, ואז הטקסט מה-DAL לא מגיע למסך. לכן המספר הוא גבול עליון.
- `worker` = 0, ואי-הצורך בשינוי `'use client'`.
- 36 הקבצים של admin בלבד לא נקראו כאן. הם שייכים לאזורים אחרים.
- המילים "מסכי בעלים בלבד" נשענות על שערי ההרשאה שנקראו בקוד, לא על בדיקה עם משתמש.

## לפי קובץ

ערכי עמודת הסיכון: `M1` הודעה שתלויה במנגנון 1, `logic` טקסט שמשתמשים בו גם כערך. שינוי `'use client'` לא נדרש בשום קובץ.

| קובץ | convert | restructure | keep | decide | module | `'use client'` | סיכון |
|---|---:|---:|---:|---:|---:|---|---|
| `A/_form-fields.tsx` | 4 | 0 | 0 | 0 | 0 | לא |  |
| `A/access-log/page.tsx` | 5 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/activity/page.tsx` | 17 | 5 | 0 | 0 | 5 | לא |  |
| `A/agreement/actions.ts` | 4 | 0 | 0 | 0 | 0 | לא |  |
| `A/agreement/agreement-client.tsx` | 16 | 0 | 0 | 0 | 0 | לא | rich-text 3 |
| `A/agreement/agreement-config-form.tsx` | 11 | 0 | 0 | 0 | 0 | לא | legal 4 |
| `A/agreement/config-actions.ts` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/agreement/contract-body-editor.tsx` | 16 | 0 | 0 | 0 | 0 | לא | Editor chrome only. The contract body itself is DB content (agreement_documents), legal-signed, and has no literal here. |
| `A/agreement/page.tsx` | 10 | 1 | 0 | 0 | 1 | לא | legal 1 |
| `A/analytics/_range-picker.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/analytics/_sections.tsx` | 24 | 8 | 0 | 0 | 8 | לא | plural 2, rich-text 1 |
| `A/analytics/_trend-chart.tsx` | 3 | 2 | 0 | 0 | 2 | לא | plural 1 |
| `A/analytics/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/analytics/page.tsx` | 113 | 1 | 0 | 0 | 1 | לא | GA4 labels like eventName, source and country arrive as data; the Hebrew mappers are in src/lib/analytics (other area). legal 2 |
| `A/assignments/[id]/page.tsx` | 57 | 10 | 0 | 0 | 10 | לא | rich-text 2 |
| `A/assignments/[id]/void-dialog.tsx` | 8 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/assignments/actions.ts` | 3 | 5 | 0 | 0 | 5 | לא |  |
| `A/assignments/new/assign-form.tsx` | 8 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/assignments/new/page.tsx` | 16 | 1 | 0 | 0 | 1 | לא | rich-text 2 |
| `A/assignments/page.tsx` | 41 | 10 | 0 | 0 | 10 | לא | plural 3, rich-text 4 |
| `A/assignments/void-refusals.ts` | 0 | 5 | 0 | 0 | 5 | לא |  |
| `A/calendar/actions.ts` | 9 | 3 | 0 | 0 | 3 | לא |  |
| `A/calendar/calendar-client.tsx` | 17 | 0 | 0 | 0 | 0 | לא | Also hard-coded: locale={he}, weekStartsOn={0}, ISRAEL_WEEKEND. rich-text 3 |
| `A/calendar/calendar-he.ts` | 0 | 32 | 0 | 0 | 32 | לא | logic 3, plural 7 |
| `A/calendar/event-edit-dialog.tsx` | 51 | 5 | 0 | 0 | 5 | לא | plural 6, rich-text 5 |
| `A/calendar/event-form-fields.tsx` | 28 | 24 | 0 | 0 | 24 | לא | REMINDER_OPTIONS is exported and also read by event-edit-dialog.tsx, so it moves with both. rich-text 5 |
| `A/calendar/page.tsx` | 4 | 1 | 0 | 0 | 1 | לא |  |
| `A/callbacks/[id]/page.tsx` | 72 | 1 | 0 | 0 | 1 | לא | Data collection and Evaluation are hard-coded English labels on this screen, outside this map. plural 1, gender-slash 1 |
| `A/callbacks/actions.ts` | 11 | 0 | 0 | 0 | 0 | לא |  |
| `A/callbacks/call-outcome-form.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/callbacks/cancel-callback-form.tsx` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/callbacks/page.tsx` | 10 | 1 | 0 | 0 | 1 | לא | plural 1 |
| `A/callbacks/policy/actions.ts` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/callbacks/policy/page.tsx` | 2 | 1 | 0 | 0 | 1 | לא |  |
| `A/callbacks/policy/policy-form.tsx` | 24 | 7 | 0 | 0 | 7 | לא |  |
| `A/callbacks/reschedule-form.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/campaigns/page.tsx` | 11 | 1 | 0 | 0 | 1 | לא |  |
| `A/cancellations/[id]/page.tsx` | 65 | 8 | 0 | 0 | 8 | לא | Free text in this page: resolutionNote is typed by staff and e-mailed to the customer; reason is typed by the customer. Neither is a literal here. CampaignPayments and EVENT_STATUS_LABELS come from shared files. plural 1, rich-text 7 |
| `A/cancellations/[id]/resolve-form.tsx` | 24 | 20 | 0 | 0 | 19 | לא | rich-text 1 |
| `A/cancellations/actions.ts` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/cancellations/page.tsx` | 23 | 6 | 0 | 0 | 6 | לא |  |
| `A/cancellations/sort-menu.tsx` | 1 | 2 | 0 | 0 | 2 | לא |  |
| `A/company/actions.ts` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/company/company-form.tsx` | 16 | 0 | 0 | 0 | 0 | לא | Form chrome. The values are DB content (company_profile) shown on public legal pages and in the package terms. |
| `A/company/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא | legal 1 |
| `A/contacts/actions.ts` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/contacts/contact-reply-form.tsx` | 5 | 0 | 0 | 0 | 0 | לא | Chrome only. The reply text is typed by staff and e-mailed to the customer through inquiryReplyEmail (D/contacts.ts). |
| `A/contacts/contact-search-bar.tsx` | 5 | 2 | 0 | 0 | 2 | לא |  |
| `A/contacts/contact-status-form.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/contacts/inquiry-thread.tsx` | 0 | 3 | 0 | 0 | 3 | לא |  |
| `A/contacts/page.tsx` | 19 | 1 | 0 | 0 | 1 | לא | plural 2 |
| `A/cookie-consent/actions.ts` | 14 | 0 | 0 | 0 | 0 | לא |  |
| `A/cookie-consent/cookie-consent-client.tsx` | 8 | 0 | 0 | 0 | 0 | לא | plural 1, rich-text 3 |
| `A/cookie-consent/page.tsx` | 5 | 1 | 0 | 0 | 1 | לא | legal 2 |
| `A/debug/_auto-refresh-toggle.tsx` | 1 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/debug/_panels.tsx` | 94 | 7 | 0 | 18 | 7 | לא | The page is platform-owner only (requirePlatformOwner). plural 11, rich-text 25 |
| `A/debug/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/debug/page.tsx` | 2 | 0 | 0 | 0 | 0 | לא | Debug Mode is hard-coded English in the metadata and heading. |
| `A/dnc/actions.ts` | 6 | 1 | 0 | 0 | 1 | לא |  |
| `A/dnc/dnc-client.tsx` | 37 | 15 | 0 | 0 | 15 | לא | rich-text 2, legal 11 |
| `A/dnc/page.tsx` | 1 | 1 | 0 | 0 | 1 | לא |  |
| `A/error.tsx` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/events/[id]/actions.ts` | 9 | 5 | 0 | 0 | 5 | לא |  |
| `A/events/[id]/page.tsx` | 22 | 0 | 0 | 0 | 0 | לא |  |
| `A/events/[id]/test-event-section.tsx` | 11 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/faq/actions.ts` | 4 | 2 | 0 | 0 | 2 | לא |  |
| `A/faq/faq-catalog-editor.tsx` | 24 | 0 | 0 | 0 | 0 | לא | Editor chrome. The questions and answers are DB content (faq_items) shown on the public /faq. rich-text 3, legal 2 |
| `A/faq/page.tsx` | 4 | 1 | 0 | 0 | 1 | לא | rich-text 3 |
| `A/fleet/actions.ts` | 12 | 26 | 0 | 0 | 26 | לא | What the owner types here goes to AI agents as data; only the validation and notices are UI text. |
| `A/fleet/conversation-list.tsx` | 18 | 3 | 0 | 0 | 3 | לא | plural 2 |
| `A/fleet/conversation-scroller.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/fleet/error.tsx` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/fleet/fleet-agent-avatar.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/fleet/fleet-attachments.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/fleet/fleet-bubble-actions.tsx` | 13 | 0 | 0 | 0 | 0 | לא | rich-text 4 |
| `A/fleet/fleet-composer.tsx` | 30 | 0 | 0 | 0 | 0 | לא | plural 2, rich-text 4 |
| `A/fleet/fleet-goals.tsx` | 22 | 4 | 0 | 0 | 4 | לא | plural 1, rich-text 4 |
| `A/fleet/fleet-message-bubble.tsx` | 24 | 0 | 0 | 0 | 0 | לא | plural 1, rich-text 6 |
| `A/fleet/fleet-stream.tsx` | 2 | 0 | 0 | 0 | 0 | לא | plural 1 |
| `A/fleet/layout.tsx` | 1 | 1 | 0 | 0 | 1 | לא |  |
| `A/fleet/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/fleet/page.tsx` | 11 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/integrations/_components/form-fields.tsx` | 7 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/_components/outreach-master-switch.tsx` | 4 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/integrations/actions.ts` | 32 | 2 | 0 | 0 | 2 | לא |  |
| `A/integrations/cardcom/actions.ts` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/cardcom/cardcom-config-form.tsx` | 19 | 6 | 0 | 0 | 6 | לא | legal 1 |
| `A/integrations/cardcom/cardcom-status-card.tsx` | 9 | 3 | 0 | 0 | 3 | לא |  |
| `A/integrations/cardcom/page.tsx` | 8 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/integrations/channel-catalog-editor.tsx` | 6 | 0 | 0 | 0 | 0 | לא | Display names here are DB content (channels); read only by admin screens. rich-text 2 |
| `A/integrations/extra-sms/actions.ts` | 8 | 0 | 1 | 0 | 1 | לא | plural 1, outbound 1 |
| `A/integrations/extra-sms/extra-key-status.tsx` | 11 | 0 | 0 | 0 | 0 | לא | plural 2, rich-text 2 |
| `A/integrations/extra-sms/extra-sms-form.tsx` | 12 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/extra-sms/extra-test-sms.tsx` | 4 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/extra-sms/page.tsx` | 14 | 1 | 0 | 0 | 1 | לא | rich-text 2 |
| `A/integrations/meta-whatsapp/connect/actions.ts` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/meta-whatsapp/connect/embedded-signup-launcher.tsx` | 28 | 6 | 0 | 0 | 6 | לא | rich-text 4 |
| `A/integrations/meta-whatsapp/connect/page.tsx` | 17 | 4 | 0 | 0 | 4 | לא | Owner-only page (requirePlatformOwner). rich-text 2 |
| `A/integrations/meta-whatsapp/meta-status-card.tsx` | 17 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/meta-whatsapp/page.tsx` | 13 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/integrations/meta-whatsapp/send-policy-form.tsx` | 25 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/meta-whatsapp/whatsapp-connection-test.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/meta-whatsapp/whatsapp-credentials-form.tsx` | 14 | 0 | 0 | 0 | 0 | לא | Field labels such as Phone Number ID and Access Token are English literals, outside this map. |
| `A/integrations/microsoft/microsoft-status-card.tsx` | 18 | 0 | 0 | 0 | 0 | לא | plural 3 |
| `A/integrations/microsoft/page.tsx` | 8 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/integrations/numbers/actions.ts` | 18 | 3 | 0 | 0 | 0 | לא | isUserFacing() (/[\u0590-\u05FF]/) decides whether a DAL message is shown. It must change together with M1. M1 1, logic 3, plural 4 |
| `A/integrations/numbers/add-number-wizard.tsx` | 40 | 4 | 0 | 0 | 4 | לא | Also hard-coded: new Intl.DisplayNames(['he'], { type: 'region' }). rich-text 7 |
| `A/integrations/numbers/meta-number-management.tsx` | 12 | 0 | 0 | 0 | 0 | לא | plural 2, rich-text 3 |
| `A/integrations/numbers/numbers-table.tsx` | 11 | 3 | 0 | 0 | 3 | לא | rich-text 1 |
| `A/integrations/numbers/page.tsx` | 12 | 1 | 0 | 0 | 1 | לא | plural 2, rich-text 1 |
| `A/integrations/numbers/roles-panel.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/numbers/sync-buttons.tsx` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/owner-agent/actions.ts` | 23 | 1 | 0 | 0 | 1 | לא | safeMessage() passes only messages matched exactly by isOwnerAgentUserError (OWNER_AGENT_ERRORS in src/lib/validation/owner-agent.ts). Translating those messages changes the match. |
| `A/integrations/owner-agent/allowlist-panel.tsx` | 58 | 0 | 0 | 0 | 0 | לא | Owner-only screen (requirePlatformOwner). rich-text 6 |
| `A/integrations/owner-agent/audit-table.tsx` | 14 | 104 | 0 | 0 | 104 | לא | Codes are stored; only the labels render. Open vocabulary: an unknown code shows raw by design. |
| `A/integrations/owner-agent/number-picker.tsx` | 13 | 2 | 0 | 0 | 2 | לא |  |
| `A/integrations/owner-agent/owner-agent-settings-forms.tsx` | 8 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/integrations/owner-agent/page.tsx` | 15 | 1 | 0 | 0 | 1 | לא | Owner-only screen (requirePlatformOwner). plural 1, rich-text 1 |
| `A/integrations/owner-agent/reports-actions.ts` | 12 | 0 | 0 | 0 | 0 | לא | safeMessage() passes only messages matched exactly by isOwnerAgentReportUserError. |
| `A/integrations/owner-agent/reports-panel.tsx` | 44 | 27 | 0 | 0 | 27 | לא | Report instructions typed here are passed to the agent as data and stay in the language they were typed in. plural 1, rich-text 2 |
| `A/integrations/page.tsx` | 15 | 1 | 0 | 0 | 1 | לא | rich-text 2 |
| `A/integrations/resend-email/actions.ts` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/resend-email/email-health-card.tsx` | 7 | 9 | 0 | 0 | 9 | לא |  |
| `A/integrations/resend-email/email-transport-form.tsx` | 16 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/resend-email/page.tsx` | 18 | 1 | 0 | 0 | 1 | לא | rich-text 11 |
| `A/integrations/slack/actions.ts` | 12 | 4 | 0 | 0 | 4 | לא |  |
| `A/integrations/slack/alerts-client.tsx` | 38 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/slack/alerts-history.tsx` | 9 | 8 | 0 | 0 | 8 | לא | Alert titles shown in this log are stored rows (Hebrew and English as sent), so they stay as written. |
| `A/integrations/slack/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/integrations/sumit/actions.ts` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/sumit/page.tsx` | 9 | 1 | 0 | 0 | 1 | לא | rich-text 3 |
| `A/integrations/sumit/sumit-credentials-form.tsx` | 7 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/sumit/sumit-status-card.tsx` | 8 | 4 | 0 | 0 | 4 | לא |  |
| `A/integrations/voximplant/page.tsx` | 19 | 1 | 0 | 0 | 1 | לא | rich-text 2 |
| `A/integrations/voximplant/voximplant-connection-test.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/voximplant/voximplant-credentials-form.tsx` | 19 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/voximplant/voximplant-personas.tsx` | 15 | 0 | 0 | 0 | 0 | לא | rich-text 3 |
| `A/integrations/voximplant/voximplant-rule-field.tsx` | 9 | 0 | 0 | 0 | 0 | לא |  |
| `A/integrations/voximplant/voximplant-status-card.tsx` | 6 | 0 | 0 | 0 | 0 | לא |  |
| `A/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/offers/[id]/delete-offer-form.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/offers/[id]/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/offers/actions.ts` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/offers/new/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/offers/offer-form.tsx` | 23 | 0 | 1 | 0 | 0 | לא |  |
| `A/offers/page.tsx` | 12 | 1 | 0 | 0 | 1 | לא | plural 3 |
| `A/packages/[id]/delete-package-form.tsx` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `A/packages/[id]/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/packages/actions.ts` | 4 | 0 | 0 | 0 | 0 | לא |  |
| `A/packages/new/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/packages/package-copy-field.tsx` | 13 | 0 | 0 | 0 | 0 | לא | The rewritten copy itself comes from the AI and is DB content once saved. |
| `A/packages/package-form.tsx` | 30 | 0 | 0 | 0 | 0 | לא | Form chrome. name, description and includes are DB content shown to customers. |
| `A/packages/page.tsx` | 4 | 1 | 0 | 0 | 1 | לא |  |
| `A/packages/rewrite-action.ts` | 8 | 0 | 0 | 0 | 0 | לא |  |
| `A/page.tsx` | 6 | 1 | 0 | 0 | 1 | לא |  |
| `A/payments/actions.ts` | 4 | 1 | 0 | 0 | 1 | לא |  |
| `A/payments/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/payments/review-card-facts.ts` | 0 | 2 | 0 | 0 | 2 | לא |  |
| `A/payments/review-card.tsx` | 22 | 13 | 0 | 0 | 13 | לא |  |
| `A/rdp-access/access-track.tsx` | 1 | 5 | 0 | 0 | 5 | לא |  |
| `A/rdp-access/actions.ts` | 3 | 0 | 0 | 0 | 0 | לא | The other messages come from src/lib/rdp-access/copy.ts (admin-only, other area). |
| `A/rdp-access/active-console.tsx` | 3 | 0 | 0 | 0 | 0 | לא | Most text on this screen comes from ACTIVE_COPY and DEVICES in src/lib/rdp-access/copy.ts (admin-only, other area). plural 2 |
| `A/rdp-access/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/rdp-access/page.tsx` | 15 | 0 | 0 | 0 | 0 | לא | plural 2 |
| `A/rdp-access/pending-panel.tsx` | 5 | 0 | 0 | 0 | 0 | לא | Most text on this screen comes from PENDING_COPY in src/lib/rdp-access/copy.ts. plural 3 |
| `A/rdp-access/request-form.tsx` | 1 | 0 | 0 | 0 | 0 | לא | Most text on this screen comes from FORM_COPY in src/lib/rdp-access/copy.ts. rich-text 1 |
| `A/rdp-access/requests/[id]/page.tsx` | 25 | 1 | 0 | 0 | 1 | לא | Owner-only screen. plural 1, rich-text 1 |
| `A/rdp-access/requests/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/rdp-access/requests/page.tsx` | 16 | 5 | 0 | 0 | 5 | לא | Owner-only screen. plural 2, rich-text 3 |
| `A/recordings/page.tsx` | 9 | 11 | 0 | 0 | 11 | לא |  |
| `A/relocation/_auto-refresh-toggle.tsx` | 1 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/relocation/_panels.tsx` | 40 | 16 | 0 | 0 | 16 | לא | Owner-only screen. Step, stage and gate labels come from .he fields in the relocation state (src/lib/relocation, other area). plural 5, rich-text 2 |
| `A/relocation/loading.tsx` | 1 | 0 | 0 | 0 | 0 | לא |  |
| `A/relocation/page.tsx` | 1 | 1 | 0 | 0 | 1 | לא |  |
| `A/roles/actions.ts` | 14 | 8 | 0 | 0 | 8 | לא |  |
| `A/roles/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/roles/roles-client.tsx` | 14 | 4 | 0 | 0 | 4 | לא | Role and permission labels on this screen are DB content (platform_roles, platform_permissions). |
| `A/settings/actions.ts` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/settings/exchange-actions.ts` | 11 | 0 | 0 | 0 | 0 | לא |  |
| `A/settings/exchange-manager.tsx` | 17 | 4 | 0 | 0 | 4 | לא |  |
| `A/settings/exchange-mode-toggle.tsx` | 5 | 0 | 0 | 0 | 0 | לא | rich-text 1 |
| `A/settings/page.tsx` | 9 | 1 | 0 | 0 | 1 | לא | rich-text 2 |
| `A/settings/settings-form.tsx` | 43 | 0 | 0 | 0 | 0 | לא | rich-text 6 |
| `A/support/page.tsx` | 2 | 1 | 0 | 0 | 1 | לא |  |
| `A/support/support-client.tsx` | 35 | 0 | 0 | 0 | 0 | לא | Shows the customer guest labels through D/support.ts; mealPref, rsvpNote and celebrantsText are guest or customer data. |
| `A/templates/[templateId]/page.tsx` | 13 | 1 | 0 | 0 | 1 | לא | The preview shows the Meta-approved template body (outbound content, read-only here). rich-text 1 |
| `A/templates/actions.ts` | 8 | 1 | 0 | 0 | 1 | לא |  |
| `A/templates/page.tsx` | 31 | 1 | 0 | 0 | 1 | לא | plural 2 |
| `A/templates/template-admin-client.tsx` | 22 | 8 | 0 | 0 | 5 | לא | logic 6 |
| `A/templates/template-admin-parts.tsx` | 2 | 3 | 0 | 0 | 3 | לא | WhatsAppPreview shows template text as guests receive it; that text is DB content from Meta. rich-text 1 |
| `A/templates/templates-client.tsx` | 25 | 2 | 0 | 0 | 2 | לא | Also hard-coded: toLocaleString('he-IL') in formatDateTimeIL. Call scripts typed in the body field are outbound content, stored in message_templates. rich-text 2 |
| `A/templates/view-model.ts` | 4 | 8 | 0 | 0 | 7 | לא | logic 1 |
| `A/users/[id]/page.tsx` | 3 | 1 | 0 | 0 | 1 | לא |  |
| `A/users/[id]/user-actions.tsx` | 40 | 0 | 0 | 0 | 0 | לא | rich-text 7 |
| `A/users/[id]/user-detail-gate.tsx` | 7 | 0 | 0 | 0 | 0 | לא |  |
| `A/users/[id]/user-detail-view.tsx` | 27 | 0 | 0 | 0 | 0 | לא |  |
| `A/users/actions.ts` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/users/page.tsx` | 7 | 1 | 0 | 0 | 1 | לא | plural 1 |
| `A/voice/_donut.tsx` | 2 | 0 | 0 | 0 | 0 | לא |  |
| `A/voice/_helpers.tsx` | 0 | 16 | 0 | 0 | 16 | לא | Exported label maps; also read by integrations/voximplant/page.tsx. |
| `A/voice/_meters.tsx` | 12 | 0 | 0 | 0 | 0 | לא | Also hard-coded: toLocaleString('he-IL') in QuotaProgressBar. |
| `A/voice/actions.ts` | 11 | 0 | 2 | 0 | 0 | לא |  |
| `A/voice/console-history/page.tsx` | 17 | 30 | 0 | 0 | 30 | לא |  |
| `A/voice/console/_console-client.tsx` | 6 | 8 | 0 | 0 | 8 | לא | snap.detail comes from src/lib/voximplant/web-client (outside this list). |
| `A/voice/console/page.tsx` | 4 | 1 | 0 | 0 | 1 | לא |  |
| `A/voice/events/[eventId]/page.tsx` | 40 | 3 | 0 | 0 | 3 | לא |  |
| `A/voice/page.tsx` | 27 | 1 | 0 | 0 | 1 | לא | rich-text 1 |
| `A/voice/platform/elevenlabs-key-form.tsx` | 5 | 0 | 0 | 0 | 0 | לא |  |
| `A/voice/platform/page.tsx` | 49 | 4 | 0 | 0 | 4 | לא | Hard-coded English next to the Hebrew: 'reserve … · low …', 'echo:'. plural 1 |
| `A/voice/platform/platform-actions.tsx` | 4 | 0 | 0 | 0 | 0 | לא |  |
| `A/voice/platform/wiring-card.tsx` | 11 | 0 | 0 | 0 | 0 | לא | rich-text 2 |
| `A/voice/queues/actions.ts` | 5 | 1 | 0 | 0 | 1 | לא |  |
| `A/voice/queues/page.tsx` | 4 | 1 | 0 | 0 | 1 | לא |  |
| `A/voice/queues/queues-client.tsx` | 5 | 0 | 0 | 0 | 0 | לא | q.nameHe is a Hebrew DB column shown as the queue title. rich-text 1 |
| `A/webhooks/actions.ts` | 1 | 1 | 0 | 0 | 1 | לא |  |
| `A/webhooks/page.tsx` | 20 | 29 | 0 | 0 | 29 | לא | Group labels carry a U+200E mark before the API path; keep it in the default value. |
| `A/webhooks/webhook-detail.tsx` | 64 | 0 | 0 | 0 | 0 | לא | Also hard-coded: Intl.DateTimeFormat('he-IL') at module scope; English 'bytes', 'billable', 'free'. plural 2, rich-text 2 |
| `A/webhooks/webhook-inspector-client.tsx` | 15 | 0 | 0 | 0 | 0 | לא | Sheet side="right" is physical. rich-text 2 |
| `D/access-log-view.ts` | 0 | 5 | 1 | 0 | 5 | לא | Label resolved inside the DAL and returned as subjectLabel. |
| `D/access-log.ts` | 0 | 3 | 0 | 0 | 0 | לא | M1 3 |
| `D/activity.ts` | 26 | 42 | 2 | 0 | 42 | לא |  |
| `D/agreements.ts` | 0 | 8 | 1 | 0 | 0 | לא | M1 8 |
| `D/alerts.ts` | 0 | 5 | 2 | 0 | 0 | לא | M1 5 |
| `D/call-dnc.ts` | 4 | 1 | 3 | 0 | 0 | לא | M1 1 |
| `D/callbacks.ts` | 0 | 5 | 2 | 0 | 0 | לא | M1 5 |
| `D/campaign-payment-status.ts` | 0 | 7 | 0 | 0 | 7 | לא |  |
| `D/campaigns.ts` | 0 | 0 | 4 | 0 | 0 | לא |  |
| `D/cancellation-list-money.ts` | 0 | 3 | 0 | 0 | 3 | לא | Spreads CAMPAIGN_PAYMENT_STATUS_LABELS, so both maps move together. |
| `D/channel-catalog.ts` | 0 | 1 | 1 | 0 | 0 | לא | M1 1 |
| `D/channels.ts` | 4 | 2 | 0 | 0 | 0 | לא | M1 2 |
| `D/console-history.ts` | 0 | 0 | 1 | 0 | 0 | לא |  |
| `D/contacts.ts` | 1 | 8 | 1 | 0 | 0 | לא | M1 8 |
| `D/cookie-consent.ts` | 0 | 4 | 1 | 0 | 0 | לא | M1 4 |
| `D/coupon-assignments.ts` | 6 | 23 | 2 | 0 | 8 | לא | M1 15 |
| `D/event-view.ts` | 0 | 0 | 1 | 0 | 0 | לא | Also returns EVENT_TYPE_LABELS / EVENT_STATUS_LABELS from src/lib/data/event-labels (shared, outside this list). |
| `D/events.ts` | 0 | 6 | 1 | 0 | 0 | לא | M1 6 |
| `D/faq.ts` | 0 | 6 | 1 | 0 | 0 | לא | M1 6 |
| `D/fleet.ts` | 0 | 31 | 16 | 0 | 0 | לא | M1 31 |
| `D/integrations/index.ts` | 3 | 1 | 0 | 0 | 1 | לא | Other cards take label and note from src/lib/ops/integrations (outside this list); permissionLabel is a DB value. |
| `D/integrations/meta-status.ts` | 3 | 0 | 0 | 0 | 0 | לא |  |
| `D/integrations/number-registration.ts` | 0 | 15 | 4 | 0 | 0 | לא | M1 15 |
| `D/integrations/provider-numbers.ts` | 0 | 9 | 1 | 0 | 0 | לא | M1 9 |
| `D/integrations/send-policy.ts` | 1 | 1 | 1 | 0 | 0 | לא | M1 1 |
| `D/integrations/whatsapp-es.ts` | 15 | 0 | 2 | 0 | 0 | לא |  |
| `D/labels.ts` | 2 | 105 | 0 | 0 | 105 | לא | Importable from client components (no server-only). Picklists built from these maps need a static key list. |
| `D/offers.ts` | 0 | 13 | 2 | 0 | 0 | לא | M1 10 |
| `D/outreach-master.ts` | 0 | 1 | 0 | 0 | 0 | לא | M1 1 |
| `D/owner-agent.ts` | 0 | 0 | 2 | 0 | 0 | לא | All thrown text comes from OWNER_AGENT_ERRORS in src/lib/validation/owner-agent (outside this list). |
| `D/packages.ts` | 3 | 5 | 3 | 0 | 0 | לא | M1 5 |
| `D/payment-review.ts` | 0 | 17 | 3 | 0 | 17 | לא | TERMINAL_CONFLICT_NOTICE comes from src/lib/payments/terminal-conflict-copy (outside this list). logic 1 |
| `D/platform-roles.ts` | 0 | 15 | 16 | 0 | 0 | לא | M1 15 |
| `D/settings.ts` | 2 | 6 | 6 | 0 | 0 | לא | M1 6 |
| `D/support.ts` | 0 | 6 | 2 | 0 | 0 | לא | Status and type labels come from event-labels and customer guests/labels (shared, outside this list). M1 6 |
| `D/test-events.ts` | 0 | 4 | 1 | 0 | 0 | לא | M1 4 |
| `D/users.ts` | 0 | 17 | 5 | 0 | 0 | לא | M1 17 |
| `D/voice-ops.ts` | 0 | 0 | 1 | 0 | 0 | לא |  |
| `D/voximplant-channel.ts` | 11 | 5 | 0 | 0 | 0 | לא | M1 5 |
| `D/webhook-inbox.ts` | 1 | 0 | 3 | 0 | 0 | לא | Role names come from ROLE_LABELS in src/lib/validation/provider-numbers (outside this list). |
| `D/whatsapp-templates.ts` | 14 | 14 | 1 | 0 | 0 | לא | Other problems strings come from parameterCoverageProblems and stepOutcome in src/lib/whatsapp (outside this list); template-admin-client.tsx compares them by prefix. M1 14 |
