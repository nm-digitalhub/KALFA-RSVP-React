# Agent Console — server-side API contract (verified 2026-07-21)

The Android agent console (`nm-digitalhub/KALFA-ELEVENLABS`, package `me.kalfa.agentconsole`)
is a **separate repository**. This document is the server side's record of what that app
already calls, what exists here, and what does not. It is written from a full read of the
app's sources at commit `cc89325`, not from its README.

Nothing here is aspirational: every "exists / missing" verdict below was checked against
`src/app/api/**` and the live database on 2026-07-21.

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
| **Telephony** — outbound, monitor, takeover, mute/hold/DTMF | **Mock.** `SupabaseCallEngineImpl` returns a `MockCallSession` from all three call paths; the app has no Voximplant SDK and (until 2026-07-21) declared no audio permissions. | **Yes**, and doubly: it needs both the routes below and the SDK. |

So the data half is unblocked and should not wait on us. The telephony half cannot be
finished in the app alone, because the Voximplant password must never ship inside an APK.

## Endpoints the app calls — none of which exist here

All are `POST`, base `https://beta.kalfa.me`, `Authorization: Bearer <supabase-jwt>`.
Call sites are in the app's `data/SupabaseImplementations.kt`.

| Route | Body | Called from | Exists here |
|---|---|---|---|
| `/api/sdk-auth` | `{one_time_key, username}` → `{hash}` | not yet — required before login is possible | **No** |
| `/api/agents/status` | `{"status":"ready\|not_ready\|dnd"}` | `:516` | **No** |
| `/api/calls/outbound` | `{"phone":"+9725…","event_id":"uuid"}` → `{call_id}` | `:578` | **No** |
| `/api/calls/{id}/monitor` | `{"mode":"monitor\|takeover"}` | `:609`, `:632`, `:663` | **No** |
| `/api/calls/{id}/agent-command` | `{"command":"contextual_update\|user_message\|clear_buffer\|close_agent", …}` | `:542` | **No** |
| `/api/campaigns/{id}/start` · `/pause` | `{}` | nowhere — declared in the app's contract, never called | **No** |

What *does* exist under `src/app/api/`: `voximplant/{ctx,cb,account-callback}/[token]`,
`voximplant/agent-tool/{rsvp,dnc,note}/[token]`, `elevenlabs/rsvp/update`,
`campaigns/[id]/{authorize,close-charge,whatsapp-send}`, `webhooks/whatsapp`,
`admin/sumit-test`. The `agent-tool/*` routes are **not** related: they are the AI's own
client tools during a call, token-authed, not the human console.

### `/api/sdk-auth` is the one hard blocker

The Voximplant Android SDK v2 login is a one-time-key exchange:

```
app:    connect → requestOneTimeKey(username) → oneTimeKey
server: hash = MD5(oneTimeKey + "|" + MD5(user + ":voximplant.com:" + password))
app:    loginWithOneTimeKey(fullUsername, hash)
```

The account password is the input to that hash, so the hash must be computed here. There is
no variant of this flow where the app can authenticate alone — which is why "server first"
is a fact about the protocol, not a scheduling preference.

Two things already exist for it and are simply not connected:

- **`console_agents.vox_username`** — the per-agent Voximplant user. Nullable and currently
  NULL for the one enrolled agent, so provisioning is unbuilt.
- **`console_me.vox_username`** — already exposed to the app by the view. The app's `MeRow`
  DTO does not read it yet.

**Billing note:** client-SDK logins count against Voximplant's Monthly Active Users quota
and fail with `LoginMauAccessDeniedError`. Whatever we build should not encourage the app to
log in on every launch.

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
2. **`startOutboundCall` posts a hardcoded `"event_id":"default-event"`** and builds its JSON
   by string concatenation with the phone interpolated. When `/api/calls/outbound` is built,
   it must reject a non-UUID `event_id` loudly rather than coerce it, or the first real call
   will be attributed to nothing.

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

## BLOCKING: the app and the server schema disagree on every command

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

### Note on how this file was nearly lost

It was first written uncommitted in a cloud working copy, and vanished with that environment
— untracked files are not stored by git, so there was nothing to recover from history,
dangling blobs, stash, or any branch (verified six ways). It was rewritten and force-pushed
to `claude/session-8vlt7m` on 2026-07-21. The lesson stands and is worth keeping here:
**work that matters gets committed the moment it exists**, even to a scratch branch.
