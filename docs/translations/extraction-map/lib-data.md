# lib-data: מיפוי מחרוזות (`src/lib/validation`, `src/lib/data`)

1090 שורות ב-`lib-data.jsonl` (1079 ליטרלים בעברית, ועוד 11 שורות זוג `keep` לקריאות יוצאות של אותו ליטרל). מספרי שורה מתחילים ב-1. שדה `note` ב-jsonl כתוב באנגלית.

| convert | restructure | keep | decide |
|---:|---:|---:|---:|
| 85 | 529 | 464 | 12 |

כללי סיווג שהוחלו:
- Zod של לקוח, אורח ומבקר נכנס ל-`common` תחת `validation.*`. Zod של צוות בלבד נכנס ל-`admin`. הבריף כותב "common ... including validation"; פירשתי אותו כוולידציה משותפת. אם הכוונה לכל הוולידציה, צריך רק להחליף namespace ב-`admin`.
- זריקה מ-Server Action שלא נתפסת: `restructure` עם `logic` (M2).
- זריקה שמגיעה רק לרינדור Server Component: `keep`. לפי `error.md` של Next, בפרודקשן מוצגת הודעה גנרית עם digest.
- זריקה שהאקשן תופס ומחליף בטקסט שלו: `keep`, הליטרל לא מוצג.
- ליטרל שמשרת גם UI וגם ערוץ יוצא: שתי שורות, `restructure` ל-UI ו-`keep` עם `outbound`.

## טבלת קבצים

| file | convert | restructure | keep | decide | module | 'use client' change | risk |
|---|---:|---:|---:|---:|---:|---|---|
| data/agreement-archive.ts | 0 | 0 | 8 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/agreement-config.ts | 0 | 1 | 0 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/agreements.ts | 13 | 0 | 2 | 0 | 0 | no | 'לקוח KALFA' נכנס ל-PDF שנחתם ב-hash: נשאר. |
| data/archive-backup.ts | 0 | 0 | 7 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/archive-maintenance.ts | 0 | 0 | 9 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/authorized-fill.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/authorized-topup.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/auto-thankyou.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/billing.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/call-attempts.ts | 0 | 0 | 16 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/callback-intake.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/callback-request-attempts.ts | 0 | 0 | 12 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/callback-scheduling.ts | 0 | 0 | 11 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/callback-voice-processing.ts | 0 | 0 | 1 | 7 | 5 | no | טקסט נשמר ב-call_dnc_list וב-contact_messages: החלטת בעלים. |
| data/campaign-delivery.ts | 0 | 0 | 4 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/campaign-status.ts | 4 | 0 | 0 | 0 | 0 | no | wrap רגיל. |
| data/campaign-transition.ts | 0 | 2 | 10 | 0 | 2 | no | EVENT_NOT_CONFIRMED_ERROR וטקסט הקונפליקט בהשוואה מדויקת ב-route הקונסולה. |
| data/campaigns.ts | 0 | 21 | 6 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/cancellation-sms.ts | 0 | 0 | 7 | 0 | 0 | no | אין שינוי: ערוץ יוצא. |
| data/cardcom-document-processing.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/celebrant-display.ts | 0 | 11 | 2 | 0 | 6 | no | דקדוק עברי בשרשור שמות. celebrantNamesFor ו-eventHeadingFor חייבים להשתנות יחד. קול נשאר עברית. |
| data/channel-catalog.ts | 0 | 0 | 1 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/company.ts | 0 | 2 | 0 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/console-agent-calendar-presence.ts | 0 | 0 | 1 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/console-calls.ts | 1 | 0 | 14 | 2 | 0 | no | שמות ונושאים שנשמרים ונקראים בקול. push לצוות ללא שפת צופה. |
| data/console-monitor.ts | 0 | 0 | 1 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/contact-quota.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/contacts.ts | 0 | 1 | 8 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/coupon-benefits.ts | 0 | 2 | 0 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/elevenlabs-quota.ts | 0 | 0 | 21 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/elevenlabs-status.ts | 0 | 0 | 1 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/event-cancellation.ts | 5 | 19 | 7 | 0 | 1 | no | נתיב CancellationResolveError לא תלוי ב-M2; שאר הזריקות כן. משפט מורכב משברים בשורה 584. |
| data/event-date.ts | 0 | 1 | 0 | 0 | 0 | no | הליטרל משוכפל ב-CONFLICT_MESSAGES של route הסטטוס. |
| data/event-display.ts | 0 | 2 | 0 | 0 | 2 | no | Intl בסקופ מודול ותאריך עברי: ראו Non-text. |
| data/event-exchange-calendar-item.ts | 0 | 0 | 5 | 0 | 3 | no | נכתב ליומן העסקי: לא לפי שפת הלקוח. |
| data/event-labels.ts | 1 | 51 | 9 | 0 | 60 | no | EVENT_TYPE_LABELS משרת UI וגם WhatsApp וקול: פיצול. הקובץ leaf ל-worker: t רק כ-type. |
| data/event-lifecycle.ts | 2 | 4 | 0 | 0 | 4 | no | הקבועים משמשים גם כזריקה וגם כ-hint ברינדור. קובץ מודל טהור. |
| data/event-stats.ts | 4 | 0 | 0 | 0 | 0 | no | wrap רגיל. |
| data/event-theme.ts | 0 | 18 | 0 | 0 | 18 | no | טקסט מעורבב עם מחלקות Tailwind באותו אובייקט. |
| data/events.ts | 0 | 12 | 8 | 0 | 6 | no | ארבעה קבועים ועוד אחד בהשוואת err.message מדויקת באקשנים. |
| data/exchange-availability.ts | 9 | 4 | 2 | 0 | 5 | no | label הוא גם subject ב-Exchange, גם עמודה וגם whitelist ב-STATUS_SUBJECTS. |
| data/exchange-connections.ts | 12 | 5 | 7 | 0 | 5 | no | ERROR_MESSAGES נקרא במפתח רץ: switch סטטי. |
| data/faq.ts | 0 | 0 | 1 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/guest-import-shared.ts | 0 | 0 | 12 | 0 | 0 | no | כותרות CSV ו-regex: קוד, לא טקסט. |
| data/guests.ts | 0 | 4 | 14 | 0 | 2 | no | PHONE_TAKEN_ERROR ו-GROUP_NAME_TAKEN_ERROR בהשוואה מדויקת. |
| data/headcount.ts | 0 | 0 | 3 | 0 | 2 | no | אין שינוי: ערוץ יוצא. |
| data/inquiry-followup.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/inquiry-intake.ts | 0 | 0 | 6 | 0 | 3 | no | אין שינוי: לא מוצג למשתמש. |
| data/inquiry-mail-intake.ts | 0 | 0 | 16 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/instagram-token-refresh.ts | 0 | 0 | 13 | 0 | 1 | no | אין שינוי: התראות Slack פנימיות. |
| data/interactions-org-reads.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/interactions.ts | 0 | 0 | 8 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/meeting-confirm-dispatch.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/message-templates.ts | 5 | 0 | 4 | 0 | 0 | no | wrap רגיל. |
| data/orgs.ts | 0 | 28 | 6 | 1 | 1 | no | PERSONAL_ORG_NAME נשמר ב-DB. שאר הזריקות דרך rethrowOrFallback ו-M2. |
| data/otp.ts | 5 | 0 | 1 | 0 | 0 | no | route ציבורי מחזיר את הטקסט ב-JSON: צריך שפת בקשה ב-route. גוף ה-SMS נשאר. |
| data/outreach-engine.ts | 0 | 0 | 8 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/package-activation-errors.ts | 0 | 2 | 0 | 0 | 2 | no | שני הקבועים ב-CONFLICT_MESSAGES. |
| data/package-cancellation.ts | 4 | 10 | 0 | 0 | 8 | no | REFUSALS נקרא במפתח רץ: switch סטטי. |
| data/package-offers.ts | 0 | 1 | 0 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/payment-orphans.ts | 0 | 0 | 10 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/profiles.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/rsvp-links.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/rsvp.ts | 0 | 1 | 2 | 0 | 0 | no | זריקות שמוצגות דרך handleServerError: תלוי ב-M2. |
| data/sales-call-attempts.ts | 0 | 0 | 15 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/sales-call-dispatch.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/sales-voice-processing.ts | 0 | 0 | 2 | 2 | 0 | no | כמו callback-voice-processing. |
| data/schedule-options.ts | 0 | 2 | 0 | 0 | 2 | no | wrap רגיל. |
| data/sendable-contacts.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/setup-steps.ts | 7 | 8 | 0 | 0 | 8 | no | מודל טהור ואיזומורפי: t כפרמטר. רשימה מחוברת ב-', '. |
| data/signup-confirmation-reminder.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/sumit-customers.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/tax-ceiling.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/template-health-processing.ts | 0 | 0 | 24 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/template-health-sync.ts | 0 | 0 | 7 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/unconfirmed-signup-cleanup.ts | 0 | 0 | 3 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/user-settings.ts | 0 | 0 | 2 | 0 | 0 | no | אין שינוי: לא מוצג למשתמש. |
| data/voximplant-account-callback.ts | 0 | 0 | 15 | 0 | 15 | no | אין שינוי: התראות Slack פנימיות. |
| data/webhook-processing.ts | 0 | 0 | 11 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/webhooks.ts | 0 | 0 | 4 | 0 | 0 | no | אין שינוי: worker ולוג בלבד. |
| data/whatsapp-account-processing.ts | 0 | 0 | 31 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| data/whatsapp-import.ts | 0 | 1 | 19 | 0 | 0 | no | תשובות WhatsApp נשארות. error_rows נשמר ב-DB ומוצג בלקוח: M4. |
| data/whatsapp-template-send.ts | 0 | 0 | 4 | 0 | 0 | no | אין שינוי: התראות Slack פנימיות. |
| validation/admin.ts | 5 | 86 | 0 | 0 | 86 | no | M1. RESCHEDULE_AT_INVALID מועבר פוזיציונית ל-regex ול-refine: חובה צורת אובייקט. |
| validation/campaigns.ts | 0 | 14 | 3 | 0 | 17 | no | wrap רגיל. |
| validation/event-cancellation.ts | 0 | 8 | 0 | 0 | 8 | no | M1. הודעות פוזיציוניות: לעבור לצורת אובייקט. |
| validation/guests.ts | 0 | 20 | 0 | 0 | 20 | no | M1. importRowSchema רץ גם ב-worker ונשמר ל-DB: M4. |
| validation/inquiries.ts | 0 | 16 | 0 | 0 | 16 | no | INQUIRY_TOPICS הם ערכים שמורים ומושווים ל-'מכירות' בשלושה קבצים: לא לתרגם את הערך. |
| validation/owner-agent-reports.ts | 0 | 15 | 0 | 0 | 15 | no | אותו סיכון של KNOWN_ERRORS. |
| validation/owner-agent.ts | 1 | 36 | 0 | 0 | 36 | no | KNOWN_ERRORS: התאמה מדויקת של טקסט. תרגום בלי קודים הופך כל שגיאה ל-fallback. |
| validation/provider-numbers.ts | 0 | 16 | 0 | 0 | 16 | no | wrap רגיל. |
| validation/rating.ts | 0 | 2 | 0 | 0 | 2 | no | wrap רגיל. |
| validation/rdp-access.ts | 0 | 4 | 0 | 0 | 4 | no | wrap רגיל. |
| validation/rsvp.ts | 0 | 9 | 0 | 0 | 9 | no | wrap רגיל. |
| validation/schemas.ts | 0 | 74 | 0 | 0 | 74 | no | M1. כל ההודעות בסקופ מודול. אין parse בקליינט. |
| validation/send-policy-form.ts | 6 | 7 | 0 | 0 | 7 | no | WEEKDAY_LABELS נקרא בקליינט. err.message מ-parseSendPolicy שייך לאזור אחר. |
| validation/whatsapp-numbers.ts | 1 | 9 | 0 | 0 | 9 | no | wrap רגיל. |

## Non-text items

לא תוקן דבר. אין בקבצים האלה חצים פיזיים, `DirectionProvider` או `lang` קשיח.
- `data/event-display.ts:37`: `Intl.DateTimeFormat(ISRAEL_LOCALE)` בסקופ מודול, כלומר שפה קבועה בטעינה.
- `data/event-display.ts:54-60`: `formatEventDateLine` מציג תאריך עברי (`formatIsraelHebrewDate`) בדפי האורח rsvp-form, gift-landing ו-thankyou-landing.
- `data/callback-scheduling.ts:223`: `formatIsraelDate` ו-`formatIsraelTime` בתיאור פגישה ביומן העסקי.
- `data/agreements.ts:215`: `formatIsraelDate` בבלוק האישור של ה-PDF החתום. נשאר.
- `data/event-exchange-calendar-item.ts:66`: `dir="rtl"` קשיח בגוף פגישת Exchange.
- `data/console-calls.ts:2947`: `localeCompare(..., 'he')` במיון נציגים.
- `en-CA` ו-`en-GB` ב-`event-date.ts`, `agreement-archive.ts`, `console-calls.ts`: פורמטים מכונתיים להשוואה ולשדות input, לא תצוגה. להשאיר.

## Shared mechanisms needed

### M1. הודעות Zod בסקופ מודול (257 שורות `restructure` בוולידציה)

גרסה מותקנת: zod 4.6.7. מקור: `/colinhacks/zod/v4.6.7`, `error-customization.mdx`.

**ההמלצה:** להחליף כל מחרוזת בפונקציית `error` שמחזירה `t(...)`, בצורה המדויקת שלמטה. לפי התיעוד הפונקציה נקראת ב-parse ולא בבניית הסכמה, כך שסכמה בסקופ מודול מקבלת את השפה הנוכחית בכל parse.

**אין קיצור דרך בגבול אחד.** סדר הקדימות בתיעוד: check, schema, per-parse, global, locale. נמדד: `.min(1,'קבוע')` גובר על `safeParse(v, { error })`. לכן כל הודעה משתנה במקומה.

**נמדד על 4.6.7 (`out/.probe/zod-probe*.cjs`):**
- זהות מלאה בין מחרוזת לפונקציה ב-pipe+email, union+iso.date, enum, iso.datetime, uuid, coerce.number, int, max, array max, regex+or, refine+path, partial.
- `error` ברמת `z.union` ו-preprocess+union עובד, וזה הדפוס של `CONTACT_QUOTA_ERROR`.
- נתיב `['~standard'].validate` מחזיר את הפונקציה. לא בדקתי את next-safe-action עצמו מקצה לקצה.

**אסור:** פונקציה כארגומנט פוזיציונלי. `.min(5, fn)`, `.regex(re, fn)`, `.refine(check, fn)`, `.gt(0, fn)` ו-`z.email(fn)` מתעלמים ממנה בשקט ומחזירים את ברירת המחדל באנגלית (נמדד). זה חל על `event-cancellation.ts`, `inquiries.ts`, `owner-agent.ts`, `owner-agent-reports.ts`, `whatsapp-numbers.ts` ו-`RESCHEDULE_AT_INVALID`, שמשתמשים בצורה הפוזיציונלית עם מחרוזת. בהמרה צריך לעבור ל-`{ error }`.

**הצורה המדויקת:** קריאה ל-`getT` בתוך פונקציית השגיאה, לפי הכלל הקבוע של הבריף:
`{ error: () => { const t = getT('common'); return t('validation.email.invalid', 'כתובת אימייל לא תקינה'); } }`
`getT` רץ ב-parse ולא בסקופ מודול. הודעה שחוזרת בכמה שדות נכתבת פעם אחת כפונקציה בסקופ מודול, למשל `function invalidEmail() { const t = getT('common'); return t(...); }`, ומועברת כ-`{ error: invalidEmail }`. הגדרת הפונקציה לא קוראת ל-`getT`. ה-namespace מפורש, כך שגם `getT('admin')` עובד.

**extract:** ה-visitor פותח scope בכל `ArrowFunctionExpression` (`ast-visitors.js:275-280`) ו-`handleVariableDeclarator` מזהה `const t = getT(ns)`, אז הצורה הזו אמורה להיחלץ ל-namespace הנכון. לעומת זאת `getT('common')('k','h')` לא ייחלץ, כי `getFunctionName` מחזיר null ל-callee שהוא קריאה. חלופה קצרה יותר אם 257 גופי בלוק כבדים מדי: עטיפה אחת שמיובאת בשם `t`, ואז `extract` נופל ל-`defaultNS: 'common'`, ול-`admin` משתמשים בקידומת `t('admin:validation.x', ...)`. נמדד ש-i18next מטפל בקידומת ושברירת המחדל מקבלת `{{max}}`. **התנהגות extract בשתי הצורות הוסקה מקריאת המקור של i18next-cli 1.82.5; לא הרצתי extract.** כדאי לאמת על קובץ אחד בעותק לפני ההמרה.

**קליינט:** אין `zodResolver` ואין `safeParse` בקומפוננטות `'use client'` (נבדק על כל קבצי הקליינט). ה-importers בקליינט לוקחים קבועים בלבד, כך שכל ההודעות נוצרות בשרת. אין צורך בשינוי `'use client'`.

**פער קיים:** `z.config` לא נקרא בריפו, ולכן בדיקה בלי הודעה מותאמת מציגה אנגלית למשתמש עברי. נמדד: `Too big: expected string to have <=1 characters`. יש 25 בדיקות כאלה ב-`schemas.ts`, `guests.ts` ו-`admin.ts` (ספירה ב-regex), למשל `attendeeSchema.name`. Zod כולל locale של `he`, `fr` ו-`en`. נמדד שמיתוג `z.config({ localeError: (iss) => maps[lang](iss) })` מחזיר את השפה הנכונה בכל parse. `z.config` גלובלי לתהליך, לכן זה עובד פר בקשה רק אם `lang` נקרא מאותו מקור שפה של `getT`. זה משנה טקסט שמשתמש עברי רואה היום, ולכן זו החלטת בעלים.

### M2. שגיאות שנזרקות (87 זריקות, ועוד קבועי שגיאה)

**זו התלות הכי מסוכנת באזור.** `src/lib/safe-action.ts:31-38` מעביר הודעה ללקוח רק אם היא מכילה עברית: `HEBREW.test(error.message) ? error.message : GENERIC_ACTION_ERROR`. עטיפה ב-`t()` תעבוד בעברית ותהפוך כל שגיאה באנגלית ובצרפתית להודעה הגנרית, בלי שום כשל בבדיקות העבריות. אותו מבחן קיים גם ב-`src/app/(admin)/admin/integrations/numbers/actions.ts:184` (`isUserFacing`).

**ההמלצה:** מחלקת שגיאה ייעודית, ו-`handleServerError` בודק `instanceof`. זה הדפוס שמתועד ב-next-safe-action 8.7.3 (`create-safe-action-client.mdx`, `validation-utilities.mdx`). צריך להטמיע לפני המרת שורה אחת. `returnUserError` קיים כבר ועובר ישר.

**השוואות טקסט מדויקות שצריכות קוד שגיאה ולא תרגום:**
- `app/(customer)/app/events/[id]/actions.ts:167-170`: `DATES_LOCKED_ERROR`, `CELEBRANTS_LOCKED_ERROR`, `EVENT_TYPE_LOCKED_ERROR`, `VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR`.
- `app/(customer)/app/events/actions.ts:156`: `ONE_EVENT_PER_ACCOUNT_ERROR`.
- `guests-actions.ts:68,138,203,225`: `PHONE_TAKEN_ERROR`, `GROUP_NAME_TAKEN_ERROR`.
- `app/api/campaigns/[id]/status/route.ts:58-65`: `CONFLICT_MESSAGES`, כולל שני ליטרלים משוכפלים.
- `isOwnerAgentUserError`, `isOwnerAgentReportUserError`: רשימות היתר `KNOWN_ERRORS`.

**לא תלויים ב-M2:** `CancellationResolveError` (`cancellations/actions.ts:39`) ותוצאות `{ ok:false, error }`. אלה `convert` רגיל.

### M3. מפות תוויות (`event-labels.ts`, `ROLE_LABELS`, `SETUP_STEP_LABELS`, `EVENT_THEME` ודומיהן)

**ההמלצה:** פונקציה שמקבלת `t` ומחזירה את אותו `Record`:
`export function eventTypeLabels(t: TFunction<'common'>): Record<EventType, string> { return { wedding: t('event.type.wedding', 'חתונה'), ... }; }`

למה כך:
- `Record<EnumType,string>` שומר את בדיקת המיצוי בזמן קומפילציה.
- `t` הוא import של טיפוס בלבד, אז `event-labels.ts` נשאר leaf בטוח ל-worker ואיזומורפי.
- `extract` קורא namespace מפרמטר עם הטיפוס `TFunction<'ns'>` (`ast-visitors.js`). הוסק מהמקור, לא הורץ.
- נדחה: `` t(`event.type.${type}`) ``. התיעוד של i18next-cli אומר ש-union סופי נפתר, אבל כך אין ברירת מחדל עברית בקוד, וזה נוגד את כלל הריפו.

**פיצול חובה ב-`EVENT_TYPE_LABELS`:** 20 קריאות, מהן 6 יוצאות: `whatsapp/template-spec.ts:192,244,293,570`, `api/voximplant/ctx/[token]/route.ts:85`, `whatsapp-import.ts:212`. צרכני UI עוברים לפונקציה. היוצאים חייבים להישאר בעברית גם כש-`getT` יקרא שפת בקשה, אז צריך `t` מקובע לעברית. נמדד ש-`getFixedT('he', ns)` מחזיר עברית בלי קשר. כך נשאר מקור טקסט אחד. אותו עיקרון ב-`celebrantsTextFor`, שנקרא ל-voice ctx ב-`route.ts:205,262`, וב-`eventHeadingFor` כשהוא מזין את יומן Exchange העסקי (`event-exchange-calendar-item.ts:43`, `buildEventSubject`, `buildRsvpDeadlineSubject`). הטריגר הוא פעולת לקוח, אבל הקורא הוא תיבת הבעלים, אז גם שם צריך `t` מקובע לעברית. ה-ICS פונה לאורח ויכול לקבל את `t` של הבקשה.

**מפות שאחרות:** `CAMPAIGN_STATUS_LABELS` צוות בלבד (`admin`). `CAMPAIGN_STAGE_LABELS` ו-`EVENT_STATUS_LABELS` משותפות (`common`). `CELEBRANT_FIELD_LABELS` ו-`HOST_COMPOSITION_LABELS` לקוח בלבד (`customer`). `בעל/ת השמחה` מסומן `gender-slash`.

**שרשור דקדוקי:** `HEADING_OF` מחבר קידומת עברית לשמות. צריך תבנית מלאה לכל סוג אירוע עם `{{names}}`, כי סדר המילים שונה בשפות אחרות. קידומת `ו` ב-`celebrantsTextFor` ו-`celebrantNamesFor` חייבת להישאר זהה בשתיהן: `eventHeadingSegmentsFor` מאתר שם ב-`indexOf`.

### M4. טקסט שנבנה בלי בקשה ונשמר לתצוגה מאוחרת

`importRowSchema` רץ גם ב-`whatsapp-import.ts:306` ב-worker. ההודעה נשמרת ב-`guest_import_staging.error_rows` ומוצגת ב-`whatsapp/page.tsx:159`. ב-worker אין שפת בקשה. ההמלצה: לשמור קוד issue ופרמטרים ולתרגם בקריאה. השורות pending בלבד, אז אין היסטוריה להסב.

## Owner decisions

1. האם טקסט צוות שנשמר ב-DB נשאר עברית? (`call_dnc_list.reason`, `contact_messages.message`, `callback_requests.note`; 11 שורות `decide`.) שורות קיימות כבר בעברית.
2. שם הארגון ברירת המחדל `הארגון שלי` נשמר ב-`organizations.name`: לשמור לפי שפת ההרשמה, או להציג מפתח לשם ברירת המחדל?
3. האם להפעיל locale של Zod כדי להחליף את ברירות המחדל באנגלית? זה משנה מה שמשתמש עברי רואה היום.
4. האם מסכי צוות מתורגמים בכלל? 339 שורות פתוחות הן של צוות. תשובה שלילית מסירה את רובן.
5. האם `push` לצוות צריך הגדרת שפה לנציג? היום אין שפת צופה ב-route של Voximplant.
6. תוכן `faq_items` מגיע מה-DB בעברית. `faq.ts` רק קורא אותו, אז תרגום ה-FAQ דורש החלטת סכמה.

## Coverage

97 of 97 files read, כל קובץ עד השורה האחרונה דרך ה-REPL של Serena. `console-calls.ts` ו-`callback-scheduling.ts` נקראו בטווחים רציפים. יומן: `out/.coverage.txt`. אין קובץ שלא נקרא.

נבדק במכונה: כל תו עברי מחוץ להערה נופל בתוך ליטרל או מפתח ממופה (0 פערים), וכל שורה עומדת בסכמה (`outbound` תמיד `keep`).

**הוסק ולא אומת:** התנהגות `extract` (M1, M3). את ה-README וה-dist של i18next-cli קראתי ב-Bash וב-REPL מתוך node_modules, ולא דרך כלי הקריאה של Serena. עבור זריקות שמגיעות מאקשן, נקודות ה-try נבדקו אוטומטית בקובץ האקשן שקורא ישירות לפונקציה, לא בכל שרשרת הקריאות, ו-`catch` ביניים ב-`src/lib` מחוץ לאזור שלי לא נסרק. קהל של קריאה דרך route נקבע מחיפוש `err.message` בכל ה-routes.
