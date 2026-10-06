# מפת-routes — Webhooks (WhatsApp/Meta)

> נתיבים הקשורים לצינור-ה-webhook. מקור: `src/app/api/webhooks/whatsapp/route.ts`,
> `src/app/(admin)/admin/webhooks/`, `src/components/admin-shell.tsx`.

| נתיב | סוג | גישה | תפקיד |
|---|---|---|---|
| `/api/webhooks/whatsapp` | Route Handler (`GET`+`POST`) | ציבורי (חתום) | נקודת-הקצה שמקבלת קריאות מ-Meta. `GET` = אימות (מחזיר `hub.challenge`), גדור על נוכחות `verify_token` בלבד (לא על `outreach_enabled`). `POST` = אימות `X-Hub-Signature-256` על raw body → נרמול → INSERT אידמפוטני ל-`webhook_inbox` → 200 מהיר. **אין לוגיקה עסקית ב-route.** חריג אחד: הודעה (לא status) למספר שנבחר לסוכן הבעלים (`app_settings.owner_agent_phone_number_id`) מטלפון ברשימת ההיתר הפעילה מוסטת ל-`src/lib/owner-agent/intake.ts` ולא ל-`webhook_inbox`, גם כש-`outreach_enabled` כבוי. כשלא נבחר מספר (ברירת המחדל) אין שום הבדל. התשובה של ה-route לא תלויה בסוכן. `plans/owner-whatsapp-agent-plan.md` §2.2–2.3. |
| `/admin/webhooks` | עמוד (App Router) | `requireAdmin()` | **route חדש.** Inspector ל-`webhook_inbox`: רשימה מסוננת/מודפסת + רצועת-בריאות + מגירת-detail (`?inspect=<id>`) + עיבוד-מחדש. ראה [`admin-webhooks-runbook.md`](./admin-webhooks-runbook.md). |

`/admin/webhooks` רשום ב-NAV של האדמין (`src/components/admin-shell.tsx`, "בדיקת
Webhooks", אייקון `Webhook`). `callbackUrl` המוצג ב-`/admin/integrations/meta-whatsapp` הוא
`${origin}/api/webhooks/whatsapp`.

> **TODO (מחוץ ללאן docs/):** ב-`CLAUDE.md`/`AGENTS.md` יש להוסיף את `/admin/webhooks`
> למפת-ה-routes הכללית אם/כשתתוחזק שם. עדכון זה מסומן לליאד ולא בוצע מכאן.
