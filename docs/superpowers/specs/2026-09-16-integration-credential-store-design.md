# Integration Credential Store + OAuth2 — Design

Date: 2026-09-16
Status: design approved, infrastructure decisions closed, implementation not started
Scope: system-owned (KALFA) credentials for workflow integration nodes

---

## 1. Why

`app_settings` holds every third-party secret today as a flat, plaintext column
(`elevenlabs_api_key`, `extra_sms_sender`, …). That shape cannot carry an
expiry, a refresh token, a scope list, or a second account for the same
provider — so no workflow node can hold a user-delegated credential, and no
credential can rotate without a deploy.

The workflow catalogue already proves the node side works: `action.send_whatsapp`
and `action.start_voice_call` run in production against third-party APIs. What is
missing is the credential layer beneath them.

Ownership is **KALFA only**. Workflows live under `/admin/`, so a connection
represents the business's own account at a provider, never a customer's.

## 2. Measured constraints

Every item here was measured against the live project on 2026-09-16, not
inferred from documentation.

### 2.1 PostgREST does not expose `vault`

```
GET /rest/v1/decrypted_secrets   Accept-Profile: vault
→ 406 PGRST106 "Only the following schemas are exposed: public, graphql_public"
```

Supabase documents this as deliberate: *"For Supabase managed schemas, such as
`vault` and `auth`, these cannot be directly accessed through the DB REST API
for security reasons. If necessary, they can be strictly accessed through
security definer functions."*

The precedent for the fix is Supabase's own `pgmq_public` schema, which wraps
`pgmq` rather than exposing it.

### 2.2 Both server paths go through PostgREST

`createAdminClient()` (supabase-js → PostgREST, service_role) is used by Next.js
Server Actions **and** by workflow node handlers in the worker. Raw `pg` in
`worker/main.ts` serves only pg-boss and `LISTEN`.

There is therefore **one** credential access path, not two.

### 2.3 Vault ACL

| object | anon | authenticated | service_role | postgres |
| --- | --- | --- | --- | --- |
| `vault.secrets` | — | — | `rd` | `r*d*D*x*` |
| `vault.decrypted_secrets` | — | — | `rd` | `r*d*D*x*` |
| `create_secret()`, `update_secret()` (SECURITY DEFINER) | — | — | `X` | `X*` |

`anon` and `authenticated` hold no privilege on any vault object, and `PUBLIC`
appears nowhere. A browser cannot read a token because the role has no grant —
not because application code declines to return one.

`vault.decrypted_secrets` has `reloptions = null`, so it is **not**
`security_invoker`: it runs as its owner `supabase_admin`, and the grant on the
view is the entire gate.

`service_role` holds no `INSERT`/`UPDATE` on `vault.secrets`; writes must go
through the two SECURITY DEFINER functions.

That `rd` grant is load-bearing: §3.3 reaches vault **as the caller**, so this
row is what makes the wrapper work at all — and its absence for `anon` and
`authenticated` is what stops them.

### 2.4 `vault.secrets.name` is unique

```sql
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL
```

One secret per name is enforced by the database. Rotation must use
`update_secret(id, …)`; a second `create_secret` with the same name fails 23505.

### 2.5 `pgsodium` is not installed

Only `supabase_vault` 0.3.1. Vault 0.3.x encrypts without pgsodium key
management, so the `new_key_id` argument is vestigial and is passed `null`.

### 2.6 Live round-trip, executed 2026-09-16

Run against the live project with a fake value, deleted in the same session.

| step | result |
| --- | --- |
| baseline | `vault.secrets` = 0 rows |
| `create_secret(value, 'kalfa:roundtrip:probe', …, null)` | returned `86acb6f9-…` |
| read `decrypted_secrets` | `decrypted_secret` matched input exactly |
| on-disk form | `voJycEHzYimF8UryBb7rG++7…` — **differs from plaintext**, so encryption at rest is observed, not assumed |
| `update_secret(id, newValue, sameName, …)` | **same UUID**, `updated_at > created_at` |
| second `create_secret` with the same name | `23505 duplicate key value violates unique constraint secrets_name_idx` |
| delete + verify | back to 0 rows, 0 `kalfa:%` leftovers |

Two design assumptions are now facts: rotation keeps the UUID — which is what
lets a rotated refresh token write back to the same `vault_secret_id` — and the
unique name index blocks a duplicate rather than silently creating a second row.

The probe ran as `postgres` through the CLI, not as `service_role`. It proves the
Vault mechanism; the wrapper's role guard is proven separately once the wrapper
exists (§7).

### 2.7 What Vault costs — the root key is not in the backup

Read from the Vault guide and its linked backup/restore page, because this is the
one obligation Vault adds that plaintext columns never had.

**What is free.** AEAD via libsodium: the decryption function verifies a
signature before decrypting, and associated data means a ciphertext cannot be
copied from one row to another. Secrets stay encrypted in backups and in the
replication stream. Each project holds a unique root key in a secured backend,
never alongside the data. Note this makes the AAD binding that
`exchange_connections` hand-rolled a built-in property rather than something to
reimplement.

**What is not free.**

> "Backup files never contain the root key; they hold only encrypted data."

> "A newly created project is initialized with its own fresh root key, so Vault
> secrets and encrypted columns restored from the old project cannot be decrypted
> until you copy the old key across."

> **"Retrieve the root encryption key from the _old_ project _before_ you pause or
> delete it. The API below only returns the key for active projects — once the
> old project is paused or removed, the key (and any data encrypted with it) can
> no longer be retrieved."**

Pause/restore and Point-in-Time keep the key. Clone-project and Branching copy it.
A manual `pg_dump` / `pg_restore` does **not**, and the window to recover it
closes when the old project does.

`GET /v1/projects/{ref}/pgsodium` → `{ "root_key": "<64 hex>" }`, and
`PUT /v1/projects/{ref}/pgsodium` sets it on the target. Scope `secrets:read`;
fine-grained permission `project_admin_write`.

**Required before the first real credential is stored**, and an owner action —
this reads a secret, so it is not run from this session:

1. Confirm `GET …/pgsodium` responds for `cklpaxihpyjbhymqtduv`.
2. Store the root key outside this database, in the same place the deploy
   credentials live.
3. Add "export the root key first" to the top of any project-migration runbook.

Until step 2 exists, a Vault-backed credential is recoverable only for as long as
the project is alive. That is a smaller risk than the one the EWS key retirement
recorded (§2.10) but it is a real one, and it is ours to carry.

### 2.8 Lint bar for new objects

| lint | existing findings | requirement |
| --- | --- | --- |
| 0011 `function_search_path_mutable` | 9 | every new function sets `search_path = ''` |
| 0028 / 0029 SECURITY DEFINER executable | 1 / 26 | **not applicable** — the wrapper is SECURITY INVOKER (§3.3) |
| 0008 `rls_enabled_no_policy` | 14 (INFO) | acceptable shape for server-only tables |

### 2.9 Platform RBAC is the authority, and its helpers must stay open

Three separate permission spaces exist: `user_roles` (app admin),
`organization_members` (customer org), and `platform_staff` (internal team).
Integration management belongs to the third.

| helper | RLS policies calling it | why it keeps `EXECUTE` for `authenticated` |
| --- | --- | --- |
| `is_platform_staff()` | 23 | RLS itself |
| `is_platform_owner()` | 7 | RLS itself |
| `has_role()` | 2 | RLS itself |
| `has_platform_permission()` | **0** | the cookie client calls it — `dal.ts:215` |

`src/lib/auth/dal.ts` already records the 0-policy fact and names the trigger
for revisiting: *"Revisit ONLY if `has_platform_permission` ever enters an RLS
policy; that is the trigger, not team size."*

**The blanket rule "revoke EXECUTE from every SECURITY DEFINER function" is
wrong here.** RBAC helpers must remain callable; only vault wrappers close.

## 3. Architecture

```
browser (anon / authenticated)
   ✗ vault          no GRANT
   ✗ wrapper        explicit REVOKE
   ✗ tables         RLS enabled, no policy

Server Action ─┐
               ├─ createAdminClient() → PostgREST → public.integrations_*
workflow node ─┘   (service_role JWT)              │ SECURITY INVOKER
                                                   ↓
                                    vault.create_secret / decrypted_secrets
                                    (reached as the CALLER, not as an owner)
```

Three independent locks, none sufficient alone: EXECUTE on the wrapper granted
only to `service_role`; the vault ACL, which denies every other role even if it
somehow reached the function; and an empty `search_path`.

### 3.1 Tables

```
public.integration_connections          metadata only, no secret material
  id · provider · label · status · scopes[] · account_hint
  · vault_secret_id · expires_at · last_refresh_at · last_error
  · created_at · updated_at

public.integration_oauth_states         temporary PKCE material only
  id · state_hash · provider · code_verifier · redirect_to
  · requested_scopes[] · created_by · created_at · expires_at · consumed_at

vault.secrets                           token material only
```

Both tables: RLS enabled, no policies — the `exchange_connections` shape, which
satisfies the standing rule that RLS stays enabled on exposed tables while
server-side authorization remains the real gate.

`state` is never stored raw; only `sha256(state)`. `code_verifier` is sensitive
but temporary: it stays in the table with a short TTL rather than in Vault.

### 3.2 The accessor never returns a token

```ts
// src/lib/integrations/credentials.ts — 'server-only', the single gate
export async function providerFetch(
  ref: { provider: string; capability: string },
  request: { url: string; init?: RequestInit },
): Promise<Response>
```

The module resolves a connection by **provider + capability**, refreshes if
expired, attaches the `Authorization` header internally, and returns a
`Response`. A node never holds credential material, so it cannot log it, return
it, or leak it.

`connection_id` is deliberately absent from **this** signature: a node asks to
write to a calendar, not for secret number X. The module itself resolves
provider + capability to a single active connection and only then calls the
wrapper in §3.3 with that id — so the id exists, but never crosses into caller
code. That asymmetry is what prevents a universal secret oracle.

Guard used by callers of the management surface: `requirePlatformPermission(key)`
(`src/lib/auth/dal.ts:227`), the existing redirecting sibling of
`hasPlatformPermission`.

### 3.3 Wrapper shape — SECURITY INVOKER, and the measurement that decided it

Action-scoped, never a free-form "give me the secret named N":

```sql
create function public.integrations_read_credential(
  p_connection_id uuid, p_expected_provider text, p_expected_kind text
) returns text
  language plpgsql
  security invoker            -- NOT definer. See below.
  set search_path = ''
as $$ … reads vault.decrypted_secrets, joined to public.integration_connections … $$;

revoke execute on function public.integrations_read_credential(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.integrations_read_credential(uuid, text, text)
  to service_role;
```

The function returns NULL unless provider, kind, and `status = 'active'` all
match, so a guessed id yields nothing.

`revoke … from public` is required in addition to `anon` and `authenticated`:
revoking from `anon` does not remove `PUBLIC`'s default `EXECUTE`.

#### Why not SECURITY DEFINER

An earlier draft of this spec used a DEFINER wrapper delegating to a private
schema, guarded by:

```sql
if current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'service_role'
   and current_user <> 'postgres' then raise exception 'Access denied';
```

Measured in a rolled-back transaction on the live project:

| | |
| --- | --- |
| all 60 SECURITY DEFINER functions in `public` | owned by `postgres` |
| `current_user` outside a definer function | `service_role` |
| `current_user` **inside** it | **`postgres`** |

So `current_user <> 'postgres'` is always false inside such a function, the `and`
never holds, and **the exception can never fire**. The guard was decorative, and
the vault read would have succeeded for any caller holding EXECUTE — collapsing
two independent locks into one.

INVOKER inverts that. Measured through an INVOKER function reaching
`vault.decrypted_secrets`:

| caller | result |
| --- | --- |
| `service_role` | `ALLOWED` |
| `authenticated` | `DENIED 42501` |

Everything the wrapper needs is already within `service_role`'s own privileges:
`rd` on `vault.decrypted_secrets` (§2.3), `X` on `create_secret` / `update_secret`
— which are themselves DEFINER, owned by `supabase_admin` — and RLS bypass on
`public.integration_connections`.

Three consequences:

- **No private schema, no delegation layer.** One function, and the design loses
  a moving part rather than gaining one.
- **The vault ACL becomes a real second lock.** Under DEFINER it was bypassed
  entirely; under INVOKER it denies `authenticated` on its own, whatever the
  EXECUTE grants say.
- **Lints 0028 and 0029 do not apply.** Both are scoped to SECURITY DEFINER
  functions, so this wrapper adds no finding to either.

The RBAC helpers in §2.9 stay DEFINER for their own reasons; this rule applies to
vault wrappers only.

#### The documentation says the same thing, independently

Measurement and Supabase's own guidance agree, and the guidance is stronger than
the measurement:

> "It is best practice to use `security invoker` (which is also the default)."
> — Database Functions guide

> "A `security definer` function runs using the same role that _created_ the
> function." — RLS reference

> **"A `security definer` function in an exposed schema is callable over the Data
> API with the creator's privileges. Never create one in a schema listed under
> 'Exposed schemas' in your API settings."** — RLS reference, caution box

> "Default to `SECURITY INVOKER` … Use `SECURITY DEFINER` only when explicitly
> required and explain the rationale." — Supabase's own database-functions prompt

`public` is an exposed schema on this project (§2.1), so the DEFINER wrapper this
spec first proposed was not merely weaker — it was the case the documentation
names and forbids.

This also resolves the apparent conflict with Supabase's `edge.get_secret`
example, which guards on `current_user = 'postgres'`: that function declares only
`LANGUAGE plpgsql`, so it is INVOKER by default, and its `current_user` really is
the caller. The pattern was never DEFINER.

### 3.4 Permissions

New keys in `platform_permission_definitions`, following the existing catalogue:

| key | grants |
| --- | --- |
| `integrations.connections.read` | list connections and status (metadata only) |
| `integrations.connections.manage` | connect, reconnect, disconnect, verify |
| `integrations.credentials.use` | operational use by worker / workflow |

Reading metadata and using a credential are separate permissions.

### 3.5 What the UI may receive

The Server Action selects columns explicitly. Returned: `id`, `provider`,
`label`, `status`, `scopes`, `account_hint`, `expires_at`, `last_refresh_at`,
`last_error`, timestamps. Never returned: `vault_secret_id` or any token
material. The UUID is not itself a secret, but the UI has no use for it.

## 4. OAuth flow

```
1. startConnection(provider, scopes)            Server Action
   requirePlatformPermission('integrations.connections.manage')
   verifier  = randomPKCECodeVerifier()          unique per request
   challenge = calculatePKCECodeChallenge(verifier)
   state     = cryptographically random
   INSERT integration_oauth_states
     (state_hash = sha256(state), verifier, provider, redirect_to,
      requested_scopes, created_by, expires_at = now() + 10 min)
   redirect → authorize?…&code_challenge_method=S256&state=<raw>

2. GET /api/integrations/oauth/callback?code&state    Route Handler
   requirePlatformPermission('integrations.connections.manage')
   Zod-parse code / state / error
   if ?error → failure path, no exchange
   UPDATE integration_oauth_states SET consumed_at = now()
    WHERE state_hash = sha256(state) AND provider = $2
      AND consumed_at IS NULL AND expires_at > now()
   RETURNING code_verifier, redirect_to, requested_scopes, created_by
   zero rows → one generic 400
   created_by must equal the current user
   exchange code + verifier at the token endpoint
   vault.create_secret(json{access, refresh}, 'conn:<provider>:<id>', …) → uuid
   INSERT integration_connections (…, vault_secret_id, status = 'active')
   redirect → redirect_to taken from the row, never from the query
```

`redirect_to` from the stored row closes open-redirect before it exists. A zero-
row CAS covers replay, expiry, and provider mismatch with one generic message.

### 4.1 Variation the infrastructure must absorb without naming anyone

These are properties of OAuth2 deployments in general. Each is absorbed by the
schema or declared by a `ProviderDefinition` (§9.4) — none becomes a branch in
this layer, and none is named after a vendor.

- **Refresh-token rotation.** A provider may return a new `refresh_token` on every
  refresh and invalidate the previous one. Refresh therefore always writes back
  through `update_secret` on the same UUID, unconditionally; a refresh that does
  not persist the response kills the connection silently after the first use.
  Handled by the schema, so no adapter has to opt in.
- **Refresh tokens are not granted by default.** A provider may require extra
  authorization parameters before it issues one at all, and may require them
  again on re-authorization. These live in
  `ProviderDefinition.oauth.authorizationParams`, and `requested_scopes` records
  what was asked for so the operator can be told to reconnect rather than left
  with a connection that quietly stops refreshing.
- **Client authentication differs.** Some token endpoints want the secret in the
  body, others in the Authorization header. `clientAuth: 'post' | 'basic'`,
  defaulting to post.
- **Some providers publish discovery metadata and some do not.** `oauth.server`
  accepts a discovery URL or literal server metadata, so neither case is special.
- **RFC 9207 `iss`** is the authorization-response mix-up defence. Supplied by
  the protocol engine (§4.3), not by an adapter.
- **Disconnect must revoke**, not merely delete the row, or the token stays live
  at the provider. One code path, driven by `tokenRevocation`.

### 4.2 Two lessons already paid for in this repo

`src/lib/microsoft/graph-client.ts` documents both:

> "MSAL caches and refreshes tokens PER CREDENTIAL INSTANCE, and the SDK's
> middleware handles Graph's 429s with its own retry/backoff … A hand-rolled
> `fetch` wrapper would silently drop them."

Provider rate limiting is part of the flow, not an afterthought.

> "Read LAZILY, never at module scope. The worker loads .env.local from its own
> module body … the calendar sync failed silently in the worker every 10 minutes
> while working perfectly under `node --env-file=`."

The credential module reads environment variables inside functions, never at
module scope.

### 4.3 What `openid-client@6.8.8` settles, verified in the installed package

| need | supplied by | verified |
| --- | --- | --- |
| PKCE | `randomPKCECodeVerifier()`, `calculatePKCECodeChallenge()` | `build/index.d.ts:718,726` |
| state | `randomState()`, `checks.expectedState` | `:742`, `AuthorizationCodeGrantChecks` |
| code exchange | `authorizationCodeGrant(config, currentUrl \| Request, checks)` | `:1910` |
| refresh | `refreshTokenGrant(config, refreshToken, parameters)` | `:1953` |
| revocation | `tokenRevocation(config, token, { token_type_hint })` | `:2360` |
| **authorized call** | `fetchProtectedResource(config, accessToken, url, method, body, headers)` | `:2375` |
| RFC 9207 `iss` | checked against `authorization_response_iss_parameter_supported` | present in `build/index.js` |

Two consequences for the design above:

**`providerFetch` wraps `fetchProtectedResource` rather than attaching headers
itself.** §3.2 stands unchanged as a contract; only its body is now library code.

**Non-OIDC providers need no discovery.** `new Configuration(serverMetadata,
clientId, clientSecret, clientAuth)` accepts hand-written server metadata
(`:1137`), so a plain-OAuth2 provider is configured as a literal. Client authentication is
declared per provider and **never** left to the library's default, because that
default is conditional: *"The default is `ClientSecretPost` if
`ClientMetadata.client_secret` is present, `None` otherwise."* A provider whose
secret went missing would silently downgrade to public-client authentication
instead of failing, so `clientAuth` is required and carries three values —
`None()` sends `client_id` as a form parameter and no secret, which is correct
for a public client and not an escape hatch.

`config[customFetch]` is the documented hook for wrapping the transport — this
is where provider rate limiting and retry belong, answering the `graph-client.ts`
lesson in §4.2 without a hand-rolled wrapper.


### 4.4 Read from the library's own docs, examples and build

The reference example (`examples/oauth.ts`) and the built source settle four
things the API reference alone does not.

**`redirect_uri` is sent at the token endpoint, and we do not choose it directly.**
`oauth4webapi` sets it unconditionally:

```js
const parameters = new URLSearchParams(options?.additionalParameters);
parameters.set('redirect_uri', redirectUri);
parameters.set('code', code);
```

and `openid-client` derives that value as `stripParams(currentUrl)` —
`AuthorizationCodeGrantOptions` is an empty interface, so there is no public
override. **The `currentUrl` we pass becomes the `redirect_uri` the provider
checks.**

⚠️ **Therefore the callback must never hand the raw `Request` to
`authorizationCodeGrant`.** This app runs behind an nginx proxy, so the incoming
request URL is not the public origin, and a mismatch against the pre-registered
URI fails the exchange with `invalid_grant` — at the provider, where the message
is unhelpful. Build it instead:

```ts
const currentUrl = new URL(`${getAppOrigin()}/api/integrations/oauth/callback${search}`);
```

`src/lib/url.ts` is already the single trusted source for this and says why:
*"We deliberately do NOT derive the origin from the incoming Host /
X-Forwarded-Host header: those are attacker-controllable."* The OAuth flow gets
the same treatment for a second, independent reason.

**PKCE always; state always, for our own reasons.** The example adds `state`
only when `!config.serverMetadata().supportsPKCE()`, and notes *"Use of PKCE is
backwards compatible even if the AS doesn't support it which is why we're using
it regardless."* We send `state` unconditionally, because it is the key of the
`integration_oauth_states` row and therefore the basis of single-use consumption
and of the audit trail — neither of which PKCE provides. `expectedState` is
consequently always passed; leaving it `undefined` would assert that no state
comes back.

**Token response.** `access_token` is the only guaranteed field;
`refresh_token`, `expires_in`, `scope` and `id_token` are optional.
`expiresIn()` returns seconds remaining or `undefined` when the provider sent no
`expires_in`, so `expires_at` is null in that case rather than invented.

**`fetchProtectedResource(config, access_token, url, method)`** is the call the
accessor wraps, exactly as the example ends.


### 4.5 Grant types beyond authorization-code, and the bundling check

The library's README lists grants this design had quietly assumed away.

**`clientCredentialsGrant(config, { scope, resource })` is a second path, and it
skips most of this document.** A provider that authenticates as the application
rather than on behalf of a person needs no redirect, no PKCE, no `state`, and
therefore **no `integration_oauth_states` row at all**. It goes straight to a
Vault secret and a connection row.

That is a generalization the flow in §4 was missing, and it changes
`credential_kind` from a label into a discriminator:

| `credential_kind` | authorization | `integration_oauth_states` | refresh |
| --- | --- | --- | --- |
| `oauth2` | redirect + callback | yes | `refreshTokenGrant` |
| `oauth2_client_credentials` | none — server to server | **no** | re-issue via `clientCredentialsGrant` |
| `api_key` / `basic` | none — operator pastes it | no | none |

`startConnection` therefore branches once, on `credential_kind`, and only the
`oauth2` arm touches the states table. Nothing else in the design moves.

**Two further grants exist and are deliberately unbuilt:** Device Authorization
(`initiateDeviceAuthorization` / `pollDeviceAuthorizationGrant`) and CIBA. Both
are polling flows with no redirect. They are out of scope now, and the point of
recording them is that `ProviderDefinition` must not encode "authorization means
a redirect" as an assumption — which is why `oauth` is an optional block rather
than a required one.

**ESM-only, and the worker bundles to CJS.** `openid-client` is
`"type": "module"` with a Node 20 baseline. `worker:build` runs
`esbuild --bundle --platform=node --format=cjs --target=node24`, and this repo
has been bitten before by a dependency that does not survive that conversion
(`worker.cjs` and `import.meta.url`). Measured with the worker's exact flags:

```
probe.cjs  9.1kb
verifier len: 43 | state len: 43 | challenge len: 43
Configuration built: https://example.invalid
CJS BUNDLE OK
```

PKCE, state and `new Configuration(literal metadata, …)` all work after
conversion, so the refresh cycle may run in the worker. The same probe also
confirms a provider with no discovery document needs nothing more than `issuer`
and `token_endpoint`.

## 5. Enforcement

No import-boundary linting exists in this repo. The established mechanism is a
`fast-glob` tree-scanning vitest test that asserts an architectural invariant and
names the fix in its failure message (`next-route-exports.test.ts`,
`admin-data-layer-coverage.test.ts`).

A new test asserts that `integrations_read_credential`, `integrations_write_credential`,
and the string `vault.` appear nowhere under `src/` except
`src/lib/integrations/credentials.ts`.

## 6. Open items

- ~~Client secret storage.~~ **Resolved 2026-09-16:** Vault, under a fixed name
  per provider (`oauth_app:<provider>`). The unique name index in §2.4 makes one
  record per provider a database guarantee, and §2.6 proves rotation keeps the
  UUID, so a client-secret rotation needs no deploy and no schema change.
- ~~OAuth library vs hand-rolled.~~ **Resolved 2026-09-16:** `openid-client`
  `^6.8.8` is now a direct dependency. See §4.3.
- ~~Round-trip proof.~~ **Resolved 2026-09-16:** executed and recorded in §2.6.
  Vault verified back to 0 rows afterwards.

## 7. Verification

- Lint 0011 / 0028 / 0029 report no new findings after the migration.
- Round-trip test proves create → read → rotate → revoke through the wrapper.
- A test asserts `authenticated` receives 42501 from the wrapper, and
  `service_role` succeeds — the pair measured in §3.3, re-run against the real
  function.
- A test asserts a mismatched provider or a consumed state yields the generic
  failure, not a distinguishable error.
- The boundary test above.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## 8. Rejected alternative: the credential columns already in the database

`public.exchange_connections` carries `credential_ciphertext`, `credential_iv`,
`credential_auth_tag` and `encryption_key_version`, so it reads at a glance like
this subsystem already built. Measured before reusing it: **zero** occurrences of
`createCipheriv` / `createDecipheriv` in live code, `resolveMailboxPassword()`
returns `''`, the DAL writes `credential_ciphertext: null` outright, and the key
name survives only in a history comment. The encryption is retired and the
columns are a shell — there is nothing to reuse, and that table is not a model
for this one.

Two things from it do carry over, and neither is provider-shaped:

**The app-managed-key failure mode, recorded here rather than argued.** From
`src/lib/exchange-ews/mailbox-credential.ts`: *"rotating that key would have taken
scheduling down for a reason with no relationship to the cause."* One key, every
consumer coupled to one rotation event. Vault's key is not ours to rotate, and
§2.6 proved a rotation keeps the secret's UUID. What Vault substitutes is §2.7 —
a key to carry across a project migration, an operational step rather than a
coupling.

**The DAL shape**, in `src/lib/data/exchange-connections.ts`: closed table with
"RLS is NOT a backstop here" stated in the file, `requirePlatformPermission` as
the gate with `requireUser()` for identity only, `PUBLIC_COLUMNS` kept separate
from `CREDENTIAL_COLUMNS`, and *"never accept a user id as a parameter from a
caller; always take it from the verified session."*
`src/lib/integrations/credentials.ts` follows that file's shape.

Dropping the dead columns is a separate change with its own migration and
approval. This design does not touch that table.

## 9. The four infrastructure components

This layer knows nothing about any provider. Google, Microsoft, Slack, Notion,
Meta, an SMS gateway, a CRM, a bespoke API — all are future *consumers*, and none
of them may appear in a table, a column, a function signature, or an enum here.

```
Workflow Node
     ↓
Integration / Provider Adapter        ← per-provider, out of scope for this stage
     ↓
KALFA Credential Accessor             ← 4
     ↓
public.integration_connections        ← 1
     ↓
Supabase Vault                        ← 3
```

```
startConnection(provider)
     ↓
public.integration_oauth_states       ← 2
     ↓
OAuth provider
     ↓
one generic callback
     ↓
openid-client (protocol engine, not an integration)
     ↓
Vault + integration_connections
```

### 9.1 Grants, derived from the operations rather than assumed

`anon` and `authenticated` receive table grants **automatically** on anything
created in `public`. Measured:

```
public.guests                 postgres  anon=adDxtm  authenticated=arwdDxtm  service_role
public.exchange_connections   postgres                                       service_role
```

RLS does not remove a GRANT. A closed table needs both — RLS enabled *and* the
default grants revoked — which is why the second row is short.

Nothing below is granted because a role "is the server". Each privilege is
derived from an operation that exists in §9.2 or §4, and anything not derived is
not granted.

#### `integration_oauth_states`

| operation | statement | privilege it forces |
| --- | --- | --- |
| `startConnection` | `insert into … values (…)` | `INSERT` |
| callback CAS | `update … set consumed_at = now() where state_hash, provider, created_by, consumed_at, expires_at … returning provider, code_verifier, redirect_to, requested_scopes, created_by` | `UPDATE (consumed_at)` + `SELECT` |
| cleanup job | `delete from … where expires_at < …` | `DELETE` |

The `SELECT` is not optional and not a guess — PostgreSQL states both halves:

> "You must also have the `SELECT` privilege on any column whose values are read
> in the _expressions_ or _condition_." — `SQL UPDATE`

> "Use of the `RETURNING` clause requires `SELECT` privilege on all columns
> mentioned in `RETURNING`." — `SQL INSERT`

So the CAS stays exactly as written. Splitting it into two statements to dodge a
privilege would trade an atomicity guarantee for nothing; the privilege is simply
granted, on the server path only.

```sql
grant select, insert, delete on public.integration_oauth_states to service_role;
grant update (consumed_at)   on public.integration_oauth_states to service_role;
```

Column-level `UPDATE` is the tightening the derivation exposes: consuming a state
is the only update that exists, so `code_verifier` and `expires_at` become
un-rewritable after insert. A bug that tried to extend a state's life or swap its
verifier fails at the database instead of succeeding quietly.

#### `integration_connections`

| operation | privilege it forces |
| --- | --- |
| callback writes a new connection | `INSERT` |
| accessor resolves provider + capability | `SELECT` |
| accessor records a refresh | `UPDATE (expires_at, last_refresh_at, status, last_error, updated_at)` |
| disconnect marks revoked and drops the secret link | `UPDATE (status, vault_secret_id, updated_at)` |
| management UI lists connections | `SELECT` |

```sql
grant select, insert on public.integration_connections to service_role;
grant update (status, vault_secret_id, expires_at, last_refresh_at,
              last_error, metadata, updated_at)
  on public.integration_connections to service_role;
```

**No `DELETE`.** Disconnect is a soft revoke — `status = 'revoked'`,
`vault_secret_id = null`, and the Vault secret deleted — so the row survives as
an audit record and no code path needs to remove one. A privilege with no
operation behind it is not granted.

The column list also makes `provider`, `credential_kind`, `scopes`, `created_by`
and `created_at` **immutable after insert**, enforced by the grant rather than by
convention. A connection cannot silently become a connection to something else.

#### The other two roles, and the owner

| object | anon | authenticated |
| --- | --- | --- |
| both tables | `revoke all` | `revoke all` |
| both accessor functions | `revoke execute` (incl. from `PUBLIC`) | `revoke execute` |
| `vault.*` | none — measured, §2.3 | none — measured, §2.3 |

`postgres` receives **no grant at all**: it owns these objects, owner rights are
implicit, and §2.2 established that no application path runs as `postgres`. It
appears in this section only because ownership decides what a
`SECURITY DEFINER` function would have run as — which is why §3.3 chose
`SECURITY INVOKER` instead.

Because the accessor functions are `SECURITY INVOKER`, `EXECUTE` is necessary but
not sufficient: the caller also needs privileges on everything the body touches.
`service_role` has exactly the list above and `rd` on `vault.decrypted_secrets`.
`authenticated` fails at the vault read with 42501 even if `EXECUTE` were granted
by mistake — measured in §3.3, and two independent locks rather than one.

### 9.2 Transaction boundaries

**Creating a connection is one transaction, inside one RPC.** A secret in Vault
and a row in `integration_connections` must not be able to exist without each
other: a secret with no row is unreachable garbage, a row with no secret is a
connection that fails at first use.

```
integrations_write_credential(provider, credential_kind, scopes, metadata, secret)
  ├─ vault.create_secret(secret, 'conn:' || <generated id>, …)  → uuid
  ├─ insert into public.integration_connections (…, vault_secret_id = uuid)
  └─ return connection id
```

PostgREST runs each RPC in its own transaction, so either both land or neither
does. No compensation logic, no orphan sweeper.

**Rotation is likewise one transaction:** `vault.update_secret(same uuid, …)`
plus the row's `expires_at` / `last_refresh_at`, in one function. §2.6 proved the
UUID survives an update, which is what makes this a single write rather than a
delete-and-recreate.

**The OAuth state CAS is a single statement:**

```sql
update public.integration_oauth_states
   set consumed_at = now()
 where state_hash = $1 and provider = $2
   and consumed_at is null and expires_at > now()
returning code_verifier, redirect_to, requested_scopes, created_by;
```

Zero rows means replay, expiry, or provider mismatch — indistinguishable to the
caller by design.

**The one boundary that cannot be a transaction** is the token exchange, which is
a network call sitting between the CAS and the write:

```
T1  consume state (atomic)
──  exchange code at the provider (network, no transaction)
T2  write secret + connection (atomic)
```

If T2 fails, the state is consumed and the authorization code is spent. That is
correct rather than unfortunate — codes are single-use at the provider too, so
the only safe recovery is a fresh authorization. The failure is recorded and the
operator reconnects; nothing is left half-written, because T2 is all-or-nothing.

### 9.3 Generic schema — no provider may be named in it

```
public.integration_connections
  id                uuid pk
  provider          text            -- free identifier, no enum, no check list
  credential_kind   text            -- 'oauth2' | 'api_key' | 'basic' | …
  label             text            -- operator-facing name for this connection
  status            text            -- 'pending' | 'active' | 'expired' | 'revoked' | 'failed'
  scopes            text[]
  vault_secret_id   uuid            -- the only link to secret material
  expires_at        timestamptz
  last_refresh_at   timestamptz
  last_error        text
  metadata          jsonb           -- adapter-defined, opaque here
  created_by        uuid
  created_at / updated_at

public.integration_oauth_states
  id                uuid pk
  state_hash        text            -- sha256 of the state sent to the provider
  provider          text
  code_verifier     text            -- PKCE, temporary, short TTL
  redirect_to       text
  requested_scopes  text[]
  created_by        uuid
  created_at / expires_at / consumed_at
```

`provider` is deliberately `text` and not an enum: adding a provider must be a
registry entry in application code, never a migration. `metadata` is `jsonb` for
the same reason — whatever one provider needs and another does not lives there,
and this layer never reads inside it.

Nothing named after a vendor appears above. A column called
`microsoft_refresh_token` or `google_client_secret` would be a design failure,
not a convenience.

### 9.4 How a new provider attaches — interface only

A provider is a record in a registry plus an adapter. No schema change, no
migration, no new table.

```ts
// src/lib/integrations/provider.ts — the contract, no implementations
export type ProviderId = string;

export type ProviderDefinition = {
  id: ProviderId;
  credentialKind: 'oauth2' | 'api_key' | 'basic';

  /** OAuth2 providers only. Shaped for openid-client's Configuration. */
  oauth?: {
    /** Discovery URL, or literal server metadata when the provider has none. */
    server: URL | ServerMetadata;
    clientAuth?: 'post' | 'basic';
    /** Extra authorization params — where offline-access style flags live. */
    authorizationParams?: Record<string, string>;
    /** Capability → scope strings. The accessor resolves by capability. */
    capabilities: Record<string, string[]>;
  };

  /** Where a capability's requests go. Keeps URLs out of node handlers. */
  endpoint(capability: string, input: unknown): { url: string; init?: RequestInit };

  /** Optional: label a fresh connection from the provider's own account data. */
  describeAccount?(response: Response): Promise<{ label: string; metadata?: unknown }>;
};

export function registerProvider(def: ProviderDefinition): void;
```

Adding a provider is then:

1. write a `ProviderDefinition`,
2. `registerProvider(...)`,
3. store its client credentials through the same write path every connection uses.

The accessor, the tables, the RPCs, the callback route, and the refresh cycle are
untouched. That is the test of whether this layer is generic: if adding the
second provider requires editing any of them, it is not.

### 9.5 Explicitly out of scope at this stage

No provider implementation, no vendor SDK, no client credentials, no
provider-specific columns or enums. `openid-client` is the protocol engine behind
the adapters and is not itself an integration.

### 9.6 `credential_kind` is a discriminator for two questions, not four

An earlier draft had `credential_kind` answering everything about a connection's
lifecycle. Measured against the specs, two of those four answers belong
elsewhere, and keeping them here would have made the column rigid in exactly the
way a generic layer cannot afford.

| question | answered by | why not `credential_kind` |
| --- | --- | --- |
| does authorization redirect a person? | **`credential_kind`** | fixed by the grant type |
| what is the renewal *mechanism*? | **`credential_kind`** | fixed by the grant type |
| does **this** connection have a refresh token? | **the stored secret** | issuing one is optional (RFC 6749); two connections of the same kind differ |
| can this provider revoke? | **`serverMetadata().revocation_endpoint`** | a provider capability; two providers of the same kind differ |

A fifth axis, presentation, is separate again and lives on the adapter (§9.4).

#### Disconnect, derived from RFC 7009 rather than from a habit

RFC 7009, quoted:

> "Implementations MUST support the revocation of refresh tokens and SHOULD
> support the revocation of access tokens."

> "If the particular token is a refresh token and the authorization server
> supports the revocation of access tokens, then the authorization server SHOULD
> also invalidate all access tokens based on the same authorization grant."

> "If the token passed to the request is an access token, the server MAY revoke
> the respective refresh token as well."

The asymmetry is the whole design. Revoking the refresh token is the branch the
standard requires servers to implement AND the one that cascades; the reverse
direction is optional in both respects. So there is no reason for a blanket
"always revoke both":

```
disconnect(connection)
  ├─ no revocation_endpoint          → no remote revocation
  └─ revocation_endpoint present
       ├─ refresh_token exists       → revoke(refresh_token, hint=refresh_token)
       └─ else access_token exists   → revoke(access_token,  hint=access_token)
  ↓
  local cleanup — always, regardless of the outcome above
```

`token_type_hint` matches whichever token is sent, and nothing more is read into
it. RFC 7009 again:

> "Clients MAY pass this parameter in order to help the authorization server to
> optimize the token lookup. If the server is unable to locate the token using
> the given hint, it MUST extend its search across all of its supported token
> types."

It is an optimisation the server may ignore, not a protocol decision worth a
branch.

Two corrections to earlier drafts of this document:

- *"even a successful call does not guarantee revocation"* was imprecise. RFC
  7009: **"The invalidation takes place immediately, and the token cannot be used
  again after the revocation."** What is not uniform is the effect on *related*
  tokens, and that there "could be a propagation delay" between servers.
- A `200` response proves nothing about whether the token was valid: the spec
  returns 200 **"if the token has been revoked successfully or if the client
  submitted an invalid token"**, deliberately. Local cleanup therefore never
  waits on the response to decide.

#### Renewal, and why "no refresh token" is not "expired"

```
oauth2_authorization_code
  refresh_token present  → refreshTokenGrant()
  refresh_token absent   → requires_reauthorization
oauth2_client_credentials
  always                 → clientCredentialsGrant() again
static
  never                  → no automatic renewal
```

`requires_reauthorization` is a statement about **authorization**, not about
expiry, and the two are independent: a connection that can never renew may still
hold a perfectly valid access token right now. Marking it `expired` at the moment
renewal became impossible would under-report what still works and over-report
urgency.

RFC 6749 makes issuing a refresh token optional, and requires the client to
replace a stored one whenever a refresh returns a new value. RFC 9700 treats the
no-refresh-token case as normal, to be resolved by obtaining a new access token
through an appropriate grant. So the absence is a supported state, and the status
set says so:

| status | meaning |
| --- | --- |
| `expired` | access token stale, renewal will be retried — self-healing |
| `requires_reauthorization` | renewal impossible without a person; access may still work |
