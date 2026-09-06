# חקירת שיוך הודעות WhatsApp נכנסות → חיוב: דוח מסכם ותוכנית (2026-09-04)

> **סטטוס: חקירה בלבד (read-only).** לא שונה קוד, schema או נתוני production. אין ליישם דבר מהתוכנית לפני סקירה ואישור מפורש של הבעלים.
> מבוצע לפי `docs/whatsapp-billing-audit-goal.md`. תיעוד Meta נשלף דרך `ctx7` מהספרייה `/websites/developers_facebook_business-messaging_whatsapp` (33 קריאות, כולן בנספח א' של מסמך Meta). כל טענה מתויגת **PROVEN** (קוד/DB חי) · **DOCUMENTED (Meta)** עם URL · **INFERENCE** · **UNVERIFIED** · **CONTRADICTED**. ללא PII.

## מסמכי החקירה (קריאה חובה לפני אישור)

| מסמך | תוכן |
|---|---|
| **מסמך זה** | 13 התוצרים בתמצית, תשובות Q1–Q12, טבלת סיכונים, מטריצת החלטה, שער האישור |
| [`whatsapp-billing-audit-2026-09-04-repo.md`](./whatsapp-billing-audit-2026-09-04-repo.md) | ראיות מהריפו וה‑DB החי ל‑Q1–Q8 (file:line, SQL), הערכת ההיררכיה, **העיצוב המלא**: לדג'ר, RPC אטומי, קוד לפי קובץ, בדיקות, shadow, מדדים, rollback, שאילתות אימות |
| [`whatsapp-billing-audit-2026-09-04-meta.md`](./whatsapp-billing-audit-2026-09-04-meta.md) | עובדות Meta עם URL לכל טענה: מבנה webhook, wamid/from/BSUID, `context.id`, כפתורים/רשימות, סטטוסים ו‑`biz_opaque_callback_data`, retries/כפילויות/סדר, `referral`/`automatic_events`, endpoint השליחה |
| [`billing-attribution-audit-2026-09-04.md`](./billing-attribution-audit-2026-09-04.md) (+ `-db`, `-settle`) | הביקורת הקודמת מאותו יום: מפת זרימה, טבלת החלטה ל‑17 תרחישים, כל תוצאות ה‑RPC, נוסחת החיוב הסופי, הרשאות/אילוצים חיים |

---

## 1. זרימת הביצוע הנוכחית (תמצית; פירוט: ביקורת קודמת §1, repo §1)

`POST /api/webhooks/whatsapp` → אימות `X-Hub-Signature-256` (`route.ts`, SDK `verifyRequestSignature`) → נרמול: שורה לכל הודעה/סטטוס עם `phone_number_id`, `message_id`, `context_message_id`, `delivery_id` → `webhook_inbox` (`UNIQUE(provider, dedupe_key)`) → worker סדרתי יחיד (`worker/main.ts` → `processWebhookEvent`) → `processMessage` (`webhook-processing.ts`): קיצור‑דרך ייבוא → `classifyMessagePayload` (`inbound.ts`: billable = `text|button|interactive|reaction`) → `resolveByContextId` ואם אין → `resolveInboundContact` (טלפון → כל ה‑contacts בכל האירועים → ה‑`out` **האחרון** גלובלית, `.limit(1)`) → `insertInteraction` (`UNIQUE(channel, provider_id)` → `fresh`) → אם `fresh`: `recordReached` → RPC `try_record_billed_result` (`FOR UPDATE` על הקמפיין, שערים, `billed_results UNIQUE(event_id, contact_id)`) → `billing_outcome` נשמר → הסרה/RSVP/headcount. **PROVEN.**

## 2. שורש הבעיה (מאושר)

`src/lib/data/interactions.ts:87-94` — "ה‑`out` האחרון לטלפון מנצח", בלי תיחום לקמפיין פעיל, לחלון זמן, לחברות ברשימת הנמענים, למספר העסקי שקיבל, ובלי הבחנה בין מועמד יחיד לריבוי מועמדים. ה‑RPC בודק **האם מותר** לחייב את הצמד שהוזן — לא **האם זה הצמד הנכון**. **PROVEN** (repo §0, §1 Q4).

## 3. לקוח אחד או חיוב כפול — תשובה מדויקת

- **הרצה אחת של הודעה אחת מחייבת לכל היותר צמד אחד** (`.limit(1).maybeSingle()`; ואז `fresh` מונע קריאה שנייה ל‑RPC). **PROVEN.**
- **הודעה אחת לא יכולה לחייב שני קמפיינים** — אבל ההבטחה היא **בקוד** (`contact_interactions UNIQUE(channel, provider_id)` + `fresh`), **לא ב‑DB**: ל‑`billed_results` אין ייחודיות על `provider_ref`. **PROVEN** (repo Q7).
- **הודעה אחת יכולה להיות משויכת ללקוח הלא‑נכון** (טלפון משותף בין אירועים/לקוחות → "האחרון מנצח"). חי: 2 טלפונים ב‑>1 אירוע, 1 חוצה בעלים; 29/59 נכנסות עברו במסלול הניחוש; 8/59 היו מקבלות היום שיוך‑טלפון שונה מהשמור. עד היום **אף חשבונית לא הושפעה** (Σ `final_charge_amount` = ₪0). **PROVEN.**
- **טלפון אחד יכול לחייב שני אירועים לאורך זמן** (שתי הודעות שונות) — לגיטימי לפי המודל, וזו לא כפילות. **PROVEN.**
- **סימולציה של המדיניות המוצעת על ההיסטוריה** (N=14, חברות ברשימה כפי שהיא היום — קירוב): 29 שיוכי‑טלפון → 14 עם 0 מועמדים (אף אחד מהם לא חויב), 15 עם מועמד יחיד (כולל שני החיובים שנעשו לפי טלפון), **0 עם ≥2 מועמדים**; 30 שיוכי‑context → מועמד יחיד כל אחד. **אף חיוב קיים לא היה אובד, ואף מקרה לא היה הופך ל‑ambiguous.** **PROVEN** (repo §2.3).

## 4. תשובות Q1–Q12

| # | תשובה | תיוג |
|---|---|---|
| Q1 | **כן** — "היי" מחייב אם לטלפון יש `out` כלשהו והצמד עובר את שערי ה‑RPC. היום: 0 חברי‑רשימה בקמפיינים פעילים עם `out` → אין מי שיחויב כך כרגע | PROVEN |
| Q2 | `billable=true` = **סיווג לפי סוג הודעה בלבד**. 59 billable ↔ 21 חיובי WhatsApp | PROVEN |
| Q3 | ההוכחה היחידה = **שורת `billed_results`** (`provider_ref` = wamid, `evidence_source`, `locked_price`); `billing_outcome` הוא עותק נוחות | PROVEN |
| Q4 | אותו טלפון אצל שני לקוחות → ה‑`out` האחרון גלובלית, בלי סינון בעלות | PROVEN |
| Q5 | לקוח אחד להרצה; לא יותר | PROVEN |
| Q6 | retry של אותו wamid **מחשב שיוך מחדש**; לא יכול לחייב מחדש (`fresh=false`), אך `markContactRemovalRequested` רץ על ה‑contact **המחושב‑מחדש** (RSVP/headcount מוגנים ב‑`fresh`). אם הניסיון הראשון נכשל **לפני** ה‑insert — ה‑retry מחליט לפי מצב ה‑DB ברגע ה‑retry | PROVEN |
| Q7 | ב‑DB **אין** UNIQUE גלובלי על ראיית החיוב; ההבטחה בקוד | PROVEN |
| Q8 | `phone_number_id` נשמר (`route.ts`), **לא נקרא** בשום מודול עיבוד; 6/7 הודעות למספר השני יצרו אינטראקציה | PROVEN |
| Q9 | `context.id` מובטח בתגובה לרכיב ששלחנו (כפתור תבנית `type:button`, `button_reply`, `list_reply`, מיקום); **אין** בטקסט חופשי/מדיה; הודעה מועברת → `context` בלי `id`; ריאקציה → `reaction.message_id`; ציטוט ידני — לא בתיעוד | DOCUMENTED (Meta) · ציטוט ידני UNVERIFIED |
| Q10 | `biz_opaque_callback_data` מוחזר **רק** ב‑`statuses[]` של ההודעה היוצאת; לא בשום payload נכנס | DOCUMENTED (echo) · INFERENCE (היעדר בנכנס) |
| Q11 | **כן** — `button_reply.id` עד 256 תווים, `list_reply.id` ו‑`button.payload` בשליטת המפתח וחוזרים כמות שהם. KALFA כבר מזריקה payload לכל שליחה (`rsvp-buttons.ts:15-28`, `PayloadComponent`); 26 לחיצות חזרו עם ה‑id, 6 ישנות עם התווית. אורך/charset ל‑payload תבנית ולרשימה — לא נמצא | DOCUMENTED · PROVEN (ריפו) · אורכים UNVERIFIED |
| Q12 | **לא** — `automatic_events`/`referral` מוגבלים ל‑Click‑to‑WhatsApp (`ctwa_clid`, לידים/רכישות), opt‑in; אין שדה קמפיין/תבנית | DOCUMENTED · INFERENCE (אי‑תחולה) |
| ייחודיות wamid | Meta: "unique" **ללא scope** → המפתח הבטוח `UNIQUE(phone_number_id, inbound_message_id)` | UNVERIFIED (scope) · INFERENCE (מפתח) |
| retries | non‑200 → retry בתדירות יורדת עד 7 ימים; כפילויות מתועדות; batching עד 1000 לא מובטח; 3MB; **סדר לא מובטח**; dedup באחריותנו | DOCUMENTED (Meta) |
| BSUID | `messages.from` **Optional**, `from_user_id` **Required**; טלפון נעלם למאמצי username (30 יום לכל מספר עסקי) | DOCUMENTED (Meta) |

**CONTRADICTED:** הנחת המשימה "יש חבר קמפיין פעיל עם out קודם" — חי: לחבר היחיד **אין** out. הערת סוכן Meta "KALFA משתמשת ב‑URLComponent" — שגויה לכפתורי quick‑reply (PayloadComponent). ראו repo §4.

## 5. טבלת סיכונים (לפי חומרה)

| # | סיכון | חומרה | ראיה | היכן מטופל בתוכנית |
|---|---|---|---|---|
| R1 | **חיוב ללקוח הלא‑נכון** — טלפון משותף, "האחרון מנצח" | גבוהה (כסף + אמון) | repo Q4; חי 1 טלפון חוצה בעלים; ₪0 נזק עד היום | לדג'ר + מועמד‑יחיד/ambiguous (§6–8) |
| R2 | **חיוב על הודעה שאינה תגובה** ("היי", "טעות", 👍) | גבוהה (מדיניות) | `inbound.ts:11-16` | מדיניות `single_candidate_bills` + חלון N + שאלות מוצר |
| R3 | **חיוב תקין אובד לצמיתות** — RPC נכשל אחרי ה‑insert (`fresh=false`) / "האחרון" מצביע על קמפיין סגור | גבוהה (הכנסה) | ביקורת קודמת §6.1–6.2; `attempts=3` נצפה | RPC אטומי אחד + קרא‑לפני‑חשב |
| R4 | **ראיית חיוב בלי ייחודיות גלובלית ב‑DB** (`provider_ref`) | בינונית | repo Q7 | `UNIQUE(channel, provider_ref) WHERE NOT NULL` |
| R5 | **retry מסמן הסרה על contact אחר** | בינונית (משפטי) | repo Q6 | החלטה שמורה ואי‑חישוב‑מחדש |
| R6 | **מאמצי username בלי טלפון → לא מזוהים** | בינונית‑עולה | Meta §2.2 | `sender_user_id` בלדג'ר; שיוך לפי BSUID בשלב ב' |
| R7 | **מספר הייבוא מנותב כקמפיין** | בינונית | repo Q8 | סינון `phone_number_id` (`unknown_business_number`) |
| R8 | **`exposed_for_billing` טאוטולוגי** (gate כבוי) | נמוכה‑סמויה | DB doc | תיקון ל‑`direction='out'` לפני הדלקה |
| R9 | **grants TRUNCATE ל‑anon/authenticated על 8 טבלאות כסף** | בינונית (הגנת‑עומק) | DB doc + repo §4 | מיגרציית REVOKE נפרדת |
| R10 | `ON DELETE CASCADE` ברשימת הנמענים; אינדקס כפול ב‑campaigns | נמוכה | DB doc | נפרד |

## 6. מטריצת החלטה (המצב המוצע; המצב הנוכחי בביקורת הקודמת §2)

| סוג הודעה | שיטת שיוך | תוצאה | חיוב אוטומטי? |
|---|---|---|---|
| **קונטקסטואלית** (`context.id` תואם `out` שלנו) | `context` | `precise` | כן (ה‑RPC מחליט) |
| **אינטראקטיבית** (כפתור/רשימה) | `context` (Meta מצרפת) ← ואם חסר: payload אטום/`phone_single` | `precise`/`attributable` | כן / לפי מדיניות |
| **ריאקציה** | `reaction.message_id` כ‑context ← fall‑through למועמדים | `precise`/`attributable`/`unresolved` | לפי מדיניות (שאלת מוצר) |
| **טקסט חופשי** | מועמדים: טלפון (ובעתיד BSUID) × `phone_number_id` × חלון N × קמפיין+אירוע פעילים × ברשימה × לא הוסר | מועמד יחיד → `attributable`; אחרת ↓ | **רק** אם `single_candidate_bills=true` |
| **כפולה / retry** | קרא‑לפני‑חשב: החלטה שמורה מוחזרת | `stored=false` | לעולם לא מחדש |
| **ambiguous** (>1 מועמד תקף) | — | נשמר עם המועמדים (ids), התראה, מסך אדמין | **לא** (fail‑closed) |
| **unresolved** (0 מועמדים / אין `from` / מספר עסקי לא מוכר / מחוץ לחלון) | — | נשמר עם הסיבה | **לא** |

## 7. שינויי DB מוצעים (פירוט + SQL: repo §3.6)

1. טבלת לדג'ר **`inbound_attributions`** (append‑only, טריגר, RLS אדמין, REVOKE מ‑anon/authenticated): `phone_number_id, inbound_message_id, inbox_id, sender_id, sender_user_id, context_message_id, message_type, reply_id, received_at, resolution_status, resolution_method, resolution_reason, resolved_event/campaign/contact_id, candidates jsonb (ids), window_days, mode (shadow|strict), policy_bills_single, legacy_binding, legacy_outcome, billing_result, decided_at, decided_by`. **מפתח האידמפוטנטיות: `UNIQUE (provider, phone_number_id, inbound_message_id)`** — נכון גם אם wamid ייחודי גלובלית וגם אם לא. CHECK: binding מלא ↔ `precise/attributable`, NULL ↔ `ambiguous/unresolved`.
2. **`billed_results`: `UNIQUE (channel, provider_ref) WHERE provider_ref IS NOT NULL`** — ראיית החיוב הופכת ייחודית ב‑DB לכל הודעה נכנסת, לא רק בקוד. דורש שינוי קטן ב‑`try_record_billed_result`: `exception when unique_violation then return 'duplicate_provider_ref'` (ה‑`ON CONFLICT` הקיים מכסה רק `(event_id, contact_id)`; בלי זה חריגה → סערת retries עד `attempts=5`). מיגרציה עצמאית.
   *הערת הנחה:* `webhook_inbox.dedupe_key = 'wa-msg:<wamid>'` ו‑`contact_interactions UNIQUE(channel, provider_id)` **מניחים** ייחודיות גלובלית של wamid — Meta לא מתעדת scope (UNVERIFIED). חי: 82 wamid ייחודיים על 86 שורות, 0 wamid ביותר ממספר עסקי אחד. הלדג'ר לא תלוי בהנחה הזו.
3. `app_settings`: `inbound_attribution_strict boolean default false`, `inbound_reply_window_days int`, `inbound_single_candidate_bills boolean` — עם מתגים ב‑`/admin/channels` (כלל הבית: kill‑switch בלי UI ≠ גמור).
4. (נפרד) REVOKE הרשאות ברירת‑מחדל על 8 טבלאות הכסף; תיקון CASCADE; אינדקס כפול.

## 8. שינויי קוד לפי קובץ (פירוט: repo §3.7)

- `src/lib/data/interactions.ts` — `resolveInboundAttribution(...)` → איחוד מבחין `precise | attributable | ambiguous | unresolved` (מועמדים תקפים, חלון N, `phone_number_id`); הישן נשאר מאחורי הדגל.
- `src/lib/data/webhook-processing.ts` — `processMessage`: **קרא‑לפני‑חשב** (RPC מחזיר החלטה שמורה) → חישוב רק בפעם הראשונה → פעולה לפי `resolution_status`; ריאקציה משתמשת ב‑`reaction.message_id`; `phone_number_id` ≠ מספר ה‑RSVP → `unresolved('unknown_business_number')`.
- `src/lib/data/billing.ts` / SQL — RPC חדש **`record_inbound_attribution(...)`** שכותב לדג'ר **ו**קורא ל‑`try_record_billed_result` באותה טרנזקציה; `try_record_billed_result` — שינוי קטן יחיד (טיפול ב‑`unique_violation` של האינדקס החדש → `duplicate_provider_ref`).
- `src/lib/whatsapp/inbound.ts` — ללא שינוי בסיווג; **הסיווג לעולם אינו ראיה לחיוב לבדו** — הלדג'ר מאפשר חיוב רק כש‑`resolution_status ∈ {precise, attributable}`.
- `src/lib/whatsapp/rsvp-buttons.ts` — **לא מומלץ לבנות עכשיו** payload אטום לכל שליחה: חי, 32/32 לחיצות כפתור‑תבנית נושאות `context.id` (שיוך מדויק כבר קיים), הטוקן לא יכול לשאת את ה‑wamid היוצא (נוצר אחרי השליחה), וזה משנה פרוטוקול משותף. נשאר כבדיקה צולבת; לפתוח מחדש אם ה‑shadow יראה לחיצות בלי context.
- אדמין: `/admin/webhooks` (סעיף "שיוך": סטטוס, שיטה, מועמדים, `billing_result`), `/admin/channels` (מתגים), דו"ח shadow.

## 9. טרנזקציה ומקביליות (פירוט: repo §3.8)

גבול אטומי אחד = ה‑RPC החדש: `pg_advisory_xact_lock(hash(provider|phone_number_id|wamid))` → קריאת החלטה קיימת (אם יש → החזרה, אפס חישוב/חיוב) → `insert contact_interactions … on conflict do nothing` → `try_record_billed_result` (נועל את שורת הקמפיין `FOR UPDATE`) → `billing_outcome` → שורת לדג'ר יחידה עם התוצאה → `RETURNING`. `unique_violation` → החזרת השורה הקיימת. שני drains/retries על אותה הודעה מסתדרים בתור; מקביליות בין הודעות שונות נשארת. **הבטחות:** החלטה אחת בלתי‑משתנה להודעה · retry מחזיר את ההחלטה השמורה · הודעה אחת לא מחייבת שני צמדים (לדג'ר + `provider_ref` ייחודי) · ambiguous נכשל‑סגור · שיוך וחיוב מתחייבים יחד · קליטה/סיווג/שיוך/חיוב = ארבע טבלאות נפרדות (`webhook_inbox`+`webhook_deliveries` / `inbound_attributions` / `contact_interactions` / `billed_results`).

## 10. תוכנית בדיקות (פירוט: repo §3.9)

יחידה (vitest): `interactions.test.ts` (מועמד יחיד/ריבוי/אפס, חלון, מספר עסקי, BSUID בלי from), `webhook-processing.test.ts` (כל שורה במטריצה, החלטה שמורה ב‑retry, ריאקציה), `inbound.test.ts` (סיווג ללא שינוי). אינטגרציה: route → inbox → worker → לדג'ר → `billed_results`. Retry: אותה הודעה פעמיים עם `out` חדש בין לבין → אותה החלטה; RPC נכשל פעם אחת → החיוב קורה בדיוק פעם אחת בניסיון הבא. מקביליות (DB בדיקה, לא חי): שתי קריאות במקביל לאותה הודעה → שורת לדג'ר אחת; שני contacts שונים בגבול התקרה → אחד `billed`.

## 11. Shadow mode (פירוט: repo §3.10)

`inbound_attribution_strict=false` (ברירת מחדל): המסלול הישן פועל ומחייב כמו היום; החדש נכתב ללדג'ר עם `mode='shadow'`, `legacy_binding`/`legacy_outcome`. **הלדג'ר לא מחייב ב‑shadow.** view `inbound_attribution_shadow_report`: הסכמה/אי‑הסכמה בצמד, `legacy_billed_new_would_block` (המקרים שבהם היום חויב על ניחוש). קריטריון הדלקה: X ימים (הצעה 14) עם `disagree_binding=0` ואחרי סקירה ידנית של `legacy_billed_new_would_block`.

## 12. מדדים (repo §3.11)

התפלגות `resolution_status × method` ליום · שיעור הסכמה ישן↔חדש · שיעור ambiguous/unresolved · "חויב דרך fallback" · זמן‑להחלטה (p50/p95) · כפילויות שנחסמו (`duplicate_provider_ref`) · הודעות למספר לא‑RSVP. כולם כ‑views (`security_invoker`, admin בלבד) + כרטיס ב‑`/admin/webhooks`.

## 13. Rollback (repo §3.12)

1. **דגל** → `strict=false` במתג: המסלול הישן חוזר מיד; הלדג'ר ממשיך ב‑shadow. 2. **קוד** → revert; הלדג'ר נשאר, ה‑RPC ללא קורא. 3. **DB** → מיגרציות הפוכות בסדר index+RPC → RPC → טבלה → עמודות; לייצא את הלדג'ר לפני מחיקת הטבלה. הלדג'ר append‑only — גלגול לאחור לא "מתקן" היסטוריה, רק מפסיק לכתוב.

## 14. שאילתות אימות (repo §3.13 + ביקורת קודמת §9.1)

בסיס לפני: Q1 F, Q3 J, Q4 R, Q6 D/E, Q7 `pg_constraint`, Q8 G, §2.3 S. אחרי כל שלב: `inbound_attribution_shadow_report`, ספירת `billed_results` לפי `provider_ref` כפול (חייב 0), הודעות עם `attempts>0` ושיוך שונה (חייב 0 תחת strict).

---

## שער האישור — החלטות נדרשות לפני יישום

1. **חלון N** (הצעה: 14 יום, ניתן לשינוי באדמין).
2. **מה נחשב "הושג":** האם טקסט חופשי ("היי") מחייב כשיש מועמד יחיד (`single_candidate_bills`)? האם ריאקציה? מדיה היום לא — להשאיר?
3. **ambiguous:** מסך שיוך ידני (ואז RPC) או "לא לחייב לעולם".
4. **הסרה ("הסר")** — האם מחייבת; ב‑ambiguous — לסמן הסרה על כל המועמדים?
5. **מספרי בעלים/צוות** — לסנן מחיוב?
6. **מספר הייבוא** — לעולם לא קמפיין (הצעה: כן).
7. **payload אטום לכל שליחה** בכפתורי RSVP — כן/לא (Meta כבר נותנת `context.id`; מוסיף ביטחון למקרה התווית).
8. **סדר הביצוע:** קודם REVOKE‑grants (R9) או קודם הלדג'ר.

**עם אישור:** יישום בשלבים לפי repo §3.7–3.10 — מיגרציות (`supabase migration new` × 4, `db push` בעלים), RPC, קוד מאחורי דגל כבוי, shadow, השוואה, הדלקה. ללא אישור — לא נוגעים.
