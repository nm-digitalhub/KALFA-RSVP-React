# Public RSVP Web Surface — Implementation Plan (end-to-end wiring)

> תקציר עברית: מודל-הנתונים של אישור-ההגעה קיים ומעוצב היטב (טוקן נוצר אוטומטית ב-DB, טבלת
> `rsvp_responses` עם `extras jsonb`, שאלות מותאמות `event_questions`, rate-limiter מוכן, **ושני
> ה-RPCs `get_rsvp_by_token` + `submit_rsvp` קיימים** — אומת ב-`pg_proc`; `information_schema.routines`
> לא מציג אותם). **כל השכבה מול-האורח חסרה ב-100%**: אין route/עמוד/קריאה/הגשה/שימוש-ב-rate-limit/יצירת-קישור.
> בנוסף נמצא **חור אבטחה**: שני ה-RPCs היו פתוחים להרצה אנונימית ישירה, ולכן rate-limiter של Next לא הגן עליהם.
> ההקשחה (מיגרציה `202606290034_rsvp_harden.sql`, **טרם הוחלה**) מבטלת הרצה אנונימית, מעבירה את שניהם להרצת
> שרת-בלבד (service-role), ומשאירה את כל שערי-התקינות בתוך הפונקציה. **לא מתחילים מימוש לפני אישור** (משטח רגיש:
> PII + מוטציה ציבורית).

This is the **RSVP slice** of the master gap plan `plans/master-gap-map.md` (bridges A1–A2, gaps
`OB-RSVP` / `OB-RPC-READ` / `OB-RPC-WRITE`). **All facts below are primary-source** (`sb-query` against the
live DB, this session).

---

## A. Verified live facts (primary source — corrects earlier drafts)

### A.1 The two RPCs EXIST (authoritative: `pg_proc`)
- `get_rsvp_by_token(_token text) → jsonb`, SECURITY DEFINER, STABLE.
- `submit_rsvp(_token, _attending boolean, _adults int, _kids int, _meal text, _note text) → ...`, SECURITY DEFINER
  (live signature is the **6-arg boolean** form).
- Both were granted EXECUTE to `anon, authenticated, service_role`. **`information_schema.routines` returns `[]` for
  them** — that view is unreliable here; `pg_proc` is authoritative. (An earlier agent wrongly concluded "they don't exist".)

### A.2 Live data state (decides the go-live pre-flight)
- **2 events:** one `draft`, one `active`. The **active** event's `rsvp_deadline = 2026-06-22` — **already passed** (today 2026-06-29).
- **2 guests, both `pending`.** No `rsvp_responses` yet. No `event_questions` yet.
- No negative counts, no over-`expected_count`, no duplicate tokens, no response↔guest mismatch.
- **DB session time zone is UTC, not Israel** → every deadline comparison MUST be done in `Asia/Jerusalem` explicitly.
- **`guests.expected_count` is nullable (default 1) but the data layer inserts `expected_count ?? null`** (`guests.ts:261`)
  → guests imported without a count hold **NULL**, so a count rule that coalesces NULL→1 would reject every "+1".

### A.3 Token strength + rotation of sub-standard live tokens (pre-flight, approval-gated)
- **Decision (token security):** the source primitive (`extensions.gen_random_bytes`, a CSPRNG) was always correct, but the
  length was **96-bit** (12 bytes) — below OWASP's 128-bit guidance for a URL bearer token and below the codebase's own
  256-bit `newToken()` (`src/lib/data/orgs.ts:255`). `guests.ts` **intentionally never sets `rsvp_token`** (it is left to the DB
  default — the server-controlled home: `guests.ts:242,558`), so the **DB default is the single point to strengthen**, NOT
  app-side generation (forcing `newToken()` would fight that invariant and add a second token format).
- **Schema part (now IN the migration, §C):** `alter column rsvp_token set default encode(extensions.gen_random_bytes(16),'hex')`
  → every new guest gets **128-bit** (32 lowercase-hex). *Empirically verified:* a default-inserted guest matches `^[0-9a-f]{32}$`.
- **Live-data part (separate, approval-gated UPDATE — a DEFAULT change never touches stored rows):** the active event's seed guest
  `00000000-…-a1` has a **non-canonical** token (unknown entropy, hand-set fixture, no `contact_id`); the other existing token is a
  valid-but-96-bit one. Rotate **every token below the new standard** in one idempotent statement:
  ```sql
  update public.guests
     set rsvp_token = encode(extensions.gen_random_bytes(16), 'hex'),
         rsvp_token_revoked_at = null
   where rsvp_token !~ '^[0-9a-f]{32}$';   -- idempotent: only sub-128-bit / malformed rows
  ```
  (Or, once built, via the owner data-layer `regenerateRsvpToken(guestId)` — §G — which uses the same DB-level expression.)
  Safe: both events are pre-public / past-deadline with no responses, so no outstanding link is invalidated in practice.

### A.4 Tables (live introspection)
- `guests`: `rsvp_token text` (DB default bumped to `encode(extensions.gen_random_bytes(16),'hex')` = 128-bit hex — §A.3), **`contact_id uuid` FK → `contacts(id)`
  ON DELETE SET NULL** (index `guests_contact_idx`; **NO unique constraint** → a contact may map to many guests in future),
  `status guest_status {pending,attending,declined,maybe}`, `expected_count int NULL`, `confirmed_adults/kids int`,
  `meal_pref/note text`, `contact_status`, **+ new `rsvp_token_revoked_at timestamptz` (this migration)**.
- `rsvp_responses`: `id, guest_id, event_id, attending bool, adults int, kids int, meal_pref text, note text,
  extras jsonb NOT NULL, created_at` → the answers column already exists.
- `event_questions`: `id, event_id, q_key, label, q_type, required, enabled, sort_order, options jsonb, created_at` — orphan (no app code).
- `events`: `status event_status {draft,active,closed}`, `rsvp_deadline date` (nullable), `event_date timestamptz`.

### A.5 The contact↔guest bridge **EXISTS** (corrects the old §E premise)
The earlier plan claimed "no relationship between the entities; only `event_id + normalized_phone`." **That is wrong.**
The bridge is **`guests.contact_id` → `contacts.id`** (guest→contact direction). Live:
- one guest is **already linked** to a contact; one guest is **unlinked** (has a phone, but no same-event contact matches it);
- the existing link is event-consistent (no cross-event link); currently no contact maps to >1 guest, **but no DB constraint guarantees that**.
→ Consequence: the per-guest WhatsApp link (A3) is **NOT fully blocked** — it is ready for guests that already carry a
`contact_id`. It still needs a **policy for unlinked guests**, and must **NOT** do real-time phone matching.

---

## B. Scope of THIS slice (A1 + A2; A5-render folds in)

| Bridge | What | Ready? |
|---|---|---|
| **A2** | Harden + lock down `get_rsvp_by_token` + `submit_rsvp` (migration `202606290034`, **written, not applied**) | ✅ written — needs apply approval |
| **A1** | Public login-free page `src/app/(public)/r/[token]` + form + **server action** submit | ✅ shovel-ready (after A2 + token rotation) |
| A5-render | Render enabled `event_questions` + write answers to `rsvp_responses.extras` | ✅ folds into A1/A2 |
| A3 | Per-guest RSVP link in the WhatsApp send | ◑ ready for **linked** guests via `guests.contact_id`; needs unlinked-guest policy |
| A4 | Inbound quick-reply (מגיע/לא מגיע/אולי) → `guests.status` | ◑ resolve via the **send-time operation id**, not phone-match |
| A5-author | Owner UI to author `event_questions` | ◦ follow-up (page renders if any exist) |

A1+A2(+A5-render) give a **fully working guest RSVP web flow** end-to-end (owner shares the `/r/<token>` link),
independent of WhatsApp.

---

## C. The hardening — `202606290034_rsvp_harden.sql` ✅ **APPLIED + verified on the live DB** (2026-06-29)
> Applied transactionally via the Management API query endpoint (runs as `postgres`; NOT `db push` — the local
> migrations folder is partial). Verified live: both fns `postgres,service_role` only (anon/authenticated revoked);
> default = `gen_random_bytes(16)` (128-bit); `rsvp_token_revoked_at` added; `eq_public_read`+`rsvp_auth_insert` dropped.
> Live tokens rotated to 128-bit (2/2 canonical, 0 sub-standard). Smoke test: draft→NULL, active→resolves+can_respond=false.
> Rollback reference (old fn bodies + before-state) captured in the session scratchpad.

Folds in the full security review. All gates live **inside** the SECURITY DEFINER functions; the app only rate-limits
and calls them server-side.

### C.0 Schema (additive)
- `guests.rsvp_token_revoked_at timestamptz` (revocation/rotation gate; mirrors `organization_invitations.revoked_at`).
- `guests.rsvp_token` **DEFAULT bumped 96→128-bit**: `encode(extensions.gen_random_bytes(16),'hex')` (§A.3). Governs every new
  guest (the app never sets the token). Existing rows unaffected by a DEFAULT change → rotated separately (§A.3, approval-gated).

### C.1 `get_rsvp_by_token(_token text) → jsonb` — `CREATE OR REPLACE` (same signature)
- Gate: token **not revoked** (`rsvp_token_revoked_at IS NULL`) **AND** `events.status='active'`. Else → **NULL**
  (draft/closed/unknown/revoked indistinguishable — no enumeration signal).
- Returns `event` display + `guest` (first name + prior answer for prefill) + **`questions[]`** (enabled, sorted) +
  **`can_respond`** = `rsvp_deadline IS NULL OR (now() at time zone 'Asia/Jerusalem')::date <= rsvp_deadline`.
- **Prefill `answers` is filtered to currently-enabled questions** → a disabled/deleted question's value never re-enters resubmit.

### C.2 `submit_rsvp(_token, _status text, _adults, _kids, _meal, _note, _answers jsonb default '{}') → jsonb` — DROP(6-arg)+CREATE
- `_status ∈ {attending,declined,maybe}` (replaces the boolean → supports אולי).
- **Locks the guest row** (`FOR UPDATE`) → race-safe idempotency.
- Gates: token+not-revoked; `events.status='active'`; deadline in **Asia/Jerusalem**.
- **Count rule tied to `expected_count`** (review #4): attending → `1 ≤ adults+kids ≤ expected_count`, **no upper cap when
  `expected_count IS NULL`**; declined/maybe → counts forced 0, meal cleared.
- **Answer validation in-DB** (review #5): unknown key (not a q_key for the event at all) → reject; required enforced on
  enabled; free text ≤ 500; choice answer must be a member of `options` (jsonb array; guarded by `jsonb_typeof='array'`).
- **Idempotency** (review #3): compare normalized payload to the guest's most-recent response; unchanged → `{ok,status,unchanged:true}` with **no new row**.
- Else: append `rsvp_responses` (audit) + last-write-wins UPDATE `guests` (`status`, counts, `meal_pref`, `note`, `contact_status='responded'`).

### C.3 Lock-down (review #2, #6 — the core fix)
- `eq_public_read` (anon SELECT on `event_questions`) **dropped** — the read function is the only public path to questions.
- `rsvp_auth_insert` (inert authenticated INSERT on `rsvp_responses`) **dropped** — only the SECDEF submit writes it.
- **EXECUTE revoked from `public, anon, authenticated` on BOTH functions; granted only to `service_role`.** They are now
  reachable **only** from a server-side service-role client, behind the Next rate limiter — the limiter can no longer be bypassed.

---

## D. Product decisions — LOCKED (user-approved 2026-06-29)
1. **Count bound** → **positive + ceiling = `expected_count`** (review #4 supersedes the earlier "0..20" cap). Enforced in `submit_rsvp` AND `rsvpSubmitSchema` (Zod).
2. **"אולי" on the web** → **YES** (מגיע/אולי/לא מגיע).
3. **Edit with prefill** → **YES** (C.1 returns prior answer + filtered `extras`).
4. **Sequencing** → A1+A2(+A5-render) now; A3/A4 follow-up.
5. **Revocation** → **revoke + full renewal** (`rsvp_token_revoked_at` + regenerate; mirrors `organization_invitations`).

---

## E. WhatsApp linking (A3/A4) — REVISED per the live bridge (review + user findings)
- **Use the existing `guests.contact_id` link when present.** Do **NOT** phone-match in real time.
- **Unlinked guest** (e.g. the active-event seed guest) → **do not send a personal link** until an explicit linking
  mechanism is defined. No silent phone-match fallback.
- The bridge is **not guaranteed 1:1** (no unique on `contact_id`; families/shared numbers). A future explicit link
  must tolerate **many guests per contact** — not assume one.
- **A3 send:** the per-guest token URL-button is emitted in the contact-iterating send only for contacts whose guest
  is resolvable via `contact_id`; bind the send to an **atomic operation id** created at send time.
- **A4 inbound:** resolve the quick-reply back to the guest via that **send-time operation id**, NOT by re-matching phone.

---

## F. Layers to build (A1+A2 slice)
1. **DB migration** `202606290034_rsvp_harden.sql` — **written; apply is approval-gated** (§C).
2. **Pre-flight data fix** — rotate the anomalous active-event token (§A.3) — **approval-gated**.
3. **Data layer** `src/lib/data/rsvp.ts` (server-only, NEW):
   - `getRsvpByToken(token)` — calls the read RPC via **`createAdminClient()` (service-role)**, server-only. (Anon/authenticated
     EXECUTE was revoked in §C, so the **admin client is now required** — this supersedes the earlier "anon client" note and
     reuse-memory #12, which assumed the old anon-grant design. The service-role key stays server-only; the token is the
     in-function gate; the admin client is used ONLY to invoke this one validated RPC, never for arbitrary public queries.)
   - `submitRsvp(token, input)` — calls the submit RPC via the same service-role client; `logActivity(event_id+guest_id, no PII)`; typed result mapping each reason code.
4. **Validation** `src/lib/validation/rsvp.ts` (NEW): `rsvpSubmitSchema` — `status` enum, `adults/kids` bounds, `meal_pref?`/`note?` maxlen, `answers?`.
5. **Route + page** `src/app/(public)/r/[token]/`:
   - `page.tsx` (Server Component): `export const dynamic = 'force-dynamic'`; `export const metadata = { robots: { index:false, follow:false } }`;
     rate-limit READ (`RSVP_READ_RATE`, token+IP) → `getRsvpByToken` → render `<RsvpForm>` or a generic privacy-safe error.
   - **Headers (code-phase, not implied by force-dynamic):** set `Cache-Control: no-store` explicitly and `Referrer-Policy: no-referrer`
     for `/r/*`. Note: the token is in the URL **path**, so it lands in nginx/pm2 access logs regardless of referrer — accepted as
     the standard RSVP-magic-link posture (mitigated by revocation + per-event scope + the unguessable token); **no token in any
     client-side log/analytics**.
   - `actions.ts`: `submitRsvpAction` → Zod → rate-limit SUBMIT (`RSVP_SUBMIT_RATE`) → `submitRsvp` (service-role) → `FormState`.
   - `rsvp-form.tsx` (`"use client"`, `useActionState`): RTL; מגיע/אולי/לא-מגיע toggle; adults/kids steppers (hidden/zeroed unless attending);
     meal/note; enabled `event_questions`; loading/empty/error/success. Reuse `forms.tsx` + `ui/*`; portaled controls wrap in Base UI `DirectionProvider` ([[base-ui-rtl-direction-provider]]).
6. **Owner visibility** EXTEND `events/[id]/guests/[guestId]/page.tsx`: surface the guest's response + a **"העתק קישור אישור הגעה"**
   button (build URL from `APP_ORIGIN` + token, server-side) + **revoke/regenerate** controls (§G). Owner RLS already permits.

## G. Owner revoke / regenerate (decision §D.5 — mirrors `organization_invitations`)
- New data-layer (in `src/lib/data/guests.ts` or `rsvp.ts`, owner-gated via `requireOwnedEvent`):
  - `revokeRsvpToken(guestId)` → set `rsvp_token_revoked_at = now()` (both RPCs then treat the link as not-found).
  - `regenerateRsvpToken(guestId)` → set a fresh 128-bit canonical token (`crypto.randomBytes(16).toString('hex')`, matching the
    bumped DB default — §A.3) **and** clear `rsvp_token_revoked_at`. Mirrors the `revokeInvitation`/`resendInvitation` revoke-then-renew posture.
- This is also the proper mechanism for the §A.3 anomalous-token fix.

## H. Follow-up layers (A3/A4/A5-author — after §E policy)
- **A3** EXTEND `src/lib/whatsapp/client.ts` + `src/lib/data/outreach.ts` (per-guest token → template URL-button), gated on `guests.contact_id` present; ties to `kalfa_rsvp_reminder_v1`.
- **A4** EXTEND `src/app/api/webhooks/whatsapp/route.ts` + `src/lib/data/interactions.ts`: quick-reply → resolve guest via the send-time op id → set `guests.status` IN ADDITION to existing `recordReached` billing.
- **A5-author** owner UI to manage `event_questions`.

## I. Reuse map — wire into existing code, do NOT duplicate ([[reuse-existing-no-duplication]])
- **Token gen** the DB default is the single home (`guests.ts` never sets it), now **128-bit** `extensions.gen_random_bytes(16)` hex (§A.3); regenerate mirrors it with `crypto.randomBytes(16)`. **Server client** `src/lib/supabase/admin.ts` `createAdminClient()` for the SECDEF RPC calls (anon revoked).
- **Rate limit** `src/lib/security/rate-limit.ts` + EXISTING `RSVP_READ_RATE`/`RSVP_SUBMIT_RATE`. **Activity** `src/lib/data/activity.ts`.
- **Form primitives** `src/components/forms.tsx` + `result.ts` `FormState`. **Link base** `APP_ORIGIN` (as in `agreements.ts`).
- **Revoke/renew** mirror `organization_invitations` (`newToken`/`revokeInvitation`/`resendInvitation` in `src/lib/data/orgs.ts`).
- **Validation** NEW `src/lib/validation/rsvp.ts`. **Data** NEW `src/lib/data/rsvp.ts`. **Owner visibility** EXTEND the guest detail page — no parallel page.

## J. Security (CLAUDE.md "Public RSVP Security") — binding
Opaque crypto-strong token validated server-side before any read/write; **both RPCs server-only (anon revoked)**; anon NEVER
lists/reads/updates guests; read+submit rate-limited at the server boundary; submit atomic + idempotent (in-RPC gates, single
locked transaction); active-status + deadline(Asia/Jerusalem) + revocation gates inside the SECDEF functions; generic
privacy-safe errors (NULL / reason codes mapped to one message); no PII/token in logs; `Cache-Control: no-store` +
`Referrer-Policy: no-referrer` + `robots noindex` on `/r/*`.

## K. Verification
- `npm run lint`, `npx tsc --noEmit`, `npm run build` (**`next build --webpack`** [[build-webpack-not-found-fix]]), vitest.
- Tests (one per reason code): token valid/invalid/**revoked**; draft/closed → NULL; **past-deadline at a UTC-midnight boundary**
  (Asia/Jerusalem correctness); status mapping; **count bounds incl. `expected_count IS NULL`**; required/unknown-key/options
  answer validation; **idempotent double-submit (no new row)**; answers→extras; rate-limit read+submit; anon cannot reach the RPCs.
- Manual E2E: open a real (canonical) guest token → submit → `guests.status` flips + `rsvp_responses` row (extras) + activity; owner sees it + copy/revoke/regenerate work.

## L. Build order
§A.3 token rotation [approval] + §C migration apply [approval] → data layer + Zod → route + page + form + action (+ headers) →
owner visibility + revoke/regenerate → tests. Then, after §E policy: A3 link → A4 webhook → A5-author.

## M. Open items needing a decision before the dependent step
- ~~**Apply the migration `202606290034`?**~~ ✅ **DONE + verified live** (2026-06-29, user "מאושר").
- ~~**Rotate sub-standard live tokens to 128-bit?**~~ ✅ **DONE + verified live** (2026-06-29, user "אישרתי"; 2/2 canonical).
- **Unlinked-guest WhatsApp policy** (§E) — before A3 for guests without `contact_id`.
- **Regenerate `src/lib/supabase/types.ts`** — `submit_rsvp`'s signature changed (now 7-arg `jsonb`); regenerate before building A1 so the RPC call typechecks.
- ~~**Token entropy**~~ **DECIDED** (user "סומך עלייך", 2026-06-29): DB default bumped **96→128-bit** in the migration; rotation upgrades existing sub-128-bit tokens; regenerate mirrors at 128-bit. Empirically verified.
