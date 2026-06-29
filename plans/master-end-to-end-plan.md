# KALFA — Master end-to-end plan (current state → fully shipped)

> The single ordered source of truth. Consolidates every prior spec; marks DONE vs REMAINING; details each remaining stage to implementation grain; ends with the deploy + go-live sequence. Companion specs (referenced, not duplicated): `phase-0-1-implementation-spec.md`, `billing-controls-complete-plan.md`, `outreach-engine-c1-spec.md`, `2026-06-29-c2-voximplant-ai-call.md`, `provider-config-forms-spec.md`, `verification-corrections.md`, `plan-paid.md` (authoritative billing model), `full-product-completion-plan.md`.

---

## 0. CURRENT STATE (verified)
**Committed to main + applied to live DB (additive, all gated OFF):**
- **Phase 0** (`155eb15`) — zero-bill guard, credit subtraction, hold ValidPayment===true, orphan-contact prune, dashboard fixes.
- **Phase 1** (`33948ea`) — 0028 live: `try_record_billed_result` + `campaign_billing_summary` RPCs + `app_settings.outreach_enabled/close_charge_enabled` + `whatsapp_*` + `contacts.whatsapp_consent_at`; casts dropped; D4 webhook removal handling.
- **Phase 2** (`d648148`) — 0024+0029 live: `campaign_authorized_contacts` + knobs; RPC SET-membership cap (`not_authorized`, fail-closed); snapshot from current-guest contacts (REPLACE); hold = max(covered,set)×price, ceiling = full×price (D1=No); outreach bound to set.
- **C0** (`0eeafb0`) — `/admin/channels` WhatsApp config form (Tabs+Accordion, masked secrets, webhook wiring, test-connection).

**Live DB migrations applied:** 0023–0029. **Code NOT deployed** (beta runs the prior build; safe — new DB objects are additive + gated). **Gates:** 412 tests, lint/tsc/build clean.

**The 7 settled decisions (binding):** D1=ceiling governs (hold=security) · A1=price VAT-inclusive · D2=bill while paused · D3=call reached=DTMF/ASR-human+admin-config · D4=removal bills · D5=credits per-campaign gross · D6=reopen admin-only · D7=link confirmation via paid outreach bills.

---

## 1. THE END-TO-END RUNTIME FLOW once shipped (anchors completeness — every hop must have an owner)
```
Owner: create event → import guests → contacts derived (dedup E.164)
  → create campaign (template: price/channels/schedule locked)
  → sign agreement (OTP, PDF hashed)
  → APPROVE → J5 hold: snapshot authorized SET (covered) + size hold + tokenize card   [Phase 2 ✓]
  → ACTIVATE (requires capture_status=authorized)                                        [Phase 3 UI ▢]
Engine (per contact, §10):  [C1 ▢]
  WhatsApp template → wait → reminder(s) → escalate to AI-call → STOP on reached
Guest reaches back:
  · WhatsApp inbound (human) ─┐
  · AI-call DTMF/ASR (human) ─┼─→ recordReached → try_record_billed_result   [WA ✓ webhook / call ▢ C2]
  · RSVP link confirm (D7)  ──┘     (SET-membership cap + UNIQUE(event,contact) ⇒ ONE charge) [Phase 2 ✓ / link ▢ Phase 4]
  removal intent → bills then stops future outreach                                       [✓ D4]
Owner watches: reached / accrued / ceiling / uncharged breakdown + evidence              [Phase 3 ▢, §15/§16]
Close:  closeCampaign → final charge = min(accrued, ceiling) − credits → SUMIT capture    [✓ logic / Phase 3 UI ▢]
  → receipt stored + emailed                                                              [✓ capture / ▢ PDF-to-Storage]
Admin: provider creds (WhatsApp ✓ / Voximplant ▢), credits, reopen, disputes             [C0 ✓ / C2 ▢ / Phase 5 ▢]
```
Legend: ✓ done · ▢ remaining (mapped below).

---

## 2. EXECUTION ROADMAP (ordered; each stage = goal · files · key flows · migration · tests · gate)

### H1 — Hardening: `campaigns.max_contacts NOT NULL` (small; before go-live)
- **Why:** the SET-membership is the primary cap, but a NULL max_contacts disables the secondary count cap (defense-in-depth, flagged by Phase-2 verify).
- **[יוצר]** migration `0031_max_contacts_not_null.sql`: backfill null → `countUniqueContactsForEvent`-equivalent (or 0 for draft), then `alter column set not null default 0`. Introspect existing nulls first (sb-query).
- **Apply-gated.** Test: a campaign can't be created/held with null max_contacts. Low risk; can ship with Phase 3.

### T0 — Templates & call-scripts management (CRITICAL PREREQ — was an undetected hole)
- **The hole:** `outreach.ts` calls `getTemplateByKey` → reads `public.message_templates`, but that **table does NOT exist live** (`to_regclass` null). So outreach today has NOTHING to send. C1/C2 cannot function without it.
- **[יוצר]** `0030_message_templates.sql`: `message_templates(id, key unique, channel campaign_channel, name, language, body, status, active, created_at)` + admin RLS (admin ALL; the outreach reader uses service-role). Seed the keys the live `outreach_schedule` references (`invite, reminder_1, reminder_2, call_1, final`).
- **[יוצר]** `/admin/templates` page/form/actions (reuse Tabs+Accordion + the admin form pattern): manage WhatsApp template rows (key→Meta-approved `name`+`language`) and call scripts (`channel='call'`, the IVR/TTS text). WhatsApp `name`/`language` MUST match a Meta-APPROVED template (the form notes this; optional WABA template-sync later via `whatsapp_business_account_id`).
- **[מרחיב]** drop the `message-templates.ts` cast after regen (the last remaining cast). **[מרחיב]** nav.
- **Tests:** getTemplateByKey returns active row by key+channel; admin CRUD. **Gate:** standard. Apply-gated.

### C1 — Outreach engine (the §10 driver) — SPEC: `outreach-engine-c1-spec.md` (+ verify corrections)
- **Goal:** pg-boss scheduler + per-contact state machine drives WhatsApp→wait→reminder→escalate-to-call→stop-on-reached.
- **INFRA (needs your setup):** a 2nd pm2 process `kalfa-worker` (esbuild bundle `dist/worker.cjs`) + a server-only `SUPABASE_DB_URL` (SESSION-mode pooler/direct, SSL). Web stays pg-boss-free.
- **[יוצר]:** `worker/main.ts`, `worker/empty.js`, `src/lib/queue/queues.ts`, `src/lib/data/outreach-engine.ts` (seed/arm/run/sweep/writeReach/cancelOutreachForContact/isContactEligible), `src/lib/outreach/schedule.ts` (pure timing), `0032_outreach_state.sql` (the cursor table + RLS).
- **[מרחיב]:** `outreach.ts` (extract `sendOneWhatsApp`), `campaigns.ts` (`activateCampaign` seeds `outreach_state`), `package.json` (worker:build/start + esbuild), pm2/deploy docs.
- **CORRECTIONS from verify (fold in):** (a) dispatch contract — C2 owns `work('outreach-call-request')` per-contact consumer; demote any batch dialer to interim manual. (b) `writeReach` signature MUST include `campaignId`+`attemptId` and go through `recordReached`/the RPC (never a raw insert). (c) prereqs: the 2 RPCs + `campaign_authorized_contacts` (now all live ✓).
- **Eligibility:** the engine sends only to `listSendableContacts(eventId, campaignId)` (set-bound, consent, not-removed). reached ⊆ set holds.
- **Tests:** pure schedule; engine (fail-closed, reach short-circuit, compare-and-advance once, provider-reject advances, infra-error retries safe); pg-boss integration (CI).
- **Gate:** lint/tsc/build/vitest + `worker:build` boots `dist/worker.cjs` against `SUPABASE_DB_URL` and shuts down on SIGTERM.

### C2 — Voximplant AI-call channel — SPEC: `2026-06-29-c2-voximplant-ai-call.md` (+ verify corrections)
- **Goal:** the 2nd channel — outbound AI call, classify human interaction (D3), bill via the same RPC (cross-channel dedup).
- **[יוצר]:** `0033_voximplant_call_config.sql` (`app_settings.voximplant_* + call_*` tuning + `contacts.call_consent_at` + `call_dnc_list`), `src/lib/voximplant/client.ts` (Mgmt API via fetch — StartScenarios, NO SDK), `src/lib/voximplant/classify.ts` (pure D3 classifier, admin-tuned), `src/app/api/webhooks/voximplant/route.ts` (own HMAC verify → classify → `recordReached(channel='call', evidence call_dtmf|call_asr)` + `cancelOutreachForContact` + `outreach_state='reached'`), the VoxEngine scenario artifact (AMD before ASR; `phraseHints`; Hebrew TTS).
- **[מרחיב]:** C1's `work('outreach-call-request')` consumer dials ONE contact via the client; `listCallableContacts` (call_consent + not-DNC + set-bound); the **C0 Voximplant card** (currently a placeholder) → real form (account_id/api_key/rule_id/caller_id/callback_secret + D3 tuning, masked + HelpTips + callback-URL wiring + test).
- **DECISIONS for C2 (open): consent model · IVR-vs-LLM v1 (rec. deterministic IVR) · ASR model/thresholds · caller-id.** LEGAL: Israeli DNC (Amendment 61) scrubbing + `call_consent_at` + mandatory AI-disclosure line.
- **Gate:** standard + the classifier unit tests (the money logic) + webhook HMAC test.

### Phase 3 — Campaign lifecycle UI + owner billing dashboard (§9/§11/§15/§16)
- **Goal:** wire the orphaned lifecycle (activate/pause/close + the final-charge trigger) and give the owner the rich, transparent view.
- **[יוצר]:** `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx` — management screen (Tabs+Accordion, reuse `ui/*`): status + transitions (activate/pause/close → existing data fns), the §15 board (uploaded/unique/invalid/reached/accrued/ceiling/balance + the "NOT billed" breakdown), per-contact §11 status, and §16 evidence per billed result.
- **Growth-warning + coverage-expansion (Phase-2 deferred):** when eligible current-guest contacts exceed the authorized set, surface "N beyond your authorized X — raise authorization to reach them" + a re-authorize/top-up path (re-snapshot REPLACE + delta-hold); for `full > extreme_threshold` the explicit owner choice (cover-all-with-larger-hold vs cap-at-N).
- **[מרחיב]:** `events/[id]/page.tsx` link to campaign management; `close-charge` trigger surfaced behind the gate.
- **Leftover Phase-2 [מרחיב] (fold in here):** (a) **receipt PDF → Storage** — close-charge stores only the URL; download the bytes via `POST /accounting/documents/getpdf/` to a PRIVATE Storage bucket for a durable copy. (b) **card-expiry check before close** — if `card_exp_*` is past, route to `hold_review`/re-hold instead of a doomed charge.
- **D6 reopen-after-close (was a hole — no function exists):** **[יוצר]** `reopenCampaign(campaignId)` (admin-only, audited) closed→active within a documented window; ceiling + dedup still bind; default OFF.
- **Tests:** transition guards; dashboard aggregations; growth-warning threshold; reopen audit. Gate: standard.

### Phase 4 — Public guest RSVP `r/[token]` (the missing core) — backend PARTIALLY ready (verified)
- **Reuse (do NOT recreate):** anon RPCs `get_rsvp_by_token` + `submit_rsvp` (atomic, audit) already live; `rsvp_token` auto-gen + index live.
- **[יוצר]:** `src/app/(public)/r/[token]/page.tsx` + form + `actions.ts` — calls `get_rsvp_by_token` (pre-fill) → `submit_rsvp`; generic privacy-safe errors; the `RSVP_READ_RATE/RSVP_SUBMIT_RATE` constants wired.
- **[מרחיב-RPC] real work (verify-flagged):** add **event status / `rsvp_deadline` / revocation** enforcement AND throttle **INSIDE** the RPCs (anon is callable directly at `/rest/v1/rpc/...`, bypassing any route limit); `get_rsvp_by_token` returns current `confirmed_*` for pre-fill → migration `0034_rsvp_guards.sql`.
- **[מרחיב] link delivery:** the engine/`whatsapp-send` builds + sends `rsvp_token`→`/r/[token]`.
- **[מרחיב] D7 billing:** a link confirmation delivered via paid outreach → `try_record_billed_result` (billable, cross-channel dedup), not just an RSVP-outcome update.
- **Tests:** token validity/expiry/closed-event rejection; atomic submit; rate-limit; D7 dedup. Gate: standard.

### Phase 5 — Org completion + orders + secondary
- **Org multi-tenancy completion (was a hole — `requireEventAccess` has 0 callers, members can't reach events):** **[מרחיב]** swap event-scoped reads `requireOwnedEvent`→`requireEventAccess` at the call sites; **[יוצר/migration]** widen event-table RLS from owner-only to org-membership (`can_access_event`), introspecting live policy names first → `0036_event_rls_org.sql`. Tests: a viewer/member access matrix; non-member → notFound.
- **Orders (RESOLVED default — hide):** hide the `/app/orders` nav item (the live commercial model is per-reached via campaigns; orders/checkout is not the model). Revisit only if a one-time-purchase product is added. **[מרחיב]** remove/guard the nav entry.
- **Invite email:** **[מרחיב]** wire `email/sender.ts` (replace the UI-link stub) + a template.
- **Secondary [מרחיב]:** event delete, group-mgmt UI, events pagination, manual-reconcile UI, receipt-in-orders, payment audit-log, `accept_invitation` null-email edge, `listMembers` N+1.

---

## 3. MIGRATIONS REMAINING (all additive, apply-gated by you)
`0030_message_templates` (T0) · `0031_max_contacts_not_null` (H1) · `0032_outreach_state` (C1) · `0033_voximplant_call_config` (C2) · `0034_rsvp_guards` (Phase 4) · `0036_event_rls_org` (Phase 5 org) · (`0035` whatsapp_business_account_id only if WABA template-sync is built). Apply order respects deploy: schema before the code that uses it; C1/C2 schema before enabling their flags; T0 before C1 (the engine needs templates to send).

---

## 4. DEPLOY + GO-LIVE SEQUENCE (the safe order — nothing live fires until explicitly enabled)
1. **Deploy the committed code** to beta (pm2 `kalfa-beta`, `next build --webpack`) — DB already matches (additive). Smoke-test authed pages + the admin channels page.
2. **H1 + C1 infra:** apply 0031/0032; provision `SUPABASE_DB_URL`; register `kalfa-worker` in pm2; `worker:build`; boot the worker.
3. **Provider creds:** admin enters WhatsApp creds in `/admin/channels` → **test connection** green. (Voximplant after C2.)
4. **Enable ONE channel at a time, on a test event first:** flip `outreach_enabled` → run a real campaign end-to-end with a tiny authorized set → verify reached/charge on a live ₪ test (mirrors the SUMIT ₪4/₪1 validation) → then `close_charge_enabled`.
5. **Voximplant (C2):** apply 0033 → creds + DNC → enable `voximplant_enabled` → test call.
6. Each flip is reversible (flags default false). Never enable a channel whose **test connection** isn't green or whose **authorized set** isn't snapshotting.

---

## 5. DECISIONS — ALL RESOLVED (defaults set so nothing blocks; override any in writing)
| # | Decision | RESOLVED default | Needs you? |
|---|----------|------------------|-----------|
| C2-consent | call consent model | transactional, event-scoped, explicit `call_consent_at` (mirrors WhatsApp); no marketing without it | confirm |
| C2-v1 | IVR vs LLM | **deterministic IVR** (no LLM) — satisfies "reached" + RSVP capture; LLM later via our own Claude endpoint | — |
| C2-asr | ASR model/thresholds | `he-IL` `phonecall`, confidence ≥ 60 (model scale), min-utterance 800ms, DTMF keys `1234567890*#` — all admin-tunable | — |
| C2-callerid | caller id | a Voximplant-purchased ISRAELI number — **you procure 1 number**, then set it in `/admin/channels` | **procure** |
| P4-timing | build RSVP now/later | **now** (core feature) | — |
| P5-orders | checkout vs hide | **hide** the nav item (live model = per-reached) | confirm |
| VAT | SUMIT company VAT | **verify = the agreed rate (18%)** in SUMIT settings — receipt breakdown only; the total is already exact | **verify** |
| order | phase order | H1→deploy→T0→C1→Phase3→C2→Phase4→Phase5 | — |
> The only 4 items that genuinely need YOU (not blockers, parallelizable): procure 1 Voximplant IL number · confirm SUMIT VAT · confirm consent-model wording with counsel · confirm "hide orders". Everything else is decided.

## 6. NO-HOLES COMPLETENESS MATRIX (every runtime hop + admin surface + data object has an owner)
| Concern | Owner stage | Status |
|---|---|---|
| event/guests/contacts/dedup | shipped | ✓ |
| campaign create + agreement + J5 hold + **frozen set** | Phase 2 | ✓ live |
| **billing source-of-truth + cap + dedup + exact charge + credits** | Phase 0/1/2 | ✓ live (gated) |
| **templates/call-scripts to send** | **T0** | ▢ (hole closed) |
| outreach engine (§10 drip + escalate + stop-on-reach) | C1 | ▢ |
| WhatsApp send + inbound + removal (D4) | shipped | ✓ (gated) |
| AI-call channel + D3 classify | C2 | ▢ |
| reached → ONE charge across 3 channels | Phase 2 RPC | ✓ |
| lifecycle UI (activate/pause/close) + owner dashboard (§15/§16) | Phase 3 | ▢ |
| growth-warning + coverage-expansion (extreme) | Phase 3 | ▢ |
| receipt PDF durable + card-expiry guard | Phase 3 | ▢ |
| reopen-after-close (D6) | Phase 3 | ▢ (hole closed) |
| public RSVP `r/[token]` + RPC guards + link delivery + D7 | Phase 4 | ▢ |
| provider creds admin (WhatsApp/Voximplant) | C0 ✓ / C2 ▢ | partial |
| admin: credits/grant · suspend · plan | shipped | ✓ |
| **org members access events (RLS + requireEventAccess)** | **Phase 5 org** | ▢ (hole closed) |
| invite email delivery | Phase 5 | ▢ |
| `max_contacts` NOT NULL defense | H1 | ▢ |
| deploy + per-channel go-live + live ₪ test | §4 sequence | ▢ |
**No remaining unowned hop.** The 4 holes this pass uncovered (templates, org-RLS, D6 reopen, receipt-PDF/card-expiry) are now assigned stages.

## 7. RECOMMENDED ORDER + verification discipline
**H1 → deploy → T0 → C1 → Phase 3 → C2 → Phase 4 → Phase 5.** (T0 before C1 — the engine needs templates to send; C1 before Phase 3 — the UI drives a real engine; Phase 3 before C2 — the dashboard exists when the 2nd channel adds data; Phase 4 after deploy.) Every stage ends green on `lint · tsc · build(--webpack) · vitest` + a live-DB check + (migrations) apply-gated approval; nothing enabled without its test passing. Each remaining stage gets a full implementation spec BEFORE coding (the Phase 0+1 pattern); C1/C2/C0 already have standalone specs.
