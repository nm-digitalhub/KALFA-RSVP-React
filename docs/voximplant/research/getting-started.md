# Voximplant Docs Research — Group: getting-started

Research notes (deliverable). Fleet: Voximplant documentation mapping for KALFA.
Fetched 2026-07-19 via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` (all 23/23 pages in manifest read in full, including deep extraction of tables, alerts, and list items that the stock extractor drops).

NOTE: plan mode was active in this session; the intended notes path `<scratchpad>/vox-research/getting-started.md` was not writable, so the notes live in this file.

---

## 1. Overview pages

### Getting started (root) + Voximplant features + Supported platforms

**Covers:** Docs are organized into 4 sections (Getting started / Guides / Voice AI / API reference). Voximplant positions itself as CPaaS + "AI Orchestration platform".

**Feature list highlights (features page):**
- LLMs & generative AI: direct connections to OpenAI, Google Gemini/Vertex, xAI, Ultravox, and others; integrate into IVRs/contact centers.
- TTS: ElevenLabs, Cartesia, Inworld, Amazon, and other providers. ASR: Deepgram, Microsoft, Google, others — with intermediate results, emotion and gender recognition. "Mix and match providers" per language/accent/latency.
- Contact center & automation: Call lists & PDS (Predictive Dialing System) for outbound campaigns; AI voicemail detection; intelligent IVR.
- VoxEngine backend logic: HTTP requests (GET/POST/PUT/PATCH) from scripts, Key-Value Storage (unlimited pairs, values up to 2000 chars), custom logging up to 15,000 chars per message viewable real-time in the control panel.
- Phone numbers in 60+ countries; SIP integration; WebSocket module for full-duplex real-time audio/data exchange with third-party bots.
- Recording to Voximplant cloud or your own Amazon S3-compatible storage.
- Ecosystem: Amazon S3 / Google Cloud / Azure storage; ChatGPT, Dasha AI, IBM Watson, Dialogflow.

**Supported platforms:** SDK minimums — iOS 11.0, Android 5.0 (API 21), React Native 0.47.0, Flutter 3.3.0/Dart 2.18. Browsers — Chrome 94+, Edge 93+, Safari 15+, Yandex 21.8+. "18-month rule": any modern browser released in the last 1.5 years should work.

**KALFA relevance:** Confirms ElevenLabs is a first-class TTS integration target (KALFA is evaluating it) and that call lists + PDS are core platform features for campaign dialing. Browser/SDK matrices are irrelevant (KALFA is PSTN-outbound only).

---

## 2. Platform quickstarts (getting-started.platform.*)

### VoxEngine: a cloud app (the relevant quickstart for KALFA)

**Covers:** The canonical 5-step flow for a cloud-only app: (1) create application → (2) create scenario inside it → (3) create a routing rule and attach the scenario → (4) buy a phone number and attach to app → (5) test call.
- Scenarios are edited in the online IDE; can be uploaded automatically via Management API (`/docs/references/httpapi/scenarios`).
- Rules specify which scenarios run when a call arrives OR when **StartScenarios** is called.
- Test numbers are dialed as extensions of Voximplant access numbers.
- Every application session generates a log file (all in/out calls), accessible via control panel or Management API GetCallHistory. **Session log TTL = 1 month** — after that it cannot be accessed or downloaded.
- The embedded scenario code example is empty in the docs API payload (rendered client-side), but the text says it uses `call.say()`.

**KALFA relevance:** Exactly KALFA's architecture (StartScenarios-triggered scenario). The 1-month log TTL means KALFA must persist all call outcomes itself (it does, via cb endpoint) — never rely on Voximplant history for billing reconciliation older than 30 days.

### Web / iOS / Android / React Native / Flutter quickstarts

**Covers:** SDK install + init + connect/login per platform. Common pattern: getInstance → init → connect → login. All five pages carry the same **"Connection node notice"**: when initializing an SDK you must specify the account-bound **node**; find it under "Credentials for working with API, SDK, SIP" on the control panel dashboard.
- Web: CDN (`unpkg.com/voximplant-websdk@VERSION`) or `npm i voximplant-websdk`; pin the exact version (using `@latest` risks breaking changes); HTTPS required for audio/video playback.
- iOS: CocoaPods (`pod 'VoxImplantSDK'`) or SPM (github.com/voximplant/ios-sdk-releases); Info.plist camera/mic usage keys; 4 background modes; bitcode dropped since 2.48.0; Swift package NOT semver-compliant.
- Android: `com.voximplant:voximplant-sdk` from Maven; Java 11 since 2.42.0; SDK auto-declares permissions (RECORD_AUDIO, BLUETOOTH_CONNECT etc.); BLUETOOTH_CONNECT runtime grant needed on Android 12+.
- React Native: `react-native-voximplant`; does NOT work with create-react-native-app (native modules).
- Flutter: `flutter_voximplant`; Info.plist entries for iOS, Java 8 compileOptions for Android.
- All quickstarts link to GitHub demo repos (basic-websdk-demo, click-to-call, ios-sdk-swift-demo, android-sdk-kotlin-demo, react-native-demo, flutter_demos, solutions-messaging).
- Gotcha: inline SDK code examples are empty in the getDoc API payload for all quickstarts.

**KALFA relevance:** Low — KALFA makes server-originated PSTN calls, no client SDKs. The node-binding notice matters only if a browser softphone/testing client is ever added.

---

## 3. Basic concepts (getting-started.basic-concepts.*)

### Applications

**Covers:** An application is the container entity: scenarios + users + routing rules + numbers + more. You must create an application before any project. Application sections enumerated:
- **Overview** (stats, active sessions, expiring numbers/SIP registrations), **Call history** (filter, cost, session log download), **Scenarios**, **Users**, **Numbers**, **Routing**, **Queues** (ACD v1, legacy), **SmartQueue** (ACD v2, skill-based distribution), **Call lists** ("call a list of phone numbers and process them with any scenario logic, such as IVR or connecting to agents", track results, PDS available), **SIP registrations** (integrate into third-party PBX), **Push certificates** (iOS/Android/Huawei), **Dialogflow connector**, **Key-value storage** (built-in DB, unlimited pairs, keys ≤ 200 chars, values ≤ 2000 chars), **VoxEngine CI** (manage scenarios/rules from a third-party IDE).

**KALFA relevance:** Call lists live per-application and are tracked with results — the CallList evaluation maps to the existing KALFA application. Key-value storage limits (200/2000 chars) could hold per-call config to bypass the 200-byte script_custom_data cap, though KALFA's ctx endpoint already solves this.

### Users

**Covers:** Users authorize Web/mobile SDK apps and SIP clients for calls/messaging. Create via control panel or Management API `AddUser`. Users can be made inactive (cannot log in) and can have a **separate balance** to control spending. FAQ: for a customer with a separate balance, use a user with separate balance or a **child account**.

**KALFA relevance:** Not needed for outbound PSTN scenario-only usage (no SDK logins). MAU billing (below) is therefore also a non-issue.

### Scenarios

**Covers:** Scenarios are JavaScript documents inside an application; multiple scenarios per application allowed. Execution requires a routing rule — launched by incoming call, Management API (StartScenarios), or manual control-panel launch.
- **Shared context:** attach two scenarios to the same routing rule and both execute in one space — call functions/variables across scenarios with no imports; modules imported in one scenario are available to all scenarios on that rule.
- Strong recommendation to read VoxEngine concepts guide first.
- Ready-to-use scenario templates exist in the control panel onboarding.
- Best practice FAQ: start with one scenario; split later (e.g., one for incoming sorting, one for outgoing/call lists).

**KALFA relevance:** Shared-context-per-rule means KALFA can split its growing scenario (RSVP conversation, DNC handling, callbacks) into multiple files attached to the same rule without an import mechanism.

### Routing rules

**Covers:** Rules bind scenarios to call processing; launching a rule executes ALL attached scenarios sequentially in one context.
- **Pattern** field: regex matched against `e.destination` (dialed number/username) of INCOMING calls only. Examples: `.*` (everything), `+?[1-9]\d{1,14}` (any phone number), `123.+`.
- Rules evaluated **top-to-bottom; only the first matching rule executes**. Reorder rules to prioritize.
- Patterns do NOT apply to outgoing calls — for outgoing it's enough to create a rule and attach a scenario, then launch via StartScenarios.
- Patterns DO work for SIP usernames. Pattern checks destination, never caller ID.
- **Video conference switch**: without it video conferences fail; with it enabled, ALL calls made via SDKs/softphones on that rule are billed as video conferences (cost trap).
- Launch methods: incoming platform call; outgoing SDK call (generates an incoming call leg that pattern-matches); Management API **StartScenarios** (common scenarios) / **StartConference** (video conf); manual Run in control panel.
- **Custom data FAQ:** "If you start a scenario via Management API, pass the data to the `script_custom_data` parameter. If you start the scenario manually via the control panel, pass the data to the Custom data window." (No size cap documented on this page.)
- Testing tools: **Rule checker** (test a number/username against patterns) and built-in **Softphone** (requires user credentials).
- Common setup FAQ: incoming rule with `.*` on top; rules below it are launchable only via Management API — this is exactly the outbound-rule pattern.

**KALFA relevance:** Directly validates KALFA's setup: an outbound rule launched via StartScenarios needs no pattern; script_custom_data is the documented custom-data channel (the ~200-byte cap is NOT documented here — it was live-verified by KALFA). Keep the video-conference switch OFF. Rule checker/softphone useful for QA.

### Phone numbers

**Covers:** Buying real vs test numbers; attach to application (Numbers tab → Attach) and bind to a routing rule; a number is needed for incoming calls and as caller ID for outgoing.
- **Test numbers:** free; reached by dialing a Voximplant access number + extension; **cannot be used as caller ID**; limits **100 calls/day and 3 calls/minute**.
- Real numbers: no such restrictions; setting your own caller ID supported (not for test numbers).
- Country-dependent **KYC/verification** may be required before purchase or activation; some countries/regions are support-purchase-only (support checks availability, informs of conditions, requests documents required by the local telecom operator).
- Incoming always busy → number not attached to the application.
- Multiple numbers can map to multiple routing rules for different processing.
- Subscriptions: see billing page.

**KALFA relevance:** For +972 caller ID, an Israeli number purchase will likely involve KYC or a support-assisted flow — factor lead time into go-live. Test-number limits (3/min, 100/day, no caller ID) make them unusable for real RSVP campaigns.

### Calls and sessions

**Covers:** Telephony model: a "call" in Voximplant = one call leg; each leg independently controlled by cloud JavaScript. Sessions:
- Each call is a **separate session** handled separately.
- VoxEngine is a serverless JS runtime compliant with **ES2017/2018**; code runs on the media servers processing the calls; session lifespan is much longer than conventional serverless functions and session context persists for the whole lifetime.
- **Fully asynchronous, no blocking**: calling `say()` twice in a row means the second playback immediately replaces the first (event-driven like Node.js). Specific per-session limitations exist to ensure real-time execution (not enumerated on this page).
- **MediaUnit concept:** any object with an audio/video stream is a media unit — Call, Conference, ASR, Player, Recorder. A call can SEND multiple streams but RECEIVE only ONE at a time; a newly sent stream replaces the previously received one. To mix streams use a Conference. Routing via `call.sendMediaTo(targetMediaUnit)`.

**KALFA relevance:** Core mental model for the KALFA scenario: say()-replacement semantics explain why sequencing must be event-driven (PlaybackFinished) — consistent with KALFA's live-verified terminal-hangup pattern. One-received-stream rule matters when mixing Player/ASR/call audio in the LLM bridge.

### Video calls

**Covers:** Three call types: server video calls (server features: recording, streaming, speech processing; client-server encryption; billed per minutes+traffic), peer-to-peer (E2E encrypted, direct traffic, free unless TURN relay is used — TURN billed per price list; no server features), video conferences (up to 50 participants, simulcast, single-file recording, billed per participants+duration). Conversions: server call ↔ conference possible; P2P cannot convert.

**KALFA relevance:** None operationally (voice-only), but reinforces the billing trap of the rule-level video-conference switch.

### Management API

**Covers:** Management API mirrors most control-panel operations. Requires a **service account** (Settings → Service Accounts → Add): generates and downloads a JSON key file containing account ID, email, key ID, private key — used for **JWT authorization**.
- **Roles** gate permissions. A role-less service account can only call: GetAccountInfo, GetResourcePrice, GetSubscriptionPrice, GetActualPhoneNumberRegion, GetRecordStorages, GetRoles, SetSubUserInfo, GetKeys, CreateKey, UpdateKey, DeleteKey, GetKeyRoles, SetKeyRoles, RemoveKeyRoles.
- Capabilities listed: manage accounts/child accounts, service accounts/permissions, applications/users/rules, execute scenarios, **exchange data with active sessions**, purchase/activate/bind numbers, SMS enablement, SIP registrations, call history (view/CSV), start scenarios and conferences, control active sessions, automate calls.
- Roles can be changed after creation.

**KALFA relevance:** KALFA's src/lib/voximplant/client.ts JWT flow matches this. "Exchange data with active sessions" (SendDataToSession-style) is a documented alternative channel to push data into a running call beyond script_custom_data. Scope the KALFA service-account role minimally (e.g., scenario/call-list execution) rather than full admin.

### Account subusers

**Covers:** Subusers = control-panel access delegation (distinct from users, service accounts, child accounts). Created under Settings → Subusers; each subuser logs in ONLY via a special account-specific login-page link; session_id TTL = 8 hours; account name cannot be hidden on the login page.
- Role → panel-section access matrix (full table captured). 12+ roles: MainAccount, Owner, Admin, Developer, Supervisor, Support, Accountant, CallListManager, UserManager, PhoneNumberManager, Payer, PayerNoVerify.
- Notable rows: Call lists viewable by CallListManager/Support/Supervisor/Developer/Admin/Owner; **creating call lists and appending lines**: MainAccount/Owner/Admin/Developer/CallListManager. API keys & webhooks: MainAccount only. Billing: MainAccount/Owner/Admin/Accountant/Payer/PayerNoVerify. Supervisor can access call recordings (listen but not delete FAQ).
- Entity taxonomy FAQ: users (client logins, own balances) vs subusers (panel access) vs service accounts (API access) vs child accounts (independent sub-tenants with own apps/scenarios/balances; usable for cloud-PBX-style customer separation).

**KALFA relevance:** Mostly ops hygiene. If a human operator ever needs to inspect campaign call lists without touching scenarios, CallListManager is the purpose-built role.

### Integrations

**Covers:** Named speech/NLU integrations: Amazon Polly (TTS), Google WaveNet (TTS), Dialogflow (NLU/conversational), Yandex SpeechKit (ASR), T-bank VoiceKit (ASR+TTS), Microsoft Azure TTS (116 voices, 35 languages). (This page predates the fuller AI list on the features page — ElevenLabs/Deepgram/LLMs appear there and in Voice AI docs, not here.)

**KALFA relevance:** Confirms multiple TTS backends selectable per scenario; Hebrew coverage must be verified per provider (KALFA currently uses Google he-IL via say(); Azure/ElevenLabs are candidates).

### Firewall

**Covers:** Corporate-firewall allowlisting. Live IP inventory via `https://api.voximplant.com/getMediaResources?{parameter}` with parameters: `with_nodes` (IPs that API requests are made TO), **`with_jsservers` (IPs FROM which requests come when made from a scenario)**, `with_mediaservers` (RTP), `with_webgateways` (WebRTC), `with_sbcs` (SIP), `with_videoconverters` (S3 recording storage).
- SDK traffic: 8000–18000 UDP, 20000–30000 UDP, 443 TCP, 12093 TCP (gateways/media); 443 for balancer (7 balancer IPs listed incl. 35.204.101.31, 82.202.208.155, 84.201.130.55, 84.201.128.92, 31.184.223.90, 69.167.178.93, 158.160.135.63; balancer.voximplant.com).
- SIP traffic: 5060 TCP/UDP or 5061 SIP/TLS (SBC), 8000–18000 UDP media.

**KALFA relevance:** Directly actionable: `getMediaResources?with_jsservers` yields the source-IP allowlist for KALFA's ctx/cb endpoints behind the IONOS firewall (which drops non-allowlisted traffic). Poll it periodically — IPs can change.

---

## 4. How billing works (getting-started.billing) — FOCUS AREA

**Account balance & top-ups:** One central prepaid balance pool for all services. Live rates only on voximplant.com/pricing or control panel (no rates in docs). Low-balance email alert defaults to **$5.00** (customizable in notification settings). **Negative balance possible**: an active call may continue past $0; services resume after top-up. **Auto top-up** exists but requires linking a card AND contacting technical support to set threshold/recharge amount.

**Instant Messages & MAU subscription (Free tier default):**
| Plan component | Free limit | Exceeding the limit |
|---|---|---|
| Instant Messages (IM) | 50K / month | Messages stop sending |
| Active Users (MAU) | 1,000 / month | New user logins are blocked |
- Paid plans (Small, Medium, Custom) allow exceeding limits, charged per pack of 100 additional messages or per new user login.
- IM counter triggers on sendMessage/editMessage/removeMessage regardless of delivery status.
- MAU = unique credential logging in ≥1×/month; multiple devices = 1 MAU; child-account active users billed to the parent account.
- Upgrade any time in Billing section or via **ChangeAccountPlan** API; downgrade only via support; prorated refunds on mid-cycle changes.

**Grace period (USD/EUR accounts):** If balance can't cover a subscription renewal, the fee is credited for one month; must be repaid by the **1st day of the next month** or the account is suspended. During grace you can spend cash on calls but cannot buy new plans. Check via **GetAccountInfo** → `grace_credit` (positive = active credit).

**Phone number subscriptions:**
| Charge type | Timing |
|---|---|
| Setup fee (+tax) | One-time at purchase |
| Subscription fee (+tax) | Reserved monthly on the purchase anniversary |
- Fee is *reserved* on the anniversary; the final tax-adjusted charge lands on the **1st of the following month**.
- Insufficient funds → number **suspended for one month**, then **released to the public pool** if still unpaid.
- Some countries activate numbers only after local verification. Cancel via phone-numbers menu to stop recurring billing.

**Invoices & taxes:** Final tax rates computed at month end; invoices generated on the 1st of every month; history in Billing section; APIs: **GetAccountInvoices** (list), **DownloadInvoice** (PDF).

**Regional differences:** USD/EUR — cannot top up without a valid billing address or VAT number; variable tax rates. RUB — flat tax rates, tax-inclusive prices deducted immediately; legal entities get price/tax line items, individuals get consolidated totals.

**KALFA relevance:** (1) With a $2.88 balance KALFA is already under the $5 alert default — top up before any campaign; a mid-campaign $0 can drive the balance negative and then hard-stop subsequent calls, breaking per-reached-contact billing integrity. (2) An Israeli number subscription adds a monthly reserved fee + failure→suspension→release risk; put renewal on the ops calendar or monitor grace_credit via GetAccountInfo. (3) IM/MAU tiers are irrelevant (no SDK users/messaging). (4) Auto top-up requires a support ticket — worth doing before production campaigns.

---

## INVENTORY (all 23 pages in scope; all fetched and read)

1. Getting started — `getting-started`
2. Voximplant features — `getting-started.features`
3. Supported platforms — `getting-started.supported-platforms`
4. Start building your app — `getting-started.platform` (folder)
5. VoxEngine: a cloud app — `getting-started.platform.voxengine`
6. Web — `getting-started.platform.web`
7. iOS — `getting-started.platform.ios`
8. Android — `getting-started.platform.android`
9. React Native — `getting-started.platform.react-native`
10. Flutter — `getting-started.platform.flutter`
11. Basic concepts — `getting-started.basic-concepts` (folder)
12. Applications — `getting-started.basic-concepts.applications`
13. Users — `getting-started.basic-concepts.users`
14. Scenarios — `getting-started.basic-concepts.scenarios`
15. Routing rules — `getting-started.basic-concepts.routing-rules`
16. Phone numbers — `getting-started.basic-concepts.phone-numbers`
17. Calls and sessions — `getting-started.basic-concepts.calls-and-sessions`
18. Video calls — `getting-started.basic-concepts.video-calls`
19. Management API — `getting-started.basic-concepts.management-api`
20. Account subusers — `getting-started.basic-concepts.subusers`
21. Integrations — `getting-started.basic-concepts.integrations`
22. Firewall — `getting-started.basic-concepts.firewall`
23. How billing works — `getting-started.billing`
