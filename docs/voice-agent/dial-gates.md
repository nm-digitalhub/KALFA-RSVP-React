# Outbound dial gates

What every outbound call must pass before KALFA calls the telephony provider, and the paths that do not pass them.
Change: `openspec/changes/dnc-registry-dial-gate`.

## The shared gate

`evaluateSharedConsentGates` (`src/lib/data/console-calls.ts`) runs the gates in this order. The first refusal stops it.

1. **Local list** (`call_dnc_list`): people who asked KALFA itself never to be called. Applies to every path. A lookup error counts as listed.
2. **Opt-out** (`contacts.removal_requested`): when the policy row says so.
3. **Shabbat and Yom Tov**: when the policy row says so.
4. **Daily window**: when the policy row says so. Staff may waive this one gate for a single dial.
5. **National registry** ("אל תתקשר אליי", `src/lib/dnc/registry-gate.ts`): last, because it is the only gate that calls an outside service.

## The national registry

The registry applies only to **marketing** calls (Consumer Protection Law 16ב(א), 16ג). It is checked only while `call_compliance_settings.dnc_registry_gate_enabled` is on. Staff turn it on or off on `/admin/dnc`, tab "מצב החיבור".

| Path | Registry |
|---|---|
| RSVP calls (campaign, console AI call, guest callback) | Never: not marketing (owner ruling 11.10.2026) |
| Sales call on a callback request | Exempt when `callback_requests.origin` is `person_request` or `missed_call`; otherwise checked |
| Meeting confirmation | Checked |
| Custom voice purpose (workflow) | Checked |
| Console: returning a missed call, calling a guest, consult/conference | Never |
| Console: a number typed by hand | Checked |
| Call-me-now | Exempt (the visitor asked); the exemption is recorded |

**Results:**

- **Not in the registry:** the other gates decide.
- **Listed in the registry:** refused.
- **The service refused the number** (its errorCode): refused.
- **The service is unavailable**, or the decision could not be recorded: `registry_pending`. The worker sends the job again after 10 minutes, up to 6 times, and only then skips it. Nothing has been dialled at that point (`src/lib/dnc/registry-wait.ts`).

Every decision is written to `dnc_registry_checks`. The table is append-only and server-only, and it never stores the token.

## Paths outside the gates

- **Ops scripts** (`scripts/voximplant/bridge-call.ts`, `test-call.ts`, `meeting-confirm-call.ts`, `sales-close-call.ts`): a `--to` must be on the `VOX_TEST_NUMBERS` allowlist (server env). The meeting and sales scripts pass the row's own number through the shared gate. `test-call.ts` has no default rule and refuses rule 1494311.
- **The `mcp__voximplant__start_call` tool**, available in operator Claude sessions, calls the provider directly. It bypasses **every** gate above, including the local list and the registry. Use it only for test numbers.
