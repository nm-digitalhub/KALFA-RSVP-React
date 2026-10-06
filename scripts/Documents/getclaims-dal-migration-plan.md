# Plan — Adopt `getClaims()` in the auth DAL (tiered)

Status: **AWAITING APPROVAL TO IMPLEMENT**. Read-only analysis complete; no code changed.
Date: 2026-06-30. Scope: `beta/` only.
Verification: all findings independently re-verified 2026-06-30 against live code, `node_modules`
(auth-js 2.108.2 types/impl), `tsconfig`, and the live JWKS endpoint (empirically `alg:ES256`,
`kty:EC`, P-256). `JwtPayload.sub:string` (required, `RequiredClaims`), `JwtPayload.email?:string`;
`User.email?:string`; shell `userEmail: string | undefined` — confirming `email?: string` (not
`string | null`) is the correct `AuthIdentity` shape. Auth is email/password only (no phone/OTP login).

## Objective
Remove one Supabase Auth-server round-trip per authenticated request on the page-render
path by reading the verified identity from the access-token **claims** (local WebCrypto
verification on ES256) instead of `getUser()` (network), while keeping authoritative
revocation-aware `getUser()` on sensitive value/permission mutations.

## Verified facts (installed code + live docs)
- Installed: `@supabase/supabase-js` 2.108.2, `@supabase/ssr` 0.12.0, `@supabase/auth-js` 2.108.2.
- `getClaims()` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:5172-5241`): asymmetric
  keys → local `crypto.subtle.verify` (no round-trip); symmetric/no-WebCrypto → falls back to
  `getUser()`. JWKS cached module-global, 10 min (`constants.js:38`). Returns the **decoded JWT
  payload** as claims; returns `{data:null,error}` for the no-session case (`:5176-5178`).
- `getUser()` (`:2591-2649`): always a network call when a token is present; verifies against the
  Auth server (reflects sign-out / session revocation). On `AuthSessionMissingError` → `_removeSession()`.
- Production project uses **ES256 (asymmetric)** signing keys → `getClaims()` takes the local fast path.
- End-user auth is **email/password only** (`src/app/auth/actions.ts:24` `signInWithPassword`,
  `auth/callback/route.ts` `exchangeCodeForSession`). No phone/OTP login. Per live docs
  (supabase.com/docs/guides/auth/jwt-fields) `email`/`phone` are required JWT claims →
  `claims.email === getUser().email` for every user here. **No email degradation.**
- `tsconfig.json`: `strict: true`, `exactOptionalPropertyTypes` **NOT set** → optional `email?: string`
  with an `undefined` value is accepted.
- DAL helper consumers read **only `.id` and `.email`** (grep-verified). Nothing downstream reads
  `.app_metadata`/`.user_metadata`/`.identities`/`.created_at`/`.phone`.

## Security model
Claims are cryptographically signed by Supabase and verified locally — this is server-side,
non-spoofable authorization (satisfies CLAUDE.md). The ONLY delta vs `getUser()` is that Tier A
does not detect session revocation/sign-out until the JWT expires (default **1h**).
**Critical:** `proxy.ts` runs a revocation-aware `getUser()` but only for
`PROTECTED_PREFIXES = ['/app','/admin']` — it does **NOT** cover `/api/*`. So for `/api` money
routes, Tier B's `getUser()` round-trip is the only revocation check, not belt-and-suspenders.

## Design

### Tier A — fast, claims-based (authorization + scoping + page reads)
Edit only `src/lib/auth/dal.ts`:
```ts
export type AuthIdentity = { id: string; email?: string };  // mirror User.email (string | undefined)

export const getUser = cache(async (): Promise<AuthIdentity | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? { id: data.claims.sub, email: data.claims.email } : null; // gate on data?.claims
});
```
- `email?: string` (NOT `string | null`) and `email: claims.email` (NO `?? null`) — required so
  `tsc --noEmit` passes with **zero** consumer/mock edits (empirically reproduced: `string|null`
  breaks ~11 mock files + 2 shells; `email?: string` → 0 errors).
- `requireUser`, `isAdmin`, `requireAdmin`, `getOrgContext`, `requireActiveOrg` keep their bodies
  (they consume only `.id`) and inherit the fast source.
- `has_role` RPC stays (authoritative, DB-side).

### Tier B — authoritative, revocation-aware (sensitive mutations) — MAXIMAL scope (approved)
Add to `dal.ts`:
```ts
export const requireFreshUser = cache(async (): Promise<AuthIdentity> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');
  return { id: user.id, email: user.email };
});
```
Apply `requireFreshUser()` (replacing the current `requireUser()`/`requireAdmin()` *identity* call —
keep the `has_role`/permission check where present) at:
1. `src/app/api/campaigns/[id]/authorize/route.ts:80` (money, /api)
2. `src/app/api/orders/[id]/pay/route.ts:60` (money, /api)
3. `src/app/api/campaigns/[id]/close-charge/route.ts:53` (money, /api)
4. `src/app/api/admin/orders/[id]/reconcile/route.ts:107` (money, /api) — **the gap found in review**
5. `src/lib/data/admin/users.ts` — `grantBillingCredit` (:323), `updateOrderPackage` (:367),
   `setUserSuspended` (:291), `setPlatformAdmin` (:253)
6. `src/lib/data/agreements.ts` `recordSignedAgreement` (fn declared `:56`; swap the
   `requireUser()` identity call at `:59`) — billing-authorizing signature

For the `requireAdmin`-gated admin items (#4, #5), keep the `has_role` admin check; swap only the
identity source to `requireFreshUser` so the round-trip restores revocation-awareness.

### proxy.ts — unchanged (stays on `getUser()`; drives cookie refresh).

## Risks & mitigations
- `claims.email`/`claims.sub` typing off the claims object — verify the auth-js claims type exposes
  `sub: string` and `email?: string`; cast/narrow minimally if needed (no `any`).
- Test mocks (`mockUser()`/`adminUser()` typed as `User`) must stay assignable to `AuthIdentity`
  with `email?: string` — confirmed by repro; re-verify in full `tsc`.
- Non-prod projects on HS256 → `getClaims()` silently round-trips (correct, no perf win). Detect via
  `header.alg` / dashboard signing-key type.

## Verification (Definition of Done)
1. `npm run lint`, `npx tsc --noEmit`, `npm run build --webpack`.
2. Targeted tests first: `dal`, `events`, `orders`, `campaigns`, `user-settings`, `profiles`,
   `admin/users`; then full suite.
3. New `dal.test.ts`: `getUser` reads `claims.sub`/`claims.email`, returns null for the no-session
   (`{data:null}`) and error arms; `requireFreshUser` redirects when no user.
4. Runtime gate (per project memory — lint/tsc/vitest miss client/server-boundary issues):
   authed browser pass over `/app` + `/admin` + one `/api` money call, console clean, identity loads.

## Rollback
Additive + concentrated in `dal.ts`. Rollback = restore `getUser` body to `supabase.auth.getUser()`
and revert the Tier-B call swaps. No DB/schema change.
