# B2 — Provider Webhooks → billed_results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a verified inbound WhatsApp human response into exactly ONE billable `billed_result` per contact per event (the §12 source-of-truth), via a signature-verified webhook and a race-safe `try_record_billed_result` RPC that enforces the cap + window + dedup in a single transaction — with NO billing happening until webhooks are enabled and the app secret is configured.

**Architecture:** A `POST /api/webhooks/whatsapp` route verifies Meta's `x-hub-signature-256` (via `whatsapp-api-js`'s `WhatsAppAPI.post(data, raw_body, signature)`), parses inbound `messages[]`/`statuses[]`, dedupes each provider event into `contact_interactions` (UNIQUE(channel, provider_id)), and for a billable HUMAN message resolves the (event, campaign, contact) from the prior OUTBOUND interaction and calls `try_record_billed_result(...)`. That SECURITY DEFINER RPC locks the campaign row, re-checks active+window+ceiling+not-removed+no-prior-result, and inserts one `billed_results` row with the locked price — the §13 anti-double-charge guarantee at the DB layer. `GET` answers Meta's `hub.verify_token` challenge.

**Tech Stack:** Next.js 16 Route Handlers, `whatsapp-api-js@6.2.1` (webhook verify + parse), Supabase service-role + a SECURITY DEFINER plpgsql RPC, Zod 4, Vitest. No new npm packages.

## Global Constraints

- **Config-gated / fail-closed:** the webhook does nothing unless `getOutreachEnabled()` AND `getWhatsAppConfig()` returns an `appSecret` + `verifyToken`. An unsigned/forged POST MUST NOT create any row (§18.10).
- **Billing truth at the DB, not the app:** the cap (`COUNT(billed_results) < max_contacts`), window (`reached_at` between start_at/close_at), and one-per-(event,contact) dedup live INSIDE `try_record_billed_result` (locked txn), never in JS. PostgREST aggregates are off — the RPC is the only writer.
- **What is billable (§4.1, §11):** only a verified inbound HUMAN message (`messages[]` with type text/button/interactive) → reached. `statuses[]` of delivered/read are NOT billable (op_status update only). System/auto replies, wrong numbers, removal requests are NOT billable.
- **Idempotency / replay:** every provider event is deduped on `contact_interactions` UNIQUE(channel, provider_id) before any billing; Meta retries must be safe.
- **PII / secrets:** never log the app secret, raw payload, phone, or message body. Verify the signature before trusting anything.
- **Migrations hit the LIVE Supabase** ([[supabase-live-schema]]): write the `.sql`, introspect first, apply only with explicit approval (one-off Management-API write), don't regenerate types from-scratch (RPC is called via `admin.rpc(...)`).
- **Build discipline:** one `npm run build` + immediate `pm2 restart`; users hard-refresh after a deploy.

## Existing schema/code this builds on (verified live)

- `billed_results` (EXISTS): `{ id, event_id, campaign_id, contact_id, channel(enum), attempt_id(text), reached_at(tz), locked_price(numeric), evidence_source(text), provider_ref(text), control_status(text), manual_adjustment(jsonb), created_at }`, UNIQUE(event_id, contact_id).
- `contact_interactions` (EXISTS): `{ event_id, campaign_id, contact_id, channel(enum), direction(text), kind(text), provider_id(text), billable(bool), payload_meta(jsonb), created_at }`, UNIQUE(channel, provider_id). B3 already writes OUTBOUND rows here; B2 writes INBOUND rows and reads the prior outbound to resolve a contact.
- `contact_op_status` enum: reached states = `whatsapp_responded` (inbound WA msg) and `human_interaction_call`; non-billable progress = `whatsapp_delivered`/`whatsapp_read`; plus `reached_billed`, `wrong_number`, `removal_requested`, `not_reached`.
- `campaigns`: `status`, `price_per_reached`, `max_contacts`, `max_charge_ceiling`, `start_at`, `close_at`, `event_id`.
- `getOutreachEnabled` / `getWhatsAppConfig` (from B3 `src/lib/data/outreach-config.ts`) — the gate + the `appSecret`/`verifyToken` source.
- `whatsapp-api-js`: `new WhatsAppAPI({ token, appSecret, webhookVerifyToken, secure:true })`; `post(data, raw_body, signature)` verifies the HMAC and routes to `on.message`/`on.status` emitters; `get(params)` answers the verify challenge.
- `api/campaigns/[id]/authorize/route.ts` — the gated Route Handler + APP_ORIGIN pattern.

---

## File Structure

- Create `supabase/migrations/<ts>_billed_result_rpc.sql` — `try_record_billed_result(...)` + `campaign_billing_summary(...)` SECURITY DEFINER fns.
- Create `src/lib/data/interactions.ts` — `insertInteraction` (inbound dedup), `resolveInboundContact` (phone+event → contact via prior outbound), `setContactOpStatus`.
- Create `src/lib/data/billing.ts` — `recordReached(...)` (calls the RPC), `getCampaignBillingSummary(...)`.
- Create `src/lib/whatsapp/inbound.ts` — pure classifier: given a parsed webhook value, return the billable human-message events vs status-only events (unit-testable, no I/O).
- Create `src/app/api/webhooks/whatsapp/route.ts` — GET challenge + POST (verify → dedupe → record).
- Create tests alongside each.

---

## Task 1: Migration — `try_record_billed_result` + `campaign_billing_summary` (apply only with approval)

**Files:** Create `supabase/migrations/<ts>_billed_result_rpc.sql`

- [ ] **Step 1: Introspect** — confirm neither function exists: `node scripts/sb-query.mjs "select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('try_record_billed_result','campaign_billing_summary')"`.
- [ ] **Step 2: Write the migration** (the §7/§13/§18.12 invariants in ONE locked txn):

```sql
create or replace function public.try_record_billed_result(
  p_event uuid, p_campaign uuid, p_contact uuid,
  p_channel public.campaign_channel, p_attempt text,
  p_evidence text, p_provider_ref text
) returns text
language plpgsql security definer set search_path = public as $$
declare v public.campaigns; v_count int;
begin
  select * into v from public.campaigns where id = p_campaign for update;   -- lock the campaign
  if not found then return 'no_campaign'; end if;
  if v.status <> 'active' then return 'not_active'; end if;
  if v.close_at is not null and now() > v.close_at then return 'closed_window'; end if;
  if v.start_at is not null and now() < v.start_at then return 'before_window'; end if;
  if exists (select 1 from public.contacts c
             where c.id = p_contact and c.event_id = p_event and c.removal_requested) then
    return 'removal_requested';
  end if;
  select count(*) into v_count from public.billed_results where campaign_id = p_campaign;
  if v_count >= v.max_contacts then return 'ceiling_reached'; end if;     -- §7 cap
  insert into public.billed_results
    (event_id, campaign_id, contact_id, channel, attempt_id, reached_at,
     locked_price, evidence_source, provider_ref, control_status)
  values (p_event, p_campaign, p_contact, p_channel, p_attempt, now(),
          v.price_per_reached, p_evidence, p_provider_ref, 'ok')
  on conflict (event_id, contact_id) do nothing;                          -- §13 one per contact
  if not found then return 'already_billed'; end if;
  return 'billed';
end $$;

create or replace function public.campaign_billing_summary(p_campaign uuid)
returns table(reached_count int, accrued numeric, ceiling numeric, max_contacts int)
language sql security definer set search_path = public as $$
  select count(b.id)::int, coalesce(sum(b.locked_price),0), c.max_charge_ceiling, c.max_contacts
  from public.campaigns c left join public.billed_results b on b.campaign_id = c.id
  where c.id = p_campaign group by c.max_charge_ceiling, c.max_contacts;
$$;
```

- [ ] **Step 3: DO NOT push.** Surface the SQL; explicit approval to apply (one-off Management-API write). RPCs are called via `admin.rpc(...)` so no type regen is required.
- [ ] **Step 4: Commit** the `.sql`: `chore(db): try_record_billed_result + campaign_billing_summary RPCs (pending apply)`.

---

## Task 2: Inbound classifier (pure)

**Files:** Create `src/lib/whatsapp/inbound.ts`; Test `src/lib/whatsapp/inbound.test.ts`

**Interfaces:**
- Produces: `classifyInbound(value: WhatsAppWebhookValue): { billableMessages: Array<{ providerId: string; from: string }>; statuses: Array<{ providerId: string; status: string }> }` — pure, no I/O. A `messages[]` entry with type in (text/button/interactive/reaction) and a real `from` is a billable human message; `messages[]` of type system/unsupported and all `statuses[]` are NOT billable.

- [ ] **Step 1: Failing tests** — (a) an inbound text message → one billableMessage with providerId+from; (b) a `statuses[]` delivered → zero billableMessages, one status; (c) a `messages[]` type `system` → not billable; (d) empty value → empty arrays.
- [ ] **Step 2-4:** Run FAIL → implement the pure classifier (parse `value.messages` / `value.statuses` from the Meta webhook shape) → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): pure inbound-webhook classifier (billable human msg vs status)`.

---

## Task 3: Interactions data layer

**Files:** Create `src/lib/data/interactions.ts`; Test alongside.

**Interfaces:**
- `insertInteraction(row): Promise<boolean>` — insert into `contact_interactions` with `on conflict (channel, provider_id) do nothing`; returns true if THIS call inserted (dedup-stop for retries).
- `resolveInboundContact(channel, fromPhone, eventHint?): Promise<{ eventId; campaignId; contactId } | null>` — find the (event, campaign, contact) for an inbound message by joining the most recent PRIOR OUTBOUND interaction for that contact's normalized phone (contacts is unique on event_id+phone, so a global phone is ambiguous — resolve via the outbound interaction that targeted it).
- `setContactOpStatus(contactId, status): Promise<void>`.

- [ ] **Step 1-4 (TDD per fn):** assert the conflict-ignoring insert returns true only when a row is returned; `resolveInboundContact` selects the latest outbound interaction for the phone and maps event/campaign/contact; `setContactOpStatus` updates op_status. (mock admin via createMockSupabase.)
- [ ] **Step 5: Commit** `feat(billing): inbound interaction dedupe + contact resolution + op_status`.

---

## Task 4: Billing data layer (calls the RPC)

**Files:** Create `src/lib/data/billing.ts`; Test alongside.

**Interfaces:**
- `recordReached(args: { eventId; campaignId; contactId; channel; attemptId; evidence; providerRef }): Promise<string>` — `admin.rpc('try_record_billed_result', {...})`, returns the RPC outcome string ('billed' | 'already_billed' | 'ceiling_reached' | 'not_active' | 'closed_window' | 'before_window' | 'removal_requested' | 'no_campaign'). On 'billed', also `setContactOpStatus(contactId, 'reached_billed')`.
- `getCampaignBillingSummary(campaignId): Promise<{ reachedCount; accrued; ceiling; maxContacts } | null>` — `admin.rpc('campaign_billing_summary', ...)`.

- [ ] **Step 1: Failing tests** — mock `admin.rpc` (the mock client's `rpc` is a spy): `recordReached` calls rpc with the exact arg names and returns its `data`; on 'billed' it sets op_status='reached_billed', on any other outcome it does NOT. (RPC not in types → call is `admin.rpc('try_record_billed_result' as never, args)` cast, only reached behind the gated webhook.)
- [ ] **Step 2-4:** Run FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(billing): recordReached via try_record_billed_result RPC + billing summary`.

---

## Task 5: WhatsApp webhook Route Handler

**Files:** Create `src/app/api/webhooks/whatsapp/route.ts`

- [ ] **Step 1: Implement** — server-to-server (NO CSRF/auth gate; signature IS the auth):
  - `GET`: fail-closed gate (`getOutreachEnabled` + `getWhatsAppConfig().verifyToken`); answer Meta's `hub.mode=subscribe` + `hub.verify_token` match → return `hub.challenge` (200), else 403.
  - `POST`: gate (enabled + config with `appSecret`). Read the RAW body + `x-hub-signature-256`. Construct `new WhatsAppAPI({ token: accessToken, appSecret, webhookVerifyToken: verifyToken, secure: true })` and `await api.post(JSON.parse(raw), raw, signature)` — this THROWS on a bad signature (return 401, create nothing). On valid: for each `entry[].changes[].value`, run `classifyInbound`; for each event `insertInteraction` (dedupe); for each billable human message that inserted fresh → `resolveInboundContact` → `recordReached`; map statuses to `setContactOpStatus` (delivered/read, non-billable). Always return 200 to Meta after processing (so it stops retrying), even when nothing was billable. Never log the raw body/phone.
- [ ] **Step 2: Typecheck** `npx tsc --noEmit` → clean. (Webhook route is integration-tested manually in Task 6; the billable/dedup logic is unit-tested in Tasks 2-4.)
- [ ] **Step 3: Commit** `feat(billing): WhatsApp inbound webhook (signature-verified, dedup, billed_results)`.

---

## Task 6: Go-live verification (BEFORE enabling)

- [ ] **Step 1:** Apply the Task-1 migration (approval); provision `whatsapp_app_secret` + `whatsapp_verify_token` in app_settings; in the Meta app, set the Callback URL to `https://beta.kalfa.me/api/webhooks/whatsapp` + the verify token, subscribe to `messages`.
- [ ] **Step 2:** One build + restart; the GET challenge must succeed in Meta's UI.
- [ ] **Step 3:** With an ACTIVE test campaign that already sent a WhatsApp template to your own (consented) number: reply from your phone. Verify — an inbound `contact_interactions` row, a `billed_results` row with `locked_price=price_per_reached`, op_status `reached_billed`, and that a SECOND reply creates NO second billed_result (dedup). Verify a `delivered` status creates no billed_result. Verify `campaign_billing_summary` returns reached_count=1.
- [ ] **Step 4:** Advisor checkpoint (this is the money-detection core). Then the B4 close-charge has a real `SUM(billed_results)` to charge.

---

## Self-Review notes

- **Spec coverage:** signature-verified inbound (T5), billable=human-message-only / delivered-read-not-billable (T2/T5, §4.1/§11), one-billed_result-per-(event,contact) + cap + window in a locked txn (T1, §7/§13/§18.12), webhook replay-safe via interaction dedup (T3), op_status transitions (T3/T4), config-gated/fail-closed + forged-POST-creates-nothing (T5, §18.10), reached→`reached_billed` (T4). `campaign_billing_summary` (T1/T4) is what B4 close-charge consumes.
- **Out of scope (follow-on):** Voximplant inbound webhook (same shape, `human_interaction_call` → reached); the B4 close-charge itself (consumes `campaign_billing_summary`); removal-request handling beyond the RPC guard.
- **Type consistency:** RPC name `try_record_billed_result` + its param names (`p_event`/`p_campaign`/`p_contact`/`p_channel`/`p_attempt`/`p_evidence`/`p_provider_ref`) are identical in T1 and T4; outcome strings identical in T1/T4; `contact_interactions` insert keys match B3's writer; reached op_status `reached_billed` matches the enum.
- **Open decision:** the exact "billable message types" set (T2) — text/button/interactive are clearly human; confirm whether reactions or template-quick-replies count, per the business definition of "reached" (§4.1).
