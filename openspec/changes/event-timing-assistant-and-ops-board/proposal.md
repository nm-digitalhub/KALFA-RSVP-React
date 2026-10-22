# Proposal

## Why

The owner asked for three things that depend on each other (sessions 22.10.2026): an AI chat assistant on the customer's event page that answers status questions and helps plan the timing of messages and calls; a monday-style board for platform staff; and a timing layer both can trust. Today's timing is not that layer. A read-only review of the code and the live catalog (22.10.2026) found that it cannot be shown, explained or changed safely:

- **The "next message" time is never stored.** `outreach_state.next_run_at` has no writer in `src/` or `worker/`; console views read it and get NULL.
- **The default thank-you can go out on Shabbat.** It is event day + 1 at 10:00 with no calendar adjustment (`src/lib/data/event-date.ts:237-243`), so a Friday event thanks guests on Saturday morning. KALFA chose that time, not the customer.
- **Customer actions leave no trace.** Owner thank-you edits and the three manual sends write no activity row.
- **Gift and event-day sends are not idempotent.** Pressing twice re-sends to everyone; only the thank-you has a per-guest claim.
- **Visibility differs from authority.** Send buttons render for any member who can view; the actions accept only the event owner.
- **An unused route can send any template at any hour.** `POST /api/campaigns/[id]/whatsapp-send` accepts any `message_key`, outside the schedule and the send window, unaudited, and nothing in the repo calls it.
- **A schedule cannot be changed for one event at all**, not even by staff. It is an unversioned JSON copy taken at package choice.
- **Calls are planned with one hours policy and dialled with another,** so "when is the next call" has no single answer.
- **Automatic-call skip reasons go only to worker stdout,** so "why didn't Dani get a call" cannot be answered.

An assistant that changes timing on top of this would inherit every defect, which is why the owner made the timing layer part of this change.

On 22.10 the owner added a fourth part: upgrading the package of a running service. Verified the same day, there is no path to change a package once its terms are approved or paid (Part D).

## What Changes

**Part A — one timing layer for every outbound message and call**

- **Who started the send is recorded.** Every outbound send is either *KALFA-initiated* (the package schedule, the default thank-you) or *customer-initiated* (a manual send, a time the customer chose).
  - KALFA-initiated sends keep the no-night / no-Shabbat / no-holiday window.
  - Customer-initiated sends are the customer's right at any time (owner decision 22.10). When the chosen time falls at night, on Shabbat or on a holiday, the customer is told so before confirming. The send is never blocked, and the acknowledgement is recorded.
- **The default thank-you is placed by the KALFA window.** It goes to the first allowed slot from event day + 1, 10:00. A time the customer explicitly chooses is respected and warned about.
- **Per-event schedule changes, inside the package.** The owner, and anyone the owner grants the new permission, may move or skip existing steps of the package schedule for one event (owner decision 22.10).
  - A change may not add a step.
  - A moved KALFA step must land inside the KALFA window.
  - The package snapshot is never mutated. Changes are a versioned, validated layer on top of it.
- **Preview, then confirm.** Every change and every manual send is first a *proposal*. A proposal shows the exact effective times, every warning, and how many guests it affects. Only an explicit confirmation of that proposal applies it, exactly once. The screens and the assistant use the same proposals.
- **A truthful "next contact" time.** The engine already stores the planned send instant of the current step (`outreach_state.planned_at`). Every reader, including the console views that read the never-written `next_run_at` today, switches to it. Later steps are projected by the same pure functions the engine uses. Calls are planned with the call-hours policy they are dialled with.
- **Audit.** Every customer change, send and confirmation is written to the activity log with the actor, the surface (screen or assistant) and the proposal id. Automatic-call skips are recorded with their reason.
- **A new event permission, "timing and sends to guests".** The event owner always has it. It is granted to no other role by default, and the owner may grant it from the existing team roles screen. Send and timing controls render only for a viewer who holds it. **BREAKING (customer UI):** a member who could see the send buttons, which always failed for them, no longer sees them.
- **Idempotent manual sends and a real thank-you state.** Gift and event-day sends get a per-guest claim like the thank-you. The thank-you has an explicit state (scheduled, sending, sent, will-not-send with a reason) that the customer sees.
- **BREAKING (API):** `POST /api/campaigns/[id]/whatsapp-send` is removed.

**Part B — the event assistant (customer chat)**

- A Hebrew chat on the event's management page, shown once the package is paid.
- It answers from KALFA's own data through server tools gated by the viewer's existing event permissions: confirmations, who has not answered, when the next message or call goes out, and why a guest was not reached.
- **It never changes anything itself.** For a timing change or a send it creates a Part A proposal; the customer confirms it in the page.
- **Model and cost.**
  - It runs on the Claude API with KALFA's API key, not a subscription login. Anthropic's terms require an API key for a product offered to third parties.
  - The default model is Claude Haiku 5.5. A 40-question Hebrew evaluation decides whether it stays (≥95%), moves to Sonnet 5.5, or keeps the assistant off.
  - Built on the Vercel AI SDK, which provides chat state, streaming, the tool loop, tool approval and message validation. Nothing of that is hand-written.
  - Each package carries an AI budget in shekels, set in the admin package screen. Every reply's real cost is computed from the API's usage figures and the price list kept in settings. Cost is reserved before a reply and settled after it, so a budget cannot be exceeded.
  - The customer sees "X% of the assistant used", never tokens.
- **The assistant's knowledge.**
  - Rules (KALFA vs customer sends, Shabbat and holiday policy, what the package allows) live as small reviewed documents in the repo, in the SKILL.md format.
  - The assistant loads one only when it needs it.
  - Facts (dates, windows, counts) are always computed by KALFA code, never by the model.

**Part C — the staff event board**

- `/admin/board`: every event as a row, grouped by lifecycle stage, with read-only status columns from existing data: stage, event date, guests and answers, outreach progress, next contact, problems.
- Columns that expose customer data follow the existing rule on the admin event page: a viewer without the key does not see the column.
- **Manual staff tasks per event:** title, assignee, due date, status and notes.
- The board updates live through the same empty-signal broadcast pattern already used for permission changes.
- The event owner gets no board. They get the summary and the assistant (owner decision 22.10).

**Part D — package upgrade after approval or payment (owner decision 22.10)**

- Today a package can be changed only before the terms are approved (`change_campaign_package`). After approval or payment there is no path, for the customer or for staff. Verified 22.10 in the code and the live catalog.
- The customer or staff (with "manage billing") may start an upgrade. Only the customer approves it, after seeing the new package, the quota and the exact amount.
- **Before payment:** the package is switched, and the terms are approved again at the new full price.
- **After payment:** only the difference is paid. A previous benefit counts only if it has an option for the new package.
- **Upgrade benefits:** staff may give a benefit for an upgrade from the existing assignment screen. It is marked for upgrades and for target packages, applies only to the difference, never stacks, and is marked used only when the upgrade payment succeeds.
- The new package takes effect only after approval and a succeeded payment. Until then, and after a decline, a cancellation or an expiry, the service runs on the current package without interruption.
- The new quota is the total quota, and waiting guests are admitted. Past messages and calls are never repeated. The remaining schedule is planned again.
- Every step is recorded: offer, approval, payment, application and failure.
- Downgrades and refunds are excluded; they need separate rules.

## Capabilities

### New Capabilities
- `outreach-timing`: how every outbound message or call to a guest is initiated, scheduled, previewed, confirmed, changed per event, audited and explained, for KALFA-initiated and customer-initiated sends alike.
- `event-assistant`: the customer-facing chat on an event, what it may read and propose, its confirmation contract, its budget and its privacy limits.
- `staff-event-board`: the platform-staff board of events, its derived columns, staff tasks and live updates.
- `package-upgrade`: upgrading the package of an event's service after approval or payment, as part of that service: who may start it, the customer's approval, the amount due, when it takes effect, failure, quota, schedule and history.

### Modified Capabilities
None. `openspec/specs/` holds no capabilities today (`openspec list --specs`).

## Non-goals

- **The assistant on WhatsApp.** The same tools could serve it later; not in this change.
- **Adding steps** to a package schedule per event, or changing a package's price or quota per event. A package change goes only through the Part D upgrade.
- **Package downgrades and refunds tied to an upgrade.** They need separate rules.
- **A customer pause/stop control.** Skipping every remaining step is possible through Part A; pausing the service stays a staff action.
- **Blocking fast days, or per-venue candle-lighting times.** The window keeps Jerusalem times and today's blocked days. This is recorded as a known limit.
- **Guests' own time zones.** Times are Israel wall-clock, as today.
- **A board for event owners, kanban/Gantt views, and user-built board automations.** pg-boss and `workflows` remain the only automation engines.
- **Routing between setup and management.** That belongs to `separate-event-setup-from-management`. This change mounts the assistant on the management page that change defines.

## Impact

- **Database (migrations created only with `supabase migration new`, applied by the owner):**
  - a schedule-change layer and proposals;
  - the initiator on outbound records;
  - a thank-you state;
  - per-guest claims for manual sends;
  - the new event permission definition;
  - a per-package AI budget, copied to the campaign;
  - assistant conversations and a cost ledger;
  - staff tasks and their notes;
  - the board's broadcast signal;
  - package upgrades (`campaign_package_changes`, the link from the payment ledger, four SQL functions).
- **Code:**
  - `src/lib/outreach/*` (projection; per-channel policy at plan time);
  - `src/lib/data/outreach-engine.ts` and `worker/main.ts` (store the planned time, record call skips);
  - `src/lib/data/outreach.ts`, `auto-thankyou.ts`, `campaigns.ts`, `event-date.ts`;
  - the campaign actions and `manage-client.tsx`;
  - a new `src/lib/assistant/` and its route;
  - the admin package form;
  - a new `/admin/board`;
  - `src/lib/payments/status.ts`, `cardcom-purchase.ts`, `cardcom-settle.ts` and the payment page (Part D);
  - `src/lib/relocation/env-validation.ts` and `.env.example`.
- **Dependencies:**
  - Added: `@ai-sdk/anthropic` 4.0.85 and `@ai-sdk/react` 4.0.152.
  - Bumped: `ai` 7.0.141 → 7.0.148, an exact requirement of `@ai-sdk/react`.
  - Removed: the unused direct `@anthropic-ai/sdk` line. It stays transitive under `@anthropic-ai/claude-agent-sdk`.
- **Configuration and secrets:** a new API-key variable, which the owner creates in the Claude Console under the owner's API organization. The model choice, price list, monthly cap and on/off switch live in settings managed from the admin panel.
- **Depends on:**
  - `separate-event-setup-from-management` (the management page and its paid predicate);
  - the corrected table-permission rule of `staff-tables-permission-rls` (D10), for the new staff tables.
- **Deploy:** migrations first (owner-applied; pushing a migration to `main` deploys it to production), then worker and app together. Each part ships behind its own switch.
