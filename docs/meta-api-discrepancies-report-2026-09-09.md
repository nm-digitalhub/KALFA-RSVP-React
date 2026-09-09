# Two discrepancies between the published v25.0 spec and the live Graph API

**Endpoint:** `GET /{Version}/{WABA-ID}/phone_numbers`
**Reference:** `developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/phone-number-management-api/v25.0.openapi.yaml`
**Date measured:** 2026-09-09

We generate our TypeScript client directly from your published OpenAPI documents,
so the spec is the contract our code is compiled against. Two items in it do not
match the live API. Both are reproducible. One of them contradicts your own
prose reference, which has the correct answer.

---

## Issue 1 — `unified_cert_status` is documented but does not exist

The v25.0 spec declares `unified_cert_status` on
`WhatsAppBusinessAccountPhoneNumber`, lists it under the `fields` query
parameter, and defines a full enum for it
(`WhatsAppBusinessUnifiedCertStatus`: `APPROVED`, `NAME_PENDING_REVIEW`,
`NAME_NOT_APPROVED`, `ACCOUNT_REVIEW_NOT_STARTED`, `LIMITED_ACCESS`).

Requesting it fails, and because Graph rejects the entire request on one unknown
field, including it makes the whole call unusable.

**Request**

```
GET https://graph.facebook.com/v25.0/{WABA-ID}/phone_numbers?fields=unified_cert_status
Authorization: Bearer {token}
```

**Response**

```json
{"error":{"message":"(#100) Tried accessing nonexisting field (unified_cert_status)","type":"OAuthException","code":100}}
```

**What we ruled out.** We tested every axis we could vary — 12 combinations, all
identical:

| Axis | Values tested | Result |
|---|---|---|
| Graph version | v23.0, v24.0, v25.0, v26.0 | rejected on all four |
| WhatsApp Business Account | two separate WABAs under different businesses | rejected on both |
| Token | System User token, and a User token with `whatsapp_business_management` + `whatsapp_business_messaging` | rejected with both |

In the same runs, `name_status` returned `APPROVED` for every combination, so the
requests themselves are well-formed and the token is sufficient.

`unified_cert_status` also does not appear in the prose field reference at
`…/whatsapp/business-phone-numbers/phone-numbers`, which lists `account_mode`,
`code_method`, `code_verification_status`, `identity_key_hash`,
`last_onboarded_time`, `max_phone_numbers_per_business`, `name_status`,
`recipient_identity_key_hash` and `status`.

**Questions**

1. Is `unified_cert_status` exposed on any account type, or should it be removed
   from the v25.0 spec?
2. If it is gated (BSP, Solution Partner, a specific verification state), what
   gates it? The 422 example in the same spec — `"The requested fields are not
   available for this account"` — suggests a per-account gate exists, but we
   receive the `nonexisting field` error instead, which reads as a schema
   problem rather than an entitlement one.
3. If it is not coming back, is `name_status` the intended replacement? Its enum
   (`APPROVED`, `AVAILABLE_WITHOUT_REVIEW`, `DECLINED`, `EXPIRED`,
   `PENDING_REVIEW`, `NONE`) does not map onto the `unified_cert_status` enum,
   so we cannot treat them as equivalent.

---

## Issue 2 — the OpenAPI `sort` enum contradicts your own reference page

The v25.0 spec types `sort` as a closed enum:

```
One of "creation_time.asc", "creation_time.desc",
       "last_onboarded_time.asc", "last_onboarded_time.desc"
```

and the description repeats it: *"Format: field_name.asc or field_name.desc"*.
The Graph API Explorer offers those same four values in a dropdown and no others.

All four are rejected.

**Request**

```
GET https://graph.facebook.com/v25.0/{WABA-ID}/phone_numbers?fields=id&sort=last_onboarded_time.desc
```

**Response**

```json
{"error":{"message":"(#100) Cannot sort by last_onboarded_time.desc_ascending","type":"OAuthException","code":100}}
```

Note the echoed value: `last_onboarded_time.desc_ascending`. Graph appends
`_ascending` to whatever it receives, which points at the format that does work.

**The correct format is documented — on a different page.** Your
business-phone-numbers reference prints it, and it is what the backend parses:

> In addition, phone numbers can be sorted in either ascending or descending
> order by `last_onboarded_time` […] If not specified, the default order is
> descending.
>
> `…/phone_numbers?access_token=<TOKEN>&sort=['last_onboarded_time_ascending']`

So this is not an undocumented format. It is **two Meta documents contradicting
each other**, and the machine-readable one — the source we generate our client
from — is the wrong one.

| `sort` value | Source | Result |
|---|---|---|
| `last_onboarded_time.desc` | v25.0 OpenAPI enum + Graph API Explorer dropdown | ❌ `#100 Cannot sort by …desc_ascending` |
| `creation_time.asc` | v25.0 OpenAPI enum + Explorer dropdown | ❌ `#100 Cannot sort by …asc_ascending` |
| `['last_onboarded_time_ascending']` | business-phone-numbers reference | ✅ 200 |
| `["creation_time_descending"]` (JSON array) | — | ✅ 200 |
| `last_onboarded_time_descending` (bare) | — | ✅ 200 |
| `last_onboarded_time` (bare, no direction) | — | ✅ 200 |

The prose page documents only `last_onboarded_time`; `creation_time_ascending`
also works, so the backend supports more than that page describes.

**Questions**

1. Can the v25.0 OpenAPI `sort` enum and the Explorer dropdown be corrected to
   `<field>_ascending` / `<field>_descending`? As published, following the
   machine-readable spec exactly produces a request that always fails.
2. Is the bare form (`sort=last_onboarded_time_descending`, no array) supported,
   or is the array in the prose example the contract? Both work today; we would
   rather depend on the documented one.
3. Is `creation_time` officially sortable? It works, but only
   `last_onboarded_time` is documented.

---

## Not defects — recorded so they are not re-reported

These looked like discrepancies and turned out not to be. Listing them so your
team does not spend time on them:

- **`host_platform` vs `platform_type`** — the spec declares `host_platform`;
  live responses return `platform_type`. Both are accepted and both return
  `CLOUD_API`. Aliases, working as intended.
- **`filtering` on `is_official_business_account`** — our error. Sending
  `"value":"false"` (string) returns `Filtering field 'is_official_business_account'
  with operation 'equal' is not supported`; sending `"value":false` (boolean)
  works. One note: that error text points at the *operator*, which sent us
  looking in the wrong place. A message naming the value type would have saved
  the round trip.
- **`username`** — absent from the v25.0 `fields` list but accepted live. A gap
  in the spec, not a failure.

---

## Environment

- Graph API version in production: v25.0
- Client generated from the published v25.0 OpenAPI documents via
  `openapi-typescript`
- App: KALFA-RSVP
- Permissions on the tokens used: `whatsapp_business_management`,
  `whatsapp_business_messaging`, `business_management`

*(Attach a fresh `fbtrace_id` from a reproduction run — support will ask for one,
and ours are from a session that has since expired. Replace `{WABA-ID}` with the
account id before sending; for a public forum post, omit it.)*
