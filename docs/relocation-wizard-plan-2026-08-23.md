# Relocation Wizard — Plan (2026-08-23)

Goal: an installation/relocation wizard that moves the KALFA app from its current origin
(today `https://beta.kalfa.me`) to **any target URL** — the main domain, or an arbitrary
external domain — with zero manual edits. The wizard is fully generic: the target origin is
its only input; nothing about `kalfa.me` is assumed. `kalfa.me` appears below only as the
current state being migrated away from, and as one special case (the root domain currently
serves the live Laravel site).

Basis: four parallel expert audits run 2026-08-23 (application code, infrastructure,
external integrations, live DB). All file:line references were read-verified; DB findings
came from a SELECT-only sweep of all 359 text/json columns in `public`.

Status: **PLAN ONLY — not build-authorized.** Nothing in this document has been implemented.

---

## 1. Audit conclusions (what the wizard has to work with)

**The architecture is already ~70% wizard-ready.**

- `APP_ORIGIN` (`.env.local`) is the single trusted origin source. `src/lib/url.ts:17-58`
  (`getAppOrigin()`/`getAppUrl()`) validates it, throws in production if unset, and never
  derives from the Host header. ~25 modules route through it: sitemap/robots/llms.txt,
  `metadataBase`, auth-email `redirectTo`, RSVP links (`/r/[token]`), agreements, Graph
  webhook `notificationUrl`, Voximplant callback arming, outreach calls, email templates.
- **The DB is domain-clean by design.** All guest/RSVP/gift/invite links are built at
  render/send time from `APP_ORIGIN`; tables store bare opaque tokens. Only 2 columns need
  rewriting on a move: `app_settings.privacy_url` and `app_settings.terms_url`. No message
  body stored in the DB contains a URL.
- **The deploy pipeline is domain-free.** `npm run deploy` (staged build → `.next` swap →
  pm2 restarts) references only port 3002 and pm2 names.
- Serving: pm2 `kalfa-beta` (`next start -H 127.0.0.1 -p 3002`); nginx
  `/etc/nginx/conf.d/beta-proxy.conf` shadows the Plesk vhost (conf.d loads before
  `zz010_psa_nginx.conf`); carries the mandatory beta-502 fix
  (`proxy_buffer_size 32k; proxy_buffers 16 16k; proxy_busy_buffers_size 64k`) and the ACME
  location. TLS via Plesk Let's Encrypt; the `kalfa.me` cert is a wildcard
  (`*.kalfa.me`, DNS-01, auto-renewing). Plesk is authoritative DNS for kalfa.me.

**Remaining coupling falls into three classes:**

1. Hardcoded literals in our own code (fixable once, then gone — §3).
2. Platform-resident registrations of our URL (updatable via API or dashboard — §5 Stage F).
3. Physically origin-bound artifacts that no wizard can fully automate (§6).

---

## 2. Requirements

- **R1 — Generic.** Single input: target origin (`https://<any-domain>`). Every step is a
  function of that input. After Phase 0, zero domain literals remain in code, config
  templates, or wizard logic.
- **R2 — Safe by construction.** Preflight validation before any mutation; dry-run mode
  printing the full change-set; per-step verification; idempotent + resumable (state file);
  timestamped `.bak` of every file it writes; one-command rollback.
- **R3 — Approval gates.** The wizard stops and asks (never assumes) on: target already
  served by this server (e.g. root `kalfa.me` = live Laravel site), Voximplant scenario
  redeploy (live telephony), Meta template submission, DNS changes, and anything destructive.
- **R4 — Honest about async/manual steps.** External-registrar DNS, Meta approval, and Play
  review are polled/tracked, not faked as automated.
- **R5 — Old-origin continuity.** Links already delivered to guests keep working: the old
  origin 301s to the new one for as long as any pre-migration event is live.

---

## 3. Phase 0 — prerequisite code fixes (one-time, before the wizard exists)

Removes every hardcoded origin so `APP_ORIGIN` becomes the only knob. Small, individually
reviewable changes:

| # | Location | Fix |
|---|----------|-----|
| 1 | `src/lib/data/whatsapp-import.ts:292` | remove `'https://beta.kalfa.me'` fallback — throw instead (worker context must have env) |
| 2 | `ops/probes.mjs:234-239` | edge probe fetches the literal beta URL → read `APP_ORIGIN` (sidecar already loads `.env.local`) |
| 3 | `ecosystem.config.cjs:134` | inline `APP_ORIGIN` for kalfa-fleet duplicates `.env.local` — the file's comment marks the duplicate as DELIBERATE (future fleet role Bash). Keep both locations; the wizard rewrites BOTH on domain change. pm2 needs the documented clean restart to re-read env |
| 4 | `voxfiles/scenarios/src/ConsoleDial.voxengine.js:80,135`, `ConsoleCallMeNow.voxengine.js:148` | `KALFA_APP_ORIGIN` + `RINGBACK_URL` hardcoded → pass via `custom_data` like `RSVPAgent.voxengine.js:474-478` (both are HTTP-started). Redeploy via `voxengine-ci upload` (never touch DTMF `OutCall` rule 1494311) |
| 4b | `ConsoleInbound.voxengine.js:84-86` | **cannot use custom_data** — inbound sessions are started by the incoming call, not StartScenarios (the file's own comment says so). Fix: inject the origin at upload time — a `vox:upload` templating step that substitutes the value from `APP_ORIGIN`; the wizard re-runs it on domain change [gate — live telephony] |
| 5 | `scripts/voximplant/test-call.ts:66` | drop literal fallback, require env |
| 6 | `scripts/kalfa-preflight.sh:7` | default domain → derive from `APP_ORIGIN` |
| 7 | `src/app/(admin)/admin/debug/_panels.tsx:341` | UI label names the beta host → render env-derived host |
| 8 | **new** `/api/health` route | none exists today; wizard verification needs one (local + public probe target) |
| 9 | `src/lib/http/allowed-origin.ts:13-16` | optional: support a transitional comma-separated multi-origin allow-list so POSTs from the old origin don't fail closed during cutover. If adopted, BOTH layers must change: this module AND `experimental.serverActions.allowedOrigins` in next.config.ts (the documented knob for extra Server-Action origins — `serverActions.md:11-25`) |

Raw `process.env.APP_ORIGIN` reads in 3 campaign routes work but bypass the validator —
optional cleanup to `getAppOrigin()`.

---

## 4. Wizard architecture

**CLI-first** (`npm run relocate -- --target https://new-domain.com [--dry-run|--resume|--rollback]`),
because the work crosses privilege boundaries the app process must not hold (nginx writes,
`nginx -t`/reload, Plesk CLI, pm2 restarts of itself). An `/admin` page can later render the
wizard's state file as a read-only progress/checklist view.

- State file (`.relocation-state.json`, git-ignored): target, per-step status, timestamps,
  backup paths — enables resume and rollback.
- Every mutating step: check → backup → apply → verify → record. Failure = stop + report;
  never continue past a failed verification.
- Config templates (nginx vhost, redirect vhost) live in the repo with `{{ORIGIN}}`/
  `{{DOMAIN}}`/`{{CERT_PATH}}` placeholders — including the proxy-buffer block and the ACME
  location (both load-bearing; omitting them regresses known incidents).

---

## 5. Wizard flow

### Stage A — Preflight (read-only, no gate)
1. Parse/validate target origin (https, bare origin, not current origin).
2. DNS: does the target's A/AAAA record point at this server? (The server's public IP is
   resolved at runtime — never hardcoded, per R1.)
   - Hosted in local Plesk → wizard can write the record itself (`plesk bin dns`).
   - External registrar → print exact record needed, poll `dig` until it resolves (R4).
3. **Conflict detection:** is the target already served by this server (existing vhost /
   server_name)? If yes → hard stop with options (e.g. for root `kalfa.me`: re-home Laravel
   to `legacy.kalfa.me` — one Plesk CLI call + zone record — or abort). Owner decision, R3.
4. Cert status: existing cert covering target? (wildcard covers `*.kalfa.me`; external
   domains need issuance in Stage C.) `openssl -enddate` sanity check.
5. Environment: `nginx -t` clean, pm2 processes online, disk, `APP_ORIGIN` present,
   Phase 0 fixes present (refuse to run against un-fixed code), and **no `NEXT_PUBLIC_*`
   var contains the app origin** (such values freeze at build time —
   `environment-variables.md:158-166` in the installed Next docs — so env-swap without
   rebuild would be silently wrong; today none exists, the check keeps it that way), and
   the Supabase Management API access token env is present (Stage F depends on it — assert
   before mutating anything, not mid-run).
6. Meta template inventory: which approved templates embed URL buttons on the old origin
   (today: gift `/g/…`, thank-you `/ty/…`, `kalfa_sales_signup_link_v1` `/auth/signup?ref=`).
7. Produce the full dry-run change-set for review.

### Stage A.1 — Prerequisite installation policy (owner directive, 2026-08-23; REVISED
same day after live-doc research — see §Install Mode below)

Preflight includes a **required-tooling check** (node, nginx, plesk CLI, pm2,
passwordless `sudo -n`, repo node_modules) — every missing item is `blocked` with the
exact fix command. Owner ruling: the wizard must be able to INSTALL, not only instruct.
Live-doc research (2026-08-23, sources in §Install Mode) found an authoritative
non-interactive command for every component, so the tiers are now:

| Tier | Items | Command basis (live-verified) |
|---|---|---|
| auto (after confirm) | `npm ci` (repo deps; install scripts MUST run — sharp/esbuild break otherwise; surface `npm install-scripts ls`), repo clone/build | docs.npmjs.com v11 |
| gated-auto (wizard runs behind an approval gate, `sudo -n`) | Node 24 (NodeSource apt `setup_24.x`; Plesk toolkit only offers LTS majors), pm2 (`npm i -g` + `pm2 startup systemd -u <user> --hp <home>` — run the printed command via sudo — + `pm2 save`), nginx (Plesk: `plesk installer --install-component nginx` + `plesk sbin nginxmng --enable`; bare: nginx.org apt repo), Let's Encrypt (Plesk: `plesk bin extension --exec letsencrypt cli.php -d <domain> -m <email>`; bare: snap certbot + `certonly --webroot`) | support.plesk.com / docs.plesk.com / pm2.keymetrics.io / nginx.org / certbot.eff.org |
| genuinely non-automatable | `.env.local` secrets (exist only in the owner's vault — the wizard must never carry secrets in its state), Plesk itself + license (changes the server's management model), external-registrar DNS (instruct + poll), third-party platform state gated on external clocks (Meta review, Play review) | honesty table, §Install Mode (d) |

Every gated-auto item keeps the wizard's contract: show the exact command + consequence,
get approval, run, verify, record for rollback.

### Stage B — Async lead items (start first; longest external latency)
1. **Meta `_v2` templates** [gate]: submit new template versions with the new base URL via
   Graph API (never delete existing — project rule). Poll approval status. The origin flip
   (Stage D) SHOULD wait for approval; the owner may override and rely on the 301 instead
   (buttons keep working via redirect — acceptable interim).
   **Live-inventory rule (verified against Meta 2026-08-23):** the template inventory MUST
   come from the live Graph API (`{waba}/message_templates`), never the repo spec — the
   spec scan saw 1 line while the live registry holds **21 approved templates** baking the
   beta origin. Also found live: the 2 OTP templates point at whatsapp.com (domain-neutral,
   never need work), and legacy `rsvp_invite_v2` [APPROVED] points at the APEX
   `https://kalfa.me/invitations/{{1}}` — a pre-React relic whose path the current app does
   not serve; investigate usage and retire or repoint it as its own task. Editing an
   approved template in place is possible at Meta but re-enters review while taking the
   existing template out of service — `_v2`-in-addition keeps the old one working through
   the wait, which is why the project rule stands. Preflight now performs this live
   inventory itself (repo-spec fallback is labeled as an undercount).
2. **Android app advisory** (verified 2026-08-23, corrects the audit's TWA inference):
   the Play app `me.kalfa.agentconsole` is a NATIVE Kotlin console app, not a TWA. Its
   coupling is a **hardcoded API base URL** — `https://beta.kalfa.me` baked into ~10 call
   sites (`SupabaseImplementations.kt:647-1302`, `VoxTelephony.kt:95`,
   `TelemetryUploader.kt:179` in the KALFA-ELEVENLABS repo). These are POSTs and will NOT
   survive a 301 (HTTP clients don't replay POST bodies across 301/302). Track: app release
   with a single configurable base URL + Play review (parallel, human-paced); until the
   installed fleet updates, the old origin must keep **proxying `/api/*`** (Stage E).
   The `assetlinks.json` 404 on beta was verified benign: no App Links/autoVerify in the
   Android manifest, no TWA, no `related_applications` in the PWA manifest — nothing
   requires the file today.

### Stage C — Infrastructure (automated)
1. External domain not in Plesk → `plesk bin domain --create` (no hosting) for cert
   management.
2. Cert issuance if needed: Plesk LE extension, **http-01** (DNS-01/wildcard only for
   locally-hosted zones), retry with backoff after DNS propagation; hard-stop before LE
   rate limits (5 failed validations/hour).
3. Write `/etc/nginx/conf.d/<domain>-app.conf` from the template (server_name = target,
   cert paths, proxy → 127.0.0.1:3002, proxy buffers, ACME location, X-Forwarded-Host/Proto).
4. `nginx -t` (whitelisting the benign "conflicting server name" warning) → `systemctl
   reload nginx` (graceful).

### Stage D — App switch (automated; seconds of downtime)
1. Rewrite in `.env.local` (backup first) — **two keys**, verified 2026-08-23: `APP_ORIGIN`
   and `PGBOSS_DASHBOARD_URL` (its value embeds the origin; it has zero runtime consumers —
   grep-verified, docs-only — but leaving it stale turns the env file into wrong
   documentation). The other env files are origin-clean: `.env.pgboss-dashboard` and the
   dashboard's `.env.pgboss-ui` hold only DB/port/auth/base-path keys (0 domain matches) —
   no wizard action.
2. `npm run deploy` — rebuild is REQUIRED: four surfaces bake the origin at build time
   (llms.txt `force-static`, `robots.ts`, `sitemap.ts` — cached-by-default special route
   handlers per the installed docs — and static-page metadata via `metadataBase`). The
   rebuild also mints a new `deploymentId` (`next.config.ts:34` + `.deploy-id`), so stale
   browser tabs hard-reload onto the new origin — version-skew cutover for free.
3. If transitional multi-origin allow-list (Phase 0 #9) is implemented: include old origin
   for the cutover window.

### Stage D.1 — pm2 process matrix (verified against `ecosystem.config.cjs`, 2026-08-23)

How each pm2 process actually receives `APP_ORIGIN`, and therefore what the wizard must do.
Background: the ecosystem file's header documents a real incident (2026-07-06) where
`pm2 restart --update-env` copied the deploying shell's environment into production;
since then the deploy script deliberately uses PLAIN `pm2 restart`, which reuses the env
captured at the last clean start. **The wizard must NEVER use `--update-env`.**

| Process | How it gets APP_ORIGIN | Wizard action on origin change |
|---|---|---|
| `kalfa-beta` | `next start` reads `.env.local` fresh at every boot | plain restart (via `npm run deploy`) — nothing more |
| `kalfa-worker` | `worker/start.mjs` loadEnv at boot | plain restart (via deploy) — nothing more |
| `kalfa-ops-agent` | `node_args: --env-file=.env.local` (file read fresh at boot) | plain restart (via deploy) — nothing more |
| `kalfa-fleet` | **inline** `env.APP_ORIGIN` in `ecosystem.config.cjs:134` (deliberate, Phase 0 #3) | rewrite the line, then the documented one-time clean cycle: `pm2 delete kalfa-fleet` → scrubbed start `env -i HOME=$HOME USER=$USER PATH=/usr/local/bin:/usr/bin:/bin pm2 start ecosystem.config.cjs --only kalfa-fleet` → **`pm2 save`** |
| `kalfa-pgboss-ui`, `kalfa-filebrowser` | no APP_ORIGIN dependency | none |

Three hard rules encoded from the file's own documentation:
1. **Scrubbed shell for any `pm2 start`** — the wizard's own process env is a
   Claude/operator shell; starting pm2 apps from it without `env -i` recreates the
   2026-07-06 pollution incident. The wizard always uses the file's `env -i` recipe.
2. **`pm2 save` after any delete+start** — otherwise a server reboot resurrects the OLD
   process definition/env from the stale dump.
3. **Stage H addition — effective-env verification:** after restarts, assert each
   process is online AND actually carries the new origin: `pm2 env <kalfa-fleet-id>`
   shows the new `APP_ORIGIN`; kalfa-beta/worker verified behaviorally (health probe +
   a worker-built link in H.4) since their env comes from `.env.local` at boot.

### Stage E — Old-origin continuity (automated)
1. Rewrite the old origin's vhost `location /` to `return 301 https://<new>$request_uri`.
2. **Exception:** keep `/api/*` proxying to the app (not 301) — POST callers don't follow
   redirects: Voximplant platform callbacks (until Stage F re-registration is verified)
   and every installed Android-app build, whose POSTs are hardcoded to the old origin
   (until the fleet is on a new release, Stage B.2).
3. Keep the redirect for as long as any pre-migration event is live (today: 46 live RSVP
   tokens, 1 future event with a gift token — but delivered WhatsApp/SMS can't be recalled,
   so the redirect is mandatory regardless of count).

### Stage F — External registrations (parameterized API calls; each with its own verify)
| Service | Action | How |
|---|---|---|
| Supabase Auth | Site URL + redirect allow-list → new origin | Management API `GET`/`PATCH /v1/projects/{ref}/config/auth` (`site_url`, `uri_allow_list`; Bearer `SUPABASE_ACCESS_TOKEN`) — live-doc-verified 2026-08-23. Stage G UPDATEs can ride the same API: `POST /v1/projects/{ref}/database/query` (`read_only` flag; dedicated `/query/read-only` variant) — the wizard's 4th Supabase door alongside REST-with-service-key, the pg pooler, and the linked CLI |
| Supabase auth emails | re-deploy templates embedding `<origin>/auth/confirm` | re-run `scripts/deploy-recovery-email-template.mjs --apply` + `scripts/deploy-email-change-template.mjs --apply` |
| Meta WhatsApp webhook | callback URL → `<origin>/api/webhooks/whatsapp` | `POST /{app-id}/subscriptions` (app token); verify handshake |
| Microsoft Graph | delete + recreate subscriptions (notificationUrl embeds origin) | Graph API; code already builds URL from `getAppOrigin()` (`src/lib/microsoft/subscriptions.ts:38-40`) |
| Voximplant | account callback re-arm to `<origin>/api/voximplant/…` | existing admin flow (`src/lib/data/admin/voximplant-channel.ts:287`) — API call, not raw UPDATE; then close Stage E exception |
| Voximplant Console scenarios | after Phase 0 #4: origin arrives via custom_data — nothing to do; until then: edit + `voxengine-ci upload` [gate — live telephony] | voxengine-ci |
| ElevenLabs | workspace post-call webhook → new origin; KB doc referencing sitemap URL | webhook: dashboard (owner-manual unless API confirmed); KB via ConvAI API + pull→edit→push workflow |
| GA4 | data-stream default URI | Admin API `dataStreams.patch` (or 2-min console edit) |
| Resend / `send.kalfa.me` | **no action** — sending domain is DNS-bound, independent of app origin; body links follow `APP_ORIGIN` | optional rebrand only (full DNS/DKIM redo — out of scope) |
| SUMIT, ExtrA SMS | **no action** — no stored URLs; everything built per-request | — |

### Stage G — DB updates (automated, 2 statements)
1. `UPDATE app_settings SET privacy_url = :origin || '/privacy', terms_url = :origin || '/terms';`
2. Optional owner prompt (explicitly out of app-origin scope): `company_contact_email`,
   `smtp_from`, Exchange mailbox identity — email identity, not app URL.

### Stage H — Verification suite (wizard-run, blocking)
1. Local probe: `HEAD http://127.0.0.1:3002/api/health` with `Host: <new>`.
2. Public: `GET https://<new>/` (200, correct cert chain).
3. Authenticated `/admin` request — exercises the chunked-cookie/proxy-buffer path
   (the historical 502 regression).
4. Old-origin redirect: `GET https://<old>/r/<dummy>` → 301 → new origin.
5. Supabase auth: Management-API read-back of Site URL + redirect list, and assert a
   generated recovery link's origin. (A true inbox round-trip is not wizard-automatable —
   it goes on the owner's manual checklist in the final report.)
6. Webhook echoes: Meta verify handshake, Graph validation token, Voximplant callback
   health.
7. Fetch `/robots.txt`, `/sitemap.xml`, `/llms.txt` and a static page's OG tags — assert
   the NEW origin appears in all four (cheap check that catches a skipped rebuild).

### Stage I — Post-migration open-items report
- Web push: all existing `push_subscriptions` are origin-bound and now orphaned (2 rows
  today) — purge dead rows; app re-prompts users on next visit.
- **Passkeys** (full-DB re-sweep finding, 2026-08-23; RP ID live-verified): our passkeys
  are registered via Supabase's experimental WebAuthn API, and the live challenge data
  shows RP ID = `beta.kalfa.me` (the full subdomain, not the apex) — so existing passkeys
  (`auth.webauthn_credentials`: 1 today) stop working on ANY new origin, apex included.
  Nothing to rewrite; affected users re-register on the new domain (same failure class as
  push subscriptions). Wizard note for Stage F: after updating the Supabase Site URL,
  read back that NEW registrations get the new RP ID. Future hardening idea (out of
  scope): an apex RP ID would let passkeys survive subdomain moves — depends on what
  Supabase's passkey API exposes.
- Users re-login (host-scoped Supabase cookies) — expected, not a bug.
- Android app release track status (Stage B.2).
- SEO: Search Console property for new origin, sitemap submission; beta indexing policy
  (currently gated) revisit.
- Old-origin cert renewals continue via ACME location (beta cert expires 2026-11-19).

---

## 5b. Install Mode (`relocate --install`) — bare/partial server → fully-running site
(owner directive 2026-08-23; all commands live-doc-verified that day)

The wizard's second mode: not moving an existing install, but BRINGING UP the site
completely on a target server. Same engine, same gates, same state file — a different
step list:

| # | Step | Runs as | Class |
|---|---|---|---|
| 0 | OS base packages (curl, git, gnupg) | sudo | gated-auto |
| 1 | Node 24 — NodeSource apt (`setup_24.x`); Plesk toolkit alt. (LTS-only) | sudo | gated-auto |
| 2 | `npm i -g pm2` | sudo | gated-auto |
| 3 | Repo clone/rsync to target path | app user | auto |
| 4 | **`.env.local` secrets provisioning** | human | **manual** — wizard verifies presence + key names only |
| 5 | `npm ci` (scripts allowed; report `npm install-scripts ls`) | app user | auto (confirm) |
| 6 | `npm run build` | app user | auto |
| 7 | scrubbed `pm2 start ecosystem.config.cjs` → `pm2 save` → `pm2 startup systemd` (run printed sudo command) | user+sudo | gated-auto |
| 8 | nginx vhost from repo template → `nginx -t` → reload | sudo | gated-auto |
| 9 | TLS cert — Plesk LE ext CLI (`--exec letsencrypt cli.php`) or snap certbot `certonly --webroot` | sudo | gated-auto (after #10 resolves) |
| 10 | DNS — local Plesk zone via `plesk bin dns -a`; external registrar = instruct + poll | sudo / human | mixed |
| 11½ | **DB-resident service settings** — WhatsApp Cloud API, SUMIT, ExtrA SMS, SMTP, Voximplant service account all live in `app_settings` (DB), NOT env; entered via the running app's /admin/settings + /admin/channels; wizard polls presence (read-only REST, service key) and waits | human via admin UI | mixed (step I12) |
| 11 | Full verification suite (Stage H) | app user | auto |

Ordering constraints: #9 (http-01) needs #10 resolving to this server; #8 must exist
before #9 (ACME webroot location). REVISED 2026-08-23 (design §5c): #8/#10/#9
(vhost/DNS/cert) run BEFORE #4 — the env-parameter setup form is served through that
vhost on the real domain, WordPress-style, and the wizard auto-continues once the
last key lands. Plesk-vs-bare is detected by `plesk version` and
switches nginx/cert/DNS providers; never let Plesk LE and certbot manage the same
domain. Sources: docs.plesk.com + support.plesk.com (installer/nginxmng/extension
--exec/site/dns/nodejs CLIs), nodesource/distributions, pm2.keymetrics.io/startup,
nginx.org/en/linux_packages, certbot.eff.org + eff-certbot readthedocs (webroot fits
our template — certbot never mutates our conf), docs.npmjs.com (npm ci, npm 11
`install-scripts` advisory → npm 12 enforced; our `allowScripts` already compliant).

## 6. Irreducibly manual / async steps (the honest list)

1. **DNS at an external registrar** — owner points the record; wizard polls (R4).
2. **Meta template approval** — submission automated, approval Meta-paced (days;
   re-categorization risk per the 131049 history). Mitigation: 301 keeps old buttons
   working indefinitely.
3. **Android console app** — API base URL baked into the shipped build; fix = release with
   configurable base URL + Play review. Parallel track; bridged by keeping `/api/*`
   proxied on the old origin.
4. **Conflict decision** when the target already serves a site (root `kalfa.me` → Laravel
   re-homing choice).
5. **ElevenLabs workspace webhook** — dashboard-only unless an API path is confirmed during
   implementation.
6. **Voximplant scenario redeploy approval** — automatable but gated (live telephony).
   Phase 0 #4 removes it for the HTTP-started scenarios; ConsoleInbound (#4b) always needs
   an upload-time re-template + gated redeploy on domain change.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Laravel site silently displaced (root-domain case) | Stage A conflict detection = hard stop + explicit choice |
| Proxy buffers omitted from new vhost → recurring `/admin` 502s | buffers baked into the repo template; Stage H.3 verifies |
| ACME location omitted → cert renewals break | in template; Stage H cert check |
| Redirect omitted → delivered RSVP/gift links die | Stage E is non-optional; Stage H.4 verifies |
| Voximplant callbacks lost mid-cutover | Stage E exception keeps `/api/voximplant/*` proxied until re-registration verified |
| Meta buttons broken during approval window | Stage B ordering (submit first) or explicit owner override relying on 301 |
| pm2 env not picked up (`restart` reuses captured env) | wizard uses the documented clean-restart path; Phase 0 #3 removes the inline duplicate |
| LE rate limits on repeated failed issuance | backoff + hard-stop before 5 failures/hour |
| Push/console alerts silently dead | Stage I purge + re-prompt; listed in final report |
| Installed Android apps POST to old origin (301 won't carry POSTs) | old origin keeps proxying `/api/*` until the app fleet updates (Stage E exception) |

---

## 8. Rollback (~1 minute, order matters)

1. Remove the new vhost conf (or restore old vhost from `.bak`), `nginx -t`, reload —
   previous serving instantly restored (Plesk vhosts were never modified).
2. Restore `.env.local` `APP_ORIGIN` from backup, `npm run deploy` (or pm2 clean restart
   if no code changed).
3. Revert Stage F registrations by re-running the same parameterized calls with the old
   origin (the wizard records each one it made in the state file).
4. Revert Stage G with the recorded previous values.
5. Voximplant scenarios: re-upload prior versions from git (`voxfiles/` is committed).

---

## 9. Open questions for the owner

1. Root-domain move: re-home Laravel to `legacy.kalfa.me` (recommended, one CLI call) or
   another arrangement?
2. Cutover policy for Meta templates: wait for `_v2` approval (safest) or flip early and
   lean on the 301?
3. Transitional multi-origin window (Phase 0 #9): implement, or accept a hard cutover?
4. Android console app: ship a release that reads its base URL from config (recommended —
   makes the app relocation-proof once) or just re-hardcode the new origin? Either way,
   how long do we commit to proxying `/api/*` on the old origin for stale installs?
5. Should email identity (`send.kalfa.me`, `@kalfa.me` addresses) ever follow the app
   domain, or stay permanently decoupled? (Plan assumes: decoupled.)

## 10. Suggested build order

1. Phase 0 fixes (small PR-sized changes + tests) → after this, a manual move is already
   just "edit env + deploy + external checklist".
2. Wizard skeleton: state file, dry-run, preflight (Stage A) — read-only value immediately.
3. Stages C–E (infra automation) with rollback.
4. Stage F integrations one service at a time, each with its verify probe.
5. Stages G–I + full dry-run rehearsal against a throwaway test subdomain (e.g.
   `staging2.kalfa.me` — wildcard cert already covers it, zero cert friction) before any
   real move.
