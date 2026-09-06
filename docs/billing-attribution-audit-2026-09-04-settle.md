# ביקורת ייחוס חיוב — מ-`billed_results` ועד החיוב הסופי (settle)

תאריך: 2026-09-04 · סוג: read-only audit (ללא חיובים, ללא שינויי DB) · ענף: `feat/b2c-entry-routing-event-summary`
מקורות: קוד הריפו (קריאה מלאה של הקבצים המצוטטים) + הגדרות פונקציות DB שנשלפו **חי** (`pg_get_functiondef`) + אגרגטים חיים ללא PII.
תיוג: **VERIFIED-LIVE** = נבדק מול ה-DB החי היום; **CODE** = נקרא מהקוד בענף הנוכחי.

---

## 0. תקציר

**הנוסחה שהקוד מחשב בפועל** (`src/lib/data/close-charge-amount.ts:39-48`, נקראת מ-`src/lib/data/close-charge.ts:227-234`):

```
reached      = count(*) FROM billed_results WHERE campaign_id = X        -- campaign_billing_summary (live SQL)
gross        = base + max(0, reached − included) × overage
               base     = campaigns.base_price      (0 אם NULL, או 0 אם D5 guard מדכא)
               included = campaigns.included_reached (0 אם NULL, או 0 אם D5 guard מדכא)
               overage  = campaigns.price_per_reached
capped       = min(gross, ceiling)      ceiling = campaigns.max_charge_ceiling (fallback: summary.ceiling)
amount       = max(0, round₂(capped − credits))
               credits  = Σ billing_credits(campaign X, voided_at IS NULL)
                        + Σ billing_credits(event, campaign_id IS NULL, voided_at IS NULL)
                        − Σ campaigns.credit_applied של קמפיינים אחרים באותו אירוע
creditApplied = max(0, round₂(capped − amount))
amount ≤ 0  ⇒ charge_status='nothing_to_charge', אין קריאה ל-SUMIT
amount > 0  ⇒ J4 charge על הטוקן השמור בסך amount, קבלה, charge_status='charged'
```

שימו לב לשלוש עובדות שאינן מובנות מאליהן:

1. **החיוב נגזר מ-`count(*)` של שורות, לא מ-`Σ locked_price`.** ה-RPC מחזיר גם `accrued = Σ locked_price` אבל `closeCampaignAndCharge` משתמש רק ב-`reached_count` ומכפיל ב-`campaigns.price_per_reached` הנוכחי (`close-charge.ts:230-231`). ה-`locked_price` בשורה הוא ראיה בלבד.
2. **`control_status` ו-`manual_adjustment` אינם נקראים בשום מקום.** לא ב-SQL של `campaign_billing_summary`, לא ב-TypeScript, ואין UI. כל שורה ב-`billed_results` נספרת (§7 להלן).
3. **אין שום מנגנון מתוזמן שמבצע חיוב.** החיוב הסופי הוא פעולה ידנית של platform-admin (§6).

---

## 1. שרשרת הייחוס — hop אחר hop

### 1.1 מה כותב שורה ל-`billed_results`

יש **כותב יחיד**: ה-RPC `public.try_record_billed_result` (SECURITY DEFINER, service_role בלבד). אין שום `insert` ישיר מהאפליקציה (`src/lib/data/billing.ts:8-10`).

ה-RPC (VERIFIED-LIVE, גוף הפונקציה נשלף היום) מבצע בסדר הזה:

| צעד | תנאי | תוצאה אם נכשל |
|---|---|---|
| נעילת הקמפיין `FOR UPDATE`; קריאת `event_id, status, price_per_reached, max_contacts, start_at, close_at, auth_amount, base_price, included_reached` | — | `no_campaign` |
| `p_event` חייב להיות שווה ל-`campaigns.event_id` (האירוע נגזר מהקמפיין, לא מהקורא) | | `event_mismatch` |
| `status IN ('active','paused')` | | `not_active` |
| `now() ≥ start_at` / `now() ≤ close_at` | | `before_window` / `closed_window` |
| יום האירוע (Asia/Jerusalem) טרם עבר | | `event_passed` |
| `events.status = 'active'` | | `event_not_active` |
| `contacts.removal_requested = false` | | `removal_requested` |
| **בסיס הרשאה** — `app_settings.billing_exposure_gate` (**VERIFIED-LIVE: false**) ⇒ נדרשת חברות ב-`campaign_authorized_contacts` | | `not_authorized` |
| **תקרת כמות** — gate OFF ⇒ `cap = greatest(max_contacts, included_reached)`; gate ON ⇒ `funded_cap` | `count(billed_results) ≥ cap` | `ceiling_reached` |
| `INSERT … locked_price = price_per_reached … ON CONFLICT (event_id, contact_id) DO NOTHING` | קיים כבר | `already_billed` |
| | | `billed` |

`UNIQUE (event_id, contact_id)` (VERIFIED-LIVE: `billed_results_event_contact_unique`) הוא מה שהופך reach לחד-פעמי לכל איש קשר באירוע, בכל הערוצים.

### 1.2 מי קורא ל-RPC ואיך נקבע ה-`campaign_id`

עטיפת ה-TypeScript: `recordReached` (`src/lib/data/billing.ts:32-49`) → `admin.rpc('try_record_billed_result', …)`; על `billed` מעדכנת `contacts.op_status='reached_billed'`.

**ערוץ WhatsApp** — `processMessage` (`src/lib/data/webhook-processing.ts:183-296`):

1. סיווג ההודעה: רק `text | button | interactive | reaction` נחשבות "reach" (`src/lib/whatsapp/inbound.ts:11-16`, `:100-102`).
2. **ייחוס** (`webhook-processing.ts:195-199`):
   - קודם `resolveByContextId(context.id)` — שולף את ה-outbound ש-`provider_id` שלו שווה ל-`context.id` של התשובה (`src/lib/data/interactions.ts:112-133`). זה הנתיב המדויק: התשובה קשורה להודעה שאנחנו שלחנו, ולכן ל-`(event, campaign, contact)` הנכונים.
   - אם אין `context` (תשובה מוקלדת, לא לחיצה) — `resolveInboundContact(from)`: כל ה-`contacts` עם אותו `normalized_phone` (בכל האירועים), ואז **ה-outbound האחרון ביותר** (`ORDER BY created_at DESC LIMIT 1`) של כל אחד מהם (`interactions.ts:72-104`). **כאן נקודת התורפה של הייחוס**: מספר טלפון שמופיע בשני אירועים ייוחס לקמפיין ששלח לו אחרון, לא בהכרח לזה שהאורח התכוון לענות לו.
3. `insertInteraction` עם `UNIQUE(channel, provider_id)` — רק אם השורה **חדשה** (`fresh`) נקרא `recordReached` (`webhook-processing.ts:203-226`). המשמעות: ניסיון חיוב אחד בלבד לכל `message_id` של Meta, לעולם.
4. הפסיקה של ה-RPC נשמרת על שורת ה-interaction (`billing_outcome`, `webhook-processing.ts:229-235`, `interactions.ts:53-66`) — זה מה שה-inspector ב-`/admin/webhooks` מציג (`src/lib/data/admin/webhook-inbox.ts:122,148`).

**ערוץ שיחה** — `processCallResult` (`src/lib/data/call-result-processing.ts:110-122`) קורא ל-`writeReach` עם `attempt.campaign_id` (הקמפיין נלקח משורת `call_attempts` שנוצרה בעת החיוג, לא ממשהו שהספק שלח). `writeReach` (`src/lib/data/outreach-engine.ts:476-482`) = `recordReached` + עצירת outreach לאיש הקשר. ערוץ השיחה **אינו חשוף** לבעיית הייחוס לפי טלפון.

**עצירה על reach** — `isContactReached` (`outreach-engine.ts:166-177`) בודק `billed_results` לפי `(event_id, contact_id)`; החייגן מדלג על איש קשר שכבר הושג (`src/lib/data/outreach-calls.ts:173-175`). כלומר שורה שגויה ב-`billed_results` גם **עוצרת outreach** לאיש קשר שמעולם לא ענה לקמפיין הזה.

### 1.3 הסיכום — `campaign_billing_summary`

VERIFIED-LIVE (גוף הפונקציה):

```sql
select count(b.*)::int, coalesce(sum(b.locked_price),0), c.max_charge_ceiling, c.max_contacts
from campaigns c left join billed_results b on b.campaign_id=c.id
where c.id=p_campaign group by c.id;
```

- אין סינון על `control_status`. המיגרציה שיצרה אותה מציינת זאת במפורש כ"intentional for Phase 1; voids/adjustments revisited in §16" (`supabase/migrations/202606290028_billing_backhalf.sql:69-70`). ה-§16 הזה לא מומש.
- `accrued` = `Σ locked_price` — **עיוור ל-base/included** (מתועד גם ב-`src/lib/data/event-cancellation.ts:198-200`). לכן כל הצרכנים שמציגים סכום (עמוד הלקוח `manage-client.tsx:751-764`, עמוד ביטולים `admin/cancellations/[id]/page.tsx:51`) מחשבים מחדש דרך `computeChargeAmount` ולא מציגים `accrued` גולמי.

עטיפת TS: `getCampaignBillingSummary` (`src/lib/data/billing.ts:66-85`) — **זורקת** על שגיאת RPC אמיתית (כדי ש-close-charge יעבור ל-`charge_review` ולא יסגור ב-₪0), מחזירה `null` רק כשאין שורה.

### 1.4 החיוב — `closeCampaignAndCharge`

`src/lib/data/close-charge.ts:112-362`. הסדר המדויק:

| שורות | צעד |
|---|---|
| 116 | `requireAdmin()` — platform-admin בלבד. נקרא מ-`settleCampaignAction` (`src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts:426-491`) ומ-`POST /api/campaigns/[id]/close-charge` (`src/app/api/campaigns/[id]/close-charge/route.ts:21-60`, גם הוא בודק `isAdmin`). |
| 117-124 | שערים: `payments_enabled` ∧ `close_charge_enabled` ∧ קונפיג SUMIT (`src/lib/data/payments.ts:16-29, 54-67, 112-129`). **VERIFIED-LIVE: כולם ON.** |
| 126-137 | טעינת שדות החיוב (`getCampaignForCharge`, `src/lib/data/campaigns.ts:764-775`); `charged`/`nothing_to_charge` הם סופיים ⇒ `bad_state`. |
| 141-145 | סגירת הקמפיין (`closeCampaign`, `campaigns.ts:1145-1154`) אם עדיין ב-`active/paused/approved/scheduled`; קמפיין כבר `closed` ממשיך (retry). **מרגע זה ה-RPC מחזיר `not_active` לכל reach חדש.** |
| 149-157 | חובה: `capture_status='authorized'` + טוקן + תוקף + ת"ז. |
| 161-169 | `getCampaignBillingSummary` + `getCampaignCreditTotal` (`billing.ts:94-128`). שגיאה ⇒ `charge_review`. |
| 176-178 | `ceiling = campaigns.max_charge_ceiling` (fallback ל-summary). |
| 193-223 | **D5 guard**: אם `base_price>0 ∨ included_reached>0`, בודקים שגרסת ההסכם החתום (`getSignedAgreementVersion`, `src/lib/data/agreements.ts:64-81`) היא גרסת base-fee (`isBaseFeeAgreementVersion`, `src/lib/agreements/template.ts:44-48`; היום `2026-07-v4`). אחרת `base=included=0` ⇒ per-reached טהור + Slack. |
| 227-234 | `computeChargeAmount` — הנוסחה ב-§0. |
| 243-247 | `overrideAmount` (רק מזרימת ביטול אירוע) מחליף את הסכום, עדיין `≤ ceiling`. |
| 251-260 | `amount ≤ 0` ⇒ `markCampaignChargeOutcome('nothing_to_charge', creditApplied)` (`campaigns.ts:825-851`; כותב `final_charge_amount=0`, `credit_applied`, `charged_at`), סגירת האירוע, **אין קריאה ל-SUMIT**. |
| 263-264 | `lockCampaignForCharge` — `UPDATE … SET charge_status='pending' WHERE charge_status IS NULL OR IN (charge_failed, charge_review)` (`campaigns.ts:780-793`). מנעול אטומי; רק הזוכה מחייב. |
| 291-303 | `captureHeldCardSumit` (`src/lib/sumit/capture.ts:52-160`): **J4 טרי על הטוקן השמור** (`PaymentMethod.CreditCard_Token` + תוקף + ת"ז + `Type:1`), `AutoCapture:true`, בלי `VATRate`, בלי `CreditCardAuthNumber`, `Customer.ID = campaigns.sumit_customer_id`. הצלחה = `Status 0` **וגם** `Data.Payment.ValidPayment === true` **וגם** `DocumentID` (`capture.ts:132-152`). |
| 304-312 | `recordCampaignCharge` (`campaigns.ts:795-823`): `charge_status='charged'`, `final_charge_amount`, `credit_applied`, `sumit_charge_document_id/number/url`, `charge_auth_number`, `charge_payment_id`, `charged_at`. |
| 314-331 | Slack (ללא PII), בדיקת תקרת עוסק פטור (`src/lib/data/tax-ceiling.ts:24-57`), סגירת האירוע. |
| 344-360 | `SumitDeclinedError` ⇒ `charge_failed` (ניתן לנסות שוב); כל דבר אחר ⇒ `charge_review` (אולי חויב — אין retry אוטומטי). |

**קבלה/מסמך**: נוצרים ע"י SUMIT באותה קריאה (`PreventDocumentCreation:false`, `SendDocumentByEmail` כשיש אימייל לבעל האירוע, `capture.ts:82-83`); הקישור נשמר ב-`charge_document_url`.

### 1.5 קרדיטים — `billing_credits`

- **מתן**: admin ב-`/admin/users/[id]` (`src/lib/data/admin/users.ts:494-506`), עם אימות שהאירוע שייך למשתמש ושהקמפיין שייך לאירוע.
- **ביטול (soft-void)**: `voidBillingCredit` (`users.ts:518-597`) — מסמן `voided_at/voided_by/void_reason`, לעולם לא מוחק; חסום אם הביטול יוריד את מאגר האירוע מתחת ל-`Σ credit_applied` שכבר נצרך בחיוב סגור.
- **צריכה**: רק ב-`closeCampaignAndCharge` (§1.4), נרשם ב-`campaigns.credit_applied`.
- אין קרדיט שנקשר לשורת `billed_results` בודדת.

---

## 2. עמודות `campaigns` שמשתתפות בחיוב (VERIFIED-LIVE — קיימות בסכימה החיה)

| עמודה | מי כותב | תפקיד בחיוב |
|---|---|---|
| `price_per_reached` | `createCampaign` — עותק נעול מה-package הקנוני (`campaigns.ts:248,264`) | `overage`; וגם `locked_price` בכל שורת reach (RPC) |
| `base_price`, `included_reached` | `createCampaign` — 0 אלא אם `base_overage_pricing_enabled` (`campaigns.ts:253-266`). **VERIFIED-LIVE: ON** | `base`, `included` |
| `max_contacts` | `createCampaign` = ספירת אנשי קשר ייחודיים; **מחושב מחדש ב-`prepareCampaignHold`** = full בזמן ה-hold (`campaigns.ts:714-719`) | בסיס ל-ceiling; וגם ה-cap של ה-RPC כש-gate OFF (`greatest(max_contacts, included)`) |
| `max_charge_ceiling` | אותם שני מקומות: `computeCeilingBaseOverage(base, included, overage, max_contacts)` = `base + max(0, max_contacts − included) × overage` (`campaigns.ts:99-107`) | `ceiling` — התקרה שבחוזה החתום |
| `auth_amount` | `recordCampaignHold` (`campaigns.ts:508`) = `computeHoldAmountBaseOverage(base, included, overage, covered, floor, buffer)` (`campaigns.ts:114-125`), `covered = min(full, reasonable_coverage)` | **לא משתתף בחיוב.** נכנס רק ל-`funded_cap` ב-`reconcile_authorized_set` (וב-RPC כש-gate ON). ראו פער §10.3 |
| `start_at` | `null` תמיד (`campaigns.ts:270`) | חלון RPC (`before_window`) — לא פעיל בפועל |
| `close_at` | `= events.event_date` (`campaigns.ts:271`) | חלון RPC (`closed_window`) |
| `status` | מעברי מצב (`campaigns.ts:881-959`) | RPC מחייב `active/paused`; close-charge סוגר ל-`closed` |
| `charge_status`, `final_charge_amount`, `credit_applied`, `charged_at`, `sumit_charge_document_id`, `charge_document_number/url`, `charge_auth_number`, `charge_payment_id` | `recordCampaignCharge` / `markCampaignChargeOutcome` | תוצאת החיוב — **זה כל ה-audit שיש** (אין טבלת `payment_events`) |

**`funded_cap`** אינו עמודה; הוא נוסחה שמחושבת בשני RPC-ים (VERIFIED-LIVE, זהה בשניהם מאז `20260902062917`):

```
funded_cap = least( greatest(max_contacts, included_reached),
                    included_reached + floor( max(0, auth_amount − base_price) / price_per_reached ) )
             (0 אם auth_amount/price_per_reached NULL או ≤ 0 — fail-closed)
```

- ב-`reconcile_authorized_set` הוא תקרת גודל הסט הדינמי (מי בכלל יכול להיות מורשה).
- ב-`try_record_billed_result` הוא תקרת הספירה **רק כש-`billing_exposure_gate = true`**. היום (gate OFF) ה-cap הוא `greatest(max_contacts, included_reached)` וההגנה האמיתית היא החברות בסט.

---

## 3. ש1 — הנוסחה

ראו §0. ציטוט המקור המדויק (`close-charge-amount.ts:39-48`):

```ts
const gross = input.base + Math.max(0, input.reached - input.included) * input.overage;
const capped = Math.min(gross, input.ceiling);
const amount = Math.max(0, agorot(capped - input.credits));
const creditApplied = Math.max(0, agorot(capped - amount));
```

עם הקלטים מ-`close-charge.ts:227-234`: `base=effectiveBase`, `included=effectiveIncluded` (אחרי D5), `overage=campaign.price_per_reached ?? 0`, `reached=summary.reachedCount ?? 0`, `ceiling` (§1.4 שורות 176-178), `credits` מ-`getCampaignCreditTotal`.

מה **לא** בנוסחה: `locked_price`, `control_status`, `manual_adjustment`, `auth_amount`, `evidence_source`, `channel`.

---

## 4. ש2 — שורה אחת עודפת שיוחסה בטעות לקמפיין X

**מנגנון**: תשובה מוקלדת (ללא `context.id`) מטלפון שקיים כ-contact גם באירוע X וגם באירוע Y מיוחסת ל-outbound האחרון ביותר של אותו טלפון בכל האירועים (`interactions.ts:87-94`). אם X שלח אחרון — התשובה נרשמת ל-X. ה-RPC יאשר אותה אם contact-X חבר בסט המורשה של X ו-X עדיין `active/paused`.

**VERIFIED-LIVE**: 2 מספרי טלפון מתוך 43 אנשי קשר מופיעים ביותר מאירוע אחד; 29 מתוך 59 הודעות WhatsApp נכנסות הגיעו **בלי** `context` (נתיב ה-fallback לפי טלפון) — כלומר הנתיב הפגיע הוא כמחצית מהתעבורה, לא מקרה קצה.

**השפעה על הסכום של X** (לפי הנוסחה):

| מצב של X בעת הסגירה | תוספת לחיוב מהשורה העודפת |
|---|---|
| קמפיין legacy (`included=0`, `base=0`) ו-`gross < ceiling` | **+`price_per_reached`** (₪4 בכל הקמפיינים החיים) |
| קמפיין base-model ו-`reached ≤ included` (כולל השורה העודפת) | **₪0** — דמי ההפעלה מכסים |
| קמפיין base-model ו-`reached > included` ו-`gross < ceiling` | **+`price_per_reached`** (₪4) |
| כל מודל, `gross ≥ ceiling` | **₪0** — התקרה חוסמת |
| כל מודל, יש קרדיט שמכסה | הכרטיס לא מחויב יותר, אבל **נצרך ₪4 יותר מהקרדיט** (`creditApplied` גדל) — עדיין כסף |

**מול הקמפיינים החיים (VERIFIED-LIVE, ללא שמות):**

- 2 קמפיינים סגורים, legacy (`base=0, included=0, ppr=4`): 21 ו-1 reached, `gross` 84 ו-4, תקרות 152 ו-4, שניהם נסגרו `nothing_to_charge` כי קרדיט כיסה במלואו (84 ו-4). שורה עודפת אחת בראשון הייתה מעלה את ה-gross ל-88 (מתחת לתקרה) — ₪4 נוספים מהקרדיט או מהכרטיס. בשני התקרה (4) הייתה חוסמת.
- 3 קמפיינים base-model (`base=200, included=200, ppr=4, max_contacts=0 ⇒ ceiling=200`), כולם חתומים על `2026-07-v4` (D5 עובר), 0 reach עד כה. **בתצורה הזו אף שורה — נכונה או שגויה — לא משנה את הסכום**: הוא ₪200 קבוע, כי `reached ≤ 200 ⇒ gross = 200` וגם מעל 200 התקרה היא 200. הסיכון הכספי בבסיס+כלול מתחיל רק כש-`max_contacts` (בזמן ה-hold) גדול מ-`included`, ואז כל שורה מעל 200 = +₪4 עד `200 + (max_contacts − 200) × 4`.

**תופעות לוואי שאינן כסף אבל נובעות מאותה שורה שגויה:**

- ל-contact-X נקבע `op_status='reached_billed'` ו-`outreach_state='reached'` — **X מפסיק לפנות אליו** למרות שלא ענה ל-X (`billing.ts:45-47`, `outreach-engine.ts:479-481`, `outreach-calls.ts:173-175`).
- אם התשובה הייתה לחיצת RSVP, ה-RSVP נרשם **לאורח באירוע X** (`webhook-processing.ts:265-277` — `getGuestsForContact(resolved.eventId, …)`), לא באירוע Y.
- ה-`UNIQUE(event_id, contact_id)` **לא** חוסם שורה נכונה עתידית ב-Y (contact-Y הוא רשומה אחרת), אבל ה-fallback ימשיך להפנות ל-X כל עוד X הוא ה-outbound האחרון.

---

## 5. ש3 — reach לגיטימי שאבד

**מנגנון**: אותו fallback מפנה תשובה שיועדה ל-Y (פעיל) אל X (סגור) ⇒ ה-RPC מחזיר `not_active` (או `closed_window`/`event_passed`/`event_not_active`) ⇒ אין שורה. **VERIFIED-LIVE**: 3 interactions נכנסות נושאות `billing_outcome='not_active'` (מתוך 66 billable; כולן על קמפיינים שסגורים היום).

**האם הלקוח הנכון משלם פחות?** כן, בדיוק בסימטריה ל-§4: −₪4 אם Y מעבר ל-`included` (או legacy) ומתחת לתקרה; ₪0 אם בתוך הכלול או על התקרה. באירוע Y גם **לא נעצרת הפנייה** לאיש הקשר (ימשיך לקבל touchpoints), וה-RSVP שלו לא ייקלט ל-Y.

**האם יש התאמה שתשחזר את זה מאוחר יותר? לא.** נבדקו כל הנתיבים:

1. ה-RPC הוא הכותב היחיד, ומסרב לכל קמפיין שאינו `active/paused` — אחרי סגירה אין דרך "לשחזר" reach דרך הקוד.
2. **Reprocess** ב-`/admin/webhooks` (`src/app/(admin)/admin/webhooks/actions.ts:17-43`) רק מאפס את `processed_at/attempts` של שורת ה-inbox; העובד ירוץ שוב, אבל `insertInteraction` יחזיר `fresh=false` (השורה כבר קיימת) ו-`recordReached` **לא ייקרא** (`webhook-processing.ts:203-215`). כלומר reprocess אינו מתקן ייחוס ואינו מחייב מחדש.
3. אין job מתוזמן שסורק interactions לא-מחויבות (`worker/main.ts:1113-1135` — הרשימה המלאה; אין reconcile של חיובים). `sumitHoldReconcile` (`src/lib/data/sumit-hold-reconcile.ts:12-25`) מסנכרן רק שחרור ידני של holds ב-SUMIT.
4. אין פעולת admin להוספת/הזזת שורת `billed_results` (אין UI, אין server action; ה-policy `billed_results_admin_all` קיימת ב-RLS אבל שום קוד לא משתמש בה).

הדרך היחידה "לשחזר" היא כספית ולא ייחוסית: אחרי הסגירה של Y, admin יכול לחייב ידנית סכום שונה **רק** דרך זרימת ביטול-אירוע עם `overrideAmount` (`event-cancellation.ts:432-443`), או להעניק/לבטל קרדיט. אין דרך לרשום שהאורח "הושג" ב-Y.

---

## 6. ש4 — תזמון

- **החיוב מחושב פעם אחת, בעת `closeCampaignAndCharge`**, שנקרא ידנית: כפתור "גמר חשבון" בעמוד הקמפיין (`settleCampaignAction`, מגובה ב-`requireAdmin` בתוך הפונקציה) או `POST /api/campaigns/[id]/close-charge`. אין job ב-pg-boss, אין טריגר על `event_date`, אין "24h אחרי האירוע" בקוד (בניגוד להחלטת הבעלים מ-12.7 ב-`docs/campaign-billing-owner-decision-2026-07-12.md:22` — `capture_window = 24h` — שלא מומש כאוטומציה).
- **סגירת אירוע** (`closeEventAfterSettlement`, `close-charge.ts:77-99`) קורית **אחרי** החיוב, כתוצאה ממנו.
- **חלון הצבירה** נסגר בפועל ע"י שלושה שערים ב-RPC, המוקדם מביניהם: `close_at = event_date` (`closed_window`), יום האירוע עבר (`event_passed`), או `status ∉ (active, paused)` (`not_active`, מיד עם `closeCampaign` בתחילת close-charge).
- **שורה שמגיעה אחרי ה-settle**: לא יכולה להיווצר — הקמפיין `closed` ⇒ `not_active`. ואם באופן תיאורטי שורה הייתה קיימת אחרי החיוב, `charge_status='charged'|'nothing_to_charge'` הוא סופי (`close-charge.ts:132-137`, `markCampaignChargeOutcome` מוגן ב-`campaigns.ts:843-849`) — הסכום לא ישתנה. **VERIFIED-LIVE**: 0 שורות `billed_results` עם `reached_at > charged_at`, 0 עם `reached_at > close_at`.
- **תשובה מאוחרת של אורח** אחרי הסגירה: ה-interaction נשמר (עם `billing_outcome='not_active'`), ה-RSVP **כן** נרשם אם זו לחיצה (הנתיב ב-`webhook-processing.ts:256-285` אינו תלוי בפסיקת החיוב, רק ב-`fresh`), אבל אין כסף ואין reach.
- **בין הסגירה לחיוב**: `closeCampaign` (שורה 143) קודם ל-`getCampaignBillingSummary` (שורה 164) — אין חלון גזע שבו reach חדש נכנס אחרי הספירה.

---

## 7. ש5 — `control_status` / `manual_adjustment`

- סכימה (VERIFIED-LIVE): `control_status text NOT NULL DEFAULT 'confirmed'`, `manual_adjustment jsonb NULL`. אוצר המילים המתוכנן `confirmed|adjusted|disputed` מופיע רק בהערת המיגרציה (`supabase/migrations/202606240007_outcome_billing_schema.sql:192-193`).
- **קוראים**: אפס. `grep` על `src/` ו-`worker/` (ללא `types.generated.ts`) לא מחזיר אף שימוש. `campaign_billing_summary` סופרת `count(b.*)` ללא סינון.
- **כותבים**: אפס. אין server action, אין עמוד admin, אין RPC.
- **מצב חי**: 22/22 שורות `confirmed`, 0 עם `manual_adjustment`.
- **מסקנה**: אין זרימת admin לביטול/תיקון שורת חיוב בודדת. ה"soft-void" הקיים במערכת הוא של **קרדיטים** (`voidBillingCredit`, `users.ts:518-597`), לא של `billed_results`. הכלים היחידים לתיקון כספי הם: קרדיט לאירוע/קמפיין (לפני הסגירה), `overrideAmount` בזרימת ביטול אירוע (`event-cancellation.ts:432-443`), או זיכוי SUMIT אחרי חיוב (`creditHeldCardSumit`, `capture.ts:176-274`, **לא נבדק חי** לפי ההערה בקוד).

---

## 8. ש6 — Meta מול KALFA

**אין נתיב קוד שקורא את `statuses[].pricing` של Meta לתוך חיוב KALFA.** בדיקה:

- ה-route של ה-webhook שומר את אובייקט ה-status כולו כ-`payload` (`src/app/api/webhooks/whatsapp/route.ts:200-215`) — כולל `pricing` אם Meta שלחה, אבל כנתון גולמי בלבד.
- `processStatus` (`webhook-processing.ts:302-329`) מעדכן רק `delivery_status`/`delivery_error_code` ומסמן `wrong_number` על 131026. אין חיוב.
- הקורא היחיד של `payload.pricing` הוא **תצוגה** ב-inspector: `src/app/(admin)/admin/webhooks/webhook-detail.tsx:116-119, 250-260` (מציג `billable/category/type/pricing_model` כטקסט).
- אין טבלה/עמודה שמצטברת עלויות Meta. עלויות הספקים שכן נעקבות במערכת: יתרת Voximplant (`voximplant-balance*.ts`), מכסת ElevenLabs (`elevenlabs-quota.ts`). Meta — לא (רק ב-Business Manager של Meta).

**ניסוח לבעלים**: Meta מחייבת את KALFA לפי שיחה/תבנית (conversation / template category); KALFA מחייבת את הלקוח לפי איש קשר שהושג (`billed_results`) לפי החוזה החתום. שני המדדים בלתי-תלויים לחלוטין: הודעה שנמסרה ונקראה ללא תגובה עולה ל-KALFA מול Meta ולא עולה ללקוח (חוזה §3, `template.ts:252-259`); תשובה מוקלדת של אורח היא reach אחד ללקוח בלי קשר לכמה שיחות Meta היא פתחה.

---

## 9. ש7 — אגרגטים חיים (VERIFIED-LIVE 2026-09-04, ללא PII)

| status | charge_status | capture | קמפיינים | שורות `billed_results` | Σ `locked_price` | `base` / `included` / `ppr` | `max_contacts` | `ceiling` | `auth_amount` | Σ `final_charge` | Σ `credit_applied` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| closed | nothing_to_charge | authorized | 2 | 22 (21 + 1) | 88 | 0 / 0 / 4 | 38, 1 | 152, 4 | 152, 4 | 0 | 88 |
| active | null | authorized | 2 | 0 | 0 | 200 / 200 / 4 | 0, 0 | 200 | 200 | — | 0 |
| approved | null | null | 1 | 0 | 0 | 200 / 200 / 4 | 0 | 200 | null | — | 0 |

- קמפיינים עם `count(billed_results) > included_reached`: **2** — שני הסגורים, שבהם `included=0`. **אף חיוב overage אמיתי לא בוצע**: שניהם נסגרו ב-₪0 בזכות קרדיט (84 + 4). Σ `final_charge_amount` בכל המערכת = 0.
- ערוצים: 21 WhatsApp (`whatsapp_inbound_message`), 1 שיחה (`voximplant_call_completed`).
- `billing_credits`: 4 שורות, 2 בוטלו, מאגר חי 94 על 2 אירועים.
- סט מורשה: 38, 1 בסגורים; 0, 0, 1 בשלושת החדשים. `campaign_authorized_set_audit`: 3 שורות.
- interactions נכנסות billable: 66, מתוכן 3 `not_active`, 63 ללא `billing_outcome` (נרשמו לפני שהעמודה נוספה); 0 עם `campaign_id` NULL.
- outbound אחרי סגירת קמפיין: 0.
- שערים: `payments_enabled=true`, `close_charge_enabled=true`, `campaign_holds_enabled=true`, `base_overage_pricing_enabled=true`, `billing_exposure_gate=false`.

---

## 10. איפה שגיאת ייחוס משנה חשבונית אמיתית — ופערים

### 10.1 נקודות שבהן שורה שגויה/חסרה = כסף

1. **`interactions.ts:87-94`** — בחירת ה-outbound האחרון לפי טלפון, בכל האירועים. זו הנקודה היחידה שבה `campaign_id` של reach נקבע בניחוש. כל שורה שנולדת כאן ונכנסת ל-RPC היא +₪4 ל-X (או −₪4 ל-Y) כשהקמפיין מעבר ל-`included` ומתחת לתקרה.
2. **`try_record_billed_result` (live)** — `locked_price = price_per_reached` בזמן הרישום, אבל החיוב מכפיל ב-`price_per_reached` הנוכחי. היום אין נתיב שמשנה את המחיר אחרי יצירה, כך שאין פער; אם ייווסף — הסכום ישתנה רטרואקטיבית.
3. **`close-charge.ts:230-231`** — הכפלה לפי `count`; שורת `disputed` היפותטית עדיין נספרת (§7).
4. **`event-cancellation.ts:432-443`** — `overrideAmount` של admin מחליף את החישוב כולו; זו הדרך היחידה לחייב סכום שאינו נגזר מהספירה.

### 10.2 מה מגן

- `UNIQUE(event_id, contact_id)` — אותו אדם פעם אחת לאירוע, בכל ערוץ.
- `context.id` — כשקיים, הייחוס מדויק (30/59 מההודעות).
- חברות בסט המורשה (gate OFF) — contact-X חייב להיות בסט של X; אורח שנוסף רק ל-Y לא יכול להתחייב ב-X אלא אם הטלפון שלו קיים גם כ-contact ב-X.
- תקרה חתומה — `min(gross, ceiling)` בכל ענף.
- סופיות — `charged`/`nothing_to_charge` לא ניתנים לדריסה.

### 10.3 פערים שנמצאו (לא תוקנו — read-only)

1. **החיוב אינו מוגבל ל-`auth_amount`.** `computeChargeAmount` חוסם ב-`max_charge_ceiling` בלבד. כש-`ceiling > auth_amount` (יותר מ-`reasonable_coverage` אנשי קשר), SUMIT עלול לדחות J4 מעל המסגרת — יירשם `charge_failed`, לא נזק, אבל אין `hold_insufficient` guard. (ידוע, מתועד בהנחיות הסוכן.)
2. **החוזה v4 אומר שדמי ההפעלה נגבים "במועד הפעלת הקמפיין בפועל"** (`template.ts:262`); הקוד גובה הכול בחיוב אחד בסגירה. פער ניסוח-מול-קוד לעו"ד, לא לתיקון קוד שקט.
3. **`campaign_billing_summary.accrued` עיוור ל-base/included** — כל צרכן חייב לחשב מחדש; מקור לבלבול עתידי.
4. **אין audit של ניסיונות חיוב** — רק המצב האחרון על שורת הקמפיין + Slack. `charge_review` שהפך אחר כך ל-`charged` מאבד את ההיסטוריה.
5. **`control_status`/`manual_adjustment` מתים** — קיימים בסכימה, ללא קוראים, ללא כותבים, ללא UI (§7). אם רוצים void לשורה — צריך גם לשנות את ה-SQL של הסיכום וגם UI.
6. **ייחוס לפי טלפון חוצה אירועים** (§4-5) — הפתרון המלא הוא לתחום את `resolveInboundContact` לקמפיינים `active/paused` בלבד (או להעדיף אירוע פעיל על סגור) — שינוי בנתיב כסף, דורש תוכנית ואישור.
7. **`event-stats.ts:254` מציג "reached" תפעולי** (מ-delivery breakdown) ליד `billing.reachedCount` (`:275-283`) — שני מספרים שונים באותו DTO; לוודא שהלקוח לא רואה את הראשון כבסיס לחיוב.

---

## 11. קבצים שנקראו במלואם / נשלפו חי

קוד: `src/lib/data/billing.ts`, `close-charge.ts`, `close-charge-amount.ts`, `campaigns.ts`, `payments.ts`, `interactions.ts`, `webhook-processing.ts`, `event-cancellation.ts`, `tax-ceiling.ts`, `reconcile-config.ts`, `sumit-hold-reconcile.ts`, `src/lib/sumit/capture.ts`, `charge.ts`, `raw-charge.ts`, `src/app/api/campaigns/[id]/{authorize,close-charge}/route.ts`, וקטעים רלוונטיים מ-`call-result-processing.ts`, `outreach-engine.ts`, `outreach-calls.ts`, `admin/users.ts`, `admin/webhooks/actions.ts`, `webhook-detail.tsx`, `agreements/template.ts`, `agreements.ts`, `worker/main.ts`, `whatsapp/inbound.ts`, `api/webhooks/whatsapp/route.ts`.

DB חי: `pg_get_functiondef` של `campaign_billing_summary`, `try_record_billed_result`, `reconcile_authorized_set`, `exposed_for_billing`, `has_service_exposure`, `cancel_campaign`, `campaigns_guard_cancel`; עמודות `billed_results`, `billing_credits`, `campaigns`; אילוצים על `billed_results`; טריגרים; `app_settings` (שערים); אגרגטים ב-§9.

בדיקות קיימות שמכסות את הנתיב: `close-charge.test.ts` (35), `billing.test.ts` (14), `close-charge-amount.test.ts` (9) — לא הורצו במסגרת הביקורת (read-only).
