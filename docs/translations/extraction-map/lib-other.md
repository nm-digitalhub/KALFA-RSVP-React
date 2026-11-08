# מיפוי i18n: lib-other

134 קבצים בשאר `src/lib`. 1476 שורות ב-`lib-other.jsonl`. התיקייה `_lib-other-tools/` היא עבודה זמנית ולא פלט.

מספרי השורות הם 1-based. הרשימה נבנתה בסקריפט node עם TypeScript AST (מחרוזות, template literals, JSX, regex, ומזהים בעברית), וכל קובץ נקרא במלואו דרך `s.fs.read_file` כדי לסווג. grep אחד ב-Bash רץ על `types.generated.ts`. הערות בקוד לא נספרו.

## ארבע הקבוצות

| קבוצה | שורות | convert | restructure | keep | decide |
|---|---|---|---|---|---|
| טקסט בעמוד web | 764 | 196 | 414 | 0 | 154 |
| outbound | 171 | 0 | 0 | 171 | 0 |
| internal (לוגים, Slack, prompts ל-LLM, CLI) | 523 | 0 | 0 | 522 | 1 |
| legal-signed (הסכם, קבלה, מסמך זיכוי) | 18 | 0 | 0 | 18 | 0 |

130 משורות ה-decide הן Label של `relocation` (החלטה אחת, סעיף בעלים 12). שורות שחולקות `key` זהה הן משפט אחד שמחובר מכמה literals, או אותו טקסט בכמה מקומות.

## outbound לפי ערוץ

עובדות שנבדקו: העמודה `guests.language` קיימת ב-types, ואין לה אזכור בשם ב-`src`. `select('*')` או פונקציית DB עדיין יכולים לגעת בה, וזה לא נבדק. חיפוש ב-migrations לא מצא היכן נוספה. אין עמודת שפה ב-`events`, `profiles`, `callback_requests`, `contact_messages`. אין עמודת שפה ב-`message_template_routes`, ו-`pickTemplateRoute` בוחר לפי `message_key`, `event_type`, `with_media` בלבד.

| ערוץ | קבצים | שורות | נמען | מקור שפה היום | מה יצטרך להיקבע |
|---|---|---|---|---|---|
| WhatsApp לאורח | `whatsapp/template-spec.ts` | 17 | אורח | אין. התבנית נבחרת בלי שפה | שפה לאורח (`guests.language` או ברירת מחדל מהאירוע), תבנית מאושרת לכל שפה, ובחירת route לפי שפה |
| WhatsApp לצוות | `owner-agent/consumer/reply-text.ts`, `owner-agent/reports/*` | 22 | צוות | `template_lang` למנוי ולהגדרות, ברירת מחדל he. טקסט חופשי בלי מקור | בפועל הבעלים, עברית. נדרש רק אם צוות בשפה אחרת יקבל דוחות |
| מייל | `email/templates.ts` | 51 | לקוח, פונה מ-/contact | אין | שפת הנמען, לא שפת איש הצוות שלחץ. גוף שנכתב בידי צוות או AI נשאר בעברית, ולכן מעטפת מתורגמת תיתן הודעה מעורבת |
| SMS | `callbacks/intake-sms.ts`, `no-contact-sms.ts`, `signup-link-sms.ts` | 7 | מתקשר, ליד | אין. שיחה שלא נענתה נותנת מספר טלפון בלבד | ברירת מחדל קבועה, או שפה שנשמרת ב-`callback_requests`. עברית ב-UCS-2 עולה לפי segments, ובדיקה נועלת 2 segments |
| קול | `date.ts` (פורמטרים מדוברים) | 72 | מתקשר | אין לנמען. `voice/override-policy.ts` מכיר override של `language` לסוכן בכל שיחה, ולא נבדק אם הוא מופעל | לא תרגום: מילים תלויות מין ותחיליות, והמשתנים מגיעים לסוכן כבר מדוברים בעברית בכל שפת סוכן. שפה נוספת צריכה פורמטר משלה וסוכן בשפה הזו. 72 השורות הן מילות מספר וזמן, לא 72 הודעות |
| web push | `rdp-access/notify-request.ts` | 2 | בעלים | אין | שפת הנמען. לא ברשימת הערוצים של ה-brief, סומן outbound |

**תבניות WhatsApp.** Meta דורשת קוד שפה בכל תבנית ולא מתרגמת מחרוזות או משתנים. תבניות עם אותו שם ובשפות שונות נספרות כל אחת במגבלת התבניות (תיעוד Meta, Template fundamentals). ב-`template-spec.ts` הפרמטרים עצמם בעברית, כולל שורות `BRIT_PHRASING` שמשקפות מילה במילה גוף מאושר ומשתנות לפי מין. לכן תבנית בשפה אחרת צריכה גם ניסוח פרמטרים משלה, ו-`formatIsraelWeekday`, התאריך העברי ו-`EVENT_TYPE_LABELS` נכנסים לאותם slots.

## טבלת קבצים

העמודה `use client` היא "לא" בכולם: אלה מודולי ספרייה. קבצים שנטענים גם ברכיבי client (`analytics/ga4-types.ts`, `fleet/labels.ts`, `fleet/reachability.ts`, `voximplant/web-client.ts`) עובדים עם `getT` בלי שינוי.

| קובץ (תחת `src/lib/`) | convert | restructure | keep | decide | module | `use client` | סיכון |
|---|---|---|---|---|---|---|---|
| `agreements/content.ts` | 0 | 0 | 2 | 0 | 0 | לא | legal-signed: הערך נכנס ל-PDF עם hash |
| `agreements/link-url.ts` | 0 | 1 | 0 | 0 | 1 | לא | הודעת zod ברמת מודול; schema משותף |
| `agreements/pdf-document.tsx` | 0 | 0 | 7 | 0 | 0 | לא | legal-signed: PDF עם hash. גם language="he" ו-direction rtl קבועים |
| `agreements/pdf-html.ts` | 21 | 0 | 0 | 0 | 0 | לא | ניסוח טכני של CSS/HTML; שורה 405 משרשרת הודעה פנימית |
| `agreements/template.ts` | 0 | 0 | 6 | 0 | 3 | לא | CHANNEL_LABELS משותף ל-PDF החתום ול-FAQ הציבורי |
| `ai/package-copy-skills.ts` | 0 | 0 | 2 | 0 | 2 | לא | prompt ל-LLM, לא ממשק |
| `ai/package-copy.ts` | 0 | 0 | 10 | 0 | 0 | לא | prompt ל-LLM, לא ממשק |
| `alerts/slack.ts` | 0 | 0 | 1 | 0 | 0 | לא | אין |
| `analytics/ga4-mappers.ts` | 3 | 0 | 0 | 0 | 0 | לא | גם Intl.DisplayNames(['he']) ברמת מודול לשמות מדינות |
| `analytics/ga4-types.ts` | 0 | 27 | 0 | 0 | 27 | לא | התוויות נכנסות לשורות הממופות; להעביר לזמן render |
| `auth/console-agent.ts` | 0 | 2 | 0 | 0 | 2 | לא | חוזה מול לקוח native; אין מקור שפה |
| `callbacks/activity-timeline.ts` | 14 | 5 | 0 | 0 | 5 | לא | רק תוויות מורכבות |
| `callbacks/calendar-item.ts` | 0 | 0 | 13 | 0 | 6 | לא | logic: קטגוריות Exchange, קידומת נושא וסימוני ארכיון מותאמים |
| `callbacks/intake-dispatch.ts` | 0 | 0 | 1 | 0 | 0 | לא | אין |
| `callbacks/intake-sms.ts` | 0 | 0 | 2 | 0 | 0 | לא | SMS יוצא; בדיקת מספר segments; הכרעה משפטית קשורה לנוסח |
| `callbacks/no-contact-sms.ts` | 0 | 0 | 3 | 0 | 0 | לא | SMS יוצא; נוסח שאושר על ידי הבעלים |
| `callbacks/signup-link-sms.ts` | 0 | 0 | 2 | 0 | 0 | לא | SMS יוצא |
| `cardcom/create-request.ts` | 0 | 0 | 2 | 0 | 0 | לא | Language: he קבוע על הסשן והמסמך |
| `cardcom/mutator.ts` | 0 | 0 | 6 | 0 | 0 | לא | אין |
| `cardcom/open-fields.ts` | 0 | 0 | 4 | 0 | 4 | לא | logic: התאמה מדויקת לטקסט של הספק, תלוי בשפת init |
| `cardcom/refund-request.ts` | 0 | 0 | 2 | 0 | 0 | לא | Languge: he קבוע על מסמך הזיכוי |
| `console/chat.ts` | 2 | 0 | 0 | 0 | 0 | לא | אין |
| `date.ts` | 0 | 0 | 105 | 0 | 82 | לא | Intl של he-IL ברמת מודול; פורמטרים קוליים הם דקדוק עברי; גימטריה היא לוגיקה |
| `dnc/mutator.ts` | 0 | 0 | 6 | 0 | 0 | לא | אין |
| `email/health.ts` | 0 | 11 | 0 | 0 | 9 | לא | אותו טקסט משרת עמוד ו-Slack מה-worker |
| `email/run-health-check.ts` | 0 | 1 | 1 | 0 | 0 | לא | הכותרת היא חלק ממפתח ה-dedup של Slack |
| `email/sender.ts` | 0 | 0 | 6 | 0 | 0 | לא | לא ידוע על סיכון |
| `email/templates.ts` | 0 | 0 | 53 | 0 | 3 | לא | מייל יוצא; lang/dir קבועים ב-6 התבניות; גוף של צוות/AI נשאר בעברית; regex ברכה בעברית בלבד |
| `exchange-ews/category-colors.ts` | 0 | 25 | 0 | 0 | 25 | לא | אין |
| `exchange-ews/graph-impl.ts` | 1 | 0 | 0 | 0 | 0 | לא | ערך גולמי באנגלית לידו |
| `faq/page-model.ts` | 0 | 7 | 0 | 1 | 7 | לא | אותן מחרוזות מזינות עמוד ו-JSON-LD; גם fleet-agent-cli בונה את המודל מחוץ לבקשה |
| `faq/tokens.ts` | 4 | 0 | 0 | 0 | 0 | לא | plural; toLocaleString('he-IL'); קורא CHANNEL_LABELS מתבנית ההסכם |
| `fleet/business-facts.ts` | 0 | 0 | 1 | 11 | 0 | לא | משפט אחד משרת עמוד ציבורי, JSON-LD וטיוטות AI; חוזה בלי imports |
| `fleet/complete.ts` | 0 | 0 | 1 | 0 | 1 | לא | logic: חותמת שמורה ב-DB |
| `fleet/content-author.ts` | 0 | 0 | 1 | 0 | 1 | לא | logic: חותמת שמורה ב-DB |
| `fleet/conversation.ts` | 15 | 3 | 2 | 0 | 4 | לא | שתי מחרוזות שנשמרות בקובץ שרובו ניתן להמרה |
| `fleet/corrections.ts` | 0 | 0 | 19 | 0 | 0 | לא | לא ממשק |
| `fleet/expire.ts` | 0 | 0 | 1 | 0 | 0 | לא | אין |
| `fleet/goal.ts` | 0 | 1 | 0 | 0 | 1 | לא | zod ברמת מודול; משותף ל-CLI |
| `fleet/handoff.ts` | 0 | 0 | 2 | 0 | 0 | לא | טקסט שנשמר |
| `fleet/hebrew-style.ts` | 0 | 0 | 54 | 0 | 54 | לא | לא ממשק |
| `fleet/housekeeping-pr.ts` | 0 | 0 | 3 | 0 | 0 | לא | אין |
| `fleet/labels.ts` | 0 | 17 | 0 | 0 | 17 | לא | labels.test נועל מפתחות; המפות לבקשה ולמטרה נבדלות במין דקדוקי |
| `fleet/publish-social.ts` | 0 | 0 | 8 | 0 | 8 | לא | logic: שערים לפי מילים בעברית |
| `fleet/reachability.ts` | 12 | 7 | 0 | 0 | 0 | לא | שברי משפט שמודבקים למשפטים |
| `guests/import-template.ts` | 0 | 0 | 0 | 11 | 11 | לא | logic: כותרות CSV מותאמות ב-parser; שני משטחים חייבים להיות זהים |
| `microsoft/health.ts` | 0 | 4 | 0 | 0 | 4 | לא | אין |
| `microsoft/mail.ts` | 0 | 0 | 4 | 0 | 0 | לא | טקסט שנשמר |
| `offers/assignment-display-status.ts` | 9 | 4 | 0 | 0 | 4 | לא | אין |
| `ops/integrations.ts` | 7 | 0 | 0 | 0 | 0 | לא | אין |
| `ops/summary.ts` | 19 | 0 | 0 | 0 | 0 | לא | כמה שורות זהות יכולות לחלוק מפתח |
| `ops/supabase-cli-update.ts` | 0 | 0 | 13 | 0 | 0 | לא | מפתחות אובייקט בעברית (מגרסה, לגרסה) כשמות שדה ב-Slack |
| `outreach/send-policy.ts` | 9 | 1 | 0 | 0 | 1 | לא | משותף ל-worker; הטקסט עובר את בדיקת HEBREW |
| `owner-agent/consumer/primer.ts` | 0 | 0 | 21 | 0 | 21 | לא | לא ממשק |
| `owner-agent/consumer/reply-text.ts` | 0 | 0 | 56 | 0 | 43 | לא | לא ממשק; כמה תשובות WhatsApp קבועות לצוות |
| `owner-agent/consumer/reply.ts` | 0 | 0 | 2 | 0 | 0 | לא | אין |
| `owner-agent/consumer/retention.ts` | 0 | 0 | 2 | 0 | 0 | לא | אין |
| `owner-agent/delivery.ts` | 0 | 0 | 3 | 0 | 0 | לא | אין |
| `owner-agent/intake.ts` | 0 | 0 | 12 | 0 | 0 | לא | אין |
| `owner-agent/reports/content.ts` | 0 | 0 | 14 | 0 | 0 | לא | WhatsApp יוצא לצוות; שפת תבנית לכל מנוי |
| `owner-agent/reports/model-content.ts` | 0 | 0 | 6 | 0 | 0 | לא | לא ממשק |
| `owner-agent/reports/report.ts` | 0 | 0 | 3 | 0 | 1 | לא | DEFAULT_TEMPLATE_LANG קבוע על he |
| `owner-agent/tools/billing-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/campaigns-status-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/events-pipeline.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/inquiries-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/rsvp-totals.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/shared.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/system-health.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/voice-calls-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/web-traffic-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `owner-agent/tools/whatsapp-delivery-summary.ts` | 0 | 0 | 1 | 0 | 1 | לא | לא ממשק |
| `password-strength.ts` | 0 | 5 | 0 | 0 | 5 | לא | חייב להישאר תואם להודעות Zod של newPasswordField |
| `payments/activate-paid-package.ts` | 0 | 0 | 7 | 0 | 1 | לא | אין |
| `payments/card.ts` | 0 | 0 | 1 | 0 | 0 | לא | אין |
| `payments/cardcom-purchase.ts` | 0 | 0 | 2 | 0 | 0 | לא | אין |
| `payments/cardcom-refund.ts` | 1 | 0 | 8 | 0 | 1 | לא | REFUND_LINE מודפס על מסמך מס |
| `payments/cardcom-settle.ts` | 0 | 0 | 9 | 0 | 4 | לא | אין |
| `payments/credit-consumed.ts` | 0 | 1 | 0 | 0 | 1 | לא | תלוי בבדיקת HEBREW ב-safe-action |
| `payments/ledger.ts` | 0 | 3 | 0 | 0 | 3 | לא | שמות הפעולות באים מ-payment_operation_kinds.label_he ב-DB, עברית בלבד |
| `payments/operation-labels.ts` | 2 | 4 | 0 | 0 | 4 | לא | משותף למסכי לקוח וצוות |
| `payments/package-activation-job.ts` | 0 | 0 | 3 | 0 | 0 | לא | אין |
| `payments/package-payment-screen.ts` | 0 | 1 | 0 | 0 | 1 | לא | אין |
| `payments/package-purchase-errors.ts` | 0 | 13 | 0 | 0 | 13 | לא | ניסוח תשלום תחת בדיקת ציות; בדיקה נועלת אותו |
| `payments/package-purchase.ts` | 0 | 0 | 3 | 0 | 0 | לא | אין |
| `payments/package-receipt.ts` | 0 | 0 | 1 | 0 | 1 | לא | טקסט קבלה |
| `payments/package-refund.ts` | 0 | 0 | 8 | 0 | 1 | לא | REFUND_LINE מודפס על מסמך מס |
| `payments/provider-value-labels.ts` | 0 | 86 | 0 | 0 | 86 | לא | instance שני של i18next מחוץ ל-getT, extract ו-Locize; בדיקה נועלת שלכל enum יש שם |
| `payments/purchase-provider.ts` | 1 | 0 | 0 | 0 | 0 | לא | תלוי בבדיקת HEBREW ב-safe-action |
| `payments/status.ts` | 0 | 0 | 9 | 0 | 7 | לא | ייתכן קוד מת |
| `payments/terminal-conflict-copy.ts` | 0 | 4 | 0 | 0 | 4 | לא | שני משטחים חייבים לומר אותו דבר |
| `payments/test-money-label.ts` | 0 | 0 | 0 | 1 | 1 | לא | משותף ל-Slack ולמסך |
| `permissions.ts` | 1 | 0 | 0 | 0 | 0 | לא | תלוי בבדיקת HEBREW ב-safe-action |
| `rdp-access/cli/commands.ts` | 0 | 0 | 21 | 0 | 0 | לא | לא web |
| `rdp-access/cli/program.ts` | 0 | 0 | 28 | 0 | 0 | לא | לא web |
| `rdp-access/cli/text.ts` | 0 | 0 | 34 | 0 | 34 | לא | לא web |
| `rdp-access/copy.ts` | 17 | 103 | 0 | 0 | 103 | לא | אובייקטים ברמת מודול; משפטים סביב ערכי מדיניות; 2 שברי משפט |
| `rdp-access/countdown.ts` | 3 | 0 | 0 | 0 | 0 | לא | plural |
| `rdp-access/notify-request.ts` | 0 | 0 | 4 | 0 | 0 | לא | טקסט push בזרימת בקשת צוות |
| `rdp-access/notify.ts` | 0 | 0 | 7 | 0 | 0 | לא | אין |
| `rdp-access/sweep.ts` | 0 | 0 | 5 | 0 | 0 | לא | אין |
| `relocation/engine.ts` | 0 | 0 | 0 | 4 | 4 | לא | Label דו-לשוני שנשמר בקובץ, לא t() |
| `relocation/env-validation.ts` | 0 | 0 | 4 | 0 | 0 | לא | מזין רק את טופס ההתקנה |
| `relocation/install-steps.ts` | 0 | 0 | 0 | 24 | 0 | לא | Label דו-לשוני שנשמר בקובץ, לא t() |
| `relocation/labels.ts` | 0 | 0 | 0 | 29 | 29 | לא | Label דו-לשוני שנשמר בקובץ, לא t() |
| `relocation/preflight.ts` | 0 | 0 | 0 | 20 | 0 | לא | Label דו-לשוני שנשמר בקובץ, לא t() |
| `relocation/setup-form.ts` | 0 | 0 | 9 | 0 | 0 | לא | HTML עצמאי, he/rtl קבועים |
| `relocation/steps.ts` | 0 | 0 | 0 | 53 | 0 | לא | Label דו-לשוני שנשמר בקובץ, לא t() |
| `relocation/wiring-helpers.ts` | 0 | 0 | 2 | 0 | 2 | לא | logic: מותאם לטקסט של עמוד שרונדר |
| `safe-action.ts` | 0 | 1 | 0 | 1 | 2 | לא | בדיקת HEBREW חוסמת כל הודעת throw מתורגמת |
| `seo/breadcrumb-json-ld.ts` | 1 | 0 | 0 | 0 | 0 | לא | אין |
| `seo/open-graph.ts` | 0 | 1 | 0 | 0 | 1 | לא | locale he_IL קבוע; metadata סטטי |
| `sms/extra-client.ts` | 1 | 12 | 0 | 0 | 12 | לא | אותו טקסט משרת עמוד ו-Slack מה-worker |
| `sms/run-key-check.ts` | 0 | 0 | 4 | 0 | 0 | לא | אין |
| `sms/sender.ts` | 0 | 0 | 6 | 0 | 0 | לא | אין |
| `storage/event-media.ts` | 0 | 0 | 3 | 0 | 0 | לא | הנתיב מוחרג משרת השפה |
| `storage/legal-docs.ts` | 1 | 0 | 2 | 0 | 0 | לא | הנתיב מוחרג משרת השפה |
| `sumit/charge.ts` | 0 | 0 | 5 | 0 | 0 | לא | אין |
| `sumit/health.ts` | 0 | 5 | 0 | 0 | 4 | לא | אותו טקסט משרת עמוד ו-Slack |
| `sumit/mutator.ts` | 0 | 0 | 12 | 0 | 0 | לא | אין |
| `sumit/raw-charge.ts` | 0 | 0 | 2 | 0 | 0 | לא | אין |
| `sumit/run-health-check.ts` | 0 | 0 | 2 | 0 | 0 | לא | אין |
| `testing/cleanup.probe.ts` | 0 | 0 | 0 | 0 | 0 | לא | fixture של בדיקה, דולג לפי ה-brief |
| `voximplant/core.ts` | 10 | 0 | 0 | 0 | 0 | לא | שורות זהות יכולות לחלוק מפתח; הטקסט עובר את בדיקת HEBREW |
| `voximplant/mutations.ts` | 4 | 0 | 0 | 0 | 0 | לא | אין |
| `voximplant/phone-snapshot.ts` | 1 | 0 | 0 | 0 | 0 | לא | אין |
| `voximplant/sdk-auth-client.ts` | 4 | 0 | 0 | 0 | 0 | לא | אין |
| `voximplant/web-client.ts` | 4 | 0 | 0 | 0 | 0 | לא | אין |
| `whatsapp/health.ts` | 0 | 0 | 7 | 0 | 7 | לא | פנימי: Slack בלבד |
| `whatsapp/run-health-check.ts` | 0 | 0 | 12 | 0 | 0 | לא | אין |
| `whatsapp/template-route.ts` | 10 | 6 | 0 | 0 | 0 | לא | logic: startsWith ב-template-status; עברית נכנסת לקודי Issue |
| `whatsapp/template-spec.ts` | 0 | 0 | 18 | 0 | 10 | לא | Meta מאשרת תבנית לכל שפה; הטקסט משקף גוף מאושר; he-IL ב-Intl ברמת מודול |
| `whatsapp/template-status.ts` | 18 | 17 | 1 | 0 | 17 | לא | logic: startsWith על עברית; מפות enum חייבות להישאר מלאות |
| `whatsapp/value-labels.ts` | 1 | 36 | 0 | 0 | 36 | לא | אין |

## פריטים שאינם טקסט

לא טופלו. נרשמו בלבד.

- **`he-IL` ופורמט:** `date.ts:19` (`ISRAEL_LOCALE`, וכל ה-`Intl.DateTimeFormat` ברמת מודול), `whatsapp/template-spec.ts:108,114`, `agreements/template.ts:97,149`, `faq/tokens.ts:28`, `fleet/business-facts.ts:73,78`, `analytics/ga4-mappers.ts:149` (`Intl.DisplayNames(['he'])`). `owner-agent/reports/content.ts:87,91` משתמש ב-`en-US`.
- **תאריך עברי:** `date.ts:134-165` (`calendar: 'hebrew'` וגימטריה). נכנס גם ל-`data/event-display.ts` ולתבניות WhatsApp.
- **`lang`/`dir` קבועים:** `email/templates.ts` (בכל 6 התבניות, על `Html` ו-`Body`), `agreements/pdf-document.tsx:590` ו-`direction: 'rtl'` לאורך הסגנונות, `relocation/setup-form.ts:145`, `callbacks/calendar-item.ts:178`, `seo/open-graph.ts:39` (`he_IL`).
- **שפה בשדה של ספק:** `cardcom/create-request.ts:73,85`, `cardcom/open-fields.ts:94,203,240`, `cardcom/refund-request.ts:90` (`Languge`, כך בסכמת CardCom), `owner-agent/reports/report.ts:90`. אם `init` ישלח `en`, המשפטים ב-`THREE_DS_SENTENCES` יפסיקו להתאים.
- **כיוון פיזי:** `agreements/pdf-document.tsx:198,230,250-251` (`row-reverse`, `borderRight`), `agreements/pdf-html.ts:316,327`, `agreements/template.ts:128`. כולם בנתיב ה-PDF החתום.
- **חצים פיזיים, `DirectionProvider`:** לא נמצאו בקבצים האלה.
- **תוכן בעברית ב-DB:** `payment_operation_kinds.label_he`, `faq_items`, `packages.name`, `agreement_documents`. המרה של הקוד לבדה תיתן עמוד מעורב, בעיקר ב-`/faq` ובשורות תשלום.

## מנגנונים משותפים

1. **בדיקת `HEBREW` ב-`safe-action.ts:31,37`.** כל throw שעובר את הבדיקה מוצג למשתמש, וכל השאר הופך ל-`GENERIC_ACTION_ERROR`. הודעה מתורגמת תיכשל בבדיקה ותוחלף בהודעה הכללית. זה נוגע לכל שורות `error-thrown` עם convert כאן ולזריקות של `src/lib/data`. התיעוד של next-safe-action מדגים `handleServerError` שמכריע לפי `instanceof` של מחלקת שגיאה, ולא לפי תוכן. חייב להיסגר לפני המרת הודעות throw.
2. **מפות ברמת מודול.** 275 שורות `dynamic-key`. `extract` צריך מפתחות סטטיים, ו-`getT` אסור ברמת מודול. הדרך: פונקציה שקוראת ל-`t()` עם מפתחות literal ומחזירה את התווית לפי הערך. מפות שמוקלדות לפי enum צריכות לשמור על שלמות בזמן קומפילציה.
3. **plural.** נמדד ב-`Intl.PluralRules`: he = `one, two, other`, en = `one, other`, fr = `one, many, other`. i18next בוחר סיומת לפי count (`_one`, `_two`, `_other`), ומקבל ברירת מחדל ב-`defaultValue_<suffix>` (תיעוד i18next). הצורה בפרויקט היא `t(key, 'ברירת מחדל')`, ולא בדקתי איך `i18next-cli extract` מטפל בברירות מחדל לפי סיומת. 17 שורות, כולל `minutesLabel` ו-`daysBeforeHe`.
4. **Zod ברמת מודול.** נמדד ב-zod 4.6.7: `error` כפונקציה לא רץ בהגדרה, ורץ פעם אחת בכל parse שנכשל. כך הודעה יכולה לעבור ל-`t()` בלי לבנות schema בתוך פונקציה. תיעוד: הודעה ברמת check או schema גוברת על error map של parse. קשור ל-`agreements/link-url.ts`, `fleet/goal.ts`, `outreach/send-policy.ts:10`.
5. **טקסט בריאות שמשרת גם עמוד וגם Slack.** `email/health.ts`, `sms/extra-client.ts`, `sumit/health.ts` מחזירים `message` שהולך לעמוד admin ול-Slack מה-worker. כולם מחזירים גם `kind`, ולכן אפשר למפות `kind` לטקסט בעמוד ולהשאיר את Slack בעברית. `whatsapp/health.ts` הולך ל-Slack בלבד ונשאר keep.
6. **שפה מחוץ לבקשה.** `getT` קובע `he`. `getFixedT(lng, ns)` מקבל שפה מפורשת (תיעוד i18next), וזה הבסיס לכל נתיב worker. בלי מקור שפה לנמען אין מה להעביר לו.
7. **metadata.** `seo/open-graph.ts` מיוצא לעמודים סטטיים ו-`alt` חייב להיות זהה ל-`opengraph-image.alt.txt`. תרגום מחייב שפה לעמוד, כלומר `generateMetadata`.

## החלטות בעלים

1. איך הודעת שגיאה למשתמש מסומנת כבטוחה להצגה, במקום בדיקת עברית ב-`safe-action`.
2. האם אורח מקבל הודעות בשפה שלו, ומי קובע אותה (`guests.language` קיימת ואין לה אזכור בשם ב-`src`).
3. האם להגיש ל-Meta תבניות en/fr, ואיך route בוחר לפי שפה.
4. האם שיחות קול יוצאות בשפה אחרת, כלומר סוכן ופורמטרים נפרדים.
5. מה שפת ה-SMS למי שאין עליו מידע מלבד מספר טלפון.
6. מה שפת המייל ללקוח ולפונה, והאם גוף של AI או צוות נכתב בשפה הזו.
7. באיזו שפה לקוח en/fr מאשר את ההסכם, בהתחשב ב-hash של ה-PDF ובייעוץ המשפטי.
8. האם קבלה ומסמך זיכוי נשארים בעברית (`Language: 'he'`, `REFUND_LINE`, `RECEIPT_DESCRIPTION`).
9. `fleet/business-facts.ts`: להעביר את ניסוח המחיר לעמוד ולהשאיר עותק עברי לטיוטות AI, או להשאיר בעברית בלבד.
10. תבנית ייבוא אורחים: קובץ עברי אחד, או קובץ לכל שפה עם aliases ב-parser.
11. האם להציג תאריך עברי ב-en/fr.
12. `/admin/relocation`: לבחור `.en` או `.he` לפי שפת העמוד, בלי צרפתית, או להשאיר עברית למסך ops של הבעלים.
13. `payments/provider-value-labels.ts`: למזג ל-namespace `admin` עם מפתחות סטטיים, או להשאיר instance נפרד ולהוסיף לו en/fr.
14. `TEST_MONEY_MARK`: לפצל בין Slack למסך (`payments/test-money-label.ts`).
15. שגיאות JSON של `auth/console-agent.ts` לאפליקציה הנייטיבית: לתרגם לפי Accept-Language, או להשאיר עברית.
16. `CHANNEL_LABELS`: להוסיף מפה נפרדת ל-FAQ, כי הקיימת נכנסת להסכם החתום.

## מה הוסק ולא נבדק

`paymentBadge` כן נבדק: אין לו קורא מחוץ לבדיקות, גם ב-LSP וגם בחיפוש תבנית, ולכן 9 השורות שלו keep.

- הגעה למסך של `voximplant/core.ts` ו-`mutations.ts`, של זריקות `ledger.ts`, `credit-consumed.ts`, `purchase-provider.ts`. נגזר מ-refs ומבדיקת `HEBREW`, לא נבדק לכל קריאה.
- `email/sender.ts`: ארבעת הקוראים נקראו בחלקם. `sumit/mutator.ts`: רק `package-refund.ts` נקרא.
- `storage/event-media.ts`: `events/[id]/actions.ts` נבדק לפי צורת הקריאה. `storage/legal-docs.ts:30`: הטיפול ב-route לא נקרא. הנתיב `src/lib/storage` מוחרג משרת השפה, ולכן הקוראים נמצאו בחיפוש תבנית.
- `sdk-auth-client.ts`: הצגה בעמוד הפיתוח.
- `voice/override-policy.ts`: override של `language` קיים בקוד, ולא נבדק אם הוא פעיל בסוכנים.

## כיסוי

134 מתוך 134 קבצים נקראו במלואם. לא היה קובץ שלא ניתן לקרוא. `testing/cleanup.probe.ts` נקרא, ומחרוזת ה-fixture שלו דולגה לפי ה-brief, ולכן אין לו שורות.
