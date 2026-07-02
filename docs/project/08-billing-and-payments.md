# 08 — חיוב ותשלומים (Outcome Billing & SUMIT)

מסמך זה מתעד את מערכת החיוב והתשלומים של KALFA כפי שהיא **בקוד בפועל** (נכון ל-2026-07-02).
כל קביעה מגובה בקובץ/שורות; פריטים שקיימים רק בתכנון מסומנים **"מתוכנן, טרם מומש"**.

מסמכים נלווים: `docs/billing-backhalf-2026-06-26.md` (סיכום סשן),
`plans/billing-implementation-tasklist.md` (רשימת משימות), `plans/plan-paid.md` (אפיון §1–§18),
`docs/sumit-payments-implementation.md`, `docs/sumit-response-capture-and-audit.md`.

---

## 1. מודל החיוב — לפי תוצאה, לא חבילות

KALFA מחייבת **לפי איש קשר ייחודי שהושג** (תגובת WhatsApp נכנסת אמיתית או מענה אנושי בשיחה) —
**לא** רכישת חבילה ולא מנוי. הזרימה המחייבת: אישור קמפיין ← חתימת הסכם (עם OTP) ← תפיסת מסגרת
J5 בכרטיס ← צבירת `billed_results` ← חיוב סופי בסגירה, עד תקרה.

הנוסחאות (כולן server-side, לעולם לא מהדפדפן):

| מושג | נוסחה | מקור |
|---|---|---|
| תקרת חיוב (ceiling) | `price_per_reached × max_contacts` (full), מעוגל לאגורות | `src/lib/data/campaigns.ts:45-47` (`computeCeiling`) |
| covered | `min(full_unique, reasonable_coverage)` — בסיס ה-hold וה-SET | `campaigns.ts:52-57` (`computeCovered`) |
| סכום ה-hold (J5) | `max(min_hold_floor, covered × price × (1 + hold_buffer_pct))` | `campaigns.ts:66-75` (`computeHoldAmount`) |
| סכום צבור (accrued) | `Σ locked_price` על `billed_results` של הקמפיין | RPC `campaign_billing_summary` |
| חיוב סופי | `max(0, round(min(accrued, ceiling) − credits))` באגורות | `src/lib/data/close-charge.ts:87-99` |

עקרונות מפתח (כולם ממומשים):

- **התקרה לעולם אינה מונמכת ל-covered** — covered מגדיר את גובה ה-hold בלבד (ביטחון), לא את
  התקרה (`campaigns.ts:450-521`, `prepareCampaignHold`; ראו גם `plans/verification-corrections.md`).
- **SET מורשה קפוא** (`campaign_authorized_contacts`) נוצר בצעד ה-hold ומהווה את התקרה
  המחייבת על "הושג": איש קשר שאינו ב-SET לעולם לא מחויב (fail-closed — SET ריק לא מחייב אף אחד).
  זהו "שומר דליפת הכסף" שהופך hold קטן מהתקרה לבטוח: `reached ⊆ set` מבנית
  (מיגרציות `202606290024_billing_authorized_set.sql`, `202606290029_billing_set_membership.sql`).
- **חיוב אחד לכל איש קשר לכל אירוע** — אילוץ DB ‏`UNIQUE(event_id, contact_id)` על
  `billed_results` (‏`202606240007_outcome_billing_schema.sql`).
- **מחיר ננעל בעת הרישום** (`billed_results.locked_price`) — שינוי מחיר עתידי אינו משנה חיוב שנצבר.
- **זיכויים** (`billing_credits`, append-only) מקוזזים בסגירה ברמת הקמפיין בלבד; זיכוי ברמת אירוע
  (ללא `campaign_id`) אינו מקוזז כאן (`src/lib/data/billing.ts:89-100`).
- **0 הושגו ⇒ ₪0, בלי קריאת ספק** (`close-charge.ts:96-99`).
- knobs של גודל ה-hold ‏(`reasonable_coverage_contacts`, `min_hold_floor`, `hold_buffer_pct`)
  הם קונפיג אדמין ב-DB — לא hardcode (`campaigns.ts:399-441`; מיגרציה 0024).

הכרעות שאומצו (מ-`docs/billing-backhalf-2026-06-26.md` §4): שני הערוצים (WhatsApp + שיחות)
בביתא; `orders/pay` הוא **משני/legacy**; כל ספק וכל חיוב אמיתי **config-gated וכבוי כברירת מחדל**;
‏§18 (15 קריטריוני קבלה) הוא ספק הבדיקות.

---

## 2. זרימת קצה-לקצה של קמפיין

1. **יצירה** — `createCampaign` (`campaigns.ts:129`): קמפיין יחיד לאירוע, ב-`pending_approval`;
   מחיר/ערוצים/לו"ז ננעלים מהתבנית הקנונית (`packages`).
2. **חתימת הסכם** — `/app/events/[id]/campaign/[campaignId]/approve` ← ‏
   `recordSignedAgreement` (‏§8 להלן): אימות OTP בטלפון, רינדור PDF, אחסון, ואז `approveCampaign`.
3. **תפיסת מסגרת (route A / J5)** — עמוד
   `/app/events/[id]/campaign/[campaignId]/payment` ‏(`payment/page.tsx`) מציג את טופס הכרטיס רק
   כשכל השערים דולקים, ושולח ל-`POST /api/campaigns/[id]/authorize` (§6).
4. **הפעלה ו-outreach** — מנוע הפניות (`src/lib/data/outreach-engine.ts`) מסונן ל-SET המורשה.
5. **רישום "הושג"** — webhook נכנס של WhatsApp (persist-then-process,
   `src/app/api/webhooks/whatsapp/route.ts`) ← worker ← `recordReached`
   (`src/lib/data/billing.ts:30-47`) ← RPC ‏`try_record_billed_result`.
6. **סגירה וחיוב סופי** — `settleCampaignAction`
   (`src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts:221`) או
   `POST /api/campaigns/[id]/close-charge` ← ‏`closeCampaignAndCharge`
   (`src/lib/data/close-charge.ts`) ← חיוב הטוקן השמור ב-SUMIT + קבלה במייל.

---

## 3. אינטגרציית SUMIT — `src/lib/sumit/`

כל המודולים `server-only`, כולם קוראים ל-endpoint אחד:
`https://api.sumit.co.il/billing/payments/charge/` (ולנתיב reconcile גם
`/billing/payments/get/`). ה-credentials (‏CompanyID + APIKey) נקראים מ-`app_settings`
דרך service-role בלבד (`src/lib/data/payments.ts:92-109`) ולעולם לא מגיעים לדפדפן.

| מודול | תפקיד | ייצור/PoC |
|---|---|---|
| `charge.ts` | חיוב J4 מיידי בטוקן חד-פעמי (`SingleUseToken`) — משמש את orders/pay | ייצור (legacy) |
| `authorize.ts` | תפיסת מסגרת J5 (`AutoCapture:false`) — משמש את authorize route | ייצור |
| `capture.ts` | חיוב סגירה על הטוקן השמור (charge טרי, לא capture של ה-auth) | ייצור |
| `raw-charge.ts` | קריאת אבחון שמחזירה את התגובה הגולמית — משמש רק את ה-PoC האדמיני | PoC |
| `safe-preview.ts` | הקרנה בטוחה (redaction) של בקשה/תגובה לתצוגת אדמין | PoC |

### התנהגות SUMIT שאומתה חי (מקודדת בקוד)

- **מעטפת התגובה**: `Status` הוא enum ‏`0=Success / 1=BusinessError / 2=TechnicalError`
  (לא אובייקט `{IsError}` בלבד — המתאמים מקבלים את שלוש הצורות; `authorize.ts:79-122`).
  **‏HTTP 200 אינו הצלחה עסקית** — גם דחייה חוזרת 200; ההצלחה נקבעת מ-`Status===0` **וגם**
  `Data.Payment.ValidPayment===true` (‏`capture.ts:36-39,113-131`; `admin/sumit-test/route.ts:53-65`).
- **‏`Items[].Item.Name` חובה** — פריט עם `Description` בלבד מחזיר BusinessError
  ‏"Missing Item details" (‏`authorize.ts:47-55`, `raw-charge.ts:60-65`, `capture.ts:58-66`).
- **‏J5 hold**: ‏`AutoCapture:false` + `AuthorizeAmount` + `PreventDocumentCreation:true`
  (‏hold ללא מסמך Order לאיזון) + `SendDocumentByEmail:false` (‏`authorize.ts:57-62`).
- **‏AuthNumber**: קוד האישור חוזר ב-`Data.Payment.AuthNumber`; hold נחשב מאושר רק עם
  ‏Success + AuthNumber + ‏`ValidPayment===true` במפורש (`authorize.ts:124-134`).
- **טוקן רב-פעמי**: התגובה ל-authorize מחזירה `PaymentMethod.CreditCard_Token` + תוקף +
  ‏CitizenID — כולם נדרשים בחיוב העתידי ונשמרים ב-hold (‏`authorize.ts:136-150`).
- **חיוב טוקן שמור**: ‏`PaymentMethod = {CreditCard_Token, CreditCard_ExpirationMonth/Year,
  CreditCard_CitizenID, Type:1}` — ‏`Type:1` חובה; ‏PaymentMethod ו-SingleUseToken בלעדיים
  הדדית (`raw-charge.ts:71-89`, `capture.ts:49-55`).
- **‏VATRate ‏null במפורש בחיוב טוקן שמור** — שליחת שיעור מספרי הפיקה
  ‏"products vs payments mismatch"; ברירת המחדל של החברה מאזנת את המסמך. במסלול כרטיס-חדש
  ‏(SingleUseToken) נשלח שיעור מספרי כרגיל (`raw-charge.ts:50-55`; `capture.ts:56-57` משמיט לגמרי).
- **אין capture של ה-auth המקורי** — ניסיון לתפוס `CreditCardAuthNumber` ישן נדחה (קוד 004);
  המנגנון העובד הוא **charge טרי** על הטוקן השמור (`capture.ts:27-39`).
- **‏SendDocumentByEmail**: ב-PoC תמיד `true` (‏`raw-charge.ts:68`); בייצור — ‏`!!customerEmail`
  (קבלה במייל רק כשיש כתובת; `charge.ts:46-49`, `capture.ts:69`), וב-hold ‏`false`.
- **‏Customer.ExternalIdentifier** — עוגן ההתאמה (reconciliation): ‏UUID שנוצר בשרת ונשמר
  (`orders.payment_attempt_ref` / `campaigns.auth_external_ref`; מיגרציה
  `202606290025_campaign_auth_external_ref.sql`). ל-SUMIT אין חיפוש לפי ExternalIdentifier —
  ‏lookup פרוגרמטי אפשרי רק לפי `sumit_document_id` (‏reconcile route).

### סמנטיקת שגיאות (עקבית בכל המתאמים)

`SumitDeclinedError` נזרק **רק** על דחייה עסקית ודאית (Status=1 / `{IsError:true}` בגוף 2xx,
או `ValidPayment===false`); כל השאר — רשת, non-2xx, JSON לא תקין, חסר DocumentID/AuthNumber —
הוא `SumitNetworkError` = תוצאה עמומה, שמנותבת ל-`*_review` ולעולם לא ל-retry אוטומטי
(`charge.ts:19-30,61-96`; ההשלכות ב-§6).

### `safe-preview.ts` — redactor ברשימת-היתר (fail-closed)

הקרנה **מפורשת בלבד** מנתיבים ידועים — אין walker גנרי שמעתיק מפתחות, ולכן שדה חדש/לא-מוכר
של הספק לעולם לא זולג לפלט (`safe-preview.ts:3-15`). זהויות וסודות לעולם אינם מוצגים כערך:
`CompanyID`/`ExternalIdentifier`/`EmailAddress` ← בוליאני `*_present`; ‏`CreditCard_Token` ←
`has_card_token`; ‏`SingleUseToken` ← ‏`og_token_present`; **‏`AuthNumber` ← ‏`has_auth_number`**
(‏שורה 74); ‏APIKey/CitizenID/PAN/CVV/Track2/StatusDescription — לא נקראים כלל.
מה שכן מוצג: סכום, VATRate, ‏AutoCapture, ‏DocumentID/Number, ‏4 ספרות אחרונות ומסכת כרטיס.

---

## 4. מסלול A מול מסלול B

שני מובנים למונחים בפרויקט — חשוב להבחין:

**ברמת המוצר (קמפיין):** ‏route A = תפיסת J5 באישור + חיוב בסגירה; ‏route B = שמירת טוקן בלבד
באישור + charge בסגירה. ההכרעה המתועדת (tasklist) העדיפה את B כברירת מחדל, אך **מה שממומש
בפועל הוא route A** — ובגרסה היברידית: ה-J5 נתפס כביטחון, והחיוב הסופי הוא **charge טרי על
הטוקן השמור** (לא capture של ה-auth). העמודה `campaigns.billing_route`
(‏enum ‏`saved_token|hold_j5`, מיגרציה 0007) קיימת אך **אינה בשימוש בקוד** כיום.

**ברמת ה-PoC האדמיני (`/admin/sumit-test`):** ‏"מסלול A" = כרטיס חדש בטוקניזציית `payments.js`
(עם בחירת J4/J5), ‏"מסלול B" = חיוב J4 ישיר על טוקן שמור. טופס route B הוא `<form>` נפרד ללא
`data-og="form"` כדי ש-payments.js לא ייגע בו (`admin/sumit-test/page.tsx:27-34`).

**שדות חובה במסלול B (טוקן שמור)** — נאכפים בשרת לפני הקריאה ל-SUMIT
(`api/admin/sumit-test/route.ts:146-162`):

- `route_b_citizen_id` — ת"ז בעל הכרטיס, **חובה לכרטיסים ישראליים** (אומת חי; ה-swagger מגדיר
  זאת conditional per-issuer).
- `route_b_exp_month` / `route_b_exp_year` — תוקף הכרטיס, מאומת מבנית לצד הטוקן.
- route B הוא J4 מעצם הגדרתו: בהיעדר שדה `auto_capture` ברירת המחדל היא `true` כשיש טוקן שמור
  (‏`route.ts:124-134`; ‏J5 עם יצירת מסמך הפיק mismatch בכל ניסיון חי).

**אימות OTP/SMS בזרימה:** אימות הזהות בקוד חד-פעמי מתבצע בשלב **חתימת ההסכם** (לפני התשלום),
לא בטופס הכרטיס עצמו — ראו §8. טופס הכרטיס מגן על ה-PII בדרך אחרת: שדות הכרטיס וה-CitizenID
נטולי `name` ומגיעים ל-SUMIT דרך ה-AJAX של payments.js בלבד — הם לעולם לא נשלחים בפוסט לשרת
שלנו (`payment/hold-form.tsx:5-12,201-216`).

---

## 5. נתיבי API ופעולות שרת

| נתיב | מי רשאי | תפקיד |
|---|---|---|
| `POST /api/campaigns/[id]/authorize` | בעל האירוע | תפיסת J5 עד גובה ה-hold המחושב |
| `POST /api/campaigns/[id]/close-charge` | בעל האירוע | סגירה + חיוב סופי של הכרטיס השמור |
| `settleCampaignAction` (server action) | בעל האירוע | אותה סגירה/חיוב מתוך ה-UI (`campaign-actions.ts:221-264`) |
| `POST /api/orders/[id]/pay` | בעל ההזמנה | חיוב J4 להזמנה (legacy; אין כיום נתיב יצירת הזמנה) |
| `POST /api/admin/orders/[id]/reconcile` | אדמין | התאמת הזמנות תקועות (`payment_review`/`processing`) |
| `POST /api/admin/sumit-test` | אדמין | ‏PoC אבחוני (ראו §7) |
| `GET/POST /api/webhooks/whatsapp` | Meta (חתימה) | קליטת אירועים נכנסים — נקודת הכניסה לרישום "הושג" |
| `GET /app/events/[id]/campaign/[campaignId]/agreement` | בעל האירוע | הורדת ה-PDF החתום (route handler) |

הגנות משותפות בכל נתיבי הכסף:

- **CSRF fail-closed**: רק Origin/Referer של `APP_ORIGIN` (משתנה סביבה server-only; חסרונו =
  שגיאה קשה, אין fallback שקט). ללא שניהם — 403 (`authorize/route.ts:41-60`,
  `orders/[id]/pay/route.ts:22-41`).
- **אימות + בעלות בשרת**: `requireUser()` + ‏`requireOwnedEvent(campaign.event_id)`
  (‏event_id נגזר מה-DB, לא מהדפדפן); באדמין — `requireAdmin()`.
- **שערי קונפיג fail-closed** (`src/lib/data/payments.ts`): ‏`payments_enabled` (מתג-על),
  ‏`campaign_holds_enabled` (‏J5), ‏`close_charge_enabled` (חיוב סופי), ‏`outreach_enabled` —
  כולם `false` כברירת מחדל ב-DB; כל שגיאת קריאה נפתרת ל"כבוי".
- **אטומיות/אידמפוטנטיות**: ‏hold — ‏UPDATE מותנה `capture_status ∈ {null, hold_failed,
  hold_review} → pending`, רק זוכה אחד (`campaigns.ts:324-335`); חיוב סופי —
  ‏`lockCampaignForCharge`; ‏orders — נעילת `pending|failed → processing` עם רוטציית
  `payment_attempt_ref` (‏`pay/route.ts:98-117`).
- **סכומים משרת בלבד**: ‏hold מ-`prepareCampaignHold`; חיוב סופי מ-RPC + credits; orders מהשורה
  הנעולה (מניעת TOCTOU על מחיר, `pay/route.ts:99,121-131`).

### מפת מצבים על תוצאה עמומה (הכלל: לעולם לא לחייב פעמיים בשקט)

| שלב | דחייה ודאית | תוצאה עמומה |
|---|---|---|
| J5 hold | `capture_status='hold_failed'` (‏retry מותר) | `hold_review` (‏authorize route:195-232) |
| hold אושר אך השמירה ב-DB נכשלה | — | `hold_review` + לוג "manual reconciliation required" (עם authRef/authNumber בלבד — לא טוקן/תוקף/ת"ז) |
| חיוב סגירה | `charge_status='charge_failed'` | `charge_review` (‏close-charge.ts:141-149); גם כשל בקריאת הסיכום ← ‏review ולא ₪0 (‏"zero-bill bug", ‏billing.ts:57-63) |
| orders pay | `failed` (‏retry מותר) | `payment_review` (חוסם retry; ‏reconcile באדמין) |

בנוסף, שומרי מחזור-חיים: אין hold ואין חתימה לאירוע שעבר (לוח ישראל) או שאינו `active`
(‏`authorize/route.ts:120-129`; ‏`agreements.ts:104-122`), בגיבוי טריגרים ב-DB.

---

## 6. טופס הבדיקה האדמיני — `/admin/sumit-test` (PoC בלבד)

כלי אבחון אדמיני, **לא** זרימת לקוח: מאמת התנהגות REST חיה של SUMIT (J5/AuthorizeAmount/טוקן
שמור) לפני בניית קוד ייצור (`admin/sumit-test/page.tsx:6-7`). מוגן ב-`requireAdmin()` + בדיקת
Origin; קורא ל-`chargeRaw` ומציג **רק** את ההקרנה הבטוחה של safe-preview — הגוף הגולמי
(טוקן/ת"ז/AuthNumber) לעולם לא מגיע ל-DOM ולא נרשם ללוג (`api/admin/sumit-test/route.ts:11-16,193-203`).
העמוד מציג באנר תוצאה אמיתי (‏Status=0 + ‏ValidPayment) כי HTTP 200 מטעה. הקריאות פוגעות
ב-SUMIT החי — ההנחיה בעמוד היא ₪1.

---

## 7. הסכם חתום — `src/lib/agreements/` + זרימת האישור

**התוכן** (`template.ts`): מסמך עברי ורסיונרי. הנוסח מנוהל ב-DB —
טבלת `agreement_documents` (גרסה, סטטוס `draft/approved`, גוף מותאם אופציונלי; לכל היותר מסמך
פעיל אחד; מיגרציה `202606290022`) בניהול `/admin/agreement`. גוף מותאם עובר החלפת
`{{tokens}}` בטוחה (escape בצד המודול, built-ins גוברים על config;
`template.ts:120-170`), כולל 7 טוקני-קונפיג משפטיים (`agr_*` ב-`app_settings`, מיגרציה
`202606290023`). סטטוס `draft` מוסיף סימון טיוטה אוטומטי; הנוסח דורש אישור עו"ד לפני go-live
(`template.ts:12-16`).

**הזרימה** (`src/lib/data/agreements.ts`, ‏`recordSignedAgreement`):

1. זהות מהפרופיל המאומת בלבד (שם + טלפון) — לא מקלט הלקוח.
2. **אימות OTP ב-SMS** (‏purpose ‏`agreement_signing`): קוד בן 6 ספרות, נשמר רק כ-
   ‏`sha256(code:phone)`, תוקף 5 דקות, עד 5 ניסיונות, ו-rate-limit ‏5 קודים לשעה לטלפון+מטרה
   (`src/lib/data/otp.ts:14-17,49-56`). השליחה דרך ExtrA SMS.
3. רינדור המסמך המלא (תנאי הקמפיין + פרטי חברה + חתימה מ-signature_pad) ← PDF ב-puppeteer
   (עיצוב BiDi עברי נכון; ‏`pdf.ts:12-30`) ← ‏SHA-256 של הבייטים כהוכחת אי-שינוי (`pdf.ts:34-36`).
4. אחסון ה-PDF + תמונת החתימה ב-bucket פרטי `id-documents` (ללא policies — service-role בלבד,
   ‏`upsert:false` כדי לא לדרוס ראיה; `src/lib/storage/legal-docs.ts`).
5. רשומת ראיה ב-`signed_agreements`: גרסה, IP, ‏User-Agent, טלפון מאומת, ‏`otp_verified_at`,
   ‏hash, נתיבי אחסון (`agreements.ts:181-195`). ‏RLS אדמין-בלבד (מיגרציות 0007 + ‏`202606240016`).
6. ‏`approveCampaign` — הקמפיין עובר ל-`approved` עם גרסת המסמך שנקראה בשרת.
7. **מסירה במייל (‏§14ג(ב))**: נשלח קישור מאובטח לנתיב ההורדה — לא קובץ מצורף (סורקי צרופות;
   ‏`agreements.ts:201-220`). ההורדה עצמה מאומתת-בעלות ומוזרמת מה-bucket הפרטי
   (`campaign/[campaignId]/agreement/route.ts`).

---

## 8. אובייקטי מסד הנתונים

### טבלאות (כולן עם RLS: בעלים-קריאה דרך `owns_event` + אדמין; כתיבה רק service-role)

| טבלה | תפקיד | מיגרציה עיקרית |
|---|---|---|
| `campaigns` (עמודות חיוב) | מצב הקמפיין: מחיר/תקרה/חלון; ‏hold: ‏`auth_amount/auth_number/authorized_at/auth_expires_at/auth_external_ref/card_token_ref/card_exp_month/card_exp_year/card_citizen_id/capture_status`; חיוב: ‏`charge_status/charged_at/sumit_charge_document_id/charge_document_number/charge_document_url/charge_auth_number/charge_payment_id` | 0007, 0025, 0026, 0027 |
| `contacts` | טלפון E.164 ייחודי לאירוע + ‏`op_status` + ‏`removal_requested` + ‏`whatsapp_consent_at` | 0007, 0028 |
| `billed_results` | **מקור האמת לחיוב**; ‏`UNIQUE(event_id,contact_id)`; ‏`locked_price`, ראיה, ‏provider_ref | 0007 |
| `campaign_authorized_contacts` | ה-SET הקפוא — התקרה המחייבת על reached | 0024 |
| `contact_interactions` | יומן אירועי ספק + dedup ‏`UNIQUE(channel,provider_id)` | 0007 |
| `billing_credits` | זיכויים append-only | 0007 |
| `signed_agreements` | ראיות ההסכם (אדמין-בלבד, ללא קריאת-בעלים) | 0007, 0016 |
| `agreement_documents` | נוסח ההסכם המנוהל | 0022 |
| `otp_challenges` | אתגרי OTP (‏hash בלבד) | `202606240015_sms_otp.sql` |
| `orders` (עמודות תשלום) | ‏`sumit_document_id`, ‏`payment_attempt_ref` (UNIQUE), ‏`paid_at`, ‏`payment_processing_started_at` | `202606240003` |
| `app_settings` | שערי הפעלה + קונפיג SUMIT (‏`sumit_company_id`, ‏`sumit_api_public_key`, ‏`sumit_api_key` — שמות בלבד, הערכים סוד) + knobs + ‏`agr_*` | 0005, 0006, 0020, 0023, 0024, 0028 |

### RPCs של חיוב (שניהם SECURITY DEFINER, ‏service_role בלבד)

- **`try_record_billed_result(p_event, p_campaign, p_contact, p_channel, p_attempt,
  p_evidence, p_provider_ref) → text`** — נקודת הכניסה **היחידה** לכתיבת חיוב: נעילת הקמפיין
  ‏`FOR UPDATE`, בדיקת סטטוס (`active|paused`), חלון זמן, ‏removal, **חברות ב-SET הקפוא**,
  תקרת ספירה, ו-dedup ‏`ON CONFLICT DO NOTHING` — הכל בטרנזקציה אחת. השתלשלות:
  ‏0028 (בסיס) ← 0029 (‏`not_authorized` — כבילה ל-SET) ← ‏`20260630164747` ‏(L2: ‏
  ‏`event_passed` — שומר תאריך-אירוע בלוח ישראל, ו-`event_mismatch` — אימות ש-`p_event` תואם
  לאירוע של הקמפיין; שורות 262-326). ערכי התוצאה: ‏`billed | already_billed | ceiling_reached |
  not_active | before_window | closed_window | removal_requested | not_authorized |
  no_campaign | event_passed | event_mismatch`.
- **`campaign_billing_summary(p_campaign) → (reached_count, accrued, ceiling, max_contacts)`** —
  הסיכום ש-close-charge צורך (0028).

**נעילת P0 (מיגרציה `202606300038_lock_billing_rpcs.sql`)**: לשתי הפונקציות בוצע
‏`REVOKE EXECUTE FROM anon, authenticated, PUBLIC` ו-`GRANT` ל-`service_role` בלבד — ביקורת
מצאה שקריאת REST אנונימית הגיעה אליהן (חשיפת נתוני חיוב / כתיבת חיוב). ‏L2 משמר את הנעילה
מחדש אחרי ה-`CREATE OR REPLACE`. הוחל על ה-DB החי.

### `payment_events` — **מתוכנן, טרם מומש**

‏`plans/payment-events-implementation-plan.md` (626 שורות, "תכנון בלבד... ממתין לאישור מפורש"):
יומן ביקורת append-only של **כל ניסיון** תשלום (כולל כשלונות), בהיקף ראשוני ל-`/admin/sumit-test`
בלבד; ‏`correlation_id` ייחודי + ‏upsert אידמפוטנטי; מודול redaction ייעודי לאחסון
(`redact-for-storage.ts`) שמרחיב את safe-preview; ‏RLS אדמין-בלבד; לא נוגע ב-
‏`authorize/capture/charge` הייצוריים בשלב זה. אין מיגרציה ואין קוד — לא ליישם ללא אישור.

---

## 9. ציות ורגולציה

### חוק הגנת הצרכן §14ג (עסקת מכר מרחוק)

- **גילויים**: זהות משפטית, ח.פ., כתובת ופרטי קשר של KALFA הם קונפיג אדמין
  (‏`company_legal_*` ב-`app_settings`, מיגרציה 0016/0017) המוזרם להסכם — לא hardcode.
- **זכות ביטול**: סעיף 5 בהסכם — 14 יום / שני ימי עסקים לפני ההפעלה, הארכה ל-4 חודשים
  לאוכלוסיות זכאיות, דמי ביטול עד 5% או ₪100 (`template.ts:213-216`).
- **מסירת המסמך (§14ג(ב))**: המייל עם הקישור ל-PDF החתום (`agreements.ts:201-207`).
- **תצוגת מחיר כולל מע"מ**: ‏`VAT_RATE_PERCENT = 18` (‏`template.ts:20-23`); המחיר האדמיני
  נחשב מחיר צרכן כולל מע"מ, ‏SUMIT מחויב עם `VATIncluded:true` בהתאם; ההסכם מציג
  ‏"(כולל מע"מ 18%)" (‏`template.ts:196-198`).
- **עוגן ראייתי**: חתימה אלקטרונית + OTP + ‏IP + ‏User-Agent + חותמת-זמן + ‏hash (סעיף 9 בהסכם).
- הנוסח מסומן טיוטה עד אישור עו"ד (`template.ts:14-16`).

### PII וכללי אי-רישום

- **‏CitizenID — דיוק חשוב**: בטופסי הכרטיס (hold-form וה-PoC) שדה ת"ז **ללא `name`** — נשלח
  ל-SUMIT בטוקניזציה בלבד ולעולם לא בפוסט לשרת שלנו (`hold-form.tsx:201-216`). **אבל** ה-ת"ז
  שחוזרת בתגובת ה-authorize של SUMIT **כן נשמרת** ב-`campaigns.card_citizen_id`
  (‏`campaigns.ts:365`; מיגרציה 0027) — כי SUMIT דורש אותה מבנית בחיוב הטוקן השמור בסגירה.
  זהו PII מוצהר; שמירתו מעוגנת בהסכם החתום (הערות 0027 ו-`authorize.ts:25-27`).
  ההערה "CitizenID is PII (don't store)" בזיכרון הפרויקט מתייחסת לשלב שקדם לממצא הזה — הקוד
  העדכני שומר אותה במודע לצורך ה-capture.
- לעולם לא רושמים ללוג: קוד OTP, חתימה, טוקן כרטיס, תוקף, ת"ז, גוף webhook גולמי; לוגים של
  hold כוללים רק ‏authRef/authNumber (‏`authorize/route.ts:208-231`).
- מפתח ה-API של SUMIT נקרא רק בשרת רגע לפני הקריאה; ‏`sentBody` ב-PoC מוחזר עם
  ‏`APIKey:'***'` (‏`raw-charge.ts:113-114`).
- ‏RLS: ‏`signed_agreements` אדמין-בלבד; ‏`billed_results`/`billing_credits` — בעלים קריאה בלבד
  (שקיפות §16), כתיבה רק דרך ה-RPC הנעול.

---

## 10. תפוגת ה-J5 מול משך הקמפיין — השיקול הארכיטקטוני

הפער הידוע: תוקף אישור J5 בפועל הוא ימים בודדים עד שבועות (‏~4–7 ימים ברוב הסולקים; התוכניות
מציינות ‏~7–30 יום — `plans/billing-controls-complete-plan.md:52`), בעוד קמפיין יכול להימשך
שבועות/חודשים עד האירוע.

**איך הקוד מתמודד היום (ממומש):**

- החיוב הסופי **אינו תלוי בתוקף ה-hold**: ‏`capture.ts` אינו תופס את ה-auth המקורי (נדחה 004
  כשהוא ישן) אלא מבצע **charge טרי על הטוקן השמור** — כך שגם hold שפג אינו חוסם גמר-חשבון
  (`capture.ts:27-39`). ה-hold משמש ביטחון בזמן-אמת בלבד.
- העמודה `campaigns.auth_expires_at` קיימת בסכמה (0007) אך **אינה נכתבת בשום מקום בקוד** —
  ‏`recordCampaignHold` אינו ממלא אותה (`campaigns.ts:339-371`).

**הסיכון השיורי (מוכר ומתועד):** בין פקיעת ה-hold לסגירה, "המסגרת התפוסה" כבר אינה מובטחת —
החיוב בסגירה הוא עסקה חדשה שעלולה להידחות (ואז ‏`charge_failed`/`declined` והלקוח מתבקש לעדכן
אמצעי תשלום — ‏`campaign-actions.ts:257-259`).

**מתוכנן, טרם מומש:**

- בקרת תפוגת auth: מילוי/מעקב `auth_expires_at`, ‏re-authorize סמוך לסגירה, והתרעה/הגבלה על פער
  אישור-לסגירה (`plans/billing-controls-complete-plan.md:52`).
- בדיקת תוקף כרטיס (`card_exp_*`) לפני הסגירה — ניתוב ל-`hold_review`/re-hold במקום חיוב שנדון
  לכישלון, ושמירת ה-PDF של הקבלה ב-Storage (`plans/master-end-to-end-plan.md:79`).

---

## 11. מומש מול מתוכנן — טבלה מרכזת

| רכיב | מצב |
|---|---|
| סכמת החיוב (טבלאות + enums + RLS) | ✅ ממומש והוחל על ה-DB החי |
| חתימת הסכם + OTP + ‏PDF + מייל | ✅ ממומש |
| תפיסת J5 (route A) + ‏SET קפוא + גודל hold | ✅ ממומש (מאחורי `campaign_holds_enabled`) |
| רישום "הושג" מ-webhook ‏WhatsApp ← RPC | ✅ ממומש (מאחורי שערים; ‏persist-then-process פרוס) |
| חיוב סגירה על טוקן שמור + קבלה במייל | ✅ ממומש (מאחורי `close_charge_enabled`) |
| נעילת ה-RPCs ל-service_role (מיגרציה 0038) | ✅ הוחל |
| שומרי אירוע-עבר/סטטוס (L1/L2) | ✅ הוחל |
| ‏orders/pay + ‏reconcile אדמיני | ✅ קיים, מוגדר legacy/משני (אין נתיב יצירת הזמנה) |
| ‏PoC אדמיני (‏sumit-test, route A/B) + ‏safe-preview | ✅ ממומש (כלי אבחון בלבד) |
| טבלת `payment_events` | 🕐 מתוכנן, טרם מומש (`plans/payment-events-implementation-plan.md`) |
| בקרת תפוגת auth / re-authorize לפני סגירה | 🕐 מתוכנן, טרם מומש |
| בדיקת תוקף כרטיס לפני סגירה; קבלה ל-Storage | 🕐 מתוכנן, טרם מומש |
| חיוב על ערוץ השיחות (Voximplant) | 🕐 חלקי — ‏`outreach-engine.ts` קורא `recordReached`; שילוב הספק בהמשך |
| ‏`campaigns.billing_route` | קיים בסכמה, לא בשימוש בקוד |
| נוסח ההסכם | טיוטה — מחייב אישור עו"ד לפני go-live |

**אזהרת תפעול קבועה:** beta מחובר ל-Supabase ולחשבון SUMIT **החיים**. כל מיגרציה, הדלקת שער
(`payments_enabled` וכו') או קריאת PoC הן פעולת פרודקשן הדורשות אישור מפורש.
