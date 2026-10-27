# Design

## Context

Motivation: proposal.md, Why. Requirements: specs/public-access-surface.

Every fact below was checked on 2026-10-26 against the code and the live database (SELECT only, Postgres 17.6).
MEASURED means read or queried; INFERRED says what it rests on.

### The surface today

- **Entry points** (MEASURED).
  - The sessionless entry files are:
    - the six token routes under `(public)/**/[token]`;
    - the `(public)/(site)` pages and the contact action;
    - the sign-in, sign-up, confirm and callback entries of `auth/**`;
    - 47 of the 77 `api` route files;
    - `.well-known`, `[...catchAll]`, `llms.txt` and `guest-list-template.csv`;
    - two Supabase functions: `sms-hook`, which checks a Standard Webhooks signature (`index.ts:102-154`), and `mcp`, a hello-world.
  - `mcp` is deployed live as v91, ACTIVE, with `verify_jwt=false`. Its deployed code was not downloaded; that it matches the repo is INFERRED.
  - `api/integrations/oauth/callback` takes no session by design. Its credential is state, single use, TTL and PKCE (`route.ts:20-43`).
  - `api/internal/rdp-gateway/*` answers 404 at nginx (`beta-proxy.conf:28`).
  - `'use server'` modules are public POST endpoints whatever their file name.
    - Outside `(customer)` and `(admin)`, the seven under `src/app` are all named `actions.ts`.
    - Two live in `src/components` (`availability/actions.ts`, `console/push-alert-actions.ts`). Both gate on `requireUser`.
  - The signed-in groups hold 4 route handlers (2 in `(customer)`, 2 in `(admin)`) and 51 `'use server'` modules (11 and 40). Their 83 pages all render under `(customer)/app/layout.tsx` (`requireUser`) or `(admin)/admin/layout.tsx` (`requirePlatformStaff`).
  - No check lists the `(customer)` entry files today. The core's analyzer roots at `(admin)` and `api/admin` (`analyze.mjs:77`). The core's task 1.3 adds the Bearer and `api/mcp` folders, and organization-action-map's task 3.4 adds gates, not entry roots.
  - No raw token appears in any of the 57 rate-limit keys (regex, a lower bound).
- **Client address** (MEASURED).
  - `getClientIp` returns the first `X-Forwarded-For` element (`rate-limit.ts:42-51`).
  - nginx appends to that header (`beta-proxy.conf:37`) and sets `X-Real-IP $remote_addr` (`:36`).
  - `socketClientIp` reads `x-real-ip` and accepts only an IP literal (`client-ip.ts:12-16`). No rate limit uses it.
  - Worst cases:
    - `call-me-now/request-code`, a 10/min guard in front of an SMS (`route.ts:43-44`);
    - `widget/call-intent`, whose database cap hashes the same value (`route.ts:52,57,73`).
  - The package-approval action stores the first element as consent evidence (`campaign-actions.ts:191`).
  - 20 keys use the address alone, 11 of them on server-to-server callbacks (regex, a lower bound).
- **A-O11 is a measured fact, not a decision.**
  - `kalfa.me`, `beta.kalfa.me` and `www.kalfa.me` resolve to 217.154.17.185, an address of this host.
  - Responses carry `server: nginx` and no CDN header.
  - The app listens on 127.0.0.1:3002 only (`ss`).
  - Of the readable nginx configs, only `conf.d/beta-proxy.conf` proxies to it. Its single proxy block sets `X-Real-IP` (`:36`); its other blocks answer 301.
  - There is no IPv6 address for the host name.
  - INFERRED: no unreadable Plesk include (`plesk.conf.d`, root only) proxies to the app. `beta-proxy.conf:3` says it shadows the Plesk vhost.
- **Guests** (MEASURED).
  - `authenticated` holds table-level `arwdDxtm` on `public.guests` (28 columns), with no column ACL.
  - RLS is the four `guests_org_*` policies over `can_access_event`.
  - 46 of 46 guests hold a token; none is revoked.
  - Org members are 4 owners and 1 member. There is no viewer and no admin.
  - The viewer role holds only `guests.view`. Owner, admin and member hold `guests.edit`.
  - Every code read of `rsvp_token` runs on the service role: 7 sites, 5 selects and 2 filters (grep, a lower bound).
  - `getRsvpLinkInfo` gates on `guests.edit`, then reads on the service role (`rsvp-links.ts:32-33`).
- **Whole-row references, review B1** (MEASURED unless marked).
  - `guest_totals` is INVOKER and executable by `authenticated`. It passes the whole row `g` to `guest_effective_attending(g)` and to `over_invited(g)`.
  - `getGuestTotals` calls it on the cookie client (`guests.ts:726-728`), from three pages:
    - the event page: `page.tsx:145` → `event-stats.ts:183`;
    - the stats page: `:77` → `event-stats.ts:183`;
    - the guests page: `page.tsx:254`.
  - The guest-list filter `filter('over_invited','eq',true)` (`guests.ts:312`) is a PostgREST computed field. It too passes the whole row.
  - A whole-row reference needs SELECT on every column. After the grant, both paths would therefore answer 42501 for every role (INFERRED from that Postgres rule).
  - The owner agent calls `guest_effective_attending(g)` from outside the database:
    - its primer gives the attending count as `sum(guest_effective_attending(g)) from guests g` (`primer.ts:27`; `:123` lists the function);
    - its `execute_sql` runs as `supabase_read_only_user` (`runner.ts:521-532`), which holds EXECUTE through migration `20261011080221` (live ACL). The role is a member of `pg_read_all_data`;
    - `primer.test.ts:141-155` requires the function in the Functions section of `types.generated.ts`, and a migration that grants it to that role;
    - the 08:30 `daily_business` subscription runs that SQL daily: its 29 runs are `sent`, and each audit row of stage `report` lists `execute_sql`. The 00:00 subscription is `skipped` (`no_permissions`) on all its 28 runs.
  - Not affected:
    - `owner_agent_rsvp_people_totals`, executable by `service_role` only;
    - the three console views over `guests`, which run as owner and use no token and no `*`;
    - every RLS policy, since none reads `guests` as a relation;
    - Realtime, since `guests` is in no publication.
  - Inside the database, no other function, view, policy or index references the two row helpers. A `prosrc` scan finds only `guest_totals`, `over_invited` and `owner_agent_rsvp_people_totals`.
  - New functions in `public` get EXECUTE for `postgres` and `service_role` only (live `pg_default_acl`, set by migration `20261013030310`). A new function is therefore closed to `authenticated` and `supabase_read_only_user` until a migration grants it.
  - A stored generated column runs its expression as the writer. The executor prepares it per statement (`nodeModifyTable.c:417-437`, PG17 source) and checks EXECUTE on each function it calls as the current user (`execExpr.c:2638-2641`).
    - `guests` has a BEFORE UPDATE row trigger, `trg_guests_updated`. So every UPDATE recomputes the column, whatever it sets (`nodeModifyTable.c:389-399`).
    - The session writes of `guests` are all in `guests.ts`, on the cookie client: `createGuest`, `bulkInsertGuests`, `updateGuest`, `fillMissingExpectedCount`, `updateContactStatus` and `applyGuestMerge`. Inside the database only `submit_rsvp`, a SECURITY DEFINER function, writes `guests` (`prosrc` regex, a lower bound).
  - Side finding: the list select has never fetched `over_invited` (`git log -L` on `guests.ts:66-67`). The row mapping (`guests.ts:390`) and the page badge still read it, so the comment at `guests.ts:325-329` is stale.
- **Other credential columns** (MEASURED).

  | Column | Rows | Session read today |
  |---|---|---|
  | `campaigns.card_token_ref` | 2 | every org role with `campaigns.view` (`camp_org_select`) |
  | `callback_requests.intake_token` | 3 | none: SELECT granted, no SELECT policy |
  | `contact_messages.rating_token` | 1 | none: SELECT granted, no SELECT policy |
  | `events.gift_link_token` | 10 | `events.view` holders. A shareable link, intended (INFERRED) |
  | `organization_invitations.token` | 1 | `members.manage` holders. A shareable link, intended (INFERRED) |
  | `access_token` in 4 attempt tables | — | none: no grant |

  - `authenticated` holds `arwdDxtm` on `callback_requests` and `contact_messages`. Neither has a SELECT, UPDATE or DELETE policy. TRUNCATE is not subject to RLS.
  - Each table has one INSERT policy for `authenticated`:
    - `cm_insert_authenticated` checks only `auth.uid() is not null`;
    - `cb_insert_authenticated` adds only the triage columns.

    A signed-in account can therefore insert a row with any phone, schedule, intake or rating token, expiry, origin or SMS column.
  - An insert into `callback_requests` fires `callback_requests_notify_work`, which notifies `callback_work`.
    - The worker listens on that channel (`worker/main.ts:920-926`) and runs its scheduling sweep (`:860`). A five-minute cron runs the sweep anyway (`:1463`, `:1679`).
    - INFERRED: such a row can be booked and dialled, bypassing the app's OTP and rate limits.
  - Every code path on those two tables uses the service role: 19 files, 16 in `src` and 3 in `scripts` (grep, a lower bound). The four functions that touch them are SECURITY DEFINER and not executable by `authenticated`.
  - Migration `20260723180000:31-33` kept `cm_insert_authenticated` on purpose: inserts stay authenticated-only instead of anon, and anonymous submissions go through the service-role action.
- **Provider checks** (MEASURED).
  - The Graph `clientState` is compared with `!==` (`microsoft-graph/route.ts:69`).
  - The WhatsApp `hub.verify_token` is compared with `===` (`whatsapp/route.ts:371-372`).
  - Neither route has a rate limit.
  - `safeTokenEqual(presented, expectedSha256Hex)` already exists (`token-compare.ts:20-26`).
  - `/g/[token]/go` keys its limit by address alone (`go/route.ts:26`).
  - That route sets no header of its own, unlike the other token routes, which set `no-store` as their primary control. `next.config.ts:206-219` adds `no-store`, `no-referrer` and `noindex` for `/g/:token*`, the redirect included, as defense in depth. The umbrella's "no no-store on /g/go" overstated the gap.
- **Token pages** (MEASURED).
  - `/rate`, `/g`, `/g/go` and `/ty` read `contact_messages` or `events` directly on the service role (`inquiry-rating.ts:18-62`, `gift.ts:39-43`, `go/route.ts:29-34`, `thankyou.ts:30-34`).
  - A rating writes no audit row (`inquiry-rating.ts:42-58`).
  - A rating link is re-submittable and never expires, by a documented product rule: `docs/admin-contacts-redesign-plan-2026-08-25.md` §4.3 (lines 212-216), which `inquiry-rating.ts:33-38` cites. The one live link was requested on 2026-10-05 and is rated.
  - `activity_log` accepts a row with no event and no user.
- **Call tokens** (MEASURED).
  - Four tables store `access_token` NOT NULL with a unique index, beside `token_expires_at`: `call_attempts`, `callback_request_attempts`, `sales_call_attempts` and `voice_purpose_attempts`.
  - `inbound_agent_attempts` stores a unique `token_hash` instead.
  - Writers: `call-attempts.ts:116`, `sales-call-attempts.ts:57`, `callback-request-attempts.ts:65`, `voice-purpose-dispatch.ts:191`.
  - Lookups:
    - `call-attempts.ts:254,271`;
    - `sales-call-attempts.ts:319,345`;
    - `callback-request-attempts.ts:356,382`;
    - `voice-purpose-attempts.ts:57`;
    - `purpose/[purpose]/ctx/[token]/route.ts:53`.
  - Tests that name `access_token` on these tables:
    - the pgTAP files `s3_voice_test.sql:582-596` (six UPDATE pins that expect 42501) and `s3_voice_paths_test.sql:705-734` (13 references, service-role fixtures included);
    - the `call_attempts` fixtures of four local-it suites: `console-findings:126`, `console-realtime:129`, `console-views:130` and `webhook-message:293`.
  - Call tokens live 2 h (`outreach-calls.ts:58`, `sales-call-dispatch.ts:104`).
  - The code precedent for hashed tokens is `console-calls.ts:1115-1167`.
- **Cleanup items** (MEASURED unless marked).
  - `purpose/.../ctx` refuses a token of another purpose (`route.ts:57-59`). `purpose/.../cb` ignores the URL purpose (`route.ts:28-31,50`).
  - The headcount:
    - `submit_rsvp` clears the headcount on every new answer (the live body's guest projection);
    - the RSVP page then sets it again in a second service-role update and swallows any error (`r/[token]/actions.ts:84-106`);
    - its two other callers, the workflow node and WhatsApp, keep the cleared headcount.
  - `mcp` was redeployed at 15:32:38 UTC, 56 s after the 15:31:42 UTC commits reached main. INFERRED: the Supabase GitHub integration redeploys every function declared in `config.toml` on push (`[functions.mcp]`, `config.toml:458-461`).
- **Facts behind the open decisions** (MEASURED unless marked).
  - **Hermes.**
    - The route checks only the `Bearer ` prefix, then forwards to 127.0.0.1:3978 (`hermes/teams/route.ts:9-16`). Its comment says Hermes validates the token itself.
    - The Hermes process listens on 0.0.0.0:3978 and [::]:3978 (`ss`).
    - The internet cannot reach it (MEASURED 2026-10-27).
      - `iptables` and `ip6tables` have INPUT policy DROP and no rule for 3978. The only port range they accept is 49152:65535.
      - No nginx config proxies 3978, and `tailscale serve`/`funnel` does not expose it.
      - It is reachable from the host itself and, through the Tailscale input chain, from the tailnet (INFERRED).
  - **Console secret.**
    - `KALFA_CONSOLE_SECRET` is one application Secret on `kalfa-rsvp`, read by the console scenarios (`set-console-secret.ts:1-8`).
    - Six console routes check it with `safeTokenEqual`.
  - **CardCom documents.**
    - The secret is taken from the URL query or from the body (`cardcom-document-intake.ts:13-14,22-26`), compared in constant time (`:36-42`) and removed before storage.
    - It travels in the body, not in the URL (MEASURED 2026-10-27).
      - The beta access log records query strings: 238,485 lines of `access_ssl_log.processed` carry one.
      - Its 6 `document-webhook` lines are all `POST … 200`, and none holds `secret=`.
      - The 6 match the 6 `cardcom_document` rows in `webhook_inbox` (last 2026-10-18). Each passed the secret check, so the secret came in the body, from the "מחרוזת תוספת לפנייה" field the admin form describes.
  - **Inquiry-table docs.** `docs/project/03-database-schema.md:192,205` still name the policies `cb_insert_anyone`/`cm_insert_anyone` and admin policies. Live there is one `*_insert_authenticated` policy per table.

### Constraints

- A push to main deploys a migration. INFERRED: it also deploys the edge functions.
  - Each migration is its own push and needs owner approval.
  - Deleting a live edge function needs owner approval too.
- Test runners:
  - local-it: `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh <file>`;
  - pgTAP: `SUPABASE_DB_PORT=54322 npx supabase test db --local <file>`, or every file when no file is given.

  Both need the local stack and stay manual gates. CI runs lint, tsc and vitest (`.github/workflows/ci.yml:44-50`), so a vitest test added here is enforced from its first commit.
- **Applied on live**, after precedent commits `cc49ba31` and `e1966ba9`. After the owner pushes:
  - a read-only `npx supabase db query --linked` shows the catalog state that the local test asserted;
  - `npx supabase migration list --linked` shows local = remote;
  - the log check: `postgres_logs` since the push show no `permission denied` (42501) on the objects the migration changed, other than deliberate probes, and `edge_logs` show which Data API requests reached them (precedent: `staff-tables-permission-rls/verification-s2.md:59`). The catalog read runs as a role that bypasses grants and RLS, so only the logs show a real user's path refused.

  It is recorded before any task that depends on the migration.

## Goals / Non-Goals

**Goals:**
- One declared, tested inventory of the sessionless surface, which the core change renders as its map's sessionless axis.
- No session yields a credential that acts as a guest, a caller or a rater.
- No outage at any step. No access change for a live person unless an owner decision says so.

**Non-Goals:**
- Organization, staff and console authorization (the two sibling changes).
- The permissions map document and the CI change (owned by `permissions-macro-to-micro`).
- A shared rate-limit store. The per-process limit is documented at `rate-limit.ts:5-10`.
- Removing `campaigns.card_token_ref` (owned by `retire-sumit-campaign-columns`).
- Hermes's own code, which lives outside this repository.
- Feeding the guest list's over-invited badge, a separate owner question (Workflow follow-up).

## Decisions

### D0. Relation to other changes
- **`permissions-macro-to-micro`** is the core, rewritten in place.
  - It gives this change:
    - umbrella tasks 1.4, 2.1, 2.4 and 11.1–11.5, and the anonymous and viewer half of 12.2;
    - its D10 and the manifest part of D9;
    - the capability `public-access-surface`, which the core must drop from its own `specs/`.
  - The core owns the generated map (`docs/project/02a-permissions-map.md`) and the CI change (review S10).
  - The manifest here is the source of the map's sessionless rows, and the column grant (D4) is a gate type the map lists.
  - This change waits for neither sibling, with one ordering: task 2.1 starts after the core's run-state commit (its task 1.1) lands.
    - That commit holds exactly the files of the core's D15 list, and core 1.1 checks the list file by file.
    - Two of the 19 test files that forge `X-Forwarded-For` (D2) are in that list. 2.1 must rewrite `campaign-actions.test.ts`, which forges the header at `:17` and asserts the stored address at `:393`. `cardcom-webhook-activation.local-it.test.ts` forges it at `:147`.
- **`organization-action-map`.** No dependency in either direction.
  - The guest gates used here (`requireEventAccess(…, 'guests', 'view' | 'edit')`) move onto its `ORG_ACTIONS` through its own derived mapping.
  - `guest_totals` stays INVOKER (D3), so nothing here depends on its `search_path` rewrite of `can_access_event`.
- **`retire-sumit-campaign-columns`** takes `campaigns.card_token_ref`.
  - Its task 5.2 drops the `card_*` group after its Open Question 2.
  - Until then the column stays readable as measured, and the hand-off note goes into that change (Workflow follow-up).
- **`rsvp-save-webhook-tool`** (planned, 0 of 22 tasks done). It adds the sessionless route `api/elevenlabs/agent-tool/rsvp`, whose call token arrives in the `X-Kalfa-Call-Token` header (its task 2.3), and its task 9.2 deletes `api/voximplant/agent-tool/rsvp/[token]`.
  - Today's route resolves the token through `getCallAttemptByAccessToken` (`agent-tool-guard.ts:113`, `call-attempts.ts:264-271`, MEASURED), which task 7.2 moves to `token_hash`. The new route uses the same guard core (that change's design, lines 63-64), so INFERRED: it follows 7.2 with no task of its own.
  - Whichever lands second adds or deletes the route's manifest row (task 1.1).
- **Umbrella ids → this change:**

  | Umbrella | Here |
  |---|---|
  | 1.4 | 1.1, 1.2 |
  | 2.1 | 2.1 |
  | 2.4 + B1 | 3.1–3.5 |
  | 11.1 | 5.1 |
  | 11.2 | 6.1–6.3 |
  | 11.3 | 7.1–7.4 |
  | 11.4 | 8.1–8.4 |
  | 11.5 | 9.1–9.2 (its CardCom part was closed by measurement, D10) |
  | 12.1, half of 12.2 | 10.1, 10.2 |
  | new (addenda) | 4.1, 4.2 |

### D1. The manifest is total over its roots
- **Scope.** `src/lib/security/public-surface.ts` holds one row per entry file:
  - each `route.ts` under `src/app`, the signed-in groups included (90 today);
  - each `page.tsx` under `src/app` outside `(customer)` and `(admin)` (28);
  - each module under `src` that starts with `'use server'`, in any group (60), matched by the directive rather than the file name, because the two in `src/components` are not named `actions.ts`;
  - each `supabase/functions/*/index.ts` (2).
- **Row content.**
  - A sessionless row names:
    - its credential: token, provider signature, shared secret, OAuth state + PKCE, or none;
    - its resource scope;
    - its rate-limit bucket;
    - its audit target.
  - A session row names only its transport: cookie, Bearer or OAuth Bearer. Whether its gate is right is checked elsewhere: by the core's analyzer for `(admin)` and `api/admin`, and for `(customer)` by nothing yet (Workflow follow-up).
- **The test fails on:**
  - an undeclared file;
  - a row whose file is gone;
  - a sessionless file whose rate-limit key interpolates the raw token instead of `tokenFingerprint`.
- **Why total.**
  - The umbrella's folder list missed four entry points (review S12), and a folder list cannot fail on a new folder.
  - The route handlers and actions of the signed-in groups are listed too. The layouts do not cover them, and no other check lists the `(customer)` ones (Context).
- **Rejected:** telling session files apart by gate names. That couples this test to the core's gate renames.
- **Left out:**
  - The pages of `(customer)` and `(admin)`. Each renders under its group's layout, which requires a session (Context).
  - The metadata files `sitemap.ts`, `robots.ts` and `manifest.ts`, which read no data today (MEASURED: no data import).

### D2. The client address comes from nginx
- `getClientIp` returns what `socketClientIp` returns, or `'unknown'` when it returns nothing.
- No code reads the `X-Forwarded-For` request header. A static test bans `.get('x-forwarded-for')` outside tests. The RDP gateway client's outbound header is not a read, so it is not flagged.
- The 19 test files that forge `X-Forwarded-For` are updated where they use it to separate clients (grep).
- The package-approval evidence moves to `socketClientIp`.
- The comments that describe the old rule are corrected: `client-ip.ts:7-8`, `rate-limit.ts:36-41` and `tunnel-check/route.ts:24-26`.
- **Why this is safe:** A-O11 is a measured fact. There is no CDN, nginx sets `X-Real-IP` from the socket, and the app listens on loopback only.
- **Rejected:** taking the last `X-Forwarded-For` element. It is right only while exactly one proxy appends.

### D3. No whole-row reference to `guests` on the session path (review B1)
- **Shape.**
  - One IMMUTABLE function over explicit columns holds the attendance rule.
  - `guest_totals` stays INVOKER and reads explicit columns through it, so RLS keeps scoping rows.
  - `over_invited` becomes a stored generated column with the same name, over the same function. The list filter's call does not change.
  - `owner_agent_rsvp_people_totals` reads through the same function.
  - `over_invited(guests)` is dropped.
  - `guest_effective_attending(guests)` stays, for the owner agent's primer SQL (Context).
    - `create or replace` turns it into a thin wrapper over the new function and keeps its ACL. A drop and re-create would lose the read-only role's grant, while `primer.test.ts`, which reads migration text, stayed green.
    - EXECUTE on it is then revoked from `authenticated`. `service_role` and `supabase_read_only_user` keep it.
- **Grants.** The new function gets EXECUTE for `authenticated` and `supabase_read_only_user`; `service_role` has it by default.
  - `authenticated` needs it twice. `guest_totals` calls it as the signed-in user, and the generated column runs it as the writer on every session insert and update of `guests` (Context).
  - The read-only role needs it because the wrapper calls it.
- **pgTAP pins:**
  - no function that `authenticated` can execute takes or returns a `guests` row;
  - EXECUTE on the new function for `authenticated` and `supabase_read_only_user`, and on the wrapper for `service_role` and `supabase_read_only_user` but not `authenticated`;
  - the INVOKER functions executable by `authenticated` that read `guests` (today, `guest_totals` only);
  - no `security_invoker` view over `guests` (today none; the three console views run as owner);
  - the policies that depend on `guests` (today, its own four).
- **Rejected:**
  - SECURITY DEFINER plus a `can_access_event` check. It moves row scoping out of RLS into hand-written SQL, adds a definer function to pin, and ties this change to the org change's `search_path` rewrite.
  - An RPC for the filtered list. It changes the app and needs pagination parity.
  - Dropping `guest_effective_attending(guests)` and naming the new function in the primer. The migration deploys before the app, so the live primer would name a dropped function in between.

### D4. The RSVP token is closed to sessions by grant
- `revoke select on public.guests from authenticated`, then `grant select (<every other column, listed>)`. The list is read from the catalog after 3.1 is applied, so it includes the generated `over_invited`.
- Why not the column form: a column REVOKE is a no-op under a table grant (Postgres 17 REVOKE docs; the ACL above is MEASURED).
- Consequence, stated in the migration header and pinned by pgTAP: a new `guests` column stays unreadable to sessions until it is granted, and `select=*` answers 42501.
- The owner agent's whole-row call keeps working: `supabase_read_only_user` reads every column through `pg_read_all_data` (Context).
- Ships only after D3 is applied on live. Writes stay table-level unless A-O12 says otherwise.

### D5. Other credential columns
- On `callback_requests` and `contact_messages`, `authenticated` loses every privilege except INSERT: SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
  - No access changes. No SELECT, UPDATE or DELETE policy exists, and every caller uses the service role (Context).
  - The other four privileges have no Data API path (INFERRED from the verbs PostgREST exposes).
- INSERT is decision A-OA1. It is the one privilege a session can use today, and a past migration kept it on purpose (Context).
  - Recommended: revoke INSERT and drop `cb_insert_authenticated` and `cm_insert_authenticated`.
  - Alternative: an INSERT column grant without `intake_token` and `rating_token`, with the policies kept. A session could still enqueue callback work.
- `card_token_ref`: see D0.
- `gift_link_token` and the invitation token stay as they are.

### D6. Provider checks and token answers
- The Graph and WhatsApp checks become `safeTokenEqual(presented, sha256Hex(expected))`, each behind a per-address rate limit.
- `/g/[token]/go` sets `no-store` on every answer itself, like the other token routes. The `next.config` block stays as defense in depth. Its limit is keyed as `gift:redirect:<fingerprint>:<address>`.

### D7. Narrow token reads
- There are three RPCs, for rating (resolve and submit), gift (page and redirect fields) and thank-you.
  - Each is SECURITY DEFINER with `search_path ''`, and only `service_role` may execute it.
  - Each takes a token and returns only the fields its page shows.
- **Rating submit.**
  - It writes one `activity_log` row in the same transaction: no event, no user, and only the inquiry id in `meta`.
  - It stays re-submittable, as §4.3 requires (Context).
- **Expiry** is owner decision A-OA2, because §4.3 rules it out on purpose. If A-OA2 is yes, both rating RPCs refuse a link 30 days after `rating_requested_at`, one constant.
- **Why:** today's service-role reads can reach any column. An RPC limits a page bug to its own fields.

### D8. Hashed call tokens without an outage (A-O13, an engineering choice)
- **Expand (migration).**
  - Add `token_hash` with a unique index to the four tables.
  - Backfill it with `encode(sha256(convert_to(access_token,'UTF8')),'hex')`, which must equal `sha256Hex` (`token-compare.ts:11`) byte for byte.
  - A `BEFORE INSERT OR UPDATE OF access_token` trigger fills `token_hash` while old code still writes `access_token`.
    - It fills only when `access_token` is not null, and never replaces a supplied hash with NULL.
    - Reason: App 2 inserts hash-only rows while the trigger is still installed, and an unguarded `sha256(NULL)` would erase their hash. Every lookup would then miss.
    - No code updates the token of an existing row today (regex, a lower bound); the trigger covers one anyway.
  - `access_token` drops NOT NULL.
- **App 1.** Every lookup matches `token_hash`. Writes keep both columns, so a revert strands no call.
- **App 2.** Writes store the hash only. The three test-call scripts that read a stored raw token back mint a fresh attempt instead: `scripts/voximplant/sales-close-call.ts:199`, `meeting-confirm-call.ts:188` and `bridge-call.ts:197`.
- **Contract (migration).** Drop `access_token`, its indexes and the trigger, once a read-only check shows no row without a hash.
  - The tests that still name the column move to `token_hash` in the same task (Context).
  - Otherwise their 42501 pins would fail with 42703 at parse time, and their fixtures would fail to insert.
- **Lookup safety.** An index equality on the hash reveals nothing usable about the token. `console-calls.ts:1156-1167` scans in JS only because its table is tiny.
- **Rejected:**
  - the umbrella's quiet-window cutover, which fails calls in flight;
  - a TypeScript dual-read fallback, which adds a second lookup and a branch to remove later.

### D9. Cleanup
- **`mcp`:**
  - delete the folder and its `config.toml` block;
  - delete the deployed function only after the owner approves that production step;
  - check with `supabase functions list`.
- **`purpose/.../cb`** gets the same purpose binding as `ctx`.
- **`submit_rsvp`** gets a boolean parameter, default false.
  - On a new "attending" answer it writes `confirmed_headcount = least(10, adults + kids)` and `headcount_answered_at`, instead of clearing them.
  - Only the RSVP page passes it.
  - The default keeps today's nine-argument call working, so the app ships after the migration with no outage.
  - The old signature is dropped in the same migration.
  - An idempotent re-submit still skips the projection, so its headcount timestamp is no longer refreshed.

### D10. Decisions

Open owner decisions. Each one blocks only its own task.

| Id | Decision | Recommendation | Live effect | Blocks |
|---|---|---|---|---|
| A-O12 | Narrow session INSERT/UPDATE on `guests` to column grants without `rsvp_token` and `rsvp_token_revoked_at` | yes, as its own migration after 3.3 | No app flow changes: only the service role writes them (`rsvp-links.ts:56,78`). 5 `guests.edit` holders (4 owners, 1 member) lose a direct API write that no screen uses | 3.5 |
| A-OA1 | Close direct session inserts into `callback_requests` and `contact_messages`: revoke INSERT from `authenticated` and drop `cb_insert_authenticated` and `cm_insert_authenticated`? The alternative is an INSERT column grant without `intake_token` and `rating_token`, policies kept | yes, the full revoke | A signed-in account can no longer enqueue callback work or inquiry rows through the Data API. No app flow changes: every writer uses the service role. Under the alternative, a session can still enqueue callback work that may be booked and dialled (INFERRED) | 4.2 |
| A-OA2 | Expire rating links after a fixed time, reversing the no-expiry rule of §4.3? | no: keep §4.3, re-submittable and never expiring. If yes, 30 days | If yes: the one live link (requested 2026-10-05, rated) stops accepting a re-submit on 2026-11-04, and each later link 30 days after its request | 6.3 |
| A-O19 | Hermes: verify the Bot Framework JWT in the route before forwarding, and bind Hermes to 127.0.0.1? | yes, both | Forged requests stop at the route. A wrong audience setting would drop Teams messages until fixed. Today the internet cannot reach 3978, because the firewall drops it (MEASURED, Context). The route forwards any `Bearer ` header unverified, so that is the open path | 9.1 |
| A-O20a | Give each console scenario its own `KALFA_CONSOLE_SECRET`? | no: the scenarios share one Voximplant application and its Secrets (INFERRED), so separate values isolate nothing | none if kept | 9.2 |

Engineering decisions taken, each with its reason above:
- A-O11 is a measured fact (D2).
- A-O20b is closed by measurement: the CardCom document secret arrives in the body, not in the URL, so no log line carries it (Context, "CardCom documents"). Its task and its nginx change are removed.
- A-O13: backfill plus a guarded trigger (D8).
- The manifest is total over its roots (D1).
- `guest_totals` stays INVOKER, `over_invited` becomes a generated column, and `guest_effective_attending(guests)` stays as a wrapper closed to sessions (D3).
- The column-grant form (D4).
- The revoke of every non-INSERT privilege on the two inquiry tables, with no access change (D5).
- The RPC shape (D7).
- The `submit_rsvp` parameter (D9).
- Deleting `mcp` is not a decision. Its production step waits for the owner's approval, like a migration push.

Already approved by the owner on 2026-10-26, not asked again:
- Split the plan into three changes and apply the review fixes (~21:52).
- Every permission a change touches is defined in CASL (~20:26). This change adds or binds no permission key.

Not approved: any migration push, any access change, any commit, and every open decision above.

Each gated task, when it runs, adds its requirement or scenario to `specs/public-access-surface`.

## Risks / Trade-offs

- [A whole-row path that the inventory missed, such as a computed field added later] → The pgTAP pins of D3. The local-it of 3.3 also runs every session read and write of `guests` as owner and as viewer, and the log check follows each push.
- [A role that runs the attendance rule lacks EXECUTE on the new function: a session writer through the generated column, a reader through `guest_totals`, or the owner agent through the wrapper] → 3.1 grants it to all three paths, pgTAP pins the grants, and 3.1's local-it writes and reads as owner and runs the primer SQL as the read-only role.
- [A direct API client using `select=*` on `guests`] → It gets 42501. No app path does this: every session select on `guests` lists its columns, and no select embeds `guests(…)` (regex, a lower bound). The migration header states it.
- [A new `guests` column is unreadable to sessions] → The pgTAP pin fails until the column is granted.
- [A provider that sends its own `X-Forwarded-For` shares one bucket per egress address after D2] → 11 provider keys use the address alone. D2 ships as its own release, and the owner checks those routes for new 429s in the access log for one day.
- [nginx stops sending `X-Real-IP`, so every client shares `'unknown'`] → A unit test pins that fallback, and the nginx line is cited beside the code.
- [The SQL hash differs from `sha256Hex`] → A local-it parity test; any mismatch fails the expand migration's verify.
- [The fill-in trigger erases a supplied hash] → The trigger is guarded (D8). 7.1 inserts a hash-only row, and 7.3 resolves each real writer's row through its lookup while the trigger is installed.
- [PostgREST does not resolve the old nine-argument `submit_rsvp` call] → The local-it calls the function with the nine named arguments before the app ships.
- [If A-OA2 is yes, a late rater gets the generic answer] → One constant (30 days), and the audit row records every accepted rating.

## Migration Plan

- **Order.**
  1. Group 1 (manifest, no access change).
  2. Group 2 (address, its own release), after the core's run-state commit lands (D0).
  3. 3.1 → applied on live → 3.2 → 3.3 → applied on live → 3.4, then 3.5 once A-O12 is decided.
  4. 4.1, then 4.2 once A-OA1 is decided.
  5. 5.1.
  6. 6.1 → applied on live → 6.2, then 6.3 once A-OA2 is decided.
  7. 7.1 → applied on live → 7.2 → 7.3 → 7.4 → applied on live.
  8. 8.1 (with approval), 8.2, then 8.3 → applied on live → 8.4.
  9. Group 9, each task per its decision.
  10. Group 10.
- **Each migration.**
  - It is created with `npx supabase migration new`.
  - Its header carries rollback SQL:
    - re-grant the revoked privileges, and recreate the dropped policies from their recorded text;
    - recreate the dropped functions, and the wrapper's old body, from their recorded definitions;
    - drop the new RPCs;
    - drop `token_hash` and the trigger.
  - It is its own push, with owner approval.
- **Each app task** is a git revert. 3.1, 4.2 and 7.4 drop objects; their rollback is the recorded definition in the header.

### Implementation team

The cross-team rules (the worktree base after the core's 1.1–1.2, one migration queue, redefined functions, one local stack, generated files, checks that bind every team) are in the core's design, Migration Plan, "Implementation team". This change adds:
- **Redefinitions.** 3.1 redefines `guest_effective_attending` and `guest_totals`, both INVOKER on `search_path=public`, and `owner_agent_rsvp_people_totals`, INVOKER on `search_path=""`. 8.3 recreates `submit_rsvp`, DEFINER on `search_path=public` (MEASURED: live `pg_proc`). Each restates its SECURITY clause and `SET search_path`, because `create or replace` keeps only the owner and the ACL. Each applied-on-live check compares `prosecdef` and `proconfig`.
- **Waits.** 2.1 waits for the core's 1.1 (D0). After 1.1 here is committed, a sibling task that adds a route, `'use server'` module or edge function adds its manifest row in the same task.
- **Shared files.** The overlap is textual. The task that merges second rebases and re-runs both tasks' tests:
  - the `console-findings`, `console-views` and `console-realtime` local-it suites: 7.4 here and the core's 6.4;
  - `src/lib/data/guests.ts`: 3.2 here; organization-action-map 3.3 rewrites its 16 `requireEventAccess` calls (MEASURED: grep);
  - `campaign-actions.ts` and its test: 2.1 here, after the core's 1.1 commits the test.

**This team.**

| Role | Agent type | Owns |
|---|---|---|
| Surface engineer | general-purpose | 1.1, 1.2, 2.1, 5.1, 6.2, 8.1's repository part, 8.4, 9.1 |
| Database engineer | rls-schema-engineer | every `Migration:` task (3.1, 3.3, 3.5, 4.1, 4.2, 6.1, 6.3, 7.1, 7.4, 8.3), each with its pgTAP, local-it, applied-on-live check and types; 3.2, 3.4; the 10.2 personas |
| Call-token engineer | voximplant-engineer | 7.2, 7.3 (the call-token lookups, the four writers and the `scripts/voximplant` test-call scripts), 8.2, and 9.2 if A-O20a is yes (the console scenarios' Secrets) |
| Guests reviewer | events-guests-expert | the domain review of group 3: guest totals, the over-invited filter and every session write of `guests` |
| Security reviewer | public-rsvp-sentinel | the adversarial review of every group. It is read-only (MEASURED: its tools are Read, Grep, Glob, Bash, WebFetch, WebSearch), so it never implements |
| Integration reviewer | eng-manager-review | the integrated diff and test matrix before 10.2 |

The lead runs 10.1, and runs 8.1's live `supabase functions delete mcp` once the owner approves it.
**Workflow per group.**
1. The implementer works in its own worktree.
2. It runs the focused tests.
3. A fresh public-rsvp-sentinel reviews adversarially, with the security lens. Group 3 also gets events-guests-expert, because a missed whole-row path breaks every customer's totals (review B1). For a group with a migration, the brief adds rls-schema-engineer's SQL checklist: grants, `search_path`, the rollback header and the applied-on-live query with its log check.
4. The implementer fixes what the review found.
5. The full gates run: `npm test` (its pretest runs `worker:deps`), `npm run typecheck`, `npm run lint` and `npm run build`, plus pgTAP and local-it when the group touches SQL.
6. STOP. The lead asks the owner before the merge, and separately before each migration push, each access change and the live deletion of `mcp`.

**Cost.** One group is one implementer run and one review run. Two lanes genuinely run in parallel, so they form a workflow:
- an app lane: groups 1, 2 and 5, then 6.2, 8.1, 8.2, 8.4 and group 9 as their prerequisites land;
- a database lane: groups 3 and 4, 6.1 and 6.3, group 7, and 8.3.

7.2 and 7.3 are a hand-off inside the database lane, between 7.1 and 7.4, not a third lane. Group 10 runs sequentially.

**Owner decisions.**
- Before the team starts: none from D10, because each blocks only its own task. The team's base needs the owner's approval of the core's commits 1.1 and 1.2.
- Before a later task: A-O12 before 3.5, A-OA1 before 4.2, A-OA2 before 6.3, A-O19 before 9.1 and A-O20a before 9.2.
