# Integration Credential Store + OAuth2 — Design

Date: 2026-09-16
Status: design approved, implementation not started
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

There is therefore **one** credential access path, not two. The
`current_user = 'postgres'` branch in the role guard has no consumer today; it
is kept as a fallback for future raw-pg access and is documented as not
load-bearing.

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

### 2.4 `vault.secrets.name` is unique

```sql
CREATE UNIQUE INDEX secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL
```

One secret per name is enforced by the database. Rotation must use
`update_secret(id, …)`; a second `create_secret` with the same name fails 23505.

### 2.5 `pgsodium` is not installed

Only `supabase_vault` 0.3.1. Vault 0.3.x encrypts without pgsodium key
management, so the `new_key_id` argument is vestigial and is passed `null`.

### 2.6 Lint bar for new objects

| lint | existing findings | requirement |
| --- | --- | --- |
| 0011 `function_search_path_mutable` | 9 | every new function sets `search_path = ''` |
| 0028 / 0029 SECURITY DEFINER executable | 1 / 26 | vault wrappers revoke from `public`, `anon`, `authenticated` |
| 0008 `rls_enabled_no_policy` | 14 (INFO) | acceptable shape for server-only tables |

### 2.7 Platform RBAC is the authority, and its helpers must stay open

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
workflow node ─┘   (service_role JWT)              │ role guard
                                                   ↓
                                    integrations_private.*   (unexposed schema)
                                                   ↓
                                    vault.create_secret / decrypted_secrets
```

Four independent locks, none sufficient alone: no vault grant for browser roles;
explicit revoke on the wrapper; role check inside the function body; empty
`search_path`.

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

### 3.3 Wrapper shape

Action-scoped, never a free-form "give me the secret named N":

```sql
create schema integrations_private;
revoke all on schema integrations_private from public, anon, authenticated;

create function integrations_private.read_credential(…) returns text
  language plpgsql security definer set search_path = '' as $$ … $$;

create function public.integrations_read_credential(
  p_connection_id uuid, p_expected_provider text, p_expected_kind text
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'service_role'
     and current_user <> 'postgres' then
    raise exception 'Access denied';
  end if;
  return integrations_private.read_credential(…);
end $$;

revoke execute on function public.integrations_read_credential(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.integrations_read_credential(uuid, text, text)
  to service_role;
```

The wrapper returns NULL unless provider, kind, and `status = 'active'` all
match, so a guessed id yields nothing.

`revoke … from public` is required in addition to `anon` and `authenticated`:
revoking from `anon` does not remove `PUBLIC`'s default `EXECUTE`.

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

## 5. Enforcement

No import-boundary linting exists in this repo. The established mechanism is a
`fast-glob` tree-scanning vitest test that asserts an architectural invariant and
names the fix in its failure message (`next-route-exports.test.ts`,
`admin-data-layer-coverage.test.ts`).

A new test asserts that `integrations_read_credential`, `integrations_write_credential`,
and the string `vault.` appear nowhere under `src/` except
`src/lib/integrations/credentials.ts`.

## 6. Open items

- **Client secret storage.** `client_id` / `client_secret` are platform
  configuration, one per provider, existing before any connection. Recommended:
  Vault under a fixed name per provider, giving rotation without a deploy and
  reusing the proven browser lockout. Not yet decided.
- **OAuth library vs hand-rolled.** `openid-client` v6 supplies PKCE, state
  validation, RFC 9207, refresh, and revocation. `@azure/msal-node` is already a
  dependency but serves a different grant (`ClientCertificateCredential`, app-as-
  itself) and does not cover this flow. Not yet decided.
- **Round-trip proof.** `create_secret` → `decrypted_secrets` → `update_secret`
  has not been executed against the live project; Vault currently holds zero
  secrets. Required before implementation.

## 7. Verification

- Lint 0011 / 0028 / 0029 report no new findings after the migration.
- Round-trip test proves create → read → rotate → revoke through the wrapper.
- A test asserts `authenticated` receives permission-denied from the wrapper.
- A test asserts a mismatched provider or a consumed state yields the generic
  failure, not a distinguishable error.
- The boundary test above.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.
