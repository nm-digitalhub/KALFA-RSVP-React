# Design

## Context

See proposal.md for motivation. The research behind this design was done read-only on 22.10.2026. Every claim was checked in code or in the live catalog, or marked as an assumption.

Today's facts that shape the approach:
- **Schedule snapshot.** The package schedule is copied into `campaigns.outreach_schedule` (jsonb, no shape check) at package choice: `createCampaign` → `create_package_campaign` (`src/lib/data/campaigns.ts:157-166`). No code path changes it afterwards.
- **Planning.** The engine plans one step at a time. `record_step_plan` stores `outreach_state.planned_at` (the send instant of the current step) and `plan_rev` with a compare-and-set. The arm cron re-plans every active contact each minute (`worker/main.ts:658-670`, `outreach-engine.ts:780-893`). A changed `plan_rev` makes a queued step job drop and re-arm (`worker/main.ts:487-494`). Later steps have no stored time.
- **`next_run_at` is never written,** yet console views read it.
- **The KALFA window lives in pure code:**
  - `send-policy.ts` (hard ceilings; Saturday has no window);
  - `jewish-calendar.ts` (@hebcal/core, Jerusalem);
  - `send-window.ts` (`plannedSendTime`, `computeStepSlot`, `evaluateStep`, `resolveSendSlot`).
  It is applied only to the automatic engine. Calls are re-gated at dial time by a different policy (`outreach-calls.ts:207-233`).
- **Customer sends.** Manual sends and the thank-you sweep go through `sendCampaignWhatsApp` (`outreach.ts`) with no calendar check. Only the thank-you has a per-guest claim (`claim_thankyou_recipient`: a placeholder row in `contact_interactions` with a partial unique index).
- **Auth.**
  - Customer reads are org-aware: `requireEventAccess` → `can_access_event` (event owner OR `has_org_permission`).
  - Customer writes are owner-only: `requireOwnedEvent`.
  - `permission_definitions` is a `(resource, action)` catalog. `system_protected` rows count only for the org owner role.
  - The team roles screen already edits the per-org matrix (`src/app/(customer)/app/team/roles/actions.ts`).
  - Live: role `member` holds `campaigns.edit`, and nothing checks it.
- **Settings** are columns of the single-row `app_settings` table, edited in admin settings screens (pattern: `owner_agent_daily_cap`).
- **Platform permissions** are rows of `platform_permission_definitions` (`key, label, category`), checked through `has_platform_permission`.
- **The model API.** `@anthropic-ai/sdk` 1.1.0 is a direct dependency and unused. Facts verified in its typings and the official docs (saved copies in the research folder):
  - its `Usage` carries input, output and cache-read counts, plus cache-write counts split into 5-minute and 1-hour;
  - streaming usage is cumulative;
  - `MessageStream.toReadableStream()` and `fromReadableStream()` exist.
  - Haiku 5.5 rejects `temperature` and assistant prefill, and may open a reply with thinking blocks.
  - The minimum cacheable prefix is 512 tokens.
  - Prices: Haiku 5.5 ≤100k-token prompts $0.10 in / $0.125 5m write / $0.20 1h write / $0.01 read / $0.50 out. Above 100k the whole request is priced at the higher tier.
  - Sonnet 5.5: $2 / $2.50 / $4 / $0.10 / $10.
- **Board data.** The board's data exists (`events`, `campaigns`, `guests`, `contacts.op_status`, `outreach_state`, `contact_interactions`, `callback_requests`). There is no task table. The empty-payload broadcast pattern (`20261022100542_platform_permission_change_signal.sql`) is live in production.

## Goals / Non-Goals

**Goals:**
- One server-side timing service, used by the screens, the assistant and the board, so that a time shown anywhere is the time that will happen.
- No silent path: every customer-initiated change or send is previewed, confirmed once, and audited.
- An assistant whose authority is exactly the user's, whose cost is bounded in money, and whose facts come from code.
- A staff board that adds no second source of truth: everything except tasks is derived.

**Non-Goals:** see proposal.md, "Non-goals". In addition, this design does not change:
- the engine's one-step-at-a-time execution model;
- pg-boss;
- the WhatsApp provider path.

## Decisions

### D1. Initiator is a column, not inferred from `message_key`
`contact_interactions` gets `initiator` (`kalfa` | `customer`, not null; backfilled `kalfa`, except rows whose `message_key` is a manual-send key). It also gets `proposal_id` (nullable). Outbound skip records (D9) carry the same pair.

- *Why:* the window rule and billing both depend on who started the send. Inferring it from `message_key` + `billable` (today) breaks as soon as a key is used by both.
- *Alternative:* a separate table per initiator. Rejected: two places to read a guest's timeline.

### D2. Per-event changes are a versioned override layer
New table `campaign_schedule_overrides`:
- `campaign_id`, `version` (int);
- `step_key` (stable id of a package step: `days_before|channel|message_key`, hashed);
- `action` (`move` | `skip`);
- `send_at` (for move, IL wall-clock stored as timestamptz);
- `created_by`, `proposal_id`.

`campaigns` gets `schedule_version int not null default 0`. The effective schedule = snapshot + the overrides of the current version. It is computed by one pure function, `effectiveSchedule(snapshot, overrides)`, used by the engine, the projection and the preview.

`stepPlanRev` includes the override hash. Changing an override therefore changes `plan_rev`, and the existing CAS + re-arm mechanism re-plans within one tick. There is no new trigger and no new re-plan path.

- *Why not mutate the snapshot:* the snapshot is the purchased terms. The review found that it already has no version. A layer keeps "what was bought" and "what this event chose" separate and auditable.
- *Validation (pure, server-side, shared):* no new step; same channel; moved KALFA step inside the window (`resolveSendSlot` must return the same instant); order preserved; already-sent steps untouched (their `outreach_state` cursor has passed).
- The DB adds a shape CHECK on `campaigns.outreach_schedule` via an immutable validation function.

### D3. Proposals are rows; confirmation is a separate request
New table `timing_proposals`:
- `id`, `event_id`, `campaign_id`, `kind` (`schedule_change` | `thankyou_time` | `manual_send`);
- `payload` jsonb (validated by zod on write);
- `preview` jsonb: effective times, affected guest count, warnings;
- `base_schedule_version`, `status` (`proposed` | `applied` | `refused` | `expired`), `refusal_code`;
- `created_by`, `surface` (`screen` | `assistant`), `created_at`, `expires_at` (+30 min), `applied_at`, `applied_by`.

Apply is one SQL function. It locks the campaign row, re-checks status, expiry, `base_schedule_version` and `can_access_event(event,'campaigns','schedule')` for `auth.uid()`, then writes the change and flips status, all in one transaction. A second apply returns `already_applied`.

- *Why:* the assistant's tool call and the user's click happen in different HTTP requests, and the screen has the same need. A stored proposal works the same for both, and gives idempotency and audit.
- *Relation to the AI SDK approval (D12):* the chat uses the AI SDK's `toolApproval` for the user's click, but the approval travels from the browser. The stored proposal is what binds the click to the exact previewed change, applies it once, re-checks authority at apply time and audits it. The screens use the same apply.

### D4. KALFA window and per-channel planning
- **The default thank-you** (`defaultThankyouSendAt` and the matching SQL in `trg_sync_campaign_window_from_event`) is computed through `resolveSendSlot`: day + 1 10:00, then the first allowed slot.
- **The planner uses the dial policy for call steps.** `ensureCurrentStep` picks the policy by the step's channel: the WhatsApp send policy for `whatsapp`, the call-hours policy for `call`. That policy is the one `dispatchOutreachCall` uses today (`getCallbackPolicy().dialWeekday` + Shabbat).
  - The dial-time check stays as a guard.
  - The algorithm version in `schedule.ts` is bumped, so that every live plan re-plans once.
- *Alternative:* merge the two policies into one. Rejected for now: they are edited on two existing admin screens, and merging them is a product decision with no request behind it. Planning with the right policy is enough for one truthful time.

### D5. Customer-initiated time rules
- **Past times are refused.** Night / Shabbat / holiday produce warnings computed by `buildJewishCalendar` and the policy hours, without blocking. The warning codes are stored in the proposal; confirming records them as acknowledged.
- **Manual "send now" is allowed at any time** (owner decision 22.10) with the same warnings.

### D6. Idempotent manual sends
`claim_thankyou_recipient` is generalized into `claim_manual_send(p_campaign, p_contact, p_event, p_message_key)`, using the same placeholder-row technique. There is one partial unique index per manual key (`gift`, `event_day_pay`, `thankyou`), created in the same migration. The thank-you path keeps its behaviour, through the new function.

The preview counts the guests already claimed and excludes them.

### D7. Thank-you state
`campaigns.thankyou_state` (`not_scheduled` | `scheduled` | `sending` | `sent` | `will_not_send`) plus `thankyou_state_reason`.
- The sweep moves `scheduled → sending` with a conditional update before sending, and `sending → sent` after.
- Edits are refused unless the state is `not_scheduled` or `scheduled`.
- A manual thank-you sets `sent` when the batch ends.
- Closing the event or the service sets `will_not_send` with its reason. This happens in the same functions that close them today.

`thankyou_sent_at` is kept and written with `sent`, for existing readers.

### D8. Timing permission
- **The catalog row.** A new `permission_definitions` row `('campaigns','schedule', label 'תזמון ושליחה לאורחים', system_protected=false)`. It is seeded into `organization_role_permissions` for the org owner role of every existing org and for new orgs, and into no other role.
- **The event owner** passes through `can_access_event`'s `owner_id` branch.
- **Gates.**
  - `requireEventAccess(eventId,'campaigns','schedule')` gates every proposal create/apply and every manual-send action, replacing `requireOwnedEvent` there.
  - Controls render only when the same `canAccessEvent(...)` probe is true (fixes the visibility/authority split).
- **Why not `campaigns.edit`:** the live catalog grants it to `member` by default and nothing checks it today. Reusing it would silently give every member send power, contrary to the owner's decision.

### D9. Next contact and "why not contacted"
- **Next contact.** `getNextContacts(eventId)`, server-only, gated by `campaigns.view`, reads `outreach_state` (cursor, status, `stop_reason`, `planned_at`). It projects later steps with `effectiveSchedule` + `computeStepSlot` and the per-channel policy (D4).
- **Console views.** A migration changes them to expose `planned_at` under the old column name, so the console contract is unchanged. `next_run_at` is then dropped.
- **Why not contacted.** The worker records automatic skips as `activity_log` rows: `outreach.contact_skipped`, with `reason` from the existing `CallDispatchResult` codes, `contact_id`, `campaign_id`, and no PII. This is the same table `outreach.step_resolved` already uses. A reader, `getContactSkips(eventId, contactId)`, is gated by `contacts.view`.

### D10. Audit
Every proposal transition and every customer-initiated send calls the existing `logActivity` with:
- an action from a closed list (`timing.proposal_created|applied|refused|expired`, `outreach.manual_send`);
- meta `{proposalId, surface, warningsAcknowledged}`.

The actor is the signed-in user. No message text, phone or name is written.

### D11. Remove the any-template route
`src/app/api/campaigns/[id]/whatsapp-send/` (route + test) is deleted. Its mention in `allowed-origin.ts` is removed. No caller exists (grep, 22.10).

### D12. Assistant runtime: Vercel AI SDK with the Anthropic provider
- **Packages, pinned exactly.** Use `ai` (installed 7.0.141). Add:
  - `@ai-sdk/anthropic` 4.0.85;
  - `@ai-sdk/react` 4.0.152.

  `@ai-sdk/react` 4.0.152 depends on `ai` 7.0.148 exactly (`npm view`, 22.10), so `ai` is bumped to 7.0.148 in the same step. The direct `@anthropic-ai/sdk` line added to `package.json` by the 22.10 install is removed: nothing imports it, and it stays as a dependency of `@anthropic-ai/claude-agent-sdk`.
- **Server.** A route handler `POST /api/events/[id]/assistant` (Node runtime, `server-only` modules) calls `streamText` with:
  - `model: createAnthropic({ apiKey: process.env.KALFA_ANTHROPIC_API_KEY })(<model from settings>)`;
  - the D13 tools, with `toolApproval` set to `user-approval` for `apply_proposal` only;
  - `stopWhen: stepCountIs(6)`;
  - `maxOutputTokens: 1024`;
  - `maxRetries: 1`;
  - an `abortSignal` with a 60s timeout.

  It returns `createUIMessageStreamResponse`. No `temperature`; Haiku 5.5 rejects it.
- **Client.** `useChat` with `DefaultChatTransport` to that route. `prepareSendMessagesRequest` sends only the last message and the conversation id. The approval card uses `addToolApprovalResponse`, as the AI SDK chatbot docs show.
- **History is server truth.** The route loads the conversation from the database, appends the new message, validates everything with `validateUIMessages` and the tool schemas, and saves the result in `onFinish`. A message list sent by the browser is never trusted, because an approval part could be forged.
- **Confirmation (with D3).**
  - The model calls `propose_*`. These run without approval and create a stored proposal row with its preview.
  - It then calls `apply_proposal({proposalId})`, which needs user approval. The approval card shows the stored preview, not the model's words.
  - On approval, the server runs the SQL apply. The apply re-checks permission, expiry and schedule version, applies once, and audits.
  - A denial expires the proposal.
  - The same SQL apply is the screen's confirm action.
- **Errors.** An Anthropic 429 without `retry-after` means the org spend cap was hit. It turns `assistant_enabled` off and alerts Slack through the existing alert path. Any other failure shows a short Hebrew error and releases the reservation (D17).
- *Why AI SDK over the direct `@anthropic-ai/sdk`:* the AI SDK already provides what a direct client would have to hand-write:
  - chat state in the browser (`useChat`);
  - the streaming protocol;
  - the tool loop (`stopWhen`);
  - tool approval (`toolApproval`; `needsApproval` is deprecated in the current docs);
  - message validation (`validateUIMessages`);
  - the persistence pattern.

  The owner's standing rule is not to hand-write what a package provides. It also reports cache-read and cache-write tokens on `usage.inputTokenDetails` (Anthropic provider docs), which is enough for D17. The provider can be swapped without rewriting the tools, for example to evaluate a local model elsewhere.
- *Why not `claude -p` / the Agent SDK:* Anthropic's docs forbid a subscription login for a product offered to third parties. The Agent SDK runs the Claude Code harness (files, shell), which we would pay for and not need.
- *Why not Hermes (re-checked 22.10 against the docs the owner sent; R5):*
  - **Identity.** Hermes can serve a chat (`api-server`), restrict toolsets per platform (`tools`), take custom tools as plugins, and route several profiles through one shared listener with a key per profile. But it has no per-request identity of the user signed in to KALFA: the MCP `identity_header` is static or per-profile, "resolved once at connect time". Customer authorization would be glue we write in Python, a second path beside `can_access_event`.
  - **Prompt and state.** A frontend system prompt is "layered on top of its core system prompt … keeps all its tools, memory, and skills", so memory and skills would be shared across customers unless disabled.
  - **Security.** The API server "gives full access to hermes-agent's toolset, including terminal commands" unless restricted, and its security model is operator-centric.
- *Why not a local model (Ollama) for customers:* the production host has 8 vCPU, 15 GB RAM (about 9 GB free), no GPU (`nvidia-smi` absent) and a load average of about 5.7 (22.10). It runs the site and the worker. Ollama documents CPU-only loading ("100% CPU"). Hebrew quality of small open models is unmeasured. A local model may be evaluated off this host with the D16 question set, through the same AI SDK code.

### D13. Tools are thin wrappers over existing gated reads
Each tool is an AI SDK `tool()` with a strict zod `inputSchema` and an output re-validated and stripped before it returns. It calls an existing server read under the user's cookie session, so RLS and `requireEventAccess` apply unchanged.

| Tool | Reuses | Gate |
|---|---|---|
| `event_status` | `getEventStats` (`src/lib/data/event-stats.ts:154`) | `reports.view` |
| `guest_answers` | `getGuestTotals`, `listGuests` with names only (≤50) | `guests.view` |
| `delivery` | `getCampaignDeliveryBreakdown` | `campaigns.view` |
| `next_contacts` | D9 reader | `campaigns.view` |
| `guest_history` | `getGuestOutreachSummary`, `listInteractionsForContact`, D9 skips | `contacts.view` |
| `schedule` | effective schedule + projection | `campaigns.view` |
| `policy` | knowledge document by topic (D14) | always |
| `propose_*` | D3 proposals (`schedule_change`, `thankyou_time`, `manual_send`) | `campaigns.schedule` |
| `apply_proposal` | D3 SQL apply, behind `toolApproval: 'user-approval'` | `campaigns.schedule`, re-checked in SQL |

The tool set for a request is computed once from `canAccessEvent` probes, before the first model call. This is the owner-agent's `toolsForPermissions` pattern. `event_id` is bound server-side; no tool accepts it from the model. `getCampaignBillingSummary` is not exposed: it has no gate of its own.

### D14. Knowledge as SKILL.md-format documents, served by a tool
- **Where.** `src/lib/assistant/knowledge/*.md` (one rule each: KALFA vs customer sends, Shabbat/holidays, what a package allows, how proposals work, what the assistant cannot do). Each follows the SKILL.md conventions: description ≤ 60 chars with the trigger first, When to Use, Procedure, Pitfalls.
- **How.** The cached system prompt lists only their names and descriptions. The `policy` tool returns one on demand. A unit test checks the frontmatter and size of every document.
- *Why not Claude API Agent Skills:* they require the code-execution tool, a sandbox with bash and files (`agent-skills/overview`, `skills-guide`). That is surface we do not want for untrusted customers.

### D15. Prompt layout and caching
`tools` → `system` (role, rules index, Hebrew style) → per-event facts block. One breakpoint sits at the end of the static prefix, set with `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` (5m TTL only, so every cache write is priced at the 5m rate). The prefix must be ≥512 tokens to cache. Conversation turns follow. Tool definitions are stable across users, so the cache survives across events for the same tool set.

**Bounded context.**
- History sent to the model is the last 20 messages.
- Each tool output is capped at 4,000 characters.
- The system prompt plus the tools are capped at 6,000 tokens. A unit test measures this with a fixed tokenizer estimate, ×1.5 margin.

These bounds keep every step under 60,000 input tokens. Haiku's 100k price tier is therefore never reached, and D17's reserve is a true upper bound.

### D16. Model choice is configuration plus an evaluation gate
- **Configuration.** `app_settings` gets:
  - `assistant_enabled`;
  - `assistant_model` (default `claude-haiku-5-5`, one model for all turns);
  - `assistant_price_list` jsonb (per model, USD per million tokens: input, cache write 5m, cache read, output). Seeded from the official page (22.10): Haiku 5.5 0.10 / 0.125 / 0.01 / 0.50; Sonnet 5.5 2 / 2.50 / 0.10 / 10.
  - `assistant_usd_ils_rate` (initial 3.70; staff update it in the panel);
  - `assistant_monthly_cap_usd` (initial 150, below the 200 USD monthly API credit);
  - `assistant_daily_questions_per_event` (initial 100).

  All are edited in an admin settings section behind `manage_settings`; none is hard-coded in the code path.
- **The evaluation gate.** An evaluation script runs 40 Hebrew questions with expected tool calls and facts, covering status, guest lookups, timing, Shabbat and refusals.
  - If Haiku 5.5 scores ≥95% (38/40), it stays.
  - Otherwise Sonnet 5.5 is run on the same set. If Sonnet scores ≥95%, `assistant_model` is set to it and the package AI budgets are raised in the admin panel by the price ratio, ×20.
  - If neither scores ≥95%, the assistant stays off and the failing cases are reported.
  - One model serves every turn. Choosing a model per turn would need an intent classifier before the call, which is more code for an unmeasured gain.

### D17. Budget: reserve, settle, never exceed
- **Package and campaign.** `packages.ai_budget_agorot int` (admin package form), copied to `campaigns.ai_budget_agorot` in `create_package_campaign` / `change_campaign_package`, like `contact_quota`.
- **Ledger.** `assistant_usage_ledger`:
  - `id`, `campaign_id`, `conversation_id`, `kind` (`reserve` | `settle` | `release`);
  - `agorot`, `model`;
  - usage counts (input, output, cache_read, cache_write);
  - `created_at`.
- **Reserve** is a SQL function. It locks the campaign row, sums open reservations and settlements, and refuses when `used + reserve > budget`.
  - The reserve is the upper bound of one question: 6 steps × (60,000 input tokens at the uncached input price + 1,024 output tokens). The prices are those of the turn's model, read from settings.
  - No token-counting call is needed, because D15 bounds the context.
- **Settle** replaces the reserve with the actual cost from `onFinish`'s `totalUsage`: input, output, `inputTokenDetails.cacheReadTokens`, `inputTokenDetails.cacheWriteTokens` at the 5m write rate. It is priced per D16. Because the reserve is a true upper bound, a settled cost never exceeds its reserve. **Release** on failure.
- **Monthly cap.** The org-wide cap is checked against the month's settled sum before reserving.
- **Notices.** 80% and 100% notices are written once each (`activity_log` `assistant.budget_80|100`) and shown in the chat.

### D18. Conversations and retention
- **Tables.** `assistant_conversations` (`id`, `event_id`, `user_id`, `created_at`) and `assistant_messages` (`conversation_id`, `role`, `content` jsonb including tool blocks, `incomplete bool`, `created_at`).
- **Access.**
  - RLS: a user selects their own rows; no client insert/update/delete (the server writes with the service role after the gate).
  - Staff read through `view_customer_data`.
- **Purge.** A daily pg-boss job deletes conversations of events whose date is more than 90 days ago.

### D19. Board
- **Page.** `/admin/board` is a Server Component gated by `requirePlatformPermission('view_events')`.
- **Rows.** Built by one server read that derives the stage with the existing `campaignStage` / `packagePaymentOf` model, counts with existing aggregates, next contact with D9, and problems from:
  - failed deliveries and wrong numbers (`contacts.op_status`);
  - open `callback_requests`;
  - `thankyou_state = will_not_send`;
  - overdue tasks.
- **Columns.** Customer-data columns are rendered only when `hasPlatformPermission('view_customer_data')` is true. The table, filters and sorting are client-side over the server-built rows: volume today is 10 events, and server paging is added when rows exceed 200.
- **Tasks.** `event_tasks` (`id`, `event_id`, `title`, `description`, `status` check (`todo`,`in_progress`,`waiting`,`done`), `assignee_user_id` → platform staff, `due_at`, `created_by`, timestamps) and `event_task_notes` (append-only: `task_id`, `author_id`, `body`, `created_at`; no update/delete grant).
- **Task permission.** New platform permission `tasks.manage`. Policies follow the corrected per-operation rule of `staff-tables-permission-rls`:
  - SELECT for `view_events` or `tasks.manage`;
  - INSERT/UPDATE for `tasks.manage`;
  - no DELETE (a task is closed, not deleted).

  The tables are registered in that change's single key map if it has landed; otherwise the same rule is written in their policies and moved into the map when it lands.
- **Live signal.** The D-pattern of `20261022100542`:
  - AFTER triggers on `events`, `campaigns`, `guests` (status only), `outreach_state`, `event_tasks` and `event_task_notes` send `realtime.send('{}', 'board_changed', 'staff-board', true)`;
  - a `realtime.messages` SELECT policy admits topic `staff-board` only when `has_platform_permission('view_events')`;
  - the page calls `router.refresh()`, and on re-join uses Broadcast Replay (`since` = render time), as `permission-changes.ts` does.

### D20. Owner summary
The management page shows a summary card built from `getEventStats` + D9 + `thankyou_state`. It is one stage line, three counters, the next contact, and "needs attention" items. It is the same data the assistant uses, so the two never disagree.

### D21. Decision register (initial values; all editable in the admin panel unless marked fixed)

| Item | Value | Where |
|---|---|---|
| Proposal expiry | 30 minutes | fixed in SQL |
| Package AI budget | ₪10 (1,000 agorot) for every package at go-live | `packages.ai_budget_agorot`, package form |
| Monthly platform cap | 150 USD | `app_settings.assistant_monthly_cap_usd` |
| Daily questions per event | 100 | `app_settings.assistant_daily_questions_per_event` |
| Per-user rate | 10 per minute | existing `rateLimit()`, fixed |
| USD→ILS | 3.70 | `app_settings.assistant_usd_ils_rate` |
| Model | `claude-haiku-5-5`, upgraded only by the D16 gate | `app_settings.assistant_model` |
| Steps per question / output tokens | 6 / 1,024 | fixed in code |
| History window / tool output cap | 20 messages / 4,000 characters | fixed in code |
| Conversation retention | 90 days after the event date | daily job, fixed |
| Budget notices | 80% and 100%, once each, in the chat and in the activity log; no e-mail | fixed |
| API key variable | `KALFA_ANTHROPIC_API_KEY`, passed explicitly; probe `GET /v1/models` | `.env.example` + `ENV_KEY_SPECS` |
| Timing permission | `campaigns.schedule`, "תזמון ושליחה לאורחים"; org owner role only by default | `permission_definitions` |
| Staff task permission | `tasks.manage`, "ניהול משימות אירוע" | `platform_permission_definitions` |
| Board route / gate | `/admin/board` / `view_events`; customer-data columns need `view_customer_data` | fixed |
| Assistant, summary and "החבילה שלך" mount | the event page in `management` mode (D24 `eventMode`, D26) | fixed |
| Activation after payment | system actor, `approved → active` only; pg-boss `package-activation`, 5 deliveries, Slack on the last; orphan sweep re-sends or retries | fixed (D23) |
| Staff campaign page | `/admin/campaigns/[campaignId]`, `manage_billing`; pause/close/cancel/restart with `campaigns.runstate`; restart only from `paused` | fixed (D25) |
| Admission switch for quota campaigns | `RECONCILE_AUTHORIZED_SET_ENABLED` ignored when the campaign has a `contact_quota` | fixed (D24) |
| E2E | `@playwright/test`, git worktree, `env -i` allowlist, local Supabase, providers faked at HTTP | fixed (D27) |
| Part switches | `timing_v2_enabled`, `assistant_enabled`, `package_upgrade_enabled` (all off at deploy), board has no switch (staff-only, read-mostly) | `app_settings` |
| Upgrade validity | 7 days from the offer or approval, never past the event date | `app_settings.package_upgrade_valid_days` |
| Who starts an upgrade | event owner (purchase rule, `requireOwnedEvent`); staff with `manage_billing` | fixed |
| Upgrade price source | the current round's benefit option for the target if one exists, else the target's catalog price at approval | fixed |
| Upgrade targets | explicit paths per package (`package_upgrade_paths`), edited in the package form; not transitive; validity derived at read time | `/admin/packages` form |
| Upgrade benefit | staff only (`manage_billing`), from `/admin/offers` + `/admin/assignments`; one per upgrade, lowest final wins; discount on the difference by the frozen rule; final > 0 | fixed |
| Upgrade AI budget | the new package's `ai_budget_agorot` becomes the campaign budget; usage so far counts within it | fixed |

### D22. Package upgrade after approval or payment (Part D)

**Verified state (22.10.2026; evidence in `$TMPDIR/etab/UPGRADE-VERIFIED.md`).**
- The package lives on the campaign (`template_id` plus a copy of quota, channels and schedule). The price lives in `campaign_pricing` rounds.
- The only package change is `change_campaign_package`, and only in `pending_approval`. `supersede_campaign_pricing` changes the price but never the package, and refuses once money moved. So no path exists after approval.
- The ledger already has the `package_upgrade` kind, with no writer. The CardCom purchase can already save the card "for the planned upgrade charges" (`cardcom-purchase.ts:204-206`).
- `fill_authorized_set` already states that waiting contacts are admitted by an upgrade.
- `campaign_quota_changes` exists, with no writer.
- **Gap.** `deriveStatus` (`src/lib/payments/status.ts:42-60`) reports `pending`/`review` when any operation is in flight. An upgrade charge would make a paid, running service read as unpaid.

**Model.** A new table `campaign_package_changes`, one row per upgrade:
- `id`, `campaign_id`, `event_id`;
- `from_template_id`, `to_template_id`, `from_pricing_round_id`, `to_pricing_round_id`;
- `initiator` (`customer` | `staff`), `initiated_by`;
- `state` (`offered` | `approved` | `applied` | `declined` | `expired` | `cancelled`; `declined` keeps the row retryable until `expires_at`);
- `price_for_customer`, `net_paid_at_approval`, `amount_before_upgrade_benefit`, `upgrade_assignment_id`, `upgrade_discount`, `amount_due`, `benefit_option_id`;
- `tos_version`, `approved_by`, `approved_at`, `expires_at`, `applied_at`, `created_at`.

A partial unique index allows one open row (`offered`, `approved`) per campaign. RLS is on:
- the owner selects their event's rows through `can_access_event(event_id,'campaigns','view')`;
- staff select them through `has_platform_permission('view_billing')`;
- there are no client writes.

`payment_operations` gets a nullable `package_change_id`, with a CHECK that `kind = 'package_upgrade'` is equivalent to `package_change_id is not null`.

**SQL functions (security definer, called by the server after its gate).**
- `offer_package_upgrade(campaign, target, initiator, actor)`:
  - checks every availability and "is an upgrade" rule;
  - computes the price;
  - writes an `offered` row.
- `approve_package_upgrade(change, actor, tos_version)`:
  - locks the campaign and re-checks every rule;
  - recomputes and stores the amount;
  - sets `approved`.
  - With no collected money, it performs the pre-payment switch in the same transaction: a new round superseding the current one, the package fields, consent reset to `pending_approval`. The row becomes `applied` with `amount_due = 0`.
- `apply_package_upgrade(change, operation)`:
  - runs only from the settlement of a succeeded `package_upgrade` operation linked to the row;
  - idempotent on `state = 'applied'`;
  - writes the new locked round, the package fields, a `campaign_quota_changes` row (kind `upgrade`, `payment_ref` = operation id, idempotency key = change id), the AI budget, and `schedule_version + 1`;
  - then calls `fill_authorized_set`.
- `expire_package_upgrades()`: run by a pg-boss cron.

**Target packages come from the catalogue, not from code.** The same server read that offers packages for purchase decides which packages may be upgrade targets: `listPackageOffers` / `getPackageOffer` (`src/lib/data/package-offers.ts:37-70`). It requires:
- the package switch on;
- an active package;
- `contact_quota ≥ 1`;
- a price > 0.

Staff therefore control the targets from `/admin/packages`, by active, quota, channels and price, with no separate list. The browser sends only the target id, and price, quota, channels and schedule are read on the server, as `createCampaign` does.
- At payment start the target is re-read. A target that is no longer offered cancels the upgrade (`cancelled`, reason `target_withdrawn`) and releases a held upgrade benefit.
- The upgrade copies the target's catalogue schedule and AI budget at apply time, as `create_package_campaign` copies them at purchase.

**Upgrade paths (owner decision 22.10: "מסלולי שדרוג בטופס החבילה").** Verified live: packages have no type. `tier` and `category` are free text shown only in `/admin/packages/page.tsx:49-52`, and nothing reads them in logic. So the label is derived, never stored.

*Data:*
- A new table `package_upgrade_paths(from_package_id, to_package_id, sort_order, created_by, created_at)`:
  - primary key `(from_package_id, to_package_id)`;
  - CHECK `from_package_id <> to_package_id`;
  - both FKs `ON DELETE CASCADE`, because a path is configuration. A package that campaigns or upgrades reference cannot be deleted anyway.
- RLS is on:
  - select for `has_platform_permission('manage_billing')`, the key `PLATFORM_ACTIONS.Package.read` maps to;
  - no client insert/update/delete. It does not copy the live `packages_admin_all` policy, which admits any staff.
- Writes go only through `set_package_upgrade_paths(_package_id, _targets uuid[])`, security definer. It:
  - checks `manage_billing`;
  - checks the upgrade rule for every target (quota ≥, channels ⊇, higher `price_with_vat`), refusing with the failing target and reason;
  - replaces the set in one transaction, unlike the offers delete-then-insert;
  - writes `package.upgrade_paths_changed` to the activity log.

*Rule:*
- There is no transitivity: only listed pairs.
- A cycle cannot be saved, because every hop must raise the price.

*Validity is derived at read time.* One function, `upgradeTargetsFor(packageId)` in `src/lib/data/package-offers.ts`, returns the path targets that are in `listPackageOffers()` and pass the rule now. The same function is used:
- by the owner's upgrade list;
- by the staff offer screen;
- by `offer_package_upgrade` in SQL, through the same table and rule, which closes the race between the list and the offer.

The admin list calls `upgradePathsReport()`, which returns every stored path with `valid` and a reason code: `quota_lower`, `channel_missing`, `price_not_higher`, `target_not_offered`.

*Form (`package-form.tsx`, CASL pilot folder):*
- an "אפשר לשדרג ל" section: checkbox rows of the other packages, sent as one hidden `upgrade_targets_json` field, parsed like `outreach_schedule_json` (malformed → `[]`);
- saved by the update action after the package fields;
- per-target refusals map to `fieldErrors.upgrade_targets.<id>`;
- gates stay CASL (`requireAnyPlatformAction(PACKAGE_FORM_ACTIONS)`), with no quoted key.

*Display:*
- **Owner:** an "upgrade package" section on the service page lists `upgradeTargetsFor(current)`, each labelled "שדרוג" with this owner's amount due (D22 price, including any upgrade benefit).
- **Staff:** the offer screen shows the same list.
- **Admin:** the package list shows "אפשר לשדרג ל: …" and "שדרוג מ: …" badges, and invalid paths with their reason.
- **New purchase:** the catalogue offer for a new purchase is unchanged. A target package is a regular package there.

**Package admin (`/admin/packages`, the CASL pilot folder).**
- `campaign_package_changes.from_template_id` / `to_template_id` reference `packages` with RESTRICT, like `campaigns.template_id`. `deletePackage` (`src/lib/data/admin/packages.ts:343-357`) maps 23503 to "a campaign references it". Its message changes to "a campaign or a package upgrade references it", so the admin sees why.
- The Part B AI budget field in `package-form.tsx` follows the folder rules:
  - the field goes into `operationalFieldsSchema`;
  - the gates stay `requirePlatformAction` / `requireAnyPlatformAction(PACKAGE_FORM_ACTIONS)`;
  - no permission key is quoted in the folder;
  - `src/lib/casl-pilot-static.test.ts` must pass.

**Price.** `price_for_customer` is the frozen `coupon_assignment_options.final_price` of the benefit on the current round for the target package, else the target's `price_with_vat`. `amount_due = price_for_customer − (collected − returned not failed)`, computed with `ledgerMoney`'s rule in SQL. It must be > 0. Why the benefit decides by its options: staff already decide per package which packages a benefit covers and for how much (`coupon_assignment_options`). Carrying a discount to a package the benefit does not cover would grant a discount nobody configured.

**Payment.** The same CardCom purchase path with `kind = 'package_upgrade'`, the stored `amount_due` and the linked row:
- one pending row per campaign+kind, which is the existing index;
- the saved card is offered when one was stored, otherwise the card form;
- the receipt line is "שדרוג חבילה: <from> → <to>";
- the operation's `pricing_round_id` is the round that is current when the charge begins. The live trigger `payment_operations_consume_benefit` consumes the benefit of that round only while it is still `bound` to this campaign. After the original purchase it is already `consumed`, so an upgrade charge never consumes or re-binds a benefit.

**Benefits stay frozen.** The upgrade only reads `coupon_assignment_options`, the per-package terms frozen when the benefit was assigned (personal-coupons D3; `src/app/(admin)/admin/offers/AGENTS.md`). It never writes `coupon_assignments`, `coupon_assignment_options`, `offers` or `offer_packages`. The new round keeps the same `coupon_assignment_id` when the option for the target is used, so the history shows which benefit priced it.

**Upgrade benefits (owner decision 22.10).** These reuse the existing offers and assignments, with a purpose.

*Verified live (22.10.2026):*
- `offers` has `kind` (percent | amount), `value`, `validity_days`, `allow_agent` and `allow_staff`, plus `offer_packages(package_id, value_override)`.
- `coupon_assignments` freezes `kind` and `value`, and has states assigned | bound | consumed | void and `bound_campaign_id`.
- `coupon_assignment_options` holds per-package list, discount and final, with `final_price > 0` and the price math.
- The consume trigger `payment_operations_consume_benefit` runs AFTER UPDATE OF outcome to `succeeded`. It consumes only the assignment of the operation's pricing round, so it never consumes an upgrade benefit (owner's point, confirmed).
- `void_staff_coupon_assignment` already refuses with `held_by_payment`, `held_by_review` and `held_by_approved_terms`.

*Schema:*
- `offers.purpose`: `purchase` | `upgrade`, default `purchase`. A CHECK requires an upgrade offer to have `allow_agent = false` and `may_replace = false`, because the sales agent sells purchases only.
- `coupon_assignments.purpose`, copied from the offer and frozen by the existing `coupon_assignments_freeze` trigger, which is extended to the column.
- `coupon_assignments.for_campaign_id`: required exactly when `purpose = 'upgrade'`.
- The options of an upgrade assignment are the listed target packages. At assignment, `list_price` holds the difference the staff preview showed, the discount comes from the frozen rule, and the final is the result.

*Price.* At approval:
- The frozen rule (the kind, with the option's value or the offer value) is applied to the current `amount_before_upgrade_benefit`, using `computeOfferOption` in TS and the same arithmetic in SQL.
- The result must stay > 0. Otherwise the benefit is skipped with the reason shown to the owner.
- When several upgrade benefits apply, the lowest final wins, as in the existing D18.
- The rule is frozen and the amount follows the current difference, because the difference moves with catalog prices and refunds. Freezing a stale amount would either overcharge or refuse.

*Hold, use and release:*
- At approval, `approve_package_upgrade` binds the upgrade assignment: `state = 'bound'`, `bound_campaign_id` = the campaign, `upgrade_assignment_id` set on the change row.
- `payment_operations_consume_benefit` gets a second branch. For `kind = 'package_upgrade'`, it consumes the change row's `upgrade_assignment_id`, only while it is `bound` to this campaign. It writes `coupon_assignment_events` `consumed`, with reason `upgrade payment succeeded` and the operation id.
- `expire_package_upgrades` and the cancel path release the assignment to `assigned` through the existing release rule; an expired benefit goes to `void`.
- A decline keeps it bound for the retry.

*Purchase-only readers exclude `purpose = 'upgrade'`.* These are every live reader of `coupon_assignments` that prices or binds a purchase:
- `src/lib/data/coupon-benefits.ts` (eligible list, `bindBestBenefit`, banners);
- `src/lib/data/agent-benefits.ts`;
- the SQL functions `bind_coupon_assignment`, `change_campaign_package`, `supersede_campaign_pricing`, `replace_sales_coupon_assignment`, `release_coupon_assignment` and `payment_operations_open_guard`.

*Void.* A new refusal `held_by_upgrade` applies while an approved upgrade holds the assignment. It is added in step to `VoidRefusal` in the DAL, `VOID_REFUSALS` and `BLOCK_REASON_TEXT`, per `src/app/(admin)/admin/assignments/AGENTS.md`.

*Screens:*
- `/admin/offers` gets a purpose choice. An upgrade offer hides the agent fields. The floor rule (`assertPositiveFloors`) is checked against the cheapest difference the preview can show, and is enforced again at approval.
- `/admin/assignments/new` shows, for an upgrade offer, a third step: choose the account's event service, then preview per target package the current difference, the discount and the final. The echoed `confirmed_terms` contract and the idempotency key stay as they are.
- The list and the detail label the purpose.

**Payment state.** `deriveStatus` is changed so that an in-flight `package_upgrade` does not override the settled state. It returns a separate `upgradeInFlight: 'pending' | 'review' | null`. The stage, the activation and the assistant mount keep reading `status`; the payment page and staff screens show `upgradeInFlight`. The existing test "an upgrade in flight beats the settled state" is replaced by the opposite assertion.

**Schedule.** On apply, the effective schedule (D2) is rebuilt over the new package snapshot:
- overrides keyed on steps that exist in the new snapshot are kept, the others are closed with reason `package_upgrade`;
- the planner re-plans with the bumped `schedule_version`;
- sent and claimed steps are never re-sent, because of the claims and the `contact_interactions` history;
- a new step whose planned instant is already past is recorded as `outreach.step_skipped` with reason `added_after_due`.

**Audit.** `logActivity` writes `campaign.upgrade_offered|approved|applied|declined|expired|cancelled`, with change id, initiator and amounts, and no card or personal data.

**Alternatives rejected.**
- Extending `supersede_campaign_pricing` with an upgrade reason: it supersedes the round before payment, so the new price would be "current" while the old package still runs.
- Reusing `events.package_id`: it is not the purchase record. It was locked on 22.10 and is not read by anything.

### D23. Package activation after a server-recorded payment, through pg-boss (Part E)

**Verified 22.10 (code, a local integration test, production read-only):**
- CardCom reports a payment twice: the buyer's browser calls `POST /api/campaigns/[id]/purchase/settle`, and CardCom calls `POST /api/cardcom/webhook`. Both call `settleCardcomSession`. Only the browser route activates (`purchase/settle/route.ts:94-95`). The webhook's success path ends in `afterPaid` (`cardcom-settle.ts:510-525`), which writes an activity row and re-checks the tax ceiling, nothing more. The SUMIT purchase route activates inline in the buyer's request (`purchase/route.ts:119`).
- `src/lib/payments/cardcom-webhook-activation.local-it.test.ts` runs the real routes against local Supabase with only CardCom's answer replaced. Browser alone → active. Webhook then browser → active. Webhook alone → payment `succeeded`, campaign stays `approved` (declared `it.fails`, a known gap).
- The same test shows that calling today's activation from the webhook is not a fix: `activateCampaign` with the default `owner` actor goes through `requireOwnedEvent` → `requireUser` and redirects to `/auth/login` without a session (`campaigns.ts:561-564`). In the worker the same call throws on purpose (`worker/empty.js`).
- `logActivity` also needs a session (`activity.ts:35`). Its failure is logged with `console.error` and not alerted (`campaigns.ts:679-683`).
- `activateCampaign` accepts `approved`, `scheduled` and `paused` (`campaigns.ts:633-634`). A delayed retry could therefore restart a service that staff paused.
- Production: 4 real package payments (8–18.10) were all activated within a minute by the browser path. No case of a webhook-only payment has happened yet.

**Decision.**
- **One system activation function,** `activatePaidPackage(campaignId)` in `src/lib/payments/activate-paid-package.ts`, request-free (admin client only):
  1. calls `transitionCampaignStatus(campaignId, ['approved'], 'active', 'package', { rejectPastEvent: true, requireActiveEvent: true, preparePackage: requirePackageFunding }, { kind: 'system' })`. The `approved`-only `from` set is part of the guarded UPDATE (`campaigns.ts:587-591`), so a status changed by staff in the meantime is never overwritten, and a paused service is never restarted;
  2. a new actor kind `system` in `CampaignActor`: the event is read with the service-role client and the same event guards run, exactly like the existing `console` branch (`campaigns.ts:565-577`). No ownership check: the authority is the payment recorded on the server, and `requirePackageFunding` re-reads it from the ledger;
  3. **completion, safe to repeat:** when the campaign is `active` (just now, or already), it seeds `thankyou_send_at` only if it is null (today's guard, `campaigns.ts:691-699`), and writes the `campaign.activated` activity row through a direct admin insert (as `cardcom-settle.ts:512` does) only if no such row exists for the campaign. A crash between the status write and the completion is repaired by the next delivery;
  4. returns `started`, `already_active`, `not_applicable` (status is neither `approved` nor `active`) or throws (ledger unreadable, event guards). The `owner` path of `activateCampaign` stays for the owner's own restart of a paused service.
- **Queue.** `QUEUES.packageActivation = 'package-activation'`, payload `{ campaignId, operationId }` (ids only). Job id `deterministicJobId('package-activation:' + operationId)`. Retry policy `PACKAGE_ACTIVATION_RETRY = { retryLimit: 4, retryBackoff: true, retryDelayMax: 300 }`. `retryLimit` counts retries after the first delivery (`pg-boss/dist/plans.js:2560, 3025`), so this is 5 deliveries in total. No `deadLetter` (`QUEUES.dead` expects an outreach step, `queues.ts:316-317`).
- **Enqueue points.** The job is sent right after the payment is recorded as `succeeded`, through `getWebJobSender()`:
  - `afterPaid` in `cardcom-settle.ts`, so the browser call and the webhook both enqueue. `alreadyDone` settlements do not reach `afterPaid`, so a repeated webhook sends nothing;
  - the SUMIT purchase route after its success.

  A failure to enqueue is logged and caught by the sweep below. It never affects the recorded payment.
- **Browser paths.** The browser settle route and the SUMIT route call `activatePaidPackage` inline as well, so a buyer who stays sees a running service at once. The job and the inline call are the same idempotent function; whichever runs second answers `already_active`.
- **Worker.** `boss.work(QUEUES.packageActivation, { includeMetadata: true }, …)` calls `activatePaidPackage`. Slack only on the final delivery (`isFinalDelivery`, `queues.ts:407-409`), not through `guardedWorker`'s per-failure alert (`worker/main.ts:393-411`).
- **Safety net.** `runPaymentOrphanSweep` (every 10 minutes, `worker/main.ts:1648-1650, 1743`) today reads only `pending` rows (`payment-orphans.ts:86`). It gains a second pass: campaigns in `approved` whose ledger shows `collected` for more than 10 minutes. For each, it sends the job with the same id. If pg-boss already holds that id in state `failed`, it calls `boss.retry(QUEUES.packageActivation, id)` (`pg-boss/dist/index.d.ts:58`) and alerts once per campaign per day. No other repair path exists.
- **Customer UI.** `ActivateNowForm` and the setup `live` step's "הפעלת הקמפיין עכשיו" (`package-payment-view.tsx:84-92`, `setup/page.tsx:295-304`) are removed. A paid campaign that is not yet active shows "השירות מופעל" to the owner and the stage `awaiting_activation` to staff only (D24).

**Alternatives.**
- Inngest. Rejected: not installed, adds an external service and a second job system next to pg-boss, which already provides retries, deterministic ids and the worker.
- `after()` in the webhook route (Next docs, `after.md`). Rejected: the work still has no session, and nothing retries it after a crash.
- Calling the owner activation from the webhook. Rejected: proven to fail (test case D).

### D24. Setup and management, merged from `separate-event-setup-from-management` (Part F)

The separate change was re-verified item by item on 22.10 (`R6-separate-verify.md`; I re-checked the load-bearing facts in code and in the production catalog). It had 0 of 35 tasks done. Its intent is adopted here with these corrections. It is not edited; it is archived only with the owner's approval (task 30.3).

- **Mode.** `eventMode(stage, viewer)` in `src/lib/data/setup-steps.ts` replaces `POST_ACTIVATION_STAGES` (`setup-steps.ts:129`, used at `setup/page.tsx:141`, `setup-steps.tsx:48`). Stages are `not_set, awaiting_terms, awaiting_payment, awaiting_activation, active, paused, closed, cancelled` (`event-labels.ts:99-107`; the separate change's `awaiting_signature` no longer exists).

  | Stage | Mode (owner) |
  |---|---|
  | `not_set`, `awaiting_terms`, `awaiting_payment` | `setup` |
  | `awaiting_activation`, `active`, `paused`, `closed` | `management` |
  | `cancelled` | not reached: `getCampaignForEvent` skips cancelled rows (`campaigns.ts:334`), so a reset event reads `not_set` |
  | ledger unreadable | `unavailable`: a notice in place, no redirect |

  A non-owner with `campaigns.view` gets `readonly_setup` instead of `setup`; a viewer without it keeps the permission-limited card.
- **One "paid" predicate.** The assistant (Part B), the summary card (13.1), routing and "החבילה שלך" all use `eventMode`. The D21 row "`packagePaymentOf` reports `collected`" is replaced. Reason: `deriveStatus` lets any in-flight row win over `collected` (`status.ts:41-47`), so a pending refund or upgrade charge would hide the assistant of a running service. `campaignStage` ignores the ledger once the campaign is `active`/`paused`/`closed` (`event-labels.ts:153-161`). For `approved`/`scheduled` it reads `isFunded` (`event-labels.ts:140-142`, `payment.status === 'collected'`), which an in-flight row turns false. Decision: for the mode, a campaign is funded when its settled history collected the package price and no succeeded return brought it below it, whatever is in flight (task 22.1). A pending refund or upgrade charge therefore never sends a paid owner back to setup, independently of D22's `upgradeInFlight` (15.1), which remains for the payment screens.
- **Routing** (separate change D2, line references updated):
  - `/app/events/[id]`: owner in `setup` → `/setup`; `readonly_setup` → read-only "בהקמה" card; `management` → the management page (D26) without `SetupSteps`;
  - `/setup` and the payment page: `management` → the event page;
  - the results page `campaign/[campaignId]` and the guests and statistics pages: owner in `setup` → `/setup`;
  - after payment: the SUMIT route (`purchase/route.ts:113-121`), the CardCom form (`cardcom-open-fields-form.tsx:189, 207, 279`) and the CardCom settle route land on the event page. "מעבר לניהול הקמפיין" (`package-payment-view.tsx:102`) is removed;
  - `/app`, login and verify are unchanged (`app/page.tsx:33-39`).
- **Setup shell and flat content.** Separate change D3, without `AgreementStep` (deleted with pay-per-result, `23bf19b3`). The shell hosts today's extra content: the benefit banner in the pay step (`setup/page.tsx:112-126, 278-291`), the package re-choice while `pending_approval` (`setup/page.tsx:66-77`), CardCom Open Fields and Google Pay.
- **Package change before payment lives in setup.** D22's "upgrade before any payment" (an `approved`, unpaid campaign) is offered in the setup pay step, next to the existing `pending_approval` re-choice. The management page offers only the post-payment upgrade. Reason: an owner in `setup` never reaches the management page.
- **Purchase starts the service:** D23. No customer "activation" concept.
- **Close during setup.** Separate change D5 and D7 (`close_event_retiring_setup(p_event, p_owner)`, invoker, `search_path ''`, service_role only, owner checked in the body, explicit `succeeded` check so test money is not reset by a close). Verified live: no such function, `cancel_campaign` is service_role only, `event.closed` rows have never been written by the owner path (production: only `closed_by_admin` 2, `closed_by_settlement` 2). Added for Part D: the close is blocked while a `campaign_package_changes` row is `approved` or its payment is pending or in review, and an `offered` row is cancelled and its held upgrade benefit released in the same transaction.
- **Admission safety nets.** Separate change D9 (a)–(d), with two decisions taken:
  - `RECONCILE_AUTHORIZED_SET_ENABLED` does not gate anything for a campaign with a `contact_quota`, at add time included. Production: every approved/active campaign has a quota. The switch remains for campaigns without one;
  - a guest admitted late gets the steps still ahead of the event, as the engine does today (`ensureCurrentStep` starts at the current step). Task 22.4 records it; no change.

  One migration owns the shared admission function. `reconcile_authorized_set`, `fill_authorized_set` and D22's `apply_package_upgrade` all call it, and that migration precedes Part D's. The replacement keeps the live same-contact `repoint` no-op (verified in the live definition).
- **Vocabulary.** Separate change D8. The scan test (task 25.3) lands before any new customer UI of Parts A, B and D, so new strings cannot re-introduce "קמפיין". The payment title is already 'תשלום החבילה' (`payment/page.tsx:21`).

### D25. A staff campaign page, without duplicated logic (Part G)

**Verified (R7, checked 22.10):** staff run the customer page `campaign/[campaignId]` inside the customer chrome, gated by `manage_billing` (`page.tsx:60, 212`). Consequences in production code today:
- a billing clerk sees pause, close and cancel, which need `campaigns.runstate` and redirect to `/access-denied`;
- `getCampaignForAdminView` returns no price (`admin/campaigns.ts:139-155`), so a paid campaign reads as unpaid for staff;
- staff see owner buttons (gift, event-day and thank-you sends) that answer `notFound()`;
- the payments audience is decided per viewer, not per route.

**Decision** (R7 §5, adopted):
- **Route:** `/admin/campaigns/[campaignId]`, inside `AdminShell`.
  - Page gate `requirePlatformPermission('manage_billing')`, the same as the list. The real gate stays in the audited admin readers.
  - Pause, close and cancel render only for `hasPlatformPermission('campaigns.runstate')`.
- **Shared, moved not copied:** `src/components/campaign-board/*` (status card, delivery breakdown, failure notice, action button, thank-you form) and the pure `src/lib/campaigns/board-state.ts` (moved from `manage-client.tsx:843-872`). One `withCurrentPrice` in `campaigns.ts`, used by `getCampaign` and `getCampaignForAdminView`. One `readPanel` helper.
- **Actions:** staff actions move to `src/app/(admin)/admin/campaigns/[campaignId]/actions.ts`. Each is a thin wrapper over the same gated data function, and `eventId` is derived on the server. `updateThankyouSchedule` stays one data function with its identity fork; the customer and staff actions both call one parsing helper.
- **Payments:** the audience is chosen by route. `customerCampaignPaymentsView` for the customer page; `getCampaignPaymentsForAdminView` (audited) for the staff page and for `/admin/cancellations/[id]`.
- **Links:** the five staff link sources (R7 §1) point to the new route. For one release, the customer page redirects a staff viewer who cannot access the event to the staff page. The redirect reads no customer data.
- **Staff restart of a paused service:** added. It goes through `activateCampaign` with a new `staff` actor narrowed to `from: ['paused']`, with the event guards on, gated by `campaigns.runstate`. This is the console's narrowing (`campaigns.ts:633-634`) for the web. `approved → active` is never a staff action; that is D23's system path.
- **`ops_engineer`** (holds `campaigns.runstate`, not `manage_billing`) does not get the page. Every board reader is audited under `manage_billing`, and a second reader set would duplicate them. Run-state operations stay available through the console API (`/api/campaigns/[id]/status`).
- No new table, no second write path: both pages read the same tables and write through the same data functions.

### D26. The owner's management page (Parts B, D and F together)

The event page in `management` mode is the owner's home. `/app` and login already land there (`app/page.tsx:38`). It hosts, top to bottom:
1. the summary card (D20, task 13.1);
2. **"החבילה שלך"**: package name, contact quota "X מתוך Y" (`countAuthorizedContacts`, as `CampaignStatusCard` shows it today, `manage-client.tsx:252-299`), channels, and the post-payment upgrade entry (D22) when `package_upgrade_enabled` is on and `upgradeTargetsFor` is not empty;
3. the assistant (Part B);
4. a link to the results page (`campaign/[campaignId]`), which stays the detailed delivery and results screen.

Upgrade approval and payment are a sub-route that reuses the payment components (`…/campaign/[campaignId]/upgrade`). "The event's service page" in the package-upgrade spec means this page. Nothing exists today: "החבילה שלך" has 0 occurrences in `src`, `docs` and `openspec` (verified 22.10).

### D27. End-to-end verification

**Verified 22.10:** the repository has no E2E suite. `playwright` 1.64.1 and Chromium are installed. `@playwright/test` is not. Next recommends testing against a production build (`docs/01-app/02-guides/testing/playwright.md`).

Environment files, from `docs/01-app/02-guides/environment-variables.md` and `@next/env`'s `loadEnvConfig`:
- Next looks a variable up in this order and stops at the first hit: `process.env`, `.env.$(NODE_ENV).local`, `.env.local`, `.env.$(NODE_ENV)`, `.env`.
- With `NODE_ENV=test`, `.env.local` is not read, nor `.env.development` / `.env.production`. `.env.test.local`, `.env.test` and `.env` are.
- `NEXT_PUBLIC_*` values are inlined into the browser bundle at `next build`. Here that is `NEXT_PUBLIC_SUPABASE_URL` (also read by `next.config.ts:27` for image hosts), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GA_ID`. A build made for one environment cannot be reused for another.
- `PORT` cannot come from a `.env` file (`docs/01-app/03-api-reference/06-cli/next.md`).

In this repository: the files present are `.env.example` (tracked, read by nobody), `.env.local` (production credentials) and `.env.pgboss-dashboard`. `.gitignore` ignores `.env*` except `.env.example` (`git check-ignore` confirms `.env`, `.env.test`, `.env.test.local`). Two non-Next loaders read `.env.local`: `worker/start.mjs:34` (fixed to the repo root) and `worker/main.ts:139-149` (relative to the working directory, `process.cwd()`); neither overwrites a variable that is already set.

**Decision.**
- **Runner:** `@playwright/test` as a devDependency (owner approval to install, task 1.4). Specs in `e2e/`. One runner script, `scripts/e2e/run-local.sh`.
- **Isolation, structural, not by convention:**
  1. **A dedicated git worktree.** E2E builds and runs in `$TMPDIR/kalfa-e2e` (`git worktree add`). `.env.local` is untracked, so it does not exist there; neither Next nor `worker/start.mjs` can load it.
  2. **Next's own test environment.** The script writes `.env.test.local` into the worktree (ignored by `.env*`) from `supabase status -o env` plus fixed test values, and runs `next build` and `next start -p 3999` with `NODE_ENV=test`. Next then reads only `.env.test.local` and `.env.test`; there is no `.env`. Every process is also started with `env -i` and a short allowlist (`PATH`, `HOME`, `NODE_ENV`), because `process.env` outranks every file.
  3. **A dedicated build.** The E2E build carries the local Supabase URL and key in its browser bundle, so it is built in the worktree into `.next-e2e` and is never served outside it; the production `.next` is never used for E2E. `NEXT_PUBLIC_GA_ID` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` are left unset, so no analytics or maps request leaves the machine.
  4. **Preflight guard.** The script exits before starting anything unless: `API_URL` is `http://127.0.0.1:54321`; the DB is `127.0.0.1:54322`; `OUTREACH_DB_IT=1`; `docker inspect supabase_db_beta` reports project `beta`; and every provider base URL in the allowlist is loopback.
  5. **Processes:** `next build` (dist dir `.next-e2e`) + `next start -p 3999`, and the worker as `node dist/worker.cjs` with the worktree as its working directory, never `worker/start.mjs`. `worker/main.ts:140` then finds no `.env.local`; the worker reads its values from the same `.env.test.local` exported into its allowlist by the script.
- **Providers are local fakes at their HTTP boundary.** One Node server in `e2e/fakes/` stands in for:
  - CardCom: LowProfile create/GetLpResult/webhook sender, and an Open Fields page that posts the same window messages;
  - Meta WhatsApp Cloud API: send, plus status webhooks back to the app;
  - Voximplant: StartScenarios and the call result callback;
  - Anthropic Messages: scripted replies, for Part B;
  - Slack: a recorder.

  E-mail uses local Supabase's mail catcher. The app reaches a fake through one origin override per provider, read in a single place per provider (the CardCom `mutator.ts` and `OPEN_FIELDS_ORIGIN`, the WhatsApp client, the Voximplant client, the Anthropic provider's `baseURL`, the Slack sender). The override is accepted only when its value is a loopback URL; otherwise the code throws at startup. Production never sets these variables, and a unit test pins that `.env.example` does not define them.
- **Classification.** A test is called E2E only if it drives a browser through the app's real routes, the worker and the local database for a whole business flow. The providers are the only fakes. Every report states this boundary. The real-provider leg (CardCom test terminal, a real WhatsApp send) is an owner-run pass after deploy (task 30.2), never automated.
- **Coverage rule.** Every part has an E2E group that maps each customer- or staff-visible spec scenario to a spec file, or records why the scenario is covered below E2E (pure function, SQL-only). Task 30.1 checks the map is complete.
- **Data hygiene.** Each spec creates its own users and events through the app or the fixture API (`FixtureScope`) and deletes them in `afterAll`. The run fails if the table fingerprint differs after the run (the integration runner's existing check).

## Risks / Trade-offs

- **[Planner change re-plans every live contact once]** → `SEND_TIMING_ALGORITHM_VERSION` bump is the intended mechanism. It ships with a dry-run report: for every active contact, old planned time vs new. Staff approve it before deploy.
- **[Hebrew quality of Haiku 5.5 is not documented]** → the D16 evaluation gate. The assistant is off by default until it passes.
- **[The reserve is a deliberately high upper bound and may block a reply that would have fit near the end of a budget]** → For Haiku, one reserve is about 0.039 USD (6 × (60,000 × 0.10 + 1,024 × 0.50) / 1M), about ₪0.14. Against the initial ₪10 budget (D21), a reserve blocks at most the last ₪0.14. The customer message is explicit and points to the upgrade.
- **[The context bound (D15) is an estimate until measured]** → a test fixes the bound. Settle also asserts `settled ≤ reserved`; a breach logs `assistant.reserve_breach` and alerts Slack, so the bound is corrected from evidence.
- **[Prompt injection through guest names or messages]** → tools return names only on request, tool output is data blocks, the model holds no write power (D3), and the scope rule is in the system prompt and in the tools (event bound server-side).
- **[Board live triggers add work to hot tables (`outreach_state`)]** → the empty broadcast is one `realtime.send` per row change, and `realtime.send` swallows errors (verified in the permission-signal migration). If load becomes an issue, debounce with a statement-level trigger.
- **[Dropping `next_run_at` breaks an unknown reader]** → grep shows readers only in console views. The views keep the column name; the drop is a separate later migration in this change, after the views switched.
- **[`staff-tables-permission-rls` is pending (7/29)]** → Part A does not depend on it. Part C's key-map registration is a task with an explicit fallback. `separate-event-setup-from-management` is merged here as Part F (D24).
- **[A webhook-only payment stays unstarted until the fix ships]** → verified possible in code and by test case A (D23); not observed in production. Part E is first in the execution order.
- **[The activation job and the browser both activate]** → one idempotent function with an `approved`-only guarded UPDATE and a completion that checks before it writes (D23).
- **[Fakes drift from the real providers]** → each fake is built from the provider's typed client already in the repo (CardCom's generated types, the WhatsApp payload types), and the owner-run pass after deploy (task 30.2) covers the real leg.
- **[Routing redirects could loop]** → `unavailable` mode never redirects (D24), with a test per route where the ledger read fails.
- **[An upgrade charge in flight makes a running service read as unpaid]** (verified in `deriveStatus`) → D22 separates `upgradeInFlight` from `status`, with a test that a pending upgrade leaves `status = 'collected'` and the stage unchanged.
- **[A charge succeeds but the apply fails]** → the apply runs in the settlement transaction where possible. A settled `package_upgrade` operation whose change is not `applied` is a review item: the existing orphan sweeper lists it, and a re-run of `apply_package_upgrade` is idempotent. The money is never lost and never applied twice.
- **[The customer loses a discount the benefit does not cover]** → the approval screen states it before payment (spec scenario), and the amount is fixed at approval.
- **[An upgrade with a schedule change re-plans live contacts]** → the same planner path and `schedule_version` as a Part A schedule change, covered by the same re-plan tests.

## Migration Plan

**Order.** Each step is a separate migration created with `supabase migration new`, applied locally, tested, then pushed to `main` only after a separate deploy approval. A push to `main` applies migrations to production.

0. Part E (D23): no migration. App + worker together, first, because every later part assumes paid ⇒ running.
0a. Part F (D24): the shared admission function replacing `reconcile_authorized_set` and used by `fill_authorized_set`; then `close_event_retiring_setup`. Then the F app. Before Part D's migration.

1. A1 schema: initiator columns, overrides, `schedule_version`, proposals, `thankyou_state`, `claim_manual_send`, permission row + seeds, outreach_schedule shape check, console views read `planned_at`.
2. App + worker for Part A behind `timing_v2_enabled` (app_settings). Off means today's behaviour, except D11 (route removal), which is unconditional.
3. Planner version bump (D4), with the dry-run report approved first.
4. B schema: budget columns, ledger, conversations, assistant settings. Then the B app behind `assistant_enabled`, which is off until the D16 evaluation passes.
5. C schema: tasks, notes, `tasks.manage`, board signal. Then the C app.
6. D schema (after A, because the upgrade re-plans through D2's schedule layer, and after F, because `apply_package_upgrade` calls F's shared admission function): `campaign_package_changes`, `payment_operations.package_change_id`, the four functions, `package_upgrade_valid_days`. Then the D app behind `package_upgrade_enabled`.
7. Part G (D25): no migration. The app only.
8. Drop `next_run_at` (last).

**Rollback.**
- Each switch off restores the previous behaviour for its part.
- Schema additions are additive and stay.
- Restoring the removed route is a revert commit.
- Parts E, F and G have no switch. Their rollback is a revert commit. For F, also `drop function public.close_event_retiring_setup(uuid, uuid)` and re-create the previous `reconcile_authorized_set` and `fill_authorized_set` from the rollback section of their migration (the shared admission function is dropped last). Records written by closes and admissions stay as history.

## Open Questions

None. The owner decided on 22.10: who may change timing, how much may change, what the board contains, one combined change, and the upgrade behaviour (customer or staff may start it, the customer approves, only the difference is paid, effect only after payment, failure keeps the current package; downgrades and refunds excluded). The benefit rule, validity period and permissions of D22 are decided in D21. The remaining unknowns (Hebrew quality, real tokens per question) are measured by tasks, not assumed.

Added 22.10, decided here: activation through pg-boss with a system actor (D23); the separate change's open questions (the admission switch is ignored for quota campaigns; a late guest keeps today's engine behaviour) (D24); `ops_engineer` uses the console API and does not get the staff campaign page, and staff may restart only a paused service (D25); the E2E boundary (D27). Hebrew wording of new labels is drafted during implementation and shown in the diff; it does not change the specs.
