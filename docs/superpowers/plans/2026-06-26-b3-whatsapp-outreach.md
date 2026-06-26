# B3 (slice 1) — WhatsApp Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an approved WhatsApp Cloud API template to an event's reachable contacts for an **active** campaign, gated by consent/ceiling/removal, logging each send as an outbound `contact_interaction` — with NO real message sent until WhatsApp is explicitly enabled and configured.

**Architecture:** A thin `whatsapp-api-js` adapter (`WhatsAppAPI.sendMessage` with a `Template` message) behind a fail-closed config gate, called by a server-only `sendCampaignWhatsApp` orchestrator that re-checks every spec §8.3 precondition (active campaign, contact eligible + consented + not removal-requested + not already reached + under ceiling) before any provider call, then records the outbound interaction. Mirrors the J5 fail-closed/config-gated pattern.

**Tech Stack:** Next.js 16 (server-only data layer + Route Handlers), `whatsapp-api-js@6.2.1` (WhatsApp Cloud API), Supabase service-role for writes, Zod 4, Vitest. No new npm packages.

## Scope

This is **slice 1 of B3** (WhatsApp send only). Explicitly OUT of scope, each a follow-on plan:
- **Voximplant AI calls** (Management API via fetch) — separate plan.
- **pg-boss event-anchored scheduler / drip + WhatsApp→call escalation** — separate plan; this slice exposes `sendCampaignWhatsApp` for the scheduler to call, plus a manual admin trigger for testing.
- **B2 inbound webhooks** (`post()` verification → `billed_results`) — separate plan; the WhatsApp app secret + verify token are provisioned here so B2 can use them.

## Global Constraints

- **Config-gated / fail-closed:** no WhatsApp call unless `outreach_enabled = true` AND `getWhatsAppConfig()` returns a full config (phone number id + access token). Default OFF. The flag reader is forward-compatible (`select('*')` + cast) so it returns false before the migration is applied — exactly like `getCampaignHoldsEnabled`.
- **No real send in tests/build:** the adapter is unit-tested with a mocked `WhatsAppAPI`; `npm run test`/`next build` never hit Meta.
- **§8.3 gating, server-side only:** before any send — campaign.status='active', contact not `removal_requested`, contact not already reached/billed, channel allowed, under `max_charge_ceiling` headroom, and recorded WhatsApp consent. Never trust the client.
- **PII / secrets:** never log the access token, app secret, recipient phone, or message body. Marketing consent is channel-specific and recorded (CLAUDE.md + IL/GDPR).
- **Migrations hit the LIVE Supabase** ([[supabase-live-schema]]): write the `.sql`, introspect first via `scripts/sb-query.mjs`, apply only with explicit approval (a one-off Management-API write — `sb-query.mjs` is read-only), then DON'T regenerate types from-scratch (use the forward-compatible cast pattern).
- **No hardcoded business facts** ([[no-hardcoded-business-facts]]): template names/language, provider config, and the outreach flag are admin DB config.
- **Build discipline:** one `npm run build` + immediate `pm2 restart kalfa-beta`; tell the user to hard-refresh (Server Action / chunk IDs change).

## Existing schema/code this builds on (read before starting)

- `whatsapp-api-js@6.2.1`: `new WhatsAppAPI({ token, appSecret, webhookVerifyToken, secure })`; `sendMessage(phoneID, to, message, context?, biz_opaque_callback_data?)`; `Template`/`Language` from `whatsapp-api-js/messages`. 0 imports in `src` today (greenfield).
- `contact_interactions` (EXISTS): `{ id, event_id, campaign_id, contact_id, channel(enum campaign_channel), direction(text), kind(text), provider_id(text), billable(bool), payload_meta(jsonb), created_at }` + UNIQUE(channel, provider_id) for dedup. B3 writes outbound rows here (`direction='out'`, `kind='template'`, `billable=false`).
- `contacts` (EXISTS): `{ id, event_id, normalized_phone, op_status(enum contact_op_status), removal_requested(bool), … }`. NO consent column yet.
- `campaigns`: `status(enum)`, `allowed_channels(campaign_channel[])`, `max_charge_ceiling`, `price_per_reached`, `event_id`.
- `app_settings`: singleton, admin-only RLS, read via `createAdminClient()`. NO provider columns yet.
- `src/lib/data/payments.ts` `getCampaignHoldsEnabled` — the forward-compatible fail-safe flag-reader pattern to copy.
- `src/lib/data/contacts.ts` — `requireOwnedEvent`-gated reads; service-role writes.
- `src/lib/sumit/authorize.ts` + `src/app/api/campaigns/[id]/authorize/route.ts` — the adapter + gated-route patterns to mirror.

---

## File Structure

- Create `supabase/migrations/<ts>_whatsapp_outreach.sql` — app_settings (outreach_enabled + whatsapp_* config), contacts.whatsapp_consent_at, message_templates table.
- Create `src/lib/data/outreach-config.ts` — `getOutreachEnabled()`, `getWhatsAppConfig()` (fail-safe, forward-compatible).
- Create `src/lib/whatsapp/client.ts` — `sendWhatsAppTemplate()` adapter over whatsapp-api-js.
- Create `src/lib/whatsapp/client.test.ts` — adapter tests (mocked WhatsAppAPI).
- Create `src/lib/data/message-templates.ts` — list/resolve approved templates (admin client).
- Modify `src/lib/data/contacts.ts` — `recordWhatsAppConsent`, `listSendableContacts` (eligible-for-send query).
- Create `src/lib/data/outreach.ts` — `sendCampaignWhatsApp(campaignId)` orchestrator (gate → send → log interaction).
- Create `src/lib/data/outreach.test.ts` — gating + interaction-logging tests (mocked adapter + supabase).
- Create `src/app/api/campaigns/[id]/whatsapp-send/route.ts` — admin/owner manual trigger (gated), for testing before the scheduler exists.
- Modify `src/app/(admin)/admin/settings/*` — expose `outreach_enabled` + whatsapp config fields (write the .sql first).

---

## Task 1: Migration — provider config, consent, message_templates (apply only with approval)

**Files:** Create `supabase/migrations/<ts>_whatsapp_outreach.sql`

- [ ] **Step 1: Introspect first** — `node scripts/sb-query.mjs "select column_name from information_schema.columns where table_name='app_settings' and column_name like '%whatsapp%'"` and check `message_templates` doesn't exist. Skip anything already present.
- [ ] **Step 2: Write the migration**

```sql
-- Outreach master switch + WhatsApp Cloud API config (admin-managed, server-only).
alter table public.app_settings
  add column if not exists outreach_enabled boolean not null default false,
  add column if not exists whatsapp_phone_number_id text,
  add column if not exists whatsapp_access_token text,
  add column if not exists whatsapp_app_secret text,       -- for B2 webhook signature
  add column if not exists whatsapp_verify_token text;     -- for B2 webhook GET challenge

-- Channel-specific consent (CLAUDE.md / IL law). Null = no recorded WhatsApp consent.
alter table public.contacts
  add column if not exists whatsapp_consent_at timestamptz;

-- Approved WhatsApp templates (admin-managed). message_key is referenced by the
-- campaign outreach_schedule; name/language are the Meta-approved template identifiers.
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  message_key text not null unique,
  channel public.campaign_channel not null,
  name text not null,            -- Meta-approved template name
  language text not null default 'he',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.message_templates enable row level security;
create policy message_templates_admin_all on public.message_templates
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));
```

- [ ] **Step 3: DO NOT push.** Surface the SQL; get explicit approval to apply to the live DB (one-off Management-API write). After apply, do NOT regenerate types (the readers below cast).
- [ ] **Step 4: Commit** the `.sql`: `chore(db): migration for whatsapp outreach config/consent/templates (pending apply)`.

---

## Task 2: Fail-safe config readers

**Files:** Create `src/lib/data/outreach-config.ts`; Test `src/lib/data/outreach-config.test.ts`

**Interfaces:**
- Produces: `getOutreachEnabled(): Promise<boolean>` (fail-safe false), `getWhatsAppConfig(): Promise<{ phoneNumberId: string; accessToken: string; appSecret: string | null; verifyToken: string | null } | null>` (null unless phone id + token present).

- [ ] **Step 1: Failing tests** — mirror `payments.test.ts` `mockAdmin`. Assert: `getOutreachEnabled` true only when the column is present and true; false when absent (pre-migration), off, error, or admin throws. `getWhatsAppConfig` returns the config when phone id + token present; null otherwise.
- [ ] **Step 2:** Run `npx vitest run src/lib/data/outreach-config.test.ts` → FAIL.
- [ ] **Step 3: Implement** with the forward-compatible `select('*')` + `as Record<string, unknown>` cast (copy `getCampaignHoldsEnabled` exactly), reading `outreach_enabled` / `whatsapp_phone_number_id` / `whatsapp_access_token` / `whatsapp_app_secret` / `whatsapp_verify_token` via `createAdminClient()`. Both functions wrapped in try/catch → false/null.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(outreach): fail-safe outreach_enabled + whatsapp config readers`.

---

## Task 3: WhatsApp adapter

**Files:** Create `src/lib/whatsapp/client.ts`; Test `src/lib/whatsapp/client.test.ts`

**Interfaces:**
- Produces: `sendWhatsAppTemplate(cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null }, params: { to: string; templateName: string; language: string }): Promise<{ providerId: string }>`. Throws `WhatsAppSendError` on any failure.

- [ ] **Step 1: Failing test** (`src/lib/whatsapp/client.test.ts`) — mock the module:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const sendMessage = vi.fn();
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: vi.fn().mockImplementation(() => ({ sendMessage })),
}));
vi.mock('whatsapp-api-js/messages', () => ({
  Template: vi.fn().mockImplementation((name, language) => ({ name, language })),
  Language: vi.fn().mockImplementation((code) => ({ code })),
}));
import { sendWhatsAppTemplate, WhatsAppSendError } from './client';

const cfg = { phoneNumberId: 'PNID', accessToken: 'TKN', appSecret: null };
afterEach(() => vi.clearAllMocks());

describe('sendWhatsAppTemplate', () => {
  it('sends the approved template to the recipient and returns the provider message id', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.123' }] });
    const r = await sendWhatsAppTemplate(cfg, { to: '+972501234567', templateName: 'rsvp_invite', language: 'he' });
    expect(sendMessage).toHaveBeenCalledWith('PNID', '+972501234567', expect.objectContaining({ name: 'rsvp_invite' }));
    expect(r.providerId).toBe('wamid.123');
  });
  it('throws WhatsAppSendError when the API errors', async () => {
    sendMessage.mockRejectedValue(new Error('meta down'));
    await expect(sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' }))
      .rejects.toBeInstanceOf(WhatsAppSendError);
  });
  it('throws WhatsAppSendError when no message id is returned', async () => {
    sendMessage.mockResolvedValue({ messages: [] });
    await expect(sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' }))
      .rejects.toBeInstanceOf(WhatsAppSendError);
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/lib/whatsapp/client.ts`:

```ts
import 'server-only';
import { WhatsAppAPI } from 'whatsapp-api-js';
import { Template, Language } from 'whatsapp-api-js/messages';

export class WhatsAppSendError extends Error {
  constructor(msg: string) { super(msg); this.name = 'WhatsAppSendError'; }
}

export async function sendWhatsAppTemplate(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: { to: string; templateName: string; language: string },
): Promise<{ providerId: string }> {
  // secure:false avoids the appSecret requirement for SENDING (it's only needed to
  // verify inbound webhooks, handled in B2). Never log token/secret/recipient.
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  const message = new Template(params.templateName, new Language(params.language));
  let res: { messages?: Array<{ id?: string }> };
  try {
    res = (await api.sendMessage(cfg.phoneNumberId, params.to, message)) as typeof res;
  } catch {
    throw new WhatsAppSendError('שליחת הודעת וואטסאפ נכשלה');
  }
  const providerId = res?.messages?.[0]?.id;
  if (!providerId) throw new WhatsAppSendError('לא התקבל מזהה הודעה מוואטסאפ');
  return { providerId };
}
```

- [ ] **Step 4:** Run → PASS (3 tests).
- [ ] **Step 5: Commit** `feat(whatsapp): Cloud API template-send adapter (mocked-tested, no live call)`.

---

## Task 4: message_templates data layer

**Files:** Create `src/lib/data/message-templates.ts`; Test alongside.

**Interfaces:**
- Produces: `getTemplateByKey(messageKey: string): Promise<{ name: string; language: string; channel: string } | null>` (admin client; active only). Used to resolve a campaign's `outreach_schedule[].message_key` to the Meta-approved template.

- [ ] **Step 1: Failing test** — assert it selects `message_templates` by `message_key` + `active=true` and maps name/language/channel. (mock admin via createMockSupabase.)
- [ ] **Step 2-4:** Run FAIL → implement (`createAdminClient().from('message_templates').select('name, language, channel').eq('message_key', key).eq('active', true).maybeSingle()`) → PASS.
- [ ] **Step 5: Commit** `feat(outreach): message_templates resolver`.

---

## Task 5: Consent + sendable-contacts data layer

**Files:** Modify `src/lib/data/contacts.ts`; tests in `contacts.test.ts`.

**Interfaces:**
- Produces:
  - `recordWhatsAppConsent(eventId, contactId): Promise<void>` — sets `whatsapp_consent_at=now()` (service-role; caller authorized).
  - `listSendableContacts(eventId): Promise<Array<{ id: string; normalized_phone: string }>>` — contacts for the event that are NOT `removal_requested`, HAVE `whatsapp_consent_at`, and op_status NOT already reached/billed. Owner-scoped read.

- [ ] **Step 1: Failing tests** — `recordWhatsAppConsent` updates `{ whatsapp_consent_at }` scoped by id+event_id; `listSendableContacts` filters `.eq('event_id', …).eq('removal_requested', false).not('whatsapp_consent_at','is',null)`.
- [ ] **Step 2-4:** Run FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(outreach): WhatsApp consent recording + sendable-contacts query`.

> **OPEN PRODUCT DECISION (sign-off before go-live):** the consent MODEL — is RSVP outreach for a specific invited guest *transactional* (event-scoped, owner attests they hold consent) or *marketing* (explicit per-recipient opt-in required)? This slice gates on a recorded `whatsapp_consent_at`; HOW it's recorded (owner bulk-attest at approval vs per-guest opt-in) is the user's legal call. Default: require an explicit recorded consent per contact (fail-closed).

---

## Task 6: Outreach orchestrator (gate → send → log)

**Files:** Create `src/lib/data/outreach.ts`; Test `src/lib/data/outreach.test.ts`.

**Interfaces:**
- Consumes: `getOutreachEnabled`, `getWhatsAppConfig`, `getTemplateByKey`, `listSendableContacts`, `sendWhatsAppTemplate`, campaign read (status/allowed_channels/event_id/outreach_schedule), `createAdminClient`.
- Produces: `sendCampaignWhatsApp(campaignId, messageKey): Promise<{ sent: number; skipped: number }>`.

- [ ] **Step 1: Failing tests** (mock the adapter + config + supabase):
  - returns `{sent:0}` and never calls the adapter when `getOutreachEnabled()` is false (fail-closed).
  - never calls the adapter when campaign.status !== 'active' or 'whatsapp' not in allowed_channels.
  - for each sendable contact: calls `sendWhatsAppTemplate` then inserts a `contact_interactions` row `{ direction:'out', kind:'template', channel:'whatsapp', provider_id, billable:false }` (ON CONFLICT(channel,provider_id) DO NOTHING).
  - a single send failure increments `skipped`, does NOT abort the batch, and logs no PII.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — gate (enabled + config + status='active' + channel allowed + resolve template), then for each `listSendableContacts`: try send → insert interaction; catch → skipped++. Server-derived everything; never log phone/body.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(outreach): sendCampaignWhatsApp orchestrator (fail-closed, gated, logged)`.

---

## Task 7: Admin/owner manual trigger Route Handler

**Files:** Create `src/app/api/campaigns/[id]/whatsapp-send/route.ts`.

- [ ] **Step 1: Implement** the POST handler mirroring `api/campaigns/[id]/authorize/route.ts`: CSRF (APP_ORIGIN), `requireUser`, load campaign + `requireOwnedEvent`, fail-closed gate (`getOutreachEnabled` + `getWhatsAppConfig`), read `message_key` from the form (Zod), call `sendCampaignWhatsApp`, 303 redirect with a result count. Build redirects from `APP_ORIGIN` (not request.url — same proxy lesson as the J5 fix).
- [ ] **Step 2: Typecheck** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit** `feat(outreach): gated manual WhatsApp-send trigger route`.

---

## Task 8: Go-live verification (BEFORE enabling)

- [ ] **Step 1:** Apply the Task-1 migration with explicit approval; provision `whatsapp_phone_number_id` + `whatsapp_access_token` (+ app_secret/verify_token for B2) in app_settings; insert at least one `message_templates` row whose `name` is a Meta-APPROVED template.
- [ ] **Step 2:** One `npm run build` + `pm2 restart`; tell the user to hard-refresh.
- [ ] **Step 3:** Set `outreach_enabled=true`. Controlled test: trigger `sendCampaignWhatsApp` for an ACTIVE test campaign with ONE consented test contact (your own number). Verify a real WhatsApp template arrives, a `contact_interactions` out/template row exists, and NO send happens for a removal_requested / non-consented contact.
- [ ] **Step 4:** Advisor checkpoint before broad rollout (real messages = explicit-approval action per CLAUDE.md). Then decide rollout.

---

## Self-Review notes

- **Spec coverage:** WhatsApp approved-template send (T3), template resolution from message_key (T4), §8.3 gating incl. active-campaign/channel/removal/consent/ceiling-headroom (T6), channel-specific consent recording (T5), outbound interaction logging for the B2 dedup key (T6), config-gated/fail-closed throughout (T2/T6/T7). Ceiling-headroom + not-already-reached gating live in T6 against `contact_interactions`/`billed_results` (reached) — keep it server-side.
- **Out of scope (follow-on plans):** Voximplant calls, the pg-boss event-anchored scheduler + WhatsApp→call escalation, and B2 inbound webhooks (which consume the app_secret/verify_token provisioned in T1). `sendCampaignWhatsApp` is the seam the scheduler will call.
- **Type consistency:** config shape `{ phoneNumberId, accessToken, appSecret, verifyToken }` is identical in T2/T3/T7; `contact_interactions` insert keys match the existing columns (direction/kind/channel/provider_id/billable); `whatsapp_consent_at` used identically in T1/T5.
- **Open decisions for the user:** (1) the consent model (transactional vs marketing — T5 note); (2) whether the manual trigger (T7) is interim-only until the scheduler ships.
