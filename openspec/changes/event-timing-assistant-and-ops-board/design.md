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
| Assistant mount until `separate-event-setup-from-management` lands | today's event page, shown only when `packagePaymentOf` reports `collected` (`src/lib/payments/package-paid.ts:20`) | fixed; moves with that change |
| Part switches | `timing_v2_enabled`, `assistant_enabled` (both off at deploy), board has no switch (staff-only, read-mostly) | `app_settings` |

## Risks / Trade-offs

- **[Planner change re-plans every live contact once]** → `SEND_TIMING_ALGORITHM_VERSION` bump is the intended mechanism. It ships with a dry-run report: for every active contact, old planned time vs new. Staff approve it before deploy.
- **[Hebrew quality of Haiku 5.5 is not documented]** → the D16 evaluation gate. The assistant is off by default until it passes.
- **[The reserve is a deliberately high upper bound and may block a reply that would have fit near the end of a budget]** → For Haiku, one reserve is about 0.039 USD (6 × (60,000 × 0.10 + 1,024 × 0.50) / 1M), about ₪0.14. Against the initial ₪10 budget (D21), a reserve blocks at most the last ₪0.14. The customer message is explicit and points to the upgrade.
- **[The context bound (D15) is an estimate until measured]** → a test fixes the bound. Settle also asserts `settled ≤ reserved`; a breach logs `assistant.reserve_breach` and alerts Slack, so the bound is corrected from evidence.
- **[Prompt injection through guest names or messages]** → tools return names only on request, tool output is data blocks, the model holds no write power (D3), and the scope rule is in the system prompt and in the tools (event bound server-side).
- **[Board live triggers add work to hot tables (`outreach_state`)]** → the empty broadcast is one `realtime.send` per row change, and `realtime.send` swallows errors (verified in the permission-signal migration). If load becomes an issue, debounce with a statement-level trigger.
- **[Dropping `next_run_at` breaks an unknown reader]** → grep shows readers only in console views. The views keep the column name; the drop is a separate later migration in this change, after the views switched.
- **[Two dependent changes are pending]** (`separate-event-setup-from-management` 0/35, `staff-tables-permission-rls` 7/29) → Part A does not depend on them. Part B's mount point and Part C's key-map registration are tasks with an explicit fallback.

## Migration Plan

**Order.** Each step is a separate migration created with `supabase migration new`, applied locally, tested, then pushed to `main` only after a separate deploy approval. A push to `main` applies migrations to production.

1. A1 schema: initiator columns, overrides, `schedule_version`, proposals, `thankyou_state`, `claim_manual_send`, permission row + seeds, outreach_schedule shape check, console views read `planned_at`.
2. App + worker for Part A behind `timing_v2_enabled` (app_settings). Off means today's behaviour, except D11 (route removal), which is unconditional.
3. Planner version bump (D4), with the dry-run report approved first.
4. B schema: budget columns, ledger, conversations, assistant settings. Then the B app behind `assistant_enabled`, which is off until the D16 evaluation passes.
5. C schema: tasks, notes, `tasks.manage`, board signal. Then the C app.
6. Drop `next_run_at` (last).

**Rollback.**
- Each switch off restores the previous behaviour for its part.
- Schema additions are additive and stay.
- Restoring the removed route is a revert commit.

## Open Questions

None. The owner decided on 22.10: who may change timing, how much may change, what the board contains, and one combined change. The remaining unknowns (Hebrew quality, real tokens per question) are measured by tasks, not assumed.
