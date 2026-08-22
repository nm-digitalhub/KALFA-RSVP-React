# KALFA — Plan: Sales-Closing Voice Agent

**Status:** planning document only. No code, no ElevenLabs/Voximplant changes.
**Scope owner:** this plan covers the sales-closing persona ONLY. The
inbound call-answering agent and the meeting-booking agent are separate
parallel workstreams — see "Coordination needed" for where this plan
touches them.
**Compliance status:** BLOCKED on attorney sign-off + engineering gates (§8),
NOT on open legal research — §30א and §16ב-16ג are both now resolved with
concrete answers (§6), §6.6's disclosure script is drafted. See §6 for the
precise remaining conditions. Nothing in this plan authorizes a real call.
**Owner decisions:** all questions resolved as of 2026-08-22, including
final MVP sequencing — see §7. **v1 ships tier-1 discount authority only
(§11), no mid-call consult path (§5.5).** The consult mechanism and
tier-2+ discounts are a defined, named phase-2, not built now. Tier 1's
exact cap still needs owner sign-off (§11.1) before implementation.
**Full draft script:** per owner decision 2026-08-22 (proceed to draft now,
attorney review not required before drafting — their own business-risk
call, not re-litigated here), the complete system-prompt content, tools,
first message, and evaluation criteria are written out in the companion
file `2026-08-22-sales-closing-agent-script-draft.md` — §3 below is now
superseded by that file for actual content; this doc's §6/§6.6 legal
analysis remains the source of truth it's built from.

---

## 0. Verified anchors (do not contradict without re-checking)

| # | Fact | Source |
|---|---|---|
| A-1 | KALFA has exactly ONE production voice agent today: `RSVPAgent` (ElevenLabs Conversational, `agent_9701kxj3n54ye518a3s518cexd48`), bridged via Voximplant scenario `RSVPAgent.voxengine.js` bound to rule `OutCallAgent` (1520915) on application `kalfa-rsvp`. Config: `agent_configs/KALFA-RSVP.json`. | live config, read 2026-08-22 |
| A-2 | RSVPAgent has `rag.enabled: false`, empty `knowledge_base: []`. It speaks only from 8 injected dynamic variables (`guest_name`, `event_name`, `event_date`, `event_venue`, `event_time`, `event_address`, `event_celebrants`, `event_rsvp_deadline`) plus a fixed prompt, and its Guardrails explicitly forbid answering anything else — it deflects to `notify_owner` (WhatsApp handoff). This is correct for RSVPAgent's narrow task and **must not be copied** into a sales agent, whose entire job is answering pricing/product questions persuasively and accurately. | same config |
| A-3 | KALFA bills **outcome-based, per reached contact** — never a subscription. Two live pricing shapes on `packages`: (a) pure per-reached (`price_per_reached` set, `base_price`/`included_reached` null), (b) base+overage (`base_price` + `included_reached` both set, additional reached contacts billed at `price_per_reached`). Both carry `min_hold_floor` and `hold_buffer_pct` for the J5 authorization-hold math. `price_with_vat` is the package's own list price. Source: `src/lib/validation/admin.ts` (`operationalFieldsSchema`), `src/lib/data/admin/packages.ts`. | live schema + code |
| A-4 | "Closing" in KALFA's actual product model is a **multi-step in-app flow the voice agent cannot complete by itself**: sign up → create an event → select a package (creates the campaign) → sign the agreement via OTP + `signature_pad` (evidentiary e-signature, `src/lib/data/agreements.ts`) → SUMIT J5 authorization hold captured. No voice-signature, no card-over-phone anywhere in this codebase. | `src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/sign-agreement-form.tsx`, `sumit-billing-expert` domain |
| A-5 | The real, live lead-capture surface for a sales callback is `/contact`'s **CallbackForm**, which writes `callback_requests` with a closed-vocabulary `topic` including `'מכירות'` (sales) — the SAME table/flow the current callbacks-admin workstream (git diff in progress: `call-outcome-form.tsx`, `cancel-callback-form.tsx`, `reschedule-form.tsx`, `no-contact-sms.ts`) already manages for humans. `contact_messages` (a *separate* table, general inquiries) also routes `topic='מכירות'` to the `sales` console queue via `TOPIC_TO_QUEUE_KEY`, but **`callback_requests.createCallbackRequest` never sets `queue_id`** — confirmed live: the column doesn't even exist on that table. `topic` is the only selector available today. | `src/lib/data/inquiries.ts`, `src/lib/validation/inquiries.ts`, live schema check 2026-08-22 |
| A-6 | `sales` is one of four live, human-staffed console departments (`CONSOLE_QUEUE_KEYS = ['sales','support','events','billing']`, `src/lib/data/console-queues.ts`), routed to `console_agents` via the existing ring-order primitive (`computeRingOrder`/`findRoutableAgents`, `console-calls.ts`). Human sales staff already exist as a routing concept in this system. | `src/lib/data/console-queues.ts` |
| A-7 | **MEASURED live data, 2026-08-22:** `callback_requests` currently holds exactly **2 rows**, both `topic='מכירות'`, both created 2026-08-19/20 and already `call_outcome='completed'` by a human. **This is NOT "2 requests ever."** `callback-scheduling.ts`'s own `countStrandedCallbacks` comment records fourteen requests accumulated by 2026-08-16, and `api/agents/callbacks/route.ts` separately notes "on 17.8 was serving fourteen four-day-old rows" — real prior rows existed five days before this measurement and are gone now. `min(created_at)`/`max(created_at)` across the whole table confirms nothing survives from before 19.8, and the `status`/`call_outcome` redesign migration (`20260819212112_callback_status_outcome_split.sql`) landed exactly then — the table was very likely reset/cleared as part of that in-progress redesign (git diff shows it actively being worked on), not organically empty. **Conclusion:** current standing volume is genuinely near-zero, but that does NOT mean historical sales-callback demand is near-zero — the two facts must not be conflated, and no prioritization call should rest on "this persona is low-value because nobody asks for it." What §3 can say stands: no real transcript content survives to mine for objections, regardless of cause. | `execute_sql` against project `cklpaxihpyjbhymqtduv`, 2026-08-22; `src/lib/data/callback-scheduling.ts` (`countStrandedCallbacks` comment); `src/app/api/agents/callbacks/route.ts` (comment) |
| A-8 | The existing consent/scheduling gate for a **consumer-initiated** callback is `evaluateCallMeNowConsent` → `evaluateSharedConsentGates(..., { hoursGate: 'skip_consumer_initiated' })` (`src/lib/data/console-calls.ts`): DNC (`call_dnc_list`/`isDncListed`), `call_consent_at`, Shabbat/Yom-Tov — all enforced; the platform's blanket 08:00–21:00 window is *skipped* specifically because the person asked to be called. Actual scheduling of `callback_requests` rows runs through `DEFAULT_CALLBACK_POLICY` (`src/lib/callbacks/schedule-policy.ts`): Sun–Thu 09:00–18:00, Fri 09:00–13:00, Sat closed, 2h min notice, 8/day cap — **tighter than the platform floor**, already live, already what schedules these exact rows today. | `src/lib/data/console-calls.ts`, `src/lib/callbacks/schedule-policy.ts` |
| A-9 | The human monitor/takeover safety net (`human_agent_call_legs`, `monitorEnabled()`, `advanceLegStatus`) resolves the call to attach to **via the cb-token → `call_attempts` row** — it is currently wired specifically for the RSVPAgent scenario's call shape. | `src/lib/data/console-monitor.ts`, `src/app/api/voximplant/cb/[token]/route.ts` |
| A-10 | `call_attempts` is structurally an RSVP-campaign object: `campaign_id`, `event_id`, `contact_id`/`guest_id` are all NOT NULL. A sales callback has **no event and no campaign** — it is a `callback_requests` row (name, phone, topic, note). `call_attempts` cannot represent a pre-signup lead call without either a schema change or a parallel table. | live schema, `src/lib/supabase/types.ts` |
| A-11 | A generic web-push channel already exists and is already used for console-agent alerting: `push_subscriptions` table, VAPID keys, `sendWebPushNotification` (`src/lib/push/web-push.ts`), subscribed via `subscribeConsolePushAction`/the console softphone panel (`src/components/console/push-alert-toggle.tsx`, `push-alert-actions.ts`) — same mechanism the customer-facing settings push uses. It is currently **one-directional**: it notifies a human to go act in their own UI. Nothing today lets a human's reply feed back into a still-running, live phone call within a bounded window. Relevant to §5.5. | `src/lib/push/web-push.ts`, `src/lib/data/push-subscriptions.ts`, `src/components/console/push-alert-actions.ts` |
| A-12 | ElevenLabs client tools already support a bounded `response_timeout_secs` during which the agent genuinely waits before continuing — `save_rsvp` already does this today (10–20s) for an ordinary DB write. The *mechanism* for "agent pauses, waits up to N seconds for an external answer, then continues" already exists and is proven live; what's unproven is wiring a **human's** reply into that window in time. Relevant to §5.5. | `agent_configs/KALFA-RSVP.json` (tool `response_timeout_secs` fields) |
| A-13 | **MEASURED live data, 2026-08-22:** exactly ONE active package exists — `אישורי הגעה — וואטסאפ + שיחות AI` (tier `outcome_whatsapp`, category `campaign`): `price_with_vat=200.00`, `base_price=200`, `included_reached=200`, `price_per_reached=4`, `includes=[]` (empty — no bullet list to read; don't invent one). This confirms the base+overage figures used in the script draft's §6.6 illustrative numbers. It also means v1 has exactly one product to explain, not a category/tier matrix — §2.3's "map qualification answers to a package via category/tier" simplifies to "there is currently one package" in practice, though `get_pricing` must still query live rather than assume that stays true. | `execute_sql` against project `cklpaxihpyjbhymqtduv`, 2026-08-22 |
| A-14 | **Working-tree change, discovered mid-session 2026-08-22 (file changed on disk since first read — another workstream, not this plan, added it), CONFIRMED UNCOMMITTED (`git status`/`git diff --stat`: 15 insertions, not yet committed; `git log -S` finds these lines in zero commits — do not cite this as "live in main" or attribute it to any specific past commit without re-checking `git status` first):** `/contact`'s `CallbackForm` (`src/app/(public)/(site)/contact/inquiry-forms.tsx`) now shows, for `topic='מכירות'` specifically: (1) under the topic selector, "בבחירת נושא 'מכירות' אני מבקש/ת שיחזרו אליי בנוגע לרכישת שירותי קלפה, לרבות מידע ופרטים לפני רכישה" and (2) after submit, `CallbackDisclosureNote`: "החזרה עשויה להתבצע על ידי נציג אנושי או באמצעות סוכן דיגיטלי/קולי אוטומטי מטעם קלפה." This materially strengthens the §6 compliance posture (addresses both the AI-disclosure sub-issue AND the 30א(ב) express-consent sub-issue) — but it is **UI-only** (no persisted proof the disclosure was shown/read at submission time) **and not yet committed/deployed**. Worth a future hardening item (record disclosure-shown-at on the row), not a blocker on this plan — but don't treat it as settled production behavior until it actually ships. | `src/app/(public)/(site)/contact/inquiry-forms.tsx`, `src/app/(public)/(site)/contact/actions.ts`, `git status`/`git log -S`, checked 2026-08-22 |
| A-15 | **SUPERSEDED 2026-08-22 (owner decision, relayed via team-lead) — kept below for the historical channel-viability reasoning, which is still accurate; only the SMS-primary CONCLUSION is superseded.** Original finding: **Channel decision for `send_signup_link` — SMS primary, WhatsApp additive-only (per parallel review, 2026-08-22, verified):** Meta's Template Library has no UTILITY category fitting "signup link for a stranger with no account" (every UTILITY use case presupposes an existing order/account); a call never opens WhatsApp's 24h session, so any WhatsApp send here is cold, and a cold MARKETING send risks the same silent-drop (131049) already documented for this project ([[whatsapp-utility-vs-marketing-131049]]). `src/lib/callbacks/no-contact-sms.ts` already establishes SMS as the approved channel for an unprompted service message to this exact table (`callback_requests`), reasoned as "a reply to a request the customer themselves initiated." ~~v1: SMS is the channel `completed` depends on; WhatsApp, if sent at all, is best-effort and must never gate the outcome.~~ **Owner overrode this 2026-08-22: WhatsApp must be the real, first-attempted channel, not a best-effort add-on — the async-delivery-confirmation problem this created is engineered, not avoided, via a claim-guarded async resolution path (webhook `delivered`/`read` → `completed`; `failed`/timeout → automatic SMS fallback). The MARKETING-classification/131049 risk this row correctly identified is real and unchanged — it's now handled with a real fallback instead of being designed around by avoiding the channel. Full design: `sales_call_attempts`'s WhatsApp-delivery-confirmation columns (`supabase/migrations/20260822112145_*`), spec sent to team-lead/sales-meeting-schema-build/sales-meeting-voximplant-build, 2026-08-22.** | `src/lib/callbacks/no-contact-sms.ts`, live Meta Template Library docs (fetched 2026-08-22), `[[whatsapp-utility-vs-marketing-131049]]` |
| A-16 | **Correctness finding, verified 2026-08-22: "provider accepted" ≠ "prospect received," for BOTH channels — `send_signup_link`'s success/`completed` criterion must not be keyed off bare provider acceptance.** WhatsApp: `client.ts`'s `classifyResponse` returns `{kind:'accepted'}` the instant Meta *queues* the message — a 131049 cap-drop arrives later as an async delivery-status webhook, not a sync rejection, so a WhatsApp send can return "accepted" and the prospect gets nothing, silently (same shape as `[[save-rsvp-queued-false-promise]]`, now with a sales outcome attached). **SMS is not automatically safe either — checked directly against the live adapter**: `src/lib/sms/sender.ts`'s `createExtraSmsSender.send()` returns `{id}` on ExtrA's `{success:true, id}` response — this confirms the provider ACCEPTED the send request; there is no delivery-receipt/DLR webhook wired into this codebase for ExtrA at all. SMS carries no known silent-cap failure mode analogous to 131049, so provider-acceptance is a materially stronger signal here than for WhatsApp — but it is still "accepted," not "confirmed delivered to the handset." Design implication: key the terminal `completed` outcome off the SMS provider accepting the send (§1.1's "link sent" bar, not "link received" — consistent with the plan's own terminal-success definition), never off a WhatsApp accept alone, and don't oversell what even SMS acceptance proves. | `src/lib/sms/sender.ts` (read in full), `src/lib/whatsapp/client.ts` (`classifyResponse`, `DEFINITELY_NOT_SENT_CODES`), 2026-08-22 |

---

## 1. Scope and non-goals

### 1.1 What "closing a deal" means here (concrete, per A-3/A-4)

The agent's job: reach a prospect who **asked KALFA to call them** about becoming a customer, understand what they're planning (event type, rough date, guest count), explain KALFA's real pricing from live data, handle objections, and get **verbal commitment** — then hand them a live link to complete signup/package-selection/agreement in-app, and record a structured outcome on their `callback_requests` row.

The agent **never** completes the transaction itself. No card details or bank info over voice. No voice signature. The actual close (account, event, package selection, signed agreement, J5 authorization) happens in the existing in-app flow, same as it does for any self-serve signup today — the call's job is to get the prospect there with intent, not to replace the flow.

**Terminal-success definition — CONFIRMED (owner, via team lead, 2026-08-22):** since the agent structurally cannot capture a signature or payment over voice, the only state a voice-only call can actually reach is **verbal commitment + a live signup/agreement link sent to the prospect + the outcome recorded** on the `callback_requests` row (§4). This is both the agent's terminal success state and its ElevenLabs evaluation criterion — do not design toward "event created" or "agreement signed" as the bar the call itself must clear.

### 1.2 In scope (v1)

- **Outbound only, and only to a prospect who solicited it** — **CONFIRMED by owner, 2026-08-22**: `callback_requests` rows with `topic = 'מכירות'`, created via `/contact`'s CallbackForm. This is a *returned* call to someone who typed their own name and phone number into a form asking to be called about sales — not a cold list, not a purchased list, not a reactivation campaign. The agent does not handle inbound sales calls; that stays with the inbound-answering persona (parallel workstream).
- Qualification: event type, rough date/timeframe, approximate guest count — the minimum needed to name a concrete package and price.
- Pricing/product Q&A grounded in live `packages` data (§2) and the outcome-billing model — no invented numbers, no invented discounts.
- Objection handling using KALFA's real product facts (see §2, §3).
- Terminal outcomes recorded on the `callback_requests` row via a new outcome vocabulary (§4), same pattern as `call_outcome` today.
- Handoff to a human sales console agent when the prospect asks for one, when the call goes badly, or when live human monitor/takeover is available (§5).

### 1.3 Explicitly out of scope (non-goals)

- **Cold outbound.** No calling anyone who did not ask to be called. This is not "a sales dialer" — it is a callback-request responder. Any future cold/reactivation outbound sales calling is a *separate* proposal requiring its own compliance review; do not fold it into this build under "phase 2."
- **Inbound call answering.** A prospect calling KALFA's main number and getting this agent is the inbound-agent's scope (parallel workstream). This plan assumes only outbound legs to `callback_requests` rows. Flagged under Coordination needed (§8) — the two personas may end up sharing infrastructure but should not share a design decision here.
- **Meeting booking as the agent's own decision.** *Provisional, pending the meeting-booking agent's own plan (§8):* the current assumption here is that a not-ready prospect gets offered the *existing* `schedule_callback`/`callback_requests` re-entry mechanism (the same tool RSVPAgent already has) — reusing an existing queue mechanism, not a new booking system. If the meeting-booking agent defines a genuinely different concept (a fixed-time appointment rather than "call again later"), that supersedes this line. Do not design a calendar/meeting-booking UX here regardless.
- **Any payment or signature capture over the call.** Structural non-goal per A-4.
- **Unbounded discount discretion.** The owner explicitly ruled this out ("must be planned precisely so it doesn't end up offering discounts to everyone and causing losses" — §7 Q2, answered). The agent never picks a discount by its own judgment. See §11 for the bounded mechanism this plan proposes instead.

---

## 2. Knowledge base: content and source of truth

Per the root-cause finding already established this session (RAG-less RSVPAgent deflects everything, which is *why* past KALFA voice agents feel weak on real questions) and per KALFA's own house rule (`no-hardcoded-business-facts`, CLAUDE.md: price/channel/policy facts are live DB data, never hardcoded), the KB is deliberately **split into two different mechanisms**, not one document:

### 2.1 Static knowledge base (ElevenLabs RAG, `rag.enabled: true`, "Auto" retrieval mode)

Stable facts that don't change per-call and don't drift day to day:

- What KALFA is and does (event RSVP platform: guest import, multi-channel outreach — WhatsApp/SMS/AI-call — RSVP collection, reporting).
- How the outcome-billing model works conceptually ("you pay per contact we actually reach, not a flat package fee up front" / base+overage explained in plain language) — the *shape* of the model, not live numbers.
- What "reached contact" means (ties to the billing definition already used in `outcome-billing-model` — do not redefine it here).
- What happens after the prospect says yes: sign up → create event → pick a package → sign the agreement (OTP + e-signature) → nothing is charged until the campaign's close-charge step.
- Cancellation rights (14-day, per Israeli consumer protection law) — **wording here must be reviewed by israeli-compliance-advisor before this KB entry is written**, not authored independently.
- Common objections and calm, honest responses (§3) — this is the one KB category the sales skills catalog (see §3) should populate, since there is no real transcript history yet (A-7).

**Never in the static KB:** current prices, current package names/tiers, current `min_hold_floor`/`hold_buffer_pct`, anything an admin can edit in `/admin/packages`. A static document goes stale silently the moment an admin edits a package — exactly the failure mode `no-hardcoded-business-facts` exists to prevent.

### 2.2 Live pricing via tool call (not KB)

A new **client tool**, e.g. `get_pricing`, that the agent calls whenever pricing, package names, or "what's included" comes up — mirroring the prompting guide's anti-hallucination rule ("always consult a tool/source before answering, never guess"). Server side: a thin, read-only endpoint over `listPackages`-equivalent public data (active packages only — `packages_public_read` RLS already exists per A-6's sibling finding in `packages.ts`), returning name, tier, category, `price_with_vat`, `includes`, and (only if the eventual close model needs to explain it) the per-reached/base+overage shape in plain terms. This is the same "consult a tool, never guess" discipline the prompting guide names, applied specifically because prices here are real money and an admin-editable column, not the kind of fact a KB embedding should ever "remember."

### 2.3 What decides "which package" during the call

Qualification answers (event type, guest count, rough date) map to a package tier via the same `category`/`tier` fields the admin dashboard already uses — no new categorization scheme. If no package cleanly fits (unusual event type, no active package in that category), the agent says so honestly and hands off (`notify_owner`/human escalation), exactly like RSVPAgent already does for out-of-scope questions — never invents a price to fill the gap.

---

## 3. Agent prompt structure (sketch, Hebrew section headers, ElevenLabs prompting-guide shape)

Following the same Personality/Environment/Tone/Goal/Guardrails/Tools structure RSVPAgent already uses, and the prompting guide's rule that critical steps get stated twice / marked "השלב הזה קריטי":

```
# Personality
[שם הסוכן — TBD, לא "מאושר" (זה RSVPAgent); טון: ישראלי, בטוח בעצמו אבל
לא לוחצני, מומחה במוצר, לא "מוקד מכירות". תפקידו להסביר ולעזור להחליט —
לא לשכנע בכוח. הכרה מיידית: לא מתחזה לאדם, אבל גם לא נשמע כמו טופס.]

# Environment
[שיחה יוצאת, לפנייה שהאדם עצמו ביקש — לא שיחה קרה. יש לו: שם הפונה,
טלפון, נושא (=מכירות), הערה חופשית אם קיימת, מתי ביקש שיחזרו. אין לו עדיין:
איזה סוג אירוע, כמה אורחים, מתי. אלה נאספים בשיחה עצמה.]

# Tone
[קצר, בגובה העיניים, לא תסריט מוקד. מגיב קודם למה שנאמר, ורק אז ממשיך —
אותו כלל שמנצח כל כלל אחר ב-RSVPAgent. עברית מדוברת, לא שפת טפסים.]

# Goal
[1. זיהוי + הקשר קצר על למה מתקשרים.
 2. גילוי: איזה אירוע, בערך מתי, בערך כמה מוזמנים — שאלות פתוחות, לא חקירה.
 3. הצעת מסלול: קריאה ל-get_pricing, הצגת המסלול המתאים במילים, לא במספרים
    יבשים ("ה[category] שלנו, זה [מה כלול], ועולה לפי אנשי קשר שבאמת הגענו
    אליהם — לא סכום קבוע מראש"). This step is important.
 4. טיפול בהתנגדויות (§ tools/knowledge base — לא ממציא, לא מתווכח).
 5. **גילוי משפטי מרוכז (חדש, ר' §6 — DRAFT, טעון אישור עו"ד; לפני קבלת
    אישור מילולי, לא אחריו)**. This step is important — אסור לדלג.
 6. אישור מילולי + שליחת קישור להרשמה/סגירה בפועל (WhatsApp/SMS — לא
    בשיחה עצמה). This step is important — הסוכן אף פעם לא "סוגר" את העסקה
    בעצמו; הוא מעביר את הפונה לזרימה הקיימת.
 7. דיווח תוצאה (§4) + סיום.]

# Guardrails
[- לעולם לא ממציא מחיר/הנחה/תנאי — תמיד get_pricing.
 - לעולם לא מבקש פרטי תשלום, מספר כרטיס, או חתימה בשיחה.
 - "תסירו אותי" → mark_dnc מיידי, אותו כלל בדיוק כמו RSVPAgent.
 - שאלה שאין עליה תשובה בבסיס הידע → escalate/notify_owner, לא ניחוש.
 - **לעולם לא לדלג על שלב 5 (הגילוי המשפטי) גם אם השיחה זורמת מהר לכיוון
   "כן, מעוניין/ת" — הגילוי חייב לקרות לפני שהסוכן מבקש/מקבל את האישור
   המילולי, לא כתוספת אחרי.**]
```

### 3.1 שלב 5 — נוסח גילוי משפטי (DRAFT, טעון אישור עו"ד — ר' §6.6)

ר' §6.6 להלן לנוסח המלא, ההנמקה הסטטוטורית סעיף-אחר-סעיף, וההנחיות
לאינטגרציה (משתני-{{}} דינמיים, לא ערכים קבועים בפרומפט).

**Superseded 2026-08-22:** per owner decision, the full script (not just this sketch) is now drafted in the companion file `2026-08-22-sales-closing-agent-script-draft.md` — system prompt, tool schemas, first message, and evaluation criteria. That file is still DRAFT/unreviewed content, same status as this plan's own §6.6, and does not change §6's implementation-blocking compliance gate.

---

## 4. Terminal outcomes (extends the existing `call_outcome` pattern)

Rather than inventing a parallel outcome system, extend the same shape `callback_requests.call_outcome` already has (A-5's table), since the sales agent is working the *same table* a human sales console agent already works by hand:

| Outcome | Meaning | Existing hook | **Who writes it (fixed, `auth-authz-guardian` review, 2026-08-22)** |
|---|---|---|---|
| `completed` | Reached, verbal commitment, link sent | already a valid `call_outcome` value | **Server, never the agent** — written as a side effect of `send_signup_link` actually succeeding (real SMS-provider-accepted result), not passed as an `outcome` value by any agent tool call. See script draft §3's architectural-fix note. |
| `no_answer` | Not reached | already exists — feeds the existing 3-strikes → SMS auto-close (`applyCallOutcome`) unmodified | **Telephony/dispatcher layer only, never the agent's own tool.** If an ElevenLabs tool-call session is live at all, the call connected by construction — the agent asserting "no_answer" about its own live session is architecturally incoherent, not just risky. Removed entirely from the agent-callable `log_outcome` enum. |
| `needs_followup` | Reached, not ready, wants to think or a human callback | already exists — re-enters scheduling exactly like today | Agent-writable via `log_outcome`, but only when justified by the prospect's own words — same discipline §11 already requires for discount triggers, never offered/asserted proactively. |
| `closed` | Reached, explicitly not interested | already exists | Agent-writable via `log_outcome`, same discipline as `needs_followup`. |
| *(new, if approved)* `escalated_to_human` | Handed to a live console agent mid-call or on request | **new** — needs a validation.ts + migration change; flagged, not assumed | Agent-writable via `log_outcome`, gated on the actual escalation attempt (§5.4), never asserted without one. |

Using the existing vocabulary means the admin `/admin/callbacks` UI, the 3-strikes no-contact SMS, and the reschedule flow all keep working for AI-worked rows with zero *data-model* changes — the only genuinely new vocabulary piece is `escalated_to_human`, and even that could initially just be recorded as `needs_followup` + a note, deferring the schema change. The **write-path split above is a real architectural change**, not just a data-model note: `log_outcome`'s own callable surface now excludes `completed`/`no_answer` entirely (removed from the tool's `outcome` enum) precisely because letting the agent self-assert either one was a real hallucination/prompt-injection risk (a prospect saying "just mark me as closed" could get a vulnerable model to falsely record a sale) and an architectural incoherence (asserting "no_answer" from within a connected call), respectively — not a style preference.

This is not "zero changes" end to end, though: `applyCallOutcome` itself (`callback-scheduling.ts`) is request-free and safe to call from unattended code, but today its only caller, `updateCallOutcome` (`src/lib/data/admin/callbacks.ts`), sits behind `requirePlatformPermission('view_customer_data')` — a human admin session. An AI agent writing an outcome via a token-scoped Voximplant callback route is a **new authorization surface** into the same data layer, not a reuse of the existing one — and per the write-path split above, that surface is now **two** distinct new routes, not one: the `send_signup_link` handler (writes `completed` server-side on success) and the `log_outcome` handler (writes `needs_followup`/`closed`/`escalated_to_human` from the agent's own tool call). `auth-authz-guardian` **has now reviewed this exact surface (2026-08-22)** and the write-path split above is a direct product of that review, not a forward-looking flag anymore — both new routes still need the identity-resolution/guard-function/audit-trail/rate-limiting checklist the review produced, which went to whoever builds the actual route rather than being repeated here in full; this plan only owns the tool-schema/conversation-design half of the fix.

---

## 5. Telephony / routing approach

### 5.1 Why this cannot reuse `call_attempts`/RSVPAgent's ctx-cb wiring as-is (A-10)

RSVPAgent's context contract (`GET /api/voximplant/ctx/{token}` → `POST /api/voximplant/cb/{token}`) is keyed to a `call_attempts` row, which requires an existing `campaign_id`/`event_id`. A sales callback has neither. Two real options, **neither decided here**:

- **(a)** A new, parallel token-scoped context/callback pair keyed to `callback_requests.id` instead of `call_attempts.id` — same security shape (opaque per-call token, generic 404s, no-store, rate-limited) as the ctx/cb routes already prove out, new table for the access-token/expiry bookkeeping.
- **(b)** Generalize `call_attempts` with a nullable "kind" discriminator so it can represent a non-campaign call. Riskier: `call_attempts` is billing-adjacent RSVP infrastructure with `billed_outcome`, and stretching its meaning risks confusing two unrelated systems the way `callback_requests.status` conflating scheduling-state and outcome-state already caused a redesign once (A-5's sibling context).

Recommendation for the eventual build: (a). This is a design call for `voximplant-engineer` + `rls-schema-engineer` to make together against the live schema, not something to lock in a planning document.

**Note, 2026-08-22 — CONFIRMED by `whatsapp-sales-link-real-build`:** option (a) (or something structurally equivalent, under a different name) is already built, not merely recommended. `sales_call_attempts` (`supabase/migrations/20260822104725_*`) is a real, staged table keyed to `callback_request_id` with its own `access_token`/`token_expires_at`, plus delivery-confirmation columns including `wa_consent_confirmed_at` added by a second migration (`20260822112145_*`) — read directly by that teammate, not independently re-verified by me. This subsection should no longer be treated as open; `voximplant-engineer`/`rls-schema-engineer` review of the actual migrations is still worthwhile, but the design call itself has been made.

### 5.2 Dispatch trigger

A pg-boss sweep (same idiom as `runCallbackSchedulingSweep`) or an extension of it: when a `callback_requests` row with `topic = 'מכירות'` is scheduled (already goes through `DEFAULT_CALLBACK_POLICY`, A-8), instead of only creating an Exchange calendar appointment for a human, it *also* (or *instead*, per §8 precedence question) triggers an outbound `StartScenarios` call carrying the row id as the opaque token — same `{to, from, tok, u}` shape already proven at well under the 200-byte cap by both RSVPAgent and `call-me-now`.

### 5.3 Consent/hours gate

Reuse `evaluateSharedConsentGates(..., { hoursGate: 'skip_consumer_initiated' })` (A-8) verbatim as the pre-dial gate — this call is exactly the "consumer initiated" case that mode exists for. `DEFAULT_CALLBACK_POLICY`'s Sun–Thu 09:00–18:00 / Fri 09:00–13:00 / Sat-closed window governs *when* the row is scheduled in the first place. Do not design a third, new hours policy.

### 5.4 Human escalation — behavior, not just the wiring gap

§8 flags that the *mechanism* (`advanceLegStatus`) does not automatically transfer to a new context table. This subsection is the actual design for what the agent does, independent of that wiring work:

- **Prospect asks for a human** ("תעביר אותי לבן אדם", "אני רוצה לדבר עם נציג"): the agent calls a new `escalate_to_human` tool. Server side, this checks availability the *same way* `call-me-now` already does — `findRoutableAgentVoxUsernames` (or its `sales`-queue-scoped equivalent via `console-queues.ts`'s ring-order). Two outcomes:
  - **Routable agent exists:** warm-transfer into the live human_agent_call_legs conference flow (subject to §8's wiring dependency being resolved) — the prospect is connected to a real person before the AI call ends, not dropped and re-dialed later.
  - **No routable agent:** the agent does NOT pretend a handoff is happening. It says so honestly — same "notify-not-ask, never a false promise" discipline `offerCallbackForCallMeNow` already applies for the same no-agent case — records `needs_followup` (or `escalated_to_human` if that outcome value is adopted, §4) with a note, and offers a scheduled callback instead (§1.3's existing-mechanism re-entry, provisional per the note there).
- **Call is going badly** (repeated misunderstanding, hostile response, sensitive topic) even without an explicit request: same tool, same path — this mirrors RSVPAgent's own two-strikes → WhatsApp-fallback pattern, just routed to a human instead of a channel switch, because a sales conversation going wrong has higher stakes than a confirmation call going wrong.
- **Never** silently ends the call as though nothing happened when escalation was warranted — the honest-fallback branch above is the floor, not an edge case to skip.

### 5.5 Mid-call human consult — "ask and continue," distinct from §5.4's takeover (owner requirement, 2026-08-22)

The owner asked for a second, lighter-weight mechanism, explicitly **not** the existing monitor/takeover: the agent should be able to quickly check with a human — possibly the owner specifically, not any queued rep — *before* committing to something uncertain (the clearest case: before applying a discount, §11), while the call keeps running, rather than pulling a human onto the live audio.

**Investigated feasibility (this session), not yet designed as a shippable mechanism:**

- **What already exists and is reusable (A-11, A-12):** a generic web-push channel (VAPID, `push_subscriptions`, `sendWebPushNotification`) already notifies console agents in real time, and ElevenLabs client tools already support a bounded `response_timeout_secs` during which the agent genuinely pauses before continuing — `save_rsvp` proves this pattern live today for an ordinary DB write.
- **The actual gap:** nobody has built the two things that would turn those into "ask and continue." (1) A synchronous *reply* path — something that lets a human's tap or one-line answer feed back into the still-open tool-call webhook within the wait window (today's push flow is one-directional: notify a human to act in their own UI, not to answer back into someone else's live call). (2) A fast, low-friction reply surface for the human — the existing console UI is not built for "answer within ~20 seconds while your phone buzzes."
- **This is new engineering, not a reuse of §5.4's infrastructure.** §5.4's `human_agent_call_legs`/`advanceLegStatus` mechanism is a full audio-conference join; this is closer to a synchronous webhook-plus-notification pattern layered on top of the *existing* web-push channel, most of it living in the app/API layer rather than the Voximplant scenario itself (ElevenLabs tool calls hit KALFA's API directly). Whether holding a live call for up to ~20–30 seconds waiting on a human tap is acceptable call-UX (vs. filling the wait with a natural stall like "תן לי רגע לבדוק את זה" / the existing `skip_turn` system tool) is a real question worth `voximplant-engineer`'s input alongside whoever owns the push/tool-route side.
- **Design sketch, for review, not commitment:** a new `ask_owner` client tool, called only for a small, named set of decisions (starting with: applying one of §11's pre-approved discount tiers). Fires a push notification with the specific question and 2–3 fixed response options; the server holds the tool response open (bounded, e.g. 20–25s) waiting for a reply written to a small `agent_consult_requests`-shaped row; on timeout, returns a safe default ("no" / "I can't confirm that right now") to the agent rather than guessing. Every consult, answered or timed out, is logged.

**FINAL — owner decision, 2026-08-22:** v1 ships WITHOUT this consult path. It is a defined, named follow-on phase (not a vague "maybe later") — see §8's dependency entry and §11's phase split. Nothing in §5.5 is speculative anymore about *whether* it's in v1; what remains open is only *how* it gets built, whenever that phase starts.

---

## 6. Compliance gate — HARD BLOCKER, read before anything else in §5/§9 is built

This persona carries materially higher legal exposure than RSVPAgent or the inbound-agent, because it (a) discusses and quotes prices, (b) aims explicitly at getting a paid commitment, and (c) is the one persona where "did the AI solicit or pressure someone" is a live question even when the prospect asked to be called.

**Status as of 2026-08-22 (`israeli-compliance-advisor` review, multiple rounds — see `.claude/agents/shared/legal-catalog-israel.md` §1, §4, §9, items #7, #28, #29 for full sourcing):** substantially narrowed, close to resolved on the legal-research side. Still a hard blocker — do not start §5/§9 implementation — both §30א and §16ב-16ג now have concrete answers below (not open research questions), and §6.6's script is drafted; what remains is attorney sign-off, committing/deploying the working-tree form-copy change, and the plan's own engineering gates (§8).

- **§30א (spam/telemarketing law) — PARTIALLY narrowed, not closed (catalog item #28):**
  - The AI-disclosure sub-issue is **addressed in practice**: `CallbackForm` now renders `CallbackDisclosureNote` ("החזרה עשויה להתבצע על ידי נציג אנושי או באמצעות סוכן דיגיטלי/קולי אוטומטי מטעם קלפה") before submission, satisfying the Privacy Protection Law §11 informed-consent disclosure the Privacy Protection Authority's draft AI guidance describes (Gornitzky/Shibolet, dated 6.5.2025 — **still draft as of that date, status since unconfirmed**, so treat this as prudential good practice, not proof of compliance with settled law).
  - The 30א(ב) express-consent-to-a-sales-approach sub-issue **is now addressed by the same fix as the AI-disclosure sub-issue above (A-14)** — `CallbackForm` now shows, under the topic selector, "בבחירת נושא 'מכירות' אני מבקש/ת שיחזרו אליי בנוגע לרכישת שירותי קלפה, לרבות מידע ופרטים לפני רכישה", which is materially the copy this bullet originally asked for. **Correction, 2026-08-22:** per `git status`/`git log -S` on `inquiry-forms.tsx`, this line is an **uncommitted working-tree change** (`git diff --stat` shows 15 uncommitted insertions; the pickaxe search finds it in NO commit, including the original `4150c06` contact-form commit) — it is real and present on disk right now, but not yet committed or deployed, and could still be reverted or altered before it ships. Treat as "addressed in the current working tree, pending commit/deploy," not as settled production behavior — and this remains prudential good practice per the same draft-guidance caveat as the AI-disclosure sub-issue, not a substitute for actual legal sign-off on sufficiency.
  - **§16ב-16ג (Amendment 61, "אל תתקשרו אליי" / "פנייה שיווקית") — RESOLVED for this exact scenario (catalog item #28, updated 2026-08-22, fourth update).** team-lead read the full official text of the Sixth Schedule (תוספת שישית, referenced from §16ג(ה)) directly from Nevo's raw HTML (`https://www.nevo.co.il/law_html/law00/70305.htm`), not a summarized fetch. Item 1 of the Sixth Schedule, quoted exactly: "עוסק הפונה לצרכן בפנייה שיווקית לאחר שהצרכן פנה אליו וביקש ממנו כי יחזור אליו באמצעות שיחה; נטל ההוכחה כי הצרכן ביקש שהעוסק יחזור אליו כאמור הוא על העוסק." — a direct, clean exemption for exactly KALFA's solicited-callback scenario, not an analogy from a different statute this time. No 12-month validity limit applies to this item (that's a separate item 4, a different general marketing-consent exemption — don't conflate the two). The only condition: provable proof the consumer requested the callback — the `callback_requests` row (with its submission timestamp) already constitutes that proof. This resolution applies only to genuinely solicited callbacks (this plan's actual scope, §1) — it would NOT cover cold outbound solicitation, which stays out of scope. **Independently re-verified by `israeli-compliance-advisor`, 2026-08-22 (second, separate fetch of the same live Nevo text, exact-match quotes on items 1 and 4)** — one small correction to the subsection lettering above: §16ג's actual subsections are (א)(ב)(ג)(ד)(ה) — there is a (ד) (vicarious liability for approaches made on another business's behalf), and the schedule cross-reference is in (ה), not (ו) as an earlier draft of this note had it. The substantive conclusion is unchanged. Two further points worth having on record: (i) the Sixth Schedule has 4 items total, not 2 — item 2 (existing continuous-transaction customer, same-transaction only) and item 3 (separate written consent not obtained via a phone approach) exist too, neither directly relevant to this persona's scope, though item 2 is worth cross-referencing against the separate host-lifecycle-marketing question (catalog §1); (ii) this exemption holds *independently of, and in addition to*, the fact that the underlying מאגר this whole framework depends on is currently inactive (catalog §4 — shut down since late 2024, no funding, not revived) — so the protection doesn't evaporate if the registry is reactivated later. Full text of all 4 items: catalog §4.
- **Consumer Protection Law, 14-day cancellation right (ביטול עסקה) — resolved as to *whether* disclosure is required; script drafted below (§6.6), pending attorney sign-off on exact wording.** KALFA's flow (phone call → later, separate in-app signup) is confirmed, from the statutory text itself, to be an "עסקת מכר מרחוק" (14ג(ו): phone is an explicitly enumerated remote-marketing channel; no shared physical presence anywhere in the flow). That triggers 14ג(א)'s independent, certain duty to disclose (at minimum) 7 specific items **as part of the remote-marketing approach itself** — i.e., during this call — regardless of the still-open general question (catalog §6 item 3) of whether the underlying transaction is "מתמשכת" or not. §6.6 below is a first-draft script covering all 7 items, explicitly flagged DRAFT/not-for-production.
- **Recording-consent disclosure:** unchanged from RSVPAgent's existing pattern; needs its own line in the final transcript (not drafted here — this plan's §6.6 covers the 14ג(א) items specifically, not the separate recording-notice line, which follows the same pattern already used elsewhere and doesn't need new legal analysis).
- **WhatsApp-specific consent for `send_signup_link` — RESOLVED as to legal basis, blocked on an evidentiary/engineering dependency (2026-08-22, new, prompted by `whatsapp-sales-link-real-build` making WhatsApp the primary channel).** §16ב-16ג (above) does not extend here — its "פנייה שיווקית" is defined as an approach "באמצעות שיחה" (via a call) specifically; a WhatsApp text is not a "שיחה," so that entire regime (prohibition *and* its Sixth Schedule exemption) simply doesn't reach it — this needed a different statute, not a broader reading of the exemption just verified. The correct anchor is **§30א(ב) itself** (verified directly, live Nevo text): "...בלא קבלת הסכמה מפורשת מראש של הנמען, בכתב, **לרבות בהודעה אלקטרונית או בשיחה מוקלטת**" — the statute itself names a recorded call as a form of the required consent-in-writing, for any of its four regulated channels (WhatsApp falls under "הודעה אלקטרונית," though which of the two message-channel categories exactly doesn't change the outcome — both sit inside the same closed list under the same consent rule). **This means the engineering team's proposed mitigation — an explicit, named opt-in question on the recorded call before attempting WhatsApp — is not only a Meta-policy fix, it independently satisfies Israeli law's own consent-capture mechanism**, provided the question names both the channel and the sender explicitly ("שאשלח לך בוואטסאפ, מטעם קלפה, את קישור ההרשמה?") rather than a vague "אשלח לך פרטים?" — same express-vs-inferred-consent distinction already flagged for the form's topic dropdown. Do not treat the link message itself as non-advertising/operational content to argue around this requirement — its entire purpose is completing a purchase, which is category-1 "דבר פרסומת" on its face; rely on consent, not on disputing the classification. **The real remaining gap is evidentiary, not legal**: this consent basis is only as good as the ability to later prove it — which depends on (a) this agent's calls actually being retained (catalog item #9, `retention_days`/`zero_retention_mode`, still undecided) and (b) a structured record of the question/answer/timestamp, not just something that happened in a UI once. **New catalog item #30** logs this as the thing that should gate real WhatsApp sends, separate from (and now downstream of) the legal analysis, which is settled. Full reasoning and the rejected-alternative note (30א(ג) considered, doesn't fit these facts): catalog §1.
- **Privacy Protection Law Amendment 13** (biometric voice data, in force Aug 2025): unchanged, applies identically to this persona as to RSVPAgent — no new finding.
- **Whether "closing" language itself is legally loaded**: unchanged, still an open design constraint on §3's wording — the agent must not imply a binding commitment was reached on the call itself.

**16ב-16ג is now resolved (above). Until §6.6's script has attorney sign-off and the plan's remaining technical/engineering gates (rls-schema-engineer, voximplant-engineer reviews) clear: no KB is written, no tool is built, no Voximplant scenario is drafted, no ElevenLabs agent is created.** This document may proceed to owner review; implementation may not.

### 6.6 Draft oral cancellation-disclosure script (14ג(א)) — DRAFT, NOT FOR PRODUCTION USE, requires attorney sign-off

Legal basis (verified against the live Nevo text of the Consumer Protection Law, 2026-08-22): **14ג(א)** — "בשיווק מרחוק חייב העוסק לגלות לצרכן פרטים אלה לפחות" — requires disclosure of 7 specific items as part of the remote-marketing approach (here: the call itself). This is independent of and does not wait on the still-open §6-item-3 "מתמשכת" classification question. There is a *separate* duty, 14ג(ב), for a **written** document no later than service delivery — the in-app signup/agreement flow can plausibly discharge that one; it does not discharge 14ג(א). Delivery point in the call: **after** the package/price is presented (Goal step 3) and objections are handled (step 4), **before** the agent asks for or accepts verbal commitment (step 6) — never after.

All `{{...}}` are dynamic values pulled live (tool call / injected variable, same discipline as `get_pricing` and RSVPAgent's dynamic variables) — **never hardcoded in the prompt**, per this plan's own §2 anti-hallucination rule and the codebase's `no-hardcoded-business-facts` house rule.

| # | 14ג(א) item | Draft spoken line (Hebrew) | Source of the `{{}}` values / open items |
|---|---|---|---|
| (1) | Business name, ID number, address (Israel + abroad) | "אנחנו {{company_name}}, מספר עוסק {{company_id}}, {{company_address}}." | Pull from the **same fields already maintained** for the signed-agreement template — `src/lib/agreements/template.ts`'s `c.company.name` / `c.company.id` / `c.company.address`, sourced from `getCompanyLegal()` (`src/lib/data/company.ts`, reads `app_settings`). **Verified 2026-08-22 (live DB query, not inference): these fields are fully populated** — `company_legal_name`="נתנאל מבורך קלפה - KALFA RSVP", a real `company_legal_id`, `company_legal_address`, phone and email are all set, not empty/TODO. No blocker here — the sales-agent script should read the same `getCompanyLegal()` data the agreement flow already uses. No "abroad" address exists — omit that clause. |
| (2) | Main characteristics of the service | (Typically already delivered naturally in Goal step 3's pitch — "פלטפורמת קלפה לניהול אישורי הגעה: ייבוא רשימת מוזמנים, פנייה בכמה ערוצים, איסוף תשובות, דוח בזמן אמת.") | No new line needed if step 3 already covers this — attorney should confirm step-3 phrasing counts, rather than requiring a redundant restatement here. |
| (3) | Price and payment terms | "המחיר: {{base_fee_display}} דמי הפעלה חד-פעמיים, כולל עד {{included_reached}} אנשי קשר שהגעתם אליהם, ועוד {{price_per_reached}} ש"ח לכל איש קשר נוסף שהגעתם אליו מעבר לכך. דמי ההפעלה נגבים תמיד, גם אם בסוף לא הגעתם לאף איש קשר — אין החזר עליהם. החיוב בפועל מתבצע רק בסיום הקמפיין, דרך אמצעי התשלום שתזינו בהרשמה." | Illustrative figures only (per team-lead: base≈200₪, per-reached≈4₪, as checked against the live `packages` table) — **must be pulled live via the same `get_pricing` tool §2 already specifies, never baked into this line**. The "always charged, no refund on the base fee" phrasing is deliberate — matches the corrected messaging already implemented per catalog item #18 (avoids repeating the outcome-only misrepresentation that item logged as a real incident). |
| (4) | Timing/method of delivery | "השירות מתחיל לפעול מרגע שתחתמו על ההסכם ותבחרו חבילה באתר, וממשיך עד תאריך האירוע." | Matches A-4's actual flow (sign up → event → package → e-signature → hold). |
| (5) | Period the offer remains valid | "המחיר שהצגתי הוא המחיר בקישור שאשלח לכם עכשיו — הוא תקף כל עוד לא נעשה בו שימוש ולא פג תוקפו." | **Deliberately tied to something that already exists architecturally (the signup-link token) rather than an invented time window** — but this creates a real dependency: §5.1's token design must actually carry/lock the quoted package and price at send-time, or this sentence becomes false. Flag to `voximplant-engineer`/whoever builds the token as a requirement, not an assumption. |
| (6) | Warranty details | "אין אחריות מיוחדת מעבר לתנאים בהסכם עצמו, שתקבלו ותוכלו לקרוא לפני החתימה." | Deliberately minimal — **do not** put any reach-based/outcome-based promise in this slot (e.g., "we only charge for what we deliver") — that phrasing belongs in item (3) with its accurate, unconditional framing, and repeating it here as a "warranty" risks re-creating the exact outcome-only misimpression catalog item #18 already flagged as a live incident. |
| (7) | Cancellation right | "יש לכם זכות לבטל את ההתקשרות תוך 14 יום — מהמאוחר מבין יום ביצוע העסקה, או היום שבו תקבלו את פרטי ההסכם בכתב. הפרטים המדויקים על אופן הביטול ודמי ביטול, אם יש, מופיעים בהסכם עצמו." | Deliberately says "מהמאוחר מבין..." per 14ג(ג)'s actual wording, not "14 days from today's call" (which would understate the right). Deliberately defers the **fee formula** to the written agreement — the 5%/₪100 cap mechanics, whether the base fee counts inside that cap, and the מתמשכת/לא-מתמשכת branch that determines which cancellation-window rule (14ג(ג)(2) vs. 14ה(ב1)) applies are **still open** (catalog items #16, #17, #26, #27) — this script must not assert a specific fee number or formula until those resolve. |

**Explicitly not resolved by this draft**: exact conversational phrasing/tone pass (this is legal-content-first, not yet run through the RSVPAgent house style for natural delivery), the recording-consent line (separate, not drafted here), and — most importantly — **attorney sign-off**, per this project's standing rule that all in-call legal disclosure content is DRAFT until reviewed (same status as the signed-agreement template and RSVPAgent's own disclosure lines).

---

## 7. Owner decisions (resolved 2026-08-22)

All five original open questions are resolved, plus one follow-on sequencing question the discount/consult design raised. Recorded here for traceability; the resolutions are already folded into §1, §4, §5.5, §8, and §11 above/below.

1. **Scope — CONFIRMED:** outbound-only, solicited callbacks only. No inbound sales calls handled by this persona. See §1.2.
2. **Discount authority — RESOLVED, not a flat no:** allowed in principle, but only via a tightly bounded, auditable mechanism — never open discretion. Owner's exact words: "it could be nice, but must be planned precisely so it doesn't end up offering discounts to everyone and causing losses." This plan proposed the mechanism (§11); **tier-1's cap is now decided (5%, owner-approved 2026-08-22, §11.1)** — the objection-trigger wording is the one piece still open.
3. **Definition of "closed" — RESOLVED:** verbal commitment + link sent + outcome recorded, since the agent structurally cannot capture signature/payment over voice. See §1.1.
4. **Compliance gate — RESOLVED, unchanged from this plan's original design:** stays a hard blocker on implementation (KB/tool/scenario work), not on the planning document. No build starts before `israeli-compliance-advisor` sign-off. See §6.
5. **Queue precedence — RESOLVED:** the AI may try first; human-first gating on the `sales` queue is **not** required. In exchange, the owner added a new hard requirement — a mid-call human consult path (not the existing full takeover) — see §5.5 and §8.
6. **MVP sequencing — RESOLVED, final, 2026-08-22:** v1 ships WITHOUT the consult path (§5.5), with discount authority limited to **tier-1 only** (§11) — no tier-2+, since that tier is specifically gated on consult existing. The full consult mechanism and tier-2+ discounts are a defined follow-on phase, not built now and not assumed to land alongside v1.

---

## 8. Coordination needed (not decided in this document)

- **Human monitor/takeover (A-9):** `advanceLegStatus` resolves the leg to attach via the cb-token → `call_attempts` path. If the sales agent uses a new, parallel context/callback pair (§5.1 option (a)), the existing takeover mechanism **does not transfer automatically** — someone has to wire an equivalent leg-resolution path for whichever new table holds the sales call's token. For a persona whose bad calls have direct revenue/reputation consequences, this is arguably a ship gate, not a nice-to-have. Owner: `voximplant-engineer`.
- **Mid-call human consult (§5.5) — defined follow-on phase, sequencing RESOLVED 2026-08-22:** since queue precedence no longer requires a human-first gate (§7 Q5/Q6), the consult path is the owner's actual safety net for AI-first dialing, not a nice-to-have layered on top — but it is NOT part of v1. Owner decision: ship v1 without it (tier-1-only discount authority, §11), build consult + tier-2+ as a named phase-2. When that phase starts, needs joint scoping: `voximplant-engineer` on call-UX feasibility of holding a live call for a bounded wait, plus whoever owns the web-push/ElevenLabs-tool-route side of the app for the synchronous reply mechanism itself.
- **Meeting-booking handoff:** when a prospect wants to think about it or asks for a scheduled follow-up, this plan reuses the *existing* `callback_requests` re-entry (a callback, not a "meeting"). If the meeting-booking agent introduces a genuinely different concept (a fixed date/time appointment, not just "call again later"), the two need to agree on which mechanism a "not ready yet" prospect actually lands in.
- **`escalated_to_human` outcome value (§4):** requires a `validation/admin.ts` + migration change if adopted — flagging for `rls-schema-engineer` rather than assuming it ships in v1.

---

## 9. Risks

- **Current standing volume is near-zero, but the historical record is NOT — do not use this to deprioritize (A-7).** Only 2 rows are live today, but the table shows clear evidence of being reset around the 19-20.8 redesign after holding at least 14 rows five days earlier. Treat volume as unknown-but-plausibly-real, not as evidence this persona is low-value. If prioritization against the other two parallel personas matters, get a real count from before the reset (application logs / Slack alert history / `logActivity` audit trail for `inquiry.callback_created` — never assume the current row count is the true historical volume) rather than relying on this table alone.
- **No real objection data yet.** §3's objection-handling content is necessarily generic (sales-skills catalog + KALFA's own facts) until real calls happen — plan for a fast iteration loop once live, not a "ship once" design.
- **Hallucinated pricing is a real liability, not just a UX bug** — a misquoted price on a sales call is closer to a contractual/legal problem than a wrong RSVP headcount is. §2's live-tool-call design exists specifically to prevent this; any implementation that weakens it (e.g., caching prices in the prompt, using "Prompt" RAG mode instead of "Auto" for pricing) should be treated as a regression.
- **Compliance is the actual critical path**, not the technical design — see §6.
- **Schema/telephony gap (A-10, §5.1)** is real engineering work, not a config change; do not underestimate it relative to RSVPAgent, which already had `call_attempts` to build on.
- **Discount mechanism (§11) is only as safe as its audit loop.** A bounded tier system still fails the owner's stated worry ("discounts to everyone") if nobody actually reviews the `discount_tier_applied` log — the mechanism prevents the agent from deciding unbounded, it does not by itself prevent quiet drift toward "always offer tier 1." Treat the audit step as required, not optional polish.
- **Consult-path timeout risk (§5.5).** If the owner is unreachable when a consult fires, the safe default (decline / "can't confirm now") is correct for discounts but may read as a dead end for the prospect on other future consult use cases — design the timeout copy carefully once this ships, not as an afterthought.

---

## 10. Staged verification (for when implementation is eventually approved)

1. KB content review against §2's static/live split — confirm no price/policy number was hand-typed into a KB document.
2. `get_pricing` tool: verify it reads the *same* `packages_public_read`-scoped data the public pricing surface reads, not a duplicate query path.
3. Prompt review against the prompting-guide anti-hallucination rule specifically for pricing turns (does every price-bearing agent utterance trace to a real `get_pricing` call in the transcript?).
4. Compliance script review (§6) signed off before any test call, including a recording-consent line specific to this persona.
5. `elevenlabs agents pull --update` → edit → `push` → `pull --update` verification loop, per `docs/voice-agent/elevenlabs-json-reference.md` §6 — no hand-edited/PATCHed config, no exception for this persona.
6. Verify against actual call audio (STT of the raw recording), not the agent's own transcript — the same rule that caught RSVPAgent's leaked English chain-of-thought bug that its own transcript hid.
7. Human-takeover leg attach tested live before any real prospect call, per §8's flagged gap.
8. First live calls run only against the 2 existing `callback_requests` rows (A-7) or freshly solicited ones — never a bulk/backfill dial of historical data without a fresh consent check.
9. Discount tiers (§11), if shipped, verified against a real logged sample: pull every `discount_applied` row for the first N calls and confirm each one matches its stated trigger condition before letting the mechanism run unattended.

---

## 11. Discount authority — bounded design proposal (owner-requested mechanism, exact numbers NOT approved yet)

Per §7 Q2: discount authority is allowed in principle but must be planned precisely, not left to the agent's judgment. **Tier-1's cap is now decided (5%, owner-approved 2026-08-22, §11.1); tier-2's 10% below remains illustrative-only since tier-2 is phase-2 and out of scope for v1 anyway.**

- **A short, admin-configured, closed list of discount tiers** — not a free percentage the agent can pick. Up to 2 pre-approved tiers, each a fixed % off `price_with_vat`: **tier 1 = 5% (approved, v1)**, tier 2 = 10% (illustrative only, phase-2, not approved). Configured the same way `packages` fields are today — admin-editable DB rows, never hardcoded in the prompt (same rule as pricing itself, §2).
- **Explicit trigger condition, not proactive offering.** The agent may only reach for a tier *after* the prospect has explicitly objected to price on this call — never volunteered up front, never used to "close faster." This is the direct answer to the owner's "doesn't end up offering discounts to everyone" concern: the trigger is a specific objection event in the conversation, not a default negotiating posture.
- **Tier 1 (the smaller, safer discount) is usable without a live consult** — bounded, low-risk, logged. **Tier 2 (or anything beyond tier 1) requires the mid-call consult path (§5.5)** before the agent may offer it — i.e., the larger the discount, the more a human is actually in the loop, not less.
- **Every offer and every application logged**, whether or not the prospect accepts: extend §4's outcome record with `discount_tier_offered` / `discount_tier_applied` (nullable) fields, plus an `activity_log` entry, so the owner can audit for drift or overuse on a regular cadence — the audit is a first-class part of this design, not an afterthought.

### 11.1 Phase split — FINAL, owner decision 2026-08-22

- **v1 (ships with this agent):** tier-1 discount authority ONLY, **cap = 5% of `price_with_vat`, owner-approved 2026-08-22.** No consult path, no tier-2+. This is a live config value the `apply_discount_tier` tool reads and returns (script draft §3) — never hardcoded into the agent prompt itself, same anti-hardcoding discipline as pricing (§2).
- **Phase 2 (defined follow-on, not built now, no target date set):** the mid-call consult mechanism (§5.5) and tier-2+ discount authority, which is gated on it. Do not build tier 2 ahead of consult, and do not treat this phase as implicitly bundled with v1 delivery — it is a separate, explicitly named piece of future work.

**Still requires explicit owner sign-off before v1 implementation**, specifically on: the precise wording of the trigger condition (what counts as "objected to price" — 5% itself is now settled, the trigger phrase-matching is not).
