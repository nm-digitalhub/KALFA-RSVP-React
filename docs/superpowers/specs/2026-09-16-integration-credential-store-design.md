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

### 2.7 Lint bar for new objects

| lint | existing findings | requirement |
| --- | --- | --- |
| 0011 `function_search_path_mutable` | 9 | every new function sets `search_path = ''` |
| 0028 / 0029 SECURITY DEFINER executable | 1 / 26 | **not applicable** — the wrapper is SECURITY INVOKER (§3.3) |
| 0008 `rls_enabled_no_policy` | 14 (INFO) | acceptable shape for server-only tables |

### 2.8 Platform RBAC is the authority, and its helpers must stay open

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

The RBAC helpers in §2.8 stay DEFINER for their own reasons; this rule applies to
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

### 4.1 Provider behaviours the schema must survive

- **Refresh-token rotation.** Many providers return a new `refresh_token` on
  every refresh and invalidate the old one. Refresh therefore always writes back
  via `update_secret` on the same UUID; failing to persist kills the connection
  silently after the first refresh.
- **No `offline_access` / `access_type=offline` means no refresh token at all**,
  and some providers additionally require `prompt=consent` to re-issue one on a
  repeat authorization. `requested_scopes` records what was asked for so the UI
  can tell the operator to reconnect.
- **RFC 9207 `iss`** in the authorization response is the mix-up defence; a
  hand-rolled implementation typically omits it.
- **Disconnect must revoke**, not merely delete our row, or the token stays live
  at the provider.

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
(`:1137`), so a plain-OAuth2 provider is configured as a literal. Client
authentication defaults to `ClientSecretPost`; providers requiring
`ClientSecretBasic` select it per provider, so the provider record carries the
method rather than assuming one.

`config[customFetch]` is the documented hook for wrapping the transport — this
is where provider rate limiting and retry belong, answering the `graph-client.ts`
lesson in §4.2 without a hand-rolled wrapper.

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
