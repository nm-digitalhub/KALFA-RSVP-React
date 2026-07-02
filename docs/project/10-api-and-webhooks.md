# 10 — משטח ה‑API וה‑Webhooks

> אינוונטר מלא של כל נקודות הקצה בשרת: Route Handlers (‏`route.ts`), ‏Server Actions
> (‏`"use server"`), מקלטי Webhooks, וה‑worker שמעבד אירועים out‑of‑band.
> נכון לתאריך 2026‑07‑02, מבוסס על קריאת הקוד עצמו (לא על תיעוד קודם).
>
> שיטת האיסוף: `find src/app -name "route.ts"` (‏10 קבצים, כולל אחד מחוץ ל‑`/api`)
> ו‑`grep -rl '"use server"' src` (‏21 קבצים, 56 פעולות מיוצאות).

---

## טבלת סיכום — Route Handlers

| Route | Methods | Auth | תפקיד |
|---|---|---|---|
| `/api/webhooks/whatsapp` | GET, POST | webhook (verify_token / HMAC חתימה) | קליטת אירועי WhatsApp מ‑Meta: אימות מנוי + persist‑then‑process ל‑`webhook_inbox` |
| `/api/orders/[id]/pay` | POST | authenticated + ownership + CSRF | חיוב הזמנה ממתינה ב‑SUMIT (og‑token) עם נעילה אטומית |
| `/api/campaigns/[id]/authorize` | POST | authenticated + ownership + CSRF | תפיסת מסגרת J5 (‏hold) על כרטיס לקמפיין חתום (מסלול A) |
| `/api/campaigns/[id]/close-charge` | POST | authenticated + ownership + CSRF | סגירת קמפיין + חיוב סופי של הכרטיס התפוס (B4) |
| `/api/campaigns/[id]/whatsapp-send` | POST | authenticated + ownership + CSRF | שיגור ידני של הודעות WhatsApp לקמפיין (זמני, עד scheduler מלא) |
| `/api/admin/orders/[id]/reconcile` | POST | admin (`requireAdmin`) | התאמת הזמנות תקועות (`payment_review`/`processing`) מול SUMIT |
| `/api/admin/sumit-test` | POST | admin + CSRF | POC לבדיקת חיובי SUMIT חיים (J4/J5) עם תצוגה מוסתרת־סודות |
| `/app/events/[id]/campaign/[campaignId]/agreement` | GET | authenticated + ownership | הורדת PDF של ההסכם החתום מ‑bucket פרטי |
| `/auth/callback` | GET | public (code exchange) | החלפת קוד Supabase לסשן (אימות מייל / OAuth) |
| `/auth/logout` | POST | authenticated (session) | ניתוק סשן והפניה לדף הבית |

בנוסף: **56 Server Actions** ב‑21 קבצים (אינוונטר מלא בהמשך), ו‑worker חיצוני
(`worker/main.ts`, תהליך pm2 בשם `kalfa-worker`) שמריץ את כל הלוגיקה הכלכלית של ה‑webhooks.

---

## עקרונות רוחביים

מקורות: `src/proxy.ts`, `src/lib/auth/dal.ts`, `src/lib/security/rate-limit.ts`.

- **Proxy (middleware)** — `src/proxy.ts` (ב‑Next.js 16 השם הוא `proxy`, לא `middleware`):
  מרענן את סשן Supabase (‏`getUser()` — מאומת מול שרת ה‑Auth) ומבצע הפניה אופטימית
  של אנונימיים מ‑`/app` ו‑`/admin` ל‑`/auth/login`. **אינו** שכבת ההרשאה — ההרשאה
  האמיתית נאכפת קרוב לנתונים.
- **DAL** — `src/lib/auth/dal.ts`: ‏`requireUser()` (מפנה ל‑login אם אין משתמש),
  `requireAdmin()` (בודק תפקיד דרך ה‑RPC ‏`has_role` מול `user_roles` — לעולם לא מהדפדפן),
  `requireActiveOrg()` (הארגון הפעיל נקרא מ‑cookie אך תמיד מאומת מול חברויות בפועל).
  בעלות על אירוע נאכפת ב‑`requireOwnedEvent()` (‏`src/lib/data/events.ts`) בתוך שכבת הנתונים.
- **CSRF ב‑Route Handlers של תשלומים** — כל מסלולי ה‑POST הרגישים (`pay`, `authorize`,
  `close-charge`, `whatsapp-send`, `sumit-test`) מאמתים `Origin`/`Referer` מול
  `APP_ORIGIN` (משתנה סביבה שרת בלבד; ב‑development מתווסף `http://localhost:3002`).
  ‏fail‑closed: אם שני הכותרים חסרים — ‏403.
- **הפניות מאחורי proxy** — מסלולי הקמפיינים בונים redirect מ‑`APP_ORIGIN` ולא
  מ‑`request.url` (שמשקף את המארח הפנימי `127.0.0.1:3002` מאחורי nginx);
  ‏`/auth/*` משתמשים ב‑Location יחסי מאותה סיבה.
- **Fail‑closed feature gates** — כל פעולה כספית/תקשורתית נבדקת מול דגלים שמנוהלים
  ע"י אדמין ב‑DB‏ (`src/lib/data/payments.ts`, `src/lib/data/outreach-config.ts`):
  ‏`payments_enabled`, ‏`campaign_holds_enabled`, ‏`close_charge_enabled`, ‏`outreach_enabled`.
  פיצ'ר כבוי או קונפיגורציה חסרה ⇒ הפעולה לא מתחילה כלל.
- **Rate limiting** — מימוש in‑memory ב‑`src/lib/security/rate-limit.ts`
  (חלון קבוע, פר־process; מוגדר במפורש כקו הגנה ראשון בלבד). בשימוש כיום רק ב‑RSVP
  הציבורי (`RSVP_SUBMIT_RATE`: ‏5 לדקה פר token+IP, ‏`src/lib/constants.ts`) וב‑OTP
  (מנייה ב‑DB: ‏5 קודים לשעה פר phone+purpose, ‏`src/lib/data/otp.ts`).
  ל‑Route Handlers של התשלומים אין rate limit ייעודי — הידמפוטנטיות מושגת בנעילות אטומיות.
- **תבנית `FormState`** — רוב ה‑Server Actions מחזירות
  `{ error?, notice?, fieldErrors? }` (‏`src/lib/validation/result.ts`), עם ולידציית Zod
  בקצה והודעות שגיאה גנריות בעברית (בלי חשיפת פרטי DB/ספק). כולן מקפידות להעביר הלאה
  את סיגנלי ה‑control‑flow של Next‏ (`NEXT_REDIRECT`/`NEXT_NOT_FOUND`) ולא לבלוע אותם.

---

## נקודות קצה — Auth

### `GET /auth/callback` — `src/app/auth/callback/route.ts`
- **תפקיד:** החלפת `?code=` לסשן (`supabase.auth.exchangeCodeForSession`) אחרי אישור
  מייל או OAuth.
- **Auth:** public — הקוד עצמו הוא ההוכחה.
- **קלט:** ‏`code`, ‏`next` (מסונן: רק נתיב פנימי שמתחיל ב‑`/` ולא ב‑`//` — חסימת open redirect).
- **תגובה:** ‏303 ל‑`next` (ברירת מחדל `/app`) או ל‑`/auth/login?error=auth` בכישלון.
- **תופעות לוואי:** כתיבת cookies של סשן.

### `POST /auth/logout` — `src/app/auth/logout/route.ts`
- **תפקיד:** ‏`signOut()` והפניה 303 ל‑`/` (‏Location יחסי, proxy‑safe).
- **Auth:** מבוסס סשן; אין קלט.

### Server Actions נלוות — `src/app/auth/actions.ts`
- `login` — כניסה עם אימייל+סיסמה. Zod: ‏`loginSchema`. שגיאה אחידה ("אימייל או סיסמה שגויים").
- `signup` — הרשמה; ‏`signupSchema`; ‏`full_name`/`phone` נכנסים ל‑user_metadata ומועתקים
  ל‑`profiles` ע"י trigger‏ (`handle_new_user`). מזהה הרשמה חוזרת של מייל קיים
  (מערך `identities` ריק) וחוסם עם הודעה ברורה, בלי לאפשר enumeration.

---

## RSVP ציבורי

**אין Route Handler ציבורי ל‑RSVP** — ההגשה נעשית ב‑Server Action צמודת‑דף:

### `submitRsvpAction` — `src/app/(public)/r/[token]/actions.ts`
- **מודל אבטחה:** הפעולה כבולה ל‑token מהנתיב (bind בצד השרת) — הדפדפן לעולם לא
  מספק מזהה אורח. כל ההרשאה, הבדיקות (סטטוס אירוע, דדליין, ביטול token) והאטומיות
  מתבצעות בתוך ה‑RPC‏ `submit_rsvp` (‏`src/lib/data/rsvp.ts`).
- **Rate limit:** ‏`rsvp:submit:<token>:<ip>` לפי `RSVP_SUBMIT_RATE` (‏5/דקה) —
  לפני כל עיבוד.
- **ולידציה:** ‏`rsvpSubmitSchema` (‏`src/lib/validation/rsvp.ts`); תשובות מותאמות
  (`answer_<q_key>`) מורכבות מחדש מ‑FormData ומאומתות שוב בתוך ה‑RPC.
- **תגובה:** ‏`FormState` עם הודעות מיפוי בטוחות — קודי כשל
  (`not_found`/`closed`/`deadline_passed`/…) מתורגמים לעברית בלי לחשוף תקפות token
  מעבר למה שהדף כבר הציג.

### `acceptInvitationAction` — `src/app/(public)/join/[token]/actions.ts`
- קבלת הזמנת ארגון עבור המשתמש המחובר: ‏`acceptInvitation(token)` (‏`src/lib/data/orgs.ts`),
  קביעת cookie ‏`active_org` (‏httpOnly), והפניה ל‑`/app`. כל כשל ⇒ redirect חזרה עם
  שגיאה גנרית (בלי להסביר למה ה‑token פסול).

---

## אפליקציית הלקוח (customer)

### `GET /app/events/[id]/campaign/[campaignId]/agreement` — Route Handler מחוץ ל‑`/api`
`src/app/(customer)/app/events/[id]/campaign/[campaignId]/agreement/route.ts`
- **תפקיד:** הזרמת ה‑PDF של ההסכם החתום. המייל ללקוח מכיל **קישור** לנתיב הזה
  (לא קובץ מצורף — בעיית deliverability, ראו `docs/` בנושא IONOS).
- **Auth:** ‏`requireUser()` + אימות בעלות ידני: ‏event.owner_id = user.id וגם
  campaign.event_id = event.id; כל כשל ⇒ ‏404 אחיד.
- **מקור הנתונים:** ‏service‑role client + ‏`downloadLegalDoc` מ‑bucket פרטי
  (`src/lib/storage/legal-docs.ts`).
- **תגובה:** ‏`application/pdf`, ‏`Content-Disposition: inline`, ‏`Cache-Control: private, no-store`.

יתר פעולות הלקוח הן Server Actions (ראו אינוונטר בהמשך).

---

## Billing / SUMIT

עיקרון מרכזי: **ל‑SUMIT אין webhook נכנס אלינו.** הטוקניזציה נעשית בדפדפן ע"י
`payments.js` של SUMIT, שמזריק שדה `og-token` חד־פעמי לטופס שלנו; הטופס עושה POST
same‑origin לנקודות הקצה שלנו (לכן בדיקת ה‑CSRF תקפה). כל התקשורת עם SUMIT היא
outbound בלבד (`src/lib/sumit/*`), וההתאמה בדיעבד נעשית ב‑polling ידני של אדמין
(reconcile) — לא ב‑callback.

### `POST /api/orders/[id]/pay` — `src/app/api/orders/[id]/pay/route.ts`
- **צרכן:** ‏`payment-form.tsx` בדף `/app/orders/[id]/pay`.
- **Auth:** ‏CSRF ‏(Origin/Referer) → ‏`requireUser()` → קריאת ההזמנה דרך client
  משתמש (RLS‑scoped, `getOrder`).
- **ולידציה:** ‏`payPendingOrderSchema` (‏`src/lib/validation/schemas.ts`) על
  `order_id` + ‏`og-token`.
- **מנגנון:** gate כפול (`payments_enabled` + קונפיג SUMIT מ‑`app_settings`) →
  **נעילה אטומית** `(pending|failed) → processing` עם `payment_attempt_ref` חדש
  (UUID) — הסכום ושיעור המע"מ נלקחים מהשורה הנעולה (מניעת TOCTOU) → ‏`chargeSumit`.
- **מיפוי תוצאות:** דחייה מאומתת (`SumitDeclinedError`) ⇒ ‏`failed` (מותר retry);
  כל תוצאה עמומה (רשת/parse) ⇒ ‏`payment_review` (חסום retry); הצלחה ⇒ ‏`paid` +
  ‏`sumit_document_id`. אם ה‑DB update נכשל **אחרי** חיוב מוצלח ⇒ ‏`payment_review`
  עם שמירת `sumit_document_id` (נדרש למסלול reconcile A).
- **תגובה:** תמיד 303 (PRG) לדף התשלום/ההזמנות עם `?error=<code>` או `?paid=1`.

### `POST /api/campaigns/[id]/authorize` — `src/app/api/campaigns/[id]/authorize/route.ts`
- **צרכן:** ‏`hold-form.tsx` בדף `/app/events/[id]/campaign/[campaignId]/payment`.
- **תפקיד:** תפיסת מסגרת J5 (‏`AutoCapture:false`) אחרי חתימת הסכם — מסלול A של
  מודל החיוב לפי הישג (outcome billing). החיוב בפועל קורה רק בסגירה (B4).
- **Auth:** ‏CSRF → ‏`requireUser()` → ‏`getCampaignForHold` + ‏`requireOwnedEvent(campaign.event_id)`.
- **ולידציה:** ‏`authorizeHoldSchema` (‏`src/lib/validation/campaigns.ts`) על `og-token`.
- **Guards:** אירוע לא בעבר (`isPastEventDay`, L1), ‏`event.status='active'` (R9,
  הגנת עומק מעל ה‑trigger‏ `campaigns_require_active_event`), קמפיין `approved` בלבד,
  ‏gates: ‏`payments_enabled` + ‏`campaign_holds_enabled` + קונפיג SUMIT.
- **אידמפוטנטיות:** ‏`lockCampaignForHold` תופס את "משבצת ה‑hold" אטומית;
  ‏`prepareCampaignHold` מקפיא את סט אנשי הקשר המאושר ומחשב את גובה ה‑hold
  (מכוסה, לא התקרה המלאה) בצד השרת בלבד.
- **תוצאות:** דחייה ⇒ ‏`hold_failed`; עמימות/כשל persist אחרי אישור SUMIT ⇒
  ‏`hold_review` (עם לוג reconciliation שמכיל רק authNumber/authRef — לעולם לא
  token/תוקף/ת"ז). הצלחה שומרת token לשימוש חוזר + ‏authNumber (‏`recordCampaignHold`).
- **תגובה:** ‏303 לדף התשלום עם `?held=1` או `?error=<code>`.

### `POST /api/campaigns/[id]/close-charge` — `src/app/api/campaigns/[id]/close-charge/route.ts`
- **תפקיד:** סגירת קמפיין + חיוב סופי של הכרטיס התפוס. הסכום נגזר **בשרת** בתוך
  האורקסטרטור `closeCampaignAndCharge` (‏`src/lib/data/close-charge.ts`) — לעולם לא מהלקוח.
- **Auth:** ‏CSRF → ‏`requireUser()` → ‏ownership דרך `requireOwnedEvent`.
- **Gates:** ‏`payments_enabled` + ‏`close_charge_enabled` + קונפיג SUMIT (והאורקסטרטור בודק שוב).
- **תגובה:** ‏303 לדף האירוע עם `?charge=<outcome>&amount=<n>`.
- **הערה:** נכון להיום אין לו צרכן ב‑UI — המסלול המקביל בשימוש הוא ה‑Server Action
  ‏`settleCampaignAction` שקורא לאותו אורקסטרטור. הנתיב נשאר חי ושמור באותם gates.

### `POST /api/campaigns/[id]/whatsapp-send` — `src/app/api/campaigns/[id]/whatsapp-send/route.ts`
- **תפקיד:** שיגור ידני של הודעות WhatsApp לאנשי הקשר של קמפיין (פתרון ביניים עד
  שה‑scheduler ב‑pg‑boss מכסה הכול; האורקסטרטור `sendCampaignWhatsApp` בודק שוב את
  כל תנאי §8.3).
- **Auth:** ‏CSRF → ‏`requireUser()` → ‏ownership; ‏guard לאירוע שעבר (L1).
- **ולידציה:** ‏`whatsappSendSchema` על `message_key`.
- **Gates:** ‏`outreach_enabled` + קונפיג WhatsApp.
- **תגובה:** ‏303 לדף האירוע עם `?wa=done&sent=<n>&skipped=<n>` או קוד שגיאה.
- **הערה:** גם לנתיב זה לא נמצא צרכן UI פעיל כיום.

### `POST /api/admin/orders/[id]/reconcile` — `src/app/api/admin/orders/[id]/reconcile/route.ts`
- **Auth:** ‏`requireAdmin()`; ה‑redirect שהוא זורק מתורגם ל‑JSON ‏403 (API, לא HTML).
- **ולידציה:** ‏`reconcileBodySchema` — ‏Zod discriminated union מקומי על `action`:
  - `auto` (מסלול A): דורש הזמנה ב‑`payment_review` עם `sumit_document_id`; שואל את
    ‏SUMIT‏ (`/billing/payments/get/`) — ‏`ValidPayment:true` ⇒ ‏`paid`; ‏`false` ⇒ ‏`failed`;
    כל תשובה לא חד־משמעית ⇒ אין מעבר מצב (`reconciled:false`).
  - `manual` (מסלול B): האדמין אימת את החיוב ב‑UI של SUMIT ומספק `sumit_document_id`
    (מספר שלם חיובי) ⇒ ‏`paid` ישירות; כפילות מזהה מסמך ⇒ ‏409 גנרי.
  - `reset`: הזמנה תקועה ב‑`processing` ⇒ ‏`failed` (לעולם לא חזרה ל‑`pending` —
    הנעילה האטומית של pay מקבלת `failed` ומחליפה `payment_attempt_ref`).
- **תגובה:** ‏JSON‏ `{ reconciled: boolean, outcome: string }` או `{ error }` עם סטטוס מתאים.
- **צרכן:** ‏`reconcile-button.tsx` בדשבורד ההזמנות של האדמין (‏fetch מהדפדפן).

### `POST /api/admin/sumit-test` — `src/app/api/admin/sumit-test/route.ts`
- **תפקיד:** ‏POC אדמיני לבדיקת התנהגות SUMIT חיה: חיוב על og‑token חדש (מסלול A)
  או על token שמור (מסלול B, ‏J4, דורש ת"ז + תוקף), עם שליטה ב‑`AutoCapture`,
  ‏`AuthorizeAmount`, ‏`CardTokenNotNeeded`, ‏`PreventDocumentCreation`.
- **Auth:** ‏`requireAdmin()` + ‏CSRF.
- **תגובה:** דף HTML עם תצוגת request/response **מוסתרת־סודות** בלבד
  (allow‑list ב‑`src/lib/sumit/safe-preview.ts` — token/ת"ז/AuthNumber מצומצמים לבוליאנים);
  התוצאה העסקית נגזרת מ‑`Status===0 && ValidPayment===true` (ה‑HTTP status של SUMIT
  הוא 200 גם בדחייה).
- **ולידציה:** בדיקות ידניות בשרת (סכום חיובי, ת"ז/תוקף בחיוב token שמור); אין סכימת Zod.

---

## Webhooks — WhatsApp / Meta (בפירוט)

### `GET /api/webhooks/whatsapp` — אימות מנוי
`src/app/api/webhooks/whatsapp/route.ts`
- **חוזה:** Meta שולחת `hub.mode=subscribe`, ‏`hub.verify_token`, ‏`hub.challenge`.
- **אימות:** ה‑token מושווה ל‑`verify_token` שמנוהל ע"י אדמין ב‑DB‏
  (`getWhatsAppConfig`, ‏`src/lib/data/outreach-config.ts`). מכוון: ‏gate על נוכחות
  ה‑token **בלבד** (לא על `outreach_enabled`) — Meta מאמתת את ה‑callback עוד לפני
  הפעלת הערוץ.
- **תגובות:** אין token מוגדר ⇒ ‏404; התאמה ⇒ ‏200 עם ה‑challenge; אחרת ⇒ ‏403.

### `POST /api/webhooks/whatsapp` — קליטת אירועים (persist‑then‑process, B2)
- **Auth:** שרת‑לשרת — חתימת `X-Hub-Signature-256` (HMAC על ה‑raw body) **היא**
  ההרשאה; אין סשן/CSRF. האימות נעשה עם `whatsapp-api-js` המותקנת
  (`wa.verifyRequestSignature`) — לא crypto ידני. חתימה לא תקפה ⇒ ‏401; ‏JSON פגום ⇒ ‏400.
- **fail‑closed:** ‏`outreach_enabled` כבוי או `app_secret` חסר ⇒ ‏200 בלי לכתוב דבר
  (‏200 ולא 5xx בכוונה — מניעת retry storms של Meta על endpoint כבוי).
- **נרמול:** הקוד עובר על **כל** ה‑entries/changes במשלוח (batch) — במכוון לא דרך
  ה‑dispatcher של הספרייה שקורא רק את הראשון. כל `message` וכל `status` הופכים
  לשורת `webhook_inbox` עם:
  `provider='whatsapp'`, ‏`event_kind` (‏message/status), ‏`message_id`,
  ‏`context_message_id` (לשיוך תשובה להודעה יוצאת), ‏`phone_number_id`, ‏`event_at`,
  והפיילואד המלא.
- **אידמפוטנטיות (רמת DB):** ‏`dedupe_key` — ‏`wa-msg:<message.id>` להודעות,
  ‏`wa-status:<id>:<status>` לסטטוסים (כל שלב במחזור sent→delivered→read נשמר פעם
  אחת בלי התנגשות). ה‑insert הוא upsert עם `onConflict:'provider,dedupe_key'` +
  ‏`ignoreDuplicates` (‏`insertWebhookEvents`, ‏`src/lib/data/webhooks.ts`) — ‏retry של
  Meta הוא no‑op.
- **תגובה:** ‏200 ‏"ok" מהר; **שום לוגיקה עסקית לא רצה בבקשה** — אין לוג של payload,
  טלפון או סודות.

### עיבוד out‑of‑band — ה‑worker
`worker/main.ts` (‏pm2 ‏`kalfa-worker`; ‏cron פנימי של pg‑boss כל דקה, batch של 50):
- **Claim:** ‏`claimUnprocessedWebhookEvents` דרך ה‑RPC‏ `claim_webhook_events`
  ‏(SECURITY DEFINER, ‏service_role בלבד) עם `FOR UPDATE SKIP LOCKED` — שני drains
  חופפים מקבלים סטים זרים. תקרת ניסיונות: ‏`attempts < 5`; שורה "מורעלת" נשארת
  ל‑inspector עם `last_error` ולא חוסמת את התור.
- **לוגיקה** (‏`processWebhookEvent`, ‏`src/lib/data/webhook-processing.ts`):
  - ‏`message`: זיהוי איש הקשר (לפי `context_message_id` עם fallback לטלפון),
    רישום אינטראקציה, **חיוב reach** (‏`recordReached` — מוגן ב‑UNIQUE כך שאין
    double‑billing), זיהוי לחצני RSVP לפי מיפוי מזהים אטומים
    (`rsvp_attending`/`rsvp_declined`/`rsvp_maybe` → ‏`submitRsvp`), וטיפול בבקשות הסרה.
  - ‏`status`: עדכון סטטוס מסירה; קוד כשל 131026 של Meta מסומן כ"מספר שגוי"
    (שמרני; הקוד הגולמי תמיד נשמר לביקורת).
- **סימון:** הצלחה ⇒ ‏`processed_at` (סופי); כשל ⇒ ‏`attempts+1` + ‏`last_error`
  (הודעה אטומה, לעולם לא payload).
- **עיבוד מחדש:** ‏`reprocessWebhookEventAction` (אדמין, ראו למטה) מאפס
  ‏`processed_at`/`last_error`/`attempts` כדי שה‑claim הבא ירים את השורה שוב — בטוח
  כי העיבוד אידמפוטנטי.

### SUMIT — אין מקלט webhook
אין `route.ts` שמקבל callbacks משרתי SUMIT. נקודות המגע היחידות: טפסי og‑token
same‑origin (למעלה) והתאמת אדמין יזומה (`reconcile`). אם יתווסף callback עתידי —
נדרש לו אימות חתימה/סוד ייעודי משלו.

---

## אינוונטר Server Actions (‏21 קבצים, 56 פעולות)

ההרשאה המצוינת היא זו שנאכפת בפועל — לרוב בתוך שכבת הנתונים (‏DAL) שהפעולה קוראת לה,
כך שה‑action נשאר דק. כל הפעולות מוולידות עם Zod אלא אם צוין אחרת.

### ציבורי / Auth
| קובץ | פעולה | תפקיד | הרשאה |
|---|---|---|---|
| `src/app/auth/actions.ts` | `login` | כניסה באימייל+סיסמה | public (יוצר סשן) |
| | `signup` | הרשמה + אימות מייל; חסימת מייל קיים | public |
| `src/app/(public)/r/[token]/actions.ts` | `submitRsvpAction` | הגשת RSVP ציבורית כבולת‑token | token + rate‑limit + ‏RPC ‏`submit_rsvp` |
| `src/app/(public)/join/[token]/actions.ts` | `acceptInvitationAction` | קבלת הזמנת ארגון וקביעת org פעיל | authenticated + token (‏`acceptInvitation`) |

### לקוח — אירועים ואורחים
| קובץ | פעולה | תפקיד | הרשאה |
|---|---|---|---|
| `src/app/(customer)/app/events/actions.ts` | `createEventAction` | יצירת אירוע (`createEventSchema`) | `requireUser` בתוך `createEvent` |
| `src/app/(customer)/app/events/[id]/actions.ts` | `updateEventAction` | עדכון פרטי אירוע; מפתחות מותנים ב‑`formData.has` | ownership בתוך `updateEvent` |
| `src/app/(customer)/app/events/[id]/guests/guests-actions.ts` | `createGuestAction` | הוספת מוזמן + סנכרון best‑effort ל‑`contacts` | ownership בשכבת `guests.ts` (‏`requireOwnedEvent`) |
| | `updateGuestAction` | עדכון מוזמן (+re‑link איש קשר אם הטלפון השתנה) | כנ"ל |
| | `deleteGuestAction` | מחיקת מוזמן | כנ"ל |
| | `setContactStatusAction` | עדכון סטטוס יצירת קשר; מאומת מול ה‑enum של ה‑DB | כנ"ל |
| | `createGroupAction` / `deleteGroupAction` | ניהול קבוצות אורחים (`groupSchema`) | כנ"ל |
| | `revokeRsvpTokenAction` / `regenerateRsvpTokenAction` | ביטול/חידוש קישור RSVP (ה‑token מוסתר מכל תצוגת בעלים) | ownership בתוך `rsvp.ts` |
| `src/app/(customer)/app/events/[id]/guests/import/import-actions.ts` | `importGuestsAction` | ייבוא CSV: מגבלות גודל/שורות (`CSV_MAX_BYTES`/`CSV_MAX_ROWS`), ולידציה פר שורה (`importRowSchema`), הצלחה חלקית + דיווח שגיאות בעברית, בניית contacts, ‏`logActivity` | ownership בשכבת הנתונים |

### לקוח — קמפיין ומחזור חיים
`src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts`
| פעולה | תפקיד | הרשאה |
|---|---|---|
| `setupCampaignAction` | יצירה/המשך קמפיין האירוע (תבנית ולוח זמנים נקבעים בשרת) | ownership בתוך `createCampaign` |
| `requestSigningOtpAction` | שליחת OTP ב‑SMS לטלפון שבפרופיל (שלב 1 של חתימה) | `requireUser`; ‏rate‑limit ב‑`requestOtp` (5/שעה) |
| `signAgreementAction` | אימות OTP + חתימה + הסכמות → אישור קמפיין; ‏`tos_version` נקבע מהמסמך הפעיל ב‑DB, שם/טלפון חותם מהפרופיל — לא מהדפדפן | ownership בתוך `recordSignedAgreement` |
| `activateCampaignAction` / `pauseCampaignAction` / `closeCampaignAction` | מעברי מחזור חיים §9 | ownership בתוך המעבר בשכבת `campaigns.ts` |
| `settleCampaignAction` | גמר חשבון: סגירה + חיוב הכרטיס התפוס דרך `closeCampaignAndCharge`; אוכף ownership בקצה (CAMP‑1) כי האורקסטרטור מדלג על `closeCampaign` לקמפיין סגור | `getCampaignForHold` + ‏`requireOwnedEvent` בפעולה עצמה |
| `publishEventAction` / `closeEventAction` | פרסום/סגירת אירוע (R3/R6/R7) | ownership + חוקי R1–R9 ב‑`events.ts` + triggers |
| `cancelCampaignAction` | ביטול קמפיין (R8) | ownership בתוך `cancelCampaign` לפני ה‑RPC |

### לקוח — הגדרות, צוות, אדמין ראשון
| קובץ | פעולה | תפקיד | הרשאה |
|---|---|---|---|
| `src/app/(customer)/app/settings/actions.ts` | `updateProfileAction` | עדכון שם/טלפון (`updateProfileSchema`) | `requireUser` בתוך `updateProfile` |
| | `updateSettingsAction` | העדפות התראות (`updateSettingsSchema`) | כנ"ל |
| | `requestEmailChangeAction` | החלפת מייל ב‑double opt‑in של Supabase; ‏`logActivity` | סשן המשתמש עצמו |
| | `sendPasswordResetAction` | שליחת קישור איפוס סיסמה למייל החשבון; ‏`logActivity` | `requireUser` |
| `src/app/(customer)/app/team/actions.ts` | `setActiveOrgAction` | החלפת ארגון פעיל — ה‑id מאומת מול חברויות לפני כתיבת ה‑cookie | `getOrgContext` |
| | `inviteMemberAction` | יצירת הזמנת חבר + קישור הצטרפות (`getAppUrl`) | `requireActiveOrg` + הרשאות ב‑`orgs.ts` |
| | `changeMemberRoleAction` / `removeMemberAction` | ניהול חברים | כנ"ל |
| | `resendInvitationAction` / `revokeInvitationAction` | ניהול הזמנות | כנ"ל |
| `src/app/(customer)/app/admin-access/actions.ts` | `claimFirstAdminAction` | תביעת אדמין ראשון דרך RPC‏ `claim_first_admin` (‏SECURITY DEFINER, אטומי, בלי ארגומנטים) | `requireUser`; ההרשאה בתוך ה‑RPC |

### אדמין (`(admin)/admin/*`) — כולן נשענות על `requireAdmin()`
ההרשאה נאכפת בתוך שכבת הנתונים `src/lib/data/admin/*` (או בפעולה עצמה כשמצוין),
בנוסף ל‑RLS של טבלאות האדמין.

| קובץ | פעולות | תפקיד |
|---|---|---|
| `agreement/actions.ts` | `saveAgreementAction`, `approveAgreementAction`, `revertAgreementAction` | עריכת מסמך ההסכם (טיוטה→אישור→שחזור תבנית); ‏`agreementEditSchema`/`agreementApproveSchema` |
| `agreement/config-actions.ts` | `saveAgreementConfigAction` | 7 ערכי קונפיג של ההסכם ל‑`app_settings`; ‏`requireAdmin` בפעולה + כתיבה דרך client סשן (RLS נשמר, לא service‑role) |
| `callbacks/actions.ts` | `updateCallbackStatusAction` | עדכון סטטוס בקשת callback‏ (`updateCallbackStatusSchema`) |
| `channels/actions.ts` | `updateWhatsAppChannelAction`, `testWhatsAppConnectionAction` | קונפיגורציית ערוץ WhatsApp (phone_number_id/WABA/tokens); ‏fail‑closed — אי אפשר להפעיל בלי מזהה+token; בדיקת חיבור חיה |
| `company/actions.ts` | `updateCompanyAction` | פרטי החברה המשפטיים (`companySettingsSchema`) |
| `packages/actions.ts` | `createPackageAction`, `updatePackageAction`, `deletePackageAction` | ניהול חבילות/מחירים (`packageBaseSchema`) — מקור האמת העסקי ב‑DB |
| `settings/actions.ts` | `updateSettingsAction` | דגלי מערכת + סודות ספקים (SUMIT/SMS/SMTP) ל‑`app_settings`‏ (`appSettingsSchema`) |
| `templates/actions.ts` | `updateTemplateAction` | תבניות הודעה; ‏fail‑closed — אין הפעלה בלי שם/תוכן |
| `users/actions.ts` | `grantAdminAction`, `revokeAdminAction`, `suspendUserAction`, `reactivateUserAction`, `grantCreditAction`, `updatePlanAction` | ניהול משתמשים והטבות; הגנות last‑admin / no‑self‑lockout בשכבת `admin/users.ts` |
| `webhooks/actions.ts` | `reprocessWebhookEventAction` | ‏re‑queue של שורת `webhook_inbox` (איפוס processed_at/attempts); ‏`requireAdmin` בפעולה + ‏`logActivity` |

---

## פנימי / תפעול

- **worker** — ‏`worker/main.ts`: תהליך נפרד (esbuild → ‏`dist/worker.cjs`, ‏pm2
  ‏`kalfa-worker`) שמתחבר ל‑Postgres דרך ה‑session pooler. תורים
  (‏`src/lib/queue/queues.ts`): ‏`step` (צעדי outreach פר איש קשר, מזהי job
  דטרמיניסטיים למניעת כפילויות), ‏`arm` (כל דקה) + ‏`sweeper` (כל 5 דקות) שזורעים
  ומרפאים את הצעדים, ‏`webhook` (כל דקה — ניקוז `webhook_inbox`). ‏`stepGate`
  ‏fail‑closed על `outreach_enabled`, כך שהתהליך אינרטי עד go‑live.
- **שכבת ה‑web נקייה מ‑pg‑boss** — אין endpoint שמכניס jobs ישירות; הכול נזרע
  מהקרונים של ה‑worker עצמו.
- אין נקודות קצה בסגנון health/cron ב‑HTTP; ניטור נעשה דרך pm2 ודף
  ‏`/admin/webhooks` (רצועת בריאות + inspector).

---

## הצלבה מול `docs/routes-webhooks.md`

המסמך הקיים (`docs/routes-webhooks.md`, עדכון אחרון 2026‑06‑30) **תואם לקוד** בכל
מה שהוא מכסה: חוזה ה‑GET (gate על נוכחות `verify_token` בלבד), חוזה ה‑POST
(חתימה → נרמול → insert אידמפוטנטי → ‏200 מהיר, בלי לוגיקה עסקית), ודף
‏`/admin/webhooks`. עם זאת:

- **היקפו צר** — הוא מתעד רק את צינור ה‑WhatsApp webhook; כל שאר משטח ה‑API
  (תשלומים, reconcile, ‏auth, ‏RSVP, ‏Server Actions) לא מכוסה שם. המסמך הנוכחי
  הוא האינוונטר המלא.
- ה‑TODO בסופו (הוספת `/admin/webhooks` למפת ה‑routes ב‑`CLAUDE.md`/`AGENTS.md`)
  עדיין פתוח.
- לא נמצאו אי‑התאמות עובדתיות בינו לבין הקוד נכון להיום.

---

## מגבלות ידועות

- ‏rate limiting הוא in‑memory ופר־process — לא מדויק תחת ריבוי אינסטנסים; שדרוג
  production מתועד בקובץ עצמו (`src/lib/security/rate-limit.ts`).
- ‏`/api/campaigns/[id]/close-charge` ו‑`/api/campaigns/[id]/whatsapp-send` הם
  endpoints חיים ללא צרכן UI נוכחי (הפונקציונליות זמינה דרך Server Actions /
  ה‑worker) — מועמדים לבחינה בעת ניקוי עתידי.
- ‏`/api/admin/sumit-test` הוא כלי POC אדמיני; אינו חלק ממסלול לקוח והוסתרו בו כל
  הסודות בתצוגה, אך ראוי לנטרול כשה‑flows הקבועים יתייצבו.
