# חקירה: קפיאת רשימת נמענים מול תקרת התחייבות — קמפיין RSVP אחרי הפעלה

תאריך: 2026-07-09
כלי: קריאת קוד + סכמה חיה (מיגרציות). לא הורצה הרצה מול DB חי (אין גישה ל-psql/IPv6).

## תשובה קצרה לשאלת הליבה

המערכת **מקפיאה את שניהם — גם את רשימת הנמענים (הסט המורשה) וגם את התקרה הכספית** — אבל הקפאת הנמענים היא הקשיחה מבין השתיים, והיא מתבצעת בנקודה אחת: צעד ה-J5 hold (אישור הכרטיס), לא ביצירה ולא בהפעלה.

- **סט הנמענים המורשה** = `campaign_authorized_contacts` — מוקפא ב-`snapshotAuthorizedSet` שנקראת מ-`prepareCampaignHold` (`src/lib/data/campaigns.ts:535`), שנקראת רק מ-`api/campaigns/[id]/authorize/route.ts:147`.
- **התקרה הכספית** = `max_charge_ceiling = max_contacts × price` (לא מונמכת אל ה-covered), ב-`prepareCampaignHold` (`campaigns.ts:544-549`).
- **הכמות המחייבת** = `max_contacts = full` (כל אנשי הקשר הייחודיים ברגע ה-hold).

הקפאת הסט היא "שומר דליפת הכסף" (money-leak guard): ההיתר להנמיך את ה-hold אל `covered×price` (< תקרה) בטוח **רק** כי `reached ⊆ סט` בבניה (`try_record_billed_result`, מיגרציה `202606290029:52-55`).

## שרשור העדויות לאורך כל המחזור

1. **יצירה** `createCampaign` (`campaigns.ts:130`) — `max_contacts` מחושב מ-`countUniqueContactsForEvent` אבל **הסט לא מוקפא כאן**.
2. **אישור + hold** `authorize/route.ts:147` → `prepareCampaignHold` (`campaigns.ts:502`):
   - `full = countUniqueContactsForEvent` (נוכחי)
   - `covered = min(full, reasonable_coverage)`
   - **`snapshotAuthorizedSet(eventId, campaignId, covered)`** — REPLACE semantics, מקור = contacts שמקושרים ל-guest נוכחי + לא removal_requested, חיתוך דטרמיניסטי (`contacts.ts:344-407`).
   - שומר `max_contacts=full`, `max_charge_ceiling=full×price`.
3. **הפעלה** `activateCampaign` (`campaigns.ts:722`) — **לא מקראת snapshotAuthorizedSet מחדש**. ה-seed עושה זאת: `seedOutreachState` (`outreach-engine.ts:62`) קוראת **רק** מ-`campaign_authorized_contacts` (הסט המוקפא) → upsert ל-`outreach_state` עם `ignoreDuplicates`. לכן contact שלא בסט **מעולם לא יוזרע** ומעולם לא ייכנס לתור.
4. **שליחת ה-worker** `prepareAndSendStep` (`outreach-engine.ts:593`) — בודקת רק `removal_requested` / `whatsapp_consent_at`. **לא** בודקת חברות בסט מחדש (היא מסתמכת על כך שה-seed לא הזריק מי שלא בסט).
5. **חיוב** `try_record_billed_result` (`202606290029:52-55`) — בודקת `exists(select 1 from campaign_authorized_contacts where campaign_id=p_campaign and contact_id=p_contact)`; אם לא → `'not_authorized'` (fail-closed). כמו כן `count(billed_results) >= max_contacts` → `'ceiling_reached'`.
6. **סטטיסטיקה** `campaign_billing_summary` (`202606290028:71-77`) — `reached_count = count(billed_results)`, `ceiling = max_charge_ceiling`, `max_contacts`. סופרת **contacts ייחודיים** (UNIQUE(event_id, contact_id)), לא אורחים ולא headcount.

## בדיקת שני התרחישים

### תרחיש 1 — בעל השמחה מוסיף אורח חדש אחרי שהקמפיין פעיל

נתיב: `createGuest` (`guests.ts:400`) → `logActivity('guest.created')` → `syncGuestContact` (`guests-actions.ts:93`) → `linkGuestContact` (`contacts.ts:117`) יוצרת contact חדש + מקשרת `guests.contact_id`.

- ה-contact החדש **לא** נוסף ל-`campaign_authorized_contacts` (אין קריאה ל-`snapshotAuthorizedSet` כאן).
- `seedOutreachState` קוראת רק מהסט → האורח לא מוזרע → לא נשלח.
- גם אם יוזרע בטעות, `try_record_billed_result` תחזיר `'not_authorized'` → לא חיוב.
- **תוצאה:** האורח החדש **מושמט בשקט** — ללא שגיאה, ללא אינדיקציה ב-UI. הפסד ערך ללקוח (שילם, האורח לא טופל) ופגיעה באמון.
- **אין שום מנע** על `createGuest` בזמן קמפיין פעיל (בניגוד ל-`event-edit-policy` שנועל רק event_type/celebrants/venue).

### תרחיש 2 — תיקון/הוספת טלפון לאורח קיים אחרי הפעלה

נתיב: `updateGuest` (`guests.ts:459`, allow-list כולל `phone`) → `syncGuestContact` → `linkGuestContact` (`contacts.ts:117`).

מקרה א' — הטלפון היה **ריק/לא תקין** בזמן ה-hold (לא נוצר contact, לא נכנס לסט): תיקון מאוחר יוצר contact ומקשר, אבל **לא נכנס לסט** → מושמט בשקט (כמו תרחיש 1).

מקרה ב' — הטלפון היה **תקין (A) בסט**, ומשנים ל-**B תקין אחר**:
- `linkGuestContact` (`contacts.ts:159-161`) מזהה repoint ומריץ `pruneOrphanContact` על ה-contact הישן A.
- `pruneOrphanContact` (`contacts.ts:172`) מוחקת את A מ-`contacts` **רק אם** אין guest שמפנה אליו ואין לו היסטוריית חיוב/interactions.
- **אבל היא לא נוגעת ב-`campaign_authorized_contacts`** → השורה `(campaignId, contactId=A)` נשארת בסט המוקפא!
- תוצאה כפולה וקריטית:
  (i) ה-telפון **הנכון B** אינו בסט → **לא מגיע ולא מחויב**.
  (ii) ה-telפון **הישן/המחוק A** עדיין בסט → ב-shליחה `prepareAndSendStep` טוענת contact לפי id → A לא קיים → `skip('contact_missing')`; **אבל בחיוב** `try_record_billed_result` בודקת רק `campaign_authorized_contacts` (קיים) ו-`contacts` ל-`removal_requested` (שורה נמחקה → `v_removed` נשאר NULL/coalesce false) → **מכניסה שורת חיוב על contact מחוק/שגוי**. כלומר: **מחייבים מספר שגוי/יתום, ומפספסים את הנכון.**

זהו **באג שלמות+כסף (P0)** — לא רק בעיית חוויה.

## יחידות ספירה בשכבות

| שכבה | יחידה | מקור |
|---|---|---|
| שורת אורח | אורח (אדם/בית-אב) | `guests` |
| contact | טלפון E.164 ייחודי (כמה אורחים→1) | `contacts`, `deriveContacts` |
| headcount/expected_count | אנשים מגיעים (קייטרינג) | `guests.expected_count` — **לא לחיוב** |
| max_contacts | תקרת כמות = contacts ייחודיים בזמן hold | `campaigns.max_contacts` |
| reached/billed | contact ייחודי שהגיב (UNIQUE(event,contact)) | `billed_results` |
| ceiling | max_contacts × price | `max_charge_ceiling` |

החיוב סופר **contacts**, לא אורחים ולא headcount.

## הרשאה / opt-out / מחיקה / audit (מצב קיים)

- **הרשאה:** `createGuest`/`updateGuest`/`linkGuestContact` → `requireEventAccess('guests', create/edit)` ✓ תקין.
- **opt-out:** `removal_requested` חוסם שליחה עתידית (`terminalReasonFor`, `stepGate`) וחיוב (`try_record_billed_result:48-49`). תקין. **הערה:** הסט המוקפא לא מנוקה בעת הסרה — זה בסדר כי השומר הבודק `removal_requested` חוסם.
- **מחיקת אורח:** `deleteGuest` → אם contact היה בסט והוא היחיד שמפנה אליו → `pruneOrphanContact` מוחקת את ה-contact אבל **משאירה את השורה ב-`campaign_authorized_contacts`** → אותו באג כמו 2ב (חיוב על contact מחוק).
- **audit:** `activity_log` רושם `guest.created/updated`; `billed_results` שומר `provider_ref`/`evidence`. אבל **אין רישום של מי נכנס/יצא מהסט המורשה** — חור במעקב אם עוברים לדינמי.

## פערים וכשלי מוצר

1. **P0 — repoint טלפון בתוך קמפיין פעיל** משאיר contact ישן/מחוק ב-`campaign_authorized_contacts` → חיוב על מספר שגוי + החמצת הנכון. (תרחיש 2ב + מחיקת אורח)
2. **P0 — הוספת אורח/טלפון אחרי הפעלה מושמטת בשקט** בלי שגיאה ובלי סיגנל ב-UI. (תרחיש 1, 2א)
3. **P1 — אין מנגנון "דינמי בתוך תקרה"**: הסט מוקפא קשיחות; אין re-snapshot על שינוי guests; אין UI שמסביר שהרשימה נעולה.
4. **P1 — סיכון ל-shובר של שומר דליפת הכסף** אם פותחים את הסט לגדילה אחרי ה-hold מבלי להגביל ל-`covered`/לתקרה: hold הונמך אל `covered×price`, ואם reached יגדל מעבר ל-covered → חורש תחת ה-hold.
5. **P2 — אין audit על שינויי הסט המורשה**; אין הפרדה ויזואלית ב-UI בין "גודל הסט" / "סה"כ אורחים" / "הגיעו".

## תוכנית תיקון

### P0 (תיקון שלמות — עצור לפני כל החלטה עסקית)

**P0-1 — ריצוי הסט המורשה בעת repoint/מחיקה (קריטי)**

> **⛔ SUPERSEDED (2026-07-12): הכלל `billed-only` להלן שגוי — החלף ב-`exposed-or-billed`.**
> `billed_result` לבדו הוא **מאוחר מדי** (billing/webhooks/provider-callbacks מאחרים; היעדר
> billed_result אינו מוכיח ש-A לא קיבל שירות). הספק המחייב המעודכן:
> [`campaign-recipient-freeze-plan-2026-07-12.md`](./campaign-recipient-freeze-plan-2026-07-12.md) §P0-1
> (BLOCKER). קרא אותו במקום הכלל שלהלן לפני מימוש.

- ב-`linkGuestContact` (`contacts.ts:159`), כש-`prevContactId !== contactId`: אם יש קמפיין פעיל/מאושר על האירוע, יש לרצות את `campaign_authorized_contacts`:
  - ~~הסר את `prevContactId` מהסט **רק אם** אין לו שורת `billed_results` כבר~~ **← החלף:** הסר רק אם `NOT exposed(prevContactId)`; אם exposed → נעוץ (ראה BLOCKER למעלה).
  - הוסף את `contactId` החדש **רק אם** גודל הסט ≤ `max_contacts` של הקמפיין (שומר על התקרה).
- באותו אופן לטפל ב-`deleteGuest` → אם contact הופך יתום ויש קמפיין פעיל, להסירו מהסט (בתנאי לעיל).
- מומלץ: RPC `reconcile_authorized_set(event_id, campaign_id, old_contact, new_contact)` עם הלוגיקה הזו ב-SECURITY DEFINER, נקרא מ-`linkGuestContact`/`deleteGuest`.
- בדיקות (TDD): (א) repoint A→B בקמפיין פעיל: B נכנס לסט, A יוצא, הגודל לא חורג מ-max_contacts. (ב) repoint כש-A כבר ב-billed_results: A נשאר, B לא נכנס (או נכנס רק אם תחת תקרה + נרשם audit). (ג) deleteGuest שהופך contact יתום בקמפיין פעיל: מוסר מהסט.

**P0-2 — סיגנל UI על רשימה נעולה (זמני, עד P1)**
- ב-`guests` page / form: אם קיים קמפיין OPERATIONAL (`hasAnyOperationalCampaign`), הצג באנר: "הקמפיין פעיל — הוספת אורחים/טלפונים לאחר ההפעלה לא תיכלל בשליחה הנוכחית" (או חסום עם הסבר, לפי החלטה עסקית).
- אל תשבור את `createGuest` ללא החלטה (ראה המלצה).

### P1 (החלטה עסקית: דינמי בתוך תקרה)

**P1-1 — re-snapshot על שינוי guests בקמפיין פעיל/מאושר**
- הוסף hook: אחרי `createGuest`/`updateGuest(phone)`/`buildContactsForEvent`/`import`, אם לאירוע קמפיין במצב `approved|scheduled|active|paused` → הרץ `snapshotAuthorizedSet(eventId, campaignId, cap)` עם `cap = min(max_contacts, heldContacts)` כאשר `heldContacts = floor(auth_amount / price)` (כדי לא לחרוג מה-hold). REPLACE semantics שומר על יציבות.
- **חובה:** לוודא ש-`reached ⊆ set ≤ heldContacts ≤ floor(hold/price)` — שומר על שומר דליפת הכסף. אם `reasonable_coverage < full` בהגדרה, תוספות מעבר ל-`covered` דורשות או תוספת hold או בחירת בעלים (Phase 3).
- בדיקות: (א) הוספת אורח אחרי הפעלה → נכנס לסט, משתקף ב-outreach_state בריצת arm הבאה, מחויב כשמגיע. (ב) חריגה מעל `max_contacts` → נחסמת (ceil). (ג) אורח שנמחק → יוצא מהסט.

**P1-2 — UI למעקב**
- באנר דינמי: "נוספו X אורחים חדשים — ייכללו בקמפיין הפעיל (עד התקרה Y)."
- במסך ניהול הקמפיין: הפרדה ויזואלית `סט מורשה / סה"כ אורחים / הגיעו / תקרה`.

### P2 (חיזוק + observability)
- **P2-1 audit:** טבלת `campaign_authorized_set_audit(contact_id, campaign_id, action[in/out], actor, at)` או רישום ב-`activity_log` על כל שינוי סט.
- **P2-2** במסך הסטטיסטיקה: הצגת פער בין "אורחים בסך" לבין "בסט המורשה" כדי שהלקוח יראה מה לא יטופל.
- **P2-3 Phase 3** (כבר ב-TODO של `contacts.ts:341`): כש-`full > extreme_threshold` → בחירת בעלים (cover-all מול cap) + top-up hold.

## המלצה עסקית

**המלצה: לעבור לקהל דינמי בתוך תקרה מאושרת — לא להשאיר רשימת נמענים קפואה קשיחה.**

נימוק:
- הקפאה קשיחה של הנמענים (כיום) פוגעת בערך ללקוח: בעל שמחה רוצה להוסיף אורח או לתקן טלפון אחרי ההפעלה — ומקבל התעלמות שקטה. זה מאבד הכנסה (הוא שילם על כל איש קשר) ופוגע באמון.
- **התקרה הכספית** (`max_charge_ceiling`) היא ההתחייבות האמיתית ויש להשאיר אותה קפואה — זו ההגנה על המערכת ועל הלקוח מפני חיוב יתר.
- ניתן לפתוח את **רשימת הנמענים** לגדילה/קיטון עם רשימת האורחים החיה, **בתוך** `max_contacts` (הכמות שהתקרה מממנת), ובכך:
  - משמרים את שומר דליפת הכסף (`reached ⊆ set ≤ max_contacts ≤ floor(hold/price)`);
  - מספקים ערך מלא ללקוח (אורחים/טלפונים חדשים נכנסים);
  - פותרים את באג P0 (repoint) דרך ריצוי הסט.
- **סייג קריטי:** אם `reasonable_coverage < full` (hold הונמך), תוספות מעבר ל-`covered` דורשות או הרמת hold (top-up) או בחירת בעלים מפורשת (Phase 3) — לא לחרוג מה-hold לעולם.
- **לפני P1:** חובה לסגור P0-1 (ריצוי הסט ב-repoint/מחיקה), אחרת המעבר לדינמי רק יגדיל את שטח הפגיעה של באג החיוב על מספר שגוי.

## סיכום ביצוע (לפי סדר)

1. P0-1: RPC `reconcile_authorized_set` + קריאה מ-`linkGuestContact`/`deleteGuest` + טסטים.
2. P0-2: באנר UI על רשימה נעולה (ביניים).
3. P1-1: hook re-snapshot על שינוי guests + cap ל-`min(max_contacts, heldContacts)` + טסטים.
4. P1-2: באנר דינמי + הפרדה ויזואלית ב-UI.
5. P2-1..3: audit על הסט, פער סטטיסטיקה, Phase 3 expansion.

## קבצים/פונקציות מרכזיים לביצוע

- `src/lib/data/contacts.ts:117` (`linkGuestContact`), `:172` (`pruneOrphanContact`), `:344` (`snapshotAuthorizedSet`)
- `src/lib/data/guests.ts:400` (`createGuest`), `:459` (`updateGuest`), `:511` (`deleteGuest`)
- `src/lib/data/campaigns.ts:502` (`prepareCampaignHold`), `:535` (snapshot), `:722` (`activateCampaign`)
- `src/lib/data/outreach-engine.ts:62` (`seedOutreachState`), `:593` (`prepareAndSendStep`)
- `src/app/(customer)/app/events/[id]/guests/guests-actions.ts:93` (`syncGuestContact`)
- `supabase/migrations/202606290029_billing_set_membership.sql:52` (ה-shומר `not_authorized`)
- `supabase/migrations/202606290028_billing_backhalf.sql:71` (`campaign_billing_summary`)
