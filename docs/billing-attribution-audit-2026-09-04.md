# ביקורת שיוך הודעות נכנסות → חיוב KALFA (2026-09-04)

> מצב: **ביקורת קריאה בלבד** — לא שונה קוד, לא שונה DB, לא נשלחה שום הודעה.
> כל טענה על קוד מצוטטת `file:line` מול העץ הנוכחי (branch `feat/b2c-entry-routing-event-summary`).
> כל טענה על ה-DB אומתה מול **ה-DB החי** (`supabase db query --linked`, `pg_get_functiondef` / `pg_constraint` / `pg_indexes`) ומסומנת VERIFIED-LIVE.
> מספרים = ספירות מצרפיות בלבד. אין בקובץ טלפונים, שמות או גופי הודעות.

**שאלת הביקורת:** כשמגיעה הודעת WhatsApp נכנסת — איך היא משויכת ל-guest → event → campaign → לקוח, ומתי השיוך הזה הופך לחיוב של KALFA?

**תשובה בשורה אחת:** השיוך הוא מדויק כשהתגובה נושאת `context.id` (מצטטת wamid יוצא שלנו), והוא **ניחוש "השולח האחרון מנצח"** בכל מקרה אחר; החיוב עצמו נעצר ב-RPC `try_record_billed_result` שהוא קו ההגנה האחרון — אבל ה-RPC בודק *האם מותר לחייב את הצמד (campaign, contact) שהוזן לו*, לא *האם זה הצמד הנכון*.

## 0. נספחים ותמונת הכסף (קריאה חובה לפני ההחלטות)

הדוח הזה הוא נקודת הכניסה. שני נספחים נכתבו במקביל, כל אחד מאומת בנפרד מול ה-DB החי:

| נספח | מה יש בו |
|---|---|
| [`billing-attribution-audit-2026-09-04-db.md`](./billing-attribution-audit-2026-09-04-db.md) | הגדרות חיות מלאות של כל פונקציה/טבלה/אילוץ/אינדקס/RLS/grant, השוואה מיגרציה↔DB (אין drift), נתונים מצרפיים, ניתוח מקביליות |
| [`billing-attribution-audit-2026-09-04-settle.md`](./billing-attribution-audit-2026-09-04-settle.md) | איך `billed_results` הופך לחשבונית: הנוסחה (`close-charge-amount.ts:39-48`), תזמון, זיכויים, SUMIT, ומה שורה שגויה/אבודה עושה לכסף |

**עובדות כסף שקובעות את הדחיפות (VERIFIED-LIVE 4.9.2026):**
- `Σ final_charge_amount` בכל המערכת = **₪0** — אף חשבונית אמיתית לא הושפעה עד היום; 22 החיובים הקיימים (₪88) כוסו כולם בזיכויים.
- שורת חיוב שגויה אחת משנה סכום **רק** כשהלקוח מעל `included_reached` ומתחת ל-`max_charge_ceiling` (‎+₪4); בקמפיינים הפעילים היום (200 כלולים / 200 ₪ בסיס) אף שורה אינה משנה סכום. חיוב תקין שאבד = ‎−₪4 באותם תנאים, **ואין דרך לשחזר** (אין job, "עיבוד מחדש" אינו מחייב שוב, ה-RPC מסרב לקמפיין סגור).
- החיוב מחושב **פעם אחת**, בפעולת סגירה ידנית באדמין; תגובות מאוחרות → `not_active`.
- **אין מנגנון ביטול לשורת חיוב בודדת**: `billed_results.control_status` / `manual_adjustment` הן עמודות ללא קורא, כותב או UI.
- **Meta ≠ KALFA:** Meta מחייבת את KALFA לפי שיחות/תבניות (`statuses[].pricing`); KALFA מחייבת את הלקוח לפי אורח שהושג. שום קוד חיוב אינו קורא את `pricing` של Meta (מוצג רק באינספקטור).
- **פער חוזה↔קוד:** ההסכם v4 קובע שדמי הבסיס נגבים בהפעלה; הקוד גובה הכול בסגירה.

**ממצאי DB שאינם שיוך אך דורשים טיפול (מהנספח הראשון):**
1. `anon`/`authenticated` מחזיקים INSERT/UPDATE/DELETE/**TRUNCATE** על `billed_results`, `campaigns`, `contacts`, `contact_interactions`, `campaign_authorized_contacts`, `webhook_inbox`, `guest_import_staging` (ברירת מחדל של Supabase שלא בוטלה; RLS אינו חל על TRUNCATE). חשיפה מעשית ≈ 0 היום; חסרה הגנת-עומק → מיגרציית REVOKE אחת (אחרי אימות שאין נתיב כתיבה מ-cookie-client).
2. `campaign_authorized_contacts.contact_id` עדיין `ON DELETE CASCADE` — ההגנה היא בקוד בלבד (`pruneOrphanContact`).
3. שני אינדקסים ייחודיים זהים על `campaigns(event_id) WHERE status <> 'cancelled'`.
4. סדר השומרים ב-RPC: בדיקת התקרה לפני ה-INSERT → retry על צמד שכבר חויב בקמפיין בדיוק בתקרה מחזיר `ceiling_reached` במקום `already_billed` (תווית בלבד, אפס השפעה כספית).

**מונחים:** `campaign_authorized_contacts` היא רשימת הנמענים של הקמפיין והיא **דינמית**: נוצרת בתפיסת המסגרת (J5) ע"י `snapshotAuthorizedSet` (`contacts.ts`, נקרא מ-`prepareCampaignHold`), ומכאן ואילך מתעדכנת בכל הוספה/החלפה/מחיקה של איש קשר דרך ה-RPC `reconcile_authorized_set` (אותו `FOR UPDATE` על שורת הקמפיין כמו ה-RPC של החיוב; מכניס עד `funded_cap`, מחזיר `added/swapped/removed/ceiling_full/not_eligible/…`; מתועד ב-`campaign_authorized_set_audit`). כותב שלישי ושקט: ה-FK `contact_id ON DELETE CASCADE`. אין "רשימה קפואה".

---

## 1. מפת הזרימה הנוכחית

### 1.1 הצד היוצא — איפה נרשם ה-wamid שהתגובות יזוהו מולו

| # | שלב | קוד |
|---|---|---|
| O1 | מנוע ה-drip שולח תבנית לאיש קשר אחד | `src/lib/data/outreach-engine.ts:440-449` (`executeStep` → `sendOneWhatsApp`) |
| O2 | שליחה ידנית / thank-you / event-day / gift (batch) | `src/lib/data/outreach.ts:420-436` (`sendCampaignWhatsApp` → `sendOneWhatsApp`) |
| O3 | ה-client מחזיר `providerId` = `messages[0].id` של Meta (ה-wamid היוצא) | `src/lib/whatsapp/client.ts:88-89`, טיפוס `DeliveryOutcome` ב-`client.ts:40-48` |
| O4 | **הרישום היחיד** של הודעת WhatsApp יוצאת: `contact_interactions` עם `direction='out'`, `kind='template'`, `provider_id=<wamid יוצא>`, `billable=false`, `message_key` | `src/lib/data/outreach.ts:90-108` (upsert על `channel,provider_id`) |
| O5 | thank-you: שורת claim-placeholder מוחלפת ב-wamid האמיתי אחרי השליחה | `src/lib/data/outreach.ts:449-465` |
| O6 | שיחה יוצאת (Voximplant): `direction='out'`, `kind='call_dialed'`, `provider_id=<callSessionHistoryId>` | `src/lib/data/outreach-calls.ts:121-136` |
| O7 | **לא נרשמות** כאינטראקציה: שאלת ה-headcount ואישורה (`sendWhatsAppText`) ותשובות הייבוא לבעלים | `src/lib/data/headcount.ts:62-65, 114-117, 145`; `src/lib/data/whatsapp-import.ts:395-403`; `sendWhatsAppText` עצמו אינו כותב ל-DB — `src/lib/whatsapp/client.ts:295-308` |

המשמעות: המזהה שכל השיוך המדויק נשען עליו הוא `contact_interactions.provider_id` של שורת `out`. הודעה יוצאת שנשלחה שלא דרך `sendOneWhatsApp` (O7) לא ניתנת לשיוך מדויק גם אם האורח מצטט אותה.

### 1.2 קליטה — Meta → `webhook_inbox`

| # | שלב | קוד |
|---|---|---|
| I1 | `POST /api/webhooks/whatsapp`: fail-closed אם `outreach_enabled=false` או אין `appSecret` (מחזיר 200, לא כותב) | `src/app/api/webhooks/whatsapp/route.ts:270-279` |
| I2 | אימות `X-Hub-Signature-256` דרך `whatsapp-api-js@6.2.2` (`verifyRequestSignature`); כישלון → 401 + התראת Slack ids-only, כלום לא נכתב | `route.ts:286-302`, `alertRejectedDelivery` `route.ts:232-250` |
| I3 | המעטפה המאומתת נשמרת verbatim ב-`webhook_deliveries` (UNIQUE `(provider, body_sha256)`), מזהה חוזר כ-`delivery_id` | `route.ts:316-320`; `src/lib/data/webhooks.ts:40-69` |
| I4 | נרמול **כל** ההודעות והסטטוסים במסירה (לא רק `[0]`): לכל הודעה שורה עם `dedupe_key='wa-msg:<wamid>'`, `message_id`, `context_message_id = message.context?.id`, `phone_number_id`, `payload` (+`sender_contact`) | `route.ts:152-225`; הודעות `route.ts:183-199` (שורות 189-192) |
| I5 | Insert אידמפוטנטי: UNIQUE `(provider, dedupe_key)` + `ignoreDuplicates` — retry של Meta = no-op | `src/lib/data/webhooks.ts:22-31`; VERIFIED-LIVE: `webhook_inbox_provider_dedupe_key_key UNIQUE (provider, dedupe_key)` |

### 1.3 ה-worker — claim ועיבוד

| # | שלב | קוד |
|---|---|---|
| W1 | תור pg-boss `webhook-process`, cron `* * * * *`, מדיניות `standard` (לא singleton), worker יחיד (`localConcurrency` ברירת-מחדל 1), תהליך pm2 יחיד | `src/lib/queue/queues.ts:10`; `worker/main.ts:922-927` (work), `worker/main.ts:1115` (schedule), `worker/main.ts:827-878` (רשימת ה-singletons — webhook לא בה); VERIFIED-LIVE `pgboss.queue`: `policy='standard', retry_limit=2, expire_seconds=900`; `ecosystem.config.cjs:47` (מופע יחיד) |
| W2 | `handleWebhook`: claim של עד 50 שורות → `processWebhookEvent` → `markWebhookEventProcessed`; כשל → `attempts+1` + `last_error` + Slack | `worker/main.ts:487-507` |
| W3 | ה-claim: RPC `claim_webhook_events(_limit)` = `select … where processed_at is null and attempts < 5 order by received_at for update skip locked` | `src/lib/data/webhooks.ts:77-86`; VERIFIED-LIVE: הגוף החי זהה ל-`supabase/migrations/202606300036_webhook_claim_skip_locked.sql` |
| W4 | dispatcher לפי `event_kind`: `message` → `processMessage` | `src/lib/data/webhook-processing.ts:77-81` |

**הערה על W3 (חשוב לסעיף 4):** ה-`FOR UPDATE SKIP LOCKED` חי רק בתוך טרנזקציית ה-RPC. ברגע שה-RPC מחזיר את השורות הנעילה משתחררת, ו-`processed_at` עדיין NULL עד סוף העיבוד. כלומר ה-claim מבטיח סטים זרים רק לשתי קריאות **בו-זמניות ממש**, לא לשני drains שמתחילים בהפרש של שניות. מה שמונע היום עיבוד כפול בפועל הוא ש-יש worker אחד סדרתי (W1) — לא ה-SKIP LOCKED.

### 1.4 `processMessage` — הלב

| # | שלב | קוד |
|---|---|---|
| P1 | בלי `message_id` → יציאה שקטה | `webhook-processing.ts:184-185` |
| P2 | **קיצור-דרך ייבוא** לפני כל לוגיקה: `document`/`contacts` משולח שהוא בעלים מאומת (`profiles.phone`) → staging, `return` | `webhook-processing.ts:190`; `src/lib/data/whatsapp-import.ts:289-393` (סוג `:298`, זיהוי שולח `:300-303`, ריבוי אירועים → לא מנחשים `:314-317`, אידמפוטנטיות לפי wamid `:326-334`) |
| P3 | סיווג: `billable` ⇔ `type ∈ {text, button, interactive, reaction}`; `removal` ⇔ מילת opt-out שלמה בטקסט/כותרת הכפתור; `replyId` = `button.payload` / `interactive.*.id` | `src/lib/whatsapp/inbound.ts:11-16, 22-37, 79-86, 110-119` |
| P4 | לא billable → יציאה שקטה (אין שורת אינטראקציה) | `webhook-processing.ts:193` |
| P5 | **שיוך**: קודם `resolveByContextId(context_message_id)`, ואם אין/לא נמצא — `resolveInboundContact(payload.from)` | `webhook-processing.ts:195-198` |
| P5a | `resolveByContextId`: שורת `out` שה-`provider_id` שלה = ה-`context.id` (ללא סינון ערוץ/סטטוס/זמן) → `(event, campaign, contact)` | `src/lib/data/interactions.ts:112-133` |
| P5b | `resolveInboundContact`: כל ה-`contacts` עם אותו `normalized_phone` — **בכל האירועים ובכל הלקוחות** — ואז שורת ה-`out` **האחרונה** ביניהן (`order created_at desc limit 1`, כולל `call_dialed`) → `(event, campaign, contact)` שלה | `src/lib/data/interactions.ts:72-104` (שורות 79-82, 87-94) |
| P6 | לא שויך → יציאה שקטה: **אין שום עקבה** מלבד `webhook_inbox.processed_at` | `webhook-processing.ts:199` |
| P7 | `insertInteraction(direction='in', kind='message', provider_id=<wamid נכנס>, billable=true, context_message_id)` — upsert על UNIQUE `(channel, provider_id)`; `fresh=true` רק אם השורה הוכנסה עכשיו | `webhook-processing.ts:203-213`; `interactions.ts:37-46` |
| P8 | רק אם `fresh`: `recordReached` → RPC `try_record_billed_result(event, campaign, contact, 'whatsapp', attempt=wamid, evidence='whatsapp_inbound_message' \| 'whatsapp_inbound_removal', provider_ref=wamid)`; על `'billed'` → `contacts.op_status='reached_billed'` | `webhook-processing.ts:215-226`; `src/lib/data/billing.ts:32-49` |
| P9 | תוצאת ה-RPC נשמרת ב-`contact_interactions.billing_outcome` של השורה הנכנסת (מאז 2026-09-03) | `webhook-processing.ts:229-235`; `interactions.ts:53-66`; מיגרציה `20260903214126_webhook_deliveries_and_outcomes.sql:85-92` |
| P10 | `removal` → `contacts.removal_requested=true` (**אחרי** החיוב, בכוונה; רץ גם על re-process) | `webhook-processing.ts:242-244`; `interactions.ts:175-184` |
| P11 | כפתור RSVP מוכר (`rsvp_attending/declined/maybe`) + `fresh` + **בדיוק אורח אחד** מאחורי ה-contact → `submitRsvp` → `activity_log 'rsvp.from_whatsapp'` → headcount ask | `webhook-processing.ts:256-285`; `src/lib/whatsapp/rsvp-buttons.ts`; `interactions.ts:198-215` |
| P12 | טקסט חופשי + `fresh` → `handleHeadcountReply` (רק ספרה 0-10, רק אורח אחד ממתין) | `webhook-processing.ts:290-295`; `headcount.ts:79-150` |

### 1.5 ה-RPC `try_record_billed_result` — VERIFIED-LIVE

הגוף החי **זהה** ל-`supabase/migrations/20260902062917_reconcile_funded_cap_floor_included.sql:244-314` (אין drift). סדר השומרים ותוצאותיהם:

| # | שומר | תוצאה |
|---|---|---|
| 1 | `select … from campaigns where id=p_campaign for update` — לא נמצא | `no_campaign` |
| 2 | `p_event <> campaigns.event_id` (האירוע נלקח מהקמפיין, לא מהקורא) | `event_mismatch` |
| 3 | `status not in ('active','paused')` | `not_active` |
| 4 | `start_at` בעתיד | `before_window` |
| 5 | `close_at` בעבר | `closed_window` |
| 6 | יום האירוע (Asia/Jerusalem) כבר עבר | `event_passed` |
| 7 | `events.status <> 'active'` | `event_not_active` |
| 8 | `contacts.removal_requested` | `removal_requested` |
| 9 | `app_settings.billing_exposure_gate` — **OFF חי (VERIFIED-LIVE)** → הבדיקה בפועל היא **חברות ב-`campaign_authorized_contacts (campaign, contact)`** ותו לא; `exposed_for_billing` **אינו נקרא** במצב הזה (ומחזיר `no_exposure` רק תחת gate ON) | `not_authorized` / `no_exposure` |
| 10 | תקרת ספירה: OFF → `greatest(max_contacts, included_reached)`; ON → `least(greatest(max, included), included + floor((auth − base)/price))`, fail-closed ל-0 בלי בסיס כספי; `count(billed_results where campaign_id) >= cap` | `ceiling_reached` |
| 11 | `insert into billed_results(... locked_price = campaigns.price_per_reached ...) on conflict (event_id, contact_id) do nothing` | `already_billed` אם לא הוכנס, אחרת **`billed`** |

מפתחות ואינדקסים חיים (VERIFIED-LIVE, `pg_constraint`/`pg_indexes`):

| טבלה | מפתח |
|---|---|
| `billed_results` | `billed_results_event_contact_unique UNIQUE (event_id, contact_id)`; FKs `ON DELETE RESTRICT` ל-events/campaigns/contacts; אינדקס `(campaign_id)` |
| `contact_interactions` | `contact_interactions_provider_unique UNIQUE (channel, provider_id)`; `event_id/campaign_id/contact_id` **nullable**; FK contact `ON DELETE SET NULL`, event/campaign `ON DELETE CASCADE`; אין אינדקס על `provider_id` לבדו ולא על `normalized_phone` לבדו ב-`contacts` |
| `contacts` | `contacts_event_phone_unique UNIQUE (event_id, normalized_phone)` — **כפילות באותו אירוע בלתי אפשרית** |
| `campaign_authorized_contacts` | `UNIQUE (campaign_id, contact_id)`; FK contact `ON DELETE CASCADE` |
| `campaigns` | `campaigns_event_noncancelled_uidx UNIQUE (event_id) WHERE status <> 'cancelled'` — קמפיין לא-מבוטל אחד לאירוע |
| `webhook_inbox` | `UNIQUE (provider, dedupe_key)` |
| `webhook_deliveries` | `UNIQUE (provider, body_sha256)` |

`exposed_for_billing` (חי, **לא בשימוש כל עוד gate OFF**): `exists billed_results(event, contact)` **או** (whatsapp ו-`exists contact_interactions where campaign=p_campaign and contact=p_contact and billable and direction='in' and channel='whatsapp'`) **או** (call ו-`outreach_state.call_request_count > 0`). ל-WhatsApp ההגדרה **מעגלית**: "חשיפה" := קיימת אינטראקציה נכנסת billable — שזו בדיוק השורה ש-`processMessage` מכניס צעד אחד לפני קריאת ה-RPC. ראו סעיף 5.5.

### 1.6 הסט המורשים `campaign_authorized_contacts` — **דינמי, לא קפוא** (VERIFIED-LIVE)

הסט הוא **הבסיס היחיד** לשומר 9 של ה-RPC (gate OFF) ולסינון הנמענים של המנוע, ולכן חשוב לומר במדויק איך הוא משתנה:

| # | שלב | קוד / DB |
|---|---|---|
| S1 | **אכלוס ראשוני** בזמן ה-hold (J5): `snapshotAuthorizedSet(event, campaign, coverage)` — כל ה-`contacts` של האירוע שיש להם guest, לא הוסרו, ממוינים לפי `created_at`, עד `coverage`; סמנטיקת REPLACE (מוחק חברים שאינם ברשימה החדשה, מוסיף חדשים) | `src/lib/data/contacts.ts:432-500`; נקרא מ-`prepareCampaignHold` `src/lib/data/campaigns.ts:707` |
| S2 | **אחרי ה-hold — כל מוטציית guest מעדכנת את הסט**: `reconcileCampaignSetForContact(event, op, contact, prev?)` נקרא על add / repoint / delete של contact, לכל קמפיין של האירוע במצב `approved/scheduled/active/paused` | `src/lib/data/contacts.ts:249-286`; קוראים: `guests-actions.ts:104-109` (add/repoint/delete מטופס), `guests.ts:567` (delete), `guests.ts:847` (bulk add), `import/import-actions.ts:286`, `import/whatsapp/actions.ts:158` |
| S3 | kill-switch: `RECONCILE_AUTHORIZED_SET_ENABLED` (env, לא app_settings) — **דלוק בייצור מאז 2026-07-21**; VERIFIED-LIVE: הערך קיים ב-`.env.local` | `src/lib/data/reconcile-config.ts:21-23` |
| S4 | ה-RPC `reconcile_authorized_set(p_event, p_campaign, p_op, p_contact, p_prev_contact, p_actor)` — **רץ תחת אותה נעילה `campaigns … FOR UPDATE` כמו ה-RPC של החיוב**, כך ששינוי סט וחיוב לאותו קמפיין מסודרים בתור | VERIFIED-LIVE (`pg_get_functiondef`), מיגרציה אחרונה `20260902062917` |
| S5 | סדר השומרים והתוצאות של ה-RPC: `no_campaign` → `event_mismatch` → `not_operational` (op לא מוכר / סטטוס לא תפעולי) → `funded_cap = least(greatest(max_contacts, included_reached), included_reached + floor((auth_amount − base_price) / price_per_reached))`, **fail-closed ל-0** בלי בסיס כספי → כשירות היעד: contact של האירוע, `removal_requested=false`, יש לו guest חי | — |
| S5a | `add`: כבר חבר → `noop`; לא כשיר → `not_eligible`; `size >= funded_cap` → `ceiling_full`; אחרת insert + שורת audit `('in','add')` → `added` | — |
| S5b | `repoint` (A→B): אם A לא חבר → כמו add; אם ל-A **אין** `has_service_exposure` → מחליפים A ב-B → `swapped`; אם ל-A **יש** חשיפה → A נשאר "pinned" ו-B נוסף רק אם כשיר ויש מקום → `pinned_kept` / `pinned_and_added` / `not_eligible` / `ceiling_full` | — |
| S5c | `delete`: לא חבר → `noop`; יש חשיפה → נשאר, audit `kept_exposed` → `pinned_kept`; אחרת delete + audit `('out','delete')` → `removed` | — |
| S6 | `has_service_exposure(campaign, contact)` (חי) = קיימת **כל** אינטראקציה `in`/`out` של הצמד, **או** `outreach_state.call_request_count > 0` / `reached_at not null`, **או** `billed_results` כלשהו ל-contact. חבר "חשוף" לעולם לא מוסר מהסט. | VERIFIED-LIVE |
| S7 | audit: `campaign_authorized_set_audit` — VERIFIED-LIVE: 2 × `in/add`, 1 × `out/delete` (ה-reconcile **פעל בפועל** 3 פעמים) | — |
| S8 | **הסט → המנוע**: `handleArm` (cron כל דקה) קורא `seedOutreachState(event, campaign)` לכל קמפיין `active`: קורא את **הסט הנוכחי** ומבצע upsert (`ignoreDuplicates`) של שורת `outreach_state (campaign, contact)` — כלומר contact שנוסף לסט דרך reconcile נכנס למנוע תוך דקה. **אין** מסלול שמוחק שורת `outreach_state` כשחבר יוצא מהסט (רק CASCADE על מחיקת ה-contact — VERIFIED-LIVE FK `ON DELETE CASCADE`). `resolveSendableContacts(event, campaign)` (המסלול הידני/thank-you) עושה INNER JOIN לסט **בזמן השליחה**. | `worker/main.ts:513-525`; `src/lib/data/outreach-engine.ts:71-96`; `src/lib/data/sendable-contacts.ts:33-50` |

**המסקנה המפורשת שנגזרת מכאן:** contact נכנס לסט **ברגע שהאורח נוסף לאירוע** (S2), עוד **לפני** שנשלחה לו הודעה כלשהי. שומר 9 של ה-RPC יעבור עבורו מיד. הדבר **היחיד** שמונע חיוב על "היי" מאורח שנוסף וטרם קיבל הודעה הוא ש-`resolveInboundContact` דורש שורת `direction='out'` קודמת (`interactions.ts:87-94`) — בלי שורה כזו הוא מחזיר `null` וההודעה נזרקת (P6). זה מנגנון של הקורא, לא של ה-DB, ואין לו כפיל בשכבת ה-RPC (gate OFF). VERIFIED-LIVE: כרגע יש **חבר אחד** בסט של קמפיין פעיל **בלי שום הודעה יוצאת**; כל 39 חברי הסטים הסגורים קיבלו הודעה.

**מה זה אומר על המספרים בסעיף 1.5 שומר 10:** `funded_cap` של reconcile ו-`v_cap` של החיוב הם **אותה נוסחה** (מאז 2026-09-02, floor ב-`included_reached`), כך שסט שגדל דרך reconcile לעולם לא עובר את מה שהחיוב מוכן לספור.

`campaign_billing_summary` (חי): `count(billed_results)`, `Σ locked_price`, `campaigns.max_charge_ceiling`, `campaigns.max_contacts` — הבסיס ל-close-charge (`billing.ts:66-85`).

### 1.7 קוראים נוספים של אותו RPC

| קורא | מסלול | הבדל מהותי |
|---|---|---|
| WhatsApp נכנס | `webhook-processing.ts:216` → `recordReached` (ישירות, לא `writeReach`) | מגודר ב-`fresh`; שומר `billing_outcome` |
| שיחה שהושלמה / handed-off | `src/lib/data/call-result-processing.ts:110-122` → `writeReach` (`outreach-engine.ts:476-482`) → `recordReached` | **לא** מגודר ב-`fresh` (בכוונה, `call-result-processing.ts:88-94`); **לא** שומר `billing_outcome`; מעדכן גם `outreach_state='reached'` |
| headcount / RSVP מקישור / ייבוא | — | אינם מחייבים |

עצירת-על-הגעה של מנוע ה-drip נשענת על `billed_results (event, contact)` ולא על `outreach_state` — `outreach-engine.ts:166-177, 266`.

### 1.8 מספרים חיים (VERIFIED-LIVE, מצרפי)

| מדד | ערך |
|---|---|
| `billed_results` | 22 = 21 `whatsapp_inbound_message` (₪84, 2026-07-07..10) + 1 `voximplant_call_completed` (₪4, 2026-07-22); כולם `control_status='confirmed'` |
| `contact_interactions` נכנסות WhatsApp (`billable=true`) | 59: 30 עם `context_message_id`, 29 בלי |
| מהן עם `billing_outcome` | 3 × `not_active` (מאז 3.9); 56 × NULL (לפני 3.9) |
| נכנסות `call` (`billable=true`) | 7 — ורק 1 חויבה; ל-6 אין שום רישום של סיבת אי-החיוב |
| יוצאות | 105 WhatsApp, 2 call |
| נכנסות חוזרות על צמד (event, contact) שכבר חויב | 36 |
| נכנסות billable שמעולם לא הובילו לחיוב על הצמד שלהן | 2 (2 צמדים) |
| `webhook_inbox` `message` | 86: button 32, text 32, contacts 15, reaction 2, document 2, interactive 1, audio 1, image 1; 3 בלי `from` |
| קמפיינים | 2 active (סט מורשים בגודל 1 ו-**0**), 1 approved, 2 closed |
| טלפונים שמופיעים ביותר מאירוע אחד | 2, מהם 1 אצל שני בעלים שונים |
| טלפונים עם יוצאות ביותר מקמפיין אחד | 1 |
| טלפונים שהיוצאת האחרונה שלהם בקמפיין לא-פעיל בעוד יוצאת ישנה יותר בקמפיין פעיל | 0 |
| דגלים | `billing_exposure_gate=false`, `base_overage_pricing_enabled=true`, `outreach_enabled=true`; `RECONCILE_AUTHORIZED_SET_ENABLED=true` קיים ב-`.env.local` |
| `phone_number_id` שונים בשורות `message` | 3 |
| `campaign_authorized_set_audit` (פעולות reconcile שבוצעו בפועל) | 3: 2 × `in/add`, 1 × `out/delete` |
| חברי סט בקמפיין **פעיל** ללא אף הודעה יוצאת | 1 (מתוך 1); בקמפיינים הסגורים: 0 מתוך 39 |
| `outreach_state` לפי סטטוס | 1 active, 19 exhausted, 20 reached |

---

## 2. טבלת החלטה

מקרא: **מסלול** = C (context.id) / P (phone fallback) / — ; **מחויב?** = כן / לא / לא ודאי (תלוי בשומרי ה-RPC לאותו צמד).

| תרחיש | מסלול שיוך | מי משויך | `insertInteraction` | תוצאת RPC צפויה | מחויב? | הפניה |
|---|---|---|---|---|---|---|
| תגובה עם `context.id` תואם ליוצאת שלנו | C | הצמד של אותה יוצאת בדיוק | כן (`fresh` בפעם הראשונה) | `billed` אם כל השומרים עוברים | כן | `webhook-processing.ts:195-197`; `interactions.ts:112-133` |
| טקסט חופשי בלי context, מועמד אחד בלבד בטלפון | P | הקמפיין של היוצאת האחרונה לאותו contact | כן | `billed` / `already_billed` | כן | `interactions.ts:72-104` |
| לחיצת כפתור / interactive | C (Meta מצרפת `context` לתשובת quick-reply) — ואם חסר, P | לפי context | כן | `billed`; בנוסף RSVP רק אם אורח יחיד | כן | `webhook-processing.ts:256-285` |
| **reaction** (👍 על ההזמנה) | **P בלבד** — `reaction.message_id` קיים ב-payload אך אינו נקרא; `message.context` אין | היוצאת האחרונה בטלפון | כן | `billed` | **כן** | `inbound.ts:11-16`; `route.ts:191` קורא רק `message.context?.id` |
| הודעה שאינה תגובת אורח (בדיקת בעלים, "היי", זר) | זר: — ; בעלים/מכר שהוא contact עם יוצאת קודמת: P | זר: אף אחד; אחרת: הצמד של היוצאת האחרונה | זר: לא (יציאה שקטה); אחרת: כן | זר: —; אחרת לפי מצב הקמפיין (היום: `not_active` ×3) | זר: לא; אחרת **לא ודאי** — אם הקמפיין פעיל והוא בסט → `billed` | `webhook-processing.ts:199, 215-236` |
| כפילות/retry של Meta לאותו wamid | — (לא נוצרת שורת inbox שנייה) | — | לא (ואם reprocess: `fresh=false`) | RPC לא נקרא | לא | `webhooks.ts:22-31`; `interactions.ts:37-46` |
| אותו טלפון בכמה אירועים של **אותו לקוח** | P | **השולח האחרון** בין כל האירועים | כן | `billed` לצמד שנבחר (החיוב הוא לפי `(event, contact)`, ולכן כל אירוע יכול לחייב פעם אחת) | כן — אך ייתכן **לאירוע הלא-נכון** | `interactions.ts:79-94` |
| אותו טלפון באירועים של **שני לקוחות שונים** | P | השולח האחרון, **בלי כל סינון בעלות** | כן | `billed` לצמד שנבחר | כן — ייתכן **הלקוח הלא-נכון** (סעיף 5.1) | `interactions.ts:79-94` |
| כפילות contacts באותו אירוע | לא ייתכן | — | — | — | — | VERIFIED-LIVE `contacts_event_phone_unique` |
| כמה קמפיינים אפשריים לטלפון | P | השולח האחרון (כולל `call_dialed`) | כן | לפי אותו קמפיין | כן | `interactions.ts:87-94` |
| היוצאת האחרונה מקמפיין **סגור**, ישנה יותר מקמפיין **פעיל** | P | הקמפיין הסגור | כן — השורה נרשמת על הסגור | `not_active` | **לא** — ההגעה הלגיטימית לפעיל **אובדת**; הודעה מאוחרת תחזור על אותו ניתוב כל עוד הפעיל לא שלח שוב **אחרי** הסגור, אלא אם האורח מצטט (C) הודעה של הפעיל | `interactions.ts:87-94`; RPC שומר 3 |
| הודעה >N ימים אחרי השליחה האחרונה | C או P — **אין שום גבול זמן** בקוד השיוך | הצמד הרגיל | כן | תלוי רק בחלון הקמפיין/תאריך האירוע/סטטוס | כן (עד `close_at`/יום האירוע) | `interactions.ts:72-133`; RPC שומרים 4-7 |
| תגובת הסרה ("הסר") | C או P | הצמד הרגיל | כן | `billed` (evidence `whatsapp_inbound_removal`) ורק אחר כך `removal_requested=true`; תגובה נוספת → `removal_requested` | **כן** | `webhook-processing.ts:222-224, 242-244` |
| כפתור RSVP שגם מחייב | C | הצמד של התבנית | כן | `billed`; RSVP נרשם רק אם אורח יחיד | כן | `webhook-processing.ts:256-285` |
| הודעה למספר הייבוא החדש | **זהה לחלוטין** — `phone_number_id` נשמר ב-inbox אך `processMessage` אינו קורא אותו | לפי context/טלפון כרגיל | כן אם שויך | כרגיל | כן אם שויך | `route.ts:192`; `webhook-processing.ts:183-296` (אין התייחסות ל-`phone_number_id`) |
| נכנסת בלי `from` (BSUID בלבד) | C בלבד; בלי context → P לא מופעל | לפי context או אף אחד | רק אם C | כרגיל / — | רק אם C | `webhook-processing.ts:198` (`payload.from ? … : null`) |
| תשובת headcount ("3") | האורח מצטט את שאלת ה-headcount → C נכשל (אין שורת out לשאלה) → P | הקמפיין של התבנית האחרונה | כן | `already_billed` | לא (כבר חויב על הלחיצה) | `headcount.ts:62-65`; `interactions.ts:112-133` |

---

## 3. כל תוצאות `try_record_billed_result`

| תוצאה | משמעות עסקית | איפה נראית היום |
|---|---|---|
| `billed` | שורת `billed_results` נוצרה במחיר הנעול `price_per_reached`; ה-contact עובר ל-`reached_billed`; ה-drip נעצר לו | `contact_interactions.billing_outcome` (WhatsApp בלבד); `/admin/webhooks` פירוט: "חויב" (`webhook-detail.tsx:305-308` — מתבסס על `billed_results.provider_ref = wamid`, `admin/webhook-inbox.ts:146-150`) |
| `already_billed` | הצמד `(event, contact)` כבר חויב — תגובה שנייה/ערוץ שני | `billing_outcome` + תווית `labels.ts:247` |
| `not_active` | הקמפיין לא `active/paused` (סגור/מבוטל/מאושר-טרם-הופעל) | כנ"ל (`labels.ts:248`) — 3 שורות חיות |
| `event_not_active` | האירוע לא `active` | `labels.ts:249` |
| `event_passed` | יום האירוע עבר (Israel) | `labels.ts:250` |
| `not_authorized` | ה-contact לא בסט המורשים של הקמפיין (gate OFF) | `labels.ts:251` |
| `no_exposure` | (gate ON בלבד) אין הוכחת חשיפה | `labels.ts:252` |
| `ceiling_reached` | הספירה הגיעה לתקרה (כולל תקרה 0 מ-hold ריק) | `labels.ts:253` |
| `closed_window` / `before_window` | מחוץ ל-`[start_at, close_at]` | `labels.ts:254-255` |
| `removal_requested` | ה-contact כבר ביקש הסרה | `labels.ts:256` |
| `event_mismatch` | הקורא העביר event שאינו של הקמפיין (הגנה מפני באג) | `labels.ts:257` |
| `no_campaign` | הקמפיין לא קיים | `labels.ts:258` |
| `unknown` (צד קוד) | ה-RPC החזיר משהו שאינו מחרוזת | `billing.ts:44`; נשמר כ-`unknown` |

פערי נראות:
1. **מסלול השיחות לא שומר תוצאה** — `writeReach` מחזיר אותה ו-`processCallResult` זורק אותה (`call-result-processing.ts:110`). VERIFIED-LIVE: 7 נכנסות `call` billable, 1 מחויבת, 6 ללא סיבה.
2. **הודעה billable שלא שויכה** (P6) אינה נרשמת בשום מקום פרט ל-`processed_at`. הפירוט באדמין מציג "לא שויך לאף איש קשר/קמפיין" (`webhook-detail.tsx:327-330`) על בסיס היעדר שורה, לא על בסיס רישום פוזיטיבי.
3. 56 שורות היסטוריות עם `billing_outcome=NULL` — הפירוט מציג "תוצאת ה-RPC לא נרשמה" (`webhook-detail.tsx:314-318`).

---

## 4. מנגנון מניעת הכפל

| שכבה | מפתח | מה היא מונעת | מה היא **לא** מונעת |
|---|---|---|---|
| קליטה | `webhook_inbox UNIQUE (provider, dedupe_key)` = `wa-msg:<wamid>` | retry של Meta לאותה הודעה יוצר שורה אחת בלבד | שתי הודעות שונות מאותו אורח (wamid שונה) — וזה נכון |
| מעטפה | `webhook_deliveries UNIQUE (provider, body_sha256)` | אחסון כפול של אותו גוף | — (דיאגנוסטי בלבד) |
| עיבוד | `contact_interactions UNIQUE (channel, provider_id)` + `fresh` | RPC נקרא לכל היותר פעם אחת לכל wamid נכנס, גם ב-reprocess ידני (`actions.ts:28-31` מאפס `processed_at/attempts`) | ראו סעיף 6.2 — כשל **אחרי** ה-insert ולפני ה-RPC מאבד את החיוב לצמיתות |
| חיוב | `billed_results UNIQUE (event_id, contact_id)` + `on conflict do nothing` → `already_billed` | חיוב שני לאותו contact באותו אירוע, **בכל ערוץ** ובכל קמפיין של האירוע | חיוב של אותו טלפון בשני אירועים (זה מותר עסקית) |
| סריאליזציה | `select … from campaigns for update` בתחילת ה-RPC | שתי קריאות במקביל לאותו קמפיין מסודרות בתור → הספירה מול התקרה עקבית | — |
| drain | `claim_webhook_events … for update skip locked` | שני drains **בו-זמניים ממש** מקבלים סטים זרים | drain שני שמתחיל אחרי שהראשון קיבל את השורות (הנעילה שוחררה, `processed_at` עדיין NULL) — ראו 1.3 |
| תהליך | worker יחיד, `localConcurrency=1`, `policy='standard'` | בפועל: אין שני drains מקבילים באותו תהליך | מופע pm2 שני / `localConcurrency>1` בעתיד — אז רק ה-UNIQUE מגן |
| הסט (דינמי) | `reconcile_authorized_set` תחת `campaigns FOR UPDATE` — **אותה נעילה** כמו `try_record_billed_result`; `UNIQUE (campaign_id, contact_id)`; חבר חשוף (`has_service_exposure`) לעולם לא מוסר | שינוי סט וחיוב לאותו קמפיין אינם רצים בו-זמנית; contact שהוחלף אחרי שקיבל הודעה נשאר בסט (pinned) ולכן תגובתו עדיין ניתנת לחיוב; אין דרך "לצאת מהסט" כדי להימנע מ-`already_billed` ואז לחזור | הסט **לא** מונע חיוב לצמד שגוי — הוא בודק חברות, לא התאמה; ואינו מונע חיוב לחבר שנוסף וטרם קיבל הודעה (ראו 1.6, 5.7) |

תרחישים:
- **שני retry של Meta באותה שנייה:** שני POSTs → אותו `body_sha256` ואותו `dedupe_key` → שורת inbox אחת. אין כפל.
- **שני drains מקבילים (אם יהיו):** שניהם קוראים `insertInteraction` לאותו wamid → אחד `fresh=true` וקורא ל-RPC, השני `fresh=false` ומדלג; `removal` רץ פעמיים (אידמפוטנטי). RSVP/headcount מגודרים ב-`fresh`. אין כפל חיוב.
- **reprocess מהאדמין:** `fresh=false` → RPC לא נקרא; `billing_outcome` **לא** מתעדכן (P9 בתוך `if (fresh)`), הסרה נשמרת, RSVP לא נכפל. reprocess של הודעת ייבוא — no-op לפי `source_message_id` (`whatsapp-import.ts:326-334`).
- **שני ערוצים לאותו contact (WhatsApp ואז שיחה):** השני מקבל `already_billed` — הצמד `(event, contact)` הוא המפתח.

---

## 5. מצבים שבהם לקוח לא נכון עלול להיות מחויב

כל המצבים להלן נובעים מנקודה אחת: **`resolveInboundContact` בוחר צמד לפי "היוצאת האחרונה לטלפון" בלי לשאול אם הצמד הזה הוא זה שהאורח ענה לו**, וה-RPC בודק רק אם *מותר* לחייב את הצמד שהוזן.

### 5.1 אותו טלפון אצל שני לקוחות (VERIFIED-LIVE: קיים טלפון אחד כזה)
`interactions.ts:79-82` שולף `contacts` לפי `normalized_phone` **בלי סינון event/owner**; `:87-94` בוחר את היוצאת האחרונה. אם לקוח א' שלח ביום ראשון ולקוח ב' שלח ביום שני, ותגובת האורח ביום שלישי מיועדת לא' אבל הוקלדה (בלי ציטוט) — היא משויכת לב', נרשמת כאינטראקציה של ב', ואם קמפיין ב' פעיל וה-contact בסט שלו → **ב' מחויב** (`billed`), ו-א' מאבד את ההגעה. הסיכוי היום נמוך (טלפון אחד חופף) אבל המנגנון לא מגן.

### 5.2 אותו טלפון בשני אירועים של אותו לקוח
אותו מסלול. החיוב נופל על האירוע הלא-נכון (מחיר, תקרה, סיכום קמפיין וסגירת החיוב של האירוע הלא-נכון). הלקוח נכון, החשבונית לא.

### 5.3 הודעה שאינה תגובה בכלל
כל טקסט (כולל "היי", מדבקה בסוג `text`, או reaction) מטלפון שהוא contact עם יוצאת קודמת נספר כהגעה. אין שום סינון של מספרי בעלים/בדיקה (אימות: אין קריאה ל-`profiles` ב-`webhook-processing.ts`; הסינון היחיד של בעלים הוא בקיצור-דרך הייבוא, ורק ל-`document`/`contacts`). היום זה "רק" `not_active` כי הקמפיין הרלוונטי סגור; עם קמפיין פעיל וסט שכולל את המספר — `billed`.

### 5.4 reaction מחייב דרך ניחוש
`reaction` הוא billable (`inbound.ts:11-16`) אך אין לו `message.context`, ולכן תמיד עובר במסלול הטלפון — למרות שה-payload נושא את `reaction.message_id` (ה-wamid שעליו הגיבו). כלומר בדיוק במקום שיש מזהה מדויק, הקוד מנחש.

### 5.5 סיכון סמוי מתחת ל-`billing_exposure_gate=true` (כבוי היום)
`exposed_for_billing` מקבל כהוכחת חשיפה **כל שורת `contact_interactions` נכנסת billable של הצמד** — וזו בדיוק השורה ש-`processMessage` הכניס שורה אחת קודם (P7 לפני P8). כלומר תחת gate ON הבדיקה מתקיימת מעצמה לכל צמד שהשיוך בחר, גם אם לקמפיין הזה **אין** שורת `out` ל-contact. בפועל הסיכון ממותן כי `resolveInboundContact` מחזיר רק צמדים שיש להם `out`, אבל הפרדיקט עצמו לא מבטא "נשלחה לו הודעה מהקמפיין הזה" (`direction='out'`). לא לתקן עכשיו — לתעד לפני שמדליקים את ה-gate.

### 5.6 קמפיין פעיל עם סט מורשים ריק
VERIFIED-LIVE: אחד משני הקמפיינים הפעילים עם `set_size=0`. כל תגובה שתגיע אליו → `not_authorized`. זה לא חיוב שגוי — זה סימן שהאכלוס הראשוני בזמן ה-hold (S1) רץ כשלאירוע לא היו guests, ומאז לא נוסף אף guest (כל הוספה הייתה עוברת דרך reconcile, S2, שעם הנוסחה הנוכחית היה מקבל אותה עד `funded_cap`). הסט **אינו** קפוא — הוא פשוט ריק כי לא קרה בו כלום.

### 5.7 חבר סט שטרם קיבל הודעה — מוגן רק בצד הקורא
הסט הוא דינמי: contact נכנס אליו **ברגע ההוספה לאירוע** (`reconcileCampaignSetForContact(… 'add' …)`, `contacts.ts:249-286`), לפני כל שליחה. מרגע זה שומר 9 של ה-RPC (gate OFF = חברות בסט) עובר עבורו. אם הוא שולח "היי" למספר העסקי לפני שנשלחה לו הודעה, מה שמונע חיוב הוא **אך ורק** ש-`resolveInboundContact` לא מוצא שורת `out` ומחזיר `null` (`interactions.ts:87-98`). ה-RPC לבדו היה מחייב. VERIFIED-LIVE: יש כרגע חבר אחד כזה בקמפיין פעיל. המדיניות המוצעת בסעיף 8 הופכת את הדרישה הזו ("שליחה יוצאת קודמת מאותו קמפיין, בחלון") לתנאי מפורש של המועמד, ולא לתופעת-לוואי של סדר השאילתות.

---

## 6. מצבים שבהם חיוב תקין עלול ללכת לאיבוד

### 6.1 "השולח האחרון מנצח" מצביע על קמפיין סגור
תואר בסעיף 2. תוצאה: `not_active` על השורה, ההגעה לקמפיין הפעיל לא נרשמת, ותישאר כך כל עוד הפעיל לא שולח שוב **אחרי** השליחה האחרונה של הסגור. VERIFIED-LIVE: 0 טלפונים במצב הזה כרגע.

### 6.2 כשל בין ה-insert ל-RPC = אובדן לצמיתות
`processMessage` מכניס את האינטראקציה (P7) ורק אז קורא ל-RPC (P8) **בתוך `if (fresh)`**. אם `recordReached` זורק (תקלת DB/רשת רגעית — `billing.ts:43`), `processMessage` זורק, השורה מסומנת `attempts+1`, וב-retry הבא `insertInteraction` מחזיר `fresh=false` → **ה-RPC לא ייקרא לעולם** על ההודעה הזאת. ה-`billing_outcome` יישאר NULL. מסלול השיחות תוקן בדיוק מהסיבה הזו (`call-result-processing.ts:88-94`), מסלול WhatsApp לא. VERIFIED-LIVE: `max(attempts)=3` על שורות `message` — היו כשלים חוזרים; לא ניתן לדעת מהנתונים אם אחד מהם נפל בחלון הזה.

### 6.3 תגובה שנייה לגיטימית = `fresh=false`? לא — אבל `already_billed`
תגובה שנייה היא wamid חדש → `fresh=true` → RPC → `already_billed`. זה נכון עסקית (פעם אחת לצמד). האובדן האמיתי הוא רק בסעיפים 6.1/6.2.

### 6.4 קיצור-דרך הייבוא
`stageWhatsAppImport` מחזיר `true` (ובולע את ההודעה) רק ל-`document`/`contacts` משולח שהוא בעלים מאומת — סוגים שממילא אינם billable. אין אובדן חיוב כאן; הסיכון ההפוך (אורח ששולח כרטיס-קשר) נופל ל-`return false` ואז `billable=false` → אין שורה.

### 6.5 `phone_number_id` לא מוכר / מספר הייבוא
הנתיב לא מסנן לפי `phone_number_id` בכלל. תגובה שהגיעה למספר הייבוא תטופל כאילו הגיעה למספר ה-RSVP. זה לא מאבד חיוב — זה מייצר שיוך שאין לו בסיס (ההודעה לא נשלחה מהמספר הזה).

### 6.6 נכנסת בלי `from` (BSUID / usernames)
בלי `context.id` → `null` → אובדן שקט (P6). עם `context.id` → מסלול C עובד. VERIFIED-LIVE: 3 שורות כאלה (ככל הנראה מסירות Test של ה-App Dashboard).

### 6.7 היוצאת נשלחה מחוץ ל-`sendOneWhatsApp`
headcount / ייבוא / כל `sendWhatsAppText` — אין שורת `out`, לכן ציטוט שלהן לא ניתן לשיוך מדויק ונופל למסלול הטלפון.

### 6.8 קמפיין בוטל והוקם מחדש לאותו אירוע
`billed_results UNIQUE (event_id, contact_id)` — contact שחויב תחת הקמפיין הישן יקבל `already_billed` תחת החדש, והשורה הישנה נשארת משויכת ל-`campaign_id` הישן ולכן לא נספרת ב-`campaign_billing_summary` של החדש.

### 6.9 קמפיין `approved` שטרם הופעל
תגובה מוקדמת (למשל על הודעת בדיקה ידנית) → `not_active`. ההגעה לא תיספר גם אחרי ההפעלה.

### 6.10 מקרי קצה של הסט הדינמי
- **`ceiling_full` / `not_eligible` ב-reconcile:** האורח נוסף לאירוע אבל לא לסט (hold לא מספיק / אין guest חי / הוסר). הוא לא ייזרע ל-`outreach_state` (S8), לא יקבל הודעה, ולכן גם לא יחויב — אין אובדן חיוב, יש **פער כיסוי** שנרשם רק ב-`console.warn` (`contacts.ts:278-283`) ולא מוצג לבעלים.
- **guest נוסף כשהקמפיין `closed`/`cancelled`:** reconcile מחזיר `not_operational` ולא נוגע בסט. עקבי עם `not_active` בחיוב.
- **`delete` של חבר לא-חשוף שכבר נזרע (inferred, לא נצפה live):** אם ה-contact נשאר קיים (guest אחר עדיין מצביע עליו), שורת ה-`outreach_state` שלו אינה נמחקת (S8) והמנוע עלול עדיין לשלוח לו — `executeStep` בודק `removal_requested`/consent אך **לא** חברות בסט (`outreach-engine.ts:370-378`). תגובה שלו תיפול ל-`not_authorized`: הודעה נשלחה, הגעה לא נספרת. אם ה-contact נמחק ב-`pruneOrphanContact` — ה-CASCADE מוחק גם את `outreach_state` והבעיה לא קיימת.
- **`repoint` של חבר חשוף:** הישן נשאר pinned והחדש נוסף רק אם יש מקום — כלומר החלפת מספר של אורח שכבר קיבל הודעה יכולה להיחסם ב-`ceiling_full` בלי שהבעלים יידע.

---

## 7. KALFA מול Meta — שני חיובים שונים לחלוטין

| | חיוב KALFA (הלקוח משלם ל-KALFA) | תמחור Meta (KALFA משלמת ל-Meta) |
|---|---|---|
| יחידה | "אורח שהושג" = אינטראקציה אנושית מאומתת, **פעם אחת לכל contact לכל event** | שיחה/תבנית לפי קטגוריה (`marketing`/`utility`/`authentication`/`service`), מודל `PMP` |
| איפה נקבע | `try_record_billed_result` → `billed_results.locked_price` = `campaigns.price_per_reached` בזמן ההגעה | ב-Meta; מדווח בדיעבד ב-`statuses[].pricing` |
| עמודות | `campaigns.price_per_reached`, `max_contacts`, `max_charge_ceiling`, `auth_amount` (J5), `base_price`, `included_reached`, `credit_applied`, `final_charge_amount`, `charge_status`; `billed_results.locked_price`, `evidence_source`, `provider_ref`, `control_status` (VERIFIED-LIVE) | `pricing.pricing_model='PMP'`, `pricing.type ∈ {regular, free_customer_service, free_entry_point}`, `pricing.category`, `pricing.billable` (deprecated), `conversation.{id, origin.type, expiration_timestamp}` — טיפוסי `whatsapp-api-js@6.2.2` `lib/types.d.ts:667-682` |
| תקרה | base + overage עד `max_charge_ceiling` (`campaigns.ts:711-720`); ספירה בסעיף 1.5 שומר 10 | — |
| סיכום | `campaign_billing_summary` (חי): `count`, `Σ locked_price`, `ceiling`, `max_contacts` → close-charge | — |

**האם קוד כלשהו קורא `pricing` של Meta לצורכי חיוב KALFA? לא.** אימות: `grep -rn pricing src worker` — הקורא היחיד של `payload.pricing` הוא תצוגת האדמין `webhook-detail.tsx:116-119, 246-262` (שדה "תמחור Meta"). `processStatus` קורא רק `status`/`errors` (`webhook-processing.ts:302-329`). חיוב KALFA מופעל **רק** מהודעות נכנסות (`event_kind='message'`) ומשיחות שהושלמו — לעולם לא מ-`status`.

---

## 8. מדיניות שיוך בטוחה (הצעה)

### 8.1 העיקרון
1. `context.id` תואם ליוצאת שלנו → **precise**. (הרחבה: ל-`reaction` להשתמש ב-`reaction.message_id` כ-context.)
2. אין context → אוספים **מועמדים** לפי `normalized_phone`. מועמד **תקף** = `(campaign, contact)` כך ש:
   - ה-contact חבר ב-`campaign_authorized_contacts` של הקמפיין **ברגע התגובה** (הסט דינמי — סעיף 1.6);
   - `campaigns.status ∈ ('active','paused')`, `events.status='active'`, `now()` בתוך `[start_at, close_at]`, יום האירוע לא עבר;
   - `contacts.removal_requested=false`;
   - קיימת שורת `out` של הקמפיין לאותו contact ב-N הימים האחרונים (N = החלטה מוצרית, סעיף 11).
3. בדיוק מועמד תקף אחד → **attributable** (ממשיכים כמו היום).
4. יותר מאחד → **ambiguous**: שומרים אינטראקציה **בלי** `event/campaign/contact` (העמודות nullable — VERIFIED-LIVE), `billing_outcome='ambiguous'`, `payload_meta={candidates:[{campaign_id, contact_id}]}` (ids בלבד), **אין חיוב אוטומטי**, התראה + מסך אדמין להכרעה ידנית.
5. אפס → **unmatched**: שומרים אינטראקציה עם `billing_outcome='unmatched'`, אין חיוב.
6. ה-RPC נשאר קו ההגנה האחרון בדיוק כמו היום — **אין צורך בשינוי RPC**.

### 8.2 חתימה מוצעת (`src/lib/data/interactions.ts`)

```ts
export type InboundAttribution =
  | { kind: 'precise'; eventId: string; campaignId: string; contactId: string; via: 'context' | 'reaction' }
  | { kind: 'attributable'; eventId: string; campaignId: string; contactId: string; via: 'phone' }
  | { kind: 'ambiguous'; candidates: Array<{ eventId: string; campaignId: string; contactId: string }> }
  | { kind: 'unmatched'; reason: 'no_from' | 'no_contact' | 'no_valid_candidate' | 'unknown_business_number' };

export async function resolveInboundAttribution(input: {
  contextId: string | null;      // message.context.id או reaction.message_id
  fromPhone: string | null;      // payload.from (wa_id)
  phoneNumberId: string | null;  // webhook_inbox.phone_number_id
  replyWindowDays: number;       // N
  nowIso?: string;
}): Promise<InboundAttribution>;
```

### 8.3 מה משתנה
- **`resolveInboundContact`** (`interactions.ts:72-104`): מוחלף/עטוף ב-`resolveInboundAttribution`. השאילתה: `contacts (normalized_phone) ⋈ campaign_authorized_contacts ⋈ campaigns ⋈ events` + `exists out within N days` — עדיף כ-RPC קריאה-בלבד `SECURITY INVOKER` ל-service_role (join אחד, לא 3 round-trips), או PostgREST embedded select. `resolveInboundContact` הישן נשאר לתקופת מעבר מאחורי דגל.
- **`resolveByContextId`** (`interactions.ts:112-133`): ללא שינוי, פרט לקבלת `reaction.message_id` כקלט חלופי (הקורא מעביר).
- **`processMessage`** (`webhook-processing.ts:195-199`): במקום `if (!resolved) return;` — switch על `kind`: `precise/attributable` → הזרימה הקיימת; `ambiguous/unmatched` → `insertInteraction` עם binding NULL + `billing_outcome` מתאים, בלי `recordReached`, בלי removal (אין contact לסמן; ל-ambiguous — לסמן removal על **כל** המועמדים? ראו סעיף 11), בלי RSVP/headcount.
- **סינון מספר עסקי**: רק שורות שה-`phone_number_id` שלהן = `app_settings.whatsapp_phone_number_id` נכנסות לנתיב הקמפיין (האדמין כבר משווה כך: `admin/webhook-inbox.ts:183-186`); אחרת `unmatched('unknown_business_number')`. תלוי בתוכנית פיצול מספר הייבוא (`docs/whatsapp-import-number-split-plan-2026-09-03.md`).
- **סעיף 6.2**: להוציא את קריאת ה-RPC מגידור `fresh` בלבד — לקרוא ל-RPC כאשר `fresh` **או** כאשר השורה הקיימת היא שלנו ו-`billing_outcome IS NULL` (ה-RPC אידמפוטנטי: `already_billed`). דורש `getInboundBillingOutcome(channel, providerId)` קטן.
- **מסלול השיחות**: `processCallResult` ישמור את תוצאת `writeReach` ב-`billing_outcome` של שורת ה-`call` הנכנסת (שורה אחת של קוד + בדיקה).
- **RPC**: ללא שינוי. אופציונלי ומאוחר יותר: לתקן את `exposed_for_billing` ל-`direction='out'` לפני הדלקת ה-gate (סעיף 5.5).

---

## 9. תוכנית יישום מדורגת (לא בוצע דבר)

| שלב | תוכן | קבצים | סיכון | rollback |
|---|---|---|---|---|
| 0 (קיים) | `billing_outcome` על נכנסות WhatsApp + תצוגת אדמין — פרוס מ-3.9 | `webhook-processing.ts:229-235`, `webhook-detail.tsx:305-320` | — | — |
| 1 | נראות מלאה: (א) שמירת תוצאה במסלול השיחות; (ב) רישום `unmatched` לנכנסות billable שלא שויכו (binding NULL); (ג) פילטר `billing_outcome` ב-`/admin/webhooks` | `call-result-processing.ts`, `webhook-processing.ts`, `interactions.ts`, `admin/webhook-inbox.ts`, `webhook-inspector-client.tsx`, בדיקות | נמוך; שורות עם `event_id NULL` אינן נראות לבעלים (RLS לפי event) — לבדוק שאין consumer שמניח non-null (`interactions-org-reads.ts` מסנן לפי event → תקין) | revert קוד; השורות החדשות ניתנות לזיהוי לפי `billing_outcome in ('unmatched','ambiguous')` |
| 2 | סגירת 6.2: RPC נקרא גם ב-retry כשה-outcome NULL | `webhook-processing.ts`, `interactions.ts`, `webhook-processing.test.ts` | נמוך (ה-RPC אידמפוטנטי) | revert |
| 3 | `resolveInboundAttribution` + N כ-`app_settings.inbound_reply_window_days` (ברירת מחדל מוסכמת) + דגל `app_settings.inbound_attribution_strict` (default false) **עם מתג באדמין** (`/admin/channels`) — לפי הכלל "kill-switch ב-DB בלי UI ≠ גמור" | `interactions.ts`, מיגרציה קטנה (2 עמודות), `admin/channels`, בדיקות | בינוני: שינוי סכימה קטן; לוגיקה חדשה מאחורי דגל כבוי | דגל OFF = התנהגות היום; מיגרציה הפיכה (drop columns) |
| 4 | חיווט `processMessage` לפי 8.3 + reaction → context + סינון `phone_number_id` + התראת Slack `ambiguous` (ids בלבד) | `webhook-processing.ts`, `route.ts` (אין שינוי חובה; אפשר להעביר `reaction.message_id` ל-`context_message_id` כבר בנרמול — עדיף לא, כדי לא לערבב סמנטיקה; לקרוא מה-payload ב-worker) | בינוני | דגל OFF |
| 5 | הרצה במקביל בייצור עם הדגל OFF: ה-resolver החדש רץ ב-"shadow" ורושם ל-`payload_meta.shadow_attribution` מה *היה* מחליט; השוואה יומית ל-הכרעה הישנה | `webhook-processing.ts` | נמוך | הסרת ה-shadow |
| 6 | הדלקת הדגל אחרי X ימים ללא סתירות; דו"ח | אדמין | ההשפעה היחידה: הודעות `ambiguous` מפסיקות להתחייב אוטומטית | כיבוי הדגל |
| 7 | (נפרד, לפני gate ON) תיקון `exposed_for_billing` ל-`direction='out'` | מיגרציה | בינוני-נמוך (gate כבוי) | re-run הגרסה הקודמת |

### 9.1 שאילתת backfill/דיווח להיסטוריה (קריאה בלבד, ללא PII)

מסווגת כל נכנסת WhatsApp billable: מסלול (context/phone), האם חויבה, וכמה מועמדים היו לה **לפי מצב היום** (קירוב — לא ניתן לשחזר את מצב הקמפיינים ברגע ההגעה בלי audit):

```sql
with inbound as (
  select ci.id, ci.event_id, ci.campaign_id, ci.contact_id, ci.provider_id,
         ci.context_message_id is not null as via_context, ci.billing_outcome, ci.created_at,
         c.normalized_phone
  from contact_interactions ci join contacts c on c.id = ci.contact_id
  where ci.direction = 'in' and ci.channel = 'whatsapp' and ci.billable
),
cands as (
  select i.id,
         count(distinct (a.campaign_id, a.contact_id)) filter (
           where k.status in ('active','paused') and e.status = 'active'
             and exists (select 1 from contact_interactions o
                         where o.contact_id = a.contact_id and o.campaign_id = a.campaign_id
                           and o.direction = 'out' and o.created_at < i.created_at)
         ) as n_valid_today
  from inbound i
  join contacts c2 on c2.normalized_phone = i.normalized_phone
  join campaign_authorized_contacts a on a.contact_id = c2.id
  join campaigns k on k.id = a.campaign_id
  join events e on e.id = k.event_id
  group by i.id
)
select via_context,
       (b.id is not null) as billed_on_this_wamid,
       coalesce(n_valid_today, 0) as n_valid_today,
       count(*) as n
from inbound i
left join billed_results b on b.provider_ref = i.provider_id
left join cands using (id)
group by 1,2,3 order by 1,2,3;
```

---

## 10. בדיקות נדרשות

### 10.1 יחידה (vitest)

`src/lib/whatsapp/inbound.test.ts` (קיים: 18 מקרים):
- `reaction` מסווג billable **ומחזיר** `reactionMessageId` (חדש) — assertion על השדה החדש; `sticker`/`audio`/`image` לא billable.
- `removal` על `interactive.list_reply.title` (קיים חלקית); "הסר" בתוך משפט ("אפשר להסיר אותי") — whole-token → true; "הסרתי" → false.

`src/lib/data/interactions.test.ts` (קיים: 20 מקרים, ה-`resolveInboundContact` נבדק ב-`:76-140`):
- `resolveInboundAttribution`: אין `from` → `unmatched('no_from')`; טלפון לא מנותח → `unmatched`; מועמד תקף יחיד → `attributable` עם הצמד הנכון; שני מועמדים תקפים (שני אירועים, שניהם active + out בחלון) → `ambiguous` עם 2 מועמדים; מועמד יחיד אך `campaign.status='closed'` → `unmatched('no_valid_candidate')`; מועמד יחיד אך ה-out ישן מ-N ימים → `unmatched`; `removal_requested=true` → לא מועמד; לא בסט → לא מועמד; `phone_number_id` שונה ממספר ה-RSVP → `unmatched('unknown_business_number')`.
- `resolveByContextId` עם `reaction.message_id` → `precise(via:'reaction')`.

`src/lib/data/webhook-processing.test.ts` (קיים: 28 מקרים; המוקים ב-`:1-105`):
- ambiguous → `insertInteraction` נקרא עם `event_id/campaign_id/contact_id = null` ו-`billing_outcome='ambiguous'`, `recordReached` **לא** נקרא, `markContactRemovalRequested` לא נקרא, `submitRsvp` לא נקרא, `sendSlackAlert` נקרא עם ids בלבד.
- unmatched → אינטראקציה עם `'unmatched'`, בלי RPC.
- 6.2: `recordReached` זורק בפעם הראשונה; בהרצה שנייה `insertInteraction` מחזיר `false` ו-`getInboundBillingOutcome` מחזיר `null` → `recordReached` **נקרא** שוב ומחזיר `already_billed`/`billed`.
- קיים ויש לשמר: "falls back to the sender phone" (`:179`) — לעדכן ל-`attributable`; "does NOT bill when neither … resolves" (`:256`) — לעדכן: כן נרשמת אינטראקציה `unmatched`, לא נקרא RPC.
- `processCallResult` שומר `billing_outcome` (חדש, בקובץ בדיקה של call-result-processing).

`src/lib/data/billing.test.ts` (קיים) — ללא שינוי.

### 10.2 אינטגרציה (route → worker)
`src/app/api/webhooks/whatsapp/route.test.ts` (קיים: 45 מקרים) + בדיקת worker:
- מסירה חתומה עם 2 הודעות (אחת עם context, אחת reaction) → 2 שורות inbox → `processWebhookEvent` על כל אחת → אינטראקציה אחת precise ואחת precise(via reaction).
- אותה מסירה פעמיים (retry) → שורת delivery אחת, 2 שורות inbox בלבד.
- reprocess ידני (`reprocessWebhookEventAction`) → אין RPC שני, `billing_outcome` לא משתנה.

### 10.3 DB (RPC, על DB בדיקה — לא על ה-DB החי)
- **מקביליות:** 2 קריאות `try_record_billed_result` בו-זמנית לאותו `(campaign, contact)` (שני חיבורים) → תוצאה אחת `billed` ואחת `already_billed`; ספירה 1.
- **תקרה:** קמפיין עם `cap=1` ושני contacts שונים במקביל → `billed` + `ceiling_reached`; לעולם לא 2 שורות.
- **חלון:** `close_at` בעבר → `closed_window`; `start_at` בעתיד → `before_window`; `event_date` אתמול → `event_passed`; סדר השומרים (מבוטל + מחוץ לחלון → `not_active` קודם).
- **מפתח:** אותו contact בשני קמפיינים של אותו אירוע (ביטול והקמה) → השני `already_billed`.
- **claim:** שני `claim_webhook_events` בו-זמניים בטרנזקציות פתוחות → סטים זרים; אחרי commit של הראשון בלי `processed_at` → השני **כן** מקבל את אותן שורות (מתעד את המגבלה מסעיף 1.3).
- **`exposed_for_billing`** (לפני gate ON): צמד עם נכנסת billable ובלי שום `out` → היום `true`; אחרי התיקון → `false`.

---

## 11. שאלות מוצריות להחלטה לפני היישום

1. **חלון תגובה N** — כמה ימים אחרי השליחה האחרונה תגובה מוקלדת עדיין נחשבת תגובה לקמפיין? (המלצה טכנית: 14 יום כברירת מחדל, ניתן לשינוי באדמין; מעל זה → `unmatched`, אלא אם יש context.)
2. **אילו סוגי הודעה נספרים כ"הושג"?** היום: `text`, `button`, `interactive`, `reaction`. האם reaction 👍 = מענה אנושי לחיוב? האם טקסט ריק/אימוג'י בודד? מדיה (תמונה/קול) היום **לא** נספרת — האם זו הכוונה?
3. **מספרי בעלים/בדיקה** — האם לסנן טלפונים שמופיעים ב-`profiles.phone` (בעלי חשבון) מהחיוב? מה עם צוות KALFA?
4. **`ambiguous`** — מי מכריע ואיך: מסך אדמין "שייך ידנית לקמפיין X" (ואז RPC), או "לא לחייב לעולם"? האם לשלוח לאורח הודעת הבהרה (עולה כסף ב-Meta ונופל ל-131049)?
5. **הסרה ("הסר")** — האם הסרה מחייבת? היום כן (החלטה D4). אם התגובה היחידה של האורח היא "הסר" — האם זה "אורח שהושג"? ואם ההודעה `ambiguous` — לסמן `removal_requested` על כל המועמדים (בטיחות משפטית) גם בלי חיוב?
6. **מספר הייבוא** — האם תגובה שהגיעה למספר הייבוא יכולה אי-פעם להיות תגובת קמפיין? (המלצה: לא.)
7. **קמפיין `paused`** — היום מחייב תגובות (D2). לשמר?
8. **קמפיין שבוטל והוקם מחדש** — האם contact שחויב תחת הישן צריך להיספר לחדש? (סעיף 6.8.)

---

## סיכום חד-משמעי (עמוד אחד)

**מתי אורח נספר לחיוב היום.** כשמגיעה הודעת WhatsApp מסוג `text`/`button`/`interactive`/`reaction` (`inbound.ts:11-16`), הקוד מוצא לה צמד `(event, campaign, contact)` — או דרך `context.id` (`interactions.ts:112-133`) או דרך הטלפון (`interactions.ts:72-104`) — מכניס שורת `contact_interactions` נכנסת (`webhook-processing.ts:203-213`), ואם זו הפעם הראשונה שה-wamid הזה נראה, קורא ל-`try_record_billed_result` (`webhook-processing.ts:216-226`). ה-RPC מחייב (`billed`, `billed_results.locked_price = price_per_reached`) רק אם הקמפיין `active/paused`, בתוך החלון, האירוע פעיל ולא עבר, ה-contact לא ביקש הסרה, ה-contact **בסט המורשים של הקמפיין** (סט **דינמי**: מאוכלס ב-hold ומתעדכן בכל הוספה/החלפה/מחיקה של אורח דרך `reconcile_authorized_set`, עד `funded_cap`; חברות נבדקת ברגע התגובה, ובגלל ש-gate OFF זו הבדיקה היחידה), התקרה לא מלאה, והצמד `(event, contact)` טרם חויב. חבר סט שטרם קיבל הודעה אינו מחויב רק כי הקורא דורש שליחה יוצאת קודמת — לא כי ה-DB מונע זאת. שיחה שהושלמה עוברת באותו RPC. VERIFIED-LIVE: 22 חיובים בסך הכול, כולם ביולי.

**מתי לא.** הודעות מדיה/מערכת; הודעות מטלפון שאינו contact עם שליחה קודמת (נעלמות בלי עקבה); כל תגובה שנייה של אותו contact באותו אירוע (`already_billed`); כל תגובה לקמפיין סגור/מאושר-טרם-הופעל (`not_active`); contact מחוץ לסט (`not_authorized` — כולל קמפיין פעיל עם סט ריק, שיש אחד כזה חי); וכן — **בשקט ולצמיתות** — כל הודעה שה-RPC שלה נכשל טכנית אחרי שהאינטראקציה כבר נכתבה (סעיף 6.2).

**מתי השיוך ודאי.** כשההודעה נושאת `context.id` שתואם `provider_id` של הודעה יוצאת שנשלחה דרך `sendOneWhatsApp`. זה מכסה לחיצות כפתור ותגובות-בציטוט. VERIFIED-LIVE: 30 מתוך 59 נכנסות.

**מתי הוא ניחוש.** בכל שאר המקרים (29 מתוך 59): הקוד לוקח את **ההודעה היוצאת האחרונה לטלפון הזה, בכל אירוע ובכל לקוח**, ומייחס לה את התגובה. הניחוש נכון כשלטלפון יש שולח אחד בלבד — וזה המצב ברוב המוחלט של הנתונים היום (טלפון אחד חופף בין שני לקוחות, אפס טלפונים במצב "סגור-מעל-פעיל"). הניחוש אינו מוגן ב-RPC: ה-RPC בודק שמותר לחייב את הצמד, לא שהצמד נכון. reactions תמיד מנוחשים אף שיש להם מזהה מדויק. `phone_number_id` אינו משתתף בשיוך בכלל.

**מה נדרש כדי שרק הלקוח הנכון יחויב, פעם אחת.**
1. להחליף את "השולח האחרון מנצח" ב-**מועמד תקף יחיד** (בסט, קמפיין+אירוע פעילים, בחלון, לא הוסר, שליחה יוצאת ב-N ימים) — יותר מאחד → `ambiguous` בלי חיוב, אפס → `unmatched` בלי חיוב, שניהם נרשמים ונראים באדמין.
2. להשתמש ב-`reaction.message_id` כ-context, ולסנן לפי מספר עסקי.
3. לסגור את חור ה-retry (RPC נקרא גם כשה-`billing_outcome` עדיין NULL), ולשמור תוצאה גם במסלול השיחות.
4. להשאיר את ה-RPC בדיוק כפי שהוא — הוא כבר מבטיח "פעם אחת לצמד" ו"רק בתוך הכללים"; מה שחסר הוא בצד הקורא: **לבחור את הצמד הנכון, או לא לבחור בכלל.**
5. לפני הדלקת `billing_exposure_gate` — לתקן את `exposed_for_billing` כך שידרוש `direction='out'`.
