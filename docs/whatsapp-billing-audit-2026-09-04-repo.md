# שיוך הודעות WhatsApp נכנסות → חיוב: ראיות מהריפו ותכנון תיקון בטוח (2026-09-04)

> מצב: **קריאה בלבד** — לא שונה קוד, לא שונה DB, לא נשלחה הודעה. הענף: `feat/b2c-entry-routing-event-summary`.
> זהו החלק "ראיות מהריפו + עיצוב" של החקירה שהוגדרה ב-[`whatsapp-billing-audit-goal.md`](./whatsapp-billing-audit-goal.md). הוא **נשען** על שלושת מסמכי הביקורת שכבר נכתבו היום ואינו חוזר עליהם:
> - [`billing-attribution-audit-2026-09-04.md`](./billing-attribution-audit-2026-09-04.md) — להלן **"הביקורת הראשית"** (מפת זרימה §1, טבלת החלטה §2, תוצאות RPC §3, מפתחות §4, סיכונים §5–6, מדיניות מוצעת §8, תוכנית §9, בדיקות §10, שאלות מוצר §11).
> - [`billing-attribution-audit-2026-09-04-db.md`](./billing-attribution-audit-2026-09-04-db.md) — להלן **"מסמך ה-DB"** (הגדרות חיות, אילוצים, grants, מקביליות).
> - [`billing-attribution-audit-2026-09-04-settle.md`](./billing-attribution-audit-2026-09-04-settle.md) — להלן **"מסמך ה-settle"** (נוסחת close-charge, השפעה כספית).
> עובדות על פלטפורמת Meta (שאלות 9–12 של המטרה) נכתבות במקביל ב-`whatsapp-billing-audit-2026-09-04-meta.md` — להלן **"מסמך Meta"**. במסמך זה כל טענה שתלויה בהתנהגות Meta מסומנת **INFERENCE** עם הפניה "ראו מסמך Meta §2.1, §3, §4, §5" עד למיזוג.
>
> **תיוג:** **PROVEN** = מוכח מקוד/DB חי (file:line או SQL + תוצאה); **INFERENCE** = מסקנה מהגדרה, לא נמדדה; **UNVERIFIED** = לא ניתן היה לאמת מכאן; **CONTRADICTED** = סותר טענה קודמת. כל השאילתות הן קריאה בלבד, מצרפיות, ללא PII, ללא payload גולמי. הורצו ב-2026-09-04 (UTC בוקר) דרך `npx --no-install supabase db query --linked --output json`.

---

## 0. תמצית (עמוד אחד)

| # | שאלה | תשובה בשורה | תיוג |
|---|---|---|---|
| Q1 | "היי" חופשי מחייב כשקמפיין+אירוע פעילים? | **כן** — אם לטלפון יש שורת `out` כלשהי (בכל קמפיין, בכל ערוץ) והצמד שנבחר עובר את שומרי ה-RPC. הדבר היחיד שמונע חיוב מחבר-סט שטרם קיבל הודעה הוא דרישת ה-`out` **בקוד הקורא**, לא ב-DB. | PROVEN (קוד) + PROVEN (חי: 0 חברי סט פעילים עם out → היום אין מי שיחויב כך) |
| Q2 | `billable=true` = כסף? | **לא.** סיווג טהור לפי `type`. 59 נכנסות billable ↔ 21 חיובי WhatsApp. | PROVEN |
| Q3 | ההוכחה הסמכותית לחיוב | **שורת `billed_results`** בלבד (כותב יחיד: ה-RPC). `contact_interactions.billing_outcome` הוא עותק לא-סמכותי (טרנזקציה שלישית, 56 NULL היסטוריים). | PROVEN |
| Q4 | אותו טלפון בשני אירועים של שני לקוחות | `resolveInboundContact` אוסף contacts **בלי סינון בעלות/אירוע** ובוחר את ה-`out` האחרון גלובלית. חי: 2 טלפונים ב->1 אירוע, 1 חוצה בעלים. | PROVEN |
| Q5 | הרצה אחת → לקוח אחד? | **כן**, `.limit(1).maybeSingle()`. הודעה אחת לעולם לא מחייבת שני צמדים; **טלפון** אחד יכול לחייב שני אירועים לאורך זמן (שתי הודעות שונות) — לגיטימי. | PROVEN |
| Q6 | retry לאותו wamid יכול להשתייך לקמפיין אחר? | **חלקית — וזה מדויק יותר ממה שנכתב עד כה:** (א) אם השורה ב-`contact_interactions` כבר קיימת: ה-retry **מחשב מחדש** את השיוך, **לא** יכול לחייב (fresh=false), השורה השמורה לא משתנה; **הענף היחיד** שפועל על ה-`resolved` המחושב-מחדש הוא `markContactRemovalRequested` (`:242-244`, לא מגודר ב-`fresh`) — RSVP (`:257`, `fresh && rsvpStatus`) ו-headcount (`:290`, `fresh && !rsvpStatus`) לעולם לא רצים ב-retry. (ב) אם הניסיון הראשון נכשל **לפני** ה-insert: ה-retry הוא הראשון שכותב ומחייב — לפי מצב ה-DB **ברגע ה-retry**. חי: 3/29 שורות-טלפון היו מקבלות היום contact שונה מהשמור; 0 retries עם אינטראקציה בפועל. | PROVEN (קוד) + PROVEN (חי) |
| Q7 | UNIQUE גלובלי שמונע מ-wamid אחד לחייב שני קמפיינים? | **ב-DB — אין.** `billed_results` ייחודי רק ב-`(event_id, contact_id)`. ההבטחה היא `contact_interactions UNIQUE (channel, provider_id)` + שער `fresh` בקוד. | PROVEN |
| Q8 | `metadata.phone_number_id` נשמר ומשמש לשיוך? | **נשמר** (route.ts:158,192,211), **לא נקרא** באף מודול עיבוד. חי: 7 הודעות למספר הייבוא → 6 יצרו אינטראקציה, נותבו זהה. | PROVEN |

**שורש הבעיה (מאושר):** `src/lib/data/interactions.ts:87-94` — "ה-`out` האחרון לטלפון מנצח", בלי תיחום לקמפיין פעיל, לחלון זמן, לחברות בסט, למספר העסקי שקיבל את ההודעה, ובלי הבחנה בין מועמד יחיד לריבוי מועמדים. ה-RPC (`try_record_billed_result`) בודק **האם מותר** לחייב את הצמד שהוזן, לא **האם זה הצמד הנכון**.

### 0.1 טבלת סיכונים (לפי חומרה; פירוט המנגנונים בביקורת הראשית §5–6)

| # | סיכון | מנגנון | חשיפה חיה היום | סעיף |
|---|---|---|---|---|
| R1 | **לקוח לא-נכון מחויב** על תשובה מוקלדת/reaction | "ה-out האחרון לטלפון" חוצה אירועים ובעלים; ה-RPC בודק חברות בסט, לא נכונות | 1 טלפון חוצה בעלים; 0 חברי סט פעילים עם out — כלומר 0 כרגע, אך ללא הגנה | Q4, Q1 |
| R2 | **חיוב תקין אובד לצמיתות** | כשל בין `insertInteraction` ל-RPC → `fresh=false` לנצח; או "סגור-מעל-פעיל" → `not_active` | 0 מקרים מזוהים; `max(attempts)=3` על שורה לא-billable | Q6(א), ביקורת ראשית §6.1–6.2 |
| R3 | **הסרה ב-retry מסומנת על contact אחר מזה שחויב** | `markContactRemovalRequested(resolved.contactId)` רץ על שיוך מחושב-מחדש, מחוץ ל-`fresh` (`webhook-processing.ts:242-244`) | 3/29 שורות-טלפון היו מקבלות היום contact אחר; 0 retries בפועל | Q6 |
| R4 | **retry לפני ה-insert מחליט לפי מצב מאוחר** | ההחלטה מוקפאת ב-insert הראשון, לא בקבלה; Meta מתעדת retries עד 7 ימים ובלי סדר (מסמך Meta §6, DOCUMENTED) | לא נצפה; אין רישום "מה נבחר בקבלה" | Q6(ב) |
| R5 | **"היי" מחבר-סט שטרם קיבל הודעה** יחויב אם אי-פעם תהיה לו שורת `out` כלשהי (גם מקמפיין אחר/שיחה) | הדרישה ל-out היא בקורא, לא ב-DB; אין חלון זמן, אין תיחום לקמפיין | 1 חבר כזה בקמפיין פעיל (ללא out) | Q1 |
| R6 | **אין UNIQUE ב-DB על `provider_ref`** | מסלול עוקף/override עתידי יכול לחייב אותו wamid פעמיים | 0 כפילויות | Q7 |
| R7 | **הודעה למספר הייבוא משויכת לקמפיין** | `phone_number_id` לא נקרא | 6/7 הודעות למספר השני יצרו אינטראקציה | Q8 |
| R8 | **`from` עלול להיעדר** תחת BSUID/usernames → מסלול הטלפון נכשל בשקט | `payload.from ? … : null` (`webhook-processing.ts:198`); ל-`contacts` אין עמודת BSUID | 3/86 בלי `from`; 9 עם `user_id` | §2.3, מסמך Meta §2.2 |
| R9 | **ניראות**: `billable` בלי `billing_outcome`; unmatched בלי שום רישום | הביקורת הראשית §3 | 56 NULL היסטוריים | Q2 |

**ההחלטות העיצוביות של מסמך זה (§3):**
- לדג'ר חדש `inbound_attributions` עם מפתח **`UNIQUE (provider, phone_number_id, inbound_message_id)`** (הווריאנט השמרני; נכון תחת שתי הסמנטיקות האפשריות של wamid — ראו §3.6.2).
- **כן** להוסיף `UNIQUE (channel, provider_ref) WHERE provider_ref IS NOT NULL` על `billed_results`, עם טיפול ב-`unique_violation` בתוך ה-RPC (§3.6.3).
- **נדרש RPC חדש** `record_inbound_attribution(...)` כדי שהחלטת השיוך והחיוב יתחייבו **בטרנזקציה אחת** — PostgREST אינו מאפשר טרנזקציה רב-הצהרתית מהקוד (§3.7–3.8).
- `try_record_billed_result` נשאר קו ההגנה האחרון, עם שינוי אחד קטן (טיפול בחריגה של האינדקס החדש).

---

## 1. תשובות Q1–Q8 עם ראיות

### Q1 — האם "היי" חופשי יכול לחייב כשהקמפיין והאירוע פעילים?

**תשובה: כן. PROVEN (קוד). חי: כרגע אין אף contact במצב שיאפשר זאת, אבל המנגנון לא מגן.**

מסלול הביצוע (כל שלב מצוטט):

| # | שלב | קוד | מה קורה ל-"היי" |
|---|---|---|---|
| 1 | קליטה: `type:'text'` נשמר כשורת inbox עם `message_id`, `context_message_id=null` (אין ציטוט), `phone_number_id` | `src/app/api/webhooks/whatsapp/route.ts:183-199` (שורות 189-192) | שורה אחת, `dedupe_key='wa-msg:<wamid>'` |
| 2 | סיווג: `billable ⇔ type ∈ {text, button, interactive, reaction}` | `src/lib/whatsapp/inbound.ts:11-16` (`BILLABLE_MESSAGE_TYPES`), `:100-102`, `:115` | `billable=true`, `removal=false`, `replyId=null` |
| 3 | `processMessage`: `if (!billable) return` — עובר | `src/lib/data/webhook-processing.ts:192-193` | ממשיך |
| 4 | שיוך: `contextId` ריק → `resolveByContextId` **לא** נקרא; `payload.from` קיים → `resolveInboundContact(from)` | `webhook-processing.ts:195-198` | מסלול טלפון |
| 5 | `resolveInboundContact`: כל ה-`contacts` עם `normalized_phone` זהה (בלי `event_id`, בלי `owner`), ואז שורת `out` **האחרונה** ביניהם (בלי סינון `channel`/`campaign.status`/זמן) | `src/lib/data/interactions.ts:79-82` (contacts), `:87-94` (`.in('contact_id', ids).eq('direction','out').order('created_at',{ascending:false}).limit(1)`) | אם קיימת שורת `out` כלשהי → צמד `(event, campaign, contact)` שלה; אחרת `null` (`:96-98`) → `return` שקט (`webhook-processing.ts:199`) |
| 6 | `insertInteraction(direction='in', billable=true, provider_id=wamid)` → `fresh` | `webhook-processing.ts:203-213`; `interactions.ts:37-46` | שורה חדשה → `fresh=true` |
| 7 | `recordReached` → RPC `try_record_billed_result(event, campaign, contact, 'whatsapp', attempt=wamid, evidence='whatsapp_inbound_message', provider_ref=wamid)` | `webhook-processing.ts:215-226`; `src/lib/data/billing.ts:32-49` | תלוי בשומרי ה-RPC |
| 8 | שומרי ה-RPC (הגוף החי, מסמך ה-DB §3.1): `no_campaign` → `event_mismatch` → `not_active` (status ∉ active/paused) → `before_window` → `closed_window` → `event_passed` → `event_not_active` → `removal_requested` → gate OFF: **חברות ב-`campaign_authorized_contacts`** (`not_authorized`) → `ceiling_reached` → `ON CONFLICT (event_id, contact_id)` (`already_billed`) → **`billed`** | מסמך ה-DB §3.1 שורות 100-155 של הפונקציה | **אף שומר אינו בודק שההודעה היא תגובה לקמפיין הזה** |

**מה בפועל חוסם "היי" מחבר-סט שטרם קיבל הודעה:** רק שלב 5 (`interactions.ts:87-98` דורש שורת `out`). ל-RPC אין שומר מקביל תחת gate OFF (הביקורת הראשית §1.6, §5.7). תחת gate ON, `exposed_for_billing` **טאוטולוגי** ל-WhatsApp (מסמך ה-DB "הפתעה 4") — כלומר גם אז לא יחסום.

**בדיקה חיה (2026-09-04) — מי היה עובר את השומרים היום:**

```sql
select k.status camp_status, e.status ev_status,
       (now() at time zone 'Asia/Jerusalem')::date > (e.event_date at time zone 'Asia/Jerusalem')::date ev_passed,
       k.close_at < now() closed_window,
       (select count(*) from campaign_authorized_contacts a where a.campaign_id=k.id) set_size,
       (select count(*) from campaign_authorized_contacts a where a.campaign_id=k.id
          and exists (select 1 from contact_interactions o where o.direction='out' and o.contact_id=a.contact_id)) members_with_any_out,
       (select count(*) from campaign_authorized_contacts a join contacts c on c.id=a.contact_id
          where a.campaign_id=k.id and c.removal_requested) members_removed,
       (select count(*) from contact_interactions o where o.direction='out' and o.campaign_id=k.id) outbound_rows
from campaigns k join events e on e.id=k.event_id
where k.status in ('active','paused','approved');
```

| camp_status | ev_status | ev_passed | closed_window | set_size | members_with_any_out | members_removed | outbound_rows |
|---|---|---|---|---|---|---|---|
| active | active | false | false | **1** | **0** | 0 | 0 |
| active | active | false | false | 0 | 0 | 0 | 0 |
| approved | active | false | false | 0 | 0 | 0 | 0 |

קריאה: לחבר היחיד בסט של קמפיין פעיל, שומרים 1–9 של ה-RPC **עוברים** (קמפיין active, אירוע active, לא עבר, חלון פתוח, לא הוסר, חבר בסט) והתקרה היא 200 (מסמך ה-DB §6 ש6) — כלומר ה-RPC **היה מחזיר `billed`** על "היי" שלו. מה שמונע זאת היום הוא שאין לו שום שורת `out`, ולכן שלב 5 מחזיר `null`. **תיקון להנחיית המשימה:** אין "חבר סט פעיל עם out קודם" — לחבר היחיד **אין** out (תואם הביקורת הראשית §1.6, §1.8 שורה "חברי סט בקמפיין פעיל ללא אף הודעה יוצאת: 1 (מתוך 1)").

**סינון בעלים/צוות:** אין. `webhook-processing.ts` אינו קורא `profiles`; הסינון היחיד של שולח-בעלים הוא בקיצור-דרך הייבוא ורק ל-`document`/`contacts` (הביקורת הראשית §5.3). PROVEN.

### Q2 — `billable=true`: כסף או סיווג?

**תשובה: סיווג בלבד. PROVEN.**

- הקוד: `classifyMessagePayload` הוא **מסווג טהור ללא I/O** (`inbound.ts:1`, `:110-119`): `billable = isBillableMessageType(message.type)`. אין בו קריאה ל-DB, לקמפיין או ל-RPC.
- העמודה `contact_interactions.billable` נכתבת קבוע `true` על כל נכנסת ששויכה (`webhook-processing.ts:212`) — **לפני** קריאת ה-RPC (`:215`).
- ה-DB אומר זאת במפורש: הערת העמודה `billing_outcome` — *"billable=true is the classification; this is what actually happened"* (`supabase/migrations/20260903214126_webhook_deliveries_and_outcomes.sql:91-92`).
- המספרים (חי, מסמך ה-DB §6 ש5 + אימות חוזר היום): נכנסות WhatsApp `billable=true` = **59**; שורות `billed_results` ערוץ whatsapp = **21** (סה"כ 22 עם שיחה אחת). 38 השורות שנותרו הן `already_billed` (36 חוזרות על צמד שכבר חויב), `not_active` (3 עם `billing_outcome` מפורש) או NULL היסטורי.
- `billing_outcome` (מאז 3.9) הוא הרישום של "מה ה-RPC החליט" — ורק 3 שורות חיות נושאות אותו; 56 NULL. לכן **`billable=true` לבדו אינו אומר דבר על כסף**.

### Q3 — ההוכחה הסמכותית שחיוב קרה

**תשובה: שורת `public.billed_results`. PROVEN.**

- **כותב יחיד:** ה-RPC `try_record_billed_result` (`billing.ts:8-10` — "All billing writes go through the RPC … never in JS"; מסמך ה-DB §3 — אין `insert` אחר במיגרציות או בקוד; מסמך ה-settle §1.1).
- **העמודות ומה שהקוד מכניס אליהן** (ערוץ WhatsApp, `webhook-processing.ts:216-226` → RPC שורות 151-152):

| עמודה | ערך בערוץ WhatsApp | מקור |
|---|---|---|
| `provider_ref` | ה-wamid **הנכנס** (`messageId`) | `webhook-processing.ts:225` |
| `attempt_id` | אותו wamid | `:221` |
| `evidence_source` | `'whatsapp_inbound_message'` או `'whatsapp_inbound_removal'` | `:222-224` |
| `locked_price` | `campaigns.price_per_reached` **ברגע ההכנסה** (נקרא תחת `FOR UPDATE`) | RPC שורות 98-100, 151-152 |
| `channel` | `'whatsapp'` | `:220` |
| `event_id` | נלקח **מהקמפיין**, לא מהקורא (`v_event_id`) | RPC שורות 98-102, 151-152 |

- **חי (היום):** 22 שורות; ל-**22/22** יש אינטראקציה נכנסת תואמת ב-`(channel, provider_ref) = (channel, provider_id)`; `provider_ref` לעולם לא NULL; `attempt_id = provider_ref` בכולן; אין `provider_ref` כפול.

```sql
select count(*) billed,
       count(*) filter (where exists (select 1 from contact_interactions ci
         where ci.channel=b.channel and ci.direction='in' and ci.provider_id=b.provider_ref)) with_matching_inbound,
       count(*) filter (where provider_ref is null) null_ref,
       (select count(*) from (select provider_ref from billed_results group by 1 having count(*)>1) d) dup_refs,
       count(*) filter (where attempt_id is distinct from provider_ref) attempt_ne_ref
from billed_results b;
-- → billed 22 | with_matching_inbound 22 | null_ref 0 | dup_refs 0 | attempt_ne_ref 0
```

- **איך שואלים על wamid אחד** (זו בדיוק השאילתה של האינספקטור, `src/lib/data/admin/webhook-inbox.ts:146-151`):

```sql
select id, event_id, campaign_id, contact_id, channel, evidence_source, locked_price, reached_at, control_status
from public.billed_results
where channel = 'whatsapp' and provider_ref = $1;   -- $1 = messages[].id
```

אין אינדקס על `provider_ref` (חי: רק `pkey`, `event_contact_unique`, `campaign_idx`) — סריקה מלאה; זניח ב-22 שורות, אבל האינדקס החלקי המוצע ב-§3.6.3 סוגר גם את זה.

- **מה אינו סמכותי:** `contact_interactions.billing_outcome='billed'` נכתב בטרנזקציה **שלישית** (`webhook-processing.ts:229-235`) אחרי ה-RPC; קריסה ביניהן משאירה חיוב בלי outcome. הביקורת הראשית §3 "פערי נראות" 3.

### Q4 — אותו טלפון מנורמל ב-contacts של שני אירועים של שני לקוחות

**תשובה: הקוד בוחר את "השולח האחרון" גלובלית, בלי כל סינון בעלות. PROVEN (קוד + חי).**

הליכה שורה-שורה ב-`src/lib/data/interactions.ts`:

| שורות | קוד | משמעות במקרה שני-לקוחות |
|---|---|---|
| 75-76 | `const e164 = normalizePhone(fromPhone); if (!e164) return null;` | נרמול בלבד |
| 79-82 | `.from('contacts').select('id').eq('normalized_phone', e164)` | **מחזיר את שני ה-contacts** (אחד לכל אירוע), אין `.eq('event_id')`, אין join ל-`events.owner_id` |
| 84-85 | `ids = [...]; if (ids.length === 0) return null;` | שני ids |
| 87-94 | `.from('contact_interactions').select(...).in('contact_id', ids).eq('direction','out').order('created_at', {ascending:false}).limit(1).maybeSingle()` | ה-`out` **האחרון בזמן** בין שני הלקוחות מנצח — כולל `call_dialed` (אין `.eq('channel')`), כולל קמפיין סגור (אין join ל-`campaigns.status`), כולל out מלפני חודשים (אין גבול זמן) |
| 96-103 | מחזיר `(event, campaign, contact)` של אותה שורה | הלקוח ששלח אחרון מקבל את ההגעה — נכון או לא |

מה קורה אחר כך: `insertInteraction` נרשם על הצמד שנבחר (`webhook-processing.ts:203-213`); ה-RPC מאשר אם הצמד חבר בסט של **אותו** קמפיין ושאר השומרים עוברים; `billed_results UNIQUE (event_id, contact_id)` **לא** מונע זאת (contact-א' ו-contact-ב' הם שתי רשומות שונות). ההשפעה הכספית והתפעולית (עצירת drip ללקוח הלא-נכון, RSVP לאירוע הלא-נכון) — מסמך ה-settle §4.

**חי (אומת שוב היום):**

```sql
with me as (select normalized_phone from contacts group by 1 having count(distinct event_id)>1),
     mo as (select c.normalized_phone from contacts c join events e on e.id=c.event_id group by 1 having count(distinct e.owner_id)>1),
     moc as (select c.normalized_phone from contact_interactions o join contacts c on c.id=o.contact_id where o.direction='out' group by 1 having count(distinct o.campaign_id)>1)
select (select count(*) from me) phones_gt1_event, (select count(*) from mo) phones_gt1_owner,
       (select count(*) from moc) phones_out_gt1_campaign,
       (select count(*) from contacts) contacts, (select count(distinct normalized_phone) from contacts) distinct_phones;
-- → 2 | 1 | 1 | 43 | 41
```

כלומר: 2 טלפונים ביותר מאירוע אחד, 1 מהם אצל שני בעלים שונים, 1 טלפון קיבל out משני קמפיינים. 0 טלפונים במצב "ה-out האחרון מקמפיין סגור בעוד ישן יותר מקמפיין פעיל" (הביקורת הראשית §6.1). אף אחד מהם אינו כרגע בסט של קמפיין פעיל (Q1 לעיל: `members_with_any_out=0`).

### Q5 — הרצה אחת בוחרת לקוח אחד, או יכולה לחייב יותר?

**תשובה: הרצה אחת = לכל היותר צמד אחד = לקוח אחד. PROVEN.**

- `resolveInboundContact` מחזיר אובייקט יחיד או `null`: `.limit(1).maybeSingle()` (`interactions.ts:93-94`); `resolveByContextId` זהה (`:122-123`).
- `processMessage` קורא ל-`recordReached` **פעם אחת**, בתוך `if (fresh)` (`webhook-processing.ts:215-226`); אין לולאה על מועמדים.
- ה-`??` ב-`:196-198` הוא short-circuit: אם context הצליח, מסלול הטלפון לא רץ בכלל.

**מעבר להרצה אחת — ניסוח מדויק:**
- **אותה הודעה (אותו wamid) לעולם לא תחייב שני צמדים:** `contact_interactions UNIQUE (channel, provider_id)` (חי) הופך את ה-insert השני ל-no-op → `fresh=false` → RPC לא נקרא (Q7 להלן).
- **אותו טלפון כן יכול לחייב שני אירועים לאורך זמן, בשתי הודעות שונות:** `billed_results UNIQUE (event_id, contact_id)` הוא לכל אירוע. תרחיש: הודעה 1 משויכת לאירוע X (חויב), הודעה 2 — אחרי ש-Y שלח — משויכת ל-Y (חויב). זה **לגיטימי עסקית** אם האורח באמת הגיב לשני האירועים; הבעיה היא רק שהשיוך של כל הודעה בנפרד הוא ניחוש. הביקורת הראשית §4 שורה "חיוב".
- **אותו contact לא יחויב פעמיים באותו אירוע** גם משני קמפיינים (ביטול+הקמה) וגם משני ערוצים — `already_billed` (הביקורת הראשית §6.8).

### Q6 — retry של אותו wamid: יכול להשתייך לקמפיין אחר אם נוצרו outs חדשים בינתיים?

**תשובה: תלוי מה הספיק להיכתב לפני הכשל. PROVEN (קוד) + PROVEN (חי: אוכלוסייה ריקה).**

**מקורות ה-retry (כולם מריצים את `processMessage` מחדש במלואו):**

| מקור | מנגנון | קוד |
|---|---|---|
| A. כשל בעיבוד שורה ב-worker | `catch` לכל שורה → `markWebhookEventFailed(row.id, attempts+1, message)`; השורה נשארת `processed_at IS NULL` ותיטען שוב ב-drain הבא כל עוד `attempts < 5` | `worker/main.ts:487-507` (catch ב-`:493-505`); `src/lib/data/webhooks.ts:102-113`; RPC `claim_webhook_events` (`attempts < 5`, מסמך ה-DB §3.4) |
| B. "עיבוד מחדש" מהאדמין | `update webhook_inbox set processed_at=null, last_error=null, attempts=0` — גם על שורה שכבר עובדה בהצלחה | `src/app/(admin)/admin/webhooks/actions.ts:17-43` (`:28-31`) |
| C. retry של pg-boss על ה-job | `guardedWorker` זורק מחדש (`worker/main.ts:280-298`, `:295`); תור `webhook-process`: `policy='standard', retry_limit=2, retry_delay=0` (חי, `pgboss.queue`). רלוונטי רק אם `handleWebhook` נכשל **מחוץ** ל-try הפנימי (כשל ב-claim) — ואז זו פשוט הרצה נוספת של אותו claim | `worker/main.ts:922-927`, `:1115` |
| D. משלוח חוזר של Meta | **לא** retry של עיבוד: `UNIQUE (provider, dedupe_key)` + `ignoreDuplicates` → אין שורת inbox שנייה | `webhooks.ts:22-31`; חי: `webhook_inbox_provider_dedupe_key_key` |

**מה `processMessage` עושה ב-retry (A/B), שורה-שורה:**

| שורות | פעולה | ב-retry |
|---|---|---|
| 190 | `stageWhatsAppImport(row)` | אידמפוטנטי לפי `source_message_id` (`whatsapp-import.ts:322-334`) |
| 192-193 | סיווג | דטרמיניסטי |
| 195-198 | **שיוך מחושב מחדש** — `resolveByContextId` / `resolveInboundContact` רצים שוב מול ה-DB **הנוכחי** | אם נוצר בינתיים `out` חדש לאחד ה-contacts של הטלפון → מסלול הטלפון מחזיר צמד **אחר**. מסלול ה-context דטרמיניסטי (provider_id של out ייחודי) ולכן יציב |
| 203-213 | `insertInteraction` עם הצמד **החדש** | `ON CONFLICT (channel, provider_id) DO NOTHING` → אם השורה קיימת: **לא נכתב דבר**, השורה השמורה שומרת את הצמד **הראשון**, `fresh=false` |
| 215-236 | RPC + `billing_outcome` | **מדולג** (`if (fresh)`) — לא יכול לחייב את הצמד החדש |
| 242-244 | `if (removal) markContactRemovalRequested(resolved.contactId)` | **רץ בכל מקרה** (הערת D4 — "Runs even on a deduped re-process") — על `resolved.contactId` **החדש**, לא על `contact_id` השמור בשורה |
| 256-285, 290-295 | RSVP / headcount | מגודרים ב-`fresh` → מדולגים |

**במדויק — מי משתמש ב-`resolved` ב-retry (PROVEN, `webhook-processing.ts`):**
- `:242-244` — `if (removal) await markContactRemovalRequested(resolved.contactId)` — **לא** מגודר ב-`fresh`; ההערה ב-`:238-241` אומרת במפורש "Runs even on a deduped re-process". **זה הענף היחיד** שיכול לפעול על contact שונה מזה שהאינטראקציה (והחיוב) שמורים עליו.
- `:257` — `if (fresh && rsvpStatus)` — RSVP **מגודר**; לא רץ ב-retry.
- `:290` — `if (fresh && !rsvpStatus)` — headcount **מגודר**; לא רץ ב-retry.
- `:215` — `if (fresh)` — RPC ו-`billing_outcome` **מגודרים**.

לכן שני המקרים:

**(א) הניסיון הראשון הספיק לכתוב את האינטראקציה** (רוב המקרים; כשל אחרי `:213`): ה-retry **אינו יכול לחייב** צמד אחר, **אינו משנה** את השיוך השמור, **אינו** רושם RSVP/headcount — **אבל אם ההודעה היא הסרה, `removal_requested=true` נכתב על contact אחר** מזה שהאינטראקציה שמורה עליו (ואולי של לקוח אחר). זהו הסיכון הממשי של "שיוך מחדש ב-retry" היום (R3). בנוסף, הביקורת הראשית §6.2: אם הכשל היה **בין** ה-insert ל-RPC — החיוב אבד לצמיתות.

**(ב) הניסיון הראשון נכשל לפני `:203`** (למשל `resolveInboundContact` זרק על תקלת DB — `interactions.ts:83`, `:95`): כלום לא נכתב. ה-retry הוא **הראשון** שכותב ומחייב, לפי מצב ה-DB **ברגע ה-retry** — כלומר **כן**, הודעה יכולה להתחייב לקמפיין שונה ממה שהיה נבחר ברגע הקבלה. אין רישום של "מה היה נבחר ברגע הקבלה" בשום מקום. **ההחלטה אינה מוקפאת בזמן הקבלה אלא בזמן ה-insert המוצלח הראשון.**

**מה Meta מתעדת שמחזק את זה (מסמך Meta §6, DOCUMENTED):** retries "with decreasing frequency for up to 7 days", כפילויות כתוצאה מהם, batching לא מובטח, ו-"webhook ordering is not guaranteed". ההשלכות כאן: (1) משלוח חוזר של Meta ימים אחרי המקור פוגע ב-`UNIQUE (provider, dedupe_key)` ולא מייצר עיבוד (מקור D) — טוב; (2) אי-סדר **אינו** משפיע על מסלול ה-context, כי שורת ה-`out` נכתבת **מתשובת ה-send** (`outreach.ts:90-108`, `provider_id = messages[0].id`), לא מה-webhook של הסטטוס — תשובה שמגיעה לפני סטטוס `sent` עדיין מוצאת את ה-out; (3) אי-סדר **כן** משפיע על מסלול הטלפון ("האחרון") — ועוד סיבה שההחלטה חייבת להיות immutable מהכתיבה הראשונה (§3.8).

**חי:**

```sql
-- כמה שורות message עברו retry, ולכמה מהן יש אינטראקציה נכנסת (= אוכלוסיית ההשוואה)
select count(*) filter (where attempts>0) retried_msg_rows, max(attempts) max_attempts,
       count(*) filter (where attempts>=5) dead_letter,
       count(*) filter (where attempts>0 and exists (select 1 from contact_interactions ci
         where ci.channel='whatsapp' and ci.direction='in' and ci.provider_id=webhook_inbox.message_id)) retried_with_inbound_interaction
from webhook_inbox where provider='whatsapp' and event_kind='message';
-- → retried_msg_rows 1 | max_attempts 3 | dead_letter 0 | retried_with_inbound_interaction 0
-- השורה היחידה: type='contacts' (ייבוא, לא billable), עובדה בסוף. לכן אין אף retry חי להשוואה → החלק "שיוך שונה ב-retry בפועל" = UNVERIFIED (אוכלוסייה ריקה), לא "לא קרה מעולם".
```

```sql
-- מדד החשיפה: לכמה נכנסות שמורות היה מסלול-הטלפון מחזיר *היום* צמד שונה מהשמור
with inb as (select ci.id, ci.event_id, ci.campaign_id, ci.contact_id, ci.context_message_id is not null via_ctx, c.normalized_phone
             from contact_interactions ci join contacts c on c.id=ci.contact_id
             where ci.channel='whatsapp' and ci.direction='in' and ci.billable),
cur as (select i.id, (select row(o.event_id,o.campaign_id,o.contact_id) from contact_interactions o
                      where o.direction='out' and o.contact_id in (select id from contacts c2 where c2.normalized_phone=i.normalized_phone)
                      order by o.created_at desc limit 1) now_pick from inb i)
select i.via_ctx, count(*) n,
       count(*) filter (where cur.now_pick = row(i.event_id,i.campaign_id,i.contact_id)) same_as_stored,
       count(*) filter (where cur.now_pick <> row(i.event_id,i.campaign_id,i.contact_id)) differs_from_stored
from inb i join cur on cur.id=i.id group by 1;
-- → via_ctx=false: n 29 | same 26 | differs 3
-- → via_ctx=true : n 30 | same 25 | differs 5   (ל-30 אלה ה-retry היה עדיין נפתר דרך context, לכן החשיפה האפקטיבית היא 3)
```

קריאה: ל-3 מתוך 29 הודעות שנפתרו דרך טלפון, "עיבוד מחדש" מהאדמין **היום** היה מחשב contact שונה מזה שהאינטראקציה שמורה עליו; אילו נשאו "הסר", ההסרה הייתה נכתבת על ה-contact הלא-נכון. זו הוכחה שההחלטה תלוית-זמן.

### Q7 — האם קיים UNIQUE גלובלי שמונע מ-`messages[].id` אחד לחייב שני קמפיינים?

**תשובה: ב-DB — לא. ההבטחה היא שילוב של אילוץ על טבלה אחרת ושער בקוד. PROVEN.**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.billed_results'::regclass;
-- billed_results_contact_id_fkey  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT
-- billed_results_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT
-- billed_results_event_id_fkey    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT
-- billed_results_event_contact_unique UNIQUE (event_id, contact_id)
-- billed_results_pkey PRIMARY KEY (id)
select indexname from pg_indexes where tablename='billed_results';
-- billed_results_campaign_idx, billed_results_event_contact_unique, billed_results_pkey
```

| שכבה | מה מובטח | מי מבטיח | תיוג |
|---|---|---|---|
| **DB** | `billed_results`: אותו `(event_id, contact_id)` פעם אחת | `billed_results_event_contact_unique` + `ON CONFLICT … DO NOTHING` ב-RPC | PROVEN |
| **DB** | `contact_interactions`: אותו `(channel, provider_id)` פעם אחת → שורת inbound אחת לכל wamid | `contact_interactions_provider_unique` | PROVEN |
| **קוד** | ה-RPC נקרא רק כשה-insert הזה הצליח עכשיו | `fresh` — `insertInteraction` מחזיר `data !== null` (`interactions.ts:45`) ו-`processMessage` בודק `if (fresh)` (`webhook-processing.ts:215`) | PROVEN |
| **DB** | אין שום דבר שמונע שתי שורות `billed_results` עם אותו `provider_ref` בשני `event_id` שונים | — | PROVEN (חסר) |

**הפער המדויק:** אם מסלול כלשהו (עתידי, ידני, migration/backfill, או באג בקורא השני `writeReach`) יקרא ל-`try_record_billed_result` פעמיים עם אותו `provider_ref` אך צמדים שונים — ה-DB יקבל את שתיהן. היום יש שני קוראים בלבד (`webhook-processing.ts:216`, `outreach-engine.ts:477` דרך `call-result-processing.ts:110-122`), ומסלול השיחות משתמש ב-`provider_ref = attemptId` (מרחב מזהים אחר). מסלול השיחות **אינו** מגודר ב-`fresh` בכוונה (`call-result-processing.ts:88-94`) — הוא נשען על `(event, contact)` בלבד; ל-WhatsApp אין מקבילה כזו כי שם הצמד עצמו הוא הניחוש. סגירה: §3.6.3.

### Q8 — `metadata.phone_number_id` נשמר? משמש לשיוך?

**תשובה: נשמר בכל שורה; לא משמש לשיוך ולא לניתוב. PROVEN (קוד + חי).**

- **נשמר:** `const phoneNumberId = value.metadata?.phone_number_id ?? null` (`route.ts:158`) → `phone_number_id: phoneNumberId` בשורות `message` (`:192`) ו-`status` (`:211`) וגם בשדות אחרים (`:137`).
- **לא נקרא בעיבוד:** `grep -rn "phone_number_id\|phoneNumberId" src worker` — אפס מופעים ב-`webhook-processing.ts`, `interactions.ts`, `billing.ts`, `whatsapp-import.ts` (שם `phoneNumberId` הוא פרמטר **השליחה**, `:396`). הקוראים היחידים של `webhook_inbox.phone_number_id`: תצוגה (`webhook-detail.tsx:169-177`), תווית "מספר ה-RSVP" (`admin/webhook-inbox.ts:183-187` — משווה ל-`app_settings.whatsapp_phone_number_id`), וחיפוש (`admin/webhook-inbox.ts:289`, `page.tsx:157`).
- **חי — הודעות למספר הייבוא נותבו זהה:**

```sql
select case when w.phone_number_id = s.whatsapp_phone_number_id then 'rsvp_number'
            when w.phone_number_id='123456123' then 'sandbox' else 'other_number' end bucket,
       count(*) n,
       count(*) filter (where exists (select 1 from contact_interactions ci where ci.channel='whatsapp' and ci.direction='in' and ci.provider_id=w.message_id)) with_inbound_interaction,
       count(*) filter (where exists (select 1 from billed_results b where b.provider_ref=w.message_id)) billed
from webhook_inbox w cross join (select whatsapp_phone_number_id from app_settings limit 1) s
where w.provider='whatsapp' and w.event_kind='message' group by 1;
-- rsvp_number  74 | 53 | 21
-- other_number  7 |  6 |  0
-- sandbox       5 |  0 |  0
```

7 הודעות הגיעו למספר השני (מספר הייבוא לפי `docs/whatsapp-import-number-split-plan-2026-09-03.md` §1.1); **6 מהן יצרו אינטראקציה נכנסת** על קמפיין — כלומר שויכו לפי context/טלפון בדיוק כמו הודעה למספר ה-RSVP; אף אחת לא חויבה (קמפיינים סגורים). אין `phone_number_id` NULL באף שורת `message`. תוכנית פיצול המספר (`§3.1` שם) מוסיפה ניתוב לפי `phone_number_id` **לפני** `processMessage` — העיצוב ב-§3 כאן משתלב בה (מספר לא-RSVP → `unresolved('unknown_business_number')`).

---

## 2. הערכת היררכיית השיוך המבוקשת (1–6) מול הקוד

### 2.1 שלב 1 — `context.id → contact_interactions.provider_id` של out

**קיים.** `resolveByContextId` (`interactions.ts:112-133`). שלושה ליקויים קטנים לתיקון בגרסה החדשה: (א) אין `.eq('channel','whatsapp')` — ולכן אינו יכול להשתמש באינדקס הייחודי `(channel, provider_id)` ותיאורטית יתאים ל-provider_id של ערוץ אחר (מסמך ה-DB §6 ש5); (ב) אינו בודק שה-out הוא של `sendOneWhatsApp` — אבל רק הוא כותב outs ל-WhatsApp (`outreach.ts:90-108`), אז בפועל תקין; (ג) ה-out **חייב** להיות מתועד — הודעות שנשלחו ב-`sendWhatsAppText` (headcount, תשובות ייבוא) אינן מתועדות (הביקורת הראשית O7), ולכן ציטוט שלהן נופל לשלב 3.

**חי:** 33 שורות inbox עם `context_message_id`; 30 תואמות out שלנו; **30/30 האינטראקציות השמורות עם context שוות בדיוק לצמד של ה-out המצוטט** (PROVEN — חיזוק לטענת מסמך ה-DB §6 ש10 שהתבססה רק על `context_message_id IS NOT NULL`):

```sql
select count(*) n, count(*) filter (where o.id is not null) ctx_outbound_exists,
       count(*) filter (where (o.event_id,o.campaign_id,o.contact_id)=(ci.event_id,ci.campaign_id,ci.contact_id)) stored_equals_ctx_binding
from contact_interactions ci left join contact_interactions o on o.direction='out' and o.provider_id=ci.context_message_id
where ci.channel='whatsapp' and ci.direction='in' and ci.billable and ci.context_message_id is not null;
-- → 30 | 30 | 30
```

**reactions:** 2 בתיבה, שתיהן שויכו דרך **טלפון**, ו-`reaction.message_id` של **אף אחת** אינו out מתועד שלנו (כנראה 👍 על הודעת headcount/ייבוא שאינה מתועדת). לכן "reaction → להשתמש ב-`reaction.message_id` כ-context" (הביקורת הראשית §8.1) צריך להיות: נסה כ-context; **אם לא נמצא — המשך לשלב 3** (לא `unmatched` ישיר). האם reaction הוא "מענה אנושי" לחיוב — שאלת מוצר (הביקורת הראשית §11.2).

### 2.2 שלב 2 — מזהה אטום לכל שליחה בכפתור/רשימה → חשיפה יוצאת אחת

**המצב היום (PROVEN, קוד):** KALFA **כן** מזריקה payload בשליטת המפתח על כפתורי quick-reply של תבניות — הפרמטר `rsvpButtonPayloads` (`src/lib/whatsapp/client.ts:147-165`) הופך ל-`PayloadComponent` אחד לכל כפתור לפי אינדקס (`client.ts:185-191`; `URLComponent` הוא לכפתורי URL בלבד, ושניהם לא יכולים לדור יחד — `client.ts:209-215`). הערכים סטטיים — `rsvp_attending | rsvp_declined | rsvp_maybe` (`src/lib/whatsapp/rsvp-buttons.ts:15-19`, מפה משותפת שליחה↔קליטה `:27-29`) — וחוזרים כ-`button.payload` (`inbound.ts:79-86`). ההזרקה מותנית ב-`template.rsvpQuickReply` (`outreach.ts:78-80`).

**מה מראים הנתונים החיים (PROVEN):**

```sql
select case when payload->'button'->>'payload' in ('rsvp_attending','rsvp_declined','rsvp_maybe') then 'static_rsvp_id'
            when payload->'button'->>'payload' is null then 'no_payload' else 'other_value' end bucket,
       count(*) n, count(context_message_id) with_ctx, min(event_at)::date first_seen, max(event_at)::date last_seen
from webhook_inbox where provider='whatsapp' and event_kind='message' and payload->>'type'='button' group by 1;
-- static_rsvp_id : 26 | with_ctx 26 | 2026-07-07 → 2026-07-12
-- other_value    :  6 | with_ctx  6 | 2026-07-05 → 2026-07-07   (לפני ההזרקה: Meta החזירה את התווית כ-payload → RSVP_BUTTON_MAP החטיא; תואם ההערה ב-rsvp-buttons.ts:5-7)
```

`button` 32/32 עם `context` (100%); `text` 1/32; `interactive` 0/1; `reaction` 0/2.

**תיקון למסמך Meta §4.3 (הפסקה האחרונה, INFERENCE):** הטענה "השליחות היוצאות משתמשות ב-URLComponent ולא ב-PayloadComponent, כך ש-`button.payload` שווה ל-`text`" — **CONTRADICTED** על ידי `client.ts:185-191` ועל ידי 26 הלחיצות החיות עם ids סטטיים. "מעבר ל-PayloadComponent" **אינו** תנאי מוקדם — הוא כבר קיים; 6 הלחיצות שהחזירו תווית הן משליחות שקדמו להזרקה (2026-07-05..07).

```sql
select payload->>'type' t, count(*) n, count(context_message_id) with_ctx
from webhook_inbox where provider='whatsapp' and event_kind='message' group by 1 order by 2 desc;
-- button 32/32 · text 1/32 · contacts 0/15 · reaction 0/2 · document 0/2 · interactive 0/1 · audio 0/1 · image 0/1
```

**הערכה:**
- Meta מצרפת `context.id` של הודעת התבנית ללחיצת quick-reply (`type:"button"`) — **DOCUMENTED** (מסמך Meta §4.3, reference של `messages/button`); חי: 32/32. לכן טוקן אטום לכל שליחה **אינו מוסיף מידע** לשיוך של לחיצת תבנית — שלב 1 כבר מזהה את ה-out המדויק, כולל ב-6 הלחיצות הישנות שהחזירו תווית (גם להן היה `context`).
- טוקן לכל שליחה **ישים** דרך המסלול הקיים (`PayloadComponent` ב-`client.ts:185-191`) — PROVEN. למשל `rsvp_attending:<token>` כש-`token` קצר וחתום ל-`(campaign_id, contact_id, step)`; ה-wamid היוצא **אינו** ידוע לפני השליחה ולכן לא יכול להיכנס לטוקן — כלומר הטוקן נושא את אותו מידע שכבר יש בשורת ה-out שה-`context` מצביע עליה.
- מגבלות: אורך/charset של `button.payload` בתבנית — **UNVERIFIED** (מסמך Meta §4.3); ל-`interactive.button_reply.id` מתועד ≤256 (DOCUMENTED, מסמך Meta §4.1/Q11). טוקן אלפאנומרי קצר (≤32) הוא הבחירה השמרנית.
- עלות: `RSVP_BUTTON_MAP` הופך מ-lookup סטטי לפענוח prefix + אימות token — שינוי בפרוטוקול RSVP המשותף לשליחה ולקליטה, שהמודול (`rsvp-buttons.ts:1-8`) נבנה במפורש כדי לשמור פשוט; וכל תבנית עם `rsvpQuickReply` תלויה בזה.

**המלצה (מתויגת):** **לא ליישם שלב 2 בגרסה הראשונה** — כי הערך המוסף שלו מוגבל לשני מקרים: (1) לחיצת תבנית **בלי** `context` — לא נצפה (0/32) ומנוגד ל-DOCUMENTED; (2) תשובות `interactive` (רשימות/כפתורים לא-תבניתיים) אם יתברר שאינן נושאות `context` — **UNVERIFIED** (מסמך Meta §3; חי: המופע היחיד בלי `context`). להגדיר את שלב 2 בעיצוב כ-**אימות צולב**: כשיש גם `context.id` וגם reply-id, שניהם חייבים להצביע על אותו קמפיין; אי-התאמה נרשמת בלדג'ר (`resolution_reason='reply_id_context_mismatch'`) ולא מחייבת. **תנאי כניסה מדיד** להפעלת טוקן לכל שליחה: דו"ח ה-shadow (§3.10) מראה לחיצות `button`/`interactive` בלי `context` או עם `context` שאינו out שלנו בשיעור > 0, או שנוספת תבנית עם רשימה אינטראקטיבית. אם וכאשר — המימוש הוא בתוך `buildTemplateMessage` + `RSVP_BUTTON_MAP` בלבד, בלי שינוי ב-Meta (payload נקבע בזמן שליחה, לא בתבנית המאושרת — DOCUMENTED, מסמך Meta §4.3).

### 2.3 שלב 3 — איתור מועמדים תחום

**מה זה "מועמד תקף"** (מרחיב את הביקורת הראשית §8.1 ב-2 ממדים: מספר עסקי + זהות שולח):

| ממד | מקור | כלל | הערות |
|---|---|---|---|
| זהות שולח — טלפון | `payload.from` (wa_id) → `normalizePhone` → `contacts.normalized_phone` | חובה למסלול המועמדים | חי: 3/86 הודעות בלי `from`. **DOCUMENTED (מסמך Meta §2.2):** תחת BSUID `messages.from` הוא *Optional* ("subject to privacy conditions", חלון 30 יום לכל מספר עסקי) ו-`from_user_id` *Required*; וגם כשקיים, `wa_id` ו-`from` "may not always match" |
| זהות שולח — BSUID | `payload.from_user_id` / `payload.sender_contact.user_id` (הבלוק נשמר מאז 3.9, `route.ts:169-182`) | **נשמר בלדג'ר** (`sender_user_id`); אין עמודת BSUID ב-`contacts` (חי: `contacts` = `id, event_id, normalized_phone, op_status, removal_requested, …`) ולכן **לא ניתן להתאים לפיו היום** — ההתאמה היחידה למשתמש בלי `from` היא שלב 1 (`context`) | חי: 9 הודעות עם `user_id`. בלי `from` ובלי `context` → `unresolved('no_from')` — נראה בלדג'ר, לא נבלע. **המלצת המשך (מחוץ להיקף השלב הראשון):** ללמוד BSUID↔contact מהתאמות `precise` (עמודה `contacts.wa_user_id`, נכתבת רק כשה-`context` מוכיח את הקישור) כדי שמסלול המועמדים יעבוד גם למשתמשי usernames |
| מספר עסקי מקבל | `webhook_inbox.phone_number_id` | חייב להיות שווה ל-`app_settings.whatsapp_phone_number_id`; אחרת `unresolved('unknown_business_number')` | תואם תוכנית פיצול מספר הייבוא |
| חלון שיוך | שורת `out` (`channel='whatsapp'`, `direction='out'`) של **אותו קמפיין** לאותו contact, `created_at` ב-`[received_at − N ימים, received_at]` | N = `app_settings.inbound_reply_window_days` (ברירת מחדל מוצעת 14; שאלת מוצר §11.1 בביקורת הראשית) | ה-`received_at` של ההודעה, לא `now()` של העיבוד — כדי ש-retry לא ישנה את התוצאה |
| סטטוס | `campaigns.status ∈ ('active','paused')`, `events.status='active'`, `now()` בתוך `[start_at, close_at]`, יום האירוע לא עבר | אותם שומרים כמו ב-RPC, מוקדמים | ה-RPC עדיין בודק שוב תחת `FOR UPDATE` |
| הרשאה | `(campaign_id, contact_id) ∈ campaign_authorized_contacts` **ברגע ההחלטה** | הסט דינמי (הביקורת הראשית §1.6) | |
| הסרה | `contacts.removal_requested=false` | | |

**מדידה מקדימה של המדיניות על ההיסטוריה** (קירוב: חברות בסט כפי שהיא **היום**, בלי סינון סטטוס כי כל הקמפיינים הרלוונטיים סגורים היום; N=14; ה-out נמדד יחסית ל-`created_at` של ההודעה):

```sql
with inb as (select ci.id, ci.provider_id, ci.context_message_id is not null via_ctx, ci.created_at, c.normalized_phone
             from contact_interactions ci join contacts c on c.id=ci.contact_id
             where ci.channel='whatsapp' and ci.direction='in' and ci.billable),
cand as (select i.id, count(distinct (a.campaign_id, a.contact_id)) n_valid
         from inb i join contacts c2 on c2.normalized_phone=i.normalized_phone
         join campaign_authorized_contacts a on a.contact_id=c2.id
         where c2.removal_requested=false
           and exists (select 1 from contact_interactions o where o.contact_id=a.contact_id and o.campaign_id=a.campaign_id
                       and o.direction='out' and o.channel='whatsapp'
                       and o.created_at < i.created_at and o.created_at > i.created_at - interval '14 days')
         group by i.id)
select i.via_ctx, coalesce(cand.n_valid,0) n_valid, count(*) n,
       count(*) filter (where exists (select 1 from billed_results b where b.provider_ref=i.provider_id)) billed
from inb i left join cand on cand.id=i.id group by 1,2 order by 1,2;
-- via_ctx=false, n_valid=0 : 14 שורות, 0 חויבו   → היו הופכות ל-unresolved מפורש (היום: already_billed/not_active/NULL)
-- via_ctx=false, n_valid=1 : 15 שורות, 2 חויבו   → attributable — כולל 2 החיובים דרך טלפון
-- via_ctx=true , n_valid=1 : 30 שורות, 19 חויבו  → precise
-- n_valid>=2 : 0 שורות
```

קריאה: על ההיסטוריה, המדיניות המחמירה **לא הייתה מאבדת אף חיוב** (2/2 חיובי-טלפון עם מועמד יחיד), **לא הייתה מייצרת אף `ambiguous`**, והייתה הופכת 14 הודעות "מאוחרות"/לא-בחלון מ-שקט ל-`unresolved` נראה. INFERENCE על העבר (קירוב), אבל מכוון ציפיות ל-shadow.

### 2.4 שלבים 4–6

- **בדיוק מועמד אחד → `attributable`**, ממשיכים **רק אם** `app_settings.inbound_attribution_strict=true` **וגם** מדיניות "מועמד-יחיד-מחייב" מותרת (דגל נפרד `inbound_single_candidate_bills`, ברירת מחדל `true` — כדי לאפשר לבעלים להחליט ש-"רק context מחייב"). ה-RPC נשאר קו ההגנה האחרון.
- **>1 → `ambiguous`**: נרשם בלדג'ר עם `candidates` (ids בלבד), `billing_result='not_billed_ambiguous'`, **אין** `contact_interactions`, **אין** RPC, התראת Slack ids-only, נראה באדמין. הסרה: ראו §3.7 (`webhook-processing.ts`).
- **0 → `unresolved`** עם `reason ∈ {no_from, no_contact, no_valid_candidate, unknown_business_number, window_expired}`; אותו טיפול.

**"השולח האחרון מנצח" מוסר לחלוטין כמקור לראיה כספית** — נשאר רק ב-shadow כדי למדוד את הפער, ובמסלול legacy מאחורי הדגל הכבוי.

---

## 3. תוצרי העיצוב (סעיפים 6–13 של המטרה)

סעיפים 1–5 של המטרה (זרימה נוכחית, שורש, יחיד-מול-כפול, סיכונים, מטריצת החלטה) מכוסים: הביקורת הראשית §1, §5–6 ו-§2 (מטריצה), מסמך ה-settle §4–5 (כסף), וסעיפים 0–1 כאן (Q1–Q8). מטריצת ההחלטה **לאחר** התיקון:

| סוג הודעה | שלב שמכריע | סטטוס | חיוב | רישום |
|---|---|---|---|---|
| עם `context.id` תואם out שלנו | 1 | `precise` | RPC (כמו היום) | לדג'ר + `contact_interactions` + `billed_results` |
| `reaction` שה-`message_id` שלו out שלנו | 1 (`method='reaction'`) | `precise` | RPC (אם מוצר מאשר reaction=מענה) | כנ"ל |
| כפתור/רשימה בלי `context` | 3 | לפי מועמדים | לפי 4–6 | כנ"ל; אי-עקביות reply-id↔context נרשמת |
| טקסט חופשי, מועמד תקף יחיד | 3→4 | `attributable` | RPC רק אם הדגלים מתירים | כנ"ל |
| טקסט חופשי, >1 מועמד | 5 | `ambiguous` | **לא** | לדג'ר בלבד + Slack |
| טקסט חופשי, 0 מועמדים / מספר לא-RSVP / בלי `from` | 6 | `unresolved` | **לא** | לדג'ר בלבד |
| משלוח חוזר של Meta (אותו wamid) | — | — | — | אין שורת inbox (UNIQUE) |
| retry/reprocess של שורת inbox קיימת | RPC מחזיר את השורה השמורה | **ההחלטה השמורה** | לא מחושב מחדש, לא מחויב שוב | `reprocess_count` בלדג'ר +1 (עמודה יחידה שמותר לעדכן) |

### 3.6 שינויי DB מוצעים

#### 3.6.1 טבלה: `public.inbound_attributions` (לדג'ר, append-only)

```sql
create table public.inbound_attributions (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null default 'whatsapp',
  phone_number_id       text not null,                 -- המספר העסקי שקיבל (webhook_inbox.phone_number_id)
  inbound_message_id    text not null,                 -- messages[].id (wamid)
  inbox_id              uuid references public.webhook_inbox(id) on delete set null,
  sender_id             text,                          -- E.164 מנורמל של messages[].from; NULL כשאין from
  sender_user_id        text,                          -- BSUID (contacts[].user_id) — נשמר, לא משמש לשיוך בשלב זה
  context_message_id    text,                          -- messages[].context.id או reaction.message_id
  message_type          text not null,                 -- text | button | interactive | reaction | …
  reply_id              text,                          -- button.payload / interactive.*.id (מזהה אטום שלנו, לא טקסט)
  received_at           timestamptz not null,          -- webhook_inbox.event_at ?? received_at
  resolution_status     text not null check (resolution_status in ('precise','attributable','ambiguous','unresolved')),
  resolution_method     text not null check (resolution_method in ('context','reaction','phone_single','none')),
  resolution_reason     text,                          -- no_from | no_contact | no_valid_candidate | unknown_business_number | window_expired | multiple_candidates
  resolved_event_id     uuid references public.events(id)    on delete restrict,
  resolved_campaign_id  uuid references public.campaigns(id) on delete restrict,
  resolved_contact_id   uuid references public.contacts(id)  on delete restrict,
  candidates            jsonb not null default '[]'::jsonb,  -- [{event_id, campaign_id, contact_id, last_out_at}] — ids בלבד
  window_days           int  not null,
  mode                  text not null check (mode in ('shadow','strict')),
  policy_bills_single   boolean not null,              -- ערך הדגל ברגע ההחלטה
  legacy_binding        jsonb,                         -- shadow: מה שהמסלול הישן בחר {event_id, campaign_id, contact_id} | null
  legacy_outcome        text,                          -- shadow: תוצאת ה-RPC של המסלול הישן
  billing_result        text not null,                 -- תוצאת try_record_billed_result | not_billed_ambiguous | not_billed_unresolved | not_billed_policy | not_billed_shadow
  decided_at            timestamptz not null default now(),
  decided_by            text not null,                 -- 'worker' | admin uuid (re-attribute)
  reprocess_count       int  not null default 0,       -- העמודה היחידה שמותר לעדכן
  constraint inbound_attributions_binding_ck check (
    (resolution_status in ('precise','attributable')
       and resolved_event_id is not null and resolved_campaign_id is not null and resolved_contact_id is not null)
    or (resolution_status in ('ambiguous','unresolved')
       and resolved_event_id is null and resolved_campaign_id is null and resolved_contact_id is null)
  ),
  constraint inbound_attributions_inbound_key unique (provider, phone_number_id, inbound_message_id)
);
create index inbound_attributions_received_idx on public.inbound_attributions (received_at desc);
create index inbound_attributions_status_idx   on public.inbound_attributions (resolution_status, mode, received_at desc);
create index inbound_attributions_campaign_idx on public.inbound_attributions (resolved_campaign_id) where resolved_campaign_id is not null;
```

למה טבלה חדשה ולא הרחבת `contact_interactions`: (א) `contact_interactions` היא "אינטראקציה עם contact" — שורה `ambiguous` בלי contact **אפשרית טכנית** (חי: `pg_attribute.attnotnull=false` ל-`event_id`, `campaign_id`, `contact_id`; היום 0 שורות נכנסות עם binding NULL) אך שוברת את הסמנטיקה ואת RLS (`event_id IS NOT NULL AND can_access_event`, מסמך ה-DB §4.3 — שורה כזו אינה נראית לאף בעלים), ומסלול השיחות משתמש בה אחרת; (ב) הלדג'ר צריך להיות append-only עם טריגר — `contact_interactions` מתעדכנת (delivery_status, billing_outcome); (ג) הפרדת מצבים שהמטרה דורשת: קליטה (`webhook_inbox`/`webhook_deliveries`) → סיווג+שיוך (`inbound_attributions`) → אינטראקציה (`contact_interactions`) → חיוב (`billed_results`).

**RLS + grants (התבנית של `webhook_deliveries` ב-`20260903214126:64-71`, לא זו של `campaign_authorized_set_audit` שנותרה עם grants ברירת-מחדל — ראו §4):**

```sql
alter table public.inbound_attributions enable row level security;
create policy inbound_attributions_admin_select on public.inbound_attributions
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));
revoke all on public.inbound_attributions from anon, authenticated;
grant select on public.inbound_attributions to authenticated;   -- מסונן ע"י ה-policy לאדמין
-- service_role כותב (worker/admin client). אין policy ללקוח: ההודעה עלולה להיות של לקוח אחר.
```

**Append-only (התבנית של `campaign_authorized_set_audit_no_mutate`, `20260712104001:41-54`, עם חריג יחיד):**

```sql
create or replace function public.inbound_attributions_no_mutate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and new.reprocess_count >= old.reprocess_count
     and row(new.id,new.provider,new.phone_number_id,new.inbound_message_id,new.resolution_status,new.resolution_method,
             new.resolved_event_id,new.resolved_campaign_id,new.resolved_contact_id,new.billing_result,new.mode,new.decided_at,new.decided_by)
       is not distinct from
         row(old.id,old.provider,old.phone_number_id,old.inbound_message_id,old.resolution_status,old.resolution_method,
             old.resolved_event_id,old.resolved_campaign_id,old.resolved_contact_id,old.billing_result,old.mode,old.decided_at,old.decided_by)
  then return new; end if;
  raise exception 'inbound_attributions is append-only (% blocked)', tg_op;
end $$;
revoke all on function public.inbound_attributions_no_mutate() from public, anon, authenticated;
create trigger inbound_attributions_immutable before update or delete on public.inbound_attributions
  for each row execute function public.inbound_attributions_no_mutate();
```

הערה: טריגר שורה אינו חוסם `TRUNCATE`; ה-`REVOKE … FROM anon, authenticated` למעלה הוא מה שסוגר את זה (הפער שמסמך ה-DB "הפתעה 1" מצא ב-7 טבלאות).

**Re-attribution ידני** (החלטת אדמין מפורשת, לא "עיבוד מחדש"): טבלת `inbound_attribution_overrides (id, attribution_id fk, prev_status, new_event_id, new_campaign_id, new_contact_id, reason text not null, actor uuid not null, billing_result text, at)`; הלדג'ר המקורי **לא** משתנה; ה-override קורא ל-`try_record_billed_result` עם `provider_ref` = אותו wamid — האינדקס החדש (§3.6.3) מבטיח שאם השיוך המקורי כבר חייב, ה-override לא יחייב שנית (`duplicate_provider_ref`). מחוץ להיקף השלב הראשון; מתועד כדי שהלדג'ר לא יתוכנן בלי מקום לזה.

#### 3.6.2 גבול האידמפוטנטיות — המפתח

| וריאנט | מפתח | נכון אם… | עלות |
|---|---|---|---|
| A | `UNIQUE (provider, inbound_message_id)` | wamid ייחודי גלובלית — **UNDOCUMENTED**: Meta כותבת "unique" בלי scope (מסמך Meta §2.1) | אם ההנחה שגויה: הודעה למספר השני עם wamid זהה נבלעת כ"כפילות" |
| **B (נבחר)** | **`UNIQUE (provider, phone_number_id, inbound_message_id)`** | **תמיד** — תת-מפתח של A כשהוא נכון, ומפריד נכון בין מספרים כשלא; זו גם ההכרעה של מסמך Meta §2.1 (INFERENCE שם, מאומץ כאן) | אפס: `phone_number_id` קיים ב-100% משורות ה-`message` (חי) |

**הצדקה:** (1) B בטוח תחת שתי הסמנטיקות, והיקף הייחודיות של wamid **אינו מתועד** (מסמך Meta §2.1); (2) ההודעה ממילא מקבלת החלטת שיוך **לפי המספר שקיבל אותה** (שלב 3), ולכן המפתח הטבעי של ההחלטה כולל את המספר; (3) חי: 86 שורות `message`, 82 wamids ייחודיים (4 הכפילויות = שורות sandbox עם סיומת `:test:`), **0 wamids שמופיעים תחת יותר ממספר אחד** — כלומר אין הבדל נצפה, אבל גם אין מחיר. **עם זאת יש לציין:** שני המפתחות הקיימים — `webhook_inbox.dedupe_key='wa-msg:<wamid>'` (`route.ts:189`) ו-`contact_interactions UNIQUE (channel, provider_id)` — מניחים ייחודיות **גלובלית**. אם מסמך Meta יקבע שהיא רק לכל מספר, שניהם יבלעו בשקט הודעה למספר השני עם wamid חוזר (שכיחות: 0 עד היום). זו נקודת החלטה למיזוג עם מסמך Meta, לא לתיקון כאן.

#### 3.6.3 `billed_results` — האם צריך `UNIQUE (channel, provider_ref)`?

| | בעד | נגד |
|---|---|---|
| הבטחה ברמת DB ל-"הודעה אחת לא מחייבת שני לקוחות" (דרישת המטרה), בלתי תלויה במסלול הקוד, ב-`fresh`, או ב-override עתידי | ✔ | |
| חי: 0 כפילויות `provider_ref`, 0 NULL → ניתן להוסיף עכשיו בלי backfill | ✔ | |
| מסלול השיחות: `provider_ref = attemptId` (מרחב אחר) ו-`channel='call'` — האינדקס עם `channel` במפתח לא נוגע בו | ✔ | |
| מוסיף אינדקס ל-Q3 (חיפוש לפי wamid באינספקטור) | ✔ | |
| ה-`ON CONFLICT (event_id, contact_id) DO NOTHING` ב-RPC **אינו** מכסה את האינדקס החדש → הפרה שלו תזרוק `unique_violation` (23505) → `recordReached` יזרוק → `processMessage` יזרוק → retry אינסופי עד `attempts=5` | | ✘ דורש תיקון RPC: לעטוף את ה-INSERT ב-`begin … exception when unique_violation then return 'duplicate_provider_ref'; end;` (ליטרל חדש, מתויג ב-`labels.ts`) |
| RPC `SECURITY DEFINER` עם `search_path=public` — כל שינוי בו דורש בדיקת drift (מסמך ה-DB §9) | | ✘ קטן |

**הכרעה: כן, להוסיף** — כאינדקס ייחודי חלקי, יחד עם תיקון ה-RPC, **במיגרציה נפרדת** משל הלדג'ר (כדי שגלגול לאחור יהיה עצמאי):

```sql
create unique index concurrently if not exists billed_results_channel_provider_ref_uidx
  on public.billed_results (channel, provider_ref) where provider_ref is not null;
-- + create or replace function public.try_record_billed_result(...) — זהה לגוף החי (מסמך ה-DB §3.1) פרט ל:
--   begin
--     insert into billed_results(...) values (...) on conflict (event_id,contact_id) do nothing;
--   exception when unique_violation then
--     return 'duplicate_provider_ref';
--   end;
```

(`concurrently` אינו רץ בתוך טרנזקציית migration של ה-CLI — ב-22 שורות אין צורך בו; מצוין רק כדי לתעד את השיקול.)

#### 3.6.4 `app_settings` — דגלים

```sql
alter table public.app_settings
  add column inbound_attribution_strict    boolean not null default false,  -- OFF = המסלול הישן פועל, החדש ב-shadow
  add column inbound_single_candidate_bills boolean not null default true,   -- תחת strict: מועמד יחיד מחייב (false = רק context)
  add column inbound_reply_window_days     integer not null default 14 check (inbound_reply_window_days between 1 and 60);
```

חי: אין כיום אף עמודת `inbound_attribution*`/`import*` ב-`app_settings` (נבדק ב-`pg_attribute`). ברירות המחדל שומרות התנהגות זהה להיום. לפי הכלל "kill-switch ב-DB בלי UI ≠ גמור" — מתג ב-`/admin/channels` בתבנית `updateCallConsentRequiredAction` (`src/app/(admin)/admin/channels/actions.ts:215-245`: `requireAdmin` בתוך ה-data layer, Slack `category:'security'` על כל היפוך, `revalidatePath`).

#### 3.6.5 סדר מיגרציות ו-rollback

| # | מיגרציה (`supabase migration new …`) | rollback |
|---|---|---|
| M1 | `app_settings` 3 עמודות | `alter table app_settings drop column …` ×3 |
| M2 | `inbound_attributions` + policy + revoke/grant + טריגר + אינדקסים | `drop trigger`, `drop function`, `drop table` (הלדג'ר נמחק רק ב-rollback מלא; בכיבוי הדגל הוא **נשאר**) |
| M3 | RPC `record_inbound_attribution` (§3.7) | `drop function` |
| M4 | `billed_results_channel_provider_ref_uidx` + `try_record_billed_result` עם `exception` | `drop index`; `create or replace` הגוף הקודם (`20260902062917:244-314`) |

כל אחת עצמאית; M4 אינה תלויה ב-M1–M3 ויכולה לרוץ ראשונה (היא סוגרת את Q7 לבדה).

### 3.7 שינויי קוד לפי קובץ

**`src/lib/data/interactions.ts`**
- חדש `resolveInboundAttribution(input)` — החתימה מהביקורת הראשית §8.2, עם שני שדות נוספים בקלט (`receivedAtIso`, `reactionMessageId`) ושדה `reason` ב-`unmatched`→`unresolved`. מחזיר את האיחוד המובחן:
  ```ts
  export type InboundAttribution =
    | { kind: 'precise'; eventId; campaignId; contactId; via: 'context' | 'reaction' }
    | { kind: 'attributable'; eventId; campaignId; contactId; via: 'phone_single'; candidates: Candidate[] }
    | { kind: 'ambiguous'; candidates: Candidate[] }
    | { kind: 'unresolved'; reason: 'no_from' | 'no_contact' | 'no_valid_candidate' | 'unknown_business_number' | 'window_expired' };
  ```
  סדר: (1) `contextId` → `resolveByContextId` (מתוקן: `.eq('channel','whatsapp')`); (2) `reactionMessageId` → אותו דבר עם `via:'reaction'`; (3) `phoneNumberId !== rsvpPhoneNumberId` → `unresolved('unknown_business_number')`; (4) `!fromPhone` → `unresolved('no_from')`; (5) מועמדים — שאילתה אחת דרך RPC קריאה-בלבד `list_inbound_candidates(p_phone text, p_received_at timestamptz, p_window_days int)` (`SECURITY INVOKER`, `search_path=''`, service_role בלבד) שמבצעת את ה-join של §2.3 ומחזירה `(event_id, campaign_id, contact_id, last_out_at)`; 0 → `unresolved('no_valid_candidate')` (או `window_expired` אם היה out מחוץ לחלון), 1 → `attributable`, >1 → `ambiguous`.
- `resolveInboundContact` הישן נשאר **רק** ל-shadow/legacy, מסומן `@deprecated`.
- `insertInteraction` ללא שינוי; `markContactRemovalRequested` ללא שינוי.

**`src/lib/data/webhook-processing.ts` — `processMessage` (המבנה "קרא-לפני-חשב"):**
1. `stageWhatsAppImport` ← ללא שינוי.
2. סיווג ← ללא שינוי; להוסיף `reactionMessageId` ל-`classifyMessagePayload` (`inbound.ts`).
3. **קרא דגלים** (`getInboundAttributionPolicy()` — `strict`, `singleBills`, `windowDays`, `rsvpPhoneNumberId`).
4. **חשב** `attribution = await resolveInboundAttribution(...)`.
5. **קרא/כתוב לדג'ר + חייב באטומיות** דרך ה-RPC החדש:
   ```ts
   const ledger = await recordInboundAttribution({ inboxRow, attribution, mode: strict ? 'strict' : 'shadow', bill: strict && (attribution.kind==='precise' || (attribution.kind==='attributable' && singleBills)), legacy: null });
   if (!ledger.stored) { /* שורה קיימת — retry/reprocess */ await bumpReprocessCount(ledger.id); apply only idempotent side-effects from the STORED decision (below); return; }
   ```
6. **פעולות לפי ההחלטה השמורה** (`ledger.resolution_status`, `ledger.resolved_*`, `ledger.billing_result`) — לעולם לא לפי `attribution` המקומי:
   - `precise`/`attributable` ב-`strict`: אם `billing_result==='billed'` → `setContactOpStatus(reached_billed)` (אידמפוטנטי; היום בתוך `recordReached`, `billing.ts:45-47` — להעביר לקורא או להשאיר ב-RPC ע"י `update contacts` בתוך הטרנזקציה); `removal` → `markContactRemovalRequested(ledger.resolved_contact_id)`; RSVP/headcount → רק אם `ledger.stored` (המקבילה ל-`fresh`).
   - `ambiguous`: Slack ids-only; **הסרה:** אם `removal` — לסמן `removal_requested` על **כל** ה-contacts ב-`candidates` (ההסרה היא של האדם/המספר מול המספר העסקי שלנו, לא של קמפיין; החלטת מוצר §11.5 בביקורת הראשית — ברירת המחדל המוצעת: כן, בטיחות משפטית עדיפה על דיוק שיוך). אין RSVP/headcount.
   - `unresolved`: כלום פרט ללדג'ר.
   - `mode='shadow'`: המסלול **הישן** רץ בדיוק כמו היום (`resolveByContextId ?? resolveInboundContact` → `insertInteraction` → `recordReached` → …), ותוצאתו נכתבת **לאותה שורת לדג'ר** דרך הפרמטרים `legacy_binding`/`legacy_outcome` (ה-RPC מקבל אותם; ב-shadow הוא **לא** מחייב). סדר: legacy קודם (כדי שיהיה מה לרשום), אחר כך RPC הלדג'ר.
7. סגירת 6.2 מהביקורת הראשית מתקבלת **מאליה** ב-strict: ההחלטה, האינטראקציה והחיוב בטרנזקציה אחת; אין "בין".

**`src/lib/data/billing.ts`**
- `recordReached` ללא שינוי (עדיין משמש את מסלול השיחות ואת ה-shadow).
- חדש `recordInboundAttribution(args)` → `admin.rpc('record_inbound_attribution', …)`; מחזיר את השורה (`stored:boolean` + כל העמודות). זורק על `error` (→ retry; אם השורה נכתבה, ה-retry יקבל `stored=false` ויעבוד לפי השמור).
- ליטרל חדש `duplicate_provider_ref` ב-`labels.ts` (מסמך ה-DB §3.1 + `src/lib/data/admin/labels.ts:243-258`).

**RPC חדש `public.record_inbound_attribution(...)`** — ראו §3.8 לגוף.

**`src/app/api/webhooks/whatsapp/route.ts`** — **ללא שינוי חובה.** `reaction.message_id` נקרא מה-payload ב-worker (`payload.reaction?.message_id`), לא מועבר ל-`context_message_id` בנרמול — כדי לא לערבב סמנטיקה (הביקורת הראשית §9 שלב 4). `sender_contact.user_id` כבר נשמר (`route.ts:169-182`).

**`src/lib/whatsapp/inbound.ts`** — `classifyMessagePayload` מחזיר גם `reactionMessageId: string | null` (`reaction.message_id`). **"אין חיוב על סמך NLP בלבד"** — נאכף כך: `billable` (הסיווג) הוא **תנאי כניסה** ל-`processMessage` בלבד; החיוב ב-RPC החדש מותנה ב-`resolution_status ∈ ('precise','attributable')` — כלומר בקיום **ראיה מבנית** (out מתועד + חלון + סט + סטטוס), **לעולם לא** בטקסט. `isRemovalIntent` נשאר מסווג-מילים (זה לא NLP חופשי) ומשפיע רק על `evidence_source` ועל ההסרה, לא על ההחלטה האם לחייב. ה-CHECK `inbound_attributions_binding_ck` + ה-RPC (שמסרב לחייב בלי `resolved_*`) אוכפים זאת ב-DB.

**`src/lib/data/admin/webhook-inbox.ts` / `webhook-detail.tsx` / `webhook-inspector-client.tsx`** — הפירוט קורא גם את שורת הלדג'ר לפי `(phone_number_id, message_id)` ומציג: סטטוס, שיטה, מועמדים (ids → שמות אירועים דרך `loadEventNames`), `billing_result`, `mode`, `legacy_*` (ב-shadow), `reprocess_count`. פילטר חדש לפי `resolution_status`. הטקסט "לא שויך לאף איש קשר/קמפיין" (`webhook-detail.tsx:327-330`) מוחלף ברישום פוזיטיבי מהלדג'ר.

**`src/app/(admin)/admin/channels/*`** — שלושת המתגים/שדה N, בתבנית `call_consent_required`.

**`src/lib/data/call-result-processing.ts`** — מחוץ להיקף השיוך, אבל (הביקורת הראשית §8.3) לשמור את תוצאת `writeReach` ב-`billing_outcome` — שורה אחת.

### 3.8 טרנזקציה ומקביליות

**הגבול האטומי = RPC אחד** `public.record_inbound_attribution(...)`, `SECURITY INVOKER` (הקורא הוא service_role — אין צורך בהעלאת הרשאות; תואם המוסכמה בריפו), `set search_path = ''`, שמות מוסמכים, `revoke execute from public, anon, authenticated; grant execute to service_role`.

```sql
create or replace function public.record_inbound_attribution(
  p_provider text, p_phone_number_id text, p_inbound_message_id text, p_inbox_id uuid,
  p_sender_id text, p_sender_user_id text, p_context_message_id text, p_message_type text, p_reply_id text,
  p_received_at timestamptz,
  p_status text, p_method text, p_reason text,
  p_event uuid, p_campaign uuid, p_contact uuid, p_candidates jsonb, p_window_days int,
  p_mode text, p_policy_bills_single boolean, p_bill boolean, p_evidence text,
  p_legacy_binding jsonb, p_legacy_outcome text, p_decided_by text
) returns table (stored boolean, id uuid, resolution_status text, resolution_method text,
                 resolved_event_id uuid, resolved_campaign_id uuid, resolved_contact_id uuid,
                 billing_result text, mode text)
language plpgsql set search_path = '' as $$
declare v_id uuid; v_result text;
begin
  -- 1. סריאליזציה לכל מפתח נכנס: שני drains/retries על אותה הודעה מסתדרים בתור.
  perform pg_advisory_xact_lock(hashtext(p_provider || '|' || p_phone_number_id || '|' || p_inbound_message_id));

  -- 2. קרא-לפני-חשב: אם יש החלטה שמורה — החזר אותה, בלי לחשב ובלי לחייב.
  select a.id into v_id from public.inbound_attributions a
   where a.provider=p_provider and a.phone_number_id=p_phone_number_id and a.inbound_message_id=p_inbound_message_id;
  if found then
    return query select false, a.id, a.resolution_status, a.resolution_method, a.resolved_event_id, a.resolved_campaign_id,
                        a.resolved_contact_id, a.billing_result, a.mode from public.inbound_attributions a where a.id=v_id;
    return;
  end if;

  -- 3. חיוב (רק strict + binding + מדיניות): באותה טרנזקציה. try_record_billed_result נועל את שורת הקמפיין FOR UPDATE.
  if p_mode='strict' and p_bill and p_status in ('precise','attributable') then
    insert into public.contact_interactions(event_id,campaign_id,contact_id,channel,direction,kind,provider_id,billable,context_message_id)
      values (p_event,p_campaign,p_contact,'whatsapp','in','message',p_inbound_message_id,true,p_context_message_id)
      on conflict (channel,provider_id) do nothing;
    v_result := public.try_record_billed_result(p_event,p_campaign,p_contact,'whatsapp'::public.campaign_channel,
                                                p_inbound_message_id,p_evidence,p_inbound_message_id);
    update public.contact_interactions set billing_outcome=v_result
      where channel='whatsapp' and provider_id=p_inbound_message_id and direction='in';
    if v_result='billed' then update public.contacts set op_status='reached_billed' where id=p_contact; end if;
  elsif p_mode='strict' and p_status in ('precise','attributable') then
    -- binding קיים אך המדיניות אוסרת חיוב (single_candidate_bills=false): רושמים אינטראקציה, לא מחייבים.
    insert into public.contact_interactions(...) values (...) on conflict (channel,provider_id) do nothing;
    v_result := 'not_billed_policy';
  elsif p_mode='shadow' then
    v_result := 'not_billed_shadow';
  else
    v_result := 'not_billed_' || p_status;   -- ambiguous / unresolved
  end if;

  -- 4. שורת הלדג'ר — INSERT יחיד, כבר עם התוצאה (הטבלה append-only).
  insert into public.inbound_attributions(provider,phone_number_id,inbound_message_id,inbox_id,sender_id,sender_user_id,context_message_id,
      message_type,reply_id,received_at,resolution_status,resolution_method,resolution_reason,resolved_event_id,resolved_campaign_id,
      resolved_contact_id,candidates,window_days,mode,policy_bills_single,legacy_binding,legacy_outcome,billing_result,decided_by)
    values (p_provider,p_phone_number_id,p_inbound_message_id,p_inbox_id,p_sender_id,p_sender_user_id,p_context_message_id,
      p_message_type,p_reply_id,p_received_at,p_status,p_method,p_reason,p_event,p_campaign,p_contact,coalesce(p_candidates,'[]'::jsonb),
      p_window_days,p_mode,p_policy_bills_single,p_legacy_binding,p_legacy_outcome,v_result,p_decided_by)
    returning inbound_attributions.id into v_id;

  return query select true, a.id, a.resolution_status, a.resolution_method, a.resolved_event_id, a.resolved_campaign_id,
                      a.resolved_contact_id, a.billing_result, a.mode from public.inbound_attributions a where a.id=v_id;
exception when unique_violation then
  -- הגנת עומק: אם המנעול המייעץ נעקף איכשהו, האינדקס הייחודי הוא האמת — מחזירים את השמור.
  return query select false, a.id, a.resolution_status, a.resolution_method, a.resolved_event_id, a.resolved_campaign_id,
                      a.resolved_contact_id, a.billing_result, a.mode
               from public.inbound_attributions a
               where a.provider=p_provider and a.phone_number_id=p_phone_number_id and a.inbound_message_id=p_inbound_message_id;
end $$;
```

(הפרטים הסופיים — טיפוס ה-enum ב-`p_method`, שמות עמודות — ייקבעו במימוש; מה שקובע כאן הוא **הסדר**: מנעול → קרא → חייב → כתוב לדג'ר, הכול ב-COMMIT אחד.)

| תרחיש | מה קורה |
|---|---|
| **retry של ה-worker / reprocess של אדמין** | שלב 2 מחזיר `stored=false` + ההחלטה השמורה; הקוד מיישם רק פעולות אידמפוטנטיות **לפי השמור** (הסרה על ה-contact השמור, לא על מחושב-מחדש). `reprocess_count+1` (העדכון היחיד שהטריגר מתיר). **Q6 נסגר:** אין חישוב מחדש שמשפיע. |
| **שני drains במקביל** (היום: worker יחיד סדרתי, `localConcurrency=1` — הביקורת הראשית W1; מחר: אם יתווסף מופע) | המנעול המייעץ מסדר בתור; השני רואה את השורה. גם בלי המנעול — `unique_violation` → `exception` → מחזיר את השמור. |
| **שני contacts שונים על גבול התקרה** | `try_record_billed_result` נועל את שורת הקמפיין `FOR UPDATE` (מסמך ה-DB §6 ש8) → אחד `billed`, השני `ceiling_reached`; שתי שורות לדג'ר, שורת `billed_results` אחת. |
| **`try_record_billed_result` זורק** (תקלה) | כל הטרנזקציה מתגלגלת לאחור — **אין** שורת לדג'ר, **אין** אינטראקציה → ה-retry מחשב מחדש ומנסה שוב. זה המצב היחיד שבו "ההחלטה" יכולה להשתנות בין ניסיונות — ובו לא נכתב דבר, כך שאין החלטה שהשתנתה. |
| **כשל אחרי COMMIT ולפני פעולות הצד** (Slack, RSVP, headcount) | ה-retry מקבל את השמור ומריץ את הפעולות האידמפוטנטיות (`submit_rsvp` אידמפוטנטי; headcount בודק מצב). |
| **reconcile של הסט במקביל** | אותו `FOR UPDATE` על `campaigns` (מסמך ה-DB §3.6) — מסודר בתור מול החיוב; ההחלטה `attributable` שנקבעה לפני הנעילה עדיין עוברת שומר 9 של ה-RPC ברגע החיוב (ולא — `not_authorized` נרשם בלדג'ר). |
| **re-attribute ידני** | פעולת אדמין נפרדת (§3.6.1, טבלת overrides), עם `reason` חובה ו-`logActivity`; לעולם לא דרך "עיבוד מחדש". |

### 3.9 תוכנית בדיקות

**יחידה (vitest):**
- `src/lib/whatsapp/inbound.test.ts` (קיים 18): + `reaction` מחזיר `reactionMessageId`; `text` מחזיר `null`.
- `src/lib/data/interactions.test.ts` (קיים 20; `resolveInboundContact` ב-`:76-140`): + `describe('resolveInboundAttribution')` — `context` תואם → `precise/context`; `reaction.message_id` תואם → `precise/reaction`; `reaction.message_id` לא תואם + מועמד יחיד → `attributable`; `phone_number_id` ≠ RSVP → `unresolved/unknown_business_number` **לפני** כל שאילתה; אין `from` → `unresolved/no_from`; טלפון לא קיים → `no_contact`; מועמד יחיד → `attributable` עם `candidates.length===1`; שני מועמדים (שני אירועים, שניהם out בחלון) → `ambiguous` עם 2; מועמד שה-out שלו ישן מ-N → `window_expired`; `removal_requested` → לא מועמד; לא בסט → לא מועמד; `context` **וגם** `reply_id` — עקביות נבדקת; `resolveByContextId` מסנן `channel`.
- `src/lib/data/webhook-processing.test.ts` (קיים 28; המוקים `:1-105`): + `strict/precise` → `recordInboundAttribution` נקרא עם `bill=true`, `recordReached` **לא** נקרא ישירות; `strict/ambiguous` → `bill=false`, אין `insertInteraction`, אין `submitRsvp`, `sendSlackAlert` עם ids בלבד, `markContactRemovalRequested` נקרא לכל מועמד כש-`removal`; `strict/unresolved` → לדג'ר בלבד; `shadow` → המסלול הישן רץ **ואז** הלדג'ר עם `legacy_binding/legacy_outcome`; **retry:** `recordInboundAttribution` מחזיר `stored=false` עם binding שמור ≠ המחושב → הפעולות רצות על **השמור** (assert על ה-contactId שהועבר ל-`markContactRemovalRequested`); `singleBills=false` + `attributable` → `bill=false`. לעדכן: "falls back to the sender phone and bills" (`:179`) → נשמר רק ב-`shadow`; "does NOT bill when neither…" (`:256`) → נרשם `unresolved`.
- `src/lib/data/billing.test.ts` (קיים 14): + `recordInboundAttribution` ממפה `stored`/שורה; זורק על `error`.
- `src/lib/data/admin/*.test.ts`: תווית `duplicate_provider_ref`; פילטר `resolution_status`.

**אינטגרציה (route → inbox → worker):** `src/app/api/webhooks/whatsapp/route.test.ts` (קיים 32): מסירה חתומה עם `text` (בלי context) + `button` (עם context) + `reaction` → 3 שורות inbox עם `phone_number_id`; אותה מסירה פעמיים → 3 שורות בלבד. בדיקת worker (מוקים ל-DB): `handleWebhook` על שורה שנכשלת → `attempts+1`, ואז מצליחה → שורת לדג'ר אחת.

**retry (DB-בדיקה, לא ה-DB החי):**
1. אותו wamid פעמיים, ובין לבין out חדש ל-contact אחר באותו טלפון → קריאה 2 מחזירה `stored=false` ואת אותו `resolved_contact_id`; `count(inbound_attributions)=1`.
2. `try_record_billed_result` מוחלף זמנית בפונקציה שזורקת בפעם הראשונה → קריאה 1: אין שורת לדג'ר, אין אינטראקציה; קריאה 2: `billed`, שורה אחת בכל טבלה.
3. reprocess: `reprocess_count` עולה; ניסיון `update resolution_status` → חריגה מהטריגר; `delete` → חריגה.

**מקביליות (DB-בדיקה, שני חיבורים):**
1. שתי קריאות `record_inbound_attribution` באותו מפתח בו-זמנית → שורה אחת; אחת `stored=true`, אחת `false` עם אותו תוכן.
2. שני contacts שונים, `cap=1`, בו-זמנית → `billed` + `ceiling_reached`; `count(billed_results)=1`; 2 שורות לדג'ר.
3. אותו `provider_ref` בשני `(event, contact)` ישירות ב-`try_record_billed_result` (סימולציית מסלול עוקף) → השני `duplicate_provider_ref`, לא חריגה.
4. `claim_webhook_events` פעמיים בטרנזקציות פתוחות → סטים זרים (מתעד את מגבלת 1.3 בביקורת הראשית).

### 3.10 מצב shadow (דגל + מתג אדמין)

- **דגל:** `app_settings.inbound_attribution_strict=false` (ברירת מחדל) — **shadow**. מתג ב-`/admin/channels` (חובה לפי כלל הבית), Slack `security` על היפוך, `logActivity`.
- **ב-shadow:** המסלול הישן פועל ומחייב **בדיוק כמו היום**; במקביל `resolveInboundAttribution` מחושב ונכתב ללדג'ר עם `mode='shadow'`, `billing_result='not_billed_shadow'`, `legacy_binding` = הצמד שהישן בחר (או `null`), `legacy_outcome` = תוצאת ה-RPC של הישן (או `null` אם לא נקרא). **הלדג'ר לעולם לא מחייב ב-shadow.**
- **מעבר ל-strict:** הודעות שכבר יש להן שורת shadow — ה-RPC מחזיר `stored=false, mode='shadow'` → הקוד מתייחס אליהן כ-legacy (הן ממילא כבר טופלו; `fresh=false`). הודעות חדשות → `mode='strict'`. אין צורך במיגרציית נתונים.
- **דו"ח השוואה** (view, קריאה בלבד, ללא PII):

```sql
create view public.inbound_attribution_shadow_report as
select date_trunc('day', received_at) day, resolution_status, resolution_method,
       count(*) n,
       count(*) filter (where legacy_binding is not null) legacy_resolved,
       count(*) filter (where resolution_status in ('precise','attributable')
                          and legacy_binding is not null
                          and (legacy_binding->>'campaign_id')::uuid = resolved_campaign_id
                          and (legacy_binding->>'contact_id')::uuid  = resolved_contact_id) agree,
       count(*) filter (where resolution_status in ('precise','attributable')
                          and legacy_binding is not null
                          and ((legacy_binding->>'campaign_id')::uuid <> resolved_campaign_id
                            or (legacy_binding->>'contact_id')::uuid  <> resolved_contact_id)) disagree_binding,
       count(*) filter (where resolution_status in ('ambiguous','unresolved') and legacy_outcome='billed') legacy_billed_new_would_block,
       count(*) filter (where resolution_status in ('precise','attributable') and legacy_binding is null) new_resolves_legacy_did_not
from public.inbound_attributions where mode='shadow' group by 1,2,3;
```
  קריטריון להדלקה (הצעה): X ימים רצופים (למשל 14) עם `disagree_binding=0` ו-`legacy_billed_new_would_block` שנסקר ידנית שורה-שורה (אלה בדיוק המקרים שבהם הלקוח היה מחויב על ניחוש).

### 3.11 מדדים

| מדד | הגדרה | איפה |
|---|---|---|
| התפלגות `resolution_status` × `resolution_method` | `count(*)` לפי יום | view `inbound_attribution_daily` (`group by day, status, method`) + כרטיס ב-`/admin/webhooks` |
| שיעור הסכמה ישן↔חדש | `agree / (agree+disagree_binding)` | `inbound_attribution_shadow_report` |
| שיעור ambiguous / unresolved | `n_status / n_total` לפי יום | `inbound_attribution_daily` |
| "חויב דרך fallback" | ב-strict: `billing_result='billed' and resolution_method='phone_single'` | view; ב-shadow: `legacy_outcome='billed' and legacy_binding is not null and resolution_method<>'context'` |
| זמן-להחלטה | `decided_at − received_at` (p50/p95) | view `percentile_cont` |
| כפילויות שנחסמו | `count(*) where billing_result='duplicate_provider_ref'` + `sum(reprocess_count)` | view |
| הודעות למספר לא-RSVP | `resolution_reason='unknown_business_number'` | view |

כל ה-views: `security_invoker=true`, `revoke all from anon, authenticated`, `grant select to authenticated` (מסונן דרך ה-policy של הטבלה). האדמין קורא דרך ה-cookie client כ-admin (RLS `has_role`), לא service-role.

### 3.12 גלגול לאחור

| רמה | פעולה | תוצאה |
|---|---|---|
| 1 — דגל | `inbound_attribution_strict=false` (מתג אדמין) | המסלול הישן חוזר לפעול מיד; הלדג'ר ממשיך להתמלא ב-shadow; שום נתון לא נמחק |
| 2 — קוד | revert של הקומיטים (webhook-processing, interactions, billing, admin) | הלדג'ר נשאר בטבלה, לא נכתב יותר; ה-RPC החדש נשאר ללא קורא |
| 3 — DB | M4 (index + RPC) → M3 (RPC) → M2 (טבלה) → M1 (עמודות), כל אחת ב-`supabase migration new` נפרדת עם ה-DDL ההפוך | חזרה מלאה; **לפני M2** — לייצא את הלדג'ר (audit) |

הלדג'ר הוא append-only ולכן גלגול לאחור לעולם לא "מתקן" היסטוריה — הוא רק מפסיק לכתוב.

### 3.13 שאילתות אימות (קריאה בלבד, ללא PII)

**לפני (בסיס):** כל השאילתות ב-§1 (Q1 F, Q3 J, Q4 R, Q6 D/E, Q7 pg_constraint, Q8 G) + §2.3 S. יש להריץ מחדש ביום ההפעלה ולשמור את התוצאות ליד הדו"ח.

**אחרי M4:**
```sql
select indexname, indexdef from pg_indexes where tablename='billed_results' and indexname='billed_results_channel_provider_ref_uidx';
select prosrc ilike '%duplicate_provider_ref%' from pg_proc where proname='try_record_billed_result';
```

**אחרי M2/M3:**
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.inbound_attributions'::regclass;
select tgname from pg_trigger where tgrelid='public.inbound_attributions'::regclass and not tgisinternal;
select grantee::regrole::text, string_agg(privilege_type, ',') from (select (aclexplode(relacl)).* from pg_class where oid='public.inbound_attributions'::regclass) g group by 1;
select p.proname, p.prosecdef, p.proconfig, p.proacl::text from pg_proc p where p.proname in ('record_inbound_attribution','list_inbound_candidates');
```

**בהרצה (shadow):**
```sql
select * from public.inbound_attribution_shadow_report where day >= now() - interval '7 days' order by 1,2,3;
-- כל שורת inbox message חדשה חייבת שורת לדג'ר אחת:
select count(*) filter (where a.id is null) missing_ledger, count(*) filter (where a.id is not null) with_ledger
from webhook_inbox w left join inbound_attributions a
  on a.provider=w.provider and a.phone_number_id=w.phone_number_id and a.inbound_message_id=w.message_id
where w.provider='whatsapp' and w.event_kind='message' and w.processed_at >= '<deploy_ts>';
-- אין חיוב בלי לדג'ר (strict):
select count(*) from billed_results b where b.channel='whatsapp' and b.reached_at >= '<strict_ts>'
  and not exists (select 1 from inbound_attributions a where a.inbound_message_id=b.provider_ref and a.billing_result='billed');
-- אין לדג'ר "billed" בלי שורת חיוב:
select count(*) from inbound_attributions a where a.billing_result='billed'
  and not exists (select 1 from billed_results b where b.channel='whatsapp' and b.provider_ref=a.inbound_message_id);
-- ambiguous/unresolved לעולם לא חויבו:
select count(*) from inbound_attributions a join billed_results b on b.provider_ref=a.inbound_message_id and b.channel='whatsapp'
 where a.resolution_status in ('ambiguous','unresolved') and a.mode='strict';
```

**בקרת הסט הדינמי ביחס ללדג'ר (חבר-סט שטרם קיבל הודעה — Q1):**
```sql
select count(*) from campaign_authorized_contacts a join campaigns k on k.id=a.campaign_id
 where k.status in ('active','paused')
   and not exists (select 1 from contact_interactions o where o.direction='out' and o.channel='whatsapp' and o.campaign_id=k.id and o.contact_id=a.contact_id);
-- תחת strict: כל הודעה מחבר כזה חייבת להופיע כ-unresolved(no_valid_candidate), לעולם לא billed.
```

---

## 4. סתירות ודיוקים מול שלושת המסמכים ומול הנחיית המשימה

| # | מקור | מה נכתב | מה נמצא | תיוג |
|---|---|---|---|---|
| 1 | הנחיית המשימה (Q1) | "the one active-campaign member who has a prior outbound" | לחבר היחיד בסט של קמפיין פעיל **אין** אף out (חי, §1 Q1). תואם הביקורת הראשית §1.6/§1.8. | **CONTRADICTED** (ההנחיה, לא המסמכים) |
| 2 | הביקורת הראשית §4 שורה "עיבוד", §2 שורת reprocess | reprocess: "fresh=false → RPC לא נקרא; הסרה נשמרת" | נכון, אך חסר: ההסרה נכתבת על ה-contact **המחושב-מחדש**, שיכול להיות שונה מהשמור (3/29 היום). ובנוסף: כשל **לפני** ה-insert → ה-retry מחליט לפי מצב ה-DB ברגע ה-retry. | דיוק (לא סתירה) |
| 3 | מסמך ה-DB §6 ש10 | "19 נפתרו דרך context" על סמך `context_message_id IS NOT NULL` | אומת בצורה חזקה יותר: ל-30/30 השורות עם context קיים out תואם **והצמד השמור שווה לצמד של ה-out**. | חיזוק (PROVEN) |
| 4 | מסמך ה-DB "הפתעה 1" | grants ברירת-מחדל ל-anon/authenticated על **7** טבלאות | גם `campaign_authorized_set_audit` נושאת את אותם grants (חי: `aclexplode`), אף שיש לה טריגר append-only — הטריגר אינו חוסם `TRUNCATE`. הטבלה ה-8. | הוספה |
| 5 | הביקורת הראשית §8.1 | "reaction → להשתמש ב-`reaction.message_id` כ-context" | 2/2 ה-reactions החיים מצביעים על הודעה **שאינה** out מתועד; לכן חייב fall-through לשלב 3, אחרת שתיהן היו `unresolved` בעוד היום הן שויכו (ולא חויבו רק כי הקמפיין סגור). | דיוק |
| 6 | הביקורת הראשית §9 שלב 5 | shadow נרשם ב-`payload_meta.shadow_attribution` | מוחלף בלדג'ר טבלאי (דרישת המטרה: מצבים נפרדים, append-only, מפתח אידמפוטנטי). | עדכון עיצוב |
| 7 | הביקורת הראשית §1.3 W1 / מסמך ה-DB | `pgboss.queue: retry_limit=2` | אומת שוב: `standard, retry_limit 2, retry_delay 0, expire 900`. שכבת retry נפרדת מ-`webhook_inbox.attempts<5`. | PROVEN |
| 8 | הביקורת הראשית §1.8 | "`phone_number_id` שונים בשורות message: 3" | 3 דליים: מספר ה-RSVP 74, מספר שני 7, sandbox 5. **6 מ-7** הודעות המספר השני יצרו אינטראקציה — ניתוב זהה בפועל, לא רק בתיאוריה. | חיזוק |
| 9 | מסמך Meta §4.3 (פסקת INFERENCE אחרונה) | "השליחות היוצאות משתמשות ב-URLComponent ולא ב-PayloadComponent … `button.payload` שווה ל-`text`" | KALFA מזריקה `PayloadComponent` לכל כפתור quick-reply מאז 2026-07-07 (`client.ts:185-191`, `rsvp-buttons.ts:15-28`); חי: 26 לחיצות עם ids סטטיים, 6 לחיצות ישנות (5–7.7) עם תווית. `URLComponent` משמש כפתורי URL בלבד. | **CONTRADICTED** |
| 10 | הנחיית המשימה (Q6) | "retry cannot bill a different campaign" | נכון רק כשהאינטראקציה כבר נכתבה; כשל **לפני** ה-insert → ה-retry הוא הכותב הראשון ומחליט לפי מצב מאוחר (Q6 ב). | דיוק |

**דברים שלא ניתן היה לאמת מכאן:** (א) היקף ייחודיות wamid — **UNDOCUMENTED** לפי מסמך Meta §2.1 (לא רק לא-מאומת כאן); (ב) האם `interactive` (button_reply/list_reply) תמיד נושא `context` — **UNVERIFIED**, מסמך Meta §3 (חי: המופע היחיד בלי context); (ג) אורך/charset של `button.payload` בתבנית — **UNVERIFIED** (מסמך Meta §4.3; רק `button_reply.id ≤256` מתועד); (ד) שיוך שונה ב-retry **שקרה בפועל** — **UNVERIFIED**, אוכלוסייה ריקה (retry יחיד, לא billable).

---

## 5. קבצים ואובייקטים שנקראו במלואם / נשלפו חי

קוד: `src/lib/data/interactions.ts`, `webhook-processing.ts`, `billing.ts`, `webhooks.ts`, `src/lib/whatsapp/inbound.ts`, `rsvp-buttons.ts`, `client.ts` (185-245), `src/app/api/webhooks/whatsapp/route.ts` (130-330), `worker/main.ts` (276-300, 480-512, 918-930, 1110-1120), `src/app/(admin)/admin/webhooks/actions.ts`, `webhook-detail.tsx` (300-332), `src/lib/data/admin/webhook-inbox.ts` (100-200), `call-result-processing.ts` (80-125), `outreach.ts` (55-110), `whatsapp-import.ts` (320-336), `reconcile-config.ts`, `src/app/(admin)/admin/channels/actions.ts` (210-245), `src/lib/queue/queues.ts`; מיגרציות `20260903214126`, `20260712104001`, `20260712104117` (ACL); בדיקות קיימות (שמות מקרים): `webhook-processing.test.ts` (28), `interactions.test.ts` (20), `inbound.test.ts` (18), `billing.test.ts` (14), `route.test.ts` (32); `node_modules/whatsapp-api-js/lib/types.d.ts` (`ServerMessage.context`, `ServerReactionMessage`, `referral`) — טיפוסי ספרייה, לא תיעוד Meta.

DB חי (2026-09-04): `pg_constraint`/`pg_indexes`/`pg_attribute` ל-`billed_results`, `contact_interactions`, `webhook_inbox`, `app_settings`; `aclexplode` ל-`billed_results`, `campaign_authorized_set_audit`, `webhook_deliveries`; `pgboss.queue`; אגרגטים על `webhook_inbox`, `contact_interactions`, `billed_results`, `contacts`, `campaigns`, `events`, `campaign_authorized_contacts` (כל השאילתות מצוטטות לעיל).
