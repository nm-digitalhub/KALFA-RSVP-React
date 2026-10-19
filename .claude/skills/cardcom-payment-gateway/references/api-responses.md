# Cardcom V11 Response Pattern

## ResponseCode + Description

Every V11 response used by this skill (LowProfile, Transactions except `GetTransactionInfoById`,
Documents, SuspendedDeals) is a JSON object with two top-level fields. Some other endpoints
return a bare array or boolean instead, so check the response schema before branching:

- **`ResponseCode`** (integer) -- `0` means success. Any non-zero value is a
  developer or transaction error.
- **`Description`** (string) -- a human-readable explanation of the `ResponseCode`.

There is no `DealResponse`, `TokenResponse`, or `InvoiceResponseCode` field in V11.
Those belong to the legacy `.aspx` interfaces. In V11, always check `ResponseCode`
and read `Description` for the reason.

`700` and `701` answer J2/J5 validation-only checks (`CreateTokenOnly`, `SuspendedDeal`):
success for that check, but nothing was charged. `608` on `Transactions/Transaction` means the
`ExternalUniqTranId` was already used by a call that got a valid answer (a charge, or a J2/J5
check); look up the original with `Transactions/GetTransactionByExternalUniqTran` and branch on
its `ResponseCode` instead of re-charging.

## Per-operation response objects

| Endpoint | Response object | Success fields to read |
|----------|-----------------|------------------------|
| `LowProfile/Create` | `CreateLowProfileResponse` | `LowProfileId`, `Url`, `UrlToBit`, `UrlToPayPal` |
| `LowProfile/GetLpResult` | `LowProfileResult` | `TranzactionId`, `ReturnValue`, `TranzactionInfo`, `TokenInfo`, `DocumentInfo`, `SuspendedInfo` |
| `Transactions/Transaction` | `TransactionInfo` | `TranzactionId`, `Token`, `ApprovalNumber`, `DocumentNumber`, `DocumentUrl` |
| `Transactions/RefundByTransactionId` | `RefundByTransactionIdResp` | `NewTranzactionId` |
| `Documents/CreateDocument` | `DocumentInfo` | `DocumentType`, `DocumentNumber`, `AccountId`, `DocumentUrl` |

In `LowProfileResult`, the nested objects (`TranzactionInfo`, `TokenInfo`,
`DocumentInfo`, `SuspendedInfo`) are `null` when not applicable to the operation
that ran. For example, `TokenInfo` is populated only for `ChargeAndCreateToken`
and `CreateTokenOnly` operations.

## Error codes

Cardcom V11 uses a single numeric `ResponseCode` space. The full numeric
error reference (developer errors, card-decline reasons, document errors) is
maintained in the official Cardcom documentation; do not hardcode a
code-to-message table. Instead, branch on `ResponseCode == 0` for success and
surface the `Description` string for everything else.

See the official Cardcom error reference at
`https://secure.cardcom.solutions/Api/v11/Docs` and the support center at
`https://support.cardcom.solutions`.

## Handling Pattern

```python
import requests

BASE = "https://secure.cardcom.solutions/api/v11"
payload["ExternalUniqTranId"] = order_id   # reuse the SAME id on every retry of this charge

try:
    r = requests.post(f"{BASE}/Transactions/Transaction", json=payload, timeout=30)
    resp = r.json() if r.status_code == 200 else None
except (requests.RequestException, ValueError):
    resp = None   # outcome unknown: the card MAY have been charged

if resp is None:
    # Do not re-charge blind: ask Cardcom whether this order id was charged.
    resp = lookup_by_external_uniq_tran_id(order_id)   # POST .../GetTransactionByExternalUniqTran

code = resp.get("ResponseCode") if resp else None
if code == 0:
    transaction_id = resp["TranzactionId"]     # also read DocumentNumber / DocumentUrl
elif code == 608:
    pass   # id already answered (charge or J2/J5): look the record up, never re-charge
else:
    log_error(f"Cardcom error {code}: {resp.get('Description') if resp else 'no response'}")
    show_error("Payment could not be completed.")
```

Run this only on your server. `ApiName` and `ApiPassword` must never reach browser JavaScript
or a mobile app bundle.

## Notes

- Always check both the HTTP status (`200` = request received) AND `ResponseCode`
  (`0` = operation succeeded). A `200` with a non-zero `ResponseCode` means the
  request was valid but the operation failed.
- For any non-zero `ResponseCode`, log `ResponseCode`, `Description`, `TranzactionId` and
  `Last4CardDigitsString`. Do NOT log the full body: it carries `Token`, `CardOwnerIdentityNumber`,
  `CardOwnerEmail` and `CardOwnerPhone`.
- For `LowProfileResult`, also inspect the nested object `ResponseCode` values
  (for example `DocumentInfo.ResponseCode`) when a document was requested.
