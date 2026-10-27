# Proposal

## Why

Every way into KALFA without a user session (guest links, call tokens, provider webhooks, the public widget) and every arc from a session to such a credential must be declared, bounded to one resource, and hard to abuse. Measured on 2026-10-26 (code and live database, read-only), several are not and nothing checks the surface as a whole, so this change fixes them first, independently of its two sibling changes.

## What Changes

- **One declared surface.**
  - A manifest lists every entry file: each route handler and server-action module, the signed-in groups included, each page outside those groups, and each Supabase function.
  - Sessionless rows carry the credential, resource scope, rate-limit bucket and audit target. Session rows carry only their transport.
  - A test fails on an undeclared file. Today's list-by-folder plan missed `sms-hook`, the integrations OAuth callback, `auth/callback` and `api/health`, and no check lists the customer area's route handlers and actions.
- **Client address from the trusted proxy.** Rate limits read the first `X-Forwarded-For` value. nginx appends to that header, so the client chooses the value. The worst cases are the SMS code request and the widget's per-IP call cap. The terms-approval evidence records the same value. Both move to the address nginx sets.
- **Guests' RSVP token closed to sessions.**
  - An org viewer can read every guest's `rsvp_token` through PostgREST and answer in the guest's name.
  - The fix revokes table SELECT and grants every other column, because a column REVOKE is a no-op under a table grant.
  - Before that, guest totals and the guest list's over-invited filter stop passing whole `guests` rows. Otherwise every customer's totals would fail. The attendance rule gets the grants that session writes and the owner agent's read-only SQL need, and the owner agent keeps the function its primer names.
  - **BREAKING** for direct API clients: `select=rsvp_token` or `select=*` on `guests` answers 42501. No application path is affected.
- **Other credential columns.**
  - Sessions lose every privilege except INSERT on `callback_requests` and `contact_messages`. None of them is used, and no row is readable today.
  - Two owner decisions narrow session writes. On `guests`, the RSVP token columns (A-O12). On the two inquiry tables, any direct insert (A-OA1), which today lets a signed-in account choose a token and enqueue callback work.
  - `campaigns.card_token_ref` is handed to `retire-sumit-campaign-columns`.
- **Provider verification and public answers.**
  - The Graph `clientState` and WhatsApp `hub.verify_token` checks become constant-time and get a rate limit.
  - `/g/[token]/go` sets `no-store` itself, like the other token routes; today only `next.config` sets it. Its limit is keyed by the token fingerprint as well as the address.
- **Narrow token reads.**
  - `/rate`, `/g` and `/ty` read through RPCs that return only what the page shows.
  - A rating is audited and stays re-submittable. Expiring rating links would reverse a documented product rule, so it is owner decision A-OA2.
- **Call tokens stored hashed** in the four attempt tables, as `inbound_agent_attempts` already does. A backfill and a fill-in trigger, which never erases a hash the new code writes, keep calls in flight working.
- **Cleanup.**
  - The deployed hello-world function `mcp` is removed.
  - `purpose/cb` binds the URL purpose to its token, as `ctx` does.
  - The RSVP page's headcount mirror moves inside `submit_rsvp`'s transaction.
- **Owner decisions:**
  - Hermes proxy verification (A-O19);
  - the console secret's scope (A-O20a).

## Capabilities

### New Capabilities
- `public-access-surface`: every sessionless entry point and its credential and scope; the trusted client-address source; the rule that a session read permission never yields a write credential; provider verification; stored credentials; atomic public RSVP writes. Moved here from `permissions-macro-to-micro`, which never archived it.

### Modified Capabilities
- None. `openspec/specs/` holds no capability yet.

## Impact

- **Code:**
  - `src/lib/security/{public-surface,client-ip,rate-limit}.ts`;
  - the public pages and actions under `src/app/(public)`;
  - `api/{webhooks,voximplant,call-me-now,widget,cardcom,hermes}`;
  - `src/lib/data/{guests,inquiry-rating,gift,thankyou,rsvp,call-attempts,sales-call-attempts,callback-request-attempts,voice-purpose-attempts,voice-purpose-dispatch}.ts`;
  - the campaign approval action.
- **Tests:** the pgTAP and local-it fixtures that name `access_token` on the attempt tables move to `token_hash`.
- **Database:**
  - the attendance rule and its grants, `guest_totals`, and `guest_effective_attending(guests)` as a wrapper closed to sessions;
  - a generated `guests.over_invited` column;
  - the `guests` column grant;
  - the non-INSERT privileges on two inquiry tables;
  - the three narrow token RPCs;
  - `token_hash` on four attempt tables;
  - `submit_rsvp`.

  Every migration is its own push. A push to main deploys it, and each one needs owner approval.
- **Edge functions:** `mcp` is deleted, from the repo and, with approval, from the project.
- **Docs:** `docs/project/{03-database-schema,05-guests-and-public-rsvp,10-api-and-webhooks}.md`.
- **Sibling changes:**
  - `permissions-macro-to-micro` renders the manifest as the sessionless axis of its map and owns the CI change.
  - `organization-action-map` is unaffected.
  - Neither is a prerequisite. One ordering applies: the client-address task starts after the core's run-state commit, which holds two test files that task edits.
