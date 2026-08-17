# Agent Console — server-side API contract (first verified 2026-07-21; partially superseded 2026-08-17)

The Android agent console (`nm-digitalhub/KALFA-ELEVENLABS`, package `me.kalfa.agentconsole`)
is a **separate repository**. This document is the server side's record of what that app
already calls, what exists here, and what does not. It is written from a full read of the
app's sources at commit `cc89325`, not from its README.

Nothing here is aspirational: every "exists / missing" verdict below was checked against
`src/app/api/**` and the live database on 2026-07-21.

> ## ⚠️ Read this before trusting anything below — corrections of 2026-08-17
>
> **The 2026-07-21 body of this file is now wrong in several load-bearing places, and it
> actively misled two separate readers on 2026-08-17 before being re-checked.** It is
> corrected in place below rather than rewritten, so the drift itself stays visible; this
> block is the index of what moved.
>
> Sections marked **[STALE 07-21]** below were true when written and are false now. Sections
> not marked were re-verified on 2026-08-17 and still hold.
>
> 1. **"the app has no Voximplant SDK" — FALSE.** `gradle/libs.versions.toml` declares
>    `com.voximplant:android-sdk-bom:3.2.0` plus `-core` and `-calls`, used across ~10 files
>    under `telephony/vox/`. The SDK line is **v3**, not the v2 this file's login section
>    describes.
> 2. **"`SupabaseCallEngineImpl` returns a `MockCallSession` from all three call paths" —
>    FALSE.** Those three methods now `throw UnsupportedOperationException` on purpose
>    ("fail loudly instead of faking"). The mock survives only as a DEBUG fallback and is
>    refused in `release` by `DependencyContainer.mockOrFailClosed`.
> 3. **"Endpoints the app calls — none of which exist here" — FALSE.** Most now exist; see
>    the corrected table in that section.
> 4. **A whole capability is missing from this file:** the **inbound-to-human** path
>    (Voximplant `onIncomingCall` → `VoxIncomingCallCoordinator` → `CallEngine.attachIncomingSession`)
>    was built from 2026-08-14 onward, after this file was written. It is wired end-to-end
>    **in code** and **has never been verified on a physical device** — in particular
>    *whether audio is actually two-way after `answer()` has never been tested on a live call*.
> 5. **`console_agents.vox_username` is populated** (1 of 1 agent), not NULL as stated below.
>
> **What did NOT change, and is the honest headline:** the app still cannot place an
> agent-initiated outbound call, and still cannot monitor or take over an AI call. But the
> reason is no longer "no SDK" — it is that `startOutboundCall` / `monitorCall` /
> `takeoverCall` are unwired, and monitor/takeover are additionally gated server-side by
> `app_settings.monitor_enabled` (verified **`false`** on 2026-08-17) until the `RSVPAgent`
> scenario carries the supervisor-conference topology.
>
> **Distinction this file never drew, and should have:** `startOutboundCall` (agent-initiated
> dial that puts a leg on the agent's own device — does not exist) is NOT the same as
> `enqueueOutboundCall` → `POST /api/events/{eventId}/outreach-call` (real, live,
> worker-driven, with `409 already_reached` handling). The app *can* cause a real outbound
> call today; it just does not join that call from the handset.

## Why this file exists

The app was deliberately built against a contract that the server had not yet implemented —
its own `AGENTS.md` says so ("Routes may not exist yet server-side — code against this
contract exactly"). That is a reasonable way to parallelise, but it leaves a trap: the
contract lived only in the app repo, so nothing on this side recorded that five endpoints
were already being called in production code paths. This closes that gap.

## The two halves, and which is actually blocked

The app is often described as "all mock". It is not, and the distinction matters for
sequencing:

| Half | State | Depends on this repo? |
|---|---|---|
| **Data layer** — call feed, campaigns, RSVP results, call analysis, live captions | **Real and working.** `data/SupabaseImplementations.kt` reads the `console_*` views through PostgREST with the agent's own JWT, plus Realtime on `console_call_feed` and Broadcast for captions. | **No.** It needs no route from us — RLS and `is_console_agent()` are the whole authorization story. |
| **Telephony** — outbound, monitor, takeover, mute/hold/DTMF | **[STALE 07-21]** ~~Mock. `SupabaseCallEngineImpl` returns a `MockCallSession` from all three call paths; the app has no Voximplant SDK and (until 2026-07-21) declared no audio permissions.~~ **Corrected 2026-08-17:** the SDK is real (v3.2.0) and audio permissions are requested at runtime. Those three methods now THROW rather than fake. Mute and audio-routing are real and reach the UI; `hold` and `sendDtmf` have real SDK implementations with **no UI entry point** (deliberate — documented in `ActiveCallScreen.kt`). Inbound-to-human is wired end-to-end in code, unverified on a device. | **Partly.** Outbound-from-handset needs app wiring only. Monitor/takeover need this repo *and* the VoxEngine scenario. |

So the data half is unblocked and should not wait on us. The telephony half cannot be
finished in the app alone, because the Voximplant password must never ship inside an APK.

## Endpoints the app calls — **[STALE 07-21]** the heading's "none of which exist here" is false as of 2026-08-17

All are `POST`, base `https://beta.kalfa.me`, `Authorization: Bearer <supabase-jwt>`.
Call sites are in the app's `data/SupabaseImplementations.kt`.

The "Exists here" column below is re-verified 2026-08-17 by enumerating `src/app/api/**`
route files directly. Note two of the 07-21 paths were **guesses that the server did not
adopt** — the real paths differ, and an app still calling the old ones would 404.

| Route (as built) | Body | Exists here | Note |
|---|---|---|---|
| `/api/agents/sdk-auth` | `{one_time_key, username}` → `{hash}` | **Yes** | 07-21 predicted `/api/sdk-auth`; the built path is namespaced under `agents/` |
| `/api/agents/status` | `{"status":"ready\|not_ready\|dnd"}` | **Yes** | |
| `/api/agents/shift` | `{"active":bool}` | **Yes** | Not in the 07-21 list at all — added for the push-wake retry wave |
| `/api/agents/telemetry` | — | **Yes** | Not in the 07-21 list at all |
| `/api/calls/{callAttemptId}/agent-command` | `{"command":…}` | **Yes** | See the command-name mismatch section below — still the authority on wire format |
| `/api/calls/{callAttemptId}/end` | `{}` | **Yes** | Not in the 07-21 list at all |
| `/api/calls/{callAttemptId}/monitor` | `{"mode":"monitor\|takeover"}` | **Yes, but gated** | Answers `503` while `app_settings.monitor_enabled` is false (verified **false**, 2026-08-17) |
| `/api/events/{eventId}/outreach-call` | enqueue a worker-driven call | **Yes** | The app's only real outbound path; handles `409 {code:"already_reached"}` |
| `/api/campaigns/{id}/status` | `{action: activate\|pause}` | **Yes** | 07-21 predicted `/start` · `/pause`; the built path is one route with an action |
| `/api/calls/outbound` | `{"phone":…,"event_id":…}` → `{call_id}` | **No — and none is planned under this name** | This was the agent-initiated dial. It is unbuilt on BOTH sides: the app's `startOutboundCall` throws, so nothing calls it |

What *does* exist under `src/app/api/`: `voximplant/{ctx,cb,account-callback}/[token]`,
`voximplant/agent-tool/{rsvp,dnc,note}/[token]`, `elevenlabs/rsvp/update`,
`campaigns/[id]/{authorize,close-charge,whatsapp-send}`, `webhooks/whatsapp`,
`admin/sumit-test`. The `agent-tool/*` routes are **not** related: they are the AI's own
client tools during a call, token-authed, not the human console.

### `/api/agents/sdk-auth` — **[STALE 07-21]** no longer a blocker; built and live

Corrected 2026-08-17: the route exists, and the two "simply not connected" items below are
now connected — `console_agents.vox_username` is **populated** (1 of 1 agent), and the app
reads it. The SDK line is **v3**, not the v2 described here; v3 additionally supports a
persisted-token silent login (`loginWithAccessToken` / `refreshToken`) which the app uses on
the push-wake path, where no human is present to drive an interactive login. The one-time-key
exchange below is still accurate for the *interactive* foreground login, and the reason it
must be server-side is unchanged:

```
app:    connect → requestOneTimeKey(username) → oneTimeKey
server: hash = MD5(oneTimeKey + "|" + MD5(user + ":voximplant.com:" + password))
app:    loginWithOneTimeKey(fullUsername, hash)
```

The account password is the input to that hash, so the hash must be computed here. There is
no variant of this flow where the app can authenticate alone — which is why "server first"
is a fact about the protocol, not a scheduling preference.

Two things already exist for it and are simply not connected:

- **`console_agents.vox_username`** — the per-agent Voximplant user. ~~Nullable and currently
  NULL for the one enrolled agent, so provisioning is unbuilt.~~ **[STALE 07-21] — corrected
  2026-08-17: populated, 1 of 1 agent.**
- **`console_me.vox_username`** — already exposed to the app by the view. ~~The app's `MeRow`
  DTO does not read it yet.~~ **[STALE 07-21] — the app reads it; `VoxConfigTest` guards the
  full-username format, which is the app's #1 silent auth failure.**

**Billing note:** client-SDK logins count against Voximplant's Monthly Active Users quota
and fail with `LoginMauAccessDeniedError`. Whatever we build should not encourage the app to
log in on every launch. **Refined 2026-08-17:** MAU counts a unique *credential per month*,
not a login event — multiple devices and repeated silent logins on the SAME credential are
one MAU. The "don't log in speculatively" discipline is still right for the interactive path,
but MAU exhaustion is not a realistic risk for push-wake re-logins.

## What the app writes directly (no route involved)

Deliberately narrow, and both are permitted by the grants this repo set on 2026-07-21:

- `agent_status` — upsert of the agent's **own** row (`authenticated=arw`).
- `console_call_feed.handled_by` / `agent_id` — takeover ownership only (`authenticated=rw`).

Everything else is read-only from the app's side. RSVP outcomes belong to the ElevenLabs
client-tools pipeline; campaign state is billing-coupled to SUMIT and must never be flipped
from a client.

## Schema drift the app has not caught up to

`console_call_feed` gained three columns on 2026-07-20 that the app's `DbConsoleCall` DTO
does not read: **`takeover_claimed_at`**, **`takeover_request_id`**, **`participation_state`**.
These are the coordination fields that stop two agents claiming the same call. Any real
takeover implementation has to use them; today the app would race.

## Defects on the app side that constrain our design

Two matter to us specifically:

1. **`saveRsvpResult` is an empty function.** The in-call screen collects an answer, a guest
   count and notes, calls it, and hangs up — writing nothing and reporting nothing. If we
   ever expose an RSVP write route, it must be *impossible* to call it and get silence; and
   until then the app should disable the form rather than pretend.
   **Update 2026-08-17:** `saveRsvpResult` is *still* an intentionally empty body (RSVP
   outcomes belong to the ElevenLabs client-tools pipeline; the console must never write
   them) — but the data-loss path is gone: the RSVP form was removed from every screen, so
   nothing collects an answer only to discard it. **The real gap this leaves is worth naming
   and is a product decision, not a wiring gap: an agent on a live call has nowhere in the
   app to record what the guest said. Do not close it by inventing a client-side write.**
2. **[STALE 07-21]** ~~`startOutboundCall` posts a hardcoded `"event_id":"default-event"` and
   builds its JSON by string concatenation with the phone interpolated.~~ **Corrected
   2026-08-17: fixed on the app side.** The hardcoded `"default-event"` and the concatenated
   JSON are gone; the real outbound path (`enqueueOutboundCall` → `/api/events/{eventId}/outreach-call`)
   posts a real `eventId`/`guest_id` pair through a serializer. The design warning is kept
   anyway, because it still binds anything built later: **if an agent-initiated dial route is
   ever added, it must reject a non-UUID `event_id` loudly rather than coerce it.**

## Related state, verified 2026-07-21

- Live routing: `app_settings.voximplant_rule_id = 1520915` = rule `OutCallAgent` → scenario
  `RSVPAgent` (#918450) on `kalfa-rsvp` (app 11107202). `voximplant_live_calls = true`.
  Rule `OutCall` (1494311 → `RSVP`, the old DTMF path) still exists but nothing routes to it.
- The bridge is proven in production, not merely configured — session `6899241664`: 61s,
  `end_code 200`, ElevenLabs QA 100/100 on all four criteria, RSVP captured as
  `attending, 1 adult`.
- Groq is out of the stack: the ctx `groq_key` field and its 404 gate, the dial gate, the
  admin surface, `getVoximplantGroqKey()` and the `voximplant_groq_api_key` column
  (`20260721033000`) are all gone. The ElevenLabs agent is the dialogue brain.
- **`kalfatest` (app 11107302) is disconnected — do not build or test against it.** The
  application object still exists on the account, but its last session was 2026-07-19 20:28
  UTC with zero sessions on 07-20 and 07-21, and nothing in this repo routes to it. The
  bridge moved off it: `VoiceAgentTest` was renamed `RSVPAgent` and promoted to `kalfa-rsvp`.
  What remains there (`KALFA`, `OutCallPreview` → `RSVPPreview`, `VoiceABTest`) is PoC
  debris pending cleanup. Note that `npm run voximplant -- rules` enumerates rules for the
  production app only, so that list comes from `voxfiles/applications/…/rules.config.json`,
  not from the platform — the disconnection itself is measured from call history.
- Placing a bridged call: `npm run bridge:call` (formerly `bridge:test-call`). Despite the
  old name it is a real dial path — with no campaign enabled the worker dispatcher never
  runs, so it is the only thing that dials, and it now persists
  `vox_call_session_history_id` and `media_session_access_url` via the same
  `recordDialConfirmed` the dispatcher uses. **Rows created before 2026-07-21 03:45 have
  both columns NULL**; a live-session command channel needs a call placed after that.
- Console access requires staff: `is_console_agent()` is `is_staff() AND exists(console_agents…)`
  (`20260720234500`) and `console_agents.user_id` is an FK to `platform_staff(user_id)`
  `ON DELETE CASCADE` (`20260721005100`). Removing an agent from staff revokes console access
  immediately — the app should read a sudden empty feed plus RLS denials as revocation, not
  as a network fault.

## ~~BLOCKING~~ **RESOLVED 2026-08-17** — the app and the server schema disagreed on every command

> **This section is kept as a record; the conflict it describes no longer exists, and it was
> resolved the OPPOSITE way from the recommendation at the bottom of it.**
>
> `src/lib/validation/agent-console.ts`'s `agentCommandBodySchema` now accepts exactly the
> four names the app sends — `contextual_update`, `user_message`, `clear_buffer`,
> `close_agent` — in the app's **flat** shape (`{command, ...fields}`), not the nested
> `{command, payload:{…}}` this section proposed. The server adopted the app's wire format.
> That file's own header records the reasoning and cites the app's serialiser line.
>
> The closing warning below still stands and is the reason this section is not deleted:
> **the two repos must not be allowed to drift silently again.** One live mismatch survives
> and is tracked in the app's `AGENTS.md` (Known state 8): the control labelled "השתק AI"
> sends `clear_buffer`, which flushes the AI's buffer (barge-in) rather than muting it. The
> wire format agrees; the *label* lies. Rename the control or change the command.

**[Historical, 2026-07-21 — the conflict as it stood then]**

`src/lib/validation/agent-console.ts` now exists on `origin/claude/session-8vlt7m` (`7e78f4d`).
It is good work — discriminated union, honest `delivered` vs `applied` acks, `in_call`
correctly rejected as client-submitted presence. But it does **not** match what the app
currently sends, in two independent ways. Either alone yields a 400 on every command, and
`strictObject` guarantees it.

**Command names:**

| App sends (`ConsoleViewModel.kt:271,276,280`) | Schema accepts |
|---|---|
| `contextual_update` | `agent_context_update` |
| `clear_buffer` | `ai_clear_buffer` |
| `close_agent` | `ai_close` |
| `user_message` (declared in `Telephony.kt:34`, never called) | — dropped |
| — | `call_end` — server-only, the app never sends it |

**Payload shape** — the app builds the body flat:

```kotlin
buildJsonObject { put("command", command); payload.forEach { (k,v) -> put(k,v) } }
// → {"command":"contextual_update","text":"…"}
```

The schema requires it nested: `{"command":"agent_context_update","payload":{"text":"…"}}`.

**This must be resolved before the route is built, not after.** The server names are better
(`ai_*` / `agent_*` prefixes make the target explicit, and `call_end` is a real capability the
app lacks), so the cheaper fix is on the app side — but the decision belongs to whoever owns
the app, and the app's `AGENTS.md` API-contract section must be updated in the same change.
Whichever way it goes, the two repos must not be allowed to drift again silently: this
mismatch existed for hours because nothing on either side compared the wire formats.

## Addendum 2026-07-22 — already_reached end-to-end

Deployment status: **DB LIVE** (both migrations applied, pg_catalog readback
verified) · **server code DEPLOYED** (2026-07-22 evening, deploy `mrwfoluv` —
route + worker restarted, retention queue/schedule registered, post-deploy
smoke passed) · **Android side NOT implemented**. The app-side mapping spec is
`docs/voice-agent/app-handoff-already-reached.md` and the technical contract is
`app-integration-reference.md` §2/§4/§6.4 (2026-07-22b).

- **`console_event_guests` gained four columns** — `reached_at`,
  `callback_scheduled_at`, `can_start_outreach_call`, `call_block_reason`
  (`'already_reached'` wins over `'callback_scheduled'`; computed strictly per
  `(event_id, contact_id)`). Dial affordance rule:
  `dialable AND has_active_campaign AND can_start_outreach_call`.
- **The manual-dial route now runs ONE gate** — an already-reached preflight
  answering `409 { code: "already_reached" }` with no job created. Every other
  gate stays in the worker; the worker re-checks already-reached as race
  protection. `[D3]` in the route header is CLOSED: no manual bypass exists;
  the sole exemption is the guest-requested callback path (isCallback).
- **New Realtime table `call_dispatch_status`** (RLS `is_console_agent()`
  SELECT-only, service-role writes, in `supabase_realtime`, 30-day retention
  cron). One row per manual dispatch: the route inserts `accepted` BEFORE
  answering 202, the worker settles it to
  `dispatched | skipped | blocked | failed | unknown` with a closed reason
  union (CHECK-constrained; `skipped/already_reached` = valid domain refusal).
  The settle is STRICT on the worker side — a failed publish fails the job so
  pg-boss retries it; a completed job can never leave a row stuck `accepted`.
- **Correction to the poll-handle story:** `call_attempts.dispatch_id` was
  NEVER readable by the app — `call_attempts`' only authenticated policy is
  admin-read, and console agents are staff, not admins. The comments promising
  "the console polls call_attempts by dispatch_id" were unrealizable and have
  been corrected in code; `call_dispatch_status` is the app's status channel.

### Note on how this file was nearly lost

It was first written uncommitted in a cloud working copy, and vanished with that environment
— untracked files are not stored by git, so there was nothing to recover from history,
dangling blobs, stash, or any branch (verified six ways). It was rewritten and force-pushed
to `claude/session-8vlt7m` on 2026-07-21. The lesson stands and is worth keeping here:
**work that matters gets committed the moment it exists**, even to a scratch branch.
