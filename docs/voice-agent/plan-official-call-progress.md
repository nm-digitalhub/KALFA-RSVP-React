# Aligning the outbound console dial with Voximplant's own pattern

Everything below is quoted from the LIVE docs or from Voximplant's own published
source. Nothing here comes from the two third-party sketches — both proposed
`FirstAudioPacketReceived`, and one proposed `VoxEngine.forwardCallProvisionalResponses`,
which does not exist in the API at all (checked: 36 `VoxEngine` members, 38 `Call`
members, our typings, our local corpus).

## The reference

`VoxEngine.easyProcess` is documented as "Adds all default event listeners to pass
signaling information between two calls", with its source published at
github.com/voximplant/easyprocess. That source is the authority:

```js
VoxEngine.sendMediaBetween(call1, call2);                       // wired UP FRONT
call2.addEventListener(CallEvents.Ringing,      () => call1.ring());
call2.addEventListener(CallEvents.AudioStarted, () => call1.startEarlyMedia());
call2.addEventListener(CallEvents.Connected,    (e) => call1.answer(e.headers, …));
```

`call1` is the leg from the app; `call2` is the PSTN leg. Note what it does NOT do:
it never answers `call1` before `call2` connects.

## Why the customer's own hold music reaches the agent

The two cases are different SIP messages, and each has its own event:

| what the callee has | their network sends | our event | what we do | agent hears |
|---|---|---|---|---|
| ordinary ringing | **SIP 180 Ringing**, no media | `CallEvents.Ringing` | `operatorCall.ring()` | a tone the device generates |
| business hold music, operator announcement, early IVR | **SIP 183 Session Progress**, with media | `CallEvents.AudioStarted` | `operatorCall.startEarlyMedia()` | **the real audio** |

`CallEvents.AudioStarted` is documented as triggering "after receiving the 183
Session Progress SIP message" — which is exactly the custom-ringback case.

They cannot overlap, and not by timing: `ring`, `playProgressTone` and `sendMediaTo`
all carry the same note — "each call object can send media to any number of other
calls, but can **receive only one audio stream. A new incoming stream always replaces
the previous one.**" Real media displaces the tone structurally.

## What we do today, and the bug nobody had noticed

`proceedOutbound()` calls `operatorCall.answer()` **immediately**, before the PSTN
leg is even created. Consequences:

1. Nothing sends media to that leg until the disclosure finishes, so the agent hears
   silence from tap to answer. This is the reported symptom.
2. `VoxCallSession` starts its duration ticker on `onCallConnected`, and answering up
   front makes that fire at once — **the screen says "connected" and counts seconds
   while the callee's phone is still ringing.**

Measured evidence, session `7769476232` (18.8): the agent leg is recorded
`successful=yes` for 122 s while the PSTN leg failed with SIP 603 and was never
answered. The agent was "in a call" for two minutes with nobody.

## The change

### Scenario — `ConsoleDial.voxengine.js`, `proceedOutbound()`

1. Remove the immediate `operatorCall.answer()`.
2. `VoxEngine.sendMediaBetween(operatorCall, guestCall)` immediately after
   `callPSTN`, as the reference does. Safe during ringing: nobody is on the guest
   side to overhear the agent.
3. `guestCall.on(Ringing)      → operatorCall.ring()`
4. `guestCall.on(AudioStarted) → operatorCall.startEarlyMedia()`
5. In the existing `guestCall.on(Connected)` handler, **first**:
   `operatorCall.answer()`, then `operatorCall.stopMediaTo(guestCall)` — the guest
   must not hear the agent until the disclosure has played. Everything after that is
   today's flow untouched: record → disclosure → `PlaybackFinished` →
   `operatorCall.sendMediaTo(guestCall)` restores the direction that was stopped.

`startEarlyMedia` is what makes step 4 legal on an unanswered leg; it is documented
as "Informs the call endpoint that early media is sent before accepting the call".
Its 60-second cap is not a constraint here — the guest leg's own no-answer timeout
is shorter.

### App — the half the reference cannot tell us about

`ring()` is documented as delegating to the device: "the dial tones depend on
endpoint device's behavior rather than on the Voximplant cloud." On Android SDK
v3.2.0 that surfaces as `CallListener.onStartRinging`, whose own doc says "Start
playing a call progress tone in this event; stop it in `onStopRinging`".

- `VoxCallSession.onStartRinging` currently only sets `CallState.RINGING`. It must
  also start a progress tone.
- `onStopRinging` is not implemented at all. It must stop the tone. Its doc:
  "Triggered when call media starts" — i.e. precisely when the real early media
  arrives, which is why a local tone here cannot overlap the customer's music.
- **`ActiveCallScreen` does not handle `CallState.RINGING`.** Today it never sees it,
  because we answer up front. After this change it will, for several seconds — and
  transfer / consult / conference must not be offered on a call that is still
  ringing.

## Alternative considered and rejected

`Call.playProgressTone()` generates the tone in the cloud instead ("The dial tones
fully depend on the Voximplant cloud"), needing no app change. Rejected as the
primary: it requires `startEarlyMedia` first on an unanswered leg, and it duplicates
what the SDK already does through `ring()` — the reference implementation uses
`ring()`, and matching the reference is the point of this change. Worth keeping in
mind if the device-side tone proves unreliable across handsets.

## Verification — none of it optional

1. A live call to a number with a **known business ringback**: the agent must hear
   the real music, not a tone.
2. A live call to an **unallocated number**: the agent must hear the operator
   announcement, and the call must end cleanly.
3. A live call to an ordinary mobile that rings and is answered: tone → answer →
   disclosure → two-way audio, and **the duration must start at the answer**, not at
   the dial.
4. `npm run voximplant -- log --session <id>` for each, read from the scenario log
   rather than the app.
5. The existing transfer / consult / conference / hold suite still passes on a call
   placed this way.

Do not deploy on the strength of the scenario diff alone: the app half and the
RINGING-state UI are part of the same behaviour.
