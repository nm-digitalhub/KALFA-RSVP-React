# Ringback and early media — what the live docs actually say

Verified 2026-08-18 against the LIVE Voximplant documentation API
(`https://voximplant.com/api/v2/getDoc?fqdn=…`) for the SDK this app actually
ships: **Android SDK v3.2.0** (`gradle/libs.versions.toml:42`), the modular Kotlin
one — NOT the v2 Java `ICallListener` API, which this app has never used.

## Confirmed, quoted

| symbol | official text |
|---|---|
| `Call.ring()` | "Plays dial tones for the incoming call. The method sends a low-level command to the endpoint device to start playing dial tones for the call. So the dial tones depend on endpoint device's behavior rather than on the Voximplant cloud." |
| `Call.startEarlyMedia()` | "Informs the call endpoint that early media is sent before accepting the call. It allows playing voicemail prompt or music before establishing the connection. **It does not allow to listen to call endpoint.** Note that unanswered call can be in 'early media' state only for **60 seconds**." |
| `Call.sendMediaTo()` | "Starts sending media (voice and video) from the call to the media unit. **The target call has to be `CallEvents.Connected` earlier.**" |
| `CallEvents.FirstAudioPacketReceived` | "Triggers after the first audio packet is received." |
| v3 `CallListener.onStartRinging` | "Triggered for outgoing calls after `Call.start` when the remote participant's device is ringing. **Start playing a call progress tone in this event**; stop it in `CallListener.onStopRinging`." |
| v3 `CallListener.onStopRinging` | "Triggered when call media starts. If you are playing progress tones in `onStartRinging`, stop them in this event." |

So the local-tone-then-real-media design is not a workaround: it is the SDK's own
documented contract, in our own major version.

## What the advice omitted or got wrong

1. **Early media expires after 60 seconds.** Documented on `startEarlyMedia`, absent
   from the advice. A callee who rings longer than that breaks the flow as written.
2. **`sendMediaTo` requires the target to have been `Connected`.** The proposed
   skeleton calls `guestCall.sendMediaTo(operatorCall)` while the operator leg has
   only had `ring()` + `startEarlyMedia()` and has NOT been answered — so it is not
   Connected. **This is UNRESOLVED**: the guide pages the advice cites
   (`/docs/guides/voxengine/earlymedia`, `/docs/guides/voxengine/callhandling`)
   return 404, and the API returns `{}` for both. No documentation settles it.
   It can only be settled by a live call.
3. **Early media is one-directional** — "does not allow to listen to call endpoint".
4. **One inbound audio stream per call object.** Stated on both `ring` and
   `sendMediaTo`: "each call object can send media to any number of the media units,
   but can receive only one audio stream. A new incoming stream always replaces the
   previous one." Relevant at the hand-off from early media to `sendMediaBetween`.
5. `sendMediaBetween` is a **VoxEngine**-level function, not a `Call` method — it is
   absent from the `Call` reference. The advice used it correctly.

## What we do today

- `ConsoleDial.voxengine.js` never calls `ring()` or `startEarlyMedia()`.
- `VoxCallSession.kt:90` implements `onStartRinging` but only sets
  `_state.value = CallState.RINGING` — it plays no tone.
- `onStopRinging` is not implemented at all.

**So an agent placing a manual call hears silence from the tap until the callee
answers** — no ringback, and no operator message, no "number unavailable", no
early IVR. The advice's diagnosis is correct.

## The one thing to settle before building

Whether `sendMediaTo` into an un-answered leg works after `startEarlyMedia()`.
Settle it with ONE live test call to a number that returns an operator message —
an unallocated number is ideal, since it produces real early media and no cost of
disturbing anyone. Read the outcome from the scenario log
(`npm run voximplant -- log --session <id>`), not from the app.
