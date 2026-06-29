# ספֵק עיצוב — Rework זרימת הקמפיין ("הפעלת אישורי הגעה")

**גרסה:** טיוטה 2026-06-29 · **מצב:** לעיון בעל-המוצר לפני תוכנית-מימוש
**מבוסס על:** 4 סריקות מקצה-לקצה + אימותי-קוד/DB ישירים (ראו §3).

---

## 1. מטרה והיקף

להחליף את יצירת-הקמפיין הנוכחית (כפתור "קמפיין חדש" → דף+טופס) ב**מסע מודרך אחד, מובנֶה באירוע**, תחת CTA אחד — **"הפעלת אישורי הגעה"** — שיוצר-או-ממשיך קמפיין יחיד לאירוע, ומוסיף תשתית **מעקב-תוצאות** (סיכום שרתי → גרף).

**בהיקף:** כניסה, מבנה, רצף-תהליך, אכיפת אחד-לאירוע, פונקציית-סיכום-תוצאות + גרף.
**מחוץ להיקף (נשמר ללא נגיעה):** מודל החיוב (per-reached, J5 hold, תקרה, authorized set, charge), מחזור-החיים ומעבריו, התמחור/תוכן-ה-template, מסלולי `/campaign/[campaignId]` ו-`/api/campaigns/[id]`, ערכי-enum.

## 2. אילוצים מחייבים
- **אין שינוי במודל-החיוב ובתנאי-התוכנית** ([[campaign-rework-constraint]]).
- מיגרציות חיות **מותנות-אישור** מפורש; לא רצות אוטומטית.
- build = `next build --webpack`; אימות = lint + tsc + vitest + build.
- בלי hardcode של עובדות-עסק; ה-template/מחיר נקראים מה-DB.

## 3. מצב קיים — מאומת (קוד + DB חי)

**יצירה (יחידה):** `createCampaign(eventId, terms)` ב-`campaigns.ts:124` ← נקרא רק מ-`createCampaignAction` ← מאוגד רק ב-`new-campaign-form.tsx` ← מקושר רק מכפתור `events/[id]/page.tsx:90`. גוזר `max_contacts` מ-`countUniqueContactsForEvent` (דורש ≥1), קורא מחיר/ערוצים/לו"ז מה-template, insert `pending_approval`.
**רשימה (ממוקדת):** `listCampaignsForEvent` נקרא רק ב-`events/[id]/page.tsx:51`; הרשימה מרונדרת ב-97–126; הכפתור ב-89–94.
**Validation:** `campaignTermsSchema` = `{template_id, start_at?, close_at?}`.
**template קנוני:** בדיוק **1** package פעיל עם `price_per_reached` — `dac3f62c-4b20-42d2-9a56-c04eb62028df` · "אישורי הגעה — וואטסאפ + שיחות AI" · ₪4 · `sort_order=10`. עמודות רלוונטיות: `channels`, `outreach_schedule`, `min_hold_floor`, `hold_buffer_pct`.
**מקור-אמת לתוצאות:** `billed_results` (שורה = רשומה מוצלחת/מחויבת; `contact_id`, `locked_price`, `reached_at`). RPC קיים `campaign_billing_summary(p_campaign)` → `reached_count, accrued, ceiling, max_contacts`.
**מיפוי סטטוסים:** `guests.contact_id → contacts.id`. אוטומטי: `contacts.op_status` (`pending_contact|whatsapp_sent|…|wrong_number|reached_billed|not_reached`). ידני: `guests.contact_status` (`not_contacted|contacted|responded|wrong_number|unclear|unavailable|callback`).
**נתוני-קמפיינים (לניקוי):** אירוע `…e1` = 3 `pending_approval` + 3 `approved`; אירוע `ec7c68d1…` (פרודקשן) = 1 `approved`. אין `UNIQUE(event_id)`. `signed_agreements` = `ON DELETE CASCADE`.

## 4. המודל העסקי (רקע — לא משתנה)
משלמים **~24 שעות אחרי תום האירוע**, ורק על **רשומות מוצלחות** = אורח שקיבלנו ממנו **תשובה** (`billed_results`). מי שלא נענה / מספר-שגוי — לא מחויב. ה-J5 hold = תפיסת-מסגרת עד התקרה; החיוב בפועל = סך-התגובות עד התקרה. ([[outcome-billing-model]])

## 5. הזרימה החדשה מקצה-לקצה

```
עמוד האירוע → מקטע "אישורי הגעה" (CampaignSection)
  • אם אין קמפיין:  [ הפעלת אישורי הגעה ]
        └─ setupCampaignAction(eventId) → createCampaign(eventId) [idempotent,
           template קנוני, תאריכים נגזרים] → redirect /campaign/[id]/approve
  • אם קיים:  כרטיס-מצב + CTA הקשרי (המשך אישור / תשלום / הפעלה / ניהול)

[שלבים 3–10 — קיימים, ללא שינוי]
תנאים+מחיר+הסכם → חתימה(OTP) → תשלום/J5 hold → הפעלה(active) →
נמענים=כל האורחים שאפשר להשיג (אוטומטי) → שליחה → מעקב → חיוב 24ש' לפי המודל
```

## 6. שלב 1 — ליבת זרימת-הקמפיין

**מחיקה:** `campaign/new/page.tsx`, `campaign/new/new-campaign-form.tsx`.

**`campaigns.ts`:**
- `getCampaignForEvent(eventId): Promise<OwnerCampaign | null>` — סינגלטון owner-scoped (RLS): את הקמפיין הלא-מבוטל של האירוע, או null.
- `resolveCanonicalTemplate()` — reuse של `listCampaignTemplates()`, מחזיר `[0]`. 0 פעילים → שגיאה בטוחה "המערכת אינה מוגדרת — פנו לתמיכה". (כיום בדיוק 1.)
- `createCampaign(eventId)` — חתימה משתנה (ללא `terms`): **אידמפוטני** (אם יש קמפיין לא-מבוטל לאירוע → מחזיר אותו), פותר template קנוני, גוזר תאריכים (§6.1), שאר הלוגיקה (max_contacts, מחיר, ערוצים, לו"ז, ceiling) ללא שינוי. תופס הפרת-UNIQUE → מחזיר קיים.

**§6.1 גזירת תאריכים** (במקום קלט-טופס): `close_at = event_date` (חלון ה-outreach מסתיים באירוע; החיוב 24ש' אחרי הוא פעולת-settle נפרדת). `start_at = max(now, event_date − max(days_before בלו"ז))`. *לאישור בעיון.*

**`campaign-actions.ts`:** `createCampaignAction(template_id, dates)` → `setupCampaignAction(eventId)` — ללא קלט-טופס; try/catch כמו הקיים; redirect ל-`/approve`. אם `max_contacts<1` → מחזיר `FormState` עם "הוסיפו אורחים עם טלפון לפני הפעלת אישורי ההגעה".

**`validation/campaigns.ts`:** `campaignTermsSchema` מוסר (לא בשימוש ל-create). approve/hold/send נשארים.

**`events/[id]/page.tsx`:** מסיר כפתור (89–94) + רשימה (97–126); `listCampaignsForEvent`→`getCampaignForEvent`; מרנדר `<CampaignSection campaign={...} eventId close_at />`.

**חדש `campaign-section.tsx`** (server component): כרטיס-מצב יחיד + CTA הקשרי לפי `status`/`capture_status`; מצב-ריק = טופס `setupCampaignAction` עם סיכום-תנאים קצר (מחיר לרשומה, תקרה משוערת מ-`countUniqueContactsForEvent × price`, חלון). תוויות-סטטוס ממורכזות (כיום משוכפלות ב-`page.tsx` וב-`manage-client.tsx`).

## 7. שלב 2 — מעקב תוצאות (נתונים לפני ויזואליזציה)

### 2א — פונקציית-סיכום שרתית (נבנית קודם)
`getCampaignResultsSummary(eventId): Promise<CampaignResultsSummary>` ב-`src/lib/data/campaign-results.ts` (חדש) — `requireOwnedEvent`, קריאה-בלבד. **הנקודה היחידה שמחשבת מספרים.** מקור-אמת מוגדר לכל שדה:

| שדה | משמעות | מקור-אמת יחיד |
|---|---|---|
| `successful` | רשומות מוצלחות = מחויב | `billed_results` (count) / RPC `campaign_billing_summary.reached_count` |
| `accrued` / `ceiling` | נצבר / תקרה | RPC `campaign_billing_summary` |
| `total_guests` | מוזמנים באירוע | `guests` (count) |
| `contactable` | יש טלפון, לא הוסר | `contacts` (לא `removal_requested`, יש `normalized_phone`) |
| `wrong_number` | מספר שגוי | `contacts.op_status='wrong_number'` (+ fallback מוגדר `guests.contact_status='wrong_number'`) |
| `no_answer` / `pending` / `sent` | לא-נענה / ממתין / נשלח | `contacts.op_status` (קיבוץ מוגדר) |

מחזירה אובייקט typed עקבי. ה"מוצלח" **תמיד** מ-`billed_results` — אותו מקור כמו החיוב, כך שהדשבורד והחיוב לעולם לא סותרים. בדיקות vitest מאמתות נגזרת עקבית.

### 2ב — רכיב הגרף (אחרי 2א)
רכיב client שמקבל את `CampaignResultsSummary` המוכן ו**רק מרנדר** (recharts/`ui/chart.tsx` שהותקן). אפס חישוב ברכיב. פילוח: "מוצלח (מחויב)" בולט + טבעת/עמודות לקטגוריות + ספירת מספרים-שגויים.

## 8. שלב 3 — זיהוי-אוטומטי של מספר-שגוי (follow-up; מבוסס תיעוד רשמי)

היום `wrong_number` נקבע **ידנית** בלבד. זיהוי אוטומטי שונה מהותית בין הערוצים (אומת מול תיעוד רשמי דרך Context7):

**Voximplant (שיחת-AI) — חיווי חד-משמעי.** `CallEvents.Failed` מחזיר `code`+`reason`. **`code=404` = "Invalid number"** → `op_status='wrong_number'` בביטחון. ניתן להבחין מ"תקין-שלא-נענה": 486 (תפוס) / 480 (לא זמין) / 408 (לא נענה) / 603 (נדחה) / 402 (תקלת-חשבון שלנו). מגיע דרך HTTP-callback מתרחיש VoxEngine או Call History ב-Management API (fetch, לא SDK — [[voximplant-sdk-vulnerable]]).

**WhatsApp — חיווי חלש/עמום.** מבנה שגיאה: `code`+`error_subcode`+`error_user_title/msg`. בזמן-שליחה: "Invalid Recipient" (`error_subcode=2604002`) תופס מספרים פגומי-פורמט. אך מספר תקין-בפורמט שאינו רשום ב-WhatsApp מחזיר `status:'failed'`/undeliverable **עמום** — אין קוד-ייעודי אמין ל"מספר שגוי" (לא אומת קוד מעבר ל-2604002). בנוסף, ה-webhook הקיים `api/webhooks/whatsapp` **אינו מעבד את מערך ה-`statuses`** (רק נכנס) → דורש חיווט.

**מסקנת-תכן:** המקור האמין ל-`wrong_number` אוטומטי הוא **ערוץ השיחה (Voximplant 404)**. WhatsApp יתרום "Invalid Recipient" (פורמט) + "לא-נמסר" (עמום, לסיווג "לא-הושג", לא "שגוי"). הזרימה WhatsApp→הסלמה-לשיחה הופכת את ה-404 בשלב-השיחה לנקודת-ההכרעה הטבעית. **מחוץ להיקף עכשיו** (outreach מגודר off); הסיכום (§7) יציג כיום בעיקר מספר-שגוי ידני.

## 9. מיגרציה וניקוי (מותנה-אישור מפורש)
1. **ניקוי אירוע-בדיקה `…e1`:** לשמר קמפיין `approved` אחד; לסמן את 5 העודפים `status='cancelled'` (לא מחיקה → `signed_agreements` נשמרים, אפס CASCADE). פרודקשן ללא נגיעה (כבר 1:1).
2. **אילוץ:** `CREATE UNIQUE INDEX ... ON campaigns(event_id) WHERE status <> 'cancelled'` (partial — מאפשר קמפיין-עתידי אם קודם בוטל).
- SQL מלא יוצג בתוכנית; **לא ירוץ ללא אישור.**

## 10. בדיקות
- `campaigns.test.ts`: `getCampaignForEvent` (סינגלטון/null), `createCampaign` אידמפוטני, `resolveCanonicalTemplate` (1/0/ריבוי).
- `campaign-results.test.ts` (חדש): כל שדה נגזר ממקור-האמת הנכון; "מוצלח" = `billed_results`; עקביות.
- `validation/campaigns.test.ts`: עדכון להסרת `campaignTermsSchema`.
- 13 קבצי בדיקות החיוב/outreach — **נשארים ירוקים ללא שינוי**.
- אימות-מיגרציה: כל אירוע ≤1 קמפיין לא-מבוטל; UNIQUE מחזיק.

## 11. קצוות וסיכונים
- **0 אורחים בהפעלה:** חסום עם הודעה ידידותית; אין שורה ריקה.
- **Race (שתי לשוניות):** UNIQUE partial + create אידמפוטני → נחיתה על אותו קמפיין.
- **`getCampaignForEvent` מול קמפיינים מבוטלים:** מתעלם מ-`cancelled`.
- **תוויות-סטטוס משוכפלות:** למרכז למקור אחד (שיפור-נלווה).
- **עקביות דשבורד↔חיוב:** "מוצלח" תמיד מ-`billed_results` (§7).

## 12. רצף-בנייה
שלב 1 (ליבת-זרימה) → מיגרציית-ניקוי+UNIQUE (מותנה-אישור) → שלב 2א (סיכום שרתי + בדיקות) → שלב 2ב (גרף מוזן) → [follow-up] שלב 3 (זיהוי-אוטומטי).

## 13. Non-goals (חזרה לדגש)
אין שינוי ב: מודל-חיוב, מחזור-חיים/מעברים, authorized set, תמחור/תוכן-template, מסלולי `/campaign/[campaignId]` ו-`/api/campaigns/[id]`, ערכי-enum.
