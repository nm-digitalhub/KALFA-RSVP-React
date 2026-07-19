# Voximplant Docs Research — Group: guides-sms

NOTE ON LOCATION: The orchestrator asked for these notes at `<scratchpad>/vox-research/guides-sms.md`, but this session runs in plan mode (read-only; only this plan file is writable), so the deliverable lives here:
`/var/www/vhosts/kalfa.me/.claude/plans/floofy-cooking-thompson-agent-a125c0faddf27e1e4.md`

Manifest: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-manifests/guides_sms.txt` — 4 pages (1 folder + 3 tutorials). All 4 fetched in full via `https://voximplant.com/api/v2/getDoc?fqdn=...`, including the raw `content_source` example blocks (the generic extractor rendered them empty; they were pulled directly from the JSON `examples` arrays).

---

## 1. SMS (folder) — `guides.sms`
URL: https://voximplant.com/docs/guides/sms

Overview stub: "Voximplant platform allows users to send and receive SMS messages to/from mobile phones." The "Key features" and "In this section" headings carry no static content in the API JSON (rendered dynamically as child-page listings on the site). Children: Choosing a phone number, Sending SMS, Receiving SMS.

**KALFA relevance:** Confirms Voximplant SMS is a Management-API-level feature (send + receive), not a VoxEngine feature — SMS would be driven from KALFA's Next.js backend, so the 200-byte `script_custom_data` cap is irrelevant to SMS.

## 2. Choosing a phone number — `guides.sms.phonenumbers`
URL: https://voximplant.com/docs/guides/sms/phonenumbers

- SMS support depends on the **region and phone category** chosen when purchasing a number. **Virtual numbers do NOT support SMS** (bolded in the docs).
- Control-panel check: Numbers → buy a new phone number; an inline note appears if the selected number does not support SMS (absence of the note = supported).
- Programmatic check: docs text names `GetPhoneNumbers`, but the shipped example actually calls **`GetPhoneNumberRegions`** with `country_code` and `phone_category_name`; look for `is_sms_supported: true` in the result. (Docs/example mismatch worth noting.)
- Example call/response (GB MOBILE): returns `phone_region_id`, `is_sms_supported: true`, `phone_count: 408`, `phone_price: 1.2`, `phone_installation_price: 0.0`, `is_need_regulation_address: false`, `phone_period: "0-1-0 0:0:0"` (monthly).

```bash
curl "https://api.voximplant.com/platform_api/GetPhoneNumberRegions/?api_key=API_KEY&account_id=1&country_code=GB&phone_category_name=MOBILE"
```

**KALFA relevance:** Before any SMS plan for Israel, run `GetPhoneNumberRegions` with `country_code=IL` per category and check `is_sms_supported` — Israeli numbers on Voximplant may be virtual/geographic-only, which would rule out SMS on them entirely.

## 3. Sending SMS — `guides.sms.sending`
URL: https://voximplant.com/docs/guides/sms/sending

- **Prerequisite — enable SMS per number**: via `ControlSms` HTTP API (`phone_number`, `command=enable|disable`) or control panel (Numbers → My phone numbers → Edit → Disable/Enable SMS toggle). The "SMS Enabled" checkbox is **OFF by default** for purchased numbers.
- **One-way (A2P) SMS — `A2PSendSms`** (the FOCUS area):
  - `src_number` — the **SenderID; installing a SenderID requires contacting Voximplant support** (i.e., alphanumeric/branded sender is a manual support-ticket process, not self-serve).
  - `dst_numbers` — multiple destinations separated by `;` (batch send in one call).
  - `text` — up to **1600 characters**.
  - Response: `result[]` with per-destination `transaction_id`, top-level `fragments_count`, and a `failed[]` array with `destination_number` + `error_description` + `error_code` (example shows code **385 "SMS failed to send."**). Partial success is normal — some destinations succeed while others land in `failed[]`.
- **Two-way SMS — `SendSmsMessage`**: `source` (a real SMS-enabled Voximplant number), `destination` (single number), `sms_body` up to **765 characters**. Response `{result: 1, fragments_count: N}`.
- **Segmentation & billing (both methods)**: messages longer than **160 GSM-7 chars or 70 UTF-16 chars** are split into segments; **each segment is billed as one message**. `fragments_count` in the response reports the split.
- Incoming SMS is also billed (per the pricing page).
- Optional: persist outgoing SMS text in the panel — Settings → SMS configuration → "Always save the text of outgoing messages".

```bash
# enable
curl "https://api.voximplant.com/platform_api/ControlSms/?api_key=API_KEY&account_id=1&phone_number=447443332211&command=enable"
# one-way A2P batch
curl "https://api.voximplant.com/platform_api/A2PSendSms?api_key=API_KEY&account_id=1&src_number=447443332211&dst_numbers=447443332212;447443332213&text=Test%20message"
# two-way
curl "https://api.voximplant.com/platform_api/SendSmsMessage/?api_key=API_KEY&account_id=1&source=447443332211&destination=447443332212&sms_body=Test%20message"
```

**KALFA relevance:** Hebrew is UTF-16 territory — every Hebrew SMS segments at **70 chars**, so a typical invite/RSVP-link text is 2–3 billed segments per guest; that math feeds directly into per-reached-contact billing. A2P batch (`dst_numbers` with `;`) maps naturally onto campaign sends; the `failed[]` array gives per-guest delivery accounting for the "reached" definition. Branded "KALFA" SenderID = support ticket.

## 4. Receiving SMS — `guides.sms.receiving`
URL: https://voximplant.com/docs/guides/sms/receiving

- Each incoming SMS to an SMS-enabled Voximplant number fires **`IncomingSmsCallback`** (see references/httpapi/inboundsmscallback), containing **`IncomingSmsCallbackItem`** with source number, destination number, and SMS text.
- Setup: control panel → **Webhooks** section → Add → fill **Callback URL** (your backend endpoint) + **Security salt**, Save. General callback mechanics are in guides/management-api/callbacks.
- Optional: persist incoming SMS text — Settings → SMS configuration → "Always save the text of incoming messages".

**KALFA relevance:** Two-way SMS RSVP ("reply 1 to confirm") is feasible only with an SMS-capable (non-virtual) number + a webhook endpoint; KALFA already runs the ctx/cb HTTP-callback pattern for Voximplant calls, so an `IncomingSmsCallback` handler would follow the same shape (plus the Security-salt verification from the management-api callbacks guide).

---

## Cross-cutting gotchas
1. Virtual numbers never support SMS; SMS support is region+category-specific — must be verified per country via `GetPhoneNumberRegions.is_sms_supported`.
2. SMS is disabled by default on purchased numbers; explicit `ControlSms` enable required.
3. A2P SenderID installation is a manual support process.
4. Segment billing: 160 GSM-7 / 70 UTF-16 chars per segment; long-text caps differ by method (1600 A2P vs 765 two-way).
5. Docs text/example mismatch: `GetPhoneNumbers` (text) vs `GetPhoneNumberRegions` (example).
6. Both incoming and outgoing SMS are billed.
7. Message-text persistence in the panel is opt-in per direction (privacy-relevant: leaving it off keeps guest PII out of Voximplant's panel).

## INVENTORY (all pages in scope)
1. SMS (folder) — guides.sms — FETCHED
2. Choosing a phone number (tutorial) — guides.sms.phonenumbers — FETCHED
3. Sending SMS (tutorial) — guides.sms.sending — FETCHED
4. Receiving SMS (tutorial) — guides.sms.receiving — FETCHED
