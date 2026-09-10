# ExtrA (exm.co.il) — the official API spec, pinned

`openapi-extra-v1.json` is the vendor's own OpenAPI 3.0.3 document, "extra API"
v1.0.0, supplied by the account owner on 2026-09-08 and pinned here unchanged on
2026-09-10. It is a specification, not a credential — verified to contain no keys
or tokens before it was committed.

Pinned rather than linked because the panel's error wording, the key-expiry
monitor and the SMS mapper are all derived from it. A spec you cannot diff is a
spec you cannot tell has changed under you — so here is what to diff against:

    sha256  4b7fd912202f6538c85557c69e3038f20a37c295f83cefc70494949e8fb2e9a8
    bytes   78781

(The owner supplied the document a second time on 2026-09-10 under a different
upload name. It was byte-identical to this file — same hash — so nothing moved.
Recording the hash is what made that a five-second answer instead of a re-read.)

## What it actually contains — MEASURED, not quoted

**Ten operations**, not eleven. The consolidation plan (§5.3) says eleven; the
file has ten. Counted from `paths` in the pinned document:

| Method | Path | operationId | Used by KALFA |
|---|---|---|---|
| GET | `/auth/key/` | `getAuthKey` | ✅ health check — `src/lib/sms/extra-client.ts` |
| POST | `/sms/send/` | `smsSend` | ✅ every SMS — `src/lib/sms/sender.ts` |
| POST | `/calls/` | `getCallsHistory` | ⬜ Phase 1.3 — the only way to list account lines |
| GET | `/calls/recording/` | `downloadCallRecording` | ⬜ Phase 6 |
| POST | `/calls/get-recording-urls/` | `getRecordingUrls` | ⬜ Phase 6 |
| GET | `/calls/ai/` | `getCallAi` | ⬜ Phase 6 |
| GET | `/click2call/` | `click2call` | ⬜ not in scope |
| GET | `/when/calendars/` | `listCalendars` | ⬜ needs When Pro |
| GET | `/when/bookings/` | `listWhenBookings` | ⬜ needs When Pro |
| POST | `/when/bookings/cancel/` | `cancelWhenBooking` | ⬜ needs When Pro |

Two of ten are implemented.

## The three things that catch people out

**1. Business failures return HTTP 200.** Both success and business errors come
back `200`; only a missing or invalid Bearer token gives `401`. Reading
`res.ok` alone reports a rejected send as a success. `sender.ts` already checks
`success` — anything new must too.

**2. `getAuthKey` echoes the key back.** `key` is a REQUIRED property of its 200
response: "The API key this request authenticated with." Any client wrapping it
must drop that field explicitly and never place it in a return value, a thrown
message or a log. `extra-client.ts` does, and a test asserts it.

**3. Several SMS errors can arrive at once.** The spec: the pre-send validation
codes (7321, 7526, 9404, 1214, 1215) "may arrive several at once in one
response". A mapper that reads `errors[0]` will report one problem and silently
drop the others, sending the operator to fix the wrong thing.

## A capability the spec describes but does not expose

The `SMS` tag's own description documents a **Verify** namespace — "verify
possession of a phone number by voice call: we place an automated call to the
number, the recipient confirms by dialing a code on the keypad during the call,
and the result is POSTed to your `callback_url`… Requires an active VERIFY_VOICE
monthly billing profile" — and `x-tagGroups` names the group "extra / SMS +
Verify".

There is no `/verify/` operation in `paths`. Whatever the endpoint is, this
document does not describe it, so it cannot be called from here. Noted so the
next reader stops looking rather than assuming the file is truncated.

## What the API does NOT expose

Verified IDs — the sender identities `smsSend` requires — have no operation at
all. They are created and verified only in the portal at
<https://www.exm.co.il/my/verified-ids/>. The panel links there and says so
rather than offering a button that cannot exist.

## Servers

`https://api.exm.co.il/v1` and `https://www.exm.co.il/api/v1`. Both are listed;
`sender.ts` uses the second and `extra-client.ts` follows it, so one host change
moves both.
