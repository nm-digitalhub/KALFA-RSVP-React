# Voximplant / VoxEngine API Reference

## ⚠️ Currency protocol (mandatory)

This file was last verified against voximplant.com docs on **2026-07-15**.
Voximplant ships new modules frequently. Before writing code:

1. Fetch the CURRENT docs (these superseded the old voximplant.com/docs URLs):
   - `https://docs.voximplant.ai/platform/voxengine/llms.txt` — section index
   - `https://docs.voximplant.ai/api-reference/voxengine` — method/event signatures
   - append `.md` to any page URL for its raw Markdown
   - `https://cdn.voximplant.com/voxengine_typings/voxengine.d.ts` — the signature
     ORACLE. Download it (e.g. `typings/voxengine.d.ts`); it is a large file, not a
     web page. Validate every symbol/enum spelling against it before writing code.
2. Check whether a built-in module now covers the need before hand-rolling
   (they have added: `VoximplantAvatar`, `ElevenLabs`, `OpenAI`, `Gemini`,
   `Ultravox`, `Cartesia`, `Deepgram`, `Pipecat`, `IVR`, `AMD`, `AI` modules).
3. Never invent enum members (VoiceList / ASRProfileList entries) — verify the
   exact Hebrew profile name in the docs; provider support for he-IL varies.
   (The shipped scenario uses `VoiceList.Google.he_IL_Wavenet_A` for TTS and
   `ASRProfileList.Google.he_IL` for ASR — both verified working in production.)

## Verified core surface (2026-07-15)

```javascript
require(Modules.ASR);
require(Modules.Player);
// also available: Modules.AMD, Modules.ElevenLabs, Modules.Avatar, Modules.Net (Net is global)

// Entry point for outbound (CallList / StartScenarios):
VoxEngine.addEventListener(AppEvents.Started, async e => {
  const data = JSON.parse(VoxEngine.customData()); // ≤ 200 bytes! pass IDs only
  const call = VoxEngine.callPSTN(data.phone, CALLER_ID);
  call.addEventListener(CallEvents.Connected, onConnected);
  call.addEventListener(CallEvents.Disconnected, onDisconnected);
  call.addEventListener(CallEvents.Failed, onFailed);
});

// TTS:
call.say(text, { language: VoiceList.<provider>.<voice> }); // verify Hebrew voice in docs
call.addEventListener(CallEvents.PlaybackFinished, handler);
call.stopPlayback(); // for barge-in

// ASR:
const asr = VoxEngine.createASR({ profile: ASRProfileList.Google.<he_IL_profile>, // VERIFY exact name
                                  interimResults: true });
call.sendMediaTo(asr);
asr.addEventListener(ASREvents.InterimResult, e => { /* barge-in: call.stopPlayback() */ });
asr.addEventListener(ASREvents.Result, e => { /* e.text or e.transcript; set your own timeout */ });
asr.stop();

// HTTP out (result webhook):
Net.httpRequestAsync(url, { method: 'POST', headers: [...], postData: JSON.stringify(payload) });

// Always:
VoxEngine.terminate();
```

## Gotchas (learned the hard way)

- `VoxEngine.customData()` is capped ~200 bytes → pass `{c:"callId"}` and
  fetch guest/event details from the kalfa.me API inside the scenario.
- ASREvents.Result does NOT auto-timeout — always wrap in your own
  `setTimeout` or a slow ASR hangs the session (billable).
- Confidence field range differs by provider (0–1 vs 0–100). Normalize.
- Sessions have hard limits; a `CallEvents.Failed` can fire ~60s after dial.
  Handle Failed + Disconnected on every call object.
- Send the result webhook BEFORE `terminate()` and `await` it — HTTP after
  terminate is dropped.
- ElevenLabs TTS: the `Modules.ElevenLabs` integration exists natively now —
  prefer it over the custom PCM streaming approach if voice quality with
  `eleven_v3` Hebrew is required. Verify current usage in docs.
- AMD (answering machine detection): `Modules.AMD` exists; verify current
  event names before relying on it. Voicemail path must leave ≤ 10s message.

## kalfa.me real integration contract (Branch B) — AUTHORITATIVE

> This section OVERRIDES the generic `{c:id}` / `/api/voice` / "Laravel" examples
> elsewhere in these teaching files. kalfa.me is **Next.js**, not Laravel. When you
> write real code, mirror the shipped scenario `voxfiles/scenarios/src/RSVP.voxengine.js`,
> not the skeleton.

- **Dispatcher:** a Next.js server action + pg-boss worker call the Management API
  `StartScenarios` (via `src/lib/voximplant/core.ts`, JWT RS256 — NOT the vulnerable
  `@voximplant/apiclient-nodejs`). Rule `OutCall` = rule_id **1494311**.
- **customData payload = `{to, from, tok, u}`** (≤ 200 bytes, verified live ≈ 111 B):
  - `to` normalized E.164 destination · `from` verified caller id
  - `tok` = `call_attempts.access_token` (opaque 32-hex, unguessable, per-call)
  - `u` = app origin (e.g. `https://beta.kalfa.me`)
- **Context fetch:** `GET {u}/api/voximplant/ctx/{tok}` →
  `{ guest_name, event_name, event_date, event_venue, groq_key }`. Token-gated +
  rate-limited; 404 (generic) on bad/expired token, inactive event, or terminal
  attempt. The Groq key is served HERE, never in customData → it never lands in
  Voximplant call-history `session_custom_data`.
- **Result callback:** `POST {u}/api/voximplant/cb/{tok}`, body validated by
  `voxCallbackSchema` (strict). Persist-then-process: the route only verifies +
  stores; a 1-minute drain does RSVP/billing. Identity = the token's attempt, never
  the body. `await` it BEFORE `VoxEngine.terminate()`.
- **Ops discipline:** quiet hours 08:00–21:00 Asia/Jerusalem enforced in the
  dispatcher; per-campaign throttle + concurrency caps in `dispatchOutreachCall`;
  `call_session_history_id` stored on the attempt row for reconciliation. Deploy the
  scenario with voxengine-ci (`upload --application-name kalfa-rsvp --rule-name OutCall`,
  `--dry-run` first). For anything platform-side, use the `voximplant-engineer` subagent.
