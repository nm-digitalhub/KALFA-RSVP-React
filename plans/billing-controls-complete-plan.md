# KALFA — תוכנית כוללת: בקרות חיוב + השלמת מנגנון החיוב (end-to-end, בשלבים)

> מטרה: מערכת חיוב **שלמה ובטוחה** — `reached ⊆ authorized` מעצם הבנייה, **חיוב אחד פר אירוע**, תפיסת מסגרת = ביטחון בלבד, **חישוב סופי בגמר חשבון** לפי שהושג בפועל. אפס hardcode. הכל **רדום** (config-gated) עד הפעלה מפורשת.
> כל מיגרציה = שינוי ל‑DB החי → **נכתבת כקובץ ומיושמת רק באישור מפורש, פר‑שלב**.

## מודל החיוב (מאומת מול הקוד + הכרעת המשתמש)
- **Outcome billing**: סכום = (אנשי קשר ייחודיים שהושגו) × `price_per_reached`, כולל מע"מ 18%, עד התקרה.
- **חד‑פעמי פר אירוע**: hold אחד באישור → **capture יחיד** בסגירה. לא חוזר, לא מנוי, לא רכישת חבילה.
- **תפיסת מסגרת = ביטחון בלבד**: `hold = max(min_hold_floor, |set| × price)`. **הרצפה לעולם לא מעלה את החיוב.**
- **גמר חשבון**: `charge = min(Σ reached × price, ceiling)` בסגירת הקמפיין.

## הממצא שמחייב תוכנית כוללת (מעקב end-to-end)
החצי הקדמי חי (hold J5, בחירת outreach ב‑WhatsApp). **החצי האחורי חסר ב‑DB החי**: ה‑RPCs `try_record_billed_result` ו‑`campaign_billing_summary` **לא קיימים** (B2/B4 טרם נבנו) — לכן רישום "הושג" והחיוב הסופי עדיין לא פונקציונליים. נקודות מגע: בחירה = `listSendableContacts` (נתיב יחיד); רישום = `recordReached`←webhook WhatsApp; חיוב = `close-charge`.

---

## עקרונות מחייבים (חוצי‑שלבים)
1. **אפס hardcode** — price/floor/ceiling/policy = DB data, נקראים בצד שרת.
2. **`reached ⊆ authorized` מעצם הבנייה** — השער היחיד לבחירה הוא ה‑set; בנוסף בדיקת set ב‑RPC (defense‑in‑depth).
3. **Config‑gating (fail‑closed)** — `getOutreachEnabled()`/`getCloseChargeEnabled()` שולטים; שום שליחה/חיוב אמיתי עד הפעלה מפורשת + flag per‑action.
4. **אדיטיבי והפיך** — טבלאות/עמודות חדשות; מיגרציות מאושרות פר‑שלב.
5. **חד‑פעמי פר אירוע** — הרשאה אחת, חיוב אחד; אין top‑up/חיוב שני. גדילה מעבר למורשה = חסומה + מוצגת.
6. **הסרה גוברת** — `removal_requested`/consent עדיין מסננים בתוך ה‑set.

---

## שלב 1 — יסוד ה‑frozen‑set + תפיסה הגיונית (החלקים החיים)
**מטרה:** לחסום outreach ל‑set, לתזמן hold הגיוני (cap במרחב אנשי‑קשר), ולטפל בקיצון בבחירה מפורשת. (כבר חוסם `reached ⊆ authorized` דרך השער.)

**מדיניות התפיסה (מחקר סטטיסטי + עסקי, 2026‑06‑29):**
```
covered = min( full_unique_contacts , reasonable_coverage_contacts=300 )
hold    = max( min_hold_floor , covered × price × (1 + hold_buffer_pct) )   ← ביטחון בלבד
ceiling = full_unique × price (§7, D1=No) ; charge = min(Σ reached×price, ceiling)   ← capture אחד בסגירה
```
> covered מתזמן את ה‑**hold** בלבד; התקרה = full×price (§7). **אזהרת שלב 2:** לפני הורדת ה‑hold ל‑covered×price — חברוּת ב‑SET חייבת לכבול את `reached` (נתיב outreach+billing יחיד), אחרת זנב (full−covered) הופך לחיוב לא‑מאובטח ולא‑ניתן‑לגבייה.
3 רצועות (R=300, X=400, admin‑config): **≤R** covered=הכל (אפס חיכוך) · **R–X** כיסוי‑מלא בלחיצה · **>X** החלטה מפורשת מאולצת (כיסוי‑מלא בהסכמה / cap‑ל‑N בסדר נראה) — **לעולם לא שקט**. הרחבה = **delta‑hold** (hold נוסף על ההפרש, בלי חיוב שני).

**מיגרציה A** (`202606290024_billing_authorized_set.sql` — כתובה):
- `campaign_authorized_contacts(event_id, campaign_id, contact_id, unique(campaign_id, contact_id))` + RLS (owner SELECT `owns_event`, admin ALL, כתיבה service‑role).
- `app_settings`: `reasonable_coverage_contacts=300`, `extreme_threshold_contacts=400`.
- `packages`: `min_hold_floor=0`, `hold_buffer_pct=0`.

**קוד:**
- **snapshot + תזמון hold** (`authorize/route.ts` + `campaigns.ts`): אטומית — `covered=min(full,R)` → צילום top‑covered המורשים לסדר → `ceiling=covered×price`, `hold=max(min_hold_floor, covered×price×(1+buffer))`. ה‑knobs נפתרים: package override → app_settings global.
- **סינון outreach** (`contacts.ts:listSendableContacts`): JOIN ל‑`campaign_authorized_contacts` (וגם removal/consent). **השער היחיד.**
- **UI עריכת knobs** (`admin/packages/package-form.tsx` + `validation/admin.ts` ל‑min_hold_floor/buffer; `admin/agreement` או settings ל‑R/X).
- **UI בחירת כיסוי + גדילה** (owner, דף האורחים/אישור): רצועה 2/3 → בחירה מפורשת "כיסוי‑מלא / N מתוך M" + delta‑hold.

**אימות:** סדר זרימה (hold יוצר set לפני outreach); reached⊆set; `hold=max(floor,covered×price)`; covered=min(full,R); 3 הרצועות; removal גובר; knobs config‑driven. lint/tsc/build/tests.

**+ בקרת תפוגת auth (ממצא הצוות — חור אמיתי):** ה‑J5 נתפס באישור, capture בסגירה; לאירוע חודשים מראש ה‑hold עלול לפוג (חלון auth ~7–30 יום) → capture על כרטיס לא‑מאובטח. מיטיגציה (`auth_expires_at` כבר על `campaigns`): re‑authorize סמוך לסגירה + הגבלת/התרעת פער אישור‑לסגירה. **משולב בשלב זה.**

---

## שלב 2 — חצי אחורי: רישום "הושג" (B2)
**מטרה:** להפוך את רישום ההגעה לפונקציונלי **וחסום ל‑set**.

**מיגרציה B**: `try_record_billed_result(...)` **SECURITY DEFINER** — בטרנזקציה אחת:
- נעילת הקמפיין `FOR UPDATE` + `status='active'` + בתוך החלון.
- **`contact ∈ campaign_authorized_contacts`** (דחיית מי שלא מורשה) ← תוספת הבקרה.
- `COUNT(billed_results) < max_contacts` (תקרה) + `INSERT ... ON CONFLICT (event_id,contact_id) DO NOTHING` (idempotency).
- מחזיר: `billed | already_billed | ceiling_reached | not_active | closed_window | before_window | removal_requested | not_authorized | no_campaign`.

**קוד:** `recordReached` (`billing.ts`) כבר קורא ל‑RPC; webhook WhatsApp כבר קורא ל‑recordReached. רענון types.
**אימות:** טסטים — תקרה, חלון, dedup, **דחיית contact מחוץ ל‑set**, idempotency. (רדום מאחורי gate.)

---

## שלב 3 — חצי אחורי: חיוב סופי בגמר חשבון (B4)
**מטרה:** להפוך את ה‑capture לפונקציונלי.

**מיגרציה C**: `campaign_billing_summary(p_campaign)` — מחזיר `reached_count`, `accrued (Σ locked_price)`, `ceiling`, `max_contacts` (PostgREST aggregates כבויים → RPC).
**קוד:** `close-charge.ts` כבר כתוב (`amount = min(accrued, ceiling)` → `captureHeldCardSumit`); רק זקוק ל‑RPC. שחרור ה‑hold כשאין/חלקי חיוב (`holdReleaseDays`).
**אימות:** טסטים — סכום סופי = min(accrued,ceiling); 0 הושגו → nothing_to_charge + שחרור hold; fail‑closed; idempotency של ה‑capture.

---

## שלב 4 — אינטגרציה, gating, E2E, פריסה
- לאמת ש‑`outreach_enabled`/`close_charge_enabled` שומרים על מצב רדום עד הפעלה.
- **E2E מלא:** create → sign(OTP) → approve → **hold(set+floor)** → activate → **outreach(set בלבד)** → **reached(set‑bound)** → close → **settle(min(accrued,ceiling))**.
- lint/tsc/build/כל הטסטים + deploy.

---

## מפת "מרחיב מול יוצר" — אין כפילויות (מאומת מול הקוד)
| רכיב | קיים? | פעולה |
|------|-------|-------|
| `try_record_billed_result`, `campaign_billing_summary` RPCs | **לא מוגדרים בשום מיגרציה** (רק נקראים מ‑`billing.ts`) | **יוצר** (משלים את החסר — לא כפילות) |
| `campaign_authorized_contacts`, `packages.min_hold_floor` | לא קיים | **יוצר** (מיגרציה A) |
| `listSendableContacts` (השער) | קיים `contacts.ts:205` | **מרחיב** (JOIN ל‑set) |
| hold snapshot + sizing | קיים `authorize/route.ts` + `campaigns.ts:recordCampaignHold` | **מרחיב** |
| `recordReached`, `getCampaignBillingSummary` | קיימים `billing.ts` (קוראים ל‑RPC) | **מרחיב** (לא נוגעים — רק ה‑RPC נוצר) |
| `close-charge` | קיים `close-charge.ts` (כתוב מלא) | **מרחיב** (שחרור hold) + מופעל כשה‑RPC קיים |
| עריכת `min_hold_floor` | טופס חבילה קיים `admin/packages/{package-form.tsx,actions.ts}` + `validation/admin.ts` | **מרחיב** (שדה נוסף) |
| UI גדילה | **אין דף "מצב קמפיין" ייעודי**; הזרימה = new→approve→payment | **מרחיב דף קיים** (דף האורחים `events/[id]/guests` — שם מוסיפים אורחים) — **לא יוצר דף חדש** |
| כל שכבת הנתונים | `billing/campaigns/contacts/close-charge/interactions/outreach.ts` + `.test.ts` קיימים | **מרחיב** |

> מסקנה: התוכנית **מרחיבה** קבצים קיימים; היחיד שנוצר מאפס = ה‑RPCs (שלא הוגדרו בשום מקום) + טבלת ה‑set + עמודת floor. אין דף/אזור/קובץ כפול.

## הכרעות מוצר לאישורך (משפיעות על ה‑RPCs)
1. **תקרה נחצית באמצע** — עצירה שקטה (`ceiling_reached`) או התרעת אדמין? (ברירת מחדל: `ceiling_reached`, ללא חיוב מעבר.)
2. **תגובה ב‑paused / אחרי סגירה** — מחייבת? (ברירת מחדל: לא — מחוץ לחלון.)
3. **סף "אינטראקציה אנושית" לשיחות AI** (Voximplant, עתידי) — אילו אותות = הושג; **admin‑configurable**, לא hardcoded. (לא נדרש לשלב 1–3; ערוץ WhatsApp = הודעה נכנסת.)

## רצף ואישורים
שלב 1 (מיגרציה A) → שלב 2 (מיגרציה B) → שלב 3 (מיגרציה C) → שלב 4. **כל מיגרציה מאושרת בנפרד לפני יישום.** כל שלב עצמאי וניתן לאימות. הכל רדום עד go‑live.
