# KALFA Authorization Architecture — Reference & Roadmap (2026-07-13)

Built from **unbiased external research** (two web-researched blueprints, cited) reconciled against
KALFA's live state. Goal: a professional, end-to-end authorization layer covering every scenario.

## Research basis (subagent blueprints, primary sources)
- **General blueprint** — Supabase RLS/roles/SECURITY DEFINER + Next.js DAL/Server-Actions/middleware.
- **B2C blueprint** — Owner/Staff/Customer separation, whether an org layer is needed for pure B2C,
  staff support-access, admin-dashboard lockout, custom-claims anti-forgery.

Key cited sources: Supabase [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[RLS performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv),
[Custom Claims & RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac),
[Database Functions](https://supabase.com/docs/guides/database/functions),
[Securing your API](https://supabase.com/docs/guides/api/securing-your-api);
Next.js [Data Security](https://nextjs.org/docs/app/guides/data-security),
[Authentication](https://nextjs.org/docs/app/guides/authentication),
[security blog](https://nextjs.org/blog/security-nextjs-server-components-actions);
**CVE-2025-29927** (Next.js middleware auth-bypass, [ProjectDiscovery](https://projectdiscovery.io/blog/nextjs-middleware-authorization-bypass));
Makerkit RLS; pgAudit.

## Canonical rules (the standard we hold KALFA to)
1. **Two layers, different questions.** RLS is the last line for anything the browser touches directly
   (anon/authenticated key). The **server DAL** (`requireUser`/`requireOwnedEvent`/`requireAdmin`) is the
   source of truth for every `service_role` path (service_role bypasses RLS — the app gate is the ONLY gate).
2. **Always specify `TO`.** Never `TO public` on a privileged policy — anon evaluates it, and the burden
   falls entirely on fragile body logic. Use `TO authenticated` (+ body role/permission check).
3. **`(select auth.uid())` init-plan wrap** — evaluate row-independent auth once per statement, not per row.
4. **SECURITY DEFINER helpers are load-bearing.** A policy that calls one requires the *calling* role to
   hold EXECUTE. NEVER blanket-revoke EXECUTE from a role a live policy runs as → "permission denied for
   function". To restrict, scope the policy's `TO`, don't revoke the function.
5. **Live SECURITY DEFINER role check > JWT claim** for staff/owner gating (JWT claims go stale until refresh;
   a fired employee must lose access on the next request). NEVER trust `user_metadata` (user-writable).
6. **Server Actions & Route Handlers self-authorize.** A page/middleware check does NOT protect an action —
   every action re-checks. Middleware is UX only (CVE-2025-29927 proved full bypass is possible).
7. **Money/billing = platform-staff only, never a customer code path.**

## Reconciliation — KALFA vs the standard

| Rule | KALFA state |
|---|---|
| Live SECURITY DEFINER role check (not JWT/user_metadata) | ✅ `has_role()` live check — matches the recommended pattern |
| Server DAL as source of truth for service_role paths | ✅ `requireUser`/`requireEventAccess`/`requireOwnedEvent`/`requireAdmin` |
| `(select auth.uid())` init-plan | ✅ GAP-1 (migration `20260713143941`, 55 policies) |
| SECURITY DEFINER `SET search_path` | ✅ all 24 have it (migration `20260713141127`) |
| No blanket EXECUTE revoke on load-bearing fns | ✅ fixed by scoping (see below) |
| Never `TO public` on privileged policies | ✅ **fixed 2026-07-13** — 42 policies → `TO authenticated` (migration `20260713162623`) |
| Money/billing restricted to admin | ✅ campaign wind-down (close/pause/settle/cancel) gated to `requireAdmin` (committed, pending deploy) |
| Admin dashboard blocked for customers | ✅ `/admin` under `requireAdmin()` layout + per-action checks |
| Owner vs Staff tiers | 🟡 single `admin` tier only (see roadmap) |
| Staff support-access with audit | 🟡 admin has full `admin_all`; no scoped/audited support path (roadmap) |
| Middleware not the auth boundary (CVE-2025-29927) | 🟡 verify `/admin` never relies on middleware alone (roadmap) |
| Org layer appropriate for B2C? | 🟡 org-multitenancy exists + used; B2C blueprint says it may be overkill (roadmap) |

## Done (applied + verified this session)
- **Function hardening** (`20260713141127`): `SET search_path` on 2 trigger fns; `REVOKE EXECUTE FROM public,anon`
  on 3 RPCs (kept authenticated) + `FROM public,anon,authenticated` on 2 internal trigger/maintenance fns.
- **Init-plan** (`20260713143941`): 55 policies wrapped; advisor `auth_rls_initplan` → 0.
- **`TO public` → `TO authenticated`** (`20260713162623`): 42 privileged policies. Fixed the anon
  breakage (`contacts`/`organizations` `permission denied for function has_role` → clean `[]`), cleared the
  duplicate-permissive advisor warnings for anon, and closed the drift. **Audited safe**: the browser Supabase
  client is dead-code (imported nowhere); every anon surface uses SECURITY DEFINER RPCs or service_role —
  no anon path directly queries the 42 tables, so nothing broke.
- **Campaign wind-down admin-gate** (committed, pending deploy): close/pause/settle/cancel → `requireAdmin`.

## Roadmap (prioritized — needs product decisions before build)

### P1 — Owner vs Staff separation (B2C)
Today: one `admin` app_role. Blueprint recommends a **platform-role axis separate from customer/tenant roles**:
`platform_roles(user_id, role owner|support)` + `is_platform_owner()` / `is_staff()` SECURITY DEFINER helpers
(revoke from public, grant to authenticated). Lets support staff view customer data WITHOUT billing/settings/
destructive powers. Keep it orthogonal — a customer signup never gets a platform_roles row.

### P2 — Staff support-access + audit ("break-glass")
Instead of a broad `admin_all`, a **reason-logged SECURITY DEFINER support RPC** (`support_get_*(customer_id, reason)`)
that checks `is_staff()`, requires a reason, writes `support_access_log`, and returns a minimal DTO. Consider
enabling **pgAudit** for tamper-resistant "who accessed what" on customer tables.

### P3 — CVE-2025-29927 verification
Confirm `/admin` authorization does NOT rely on middleware — the `(admin)` layout `requireAdmin()` + every admin
Server Action/Route Handler must self-check (they do; verify no middleware-only gate exists). Prefer `auth.getUser()`
(revalidates) over `getSession()` for authorization.

### P4 — Org-layer decision for B2C
KALFA is B2C (per CLAUDE.md) yet carries an `organizations`/`org_members` layer (used for co-owners). Decide:
keep (real co-owner sharing exists) vs simplify to pure `owner_id = auth.uid()`. If kept, ensure platform-staff
access is NEVER modeled through org membership (keep the two axes orthogonal).

### P5 — Public forms (callback_requests / contact_messages)
Currently `TO authenticated` INSERT (changed externally); no anon-facing form exists yet in code. If a public
"contact us"/"callback" form is planned → add a narrow `TO anon` INSERT policy with a tight `WITH CHECK`
(validate shape, no privileged columns) + CAPTCHA + IP rate-limit. Else leave internal-only.

### P6 — Leaked-password protection
Enable in Supabase Dashboard → Auth → Password (HaveIBeenPwned). No SQL.

## Verification discipline (learned this session)
`supabase db push` emits a benign pgdelta CA-cert warning (an optional post-apply catalog-cache step failing on
a missing SSL cert in the sandbox) — the migration STILL applies + records. NEVER trust the warning's presence/
absence; verify with a direct `pg_policies`/`pg_proc` query + `supabase migration list` (local==remote).
