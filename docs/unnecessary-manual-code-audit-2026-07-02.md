# סריקת קוד-ידני-מיותר — 2026-07-02

**שיטה:** 16 סוכני find (חלוקה לפי תיקיות, כיסוי מלא של `src/` — 226 קבצים,
~30,258 שורות, לא sampling) + סוכן verify יריבי לכל ממצא (מנסה להפריך לפני
אישור). 47 סוכנים סה"כ, 0 שגיאות. **30 ממצאים אושרו, 1 הופרך.**

**סטטוס: תיעוד בלבד. לא בוצע שום שינוי קוד.** מסודר לפי תבנית חוזרת
(cross-cutting), כי רוב הממשקל האמיתי הוא בתיקון-אחד-לכל-התבנית, לא
תיקון-קובץ-בודד.

---

## 1. `unstable_rethrow` (Next.js built-in) — הכי משמעותי, ~17 קבצים

Next.js 16.2.9 (מאומת מול `node_modules/next/dist/docs/` ו-
`node_modules/next/dist/client/components/unstable-rethrow.js` בפועל, לא
מהזיכרון — לפי אזהרת `AGENTS.md`) מספק `unstable_rethrow(err)` מ-
`next/navigation`: זורק-מחדש שגיאת-בקרה פנימית (redirect()/notFound()) ובולע
כל שגיאה אחרת. הקוד הקיים מממש את זה ידנית, בשמות שונים
(`isNextRedirect`/`isNextControlFlow`/`isNextSignal`), עם בדיקות `err.digest`
לא-עקביות (חלק בודקים רק `NEXT_REDIRECT`, חלק גם `NEXT_NOT_FOUND`/
`NEXT_HTTP_ERROR_FALLBACK` — כלומר יש גם **פער-התנהגות אמיתי**, לא רק כפילות).

**קבצים (מאומת):**
- `src/app/(customer)/app/settings/actions.ts`, `settings/page.tsx`,
  `team/actions.ts`, `orders/page.tsx`, `events/actions.ts`,
  `events/[id]/actions.ts`, `events/[id]/guests/guests-actions.ts`,
  `events/[id]/guests/import/import-actions.ts`,
  `events/[id]/campaign/campaign-actions.ts` (9 קבצים)
- `src/app/(admin)/admin/agreement/actions.ts`, `channels/actions.ts`,
  `packages/actions.ts`, `settings/actions.ts`, `templates/actions.ts`
- `src/app/api/admin/orders/[id]/reconcile/route.ts`
- `src/app/api/admin/sumit-test/route.ts`
- `src/app/(public)/join/[token]/actions.ts`

**המלצה:** `import { unstable_rethrow } from 'next/navigation'; unstable_rethrow(err);`
בתחילת כל `catch` — מסיר ~17 פונקציות כפולות ומתקן את פער ה-`NEXT_NOT_FOUND`.

---

## 2. `getAppUrl()`/`getAppOrigin()` (עוגן קיים) לא נעשה בו שימוש

`src/lib/url.ts` נבנה בדיוק בשביל זה ("Absolute, shareable app URLs — RSVP
links, org-invite links, email links") ומחליף `process.env.APP_ORIGIN ?? ''`
בנפילה-חזרה לכותרות-הבקשה. שני מקומות עדיין בונים URL ידנית, ונופלים בשקט
לנתיב-יחסי אם `APP_ORIGIN` לא מוגדר:

- `src/lib/data/agreements.ts:204-220` — קישור-הורדת-הסכם באימייל
  (**בדיוק** הבאג שכבר תוקן פעם אחת עבור קישורי RSVP, commit `576e40f`).
- `src/app/(admin)/admin/channels/page.tsx:12-13` — callback URL של וואטסאפ
  שמוצג לאדמין להדבקה בדאשבורד Meta.

---

## 3. `esc()` (HTML-escape) משולש

מוגדר עצמאית ב-3 קבצים, עם אי-עקביות אמיתית: `src/lib/email/templates.ts`
ו-`src/lib/agreements/template.ts` מברחים 4 תווים (כולל `"`),
`src/app/api/admin/sumit-test/route.ts:46-51` מברח רק 3 (חסר `"`). שני
המודולים הראשונים מתועדים כ"pure, no I/O" — אין סיבה ארכיטקטונית שלא לחלוק.
**המלצה:** `src/lib/html.ts` עם `escapeHtml()` אחד.

---

## 4. כפילות טיפוסים מול הטיפוסים המיוצרים — כולל **באג אמיתי**

- **`src/lib/data/campaigns.ts:529-568` (ודאות גבוהה, באג אמיתי, לא רק כפילות):**
  `getCampaignForCharge()` בונה טיפוס-יד `CampaignChargeState` עם
  `max_charge_ceiling: string | null` — אבל הטיפוס המיוצר
  (`types.ts:477`) מגדיר אותו `number | null`. `close-charge.ts:88-89`
  קורא `parseFloat()` על זה כאילו זה string. אומת מול git history: commit
  `1b6ff16` הצדיק את זה כי "columns not in generated types yet"; commit
  `33948ea` **הסיר את ההצדקה הזו במפורש** ("now that the RPCs + columns are
  typed") אבל לא המיר את הפונקציה לדפוס `Pick<...>` שכבר בשימוש פעמיים
  באותו קובץ בדיוק (`OwnerCampaign`, `CampaignHoldState`). הטסטים
  (`campaigns.test.ts:497`, `close-charge.test.ts`) מדמים את זה כ-string
  `'88'`, מקבעים את ההנחה השגויה בפיקסצ'ר במקום לבדוק את הצורה האמיתית
  שחוזרת מ-PostgREST לעמודת `numeric`.
- `src/lib/data/message-templates.ts:13,32-44,55` — `ResolvedTemplate`/
  `MessageTemplate` ידניים במקום נגזרים מ-`Database[...]['Row']`
  (כולל ה-enum `campaign_channel` על עמודת `channel`).
- `src/lib/data/admin/labels.ts:58-67` מול `src/lib/data/admin/webhook-inbox.ts:37`
  — `WebhookState` מוגדר פעמיים; הגרסה ב-webhook-inbox.ts לא בשימוש בכלל.
- `src/app/(admin)/admin/settings/settings-form.tsx:14-29` — `Settings`
  מוצהר-מחדש שדה-לשדה זהה ל-`AppSettings` המיוצא כבר מ-`admin/settings.ts`.

---

## 5. רכיבי UI קיימים לא נעשה בהם שימוש חוזר

- `webhook-inspector-client.tsx:53-73` — `CopyButton` בונה מחדש state-machine
  של "העתק + reset אחרי 1.5 שנ'" — ההערה בקוד עצמו אומרת "Mirrors
  channels-client's CopyRow" (המחבר ידע שקיים מקביל).
- `agreement-client.tsx:39-62` — `RowSubmit` משכפל את `SubmitButton` הקיים
  ב-`src/components/forms.tsx:13-26` (אותה לוגיקת `useFormStatus`/pending).
- `events/[id]/guests/page.tsx:84-94,224-249` — עימוד-יד (`pageHref` +
  חישוב `Math.max(1, Math.ceil(...))` + ניווט "הקודם"/"הבא") במקום
  `Pagination` הקיים תחת `(admin)/admin/_components`.
- `admin/webhooks/page.tsx:59-62` מול `admin/activity/page.tsx:56-59` —
  `firstParam()` זהה-בית-לבית, כפול.

---

## 6. הגנת CSRF (`isAllowedOrigin`) משוכפלת ב-5 קבצי route

`src/app/api/orders/[id]/pay/route.ts:22-41`,
`campaigns/[id]/authorize/route.ts:42-60`,
`campaigns/[id]/close-charge/route.ts:17-35`,
`campaigns/[id]/whatsapp-send/route.ts:16-34`,
`admin/sumit-test/route.ts:28-44` — כולן זהות-בית-לבית. ההערה ב-
`authorize/route.ts` אומרת במפורש "Replicated from the orders pay handler" —
העתק-הדבק מודע, לא עיצוב-מקביל. **אין** מקור-אמת יחיד היום.

---

## 7. עיצוב מטבע/תוויות משוכפל

- `Intl.NumberFormat('he-IL', {style:'currency',...})` נבנה מקומית ב-3
  קבצים (`orders/page.tsx:9-12`, `settings/settings-client.tsx:36-39`,
  `orders/[id]/pay/page.tsx:6-9`).
- `events/page.tsx:5-21` — `EVENT_TYPE_LABELS`/`STATUS_LABELS` (מפות-תרגום
  לעברית לפי enum) מוגדרות מקומית.
- `src/lib/data/orders.ts:16-23` — `ORDER_STATUS_LABELS` מוגדר בקובץ עם
  `import 'server-only'`, כך שרכיב-קליינט חייב להקליד-מחדש-ידנית את אותה
  מפה כי אי-אפשר לייבא ממנה.

---

## 8. סינון ilike/PostgREST משוכפל — עם דריפט אמיתי-כבר-קיים

`src/lib/data/guests.ts:138-143` ו-`src/lib/data/admin/activity.ts:407-415`
זהים בית-לבית (regex + wrapping ב-`*…*`). `admin/webhook-inbox.ts:74`
מממש **גרסה שונה ורדודה יותר** (`/[%,]/g` בלבד, `%…%` במקום `*…*`) — כבר
סטתה. ל-guests.ts/activity.ts יש טסט-אבטחה ל"אין הזרקה"; ל-webhook-inbox.ts
אין. אומת מול תיעוד PostgREST החי (context7): `*` הוא alias רשמי ל-`%`
בדיוק כדי לעקוף בעיות URL-encoding — כלומר guests.ts/activity.ts הם
הדפוס הנכון, לא רק "אחד מכמה תקפים".

---

## 9. הרשאות/אדמין

- `src/lib/supabase/admin.ts:10,33` מול `src/lib/data/admin/settings.ts:185,197`
  — הקבוע `PLACEHOLDER_SERVICE_ROLE_KEY` והבדיקה שלו מוגדרים פעמיים
  עצמאית.
- `src/lib/auth/dal.ts:36-62` — `requireAdmin()` שולח שוב את אותה קריאת
  RPC ל-`has_role` ש-`isAdmin()` (מוגדר מיד מעליו, באותו קובץ) כבר עוטף,
  במקום לקרוא לו — round-trip מיותר כששניהם נקראים באותו render.

---

## ממצא שהופרך (לשקיפות — כך עובד שלב ה-verify)

`src/lib/validation/guests.ts` — נטען שה-regex הידני לוולידציית-טלפון
(`ISRAELI_PHONE_RE`) מיותר מול `src/lib/phone.ts` הקיים (עטיפת
`libphonenumber-js`). **הופרך**: `src/lib/validation/schemas.ts` (אחד משני
הקבצים שההמלצה כיוונה אליהם) נושא הערה מפורשת-וטעונת-משמעות:
"Dependency-free leaf (no `server-only`) — safe to import from this
client-react..." — כלומר יש סיבה אמיתית (גודל-bundle בצד-קליינט) שלא
לייבא שם את הספרייה הכבדה. הטענה שאין "הצדקת-גודל-bundle" הייתה שגויה
עובדתית לגבי אחד משני הקבצים הרלוונטיים.
