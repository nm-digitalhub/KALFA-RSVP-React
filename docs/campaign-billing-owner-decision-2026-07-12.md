# Owner Decision — מודל חיוב: minimum + authorized ceiling + recipient ledger

תאריך: 2026-07-12 · סטטוס: **✅ APPROVED ע״י בעל המוצר 2026-07-12** · P0-1 design spec מותר להתחיל (תכנון, לא קוד)
הקשר: [תוכנית](./campaign-recipient-freeze-plan-2026-07-12.md) · [חקירה](./campaign-recipient-freeze-investigation-2026-07-09.md) · [P0 task](./campaign-recipient-freeze-P0-task-2026-07-12.md)

> **מה זה:** החלטה עקרונית קצרה לפני מימוש. מעבר מ"הקפאת מספר contacts ב-J5" ל"הקפאת מסגרת
> כספית + רשימת נמענים חיה". **שינוי מודל חיוב מפורש** (חורג במכוון מ-`campaign-rework-constraint`)
> → דורש עדכון הסכם חתום + גילוי §14ג. הפסקאות עם קוד הן **תכנון בלבד** — אין לממש עד אישור.

## 1. מספרים מומלצים

| פרמטר | ערך מומלץ |
|---|---|
| `minimum_charge` | **₪200** (כולל מע״מ) — רצפת חיוב אמיתית, לא פיקדון |
| `price_per_reached` | **₪4** לכל recipient שהושג (reached/אישר) |
| `capture_window` | **24 שעות** אחרי מועד האירוע |
| `authorized_ceiling` (ברירת מחדל) | `max(₪200, estimated_contacts × ₪4)`; ללא הערכה אמינה → **₪200** |

## 2. נוסחת חיוב

```
final_charge = min(authorized_ceiling, max(minimum_charge, reached_count × price_per_reached))
```

## 3. funded_cap (נגזר מכסף, לא ממספר contacts ב-J5)

```
funded_cap = floor(authorized_ceiling / price_per_reached)
```
ברירת מחדל ₪200 → `funded_cap = 50` recipients.

## 4. שינוי סמנטי (הליבה)

- `campaign_authorized_contacts` **אינו אמת החיוב** — הוא **תור eligibility זמני** בלבד.
- **אמת החיוב = recipient/exposure ledger** (מי קיבל outcome תקף), לא guest count ולא הסט הקפוא.
- הרשימה **חיה עד סגירת האירוע**; אורח שנוסף אחרי פרסום נכנס אוטומטית כל עוד
  `projected_charge ≤ authorized_ceiling`, ונספר לחיוב רק אם reached. (פותר את האורח שהושמט טבעית.)

## 5. תנאי חובה

1. **אין חיוב ללא exposure evidence** — לא להסתמך רק על `campaign_authorized_contacts`.
2. **recipient מסוג exposed-or-billed הוא immutable לצורכי billing ו-audit** — לא נמחק ולא
   משתנה בדיעבד (העבר בלתי-משתנה; נשמר כראיה לחיוב ולהגנת chargeback).
3. **תיקון טלפון A→B:** לפני exposure = **swap** חינמי; אחרי exposure = **replacement recipient**
   (A נעוץ כהיסטורי, B חדש). `exposed` = outbound interaction · provider attempt/ref · call request ·
   inbound reply · reached · billed.
4. **top-up נדרש לפני מעבר ל-`authorized_ceiling`** — לעולם לא חריגה שקטה.
5. **ה-J5 hold בגובה `authorized_ceiling`, לא `minimum_charge`** — אחרת `reached×price` יעבור את ההרשאה.
6. **תוקף ה-hold מול capture-at-close** — הרשאת J5 פגה (`auth_expires_at`); תפיסה 24ש+ אחרי
   האירוע מחייבת ודאות תוקף, אחרת re-auth.

## 6. UI / גילוי (§14ג — לפני אישור הכרטיס)

להציג ללקוח בבירור, לפני אישור: **מינימום ₪200 · מחיר ₪4 ל-reached · תקרה מאושרת · חיוב סופי
24 שעות אחרי האירוע**. נוסח מוצע:
> האירוע כולל מינימום חיוב של ₪200. מעבר לכך תחויב רק לפי אורחים שנוצר איתם קשר בפועל,
> ₪4 לאורח, עד התקרה שתאשר מראש. ניתן להוסיף/לעדכן אורחים עד האירוע; המערכת תכלול אותם
> כל עוד המסגרת מאפשרת.

## 7. דוגמאות עבודה

| מצב | חישוב | חיוב סופי |
|---|---|---|
| 38 contacts, אין הערכה | ceiling=₪200, funded_cap=50, reached 21×4=₪84 | **₪200** (מינימום) |
| — האורח שהושמט נכנסים | 23 reached × ₪4 = ₪92 < ₪200, ותחת funded_cap 50 | **₪200**, בלי בעיה |
| אירוע 120, reached 90 | ceiling=₪480, 90×4=₪360 | **₪360** |
| reached 100 מול ceiling ₪480 | 100×4=₪400 | **₪400** |
| ניסיון להגיע ל-130 מול ceiling ₪480 | funded_cap=120; 130×₪4=₪520 > ₪480 | המערכת **עוצרת לפני חשיפה מעבר ל-120** ודורשת top-up **מראש** |

> **הערת חריג (fail-safe):** top-up נדרש **לפני** חריגה מ-`funded_cap`/`authorized_ceiling`, לא בדיעבד
> (עקבי עם §5.4). אם בכל זאת נוצרה חריגה תפעולית — **אין לבצע capture מעל `authorized_ceiling`
> (₪480 בדוגמה) ללא הרשאה חדשה**; החריגה נכנסת ל-audit / manual review.

## Owner sign-off — ✅ אושר 2026-07-12 ע״י בעל המוצר

- [x] `minimum_charge = ₪200`
- [x] `price_per_reached = ₪4`
- [x] `capture_window = 24h אחרי האירוע`
- [x] `authorized_ceiling = max(₪200, estimated_contacts × ₪4)`
- [x] סמנטיקת ledger (הסט = eligibility בלבד; billing = recipient/exposure ledger)
- [x] אין להתחיל חיוב מעבר לתקרה ללא top-up **מראש**
- [ ] **פתוח (טרם מומש):** עדכון הסכם חתום + גילוי §14ג — נדרש לפני שהמודל עולה לייצור מול לקוחות

## אחרי אישור

רק אז מתחילים **P0-1 בנוסח החדש**: אל תחייב לפי `campaign_authorized_contacts` בלבד; אל תחייב
contact ללא exposure evidence; התחל exposure-proof path / ledger מינימלי. עד אז — **implementation מוקפא**.
