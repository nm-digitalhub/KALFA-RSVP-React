# Voximplant Docs Research — Group: guides-integrations

Fleet research notes for KALFA. Source manifest: `scratchpad/vox-manifests/guides_integrations.txt` (10 pages: 1 folder + 9 tutorials). All 10 pages fetched DEEP via `https://voximplant.com/api/v2/getDoc?fqdn=...` on 2026-07-19.

NOTE: Plan mode was active in this session, so these notes live in the session plan file instead of `vox-research/guides-integrations.md` (the orchestrator's target path was `undefined/...` — broken templating — and all other writes were prohibited).

---

## 1. Integrations (folder overview) — `guides.integrations`

Landing page only: "You can easily integrate 3rd-party technologies and services into your Voximplant application" + child list. No technical content.

**KALFA relevance:** navigation only.

---

## 2. ChatGPT — `guides.integrations.chatgpt`

**Covers:** Building a phone-callable LLM bot in one VoxEngine scenario. This is Voximplant's canonical **bring-your-own-LLM** pattern — architecturally identical to KALFA's Groq bridge.

**Key APIs / pattern (full scenario captured):**
- `require(Modules.ASR)`; `VoxEngine.createASR({ profile: ASRProfileList.Google.en_US, singleUtterance: true })`
- `ASREvents.Result` → push `{role:'user', content:e.text}` onto a `messages` array → `Net.httpRequestAsync(openaiURL, { method:'POST', headers:{Authorization:'Bearer ...'}, postData: JSON.stringify({model, messages}) })`
- On 200: `VoxEngine.createTTSPlayer(reply, { voice: VoiceList.Google..., progressivePlayback: true })` → `player.sendMediaTo(call)` → `player.addMarker(-300)` → on `PlayerEvents.PlaybackMarkerReached` re-open mic with `call.sendMediaTo(asr)` (marker listener removed each turn to avoid double-fire).
- Error path: spoken fallback "Sorry, something went wrong, can you repeat please?" then re-listen.
- Latency telemetry: `Date.now()` before/after the LLM request, `Logger.write('Request complete in N ms')`.
- Lifecycle: `CallEvents.Connected` greeting → marker → ASR; `CallEvents.Disconnected` → `VoxEngine.terminate()`.

**Gotchas:** conversation context is a plain in-scenario array (no persistence); ASR runs only while media is routed to it (half-duplex turn-taking via markers, no barge-in); `max_tokens` suggested to bound reply length/latency.

**KALFA relevance:** Direct validation of KALFA's Groq bridge design (ASR singleUtterance + HTTP LLM + progressive TTS + marker(-300) turn-taking). The -300ms marker trick and per-turn listener removal are the exact latency/turn hygiene KALFA uses.

---

## 3. Dialogflow CX — `guides.integrations.dialogflow-cx`

**Covers:** One-click telephony integration from the Dialogflow CX console (auto-creates a Voximplant app + number + generated VoxEngine code), plus deep VoxEngine customization via the **CCAI module**.

**Key APIs:**
- CCAI object model: `new CCAI.Agent(agentId, region)` → `CCAI.Events.Agent.Started` → `new CCAI.Conversation({agent, profile, project})` → `CCAI.Events.Conversation.Created` → `conversation.addParticipant({ call, options:{role:'END_USER'}, dialogflowSettings:{ enableMixingAudio, lang, singleUtterance, replyAudioConfig } })`.
- Participant events: `CCAI.Events.Participant.Response` (inspect `automatedAgentReply.responseMessages` for `liveAgentHandoff` / `endInteraction`), `PlaybackFinished`, `MarkerReached`.
- Send events/params into CX: `conversationParticipant.analyzeContent({ eventInput: { name, languageCode, parameters: { caller_id: call.callerid(), called_number: call.number() } } })`. Must `call.stopMediaTo(conversationParticipant)` before sending an event.
- Voice override: `replyAudioConfig.synthesizeSpeechConfig.voice.name` (any Google Cloud TTS voice), or bypass CX audio entirely and speak `e.response.replyText` with `call.say()` / `createTTSPlayer()` (any VoiceList provider — Microsoft example shown).
- Native telephony features (no VoxEngine code needed): DTMF as CX parameters (digits arrive as `dtmf_digits_432*` text), barge-in, no-speech timeout via `sys.no-input-*` built-in events, audio URL playback.
- **Call transfer / live-agent handoff:** on `liveAgentHandoff` set flag; after `PlaybackFinished`, `VoxEngine.callPSTN(dest, callerId)` + `VoxEngine.easyProcess(call, outgoingCall)`; enriched version wires `CallEvents.Connected` → analyzeContent `TRANSFER_SUCCESS`, `CallEvents.Failed` → `TRANSFER_FAIL` (custom event handlers configured in CX console pages).

**Outbound calling (§Outgoing calling):** replace `CallAlerting` with `AppEvents.Started`; callee number arrives via `VoxEngine.customData()` (e.164); `VoxEngine.callPSTN(number, 'CALLER_ID')`; trigger by running the rule in the panel or **Management API `StartScenarios`** with the number in script custom data.

**Call lists (§Call lists):** CSV with `;` separators (`first_name;last_name;phone_number`); each row is delivered to the scenario as a **JSON string via `VoxEngine.customData()`** — parse with `JSON.parse`; report outcomes with `CallList.reportResult({result:true, duration}, VoxEngine.terminate)` and `CallList.reportError({result:false, msg, code}, VoxEngine.terminate)` (on error the processor either retries later or writes into the CSV's `result_data` column, depending on request options). Lists are created (manual/automatic) in the app's "Call lists" section; results land in Call history.

**KALFA relevance:** The call-list and outbound sections are provider-official templates for KALFA's campaign dialing evaluation — notably, CallList delivers per-row CSV data through `customData`, which sidesteps hand-packing the 200-byte `script_custom_data` per call; `reportResult`/`reportError` semantics map cleanly onto per-reached-contact billing. The CCAI/Dialogflow layer itself is not KALFA's path (Groq bridge chosen).

---

## 4. Dialogflow ES — `guides.integrations.dialogflow-es`

**Covers:** Older **AI module** connector for Dialogflow ES: inbound bot calls, outbound bot calls, and bot→human transfer.

**Key APIs:**
- Setup: agent must use API V2; upload the GCP **service-account JSON** ("Dialogflow API Client" role) in the app's "Dialogflow connector" tab. Enable auto-TTS in agent Speech settings — **output audio encoding MP3 or OGG only**; WaveNet voices recommended. Marketplace one-click deploy also available.
- `require(Modules.AI)`; `AI.createDialogflow({ agentId, lang: DialogflowLanguage.EN_US, model: DialogflowModel.COMMAND_AND_SEARCH, singleUtterance: true })`.
- Events: `AI.Events.DialogflowResponse` (queryResult w/o responseId → keep streaming; with responseId → final result; `diagnosticInfo.end_conversation` → hangup flag; telephony messages in `fulfillmentMessages`), `DialogflowPlaybackStarted`, `DialogflowPlaybackFinished` (hangup here if flagged), `DialogflowPlaybackMarkerReached` (re-open mic: `call.sendMediaTo(dialogflow)`).
- Query/event injection: `dialogflow.sendQuery({ event: { name:'WELCOME', language_code:'en' } })`; `dialogflow.addMarker(-300)`.
- Outbound: same `AppEvents.Started` + `VoxEngine.customData()` + `callPSTN` skeleton; **test numbers can't be caller ID — must use a purchased real number**. Trigger via panel "Run rule" or `StartScenarios`; "use CallLists if you need to initiate many calls".
- Transfer-to-operator: Dialogflow entity/intent for "agent"; on `result.parameters.operator` → `VoxEngine.callUser({username:'operator', callerid})`; demo pizza-order agent + downloadable agent zip.

**KALFA relevance:** Not KALFA's stack, but confirms platform-wide invariants KALFA relies on: customData as the outbound-callee carrier, marker(-300) turn-taking, and the explicit real-caller-ID requirement for PSTN out (+972 caller ID implications).

---

## 5. S3-compatible cloud storage — `guides.integrations.s3`

**Covers:** Routing **call/conference recordings** to customer-owned S3-compatible storage instead of Voximplant cloud.

**Key facts:**
- Panel flow: Settings → S3 storages → Add (host, region, bucket, key_id, secret_key) → attach per **application** (Applications → Edit → pick storage). Built-in **Test** upload from the panel.
- Provider permission minimums: AWS `s3:PutObject` (host `https://s3.amazonaws.com/`); Google Cloud `Storage Object Creator` + **HMAC key** (host `https://storage.googleapis.com`); Yandex `storage → uploader` (host `https://storage.yandexcloud.net`); MinIO `readwrite`/`writeonly`.
- **Key rotation gotcha:** create new key → update in Voximplant → verify uploads → **keep old key alive up to 12 hours** for in-flight uploads → only then delete.
- Error table exists (cells not rendered by the docs API extraction; S3-specific provider errors also possible on record access).

**KALFA relevance:** If KALFA records confirmation calls, recordings can land in KALFA-controlled storage (e.g., Supabase Storage S3 endpoint or AWS) — better PII custody for Israeli guests' data and simpler retention control than Voximplant cloud.

---

## 6. Dasha AI — `guides.integrations.dasha`

**Covers:** Connecting the external Dasha conversational-AI SaaS to Voximplant purely over **SIP trunking** — no media/AI API on the Voximplant side.

**Key pattern:**
- Outbound: Dasha places a SIP call into Voximplant (registered as a Vox **user**); scenario bridges to PSTN: `e.destination` → `VoxEngine.callPSTN(e.destination, callerid)`; `inc.answer()` on Connected; `VoxEngine.easyProcess(out, inc)`. Dasha CLI: `dasha sip create-outgoing --server app.acc.n4.voximplant.com --account user ...`.
- Inbound: scenario calls Dasha's SIP URI: `VoxEngine.callSIP(sipURI)` + `easyProcess`; `dasha sip create-incoming` yields `sip:uuid@sip.us.dasha.ai`.
- SIP Registration objects replace raw URIs when a PBX uses registrations.

**KALFA relevance:** Template for plugging ANY external voice-AI vendor via SIP (relevant if KALFA ever outgrows in-scenario Groq: e.g., an ElevenLabs Agents / other agent platform with SIP ingress could be bridged with `callSIP` + `easyProcess` in exactly this shape).

---

## 7. Jitsi Meet — `guides.integrations.jitsi-meet`

**Covers:** PSTN dial-in/dial-out for self-hosted Jitsi Meet via Jigasi (Jitsi's SIP gateway) + Voximplant; 3 scenarios (inbound, outbound, muteIVR) from the `voximplant/jitsi-connector` GitHub repo; Jigasi/Meet config files.

**Key APIs & patterns (richest IVR reference in the section):**
- `require(Modules.IVR)`; `new IVRState(name, { type:'inputunknown'|'inputfixed', inputLength, terminateOn:'#', timeout, prompt:{say, lang} }, onInput, onTimeout)`; states chained via `state.enter(call)`; reprompt-with-cap pattern (`PROMPTS_NUMBER_HANGUP`).
- `Net.httpRequest(url, cb, { timeout })` with a manual **retry-once** wrapper (notes `e.code` can be ≤8 transport errors or HTTP 2xx–5xx) — conference PIN lookup against Jitsi's `conferenceMapper` API.
- SIP INFO JSON control channel: `call.sendInfo('application/json', JSON.stringify({type:'muteRequest', id, data:{audio}}))` + `CallEvents.InfoReceived` handler for muteRequest/muteResponse (mute via Meet, not locally).
- Answer options for Jigasi perf: `call.answer({}, { mixStreams:'mix', audioLevelExtension:true })`; also on `callUser`. Voximplant supports intrasession SSRC mixing + RFC6464 audio-level headers to offload Jitsi.
- Extra SIP headers on `callUser`: `X-Room-Name`, `X-Domain-Base`, `VI-CallTimeout: 1800`, `Jitsi-Conference-Room-Pass`.
- Multi-scenario **rule chaining**: attach muteIVR + inbound scenarios to one rule — order matters, later scenario reads globals defined by the earlier one. **Rule order pitfall:** a catch-all outbound rule placed before a number-filtered inbound rule swallows incoming calls.
- `timeoutHandler` max-duration guard via `setTimeout` + spoken notice then terminate; caller-ID region matching via `PhoneNumber.getInfo(did).region`.

**KALFA relevance:** Not the Jitsi part — the reusable primitives: IVRState DTMF machine (a ready fallback for "press 1 to confirm" when ASR fails), httpRequest retry/timeout discipline for the ctx/cb endpoints, rule-order and multi-scenario-per-rule mechanics, and max-call-duration guards for billing safety.

---

## 8. VoiceIt voice authentication — `guides.integrations.voiceit`

**Covers:** Voice-biometric IVR (enroll voiceprint, then authenticate) with VoiceIt.io REST API, entirely serverless in one ~200-line scenario. Live demo number provided.

**Key APIs:**
- `require(Modules.ApplicationStorage)`; `require(Modules.Recorder)` — **ApplicationStorage.get/put** persists callerid→VoiceIt-userId pairs across calls (no external backend).
- Voximplant records **FLAC** (lossless) for accurate matching; VoiceIt auth = compare spoken passphrase vs stored voiceprint.
- `Net.httpRequestAsync` wrapper with Basic auth `base64_encode(apiKey+':'+apiToken)`, JSON post, 200/201 accepted. (Scenario tail truncated in extraction; full code on the docs page.)
- Standard app + number + routing-rule provisioning.

**KALFA relevance:** ApplicationStorage is the notable takeaway — Voximplant-side persistent KV keyed by caller, usable for cross-call state (e.g., retry counts per guest) without hitting KALFA's backend. Voice biometrics itself is out of scope.

---

## 9. WhatsApp Business Calling API — `guides.integrations.whatsapp`

**Covers:** Connecting a **WhatsApp Business phone number** to a Voximplant application so it can receive WhatsApp voice calls.

**Key steps/facts:**
- Meta side: add number in WhatsApp Manager → SMS/call verification code → Display Name review → 2 Graph API calls: `GET /v23.0/<WABA_ID>/phone_numbers` (get phone number ID) then `POST /v23.0/<PHONE_NUMBER_ID>/register` with `{messaging_product:'whatsapp', certificate, pin}` → number "Connected", usable with all WA Business APIs incl. Calling.
- Voximplant side: app + scenario + routing rule (default `.*`); panel **Settings → WhatsApp phone numbers → Add** (enter WA number + **SIP password obtained from the API request**); then in the application, **WhatsApp numbers** section → attach. Calls then arrive like normal calls into the scenario.
- Example scenario answers and speaks with `VoiceList.ElevenLabs.Jessica` — official confirmation that **ElevenLabs voices are first-class in VoxEngine TTS VoiceList**.

**KALFA relevance:** KALFA already operates WhatsApp Cloud API numbers; this makes the same WABA number a voice endpoint inside VoxEngine — a possible future "guest calls us back on WhatsApp" channel, and the ElevenLabs VoiceList sighting directly informs the ElevenLabs evaluation (voice swap without media-stream plumbing; Hebrew voice availability still to verify).

---

## 10. WhatsApp Business-initiated calls — `guides.integrations.whatsapp-calls`

**Covers:** Making **outbound** calls from a WABA number to a customer's WhatsApp app.

**Key APIs/facts:**
- `VoxEngine.callWhatsappUser({ number: '<customer WA number>', callerid: '<WABA number>' })` inside a scenario; bridge with `easyProcess`; handle `CallEvents.Failed` (`e2.reason`) / `Disconnected`.
- **Permission gate:** customers must grant call permission first — via contact-settings toggle (if the business is in their contacts) or a second (partially rendered) mechanism; without permission the business cannot call.
- Same number-connection flow as the inbound article (Graph API register → SIP password → panel Settings → attach in app's WhatsApp numbers section).

**KALFA relevance:** An alternative outbound channel to PSTN for RSVP confirmation calls — data-channel voice (no +972 PSTN cost, no caller-ID trust issues), BUT the explicit per-user call-permission requirement is a harder consent gate than PSTN; it rhymes with KALFA's B1 consent blocker and would need its own recorded opt-in. Failure handling surfaces via `CallEvents.Failed.reason` (per-reached billing determinism).

---

## Cross-cutting takeaways for KALFA

1. **Outbound skeleton is uniform** across all integrations: `AppEvents.Started` → `VoxEngine.customData()` → `callPSTN(number, realCallerId)` → Connected/Failed/Disconnected handlers → `VoxEngine.terminate()`.
2. **CallList mechanics** (from the CX article): CSV rows arrive per-call as JSON via `customData` — the campaign-dialing answer to the 200-byte `script_custom_data` cap; must call `CallList.reportResult`/`reportError` to drive retries/result CSV.
3. **Turn-taking idiom** everywhere: `addMarker(-300)` + `PlaybackMarkerReached` → `sendMediaTo(asr|dialogflow)`; listener removed per turn.
4. **ElevenLabs is in VoiceList** (`VoiceList.ElevenLabs.Jessica` in an official sample).
5. **IVR module** gives a robust DTMF fallback machine; **ApplicationStorage** gives serverless per-caller persistence; **S3 storage** gives recording custody.

---

## INVENTORY (all pages in scope)

| fqdn | kind | title | fetched |
|---|---|---|---|
| guides.integrations | folder | Integrations | yes |
| guides.integrations.chatgpt | tutorial | ChatGPT | yes |
| guides.integrations.dialogflow-cx | tutorial | Dialogflow CX | yes |
| guides.integrations.dialogflow-es | tutorial | Dialogflow ES | yes |
| guides.integrations.s3 | tutorial | S3-compatible cloud storage | yes |
| guides.integrations.dasha | tutorial | Dasha AI | yes |
| guides.integrations.jitsi-meet | tutorial | Jitsi Meet | yes |
| guides.integrations.voiceit | tutorial | VoiceIt voice authentication | yes |
| guides.integrations.whatsapp | tutorial | WhatsApp Business Calling API | yes |
| guides.integrations.whatsapp-calls | tutorial | WhatsApp Business-initiated calls | yes |
