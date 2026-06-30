# KALFA — אימות מצב קיים מקצה‑לקצה (read‑only, אמפירי)

> **מטרה:** קריאת `plans/authz-audit-unified-report.md` ואז אימות **חי** של כל טענות הדוח
> מול ה‑DB החי ב‑Supabase והקוד — "מקצה לקצה", כולל בדיקת כל הטבלאות.
> **תאריך:** 2026‑06‑30. **אימות מול תיעוד חי בלבד** (לא קבצי repo).
> **לא בוצע שום שינוי** בסכמה/קוד/נתונים — בדיקה בלבד.

> **כלים:** `supabase db query --linked` + `supabase db advisors --linked` (CLI v2.107.0),
> פרויקט מקושר `cklpaxihpyjbhymqtduv`. קטלוגי מערכת (`pg_class`/`pg_policy`/`pg_proc`/
> `pg_constraint`/`pg_trigger`/`aclexplode`/`has_function_privilege`) — לא `information_schema`
> (שמחזיר ריק ל‑FK/UNIQUE אמיתיים).

---

## 0. שורה תחתונה

**דוח הביקורת המאוחד מדויק אמפירית.** כל טענת סטטוס אומתה מול ה‑DB החי:

| נושא | טענת הדוח | אימות חי | סטטוס |
|---|---|---|---|
| **P0 — נעילת billing RPCs** | RESOLVED (mig 0038) | `try_record_billed_result` + `campaign_billing_summary`: `anon✗ auth✗ svc✓`; advisor כבר לא מדווח עליהן ב‑0028/0029 | ✅ **מאומת נעול** |
| **L0a — שומרי תאריך אירוע** | APPLIED (mig L0a) | 2 טריגרים מחוברים ל‑`events` + CHECK `events_rsvp_deadline_within_event` חיים | ✅ **מאומת חי** |
| **L0b / LC‑3** | DEFERRED | CHECK המלווה + טריגר immutability **לא קיימים** | ⏳ פתוח (כצפוי) |
| **L1 — `assertEventNotPast`** | פתוח | **לא קיים בקוד כלל**; אין event_date guard באף מסלול קמפיין/שליחה | ❌ **פתוח** |
| **L2 — שומרי RPC + שלמות** | פתוח | גופי `submit_rsvp`/`get_rsvp_by_token`/`try_record_billed_result` החיים — **ללא event_date guard**; `p_event` מוכנס מילולית | ❌ **פתוח** |
| **P2/P3 — hardening** | פתוח | advisor חי: 11 SECDEF anon/auth‑executable + `set_updated_at` search_path + 2× contact‑form always‑true | ❌ פתוח (latent) |

**מסקנה:** אין חשיפת אבטחה פתוחה שהוכחה‑חי בתוך היקף הביקורת. שני החורים היחידים
שהוכחו‑חי (billing RPCs) — **סגורים ומאומתים**. הפערים שנותרו הם **שלמות מסחרית /
מחזור‑חיים** (LC‑1…LC‑5) ו‑**hardening defense‑in‑depth** — לא חורי authz נצולים.

---

## 1. שכבת ה‑DB — אימות מלא

### 1.1 טבלאות + RLS (33 טבלאות)
כל 33 הטבלאות הציבוריות: **RLS מופעל**, אף אחת **לא** `FORCE ROW LEVEL SECURITY`,
לכל אחת ≥1 policy. תואם לטענת "RLS on all 33 tables".

### 1.2 Grants ברמת הטבלה — ה"frame" המערכתי
`anon` **ו‑**`authenticated` מחזיקים **ALL** (`arwdDxtm`) על **כל** טבלה כברירת מחדל →
**RLS הוא קו הבידוד האפקטיבי לכל טבלה**. שני revokes ממוקדים בלבד:
- `guests` — ל‑`anon` חסרים **SELECT, UPDATE** (נשמרו INSERT/DELETE).
- `rsvp_responses` — ל‑`anon` חסר **INSERT** (נשמרו SELECT/UPDATE/DELETE).

שניהם נשענים על **היעדר policy ל‑anon** (לא על ה‑grant) — מאובטחים בפועל אך ה‑grant רחב.
מסקנה: כל פער RLS בטבלה = חשיפה.

### 1.3 משטח החשיפה האנונימי האמיתי
שלוש policies חשופות אמיתית ל‑anon (כל השאר על role `{public}` מגודרות ב‑
`auth.uid()`/`owns_event`/`has_role`/`has_org_permission`/`is_org_member` → anon=0 שורות):
- `callback_requests.cb_insert_anyone` — INSERT, `WITH CHECK (true)` — טופס יצירת קשר ציבורי.
- `contact_messages.cm_insert_anyone` — INSERT, `WITH CHECK (true)` — טופס יצירת קשר ציבורי.
- `packages.packages_public_read` — SELECT, `active = true` — קריאת חבילות ציבורית (תקין).

שני ה‑INSERT הציבוריים = advisor `0024` (always‑true) — **וקטור abuse** (אין WITH CHECK חסום
ואין rate‑limit ב‑DB). חומרה נמוכה, פתוח.

### 1.4 פונקציות — מצב אבטחה + EXECUTE (הליבה)
18 פונקציות ב‑`public`; **16 SECURITY DEFINER**, 2 INVOKER. כל ה‑SECDEF עם `search_path=public`.

**נעולות (anon✗ auth✗ svc✓) — מאומת:**
`try_record_billed_result` · `campaign_billing_summary` · `submit_rsvp` ·
`get_rsvp_by_token` · `claim_webhook_events`.
→ **P0 מאומת**: שתי פונקציות ה‑billing נעולות ל‑service_role בלבד.

**SECDEF שעדיין anon✓/auth✓ (advisor 0028/0029 — בדיוק 11, hardening פתוח):**
- 🔒 helpers ב‑RLS quals — **חייבות להישאר ל‑authenticated**: `owns_event`, `has_role`,
  `has_org_permission`, `is_org_member`.
- 🗑️ מתות (0 callers) → revoke+remove: `can_access_event`, `org_role_rank`.
- ⚙️ trigger/util (לא RPC) → revoke anon+auth: `handle_new_user`, `rls_auto_enable`.
- 📞 app‑RPC → revoke anon, לשקול lock per‑site: `accept_invitation`, `claim_first_admin`,
  `create_organization`.

**INVOKER:** `set_updated_at` (ללא search_path — advisor 0011, פתוח) ·
`events_reject_past_event_date` (`search_path=""` — מוקשח, פונקציית הטריגר של L0a).

### 1.5 טריגרים + CHECK — אימות L0a
**טריגרי L0a מחוברים בפועל ל‑`events`:**
- `events_reject_past_event_date_insert` — `BEFORE INSERT … FOR EACH ROW`.
- `events_reject_past_event_date_update` — `BEFORE UPDATE OF event_date … WHEN (old.event_date IS DISTINCT FROM new.event_date)`.

**CHECK של L0a (LC‑2) חי:**
`events_rsvp_deadline_within_event`:
`(rsvp_deadline IS NULL) OR ((event_date IS NOT NULL) AND (rsvp_deadline <= ((event_date AT TIME ZONE 'Asia/Jerusalem')::date)))`
— כולל מדיניות ה‑NULL ("deadline דורש event_date") בדיוק כמפרט.

כל שאר הטריגרים = `set_updated_at`. ה‑CHECK היחיד הנוסף = `app_settings_singleton`.
**`pg_cron` לא מותקן** → אין סגירת אירועים אוטומטית (מאשר את §7). אין companion‑CHECK
(`status='draft' OR event_date IS NOT NULL`) ואין טריגר LC‑3 → L0b/LC‑3 נדחו.

### 1.6 אילוצי שלמות (FK/UNIQUE)
`billed_results`: FK ל‑campaigns/contacts/events (ON DELETE CASCADE) + **UNIQUE(event_id, contact_id)**.
→ מאשר את סיכון L2‑iii: `try_record_billed_result` מכניס `p_event` שסופק ע"י הקורא; UUID שגוי
כותב חיוב תחת **event שגוי** (ייחודיות event‑scoped). `campaign_authorized_contacts` UNIQUE(campaign_id, contact_id);
`outreach_state` UNIQUE(campaign_id, contact_id).

### 1.7 Security Advisor (ריצה חיה)
WARN בלבד, כולם תואמים לדוח: `0011` (`set_updated_at` + 5× pgboss vendor) ·
`0024` (`callback_requests`/`contact_messages`) · `0028`/`0029` (11 SECDEF) ·
`auth_leaked_password_protection` disabled. **קריטי:** שתי פונקציות ה‑billing **לא מופיעות** →
אישור עצמאי לסגירת P0. אין שום ממצא ERROR.

### 1.8 מיגרציות
`schema_migrations` רושם גם `202606300038 lock_billing_rpcs` וגם
`20260630072729 events_date_guards_l0a` → P0 + L0a מתועדים. 43 קבצי מיגרציה.

---

## 2. גופי ה‑RPC החיים — הפערים הפתוחים

- **`submit_rsvp`** (SECDEF, svc‑only): שער (c) = `status='active'` + `rsvp_deadline`
  (Israel‑calendar) בלבד. **אין השוואת event_date** → deadline=NULL + active = RSVP פתוח
  ללא הגבלה אחרי האירוע. **LC‑4 פתוח.**
- **`get_rsvp_by_token`** (SECDEF, svc‑only): `can_respond` = deadline בלבד. אותו פער.
- **`try_record_billed_result`** (SECDEF, svc‑only): שערים עסקיים תקינים (active/paused,
  start/close window, removal, חברות בקבוצה הקפואה, ceiling) אבל:
  (i) **`insert … values (p_event,…)`** — לא נגזר מ‑`campaign.event_id`, אין `event_mismatch` reject;
  (ii) **אין event_date guard**; (iii) חלון מדולג כש‑`close_at` NULL. **L2‑ii/iii פתוח.**

---

## 3. שכבת האפליקציה

- **L1 (`assertEventNotPast`) לא קיים** — grep על כל `src/` ריק. אין event_date guard ב‑
  `activateCampaign` (campaigns.ts:668), `approveCampaign` (:239), `recordSignedAgreement`
  (agreements.ts:56), `recordCampaignHold` (:323), `sendCampaignWhatsApp` (outreach.ts:70).
- **`stepGate`** (outreach-engine.ts:131) — ה‑context **כולל** `eventDate` (:109) אך השער בודק
  רק enabled / `status='active'` / **`close_at` snapshot** / `isContactReached`. **אין השוואת
  event_date חי** → מסתמך על snapshot שעלול להתיישן (LC‑3b). `isContactReached` +
  UNIQUE(event_id,contact_id) = ערובת stop‑on‑reach (תקין).
- **משמעת two‑tier תקינה** — `createAdminClient` ב‑212 מקומות (~42 קבצים); המסלולים הקריטיים
  שנבדקו (`approveCampaign`, `recordCampaignHold`/`lockCampaignForHold`/`getCampaignForHold`)
  מגודרים ב‑`requireUser`+`requireOwnedEvent` (ישירות או דרך ה‑route handler). `getCampaign`
  הוא קריאת cookie טהורה מגודרת RLS בלבד (`camp_owner_select=owns_event`) — נקודת ה‑RLS היחידה.
- **`close_at = event.event_date`** ב‑`createCampaign` (campaigns.ts:160) — snapshot, הכותב היחיד.

---

## 4. ראיות מנתונים חיים

- **LC‑4 חי היום:** אירוע `03733daf` — `active`, event_date `2026‑06‑22` (8 ימים בעבר,
  today_IL `2026‑06‑30`), deadline `null` → submit_rsvp יחזיר הצלחה. הראיה שהדוח ציטט,
  **עדיין נכונה**.
- **one‑campaign‑per‑event:** ההפרה היחידה (6 קמפיינים) על `00000000‑…` (UUID אפסים =
  נתוני test/seed), **לא** אירוע פרודקשן → מאשר את ה‑retraction של LC‑3. אירועים אמיתיים ≤1 קמפיין.
- **נפחים:** events 3 · campaigns 8 (6 מהם על אירוע‑האפס) · guests 4 · contacts 3 ·
  **rsvp_responses 0** · **billed_results 0** · organizations 2 · user_roles 2 · webhook_inbox 4.
  → פער LC‑4 latent אך **טרם נוצל** (0 הגשות, 0 חיובים); סביבה בשלב מוקדם/בדיקות.

---

## 5. מרשם פערים — מצב נוכחי

| # | פער | מחלקה | חומרה | סטטוס חי |
|---|---|---|---|---|
| 1 | `try_record_billed_result` anon‑exposed (write) | authz + exec‑identity | 🔴 high (הוכח‑חי) | ✅ **נסגר (0038)** |
| 2 | `campaign_billing_summary` anon‑exposed (read) | authz + exec‑identity | ⚠️ medium (הוכח‑חי) | ✅ **נסגר (0038)** |
| 3 | LC‑1/LC‑2 שומרי תאריך (create/edit) | business lifecycle | medium | ✅ **נסגר (L0a)** |
| 4 | **LC‑4 RSVP אחרי אירוע** (submit/get_rsvp ללא event_date) | business lifecycle | medium (חי: `03733daf`) | ❌ פתוח (L2) |
| 5 | **L1 — אין `assertEventNotPast`** (activate/approve/sign/hold/send/stepGate) | business lifecycle | medium | ❌ פתוח |
| 6 | **L2‑iii — שלמות `try_record_billed_result`** (`p_event` מילולי, אין event_mismatch) | data‑integrity | medium | ❌ פתוח |
| 7 | LC‑3 — תאריך mutable תחת קמפיין non‑draft (REST‑bypassable) | business lifecycle | low‑med | ❌ פתוח (L0b) |
| 8 | 11 SECDEF anon/auth‑executable | idiom hardening | low | ❌ פתוח (P2/P3) |
| 9 | `set_updated_at` search_path mutable | idiom hardening | low | ❌ פתוח (P2) |
| 10 | `callback_requests`/`contact_messages` INSERT always‑true, ללא rate‑limit | abuse | low | ❌ פתוח (P1.5) |
| 11 | ~37 policies על role `{public}` (מגודרות) | idiom hardening (latent) | low | ❌ פתוח (P2) |
| 12 | org‑access (`can_access_event`) בנוי, לא מחובר ל‑events RLS | implementation gap (fail‑closed) | low | ❌ פתוח (החלטת מוצר) |

---

## 6. פעולות מומלצות לפי עדיפות (forward migration בלבד)

1. **L1 — `assertEventNotPast(eventId)` משותף** (calendar‑day‑in‑Israel) ב‑activate / approve /
   sign / J5 hold / manual send + עצירת `event_date` חי ב‑`stepGate`. **הצעד הבא לפי המצב.**
2. **L2 — שומרי RPC + שלמות:** (i) event_date gate בתוך `submit_rsvp` + `get_rsvp_by_token`;
   (ii) ב‑`try_record_billed_result` — לגזור `event_id` מ‑`campaign.event_id`, להחזיר
   `event_mismatch` כש‑`p_event ≠ campaign.event_id`, ולאמת ש‑`p_contact` שייך לאותו אירוע.
3. **L0b / LC‑3** (אחרי החלטת reschedule): companion‑CHECK + טריגר immutability לתאריך
   תחת קמפיין non‑draft/non‑cancelled.
4. **P1.5** — rate‑limit + WITH CHECK חסום ל‑`callback_requests`/`contact_messages`.
5. **P2/P3 hardening** — revoke EXECUTE מ‑SECDEF מתות (`can_access_event`, `org_role_rank`) +
   trigger/util (`handle_new_user`, `rls_auto_enable`) + anon מ‑app‑RPC; `search_path=''` ל‑
   `set_updated_at`; העברת policies מגודרות מ‑`{public}` ל‑`{authenticated}` (אחת‑אחת);
   הפעלת leaked‑password protection בלוח הבקרה.
6. **החלטת org‑vs‑events** — לחבר org ל‑events RLS, או להסיר את הענף המת.

> כל תיקון של `events`/RSVP/billing **חייב** רובד DB (trigger/CHECK/RPC) — `events` כתיב‑בעלים
> דרך PostgREST, ו‑Zod הוא UX בלבד ועקיף.

---

## 7. מה לא נבדק (היקף)
client‑side (XSS/CSRF מעבר ל‑origin checks), ניהול secrets/תשתית, מלוא Storage RLS,
supply‑chain/dependencies, ועומק DoS/rate‑limiting. ממצא נקי בתחום שנבדק אינו הוכחה
להיעדר פגיעויות בתחום שלא נבדק. אימות build/lint/types/tests לא הורץ בריצה זו (סיכון
התנגשות נעילת build משותפת) — הריצה האחרונה בהיסטוריה: vitest ירוק, tsc/eslint/build עברו.
