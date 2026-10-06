# ביקורת שלישית — `2026-09-24-campaign-payment-domain-split.md`

נכתב 2026-09-25 על ידי rls-schema-engineer (קריאה בלבד; אף כתיבה ל-DB או לקבצים מלבד דוח זה). כל 1,071 השורות נקראו בסדר. תיוג: VERIFIED-LIVE = נמדד ב-DB החי (`npx supabase db query --linked`); FILE = נקרא בקובץ; DOCS = מקור חיצוני (קוד המקור של Supabase CLI 2.117.0 ב-GitHub); inferred = הסקה.

**פסק דין: לא מוכנה לביצוע כפי שהיא. 2 חוסמים, 6 חשובים, 12 קלים.** שני החוסמים הם באג מפתח בבקפיל (שם המפתח ב-`meta`) וחור ב-"חיוב פעם אחת" שנפתח ברגע שה-CAS הישן נמחק ב-Contract. הרשימה המינימלית בסוף.

הערת גבול: ממצא #3 של הביקורת הקודמת (מחיקה על ידי `service_role`) נדחה על ידי הבעלים ולא נבדק מחדש.

---

## 1. בדיקת רגרסיה — 21 הממצאים שהתקבלו

| # | מצב | שורה בתוכנית | ראיה |
|---|---|---|---|
| 1 | נפתר (בתכנון) | 653-657, 727-731, 761-764 | `release` לשני הישנים ב-`authorized_at + 1s` + note "release time unknown"; לקאקון זמן ה-`activity_log`; `deriveStatus` שובר שוויון ב-`recordedAt` (509). המימוש של קאקון שבור בפועל — ראה #23 |
| 2 | נפתר | 659, 697-700, 739, 905, 69, 44 | `nothing_to_charge` → `charge` succeeded בסכום 0 עם `credit_applied`; `completeOperation(succeeded, 0, creditApplied)`; הזיכוי נספר גם על `collect` בסכום 0. VERIFIED-LIVE: היתרות 0 (אירוע `294d23e1`: 84 מוענק לא-מבוטל, 84 מנוצל) ו-6 (`659ae5e7`: 10 מוענק, 4 מנוצל) כפי שהתוכנית דורשת |
| 4 | נפתר | 7, 36, 961, 1018, 1026 | ספרתי את ה-`drop column` ב-1019-1025: 3+4+4+4+3+3+2 = **23** חיות + 3 מתות = 26, +2 ב-ecr. כל ספירה במסמך (7, 36, 104, 961, 1018, 1026) תואמת |
| 5 | נפתר | 308 | `v_id uuid := extensions.uuid_generate_v7()` |
| 6 | נפתר (מתועד) | 85, 116-117, 1009 | הבדיקה מסומנת "דורשת DB בדיקה עם pg_tle + dbdev"; לא רצה מול החי |
| 7 | נפתר | 844 | Task 5 שלב 0: `uniqueIndexes`, `.single()`, `.not()` + בדיקה. FILE `src/test/fake-table-client.ts:58-61` החתימה `(tables, rpc = {})`; `maybeSingle` בלבד (163-166), אין `.single`/`.not` — התיאור בתוכנית נכון |
| 8 | נפתר | 44, 949 | "החתימה נשמרת; רק שתי הראשונות משתנות". VERIFIED-LIVE: `returns TABLE(charged_amount, credit_applied_amount, unvoided_credit_amount, credit_granted_amount)` |
| 9 | נפתר | 207-210, 356 | `on delete restrict` על `campaign_id` ו-`event_id`; dry-run (g) |
| 10 | נפתר | 120 | FILE `git show --stat 091b22d`: `types.generated.ts | 32 +-` נכנס לקומיט; עץ העבודה נקי ממנו היום |
| 11 | נפתר | 74, 942 | `stuckHolds` = `pending`, `failed`, `review`. FILE `cores/campaigns.ts:45` `STUCK_CAPTURE_STATUSES = ['pending','hold_failed','hold_review']` |
| 12 | **חלקי** | 653, 780-786 | התכנון נכון (`activity_log`, `2026-09-23T06:00:29Z`; VERIFIED-LIVE `created_at = 2026-09-23 06:00:29.021648+00`), אבל הקוד קורא `meta.campaign_id` והמפתח החי הוא `campaignId` → הזמן לא ייקרא. ראה #23 |
| 13 | נפתר | 950 | `campaigns.ts:56-57` (`CAMPAIGN_COLUMNS`), `:747-764` (`getCampaignForCharge`). FILE תואם |
| 14 | נפתר | 96 | "שאר 96 הטבלאות". VERIFIED-LIVE: 96 טבלאות ב-`public` |
| 15 | נפתר | 74 | "11 שמות עמודות" |
| 16 | נפתר | 27 | הניסוח החדש מדויק: GRANT SELECT ל-`anon`, 0 שורות בזכות `camp_org_select` ל-`authenticated`. VERIFIED-LIVE: policy יחידה `camp_org_select` (SELECT, `{authenticated}`); `has_table_privilege('anon','campaigns','select') = true` |
| 17 | נפתר | 104, 1011, 1016 | `set lock_timeout = '5s'`, "לא מילישניות — נמדד בזמן הריצה" |
| 18 | נפתר | 42, 45 | "`create or replace function` בלבד — הטריגר וה-SECDEF הקיימים נשמרים". VERIFIED-LIVE: `campaigns_guard_cancel`, `cancel_campaign`, `reconcile_authorized_set`, `try_record_billed_result` כולן `prosecdef = true`, owner `postgres` |
| 19 | נפתר | 810, 813 | `.find((c) => c.status !== 'cancelled')`. VERIFIED-LIVE: `campaigns_event_noncancelled_uidx ON (event_id) WHERE status <> 'cancelled'` |
| 20 | נפתר | 954 | ה-grep מסנן הערות ומחריג `sumit-customers.ts`. `cores/campaigns.ts:51` (מחרוזת הפילטר) יעלה — אבל הקובץ משובץ ל-Task 7, ראה #29 |
| 21 | נפתר | 189-191, 237-238, 268-281 | `once_per_campaign` ברישום + `guard_once`; אין אינדקס על `parent_operation_id` |
| 22 | **חלקי** | 989-991 | התוכנית מצמצמת את הטריגר ל-`approved/scheduled` מתוך אמונה ש"resume לא בודק היום". זו הנחה שגויה — ראה #26 |

---

## 2. ממצאים חדשים

### חוסם

#### 23. הבקפיל קורא `meta.campaign_id`; המפתח החי הוא `campaignId` — זמן השחרור של קאקון לעולם לא ייקרא
- **שורות:** 780-786 (`(r.meta as { campaign_id?: string } | null)?.campaign_id`), 653, 684-686, 835.
- **מה לא נכון:** FILE `src/lib/data/sumit-hold-reconcile.ts:52-57` כותב `meta: { campaignId: row.id, holdOrderDocumentId, amount }`. VERIFIED-LIVE, השורה היחידה עם `action = 'campaign.hold_released_synced'`: `meta = {"amount":200,"campaignId":"39334087-e68c-4c81-aea4-b465cfc205e2","holdOrderDocumentId":2327129322}`, `created_at = 2026-09-23 06:00:29.021648+00`, `event_id = 9705bc6c-…`. `activity_log` אין בה עמודת `campaign_id` (VERIFIED-LIVE: `id, user_id, event_id, action, meta, created_at`).
- **תוצאה:** `releasedAt` נשאר ריק → `planOperations` נכנס לענף `release_status === 'released'` עם `when = undefined` → `release` של קאקון נכתב ב-`source='provider_sync'` אבל `occurred_at = 2026-09-02T13:14:23.063Z` ו-note "release time unknown", לא `2026-09-23T06:00:29Z`. הציפייה בשורה 835 ("release(provider_sync, 23.09 06:00:29Z)") נכשלת בשקט (ריצת ה-plan מדפיסה רק `kind/outcome(source)`, לא זמן). הבדיקה בשורות 683-686 מזריקה את המפה ולכן לא מכסה את המפתח.
- **תיקון:** `?.campaignId`; ולהוסיף ל-Step 4 את השאילתה `select occurred_at from payment_operations where campaign_id='39334087-…' and kind='release'` = `2026-09-23 06:00:29+00`.

#### 24. "החיוב הסופי פעם אחת" נאכף רק בסיום — אחרי שהכסף כבר נגבה; ואחרי Contract ה-CAS הישן נעלם
- **שורות:** 266-281 (`guard_once` בודק רק `new.outcome = 'succeeded'`), 239-244 (`one_pending_uq` חוסם רק pending מקביל), 853 (`beginOperation` מכניס `pending`), 905, 1036 (Task 8 מסיר את הכתיבה הישנה), 197-202 (`authorize` עם `once_per_campaign=false`).
- **מה לא נכון:** היום `lockCampaignForCharge` (FILE `campaigns.ts:784-793`) נועל רק מ-`charge_status in (null, charge_failed, charge_review)`, כלומר קמפיין שכבר `charged`/`nothing_to_charge` לא ניתן לנעילה, ולכן SUMIT לא נקרא פעמיים. במודל החדש, אחרי Task 8: `beginOperation({kind:'charge'})` על קמפיין עם `charge` succeeded → אין שורת pending → ה-insert עובר (`guard_once` רואה `new.outcome='pending'` ולא בודק) → SUMIT מחייב את הטוקן שוב → `completeOperation(succeeded)` → `guard_once` זורק `unique_violation` → הכסף נגבה פעמיים ושורת ה-pending נתקעת (וגם חוסמת ביטול לפי 1006-1007). `latestOperation` קיים בממשק (855) אבל התוכנית לא קובעת ש-`beginOperation` בודק אותו לפני.
- **אותו חור ב-`authorize`:** היום `lockCampaignForHold` (FILE `campaigns.ts:467-473`) לא נועל מחדש אחרי `authorized` → תפיסה אחת לכל היותר. ברישום `authorize` הוא `once_per_campaign=false` → אחרי Contract אפשר לפתוח תפיסה שנייה על אותו כרטיס.
- **תיקון מינימלי (DB, לא קוד):** ב-`guard_once` לבדוק `new.outcome in ('pending','succeeded')` — אז ה-insert של ה-pending עצמו נכשל כשכבר יש succeeded, לפני קריאת SUMIT, ותחת מקביליות `one_pending_uq` + הבדיקה הזו מכסות. להחליט על `authorize`: `once_per_campaign=true` (שוויון להיום) או לתעד במפורש שתפיסה חוזרת אחרי שחרור היא שינוי מוצר. לעדכן את בדיקת (h) ב-dry-run ואת בדיקה 2-3 ב-`ledger.test.ts`.

### חשוב

#### 25. Task 5 שלב 4 כותב את ה-`authorize` פעמיים
- **שורות:** 904 (אחרי `update({capture_status:'authorized'})` → `recordOperation({kind:'authorize', outcome:'succeeded'})`, ואחרי `hold_failed`/`hold_review` → `authorize` failed/review) **וגם** 905 (`lockCampaignForHold` → `beginOperation({kind:'authorize'})`, אחרי SUMIT → `completeOperation`).
- **מה לא נכון:** שני הסעיפים מתארים מנגנון שונה לאותה תפיסה; יישום של שניהם = שתי שורות `authorize` לכל תפיסה (pending→succeeded + succeeded חד-פעמי). `campaign_committed_amount` ו-`deriveStatus` יסבלו, אבל `min(occurred_at)` (68), ואם `authorize` יהפוך ל-once (#24) — השנייה תיזרק. ה-route (FILE `authorize/route.ts:138,163,168,198,213,225,262`) קורא `markCampaignHoldFailed` בחמש נקודות שונות; כל אחת חייבת להשלים את אותה שורת pending, כלומר ה-id צריך לעבור ב-route. לבחור begin/complete בלבד ולמחוק את סעיף ה-`recordOperation`.

#### 26. "resume (paused → active) לא בודק תשלום היום" — לא נכון; הטריגר מצמצם את השומר
- **שורות:** 989-992 (`old.status in ('approved', 'scheduled')`), 906.
- **מה לא נכון:** FILE `campaigns.ts:984-996`: `activateCampaign` מעביר `{ column: 'capture_status', value: 'authorized' }` ל-`transitionCampaignStatus` לכל `from` — `['approved','scheduled','paused']` לבעלים ו-`['paused']` ל-console — וה-`extraGuard` מוחל ללא תנאי (957-958). כלומר היום גם `paused → active` דורש `capture_status='authorized'`. ממצא 22 של הביקורת הקודמת טעה, והתוכנית אימצה את הטעות. אין שבירה מיידית (paused מגיע רק מ-active), אבל זו הסרת שומר בלי החלטה.
- **תיקון:** `old.status in ('approved','scheduled','paused')` (או `old.status <> 'active'`), ולתקן את ההערה.

#### 27. Task 1 אינו אטומי תחת `supabase db push`: `create index` רץ מחוץ לטרנזקציה
- **שורות:** 178, 230-236, 243-244 (8 `create index`), 342-362 (ROLLBACK ידני), 108.
- **מה לא נכון:** DOCS, קוד המקור של ה-CLI (2.117.0 מותקן; `apps/cli-go/pkg/migration/file.go`): `ExecBatch` (121-186) שולח את המשפטים ב-`pgconn.Batch` אחד (טרנזקציה משתמעת, Sync אחד בסוף, כולל ה-insert ל-`schema_migrations`), **אבל** `isPipelineIncompatible` (81-89) מוציא `CREATE INDEX`, `DROP INDEX`, `REINDEX`, `VACUUM`, `ALTER SYSTEM`, `CLUSTER` מה-batch ומריץ אותם ב-`Exec` נפרד (autocommit) אחרי flush של מה שנצבר. לכן קובץ Task 1 מתבצע כ: [type, extension, `payment_methods`, comment] → commit → index → [kinds, seed, `payment_operations`, comment] → commit → 7 אינדקסים בנפרד → [טריגרים, ACL, פונקציות Vault, grants, `drop column if exists`, insert version] → commit. כישלון ב-batch האחרון (למשל ב-`vault.create_secret` או ב-grant) משאיר את הטבלאות והאינדקסים מחויבים בלי רישום גרסה; `db push` חוזר נכשל על `create type … already exists`. סעיף ה-ROLLBACK הידני (358-362) הוא ההתאוששות הנכונה, אבל התוכנית לא אומרת שהוא נדרש גם למקרה של כישלון חלקי, ולא שה-dry-run "בטרנזקציה אחת" (342) לא משקף את אופן ההרצה של `db push`.
- **Task 8 בסדר:** אין בו `create index`/`drop index` → batch אחד → טרנזקציה משתמעת אחת; `set lock_timeout = '5s'` בתוך ה-batch תקף למשפטים שאחריו ומתגלגל לאחור יחד איתם. הערה: `drop column` דורש ACCESS EXCLUSIVE; `create trigger` שלפניו דורש SHARE ROW EXCLUSIVE — לשים את ה-`set lock_timeout` בתחילת **הקובץ**, לא בתחילת Step 3.
- **תיקון:** להוסיף ל-Task 1 Step 4: "אם `db push` נכשל באמצע — להריץ את בלוק ה-ROLLBACK ואז שוב"; או להריץ את Task 1 כטרנזקציה מפורשת ב-SQL editor ולרשום את הגרסה ידנית (תקדים runbook). לחלופין להוציא את 8 האינדקסים לקובץ שני.

#### 28. הקוראים בצד הלקוח משתמשים ב-cookie client; ל-`authenticated` אין GRANT על היומן
- **שורות:** 950 ("`OwnerCampaign` מקבל `payment` מהיומן"), 63-66, 947, 100.
- **מה לא נכון:** FILE `campaigns.ts:287-366`: `getCampaign`, `listCampaignsForEvent`, `getCampaignForEvent`, `getCampaignStageForEvent` — כולן `await createClient()` (cookie, תפקיד `authenticated`) עם `CAMPAIGN_COLUMNS`. `payment/page.tsx:61` ו-`campaign/[campaignId]/page.tsx:69` קוראות `getCampaign`. Task 1 שולל כל grant מ-`authenticated` (287) בלי policies (291) → embed של `payment_operations` דרך הלקוח הזה, או `loadOperations(cookieClient)`, נכשל ב-42501 (Review Focus #4 מבטיח בדיוק את זה). Task 7 לא אומר איפה עובר הגבול: אחרי `requireOwnedEvent` — `loadOperations(createAdminClient(), campaignId)`. `listCampaignsForAdmin` (Task 6) בסדר: FILE `admin/campaigns.ts:254` משתמש ב-`createAdminClient()`; `callbacks.ts:686` גם.
- **תיקון:** משפט אחד ב-Task 7 + ב-Global Constraints: "כל קריאה של היומן — `createAdminClient()` אחרי בדיקת בעלות; לעולם לא embed ב-`CAMPAIGN_COLUMNS`".

#### 29. `ADMIN_ATTENTION_FILTER` — מחרוזת PostgREST על `capture_status`; אחרי Contract זו שגיאת runtime שה-tsc לא רואה
- **שורות:** 74 (cores/campaigns.ts ברשימה), 927-932 (Task 6), 942 (Task 7 `stuckHolds`), 954.
- **מה לא נכון:** FILE `cores/campaigns.ts:51`: `` `status.in.(…),and(status.eq.approved,capture_status.in.(pending,hold_failed,hold_review))` ``; משמש ב-`admin/campaigns.ts:260` (`.or(ADMIN_ATTENTION_FILTER)` — רשימת `/admin/campaigns`) וב-`cores/campaigns.ts:95` (`needsAttention`). "approved עם תפיסה תקועה" לא ניתן לביטוי כפילטר `or` על `campaigns` כשהמידע בטבלת-בת; צריך שתי שאילתות (`status in winddown` ∪ `approved` שה-`deriveStatus` שלהם pending/declined/review) או view/RPC. Task 6 מתאר את המסך אבל לא את הפילטר; Task 7 מתאר `stuckHolds` בזיכרון אבל לא את `needsAttention` שחייב להישאר "אורך הרשימה של האדמין". ה-grep של Task 7 שלב 3 יתפוס את המחרוזת (טוב), אבל אין הנחיה מה לכתוב במקומה.

#### 30. קריטריון הקבלה של Task 6 ("הוחזר בשלוש השורות") שייך למודל הישן
- **שורה:** 934.
- **מה לא נכון:** "הוחזר" היא התווית של `refunded` (539). לפי המודל החדש והבקפיל (835): קאקון → `released` → "שוחרר ללא גבייה" (538); שני הסגורים → `collected` עם 0 → "נסגר ללא חיוב" (544). בדיקת הדפדפן של הבעלים תיכשל מול הציפייה הכתובה.

### קל

#### 31. ספירות הרישום ב-dry-run: 5 מול 6, ו-(e) לא יכול להחזיר 0 שורות
- **שורות:** 350 ("-- 6 rows"), 354 ("a 6-row registry") מול 197-202 (5 שורות seed), 95 ("רישום של 5 שורות"), 139 ("5 סוגים"). ובשורה 351 "expect 0 rows" מול 354 שמודה ש-`kind` לא מאונדקס — השאילתה (אימתתי את התחביר שלה חי מול `campaigns`: מחזירה `template_id`) תחזיר שורה אחת: `payment_operations.kind`. לתקן: (d) = 5, (e) = שורה אחת (`kind`).

#### 32. בדיקת שובר-השוויון ב-Task 2 לא בודקת שוויון
- **שורות:** 449-450. `occurredAt` של ה-release `16:38:53Z` ושל ה-authorize `16:38:52Z` — שונים, המיון לפי `occurredAt` לבדו נותן `released`; ה-`recordedAt` לא נבדק. לשים `occurredAt` זהה. וכדאי להוסיף את הרצף הממשי של הסגורים: `authorize → release(+1s) → charge(0)` (לפי זמן) → `collected`, 0 — עברתי עליו ידנית במימוש (507-529): commit→committed, void→released, collect→collected ✓, אבל אין לו בדיקה.

#### 33. ארגומנטי RPC nullable ייכשלו ב-tsc
- **שורות:** 294-301, 614-623. `supabase gen types` מייצר ארגומנט חובה לא-nullable לכל פרמטר בלי default (FILE `types.generated.ts:6787-6797`, `integrations_write_credential` Args: `p_expires_at: string` וכו'). `createPaymentMethod` מעביר `expMonth: number | null` ל-`p_exp_month: number` → TS2322 ב-Task 3 שלב 4. תיקון: `default null` על `p_exp_month`, `p_exp_year`, `p_provider_customer_id`, `p_citizen_id` (ואז הם `?:`), או `?? undefined` בצד הקוד.

#### 34. טבלת best-practices סותרת את החלטת הבעלים
- **שורה:** 99: "`payment_operations` = `select, insert` בלבד (append-only)". מול 111 ו-288-290: `service_role` שומר `arwdDxtm` (VERIFIED-LIVE: `pg_default_acl` ל-`public` מ-`postgres` ומ-`supabase_admin` מעניק `arwdDxtm` ל-`anon`, `authenticated`, `service_role`; תקדים `integration_connections` `relacl = service_role=ard`). לעדכן את השורה ל-"ברירת המחדל; append-only נאכף בטריגר".

#### 35. Task 6 לא טוען `recorded_at`
- **שורה:** 927. `OperationRow.recordedAt` חובה (495) ושובר-השוויון תלוי בו; `loadOperations` (901) כן טוען אותו. להוסיף לרשימת ה-embed.

#### 36. טבלת הפריסה מחסירה את המיגרציה של Task 7
- **שורות:** 949 (מיגרציה `owner_agent_billing_sums_from_ledger`) מול 1057-1063 (אחרי 7: רק `deploy`). צריך `db push → gen:types → advisors` לפני ה-deploy של 7.

#### 37. `owner_agent_billing_sums` ו-`tax-ceiling` יכללו מעכשיו גם גביות ביטול
- **שורות:** 44, 70, 201. `cancellation_charge` הוא `effect='collect'`; היום שניהם סוכמים רק `campaigns.final_charge_amount` עם `charge_status='charged'` (VERIFIED-LIVE `pg_get_functiondef`; FILE `tax-ceiling.ts:28-32`). היום 0 שורות (VERIFIED-LIVE: בקשת ביטול אחת, `status='resolved'`, `resolution='declined'`, בלי מסמך), אבל זה שינוי משמעות שצריך להיאמר (לתקרת עוסק פטור זה כנראה נכון; ל"כמה נגבה החודש" של הסוכן — החלטה).

#### 38. תנאי הביטול החדש חוסם גם `release`/`refund` מוצלחים
- **שורות:** 42, 1005-1007. `effect <> 'none' and outcome in ('succeeded','pending','review')` → קמפיין `approved` שהתפיסה שלו שוחררה (`authorize`+`release`, בלי כסף) לא ניתן לביטול; גם `refund` מוצלח חוסם לנצח. **שוויון להיום** (VERIFIED-LIVE: `campaigns_guard_cancel`/`cancel_campaign` בודקות `capture_status is distinct from 'authorized'` והיא נשארת `authorized` אחרי שחרור), אז אין רגרסיה — אבל המודל החדש מאפשר תנאי נכון: "commit מוצלח שלא אחריו void, או `collected > 0` נטו, או pending/review". החלטת מוצר; לסמן.

#### 39. `explain` על קריאת פונקציה לא מציג את ה-Index Scan
- **שורה:** 1009. `explain (analyze) select public.campaign_committed_amount('…')` מציג Result בלבד אלא אם הפונקציה inlined (לא מובטח לפונקציה עם subselect). להריץ `explain` על גוף השאילתה.

#### 40. `"payments:backfill"` — הפקודה לא כתובה
- **שורות:** 643, 837. ה-script נוסף ל-`package.json` בלי תוכן; שלב 4 מריץ esbuild + node ידנית. VERIFIED (FILE): `payments:backfill` לא קיים היום.

#### 41. `occurred_at` של פעולה דו-שלבית = זמן ה-`begin`, לא זמן הספק
- **שורות:** 223 ("when it happened at the provider"), 257 (`guard_update` אוסר שינוי `occurred_at`), 854 (`completeOperation` בלי `occurredAt`). לפעולות `authorize`/`charge` דרך begin/complete, `occurred_at` יהיה זמן ההתחלה. מקובל, אבל לתעד או להתיר עדכון `occurred_at` בהשלמה.

#### 42. הפניות שורה קטנות
- 780: "`sumit-hold-reconcile.ts:51-54`" — `recordReleaseActivity` ב-48-63, ה-`meta` ב-53-57.
- 654-655: "16:38:52Z"/"10:18:50Z" — VERIFIED-LIVE `authorized_at` = `2026-07-21 16:38:52.003+00`, `2026-07-07 10:18:50.025+00` (מילישניות). `plusOneSecond` שומר אותן (`…:53.003Z`); הבדיקות משתמשות במחרוזות מלאכותיות — תקין, רק לדעת שה-`+1s` בפועל הוא `.003`.

---

## 3. אומת כנכון

- **DB חי:** `campaigns` 49 עמודות; שלושת הקמפיינים: `15a8730e` (closed, authorized 152 ב-07.07 10:18:50.025Z, `nothing_to_charge`, `credit_applied` 84, `charged_at` 21.08 12:47:04Z, `hold_order_document_id` null), `49a4617b` (closed, 4 ב-21.07 16:38:52.003Z, `nothing_to_charge`, 4, `charged_at` 27.07 08:53:58Z, null), `39334087` (active, 200 ב-02.09 13:14:22.063Z, `release_status='released'`, doc 2327129322, `sumit_customer_id` 2327129071, `credit_applied` 0). `approved_by` מלא בשלושתם. `sum(credit_applied)` = 88 ✓.
- `billing_credits`: `294d23e1` — 84 לא-מבוטל (+160, +84 מבוטלים); `659ae5e7` — 10 → היתרות 0 ו-6 ✓ (שורה 69).
- `owner_agent_billing_sums`: 4 עמודות, `stable`, `search_path=''`, לא SECDEF; הצרכן קורא את הארבע (FILE `cores/billing.ts:61-72`) ✓.
- `campaigns_guard_cancel`/`cancel_campaign`: 3 שורות `capture_status` + `charge_status is null` + `billed_results` + `status in ('draft','pending_approval','approved')` — "שלוש שורות capture_status ושורת charge_status" (1005) מדויק ✓. `reconcile_authorized_set` ו-`try_record_billed_result`: הופעה אחת של `auth_amount` בכל אחת; `billing_exposure_gate` ב-`try_record_billed_result` ✓.
- `extensions.uuid_generate_v7()`: עובד תחת `set search_path = ''` (VERIFIED-LIVE: החזירה `01a0d536-cf40-7d60-…`, nibble 7); owner `postgres`; EXECUTE ל-`postgres` ול-`service_role`; USAGE על `extensions` לשניהם → ניתנת לקריאה מתוך plpgsql של `postgres` ומ-default של טבלה שמכניס אליה `service_role` ✓. `cem-uuidv7` 1.0.2 ב-`extensions`, `supabase_vault` 0.3.1, `pg_tle` 1.4.0, `supabase-dbdev` 0.0.5, `olirice-asciiplot` 0.0.1 ב-`public` ✓ (Step 3 יחזיר 2 שורות).
- `pg_default_acl`: לסכימה `public`, מ-`postgres` ומ-`supabase_admin`: `arwdDxtm` ל-`anon`, `authenticated`, `service_role` על טבלאות; `X` על פונקציות; `rwU` על sequences. הניסוח בשורה 111 ("ה-default ACL של `public` מעניק לו `arwdDxtm` על כל טבלה חדשה") מדויק ✓. `postgres` ו-`service_role`: `rolbypassrls = true` ✓.
- `campaigns`: אין UPDATE policy ל-`authenticated` (policy יחידה: SELECT) → כל שינוי סטטוס עובר ב-`service_role`/`postgres` → `campaigns_guard_activate` (security invoker) תמיד רץ בתפקיד שיש לו EXECUTE על `campaign_committed_amount` ו-SELECT על היומן ✓. `campaign_committed_amount` בתוך ה-RPC ה-SECDEF רץ כ-`postgres` (owner, bypassrls) ✓.
- טריגרים חיים על `campaigns`: `campaigns_guard_cancel`, `campaigns_require_active_event`, `trg_campaigns_updated` ✓ (48).
- `campaign_status` כולל `scheduled`, `paused`, `awaiting_invoice`, `billed`, `paid` ✓ (29, 991).
- `event_cancellation_requests`: שורה אחת, `resolved`/`declined`, `sumit_document_id` null → 0 שורות `cancellation_charge` ✓ (835).
- דפוס Vault: `integrations_write_credential`/`integrations_read_credential` — `prosecdef=false`, `search_path=""` ✓; המיגרציה `20260916002343` משתמשת ב-`gen_random_uuid()` (54, 103) — התוכנית עוברת ל-v7 ✓ בכוונה. `credential-accessor.ts:151` `admin.rpc('integrations_read_credential', …)` ✓.
- **קוד:** `STUCK_CAPTURE_STATUSES` ב-`cores/campaigns.ts:45` כולל `hold_failed` ✓. `markCampaignChargeOutcome` (`campaigns.ts:829-856`) כותב `final_charge_amount=0`, `credit_applied`, `charged_at` ב-`nothing_to_charge` ✓; נקרא מ-`close-charge.ts:257` ✓. `capture.ts:121-137`: `CreditCard_Token` + `CreditCard_CitizenID` בגוף ה-POST ✓. `hold-status.ts:16-20`: `Billing_Date` = `authorized_at` "to the second" ✓. `close-charge.ts:155-161, 338-348` ✓. `event-cancellation.ts:513-522` כותב `sumit_document_id/_url` עם `resolution_amount`, `resolved_at` ✓. `event-labels.ts:130-145`, `setup-steps.ts:31`, `event-stats.ts:172-178, 292-300`, `callbacks.ts:650-652`, `users.ts:277-279`, `billing.ts:111-115`, `tax-ceiling.ts:28-32` ✓. `payment/page.tsx:90,104,122` ✓. `reconcile.integration.test.ts:7-16` ✓.
- `package.json`: `gen:types`, `types:check`, `worker:deps`, `owner-agent:smoke` (אותם aliases של esbuild), `deploy`, `test`, `lint` קיימים; `dist/` ב-`.gitignore:71`; `worker/empty.js` קיים ✓.
- **Task 2 ידנית מול המימוש (507-529):** כל 15 בדיקות `deriveStatus` + 9 של `paymentBadge` = 24 ✓ (549). כולל: `authorize→charge(0)→release` = `collected`/0; `charge→refund(50)` = `collected`/150; `charge→refund(200)` = `refunded`/0; `only failed authorize` = `declined`; `authorize→charge pending` = `pending`.
- **Task 4 ידנית מול `planOperations` (741-771):** כל 12 המקרים תואמים; `plusOneSecond('2026-09-02T13:14:22Z')` = `'2026-09-02T13:14:23Z'` (replace `.000Z`→`Z`) ✓; `parent_operation_id` רק ל-`release` = id של ה-`authorize` ✓; 8 שורות (2+3+3) ✓; `deriveStatus` לכל קמפיין: קאקון `released`, הסגורים `collected`/0 ✓.
- **Task 5:** `createFakeTableClient` מדווח שורות ל-update רק עם `.select()` ✓ (`completeOperation` 0 שורות → throw ניתן למימוש); ה-`uniqueIndexes` בבדיקה 2 מדמה את `guard_once` ✓.
- **Task 1 SQL:** תחביר `revoke all on table a, b, c from …` ✓; `errcode` `check_violation`/`unique_violation` ✓; אינדקס ביטוי `(meta->>'cancellation_request_id') where meta ? …` ✓; dry-run (a) `has_table_privilege(…,'select,insert,update,delete')` ✓ (אימתתי חי על `integration_connections`: `anon_sel=false, sr=true`); (e) תחביר ✓ (אך ראה #31).
- מיגרציות מסונכרנות (`migration list --linked`, האחרונה `20260924061630`) ✓.

---

## 4. ספירה

| חוסם | חשוב | קל |
|---|---|---|
| 2 (#23, #24) | 6 (#25-#30) | 12 (#31-#42) |

---

## 5. פסק דין

**לא מוכנה לביצוע כפי שהיא.** המינימום:

1. **#23:** `?.campaignId` בבקפיל + אימות זמן ה-release של קאקון ב-Step 4.
2. **#24:** `guard_once` בודק `new.outcome in ('pending','succeeded')`; להכריע על `authorize` `once_per_campaign` (true = שוויון להיום); לעדכן dry-run (h) ו-`ledger.test.ts`.
3. **#25:** Task 5 שלב 4 — למחוק את סעיף ה-`recordOperation` של authorize; begin/complete בלבד, עם ה-id שעובר ב-route.
4. **#26:** `campaigns_guard_activate`: `old.status in ('approved','scheduled','paused')`.
5. **#27:** Task 1 — לתעד שה-CLI מריץ `create index` מחוץ ל-batch; להוסיף "אם נכשל באמצע — ROLLBACK ידני ואז push", או להעביר לטרנזקציה מפורשת/קובץ שני.
6. **#28, #29:** משפט ב-Task 7: "היומן נקרא רק דרך `createAdminClient()` אחרי בדיקת בעלות"; ולכתוב איך `ADMIN_ATTENTION_FILTER`/`needsAttention` מבוטאים בלי `capture_status`.
7. **#30:** תיקון קריטריון הקבלה של Task 6.

הקלים (#31-#42) הם תיקוני ציפיות/ניסוח לאותו סבב; #33 ייתפס ב-tsc אבל עדיף לתקן ב-SQL (`default null`).
