# Verification

## Authorization audit
- Only requirePlatformStaff, requirePlatformOwner and requirePlatformPermission change their denial target. requireUser still redirects to login; legacy and organization guard targets are unchanged.
- `/admin/roles` uses requirePlatformOwner before loading its matrix. Allowed named permissions still return the same user; a regression checks two different permission decisions for one user.
- The denial page is a sibling of the admin/customer route groups, under the existing root layout; its only authorization requirement is requireUser.
- Server Action catch audit found two swallowed DAL redirects in create/update voice purpose. Both now call unstable_rethrow. Six action modules with handwritten framework-signal detection now use the same Next API. Existing roles and other action catches already preserve redirects, or perform authorization outside the try block.
- Workflow SSE and latest-run polling, plus OAuth start, now translate DAL auth redirects to JSON 401/403 without a Location header. RDP issuance also translates a denied DAL recheck after its explicit preflight. Unrelated exceptions keep their existing behavior.
- Fleet-file and SUMIT test endpoints already convert the guard redirect to plain 403; regression tests confirm the new destination works without reading a file or charging.
- Campaign status uses separate console authorization and returns API errors. Customer purchase form redirects are outside these three platform guards and remain unchanged.
- getMyPresence intentionally catches permission denial for an optional shell presence hint and returns an empty/free snapshot without privileged data; it is not a mutation or an authorization gate for a page.

## Automated checks
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- DAL/page/API helper tests: 38 passed initially.
- Focused action/API tests: 67 passed initially.
- Extended regression run: 109 files, 1,409 tests passed, including additional per-permission isolation, fleet-file and SUMIT denial cases.
- Build and local HTTP smoke checks: pending.

## Browser limitation
The computer-use inventory reports no available browsers or apps. Private-window verification with Yaakov, live permitted-benefit access and visual desktop/mobile inspection remain unverified. No credentials or permissions were changed to manufacture an authenticated test session. No deployment was performed.
