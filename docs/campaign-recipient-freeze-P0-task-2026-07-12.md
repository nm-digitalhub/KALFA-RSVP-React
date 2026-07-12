# P0 — אורח שנוסף אחרי הקפאת רשימת הנמענים מושמט בשקט מהקמפיין

סטטוס: **OPEN (P0)** · נפתח: 2026-07-12 · מקור: [חקירה מלאה](./campaign-recipient-freeze-investigation-2026-07-09.md)

## התופעה (אירוע אמת שהוכיח את הבאג)

באירוע הברית `294d23e1` (12.7.26) האורח **"האורח שהושמט (שם הוסתר)"** לא קיבל וואטסאפ.
שורש הסיבה שאומת מול ה-DB החי:

- רשימת הנמענים המורשה (`campaign_authorized_contacts`) הוקפאה בצעד ה-J5 hold ב-**2026-07-07 10:18** עם 38 אנשי קשר.
- ה-contact של האורח נוצר/קושר רק ב-**2026-07-09 13:33** (יומיים אחרי ההקפאה) — כי הטלפון נוסף מאוחר.
- לכן ה-contact **מעולם לא נכנס לסט המורשה** → `seedOutreachState` (שקורא רק מהסט) לא זרע אותו → אין `outreach_state` → **מעולם לא נשלח**, ללא שום שגיאה או חיווי ב-UI.

זהו **תרחיש 1 / 2א** במסמך החקירה: הוספת אורח/טלפון אחרי הפעלה → **השמטה שקטה**.

מיטיגציה נקודתית שבוצעה (12.7): נשלחה לו הזמנה חד-פעמית דרך `sendOneWhatsApp`
(מסלול לא-מחייב, מחוץ לרשימה המוקפאת) — `scripts/send-one-invite.ts`. זו עקיפה
ידנית, לא תיקון. הבאג נשאר פתוח לכל אורח עתידי שנוסף אחרי הקפאה.

## הפער

- **אין מנע ואין חיווי:** `createGuest`/`updateGuest(phone)` בזמן קמפיין פעיל אינם
  מוסיפים ל-סט המורשה ואינם מזהירים את בעל השמחה.
- **הפסד ערך + אמון:** הלקוח שילם לפי כמות אנשי קשר; אורח חדש פשוט לא טופל.
- באג אחות (P0 נוסף במסמך): repoint/מחיקת טלפון בקמפיין פעיל משאיר contact
  ישן/מחוק בסט → חיוב על מספר שגוי והחמצת הנכון.

## תיקון נדרש (לפי תוכנית החקירה)

### P0-1 — ריצוי הסט המורשה (קריטי)

> **⛔ BLOCKER מחייב (2026-07-12): הכלל הוא exposed-or-billed pinned, NOT billed-only pinned.**
> `billed_result` הוא **מאוחר מדי** כקריטריון יחיד — billing/webhooks/provider-callbacks
> יכולים לאחר, אז היעדר billed_result אינו מוכיח ש-A לא קיבל שירות. **אין ליישם את ה-RPC
> לפי billed-only.** הספק המחייב המלא: [`campaign-recipient-freeze-plan-2026-07-12.md`](./campaign-recipient-freeze-plan-2026-07-12.md) §P0-1.

RPC `reconcile_authorized_set(event_id, campaign_id, old_contact, new_contact)`
ב-SECURITY DEFINER, נקרא מ-`linkGuestContact` (`contacts.ts:159`) ומ-`deleteGuest`
(`guests.ts:511`), תחת `campaigns ... FOR UPDATE` (סריאליזציה עם ה-billing RPC):
- **`exposed(A)`** = יש ל-A **כל** אחד מ: outbound `contact_interaction` · provider
  attempt/`provider_ref` · call request · inbound RSVP/reply · reached evidence · `billed_result`.
- הסר `old_contact` מהסט **רק אם `NOT exposed`** (swap חינמי). אם `exposed` → **נעוץ** כ-recipient
  היסטורי/מסחרי (לא שליחות עתידיות אם אין guest חי; חיוב callback-מאוחר נשאר לגיטימי) — זה
  **replacement event, לא swap**.
- הוסף `new_contact` **רק אם** גודל הסט ≤ `funded_cap = min(max_contacts, floor(auth_amount/price))`
  — שומר דליפת הכסף `reached ⊆ set ≤ floor(hold/price)`; אחרת דורש top-up מפורש.
- **audit מינימלי הוא חלק מ-P0-1** (לא P2): append-only על כל כניסה/יציאה/נעיצה — נדרש להגנת
  chargeback, מניעת race, והוכחה למה A נעוץ נשמר.
- TDD: (א) repoint A→B, A לא-exposed — B נכנס, A יוצא, לא חורג מ-funded_cap.
  (ב) A **exposed בכל צורה** (גם לפני billed_result) — A **נעוץ**, B נכנס רק תחת funded_cap + audit.
  (ג) callback billing מאוחר על A-נעוץ — נשאר לגיטימי, לא כפל, מגובה-audit.
  (ד) deleteGuest שמייתם contact לא-exposed — יוצא; exposed — נעוץ.

### P0-2 — חיווי UI על רשימה נעולה (ביניים)
באנר במסך guests כשקיים קמפיין OPERATIONAL: "הקמפיין פעיל — הוספת אורחים/טלפונים
לאחר ההפעלה לא תיכלל בשליחה" (או חסימה עם הסבר, לפי החלטה עסקית).

### P1 — קהל דינמי בתוך תקרה (המלצת החקירה)
hook re-snapshot אחרי `createGuest`/`updateGuest(phone)`/import עם
`cap = min(max_contacts, floor(auth_amount/price))`; ראה מסמך החקירה §תוכנית תיקון.

## קבצים מרכזיים
- `src/lib/data/contacts.ts:117` (`linkGuestContact`), `:172` (`pruneOrphanContact`), `:344` (`snapshotAuthorizedSet`)
- `src/lib/data/guests.ts:400/459/511` (`createGuest`/`updateGuest`/`deleteGuest`)
- `src/lib/data/outreach-engine.ts:62` (`seedOutreachState`)
- `supabase/migrations/202606290029_billing_set_membership.sql:52` (שומר `not_authorized`)

## תלות
לפני P1 חובה לסגור P0-1, אחרת המעבר לדינמי מגדיל את שטח הפגיעה של באג החיוב על מספר שגוי.
