# KALFA — Unified Authorization Audit (read-only)

> Evidence base: 4 read-only agents — A1 (DB layer), A2 (app layer), A3 (edge
> surfaces / execution identity), B1 (official Supabase docs only) — plus a
> live anon-key exploit verification by the Lead. **No code/schema changes made.**
> Every claim below is backed by `file:line`, a live `sb-query`/`pg_*` result, or
> an official Supabase URL. Date: 2026-06-30.

> **Scope & limitations (read this before quoting a "clean" verdict).** This audit
> covered the **authorization model** (RLS policies on all 33 public tables, all 17
> SECURITY DEFINER functions + grants + Data-API exposure, the app two-tier
> gating, the worker/webhook/public-RSVP/auth edges) and **event lifecycle &
> schedule integrity**. It is **read-only and evidence-based**, but **not a proof
> of total absence of vulnerabilities.** Specifically: only the two billing
> functions were confirmed by a **live anon exploit**; the other findings are
> code/schema/doc-reasoned (e.g. "RSVP open post-event" was inferred from the RPC
> guards, not by actually submitting). **Out of scope / not exhaustively examined:**
> client-side security (XSS/CSRF beyond the noted origin checks), infrastructure &
> secret management, the full Storage RLS surface, dependency/supply-chain, and
> DoS/rate-limiting depth. The Supabase **Security Advisor was NOT run** — running
> it is a recommended independent check (P0.3). A clean finding in an examined area
> does **not** imply none exist in an unexamined one.

> ## ✅ STATUS (2026-06-30) — fixes recorded in production
>
> **P0 — RESOLVED.** Migration `202606300038` applied, recorded, and ACL-verified.
> (The two billing-RPC holes in §4 are NOT a current open exposure: live anon REST →
> 401; `service_role` retained; Security Advisor no longer lists them under 0028/0029.)
>
> **L0a — APPLIED.** Migration `20260630072729_events_date_guards_l0a` applied via
> `supabase db push --linked`, recorded in `schema_migrations`, and live schema verified.
> **DB-level enforcement applied and live-schema verified** (the UI error-handling path
> is separate and not yet covered).
>
> *Resolved by L0a:*
> - past `event_date` rejected on INSERT and on changed-`event_date` updates;
> - `rsvp_deadline` cannot exceed the Israel-calendar event day;
> - `rsvp_deadline` requires `event_date`;
> - edits unrelated to `event_date` remain allowed for existing past events.
>
> *Still open:*
> - LC‑3 date locking after a non-draft / non-cancelled campaign;
> - campaign / hold / activation / manual-send / worker guards (L1);
> - public RSVP event-date guard;
> - `try_record_billed_result` referential integrity.
>
> The §4/§5 wording below is preserved **as the audit found it** (present tense = the
> pre-fix state); see the inline ✅ markers and §6/§7 for current status.

## 0. The systemic frame (the key to the whole picture)

There are **TWO distinct DB boundaries, not one** — separated by object type
(corrected; an earlier draft over-generalized "RLS is the only boundary"):

**(a) Tables → RLS is the effective row-isolation boundary _here_.** A1 verified
`anon`/`authenticated` hold **ALL** privileges (`arwdDxtm`) on **every** `public`
table by default, and `anon` has schema `USAGE` → PostgREST is open. Because the
table grants are wide-open, **for tables** RLS carries isolation → every table
RLS gap = exposure. (Grants are *not* inert even here: `guests`/`rsvp_responses`
carry targeted anon revokes, so a grant **can** restrict a table — the point is
only that the *default-ALL* leaves RLS doing the work.)

**(b) Functions / RPCs → `EXECUTE` gates the *call*; whether the *body* bypasses
RLS depends on SECURITY INVOKER vs DEFINER.** There is no RLS policy *on* a
function — but that does **not** make RLS irrelevant to functions:
- **SECURITY INVOKER** (the PostgreSQL default): the body runs as the **caller**,
  so the caller's RLS + grants still govern every table it touches — the function
  **cannot exceed the caller's own row access**. RLS is **not** bypassed; `EXECUTE`
  only gates the call.
- **SECURITY DEFINER**: the body runs with the **owner's** SQL-role privileges
  (not the caller's). RLS is bypassed **because the owner is RLS-exempt — not as an
  inherent feature of SECDEF**: here the owner is `postgres`, verified
  `rolbypassrls = true` **and** the owner of every RLS table (none `FORCE ROW LEVEL
  SECURITY`) — two independent exemptions; a SECDEF owned by a *non-exempt* role
  would stay RLS-bound. So for these functions the data-access controls reduce to
  **(1) the `EXECUTE` grant** (who may call) **+ (2) the function's own internal
  authorization** (e.g. an `auth.uid()` check) — RLS does not protect the tables
  the body touches. **Note:** `auth.uid()` reads the per-request JWT claim
  (`request.jwt.claims ->> 'sub'`), **not** the SQL role, so inside a SECDEF
  function it still resolves to the **caller** — which is exactly what lets the
  body authorize on the caller's identity (e.g. `accept_invitation`).

So a SECDEF function granted to anon with **no internal check** is an
unauthenticated API endpoint (the two billing functions, §4); a SECDEF with an
internal `auth.uid()` check (e.g. `accept_invitation`) is governed by that check
even if anon may call it. **Live: 16 of the 17 public functions are SECURITY
DEFINER** (so the bypass case dominates here); only `set_updated_at` (a trigger
fn) is INVOKER. This is the boundary the audit turns on — **live-proven both
ways**: `submit_rsvp` safe (anon `EXECUTE` revoked → **401**); the billing
functions open (anon `EXECUTE` granted + no internal check → **200**). Accordingly
the P0 fix is a **`REVOKE EXECUTE`** — a grant operation (grants ARE a boundary).

**Corollary:** every **table** RLS gap = exposure; a **SECURITY DEFINER**
function's data access = its `EXECUTE` grant **+** its internal authorization (RLS
bypassed) ⇒ SECDEF + anon-`EXECUTE` + no internal check = an open endpoint; a
**SECURITY INVOKER** function stays RLS-bound to the caller.

Three layers exist and are **complementary, not interchangeable** (B1):
**Grants** (can the role touch the object — incl. `EXECUTE` for functions) →
**RLS** (which rows, tables only) → **app-server authorization** (verbs/ownership
when service_role bypasses RLS). The app correctly treats RLS as defense-in-depth,
not the only line (A2). This matches CLAUDE.md.

---

## 1. What **Supabase** should enforce (official model B1 vs reality A1/A3)

| Mechanism | Official intent (B1 + URL) | Reality | Verdict |
|---|---|---|---|
| **Row/tenant isolation** | RLS on every exposed table, `TO authenticated`, gated by `auth.uid()` | RLS on all 33 tables; owner isolation via `owns_event`/`owner_id=auth.uid()` | ✅ sound |
| **Identity/role claims** | from JWT; `app_metadata` only, **never** `user_metadata` ("can create security issues") | `handle_new_user` copies **only** full_name/phone (display) — no privilege path via signup metadata; admin via `user_roles`+`has_role` | ✅ sound |
| **Function access** | by `EXECUTE` grants; sensitive SECDEF → revoke anon/authenticated, non-exposed schema, `set search_path` | `search_path` set on all SECDEF (good); **2 SECDEF left anon-exposed** | ⚠️ see §4 |

---

## 2. What the **application** should enforce (and does — A2)

- **Verbs + ownership whenever service_role bypasses RLS.** A2 verified a
  disciplined **two-tier** model: **every** `createAdminClient` use has a
  preceding gate — inside the fn (`requireOwnedEvent`/`requireAdmin`), or
  delegated to an authenticated caller (CSRF+`requireUser`+`requireOwnedEvent`
  route / orchestrator / signed webhook / request-free worker). **No ungated
  user-entry RLS-bypass found** (critical callers — doc storage, billing —
  verified, not just imports).
- **Auth = `auth.getUser()`** (token validation), not `getSession`. Active-org
  always re-verified against `organization_members` (browser cookie not trusted).
- **One pure-RLS dependency:** `campaigns.getCampaign` (events.ts) is an open
  cookie read with no app owner-filter → gated **only** by RLS
  `camp_owner_select=owns_event`. Policy verified live. Safe, but it is the
  single place where "trust RLS" carries real weight.

---

## 3. What must run **only through service_role** (execution identity — A3)

Four distinct execution identities: **service_role** (RLS-bypass, `server-only`,
no session), **direct postgres login** (worker→pgboss schema), **user-session**
(cookie, RLS-bound), **anon** (RLS-bound).

- **Worker (pg-boss):** no session → must bypass RLS. Scoped by the FROZEN
  `campaign_authorized_contacts` set + status/window/consent gates. ✅ correct.
- **Webhook intake/processing:** server-to-server, **HMAC `X-Hub-Signature-256`**
  verified, fail-closed → service_role. ✅ (caveat: the phone-only fallback
  attribution can mis-route a *typed* reply across events that share a phone —
  minor; the `context.id` path is immune; fail-closed to no-billing.)
- **Public RSVP:** anon entry, but DB access **only** via `get_rsvp_by_token` /
  `submit_rsvp` (SECDEF, **service_role-only, anon revoked** — verified); 128-bit
  tokens; **no anon policy** on guests/rsvp_responses. ✅ locked + hardened.

These are correctly service_role-only; this layer is sound.

---

## 4. Manual mechanisms — unnecessary / duplicated / **DANGEROUS**

### 🔴 DANGEROUS → ✅ FIXED (migration 0038) (the only **confirmed, live-proven** security holes found **within this audit's scope** — both proven by the Lead, **both now remediated & advisor-verified**)
- **`try_record_billed_result`** — SECDEF, **WRITES** `billed_results` (real
  per-reached charge), `EXECUTE` granted to **anon+authenticated**, **no
  caller-identity check** (only business guards: active/paused, window,
  authorized-set membership, cap). Triple-confirmed (A1, A3, Lead). Live anon REST
  call **reached the body** (returned `no_campaign` with fake IDs). With valid
  event+campaign+contact UUIDs (contact in the set, window open) → **anon injects
  a billing record**. Profile = identical to its locked siblings; this is a
  **missed lockdown, not intent**. **✅ Fixed by migration 0038** — anon/authenticated/PUBLIC `EXECUTE` revoked → anon REST now 401.
- **`campaign_billing_summary`** — SECDEF, anon `EXECUTE`, no auth check → leaks
  `reached_count/accrued/ceiling/max_contacts` for any campaign UUID. Live anon
  call **returned the exact billing figures** (matched the postgres value). **✅ Fixed by migration 0038** — anon/authenticated/PUBLIC `EXECUTE` revoked → anon REST now 401.

### Duplicated — intentional defense-in-depth (KEEP)
events/guests = app gate + RLS + owner-filter (triple); admin = layout +
per-fn `requireAdmin` + RLS; org-members = `requirePermission` + RLS.

### Unnecessary / dead (cleanup, not security)
`requireEventAccess`/`can_access_event` (0 call-sites), `org_role_rank` (0
callers), `signedLegalDocUrl` (0 callers).

### Fragile idiom (latent, not exploitable today)
~20 RLS policies on role **`{public}`** instead of **`{authenticated}`**. Not
exploitable now (quals depend on `auth.uid()`→null→0 rows for anon), but B1's
official guidance is explicit: use `TO authenticated`; `{public}` runs for every
request incl. anon and is one careless future policy (qual=true / uid-independent)
away from exposure.

---

## 5. Gap classification

| Gap | Class | Severity |
|---|---|---|
| `try_record_billed_result` anon-exposed (write) — ✅ **FIXED (0038)** | **authorization + execution-identity** | 🔴 high (live-proven) → **resolved** |
| `campaign_billing_summary` anon-exposed (read) — ✅ **FIXED (0038)** | **authorization + execution-identity** | ⚠️ medium (live-proven) → **resolved** |
| **Event lifecycle & schedule integrity (LC‑1…LC‑5, §7)** — past-date events + RSVP/activate/approve/hold/send/bill with no event-date guard | **business lifecycle / commercial-operational integrity** | **medium** (live: RSVP open 8 days post-event; ungated send/hold/bill paths). Remediation = **L0–L2**, not Zod alone |
| `callback_requests`/`contact_messages` anon-INSERT, no DB rate-limit | **business lifecycle / abuse** | low |
| org-access (`can_access_event`) built but **not wired to events RLS** (owner-only) → org member sees page, gets empty data | **implementation gap, fail-closed** (org gets LESS, not a hole) | low (product decision) |
| ~20 `{public}` policies | **idiom hardening** (latent) | low |

The rest of the execution-identity model and the app two-tier discipline are
**correct**.

---

## 6. Phased, minimal, evidence-based remediation (no broad refactor)

**P0 — security (forward migration, approval-gated; the ONLY true holes):**
1. `revoke execute on function public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text) from anon, authenticated, public;` (ensure `service_role` retains it). Mirrors the lockdown already on `submit_rsvp`/`get_rsvp_by_token`/`claim_webhook_events`.
2. Same for `public.campaign_billing_summary(uuid)`.
3. **Prevention (corrected — see control of this item):** the safe, idiomatic
   mechanism is the **per-function opt-out** — every sensitive SECDEF migration
   ends with `REVOKE EXECUTE ON FUNCTION … FROM anon, authenticated, public`
   (the pattern `submit_rsvp`/`get_rsvp_by_token`/`claim_webhook_events` already
   follow) — plus the **Supabase Security Advisor as a release gate** (its
   `0026-0029` lints flag SECDEF/tables exposed via the API).
   **Do NOT** use the earlier-draft `ALTER DEFAULT PRIVILEGES IN SCHEMA public
   REVOKE EXECUTE … FROM anon, authenticated`. **It is valid SQL, but incomplete
   and unsafe as a blanket remediation in this project** — verified against the PG
   docs + live `pg_default_acl`:
   (i) a per-schema (`IN SCHEMA`) revoke **cannot remove a globally-granted
   default** — EXECUTE-to-`PUBLIC` must be revoked **globally** (`ALTER DEFAULT
   PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, no
   `IN SCHEMA`);
   (ii) defaults are scoped to the **creating role** — it needs `FOR ROLE postgres`
   (live: owner of all 17 public functions) and would still miss functions created
   by `supabase_admin`/dashboard, which carry their **own** default-ACL granting
   anon/authenticated (confirmed in `pg_default_acl`);
   (iii) Supabase **deliberately** grants anon/authenticated EXECUTE on new public
   functions (the Data-API RPC model), so a blanket flip risks breaking
   legitimately-callable RPCs. The per-function opt-out is the right granularity.

**P1 — hardening (low-risk, app-level):**
4. **Event lifecycle & schedule integrity** → remediate via **§7 L0–L2** (DB triggers/CHECK + the `assertEventNotPast` app guard + the RPC guards/integrity), **not Zod alone** — Zod `.refine` is UX only, bypassable via PostgREST (§7). (This supersedes the earlier "Zod validation" framing.)
5. Rate-limit/validate the anon `callback_requests`/`contact_messages` INSERT path (DB or app).

**P2 — consistency (no behavior change):**
6. **Review the ~20 `{public}` policies policy-by-policy and migrate only those whose intended callers are authenticated users** — NOT a blanket find-replace (a policy that legitimately serves `anon` must keep it). *Verified live for this set:* every one is gated by `auth.uid()` / `owns_event` / `has_role` / `is_org_member` / `has_org_permission` (or `auth.uid() IS NOT NULL`), so anon already gets 0 rows → all are authenticated-intended and safe to move to `{authenticated}` via `ALTER POLICY … TO authenticated`. The legitimately-anon policies (`callback_requests`/`contact_messages` INSERT, `packages` SELECT) are correctly `{anon,authenticated}` and are **not** in this set.
7. Decide org-vs-events: wire org access into events/child RLS, **or** remove the dead `can_access_event`/`requireEventAccess` org branch.

**P3 — cleanup:** remove dead code (`org_role_rank`, `signedLegalDocUrl`, dead org-access path if not wired).

**Defer:** nothing in the examined surface requires a broad refactor. **Within
the scope audited**, the authorization model is sound except for the two billing
functions (P0.1–2) — the only **confirmed, live-proven** security holes this audit
found. A clean finding in an examined area is **not** proof that none exist
elsewhere (see *Scope & limitations*). Forward migration only — never edit/reverse
the already-applied live migrations.

### Security Advisor — official run (2026-06-30, CLI 2.107, `supabase db advisors --linked --type security`)

**Status of P0:** migration `202606300038_lock_billing_rpcs.sql` is **applied & live-verified**
(anon REST → 401/`42501`; `has_function_privilege`: service_role=true, anon=false).
The advisor **independently confirms it**: `try_record_billed_result` and
`campaign_billing_summary` no longer appear under lints `0028`/`0029`.

**New advisor findings (extend the audit — exactly what the Scope caveat predicted).
Classified by live RLS-reference (`supabase db query`) so we do NOT blanket-revoke:**

- **`0028`/`0029` anon/authenticated-executable SECDEF — 11 functions:**
  - 🔒 **MUST remain executable** (referenced inside RLS policy quals — revoking
    `EXECUTE` from `authenticated` would break RLS evaluation): `owns_event`,
    `has_role`, `has_org_permission`, `is_org_member`. Lock only via *move to a
    non-exposed schema + update every RLS reference*, or accept the documented
    helper pattern. **NOT a blanket revoke.**
  - 🗑️ **Dead (0 callers) → revoke + remove:** `can_access_event`, `org_role_rank`.
  - ⚙️ **Trigger/util, never meant as an RPC → revoke anon+authenticated:**
    `handle_new_user`, `rls_auto_enable`.
  - 📞 **App RPCs → revoke anon; keep `authenticated` or lock to `service_role`
    per invocation site:** `accept_invitation`, `claim_first_admin`, `create_organization`.
- **`0011` function_search_path_mutable:** `public.set_updated_at` (add
  `SET search_path = ''`); 5 × `pgboss.*` (vendor-managed by pg-boss — leave/track).
- **`0024` rls_policy_always_true (INSERT):** `callback_requests` / `contact_messages`
  (the intentional public contact forms — §5; fix = rate-limit + a bounded
  `WITH CHECK`, NOT removing public insert).
- **`auth_leaked_password_protection` disabled** (Auth config; out of the original
  audit scope) — enable HaveIBeenPwned check in the dashboard.

These are **defense-in-depth hardening** (the official lints), distinct from the
two **confirmed exploitable** holes (P0). None is live-proven exploitable; the
SECDEF helpers in bucket 🔒 are the documented Supabase RLS pattern.

---

## 7. Business lifecycle & schedule integrity (scope expansion)

> Source: A2 (app), A1 (DB), A3 (worker/RSVP) — read-only, evidence-verified.
> **Cross-cutting verdict: there is NO central `event_date < now` guard anywhere.**
> The DB enforces ~nothing here (1 CHECK in all of `public` = the app_settings
> singleton; all 12 triggers are `set_updated_at`; **no pg_cron** to auto-close
> events). All schedule/lifecycle integrity rests on app code — and for `events`
> it is **directly bypassable**: `events_owner_all` is an ALL policy + GRANTs=ALL,
> so the owner can `PATCH event_date`/`rsvp_deadline` straight through PostgREST,
> skipping Zod entirely. `campaigns` is owner-SELECT-only → campaign paths are
> app-writable only (not REST-bypassable), **except** the anon-exposed billing RPC.

**Bypassability split (decides where each fix MUST live):**
events date rules → **DB-level CHECK/trigger** (Zod alone is bypassable);
campaign mutate/send rules → **one shared app-level guard** (+ the
`try_record_billed_result` lockdown); RSVP rules → **inside the two service-role RPCs**.

**Definition of "past event" — ONE rule, used everywhere.** The UI uses
`<input type="date">` (no event *time*), so "past" is a **calendar day in
Israel**: an event is past **only after the end of its day**, i.e.
`(now() AT TIME ZONE 'Asia/Jerusalem')::date > (event_date AT TIME ZONE
'Asia/Jerusalem')::date`. An event **today** is still valid. This single
definition MUST be used identically by LC‑1 (create/edit), LC‑4 (RSVP),
`assertEventNotPast`, the worker (`stepGate`), manual send, and billing — no
mix of "calendar-day" and raw `event_date < now()`.

| # | Entry point(s) | Missing rule | Impact | file/function | Bypassable? | Minimal fix | Regression test |
|---|---|---|---|---|---|---|---|
| **LC‑1** | event create/edit (Action **and** REST PATCH) | event_date not required ≥ today (Israel); nullable | past/invalid date poisons every §10 schedule derived from it | `validation/schemas.ts:56,73`; `events.ts:151,241` | **YES, direct** (events ALL → REST bypasses Zod) | **TWO triggers** (an INSERT trigger has **no `OLD`** — PG CREATE TRIGGER): (1) `BEFORE INSERT` validates `event_date` when present; (2) `BEFORE UPDATE OF event_date` (fires only when event_date is in the `SET` list) with an inner `OLD.event_date IS DISTINCT FROM NEW.event_date` guard (so re-submitting the same date / editing a past event's venue is NOT blocked — note `SET x=x` still fires `UPDATE OF x`, hence the inner guard). Both **`RAISE EXCEPTION`** (NOT `return NULL`, which silently skips) when the date is before **today-in-Israel** (the shared calendar-day definition above). **NOT a CHECK** — `now()` is non-immutable (breaks dump/restore + spuriously fails later edits). + Zod `.refine` (UX). | owner PATCH event_date=yesterday → 4xx (was 200); editing venue of a *past* event still succeeds; `SET event_date=<same>` → passes |
| **LC‑2** | event create/edit (Action + REST) | no cross-field `rsvp_deadline ≤ event_date`; **+ explicit NULL policy** (PG: CHECK passes on TRUE *or NULL* → a naive compare silently allows a deadline with no event_date) | RSVP "open" after the event; an incoherent deadline-without-a-date | same | **YES, direct** | **DB CHECK** (static/same-row/immutable — valid; **NULL policy = "deadline requires event_date"**): `rsvp_deadline IS NULL OR (event_date IS NOT NULL AND rsvp_deadline <= (event_date AT TIME ZONE 'Asia/Jerusalem')::date)`. Optional companion: `status='draft' OR event_date IS NOT NULL` (a non-draft event must have a date). | deadline=event+1d → reject; **deadline set + event_date NULL → reject**; deadline NULL → pass |
| **LC‑3** | event edit (Action + REST) | **(a)** dates mutable while a non-cancelled campaign exists (verified, REST-bypassable); **(b)** close_at desync — frozen at create, never re-synced (**code-level risk, NOT live-demonstrated** — see control note) | (a) locked terms detach from the new date; (b) worker+billing read stale close_at while schedule reads live event_date | `events.ts:241`; `campaigns.ts:160` (sole close_at writer) | **(a) YES, direct** (events ALL) | **(a) BEFORE-UPDATE trigger** on events — RAISE if `event_date`/`rsvp_deadline` change while **any campaign exists that is NOT `draft` and NOT `cancelled`** (`pending_approval` and above LOCK the dates). Future date changes go through a **dedicated `reschedule` path**, never the event-edit form. **(b) DEFERRED** — the close_at re-design is a documented design question (L3), **no schema change in this remediation** (the desync was not a proven live defect — see control note). | approved campaign + PATCH event_date → RAISE; draft/no-campaign → allowed |
| **LC‑4** | public RSVP page+action **and** WhatsApp button → `submit_rsvp`/`get_rsvp_by_token` | gates only `status='active'` + rsvp_deadline (optional/nullable); **no event_date compare** → deadline NULL + active ⇒ RSVP open indefinitely post-event | guest changes status/counts after the event happened | `rsvp_harden.sql:149-158,214-222` | guard-gap in **locked** RPCs (anon revoked); shared by web + WhatsApp | event_date gate inside both RPCs (one source), using the shared **calendar-day-in-Israel** definition | **LIVE** event `03733daf` (active, event_date 22/6 passed, deadline NULL) → submit currently allowed; expect 'closed' |
| **LC‑5** | manual send · worker · activate · approve/sign · J5 hold · inbound billing | **rule 2** — no `event_date<now` guard on `sendCampaignWhatsApp` (NO time gate at all), `stepGate` (only **stale close_at snapshot**), `activateCampaign`, `approveCampaign`/`recordSignedAgreement`, `recordCampaignHold`, `try_record_billed_result` (no event_date; window skipped when close_at NULL) | activate/charge/send for a past event — real money + post-event delivery; `try_record_billed_result` is **anon-exposed** → unauthenticated past-event billing | `outreach.ts:70`; `outreach-engine.ts:141`; `campaigns.ts:668,239`; `agreements.ts:56`; `authorize/route.ts`; `try_record_billed_result` | manual-send = cleanest bypass; worker partial (stale snapshot); campaigns NOT REST-bypassable **except** the anon RPC | **one shared `assertEventNotPast(eventId)`** (calendar-day-in-Israel) at every campaign mutate/send path + stepGate live-event_date stop + RPC service_role lockdown (§4) + an **event_date guard inside `try_record_billed_result`** (this makes the `close_at`-NULL window-skip moot — **no `NOT NULL` schema change needed**) | active campaign + past event → manual send sent=0; activate/hold/approve reject; stepGate stopped |

**Live evidence (read-only, no mutation performed):** event `03733daf` — RSVP
open 8 days after the event (VALID, verified: active + event_date 22/6 passed +
deadline NULL). ~~campaign `4c736788` close_at divergence~~ — **RETRACTED after
control of LC‑3**: see note.

> **Control note (LC‑3, evidence corrected).** The `4c736788` "desync proof" does
> NOT hold: its `close_at`=30/6 ≠ `event_date`=22/7, yet the event's `updated_at`
> (28/6) precedes the campaign's `created_at` (29/6) — so event_date was **not**
> edited after creation, and the current code (`campaigns.ts:160 close_at=event_date`,
> the **sole** close_at writer; `start_at:null`) would have produced
> close_at=22/7, start_at=null. The live rows instead show **6 campaigns for one
> event** (violating one-per-event), close_at mostly =30/6/created_at, start_at
> non-null → **test/legacy data from older code/direct SQL, not a production
> manifestation.** ⇒ The **immutability gap (a) is real and REST-bypassable**; the
> **close_at desync (b) is a genuine code-level design smell** (snapshot vs live)
> **but is not demonstrated by live data.** Recommended fix shifts to **deriving
> close_at from live event_date** (removes the snapshot entirely, and stops
> emitting divergent rows going forward).

**Class split (per §5):**
- **Authorization:** LC‑5's anon path to `try_record_billed_result` (= the authz §4 hole).
- **Business lifecycle:** LC‑1, LC‑2, LC‑4, and the date-guard parts of LC‑3/LC‑5.
- **Execution-identity / data-integrity:** LC‑3 close_at desync (frozen snapshot vs live event_date); the worker's stale-snapshot gating.

**Phased lifecycle remediation (minimal, evidence-based):**
- **L0a — ✅ APPLIED** (`20260630072729_events_date_guards_l0a`, via `supabase db push --linked`, recorded in `schema_migrations`, live-schema verified): the **CHECK** for LC‑2 (static, same-row, immutable) + **TWO triggers** for LC‑1 (`BEFORE INSERT` + `BEFORE UPDATE OF event_date` — an INSERT trigger has no `OLD`; `now()` is non-immutable so a CHECK is wrong). All `RAISE EXCEPTION`.
- **L0b — DEFERRED** (after the product reschedule decision): the LC‑2 **companion CHECK** (`status='draft' OR event_date IS NOT NULL`) + a **`BEFORE UPDATE` trigger** for LC‑3 (cross-table — CHECK may not reference other tables, per PG docs). LC‑3 must wait for the app reschedule path / error handling — otherwise it raises on the current event-edit form.
- **L1 — app shared guard:** one `assertEventNotPast(eventId)` (the shared **calendar-day-in-Israel** definition) called at activate / approve / sign / J5 hold / manual send; add the live-event_date stop in `stepGate`.
- **L2 — RPC guards + billing integrity:** (i) event_date gate inside `submit_rsvp` + `get_rsvp_by_token` (calendar-day); (ii) lock `try_record_billed_result` to service_role + add its event_date guard; (iii) **integrity hardening of `try_record_billed_result`** — derive `event_id` from the **locked campaign row** (`campaign.event_id`) instead of the caller-supplied `p_event`; **reject `event_mismatch`** when `p_event ≠ campaign.event_id`; verify `p_contact` belongs to that campaign's event; insert the **campaign-derived** event_id. (Today it trusts `p_event` and inserts it verbatim — verified live; with `UNIQUE(event_id, contact_id)` a wrong `p_event` writes a charge under the wrong event.)
- **L3 — DEFERRED design decision (no schema change in this remediation):** define whether `close_at` is an **independent commercial deadline** or a **derived event-schedule boundary**. The close_at↔event_date divergence was NOT a proven live defect (see LC‑3 control note), so `NOT NULL` / derive-live changes stay a documented design question, not a mandatory migration.

**Note (Zod is not enough):** because `events` is owner-writable via PostgREST,
LC‑1/LC‑2/LC‑3 fixes **must** include the DB CHECK/trigger; app `.refine` is UX
only, not the enforcement boundary.

### Control of the L0 DB-fixes (doc-grounded — these HOLD UP)

- **LC‑2 CHECK — IMMUTABLE, validated (live volatility check).** `timezone(text,
  timestamptz)` (= `event_date AT TIME ZONE 'Asia/Jerusalem'`) is **IMMUTABLE**
  (constant zone; an absolute instant → a fixed wall-clock is deterministic), and
  `date(timestamp without time zone)` is IMMUTABLE → the whole
  `(event_date AT TIME ZONE 'Asia/Jerusalem')::date` is IMMUTABLE ⇒ valid in a
  CHECK. **The `AT TIME ZONE` is required twice over:** a naive `event_date::date`
  is `date(timestamptz)` = **STABLE** (session-TZ-dependent — invalid in CHECK),
  and it would also use the wrong date boundary (live: `22:00Z` = 22/6 in UTC but
  **23/6 in Israel**). So the explicit zone gives both correctness AND immutability.
- **LC‑1 triggers — correct + full-restore-safe.** `now()` is STABLE and changes
  over time → a CHECK using it would (a) fail any later UPDATE to a now-past event
  (CHECK re-validates the whole row) and (b) break `pg_dump`/restore (a validated
  CHECK is **pre-data**, re-checked on the COPY). **Two** triggers avoid both — and,
  crucially, an **INSERT trigger has no `OLD`** (PG CREATE TRIGGER): the
  **`BEFORE UPDATE OF event_date`** trigger uses
  `NEW.event_date IS DISTINCT FROM OLD.event_date` (so editing a past event's
  venue/name succeeds), while the **`BEFORE INSERT`** trigger validates
  `event_date` on creation (there is no OLD to compare). Triggers are **post-data**
  in pg_dump (created AFTER the data COPY) → they do **not** fire during a full
  restore. (A *data-only* restore into an existing schema would fire them →
  `pg_restore --disable-triggers`, superuser-only — per the pg_restore docs.)
  Triggers carry no immutability requirement, so `now()` inside one is fine.
- **`IS DISTINCT FROM` — NULL-safe.** `NULL IS DISTINCT FROM x` and
  `x IS DISTINCT FROM NULL` → TRUE; `NULL IS DISTINCT FROM NULL` → FALSE. So the
  guard correctly catches **NULLing** event_date under a campaign (LC‑3) and any
  real change, while a no-op write is ignored. (Plain `<>`/`=` would miss the
  NULL transitions.)
- **LC‑3 trigger — cross-table allowed.** A trigger MAY query `campaigns` (a CHECK
  may not, per ddl-constraints). Minor: the `EXISTS(locked campaign)` test is a
  TOCTOU read — acceptable for the low-concurrency event-edit path; tighten with
  row locking only if a concurrent create/cancel race is a concern.
- **LC‑2 companion CHECK** (`status='draft' OR event_date IS NOT NULL`): enum
  compare + `IS NOT NULL` are IMMUTABLE → valid CHECK.

**Net:** the L0 split is sound — **LC‑2 + companion as CHECK** (immutable),
**LC‑1 + LC‑3 as triggers** (time-relative / cross-table) — each for the
documented reason; safe to write the L0 migration on this basis.
