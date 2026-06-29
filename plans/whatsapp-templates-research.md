# WhatsApp Cloud API Message Templates — Research & KALFA Design

> Scope: research + design ONLY. No production write to Meta/Graph API was made, no
> template was submitted, and no secret/token was read. This document is the input
> for a later, separately-approved submission + admin wiring step.
>
> Graph API version: the project pins **v23.0** (see `src/lib/whatsapp/*`). The
> Management endpoints below are version-stable; examples that show `v24.0`/`v23.0`
> are interchangeable — substitute the project's pinned version.
>
> Citation tags used inline:
> - **[meta-official]** OFFICIAL Meta docs, fetched LIVE this session via Context7 `/websites/developers_facebook_business-messaging_whatsapp` (8049 snippets, High reputation) — every snippet carries its real `developers.facebook.com/documentation/business-messaging/whatsapp/...` source URL. This is the authoritative source; it supersedes the third-party mirrors below where they disagree. See §0.
> - **[goevery]** Context7 `/goevery/whatsapp-cloud-api-client` (Zod schema mirror, 384 snippets)
> - **[ericvera]** Context7 `/ericvera/whatsapp-cloudapi`
> - **[sdk]** `whatsapp-api-js` v6.2.1 — local `node_modules/.../lib/messages/template.d.ts` + README/EXAMPLES, and Context7 `/secreto31126/whatsapp-api-js`
> - **[360dialog]** docs.360dialog.com `.md` / `.md?ask=` endpoints (BSP mirror of Cloud API)
> - **[ycloud]** docs.ycloud.com `.md` (webhook payload shapes)
> - **[VERIFY]** stated from prior knowledge, NOT confirmed against a fetched source in this pass — verify before relying.
>
> Two distinct APIs are involved:
> 1. **WhatsApp Business Management API** — create/edit/delete/list templates (this is the "authoring" side; KALFA does NOT yet call it).
> 2. **WhatsApp Cloud API (Messages)** — send an approved template to a recipient (this is what `src/lib/whatsapp/client.ts` already does, via `whatsapp-api-js`).

---

## 0. Official live-source verification (developers.facebook.com via Context7)

The two URLs the user supplied (`.../templates/overview`, `.../templates/template-media`) are **JS-rendered** — a plain WebFetch returns navigation only ("NO REAL CONTENT"), and direct browser rendering was declined. The official content was therefore read **live this session** through Context7's index of the official site: **`/websites/developers_facebook_business-messaging_whatsapp`** (8049 snippets, High reputation). Each fact below carries the real official source URL Context7 returned.

**Facts confirmed against the OFFICIAL docs this pass** (these supersede any earlier `[VERIFY]`/mirror note):

| Fact | Confirmed value | Official source URL |
|---|---|---|
| Template `name` | max **512** chars; lowercase alphanumeric + `_`; unique per (name, language) | `.../templates/marketing-templates/custom-marketing-templates` |
| `BODY` text | max **1024** chars; exactly **one** BODY component; supports multiple params | `.../templates/components` |
| `FOOTER` text | max **60** chars | `.../templates/marketing-templates/custom-marketing-templates` |
| `QUICK_REPLY` buttons | up to **10**; if mixed with non-quick-reply buttons they **must be grouped separately** | `.../templates/components` |
| POSITIONAL example | `example.body_text` = **array of arrays** `[[ "v1","v2","v3" ]]` | `.../templates/components` |
| NAMED example | `example.body_text_named_params` = **array of `{param_name, example}`** (the object-map mirror form is NOT authoritative) | `.../templates/marketing-templates/custom-marketing-templates` |
| Button-tap webhook | `messages[].type:"button"`, `button.payload` AND `button.text` BOTH = the tapped label; `context.id` = the wamid of the template we sent | `.../webhooks/reference/messages/button` |
| Send with params | `template.components[]` each with `type` (`header`/`body`/`button`) + `parameters[]` (`{type:"text", text:...}`); buttons add `sub_type` + `index` | `.../catalogs/mpm-template-messages` (send shape) |
| Create response | `{ "id", "status":"PENDING", "category" }` | `.../templates/utility-templates/utility-templates` |

> Note on Option A quick-reply detection: the official button webhook example shows `payload` == `text` (both the label) for a **template** quick-reply that had no developer payload set — so matching on `button.text` (`מגיע`/`לא מגיע`/`אולי`) is reliable; `payload` simply mirrors it. (The earlier "[VERIFY] unset-payload behavior" in §13 is now RESOLVED: payload equals the label text.)

Items still **not** found in an official snippet this pass (low impact — none affect the recommended Option A): exact header-TEXT max (commonly 60), quick-reply label max (~25), and the Resumable-Upload auth header — all only matter for a media header / long labels, which Option A does not use. §1bis below adds the OFFICIAL coverage of every richer template element the user asked about.

### 0.1 Sub-topic crawl — pages fetched this session (business-messaging path)

> The two user-supplied entry points were **WebFetched directly** this session — **both returned navigation only** (the `developers.facebook.com` site is a JS-rendered SPA; a plain WebFetch sees no article body). Substantive official content was therefore read via the **Context7 index of those exact same `developers.facebook.com/documentation/business-messaging/whatsapp/...` URLs**. Every fact in §0–§16 carries its real source URL; the consolidated list of sub-topic pages actually covered (all under `https://developers.facebook.com/documentation/business-messaging/whatsapp/`):

**Entry points** (user-supplied; WebFetched → nav-only; content via Context7):
- `/templates/overview`
- `/templates/template-media` — *nav-only; media-header create shape covered via `/templates/components`*

**Templates — core:** `/templates/components` · `/templates/template-management` (edit/delete limits) · `/templates/template-library` · `/templates/template-quality`

**Templates — categories & element types:** `/templates/marketing-templates` · `/templates/marketing-templates/custom-marketing-templates` · `/templates/marketing-templates/media-card-carousel-templates` · `/templates/marketing-templates/limited-time-offer-templates` · `/templates/marketing-templates/coupon-templates` · `/templates/utility-templates/utility-templates` · `/templates/authentication-templates/{authentication,copy-code,zero-tap}-...`

**Reference (API schemas):** `/reference/whatsapp-business-account/message-template-api/v25.0` (create/edit/delete) · `/reference/whatsapp-business-account/template-api` (create response) · `/reference/whatsapp-business-account/message-template-api` · `/reference/whatsapp-business-phone-number/message-api/v25.0` (header object: emojis/no-markdown)

**Catalog / commerce send shapes:** `/catalogs/catalog-template-messages` · `/catalogs/mpm-template-messages` · `/catalogs/spm-template-messages`

**Webhooks:** `/webhooks/reference/messages/button` (quick-reply tap) · `/webhooks/reference/message_template_status_update` (status events + rejection reasons) · `/webhooks/reference/message_template_quality_update` (GREEN/YELLOW/RED) · `/webhooks/reference/business_capability_update` (messaging tiers) · `/webhooks/reference/phone_number_name_update` (display-name review) · `/webhooks/reference/user_preferences` (marketing stop/resume)

**Other:** `/changelog` · `/whatsapp-business-accounts` · `/upcoming-messaging-limits-changes` · `/flows/guides/components` (Flow rich-text) · `/calling/call-button-messages-deep-links` (voice-call button) · `/display-names` (business attribution) · `/messages/send-messages` (quality signals) · `/payments/payments-in/enhanced-payment-links` (URL-button send shape)

---

## 1. Creation endpoint — `POST /{WABA_ID}/message_templates`

Templates are authored against the **WhatsApp Business Account (WABA)** node, not the phone number node.

```
POST https://graph.facebook.com/v23.0/{WABA_ID}/message_templates
Authorization: Bearer {SYSTEM_USER_ACCESS_TOKEN}
Content-Type: application/json
```

**Top-level request body fields** — OFFICIAL [meta-official — `.../reference/whatsapp-business-account/message-template-api/v25.0`; cross-checked [goevery]]:

| Field | Required | Type / enum | Notes |
|---|---|---|---|
| `name` | yes | string | lowercase `a–z`, digits, `_` only; max **512** chars — OFFICIAL (§0 [meta-official]). Immutable after creation. |
| `language` | yes | string (BCP-47-ish locale) | e.g. `he`, `en_US`, `pt_BR`. Immutable. The (name, language) pair is the unique key. |
| `category` | yes | `MARKETING` \| `UTILITY` \| `AUTHENTICATION` | See §2. |
| `components` | no | array | HEADER / BODY / FOOTER / BUTTONS. See §4. |
| `parameter_format` | no | `POSITIONAL` \| `NAMED` | Default `POSITIONAL`. See §5. |
| `allow_category_change` | no | boolean | Still listed as an optional field in the OFFICIAL create/edit reference [meta-official], but per [360dialog] Meta auto-assigns the category for new submissions regardless (2025-04-09) — do not rely on it. |

Additional OPTIONAL fields in the official create reference [meta-official]: `message_send_ttl_seconds`, `sub_category`, `display_format` (utility), `cta_url_link_tracking_opted_out`, `is_primary_device_delivery_only`, `send_type`, and the Library-clone inputs `library_template_name` / `library_template_button_inputs` / `library_template_body_inputs` (§12). None are needed for the RSVP invite.

**Success response** — OFFICIAL [meta-official — `.../reference/whatsapp-business-account/template-api`; cross-checked [goevery]]:

```json
{ "id": "1234567890", "status": "PENDING", "category": "MARKETING" }
```

The returned `id` is the **template ID** (distinct from the `name`). `status` starts at `PENDING` (see §9). The `category` echoes the category Meta actually assigned — which may differ from what you requested.

**Minimal create example** [goevery]:

```json
{
  "name": "order_confirmation",
  "language": "en_US",
  "category": "UTILITY",
  "components": [
    { "type": "BODY", "text": "Order {{1}} confirmed for {{2}}",
      "example": { "body_text": [["A123", "Dana"]] } }
  ]
}
```

---

## 2. Categories — `MARKETING` / `UTILITY` / `AUTHENTICATION`

[360dialog]

- **UTILITY** — non-promotional, tied to a **specific, already-agreed transaction or existing relationship the user opted into**: order/appointment updates, account alerts, reminders for something already confirmed. Triggered by a user action.
- **MARKETING** — anything promotional or relational that is **business-initiated** and not strictly utility/auth: offers, announcements, **invitations**, newsletters, re-engagement, generic/"welcome" messages. This is the broadest, most common category.
- **AUTHENTICATION** — one-time passcodes / verification codes only. Has its own rigid structure (§7) and its own button types.

**Auto-categorization & category change.** Meta's reviewer assigns the final category from the content, which can differ from the requested one. Since **`allow_category_change` was discontinued (2025-04-09)** [360dialog], a category mismatch now surfaces as a **`REJECTED`** template with reason `INCORRECT_CATEGORY` / `TAG_CONTENT_MISMATCH` rather than a silent re-category. Practical consequence: **request the category the content actually is**, or you burn a rejection.

**Pricing model (per-message, 2025 model)** [360dialog]:

- Pricing is **per delivered template message**, by the template's category (the old per-24h-conversation model was replaced).
- **UTILITY** messages are **free when sent inside an open 24-hour customer-service window** (i.e. within 24h of the user's last inbound message); otherwise charged at the utility rate.
- **MARKETING** and **AUTHENTICATION** are charged per message, with limited free-tier exceptions (e.g. free-entry-point / free-tier allotments). An unsolicited marketing message sent with **no open window** (the normal RSVP-invite case) **is charged**.
- Rates are per-country/per-category and set by Meta; KALFA must not hardcode them (consistent with the project's "no hardcoded business facts" rule — channel/price/policy are admin DB data read server-side).

---

## 3. Languages

[goevery][sdk]

- `language` is a fixed locale string. Hebrew is **`he`**. Other examples: `en`, `en_US`, `en_GB`, `pt_BR`, `es`, `ar`, `fr`.
- The code must match an entry in Meta's supported-language list **exactly**; `he` and `en_US` are not interchangeable with `he_IL`/`en`. [VERIFY KALFA uses bare `he` — the `message_templates.language` column already defaults to `'he'`, so the approved template's `language` MUST be created as `he` to resolve.]
- At **send** time the same code is passed. The SDK `Language(code, policy?)` wraps it; `policy` may be `"deterministic"` to force an exact-language match (no fallback) [sdk]. Default behavior selects the closest available translation of that template name.
- A single template **name** can have **multiple language entries** (each is a separate create call with the same `name`, different `language`). They share approval independently. For KALFA's `he`-first product, only `he` is needed now; `en`/`fr` can be added later under the same name without changing the `message_templates` row beyond `language`.

---

## 4. Components array

`components` is an ordered array. Each element has a `type`. A template has **at most one** HEADER, one BODY, one FOOTER, and one BUTTONS component.

### 4.1 HEADER

`{ "type": "HEADER", "format": <FORMAT>, ... }` where `format` ∈ `TEXT` | `IMAGE` | `VIDEO` | `GIF` | `DOCUMENT` | `LOCATION` — media formats OFFICIAL (`.../templates/components` [meta-official]); also [goevery][360dialog].

- **TEXT header** — `text` (max **60** chars — not confirmed in an official snippet this pass; §0), at most **one** variable. Example object is a **flat array**:
  ```json
  { "type": "HEADER", "format": "TEXT", "text": "Our {{1}} is on!",
    "example": { "header_text": ["Summer Sale"] } }
  ```
  [360dialog — verified this pass]. Named variant: `example.header_text_named_params: [{ "param_name": "...", "example": "..." }]` [VERIFY exact key].
- **Media header (IMAGE/VIDEO/GIF/DOCUMENT)** — NO `text`. Requires a **media example handle** (not a URL, not a media id) obtained from the Resumable Upload API (§6). OFFICIAL (`.../templates/components` [meta-official]): all media uses the Resumable Upload API; **GIF is Marketing-only** (mp4, **max 3.5 MB** — larger files render as video):
  ```json
  { "type": "HEADER", "format": "IMAGE",
    "example": { "header_handle": ["4::aW1hZ2UvanBlZw==:ARZ..."] } }
  ```
  [360dialog — `header_handle` confirmed]. The handle is only the **sample** Meta shows during review; at send time you supply the actual media via id or link (§8).
- **LOCATION header** — `{ "type": "HEADER", "format": "LOCATION" }`, no example at create; the lat/long/name/address are supplied as a header **parameter at send time** (`Location` type) [sdk].

### 4.2 BODY

`{ "type": "BODY", "text": "...", "example": {...} }` [goevery][360dialog].

- `text` length: up to **1024** chars when other components exist, up to **32768** when body-only [sdk].
- Supports placeholders `{{1}}`, `{{2}}`… (POSITIONAL) or `{{name}}` (NAMED) — §5.
- Markdown-style formatting allowed in body text: `*bold*`, `_italic_`, `~strikethrough~`, ` ```monospace``` ` [VERIFY].
- **Example object** (mandatory whenever the body has variables):
  - POSITIONAL → `example.body_text` is an **array of arrays** (outer = sample sets, inner = the ordered values):
    ```json
    { "type": "BODY",
      "text": "Shop now through {{1}} and use code {{2}} to get {{3}} off.",
      "example": { "body_text": [["end of August", "25OFF", "25%"]] } }
    ```
    [360dialog + goevery — verified this pass].
  - NAMED → `example.body_text_named_params`. **Two shapes observed** — Meta canonical is an **array of `{param_name, example}`**:
    ```json
    "example": { "body_text_named_params": [
        { "param_name": "name",  "example": "Emilia" },
        { "param_name": "company", "example": "360dialog" } ] }
    ```
    The array-of-objects form is **OFFICIAL** (§0 + §15.1 [meta-official]); the 360dialog `.md?ask=` mirror's object-map form `{"name":"Emilia",...}` is NOT authoritative.

### 4.3 FOOTER

`{ "type": "FOOTER", "text": "..." }` — plain text, max **60** chars — OFFICIAL (§0 [meta-official]), **no variables**, no formatting.

### 4.4 BUTTONS

`{ "type": "BUTTONS", "buttons": [ ... ] }`. Up to **10** buttons total — §0 confirms QUICK_REPLY ≤10; authoritative button-type list in §14.7 [meta-official]. Button object `type` ∈:

| Button `type` (create) | Create-time fields | Notes |
|---|---|---|
| `QUICK_REPLY` | `text` only | **No `payload` at create** — payload is set at SEND time (or defaults). Label max **25** chars (per §16.3 / §14.8). |
| `URL` | `text`, `url`, optional `example` | Static or dynamic URL. Dynamic = trailing `{{1}}` in `url` + `example:["https://x.com/123"]`. Max 2 URL buttons [VERIFY]. |
| `PHONE_NUMBER` | `text`, `phone_number` | Static. Max 1 [VERIFY]. |
| `COPY_CODE` | `example` (sample coupon) | Copy-coupon button. |
| `FLOW` | `text`, `flow_id`/`flow_name`, `navigate_screen` | WhatsApp Flows. |
| `OTP` | (AUTHENTICATION only) | `otp_type` ∈ `COPY_CODE` \| `ONE_TAP` \| `ZERO_TAP` — §7. |
| `MPM` / `CATALOG` | catalog/product | Commerce. |

**QUICK_REPLY at create — verified this pass** [360dialog + goevery]:
```json
{ "type": "BUTTONS", "buttons": [
    { "type": "QUICK_REPLY", "text": "מגיע" },
    { "type": "QUICK_REPLY", "text": "לא מגיע" },
    { "type": "QUICK_REPLY", "text": "אולי" } ] }
```
Quick-reply buttons are **baked into the approved template**. Sending the template requires **no send-time button component** unless you want to attach a developer-defined payload (§8/§13). Mixing quick-reply and CTA (URL/phone) buttons is allowed but quick-reply buttons must be **grouped separately** from the rest — OFFICIAL (§0 [meta-official]); the §16.3 `reservation_confirmation` example demonstrates a mixed group.

---

## 5. `parameter_format` — POSITIONAL vs NAMED

[goevery][sdk]

- **POSITIONAL** (default): placeholders are `{{1}}`, `{{2}}`… Order matters; send-time parameters are supplied in the same order. Example arrays are positional (`body_text: [[...]]`).
- **NAMED**: placeholders are `{{event_name}}`, `{{host}}`… Parameter names: lowercase `a–z` and `_` only, **≤20 chars** [sdk]. Example object uses `*_named_params` with `param_name`. Send-time parameters carry the `parameter_name`.
- **Consistency rule**: header and body must use the **same** style — all numbered or all named — within one template [sdk].
- SDK mapping: numbered → `new BodyParameter("value")`; named → `new BodyParameter("value", "param_name")` [sdk].

**KALFA recommendation: POSITIONAL.** Fewer moving parts, the SDK call is shorter, and the Hebrew copy is fully controlled by us (no third-party readability benefit from names). Use `{{1}}`, `{{2}}`, `{{3}}`.

---

## 6. Media / example handles end-to-end (Resumable Upload)

Only needed if a template has a **media header** (IMAGE/VIDEO/DOCUMENT). KALFA's recommended design has **no media header**, so this is informational.

Two different identifiers — do not confuse them:

- **Upload handle (`h`)** — produced by the **Resumable Upload API**, used ONLY in `example.header_handle` at template **create** time (the review sample).
- **Media id / link** — used at **send** time to attach the real media to the approved template's header.

**Resumable Upload flow (3 steps)** [360dialog `media-uploads`]:

1. **Create an upload session** (App node):
   ```
   POST https://graph.facebook.com/v23.0/{APP_ID}/uploads
        ?file_length={bytes}&file_type={mime}&file_name={name}
   ```
   → returns `{ "id": "upload:MTphdHRhY2ht...=" }`.
2. **Upload the bytes** to that session:
   ```
   POST https://graph.facebook.com/v23.0/{UPLOAD_SESSION_ID}
   Authorization: OAuth {ACCESS_TOKEN}      <-- note: "OAuth", not "Bearer", on Meta-native
   file_offset: 0
   <binary body>
   ```
   → returns `{ "h": "4::aW1hZ2UvanBlZw==:ARZ..." }` — that `h` is the handle.
   - **UNVERIFIED (could not fetch live):** the `Authorization: OAuth` header (and `file_offset`) is the Meta-native form per WebSearch of Meta's Resumable-Upload guide, but I could NOT confirm it in an official snippet this pass — the OFFICIAL `.../templates/template-media` page is JS-rendered (WebFetch → nav-only) and the Context7 index carries only the media-header **create** shape (`.../templates/components`: `header_handle` + "all media uploaded with the Resumable Upload API"), not the upload-session endpoints/auth. The 360dialog mirror uses its own `D360-API-KEY` header. Confirm before implementing — only relevant for a media header (Option A has none).
3. **Use the handle** in the create payload: `"example": { "header_handle": ["4::..."] }`.

At **send** time you instead pass the real media as a header parameter — `Image`/`Video`/`Document` with a `link` (public URL) or `id` (previously-uploaded media id) [sdk §8].

---

## 7. AUTHENTICATION templates

Not used by KALFA's RSVP flow, but the OTP path already exists elsewhere in the product (ExtrA SMS for OTP) — included for completeness. The **authoritative, officially-fetched** structure is in **§14.8 [meta-official]**; the summary below matches it (field names, `code_expiration_minutes` 1–90, `otp_type` values).

- Category `AUTHENTICATION`. The body is **fixed/derived** — you generally do not write free body text; Meta renders a standardized verification-code message.
- BODY component carries `add_security_recommendation: true|false` (appends the "don't share this code" line).
- FOOTER carries `code_expiration_minutes` (1–90) → renders "expires in N minutes".
- BUTTONS: a single `OTP` button with `otp_type`:
  - `COPY_CODE` — user taps to copy the code.
  - `ONE_TAP` — autofill via Android app handshake (requires `package_name` + `signature_hash`).
  - `ZERO_TAP` — silent autofill (most restrictive).
- Send-time: the code is passed as a body parameter AND as the button parameter. SDK exposes `Template.OTP(name, language, code)` as a convenience constructor [sdk].

---

## 8. Sending a template message (components/parameters) — **CRITICAL for client.ts**

This is the Cloud API Messages side and the SDK `whatsapp-api-js` is the layer KALFA already uses.

**Underlying Cloud API send shape** — OFFICIAL send examples at `.../templates/utility-templates`, `.../catalogs/spm-template-messages`, `.../templates/marketing-templates/limited-time-offer-templates` [meta-official]; shape mirror [goevery]:
```
POST https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages
{
  "messaging_product": "whatsapp",
  "to": "{E164_NO_PLUS}",
  "type": "template",
  "template": {
    "name": "kalfa_rsvp_invite_he",
    "language": { "code": "he" },
    "components": [
      { "type": "body",
        "parameters": [
          { "type": "text", "text": "בר מצווה של איתי" },
          { "type": "text", "text": "משפחת כהן" },
          { "type": "text", "text": "12/07/2026" } ] }
      // quick-reply buttons need NO component here unless attaching a payload
    ]
  }
}
```
Component `type`s at send: `header`, `body`, `button` (with `sub_type` + `index`). Button parameters [goevery]:
```ts
type TemplateButtonParameter =
  | { type: "payload"; payload: string }   // quick_reply
  | { type: "text";    text: string }      // url suffix, etc.
```

**SDK class mapping (`whatsapp-api-js` v6.2.1)** [sdk] — these are the exact classes `client.ts` must use:

| Cloud API piece | SDK class | Constructor |
|---|---|---|
| `template` envelope | `Template` | `new Template(name, language, ...components)` |
| `language.code` | `Language` | `new Language("he", policy?)` |
| body component | `BodyComponent` | `new BodyComponent(...BodyParameter)` |
| body param (positional) | `BodyParameter` | `new BodyParameter("value")` |
| body param (named) | `BodyParameter` | `new BodyParameter("value", "param_name")` |
| header component | `HeaderComponent` | `new HeaderComponent(...HeaderParameter)` |
| header param | `HeaderParameter` | `new HeaderParameter(text \| Image \| Video \| Document \| Location \| Currency \| DateTime)` |
| quick-reply button payload | `PayloadComponent` | `new PayloadComponent(payload)` |
| dynamic URL suffix | `URLComponent` | `new URLComponent(suffix)` |
| copy-code | `CopyComponent` | `new CopyComponent(code)` |
| media for header | `Image`/`Video`/`Document` | `new Image(idOrLink, isId?)` etc. |

Concrete examples [sdk README/EXAMPLES]:
```ts
// zero-parameter, static quick-reply template (Option A): no components at all
new Template("kalfa_rsvp_invite_he", new Language("he"));

// parameterized body (Option B):
new Template(
  "kalfa_rsvp_invite_he",
  new Language("he"),
  new BodyComponent(
    new BodyParameter("בר מצווה של איתי"),
    new BodyParameter("משפחת כהן"),
    new BodyParameter("12/07/2026"),
  ),
);

// optional: attach stable ASCII payloads to the 3 quick-reply buttons
new Template(
  "kalfa_rsvp_invite_he",
  new Language("he"),
  new BodyComponent(/* ... */),
  new PayloadComponent("rsvp_yes"),   // index 0 -> מגיע
  new PayloadComponent("rsvp_no"),    // index 1 -> לא מגיע
  new PayloadComponent("rsvp_maybe"), // index 2 -> אולי
);
```

> **The single most important `client.ts` change** to support parameterized templates:
> today `client.ts` builds `new Template(name, new Language(language))` with **no components** and the function signature only accepts `{to, templateName, language}`. To send parameters it must (a) accept structured parameter data in `params`, and (b) build the component objects and **spread** them into the constructor:
> `new Template(name, new Language(language), ...components)`, where `components` is assembled from `BodyParameter`s (and optionally `PayloadComponent`s) **in `{{1}},{{2}},{{3}}` order**. Everything else (`api.sendMessage`, the `providerId` extraction, the no-PII error handling) stays the same.

**Send response** (unchanged): `res.messages[0].id` → the `wamid....` that KALFA stores as `contact_interactions.provider_id`.

---

## 9. Approval lifecycle / statuses / quality / pausing

OFFICIAL [meta-official — `.../webhooks/reference/message_template_status_update`, `.../webhooks/reference/message_template_quality_update`, `.../templates/template-quality`].

**Status / event enum** (`message_template_status_update` webhook `event`):
`PENDING`, `APPROVED`, `REJECTED`, `FLAGGED`, `PAUSED`, `DISABLED`, `REINSTATED`, `IN_APPEAL`, `LOCKED`, `LIMIT_EXCEEDED`, `ARCHIVED`, `UNARCHIVED`, `PENDING_DELETION`, `DELETED`.

- **PENDING** on create → reviewed → **APPROVED** or **REJECTED**. Official `reason` enum: `ABUSIVE_CONTENT`, `INCORRECT_CATEGORY`, `INVALID_FORMAT`, `PROMOTIONAL`, `SCAM`, `TAG_CONTENT_MISMATCH`, `NONE` (= paused). The rejection payload carries `rejection_info.{reason, recommendation}` with human-readable guidance.
- **Quality rating** per template: `GREEN` / `YELLOW` / `RED` / `UNKNOWN` (pending) — from usage, customer feedback, engagement; delivered via the `message_template_quality_update` webhook (`previous_quality_score` → `new_quality_score`).
- **PAUSED**: low quality auto-pauses for escalating windows — pause `title` enum `FIRST_PAUSE` / `SECOND_PAUSE` / `RATE_LIMITING_PAUSE` / `UNPAUSE`; persistently bad → **DISABLED**. `FLAGGED` = at risk of disable; `LIMIT_EXCEEDED` = WABA at its template cap. **ARCHIVED** templates are scheduled for deletion after **28 days** unless unarchived.
- Status transitions are delivered via the `message_template_status_update` webhook field on the WABA — KALFA could subscribe to keep `message_templates.active` in sync, but that is out of current scope.

**KALFA mapping**: only an `APPROVED` template should have its `message_templates.active = true`. `getTemplateByKey` already resolves **active-only, fail-closed** — so a `PENDING`/`REJECTED`/`PAUSED` template simply must not be marked active, and no send will happen. Good fit; no engine change needed.

---

## 10. Limits

Sources: **[meta-official]** Context7 `/websites/developers_facebook_business-messaging_whatsapp`, fetched LIVE this pass — `.../templates/overview`, `.../changelog`, `.../whatsapp-business-accounts`, `.../webhooks/reference/business_capability_update`, `.../upcoming-messaging-limits-changes`. Mirror/unverified items flagged inline.

- **Templates per WABA**: **250** when the parent business portfolio is **not verified**; up to **6,000** when the portfolio is **verified AND has an approved display name** on at least one WABA. **Translated versions of a template count toward this limit.** [meta-official — `.../templates/overview`, `.../changelog`]
- **Template creation rate**: **UNVERIFIED (could not fetch live)** — a per-hour creation cap exists, but no official number was returned this pass (the "~100/hour" figure is prior-knowledge only).
- **Edits**: ≈ **1 / 24h** and ≈ **10 / 30 days** per template — **mirror-sourced [360dialog]; NOT confirmed in an official snippet this pass.**
- **Components**: ≤1 each of HEADER/BODY/FOOTER/BUTTONS; **≤10 buttons** (QUICK_REPLY ≤10 with grouping — §0; authoritative button list §14.7) [meta-official].
- **Text caps**: header TEXT 60 (not officially confirmed this pass — §4.1), **footer 60 (official §0)**, **body 1024** with other components / 32768 body-only, quick-reply label **25** (§16.3 / §14.8), named param ≤20 chars [sdk].
- **Messaging-limit tiers** (per **business portfolio**, not per phone): **250 → 2K → 10K → 100K → unlimited** (`TIER_250` / `TIER_2K` / `TIER_10K` / `TIER_100K` / `TIER_UNLIMITED`; numeric 250 / 2000 / 10000 / 100000 / -1). [meta-official — `business_capability_update` webhook]. NOTE: the second tier is **2,000**, not 1,000. The legacy `max_daily_conversation_per_phone` is **deprecated (removed Feb 2026)**. A separate throughput change (Oct 7 2025) gates 1,000 msg/sec on an unlimited portfolio + 100K unique users/24h + Medium+ quality [meta-official — `.../upcoming-messaging-limits-changes`].

---

## 11. Editing & deleting

OFFICIAL [meta-official — `.../reference/whatsapp-business-account/message-template-api/v25.0`, `.../templates/template-management`]. The delete name-reuse cool-down remains **UNVERIFIED (could not fetch live)**.

- **Edit**: `POST /{TEMPLATE_ID}` with updated `components` and/or `category`; success returns `{ "success": true }`. Only **APPROVED / REJECTED / PAUSED** templates can be edited; **all components are replaced** on edit; **cannot** change `name` or `language` (identity), and an **approved** template's `category` cannot be changed. Edits **auto-approve unless they fail review**. Limits (OFFICIAL): **1 edit / 24h** and **10 edits / 30 days** for an APPROVED template; REJECTED/PAUSED have **unlimited** edits.
- **Delete** (OFFICIAL): by **name** (removes ALL languages) `DELETE /{WABA_ID}/message_templates?name={NAME}`; by **id** (single language) `...?hsm_id={TEMPLATE_ID}&name={NAME}`; or a **list of up to 100 template IDs** in one request. Deletion is soft-then-hard (`PENDING_DELETION` → `DELETED`); name-reuse cool-down **UNVERIFIED**.

**KALFA**: because `message_key`/`channel` are fixed in `message_templates` and the `name`/`language` are admin-editable fields, editing the **Meta** template name later would orphan the mapping. Treat the approved `name` as stable; to change copy, edit the template **in place** at Meta (same name) and keep the `message_templates.name` value unchanged.

---

## 12. Library templates

OFFICIAL [meta-official — `.../templates/template-library`].

- Meta provides a **template library** of pre-written, pre-categorized (mostly UTILITY) templates for common use cases (order updates, OTPs, appointment reminders).
- Create from library: `POST /{WABA_ID}/message_templates` with `name`, `category` (**must be `UTILITY`**), `language`, and `library_template_name`; `library_template_button_inputs` is optional but **required if the library template has buttons** [meta-official]. No free `components` are authored — these are typically approved instantly.
- There is **no library entry that matches a Hebrew RSVP-invite with custom quick-replies**, so KALFA authors a custom template. Library is noted only as the faster path for future generic utility messages (e.g. a "your RSVP was received" confirmation).

---

## 13. Webhook for buttons — exact inbound payload for a QUICK_REPLY tap

**This is the load-bearing fact for "reached" detection.** A tap on a **template** quick-reply button is delivered as a **`type: "button"`** message — NOT as an interactive `button_reply`.

**Template quick-reply tap** [ycloud — verified this pass]:
```json
{
  "type": "button",
  "button": {
    "payload": "more_about_marketing_friday",
    "text": "Learn more"
  },
  "context": {
    "from": "447901614024",
    "id": "wamid.HBgNODr..."        // the wamid of the template we sent
  }
}
```
- `button.text` = the **label the user tapped** (always present — this is the tapped button's text).
- `button.payload` = the tapped button's payload. For a **template** quick-reply with **no** developer payload, the official webhook example shows `payload` **equals** `button.text` (both the label) — **RESOLVED in §0 [meta-official]**. If you DO attach a developer payload at send time (via `PayloadComponent`), `payload` carries that string instead. Matching on `button.text` is reliable either way.
- `context.id` = the `wamid` of the original template message → lets KALFA tie the reply back to the exact outbound `contact_interactions.provider_id` and thus to the contact + campaign.

Contrast — an **interactive** reply-button tap (different feature, NOT what templates produce) [ycloud]:
```json
{ "type": "interactive",
  "interactive": { "type": "button_reply",
    "button_reply": { "id": "...", "title": "..." } } }
```

**KALFA inbound mapping** (the B2 webhook handler, separate task):
1. Verify the webhook signature with `appSecret` (the project's `secure:true` path).
2. Detect `value.messages[].type === "button"`.
3. Read `button.text` (and `button.payload` if present), and `context.id`.
4. Map the tapped label/payload → RSVP answer:
   - `מגיע` / `rsvp_yes` → **attending**
   - `לא מגיע` / `rsvp_no` → **not attending**
   - `אולי` / `rsvp_maybe` → **maybe**
5. ANY of the three taps counts as **"reached"** (the contact engaged with the message). Log an INBOUND `contact_interactions` row (direction `'in'`), idempotent on `UNIQUE(channel, provider_id)` using the inbound message's own `wamid`. Resolve the contact via `context.id` → the stored outbound `provider_id`.

---

## 14. Full catalog of template element types (OFFICIAL, live via Context7 `[meta-official]`)

Beyond the simple body+quick-reply invite, the Templates API supports many richer element types. Each below is taken from an official `developers.facebook.com` snippet fetched this session, with its source URL. KALFA's RSVP invite needs none of these now, but this is the complete option space for future messages (e.g. a media invite, a "save the date" carousel of venues, a coupon, a one-tap call).

### 14.1 Header formats — `TEXT` / `IMAGE` / `VIDEO` / `DOCUMENT` / `LOCATION`
Source: `.../templates/components`, `.../reference/whatsapp-business-phone-number/message-api/v25.0`.
- `TEXT` header: `{ "type":"HEADER","format":"TEXT","text":"Our {{1}} is on!","example":{"header_text":["Summer Sale"]} }` — at most **one** variable; emojis allowed, **no markdown**.
- Media header (`IMAGE`/`VIDEO`/`DOCUMENT`): no `text`; at **create** time supply a sample via `example.header_handle:["4::aW..."]` (Resumable Upload handle, §6); at **send** time supply the real asset as a header parameter (`{"type":"image","image":{"id":"..."}}` or a `link`).
- `LOCATION` header: created with `format:"LOCATION"`, no example; lat/long/name/address are sent as header parameters at send time.

### 14.2 Carousel templates (multi-card)
Source: `.../templates/marketing-templates/media-card-carousel-templates`.
A top-level `BODY` plus a `{"type":"carousel","cards":[ ... ]}` component. Each **card** is its own `components` array with a **media header** (`header_handle` example) and a per-card `buttons` group (quick_reply + url + phone_number). All cards must share the same structure. Example (3 image cards, each with a quick-reply + dynamic-URL button):
```json
{ "type":"carousel", "cards":[
  { "components":[
      { "type":"header","format":"image","example":{"header_handle":["4::an..."]} },
      { "type":"buttons","buttons":[
          { "type":"quick_reply","text":"Send me more like this!" },
          { "type":"url","text":"Shop","url":"https://luckyshrub.com/x/{{1}}","example":["BLUE_ELF"] } ] } ] }
  /* + more cards, same shape */
] }
```

### 14.3 Limited-Time Offer (LTO) templates
Source: `.../templates/marketing-templates/limited-time-offer-templates`.
Adds a `{"type":"limited_time_offer","limited_time_offer":{"text":"Expiring offer!","has_expiration":true}}` component (with an image header, body vars, a `copy_code` button and a dynamic `url` button). At **send** time the offer carries `expiration_time_ms` and the copy-code button carries `{"type":"coupon_code","coupon_code":"CARIBE25"}`. Category `marketing`.

### 14.4 Coupon-code templates
Source: `.../templates/marketing-templates/coupon-templates`.
Category `MARKETING`, `parameter_format:"named"`. A `BODY` with a `{{coupon_code}}` named param + a `BUTTONS` group mixing `QUICK_REPLY` and `COPY_CODE` (the latter takes `example:"WINTER25"`, the clipboard sample). The user copies a one-time code.

### 14.5 Catalog & product templates
- **Catalog** template — Source: `.../catalogs/catalog-template-messages`. `BODY` + `FOOTER` + a single `{"type":"CATALOG","text":"View catalog"}` button.
- **Multi-Product Message (MPM)** — Source: `.../catalogs/mpm-template-messages`. Sent with a `button` component `sub_type:"mpm"`, `parameters[].type:"action"` carrying `sections[].product_items[].product_retailer_id` (SKUs). Section `title` max **24** chars.

### 14.6 Call-to-action: voice/phone, URL, Flow
- **Voice-call button** — Source: `.../calling/call-button-messages-deep-links` + `.../templates/components`. `{"type":"voice_call","text":"Call Now","ttl_minutes":1440}` (also seen as `VOICE_CALL`). Lets the user place a WhatsApp voice call to the business.
- **URL button** — static, or **dynamic** with a trailing `{{1}}` in `url` + `example:["https://.../123"]`; at send time the suffix is a `button` `sub_type:"url"` text parameter.
- **PHONE_NUMBER button** — `{"type":"phone_number","text":"Call us","phone_number":"+15550051310"}` (static).
- **Flow button** — Source: `.../flows/...`. `{"type":"flow","text":"Get Started","flow_id":"..."}` (or `flow_name`/`flow_json`, plus `flow_action`/`navigate_screen`) launches a WhatsApp Flow.

### 14.7 Authoritative button-type list
Source: `.../reference/whatsapp-business-account/message-template-api/v25.0`.
Supported button `type`s: **`CATALOG`, `COPY_CODE`, `FLOW`, `MPM`, `OTP`, `PHONE_NUMBER`, `QUICK_REPLY`, `URL`** (+ `VOICE_CALL` per §14.6). Per-type properties: `url`, `phone_number`, `otp_type`, `autofill_text`, `package_name`, `signature_hash`, `flow_id`, `flow_name`, `flow_json`, `flow_action`, `navigate_screen`.

### 14.8 Authentication templates (OTP) — full structure
Sources: `.../templates/authentication-templates/{copy-code,zero-tap,authentication}-...`.
- Category `authentication`; optional top-level `message_send_ttl_seconds`.
- `BODY` carries `add_security_recommendation: true|false` (no free text — Meta renders the standardized code message).
- `FOOTER` carries `code_expiration_minutes` (**min 1, max 90**).
- `BUTTONS` → one `OTP` button with `otp_type`:
  - `copy_code` — `text` (copy-code label, **max 25 chars**).
  - `one_tap` — Android autofill; requires `supported_apps:[{package_name, signature_hash}]` (+ optional `autofill_text`).
  - `zero_tap` — silent autofill; adds `zero_tap_terms_accepted:true` + `supported_apps`.
- **Multi-language at once:** `POST /{WABA_ID}/upsert_message_templates` with `languages:["en_US","es_ES","fr"]` creates/updates all languages in one call (returns a `data[]` of per-language `{id,status,language}`).

> KALFA relevance: none of §14 is needed for the RSVP invite. The realistic future uses are (a) an **IMAGE header** on the invite (§14.1 — needs the Resumable Upload handle at create + a media id/link at send), (b) an `AUTHENTICATION` OTP template (§14.8) if WhatsApp ever replaces the ExtrA-SMS OTP path, and (c) a **carousel** "venue/date options" marketing message (§14.2). All are additive; the recommended invite stays body + 3 quick-replies.

## 15. In-message "decorations" — formatting, tags, emojis, line breaks

The user asked what else can be *displayed inside* the message (text decoration, "tags"). This is distinct from §14 (structural components/buttons). Three things can decorate the rendered text: **variable tags**, **inline text formatting**, and **emojis/line breaks**.

### 15.1 Variable tags / placeholders ("תגיות") — OFFICIAL `[meta-official]`
Source: `.../templates/overview`.
Body text carries **parameters (variables)** in double curly braces. Two formats, set by top-level `parameter_format`:
- **Positional** (default): `{{1}}`, `{{2}}`, … 1-based; the `example.body_text` values and the send-time values **must be in the same order** as the placeholders. e.g. `"Hi {{1}}! Your order number is {{2}}."`
- **Named**: `{{first_name}}`, `{{order_number}}` — each a unique lowercase-+-underscore string; `example.body_text_named_params` is `[{param_name, example}]` and values may appear **in any order**. e.g. `"Thank you, {{first_name}}!"`
Rules confirmed officially: every parameter needs an example at create time; positional is the default if `parameter_format` is omitted; a TEXT header supports **at most 1** parameter (§14.1). (KALFA's Option B uses positional `{{1}}`/`{{2}}`/`{{3}}` = event/host/date.)

### 15.2 Inline text formatting (the "decorations")
There are **two different formatting surfaces** — do not conflate them:

**(a) WhatsApp Flows screens** (`RichText`/`TextBody`/`TextCaption`, `markdown:true`) — OFFICIAL `[meta-official]`, source `.../flows/guides/components`. CommonMark-style markdown:
- `**bold**`, `*italic*`, `~~strikethrough~~`, and combined e.g. `~~***really important***~~`
- `[links](https://…)` to external sites
- **Ordered & unordered lists** (single level): `1. item` / `- item`
- **Headings** h1/h2, paragraphs, and inline **base64 images** (png/jpg/webp)
- This applies only **inside a Flow**, not to a normal template body.

**(b) Normal message / template BODY text** — single-character WhatsApp formatting. An **OFFICIAL** template example (`reservation_confirmation`, source `.../templates/utility-templates`) literally uses `*bold*` in the body: `"*You're all set!*\n\nYour reservation for {{number_of_guests}}…"`. So `*bold*` in a template BODY is demonstrated in official docs. The app renders the same single-character markers it renders in any chat — `*bold*`, `_italic_`, `~strikethrough~`, triple-backtick `monospace`, plus list (`- `, `* `, `1. `), inline code and block-quote (`> `) — but the developer docs only formally show `*bold*`/`\n`; the rest are WhatsApp **client** rendering (`[whatsapp-client]`, consumer FAQ) and aren't validated by the create API, so use them sparingly. For KALFA's RSVP invite a single `*bold*` on the event name is now **officially-precedented** and safe; heavier formatting stays optional.

> **TEXT header has NO formatting** — OFFICIAL `[meta-official]`, source `.../templates/components`: *"Markdown special characters are not supported"* in a text header, and a text header supports **1 parameter**. So decoration belongs in the BODY, never the header.

### 15.3 Emojis & line breaks — OFFICIAL `[meta-official]`
- **Emojis** are explicitly allowed in headers (HeaderObject: *"Emojis supported, no markdown"*, source `.../reference/whatsapp-business-phone-number/message-api/v25.0`) and in body text — KALFA's invite already uses 🎉.
- **Line breaks**: literal `\n` inside the BODY `text` string create new lines (the invite body uses `\n` between the greeting and the question). Avoid long runs of consecutive newlines/whitespace — Meta's template review rejects bodies that are mostly formatting/whitespace.

### 15.4 What you CANNOT add to a template message
For completeness (so the option space is closed): a template message cannot contain arbitrary HTML/CSS, custom fonts/colors, styled inline links beyond what the client auto-links (the client auto-links bare URLs; styled `[text](url)` links work only in Flows per 15.2a), attachments other than the single declared header media, or more than the declared components. All "rich" behavior comes from the **structured components in §14** (media header, buttons, carousel, LTO, etc.), not from free-form markup in the body.

> **KALFA decision:** the RSVP invite stays **plain Hebrew body + 🎉 emoji + `\n` line break + 3 quick-reply buttons**. Variable tags (§15.1) are the only "decoration" we add when we move to Option B (event/host/date). Everything else in §14–§15 is documented for future messages but intentionally unused now — it keeps the template simple, predictable, and fast to get approved.

## 16. The WhatsApp UI that wraps a business message + the RSVP button choice

The user asked about elements WhatsApp's **own client UI** adds around a business message (business-attribution label, 👍/👎 feedback, block/report) and to go deeper on the RSVP template's own choices (message, variables, quick-reply vs link vs Flow). These split into "what the recipient sees/controls" (16.1–16.2, account-level, NOT set in the template) and "what we put in the template" (16.3).

### 16.1 Business Attribution Label — what identifies KALFA to the recipient — OFFICIAL `[meta-official]`
The label above a business message is **account-level identity**, not a template field. Four official pieces:
- **Display name** (`verified_name` + `name_status`) — the business name shown in the chat header. Read it: `GET /{phone_number_id}?fields=verified_name,name_status` → `{"verified_name":"Lucky Shrub","name_status":"APPROVED"}`. Review outcomes arrive via the **`phone_number_name_update`** webhook (`decision`: `APPROVED|DEFERRED|PENDING|REJECTED`, with a `rejection_reason` enum e.g. `NAME_NOT_CONSISTENT`, `NAME_FORMAT_UNACCEPTABLE`). Source: `.../display-names`, `.../webhooks/reference/phone_number_name_update`.
- **Official Business Account (OBA)** — the green-checkmark badge. Status: `GET /{phone_number_id}/official_business_account_status` → `{"status":"verified","verification_status":"approved"}`. Source: `.../official_business_account_status`.
- **Business Verification status** — `business_verification_status` on the WABA: `VERIFIED|UNVERIFIED|PENDING|REJECTED`. Source: `.../reference/business/whatsapp-business-accounts-api`.
- **"Sent on behalf of" attribution** — `on_behalf_of_business_info` (the `{id,name}` of the business the WABA operates for). When a Solution Partner sends on a client's behalf, this is what surfaces the attributed business. Partner-led verification: `POST /{business_portfolio_id}/self_certify_whatsapp_business`. Source: `.../reference/business/...`, `.../solution-providers/partner-led-business-verification`.
- **"Sent via {provider}" label** — when the sending number is **not** a verified/OBA business (or sends through a Tech/Solution Provider that surfaces its own app name), WhatsApp shows the recipient a small *"נשלח באמצעות {provider}"* / *"Sent via {provider}"* attribution. To remove it / replace it with the business's own verified name + checkmark, the path is **business verification → Official Business Account**: submit via `POST /{phone_number_id}/official_business_account` (`action:"SUBMIT_APPLICATION"`, `application_data:{business_name, business_description, website_url, contact_email}`) → poll `oba_status`; partner-submitted client certification reports back through the **`account_update`** webhook (`event:"PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE"`). Per `.../solution-providers/overview`: clients **must verify** for increased messaging limits, more phone numbers, and OBA status. Source: `.../official_business_account_status` (submit endpoint), `.../webhooks/reference/account_update`.

> **📸 Real-world evidence (competitor screenshot, IMG_3608):** a live invite from **iPlan** (a competitor RSVP platform) shows exactly this — a teal **FOOTER** ("בוסטן גן אירועים", the venue brand) and, circled, **"נשלח באמצעות iPlan"** = the *Sent-via-provider* label. So a recipient currently sees the **provider's** name, not a verified business + checkmark. The concrete lesson for KALFA: until the sending number is verified/OBA, invites read *"נשלח באמצעות KALFA"* (or via whatever BSP we use). Decide deliberately whether that attribution is desirable branding or whether to pursue OBA so the **customer's/own verified name** shows instead.

> **KALFA relevance:** the invite's "from" identity is the WABA's **approved `verified_name`** — nothing in the template controls it. Action items for trust + higher limits + dropping the "sent via" label: get the display name `APPROVED`, submit the **OBA application** + business verification, and (if KALFA sends as a partner for customers) set the on-behalf-of business so the label attributes the right entity. Track these via the two GET calls + the `phone_number_name_update` / `account_update` webhooks.

### 16.2 Feedback, block & report — the quality system — OFFICIAL `[meta-official]`
What the recipient can do to a business message, and what it costs KALFA:
- **Block / report / mute / archive** are **user feedback signals**. Per `.../messages/send-messages` (*Message quality*): quality is assessed from **blocks, reports, mutes, and archives over the past 7 days, weighted by recency**.
- That rolls up into the **phone-number quality rating** `WhatsAppPhoneNumberQualityRating` = `GREEN | YELLOW | RED | NA | UNKNOWN`. A `RED` number gets its **messaging limits reduced** and can be flagged/restricted. Source: `.../reference/whatsapp-account-number/...`.
- **👍/👎 "Interested / Not interested"** — the marketing feedback prompt (the "Offers and announcements" setting). "Not interested" **can impact messaging limits** and offers the user a one-tap "stop all marketing from this business." NOTE: Interested/Not-interested does **NOT** fire a webhook. Source: `.../templates/marketing-templates`. **📸 Real-world evidence (competitor screenshot, IMG_3607):** the same iPlan invite shows WhatsApp's prompt **"ההודעה הזאת מעניינת אותך?"** with **👎 / 👍** icons — this prompt appears **only on MARKETING messages**, so it confirms iPlan's RSVP invite is classed **MARKETING**, and each 👎 is a quality/opt-out signal working against the sender.
- **Stop / Resume marketing** — these DO fire the **`user_preferences`** webhook (`category:"marketing_messages"`, `value:"stop"|"resume"`). After a user stops, sending them a MARKETING template **fails with code `131050`** (recipient opted out). Source: `.../webhooks/reference/user_preferences`, `.../templates/marketing-templates`.
> **KALFA design implication (important):** the 👍/👎, opt-out, and `131050` failures are **MARKETING-category mechanics**. An event RSVP sent to a guest the host explicitly added is arguably **UTILITY** (a transaction about one specific event the guest is invited to) — UTILITY is exempt from the marketing opt-out / Interested-Not-interested path, keeps quality higher, and avoids `131050`. The current design (§ below) picks **MARKETING**; we should **re-evaluate UTILITY** with Meta's category rules, because the right category both lowers block/report exposure AND avoids INCORRECT_CATEGORY rejection (categories can't be auto-changed since 2025-04-09). Either way, KALFA must honor `user_preferences` stop + `131050` as hard stops in the outreach engine (ties to `[[outcome-billing-model]]` reached-set + the frozen authorized set).

### 16.3 The RSVP template's own choices — message, variables, and quick-reply vs URL vs Flow — OFFICIAL `[meta-official]`
The closest official analog is the **`reservation_confirmation`** UTILITY example (source `.../templates/utility-templates`): an IMAGE header + a named-param body (`"*You're all set!*\n\nYour reservation for {{number_of_guests}} … on {{day}}, {{date}}, at {{time}} …"`) + a FOOTER + a **mixed** button group: `URL "Change reservation"`, `PHONE_NUMBER "Call us"`, `QUICK_REPLY "Cancel reservation"`. It proves you can combine response styles in one template (quick-reply grouped separately from URL/phone).

Three ways to collect the RSVP answer — pick by how much input you need:
| Button type | UX | Response path | When for KALFA |
|---|---|---|---|
| **QUICK_REPLY** (≤10, label **max 25 chars** — OFFICIAL) | 1 tap, stays in WhatsApp | tap → inbound webhook `type:"button"`, `button.text`=label, `context.id`=sent wamid (§13) | **Primary** — מגיע / לא מגיע / אולי. Maps directly to the reached/interaction signal, zero web round-trip |
| **URL** (static or dynamic `{{1}}` suffix) | leaves WhatsApp → opens a page | open KALFA `r/[token]` web RSVP; token as the dynamic suffix | **Secondary** — when you need richer input (guest count, dietary, notes) than 3 fixed answers |
| **FLOW** (`flow_id`/`flow_name`/`flow_json`) | multi-screen form **inside** WhatsApp | Flow endpoint returns structured data; no web exit | **Future** — best UX for structured RSVP (count + notes) without leaving WhatsApp; heavier to build (Flow JSON + endpoint) |

> **KALFA decision (unchanged, now evidence-backed):** ship **3 QUICK_REPLY buttons** (1-tap, in-app, clean reached mapping, labels well under 25 chars). Add a **URL** button to `r/[token]` only when richer detail is needed; graduate to a **FLOW** only if in-chat structured capture (guest count/dietary) becomes a requirement. Variables (§15.1) stay positional `{{1}}/{{2}}/{{3}}` = event/host/date for Option B. A single `*bold*` on the event name is officially-precedented (§15.2b).

---

# KALFA Template Design (do NOT submit — design only)

## Naming & key mapping

- **Template name**: `kalfa_rsvp_invite_he`
- **Language**: `he`
- **Maps to** the `message_templates` row with `message_key = 'invite'`, `channel = 'whatsapp'`, `name = 'kalfa_rsvp_invite_he'`, `language = 'he'`, `active = true` (set active ONLY once Meta returns `APPROVED`). `getTemplateByKey('invite')` then resolves `{ name: 'kalfa_rsvp_invite_he', language: 'he', channel: 'whatsapp' }`, fail-closed.

## Recommended category: **MARKETING** (committed)

An RSVP invitation is **business-initiated** (KALFA/the host reaches out first; the guest has not messaged), and it is an **invitation** — the textbook MARKETING definition [360dialog §2]. UTILITY requires a specific already-agreed transaction inside a service window, which an unsolicited invite is not. Submitting it as UTILITY risks a `REJECTED / INCORRECT_CATEGORY`, and since **`allow_category_change` is gone (2025-04-09)** there is no silent fallback. Choosing MARKETING up front avoids a wasted rejection.

**Billing tie-in**: MARKETING is charged **per delivered message** (no free window for an unsolicited invite). This aligns cleanly with KALFA's **outcome / per-reached-contact** billing model (a campaign's authorized set is frozen, sends are bounded to it, and each reached contact is the billable unit). It also reinforces the existing `billable: false` on the **outbound template** interaction (the send itself is a cost, not the billable outcome — the inbound "reached" is what matters).

> A later "**your RSVP was received**" confirmation, sent in response to the guest's tap **inside the 24h window**, could legitimately be **UTILITY** (and thus free in-window). That is a separate, optional template, not part of this invite.

## Buttons (both options): 3 × QUICK_REPLY

```json
{ "type": "BUTTONS", "buttons": [
    { "type": "QUICK_REPLY", "text": "מגיע" },
    { "type": "QUICK_REPLY", "text": "לא מגיע" },
    { "type": "QUICK_REPLY", "text": "אולי" } ] }
```
Tap → RSVP per §13. "Reached" = any tap.

---

## Option A — ZERO-parameter body (works with **current `client.ts` unchanged**)

Use this to validate the end-to-end pipeline (create → approve → send → inbound webhook → "reached") **without touching `client.ts`**, because the current adapter sends `name + language` only.

**Hebrew body (no variables):**
> היי! קיבלת הזמנה לאירוע שלנו 🎉
> נשמח לדעת אם תגיעו. אנא בחרו אחת מהאפשרויות למטה:

**Full create payload (do NOT POST yet):**
```json
{
  "name": "kalfa_rsvp_invite_he",
  "language": "he",
  "category": "MARKETING",
  "components": [
    { "type": "BODY",
      "text": "היי! קיבלת הזמנה לאירוע שלנו 🎉\nנשמח לדעת אם תגיעו. אנא בחרו אחת מהאפשרויות למטה:" },
    { "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "מגיע" },
        { "type": "QUICK_REPLY", "text": "לא מגיע" },
        { "type": "QUICK_REPLY", "text": "אולי" } ] }
  ]
}
```
No `example` object is needed (no variables). No FOOTER/HEADER for the simplest first pass.

**Send (current code, unchanged):** `new Template("kalfa_rsvp_invite_he", new Language("he"))` — exactly what `sendWhatsAppTemplate` already builds.

**Reached/RSVP mapping for Option A**: since no `PayloadComponent` is sent, the webhook handler matches on **`button.text`** (`מגיע`/`לא מגיע`/`אולי`). Robust enough for validation; the only fragility is if the Hebrew label copy is edited later (the match string must be updated in lockstep).

**Trade-off**: zero engineering, immediate pipeline proof. But the message is generic — no event name/host/date — so it is a validation artifact, not the production invite.

---

## Option B — Parameterized body (event name, host, date)

Production-quality invite with 3 positional variables. Requires the `client.ts` change described in §8.

**Hebrew body with `{{1}} {{2}} {{3}}`:**
> שלום! 🎉
> משפחת {{2}} שמחה להזמין אתכם ל{{1}}.
> התאריך: {{3}}.
> נשמח לאישור הגעה — בחרו אחת מהאפשרויות למטה:

- `{{1}}` = event name (e.g. "בר מצווה של איתי")
- `{{2}}` = host / family (e.g. "כהן")
- `{{3}}` = formatted date (e.g. "12/07/2026")

**Full create payload (do NOT POST yet):**
```json
{
  "name": "kalfa_rsvp_invite_he",
  "language": "he",
  "category": "MARKETING",
  "parameter_format": "POSITIONAL",
  "components": [
    { "type": "BODY",
      "text": "שלום! 🎉\nמשפחת {{2}} שמחה להזמין אתכם ל{{1}}.\nהתאריך: {{3}}.\nנשמח לאישור הגעה — בחרו אחת מהאפשרויות למטה:",
      "example": { "body_text": [["בר מצווה של איתי", "כהן", "12/07/2026"]] } },
    { "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "מגיע" },
        { "type": "QUICK_REPLY", "text": "לא מגיע" },
        { "type": "QUICK_REPLY", "text": "אולי" } ] }
  ]
}
```
Note `example.body_text` is an **array of arrays**, the values in `{{1}},{{2}},{{3}}` order [verified §4.2]. (Body-rejection guard now **OFFICIALLY confirmed**: a real `REJECTED` / `INVALID_FORMAT` webhook example flags *"parameters placed next to each other (like {{1}}{{2}}) without text or punctuation between them"*, recommending you *"separate parameters with descriptive text"* [meta-official — `.../webhooks/reference/message_template_status_update`]. The start/end-of-body and variable-ratio heuristics remain UNVERIFIED. The copy above complies: every `{{n}}` is surrounded by Hebrew text.)

**Send (after the client change):**
```ts
new Template(
  "kalfa_rsvp_invite_he",
  new Language("he"),
  new BodyComponent(
    new BodyParameter(eventName),  // {{1}}
    new BodyParameter(hostFamily), // {{2}}
    new BodyParameter(eventDate),  // {{3}}
  ),
);
```

### What must change for Option B — the full chain (not just `client.ts`)

The variable **values** come from **event / contact / campaign rows**, not from `message_templates`. Today nothing threads them through. Required changes, in order:

1. **`src/lib/whatsapp/client.ts`** — extend `sendWhatsAppTemplate`'s `params` to accept structured parameter data (e.g. `bodyParams: string[]` and optionally `buttonPayloads?: string[]`), and build `new Template(name, new Language(language), new BodyComponent(...bodyParams.map(p => new BodyParameter(p))), ...payloadComponents)`. Preserve `{{1}},{{2}},{{3}}` order. **This is the single most important change.**
2. **`src/lib/data/message-templates.ts`** — `getTemplateByKey` currently returns only `{ name, language, channel }`. It does NOT need the values (those are not template metadata), but if variable *names/positions* should be data-driven, that mapping would live here or in config. For a fixed 3-param invite, hardcoding the positional mapping in the send path is acceptable.
3. **`src/lib/data/outreach.ts`** — `sendOneWhatsApp` currently receives only `campaign: { id, event_id }` and `contact: { id, normalized_phone }`. It must additionally **load the event** (name, host/family, date) and pass those as `bodyParams`. `sendCampaignWhatsApp` already has `campaign.event_id`; add a single `events` fetch (name + host + `event_date`) before the contact loop and thread the values into `sendOneWhatsApp`.
4. **Date formatting** — `events.event_date` is **`timestamptz`** (per project schema note), not a `date`. Format it for `{{3}}` (e.g. `toLocaleDateString('he-IL')` or a slice) on the server; do not pass a raw ISO timestamp.
5. **(Optional) stable payloads** — to match on ASCII `rsvp_yes/no/maybe` instead of Hebrew labels, attach `PayloadComponent("rsvp_yes" | "rsvp_no" | "rsvp_maybe")` in button index order in the send call (step 1). This makes the inbound webhook carry `button.payload` independent of label copy.

**Reached/RSVP mapping for Option B**: same §13 logic; if step 5 is done, match on `button.payload` (stable) and fall back to `button.text`.

**Trade-off vs A**: Option B is the real product message (personalized, far better RSVP rates) but requires the send-path chain above and a re-approval if copy changes. Recommended path: **ship A first to prove the pipeline, then implement B** as the production invite.

---

## Open items to verify before the (separately-approved) submission step

- **RESOLVED this pass (official):** name **512**, footer **60**, body **1024**/32768, QUICK_REPLY **≤10** + grouping, POSITIONAL/NAMED example shapes, AUTHENTICATION structure (§14.8), button-tap webhook `payload` == `text` (§0/§13), templates-per-WABA **250/6000**, tiers **250/2K/10K/100K/unlimited** per portfolio (§10), **edit limits 1/24h + 10/30d** + all-components-replaced (§11), **delete** by name/id/≤100-IDs (§11), **library** (UTILITY-only, §12), full **status/quality** enums (§9), and the **body-adjacency rejection rule** (§9/Option B).
- **Still UNVERIFIED (could not fetch live this pass):** template **creation rate limit** (number); **delete name-reuse cool-down**; exact **TEXT-header** max (commonly 60); QUICK_REPLY **label** max (treated as 25 per §16.3/§14.8); the Resumable-Upload **auth header** (OAuth vs Bearer — the official `template-media` page is JS-rendered/nav-only). NONE affect the recommended Option A.
- **Correction surfaced by the live fetch:** the messaging tier above 250 is **2,000** (TIER_2K), not 1,000 — the earlier memory-based "1K" was wrong.
- BODY rejection: **adjacency rule now OFFICIAL** (§9 rejection example — no two `{{n}}` adjacent); start/end-of-body and variable-ratio heuristics remain UNVERIFIED. Current copy complies (every `{{n}}` surrounded by Hebrew text).
- AUTHENTICATION structure (§14.8 OFFICIAL) — not used by the RSVP invite.
