# Voximplant Docs Research — Group: guides-management-api

NOTE ON LOCATION: Plan mode was active for this session, so these research notes were written to the permitted plan file instead of the intended `<scratchpad>/vox-research/guides-management-api.md`. Content is complete; only the path differs.

Manifest: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-manifests/guides_management-api.txt`
Scope: 7 pages (1 folder + 6 tutorials). All 7 fetched DEEP via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>`, including raw-JSON passes to recover code samples, alerts, and lists the markdown extractor dropped.

---

## 1. Management API (folder page)
URL: https://voximplant.com/docs/guides/management-api

Section overview. Key features: control your account remotely from web/desktop/mobile via API requests; create users, applications, scenarios, and routing rules remotely; start and manage applications remotely; control your contact center. Children: Basics, Authorization, Callbacks, Child accounts, Accessing secure objects, Billing API.

KALFA relevance: index page only.

## 2. Basics
URL: https://voximplant.com/docs/guides/management-api/basics

The Management API is split conceptually into three parts:
- **Control API** — start scenarios/conferences programmatically; control active VoxEngine sessions and exchange information with them; handle automated call campaigns by creating multiple JavaScript sessions in parallel.
- **Provisioning API** — create/edit accounts and child accounts; create/edit service accounts incl. permissions; edit applications, users, rules; start scenarios; exchange data with active sessions.
- **Phone Number API** — purchase/activate numbers and bind to applications; check SMS support and enable send/receive; manage SIP registrations; check call history or download as CSV.

Key methods shown:
- User management: `AddUser`, `DelUser`, `GetUsers`, `SetUserInfo`, `TransferMoneyToUser`. Example: `curl "https://api.voximplant.com/platform_api/AddUser/?api_key=API_KEY&account_id=1&user_name=iden1&user_display_name=iden1&user_password=1234567&application_id=1"` → `{"result":1,"user_id":1}`.
- Session management: **StartScenarios** / **StartConference** take the application **rule_id** (Routing section of the app in the panel). Example: `curl "https://api.voximplant.com/platform_api/StartScenarios/?api_key=API_KEY&account_id=1&rule_id=1&script_custom_data=mystr"` → `{"result":1,"media_session_access_url":"http://1.2.3.4:12092/request?id=...&token=..."}`.
- **media_session_access_url**: HTTP requests to this URL trigger `AppEvents.HttpRequest` inside the running scenario; the scenario can answer immediately or use `Net.httpRequest` to call out later. This is the documented inbound control channel into a live session.
- **CreateCallList**: automates mass outgoing calls — accepts a list of data items and creates multiple JavaScript sessions in parallel, passing individual data items to each session so the JS code can dial the listed numbers and use the extra data during processing.

Gotchas:
- `DownloadHistoryReport` responses can be gzip-compressed — pass `--compressed` to curl.
- Client SDK login needs a fully qualified username; login fails if the user is not assigned to the specified application.

Official API client libraries: Node.js (`@voximplant/apiclient-nodejs`), Go (`apiclient-go`), Python (`voximplant-apiclient` on PyPI), PHP (`voximplant/apiclient-php`), Java (`apiclient-java`), .NET (`apiclient-dotnet`). Common prerequisites: a Voximplant account + a service account.

KALFA relevance: canonical description of the exact StartScenarios flow KALFA uses (rule_id + script_custom_data as query params, media_session_access_url in the response); CreateCallList is the campaign-dialing feature under evaluation — its per-item data passing sidesteps the ~200-byte script_custom_data cap.

## 3. Authorization
URL: https://voximplant.com/docs/guides/management-api/authorization

**Service accounts** (primary mechanism):
- Grant Management API access on behalf of the developer account; permissions via one or more **roles** (e.g., a service account with only the **Scenarios** role can just start cloud scenarios). **No roles assigned = only basic Management API methods.**
- Create in panel: Settings → Service accounts → Add → Add role → Generate key (downloads a private key JSON). Programmatic equivalent: `CreateKey` (rolesystem). ALERT: Voximplant does NOT store the keys — save the private key securely on your side.

**JWT** (RS256) required fields:
- `kid` — key_id (goes in the JWT header)
- `iat` — start date, numeric UNIX timestamp
- `iss` — account_id
- `exp` — end date, **up to iat + 3600 seconds max**

Child-account note: the parent can manage all child accounts — put the **child account ID in `iss`** of a JWT signed with the parent's service-account key; no need for per-child service accounts.

Usage: send `Authorization: Bearer <jwt>` on every request. Example shown: `curl -H "${TOKEN}" https://api.voximplant.com/platform_api/StartScenarios/?rule_id=1` → `{"result":1,"media_session_access_url":"...","media_session_access_secure_url":"..."}` (note: JWT auth needs no api_key/account_id query params, and the response also includes a **secure** https control URL).

A full bash `token.sh` generator (jq + openssl, base64url, RS256 sign) is provided and downloadable from `/assets/images/2020/08/06/jwt.sh`; may need `chmod +x`. Credentials JSON fields used: `account_id`, `key_id`, `private_key`.

KALFA relevance: exact contract for KALFA's `src/lib/voximplant/client.ts` JWT builder (kid/iat/iss/exp≤+3600, RS256, Bearer). Least-privilege: KALFA's service account should carry only the Scenarios role (plus whatever roles log/recording access requires — see Secure objects).

## 4. Callbacks
URL: https://voximplant.com/docs/guides/management-api/callbacks

HTTP callbacks (webhooks) push notifications from the Voximplant cloud to your backend instead of polling the Management API.

Setup: panel → Settings → **Webhooks** → Add: **Callback URL** (required) + **Security salt** (optional, arbitrary string ≤40 chars used for authenticity checks).

Delivery: Voximplant sends HTTP POST with a `callbacks` array of `AccountCallback` objects. Fields per callback: `type` (determines which property holds data, e.g., `min_balance` → MinBalanceCallback), `hash`, `callback_id`.

Verification: `hash = MD5(security_salt + account_id + api_key + callback_id)` — backend stores salt, account_id, api_key; recompute and compare; mismatch = corrupted or spoofed. Node/Express example does exactly this and logs a warning on `min_balance`.

KALFA relevance: MinBalanceCallback → could feed KALFA's Slack ops-alerting (the $2.88-balance class of problems) without polling; note the verification is MD5-based and requires keeping the (legacy) api_key server-side. Other callback types exist under references/httpapi (AccountCallback / accountcallbacks structure).

## 5. Child accounts
URL: https://voximplant.com/docs/guides/management-api/child-accounts

- **Account users** can have separate balances: `parent_accounting=false` via AddUser/SetUserInfo (panel: "Separate account balance"); move funds with `TransferMoneyToUser` (negative amount = user → account).
- **Independent child accounts** (Cloud-PBX pattern): created via `AddAccount` with parent credentials. ALERT: functionality is **disabled by default — must ask the Voximplant team to enable it**.
- Child accounts are standalone: no shared applications, scenarios, or balances between siblings; they DO have read access to the **parent's scenarios** but NOT the parent's applications (must create their own app).
- Terminology FAQ: **users** = end users who log in to client SDK apps; **subusers** = limited control-panel access for your developers (roles); **service accounts** = API access with roles; **child accounts** = independent sub-accounts for separating customers.
- Cross-child call transfer: `callSIP` to `user@application.account.voximplant.com`, and whitelist the IPs from `https://api.voximplant.com/getMediaResources?with_sbcs` on the receiving child account.

KALFA relevance: low — B2C single-account; child accounts are a multi-tenant PBX pattern and gated behind support enablement. The users/subusers/service-accounts distinction is useful vocabulary.

## 6. Accessing secure objects
URL: https://voximplant.com/docs/guides/management-api/secure-objects

- Logs and recordings should be stored in **secure mode** (chosen at application create/edit; `AddApplication` / `SetApplicationInfo`), otherwise they are link-accessible to anyone. If the app wasn't secure, a recorder can still be made secure per-recording via the `secure` parameter of `VoxEngine.createRecorder`.
- Recordings support the HTTP **Range** header for partial download of large files.
- Access requires authorization: (1) a **service account** (preferred) or (2) an **API key (deprecated)**.
- Role gotcha (ALERT): to access **logs**, the service account must have one of: **owner, developer, admin, supervisor, or support**. For **recordings**, any role (or none) is acceptable.
- curl: `curl -H "$(bash token.sh)" <link_to_recording_or_log>` (add `-o file` to save). Python SDK: `VoximplantAPI.build_auth_header()` → pass as `Authorization` header with `requests.get`.

KALFA relevance: Hebrew call recordings are guest personal data — secure mode + JWT-authorized fetch matches KALFA's privacy rules; if KALFA pulls session logs for debugging, its service account needs one of the log-capable roles (not just Scenarios).

## 7. Billing API
URL: https://voximplant.com/docs/guides/management-api/billing-api

- Two paid-service types: **subscription-based** (one-time NRC + monthly MRC: phone numbers, SIP registrations, MAU packages) and **usage-based** (calls, SMS, speech synthesis/recognition — billed immediately after the service, cost = type × quantity).
- Currency: each service priced in its own currency (mostly USD); converted to account currency at the current exchange rate.
- Rates API: `GetSubscriptionPrice` + `GetResourcePrice` (called with no params returns ALL rates — massive, filter it); number pricing more conveniently via `GetPhoneNumberCategories` / `GetPhoneNumberRegions` (NRC = phone_installation_price, MRC = phone_price).
- Outgoing call rate decks (up to 3 per destination): domestic `PSTN_OUT_INCOUNTRY`, EEA `PSTNOUT_EEA`, international `PSTN_INTERNATIONAL`. ALERT: not every country has a domestic deck even when domestic calls are allowed — fall back EEA → international. Lookup pattern: check domestic by country_code in price_groups, then EEA (if source country in EEA), then international.
- Incoming call rates: rate decks vary by number type (toll-free etc.); combine `GetPhoneNumberCategories` (gives `incoming_calls_resource_name`) with `GetResourcePrice(resource_type=<that name>)`.
- All snippets use the Python SDK (`voximplant-apiclient`).

KALFA relevance: programmatic lookup of IL (+972) outbound PSTN rates (`PSTN_OUT_INCOUNTRY` / `PSTN_INTERNATIONAL` by country_code "IL") for margin math behind per-reached-contact billing; TTS/ASR usage is billed per use as well.

---

## Cross-cutting observations
- **Rate limits are NOT documented anywhere in this guides section** (a stated focus item). Nothing on request quotas, QPS, or 429 behavior in any of the 7 pages; that information, if published, lives in the references/httpapi tree (another group's scope).
- The ~200-byte `script_custom_data` cap is likewise not stated in these guides — the guide shows it simply as a query param; the cap must come from the httpapi reference.
- Two auth generations coexist across examples: legacy `api_key`+`account_id` query params vs service-account JWT Bearer. The JWT path drops the query params entirely and additionally returns `media_session_access_secure_url`. API keys are called deprecated (explicitly, for secure objects).
- Images not fetched (3 screenshots: rule-id location, webhook creation, security-hash setting) — content conveyed by surrounding text.

## INVENTORY (all pages in scope)
1. Management API (folder) — guides.management-api — READ
2. Basics (tutorial) — guides.management-api.basics — READ
3. Authorization (tutorial) — guides.management-api.authorization — READ
4. Callbacks (tutorial) — guides.management-api.callbacks — READ
5. Child accounts (tutorial) — guides.management-api.child-accounts — READ
6. Accessing secure objects (tutorial) — guides.management-api.secure-objects — READ
7. Billing API (tutorial) — guides.management-api.billing-api — READ
