# Runbook — Apply Phase 1: Org Multi‑Tenancy migration (LIVE DB)

Migration file: `supabase/migrations/202606280021_org_multitenancy.sql`
Target: the linked **live** Supabase project (`[[supabase-live-schema]]`).
Owner of this action: **the human operator.** Claude does **not** run any step here without an explicit, per‑step "go".

> Nothing in this migration deletes or rewrites existing data. The only write to an
> existing table is filling the **new, previously‑NULL** column `events.org_id`. Everything
> else is new tables + seeded reference data. Rollback is therefore clean.

---

## 0. Scope & safety summary

- **Adds:** `permission_definitions`, `org_roles`, `role_permissions`, `organizations`, `organization_members`, `organization_invitations`, `organization_audit_log`; column `events.org_id`; 6 functions; RLS on the new tables; seed data; a backfill.
- **Does NOT touch:** existing event‑scoped RLS policies, `events.owner_id`, guests/campaigns/billing rows, public RSVP.
- **Reversible:** §7 drops everything this migration created.
- **Idempotent:** safe to re‑run (guards + `on conflict` + backfill only targets un‑orged events).

---

## 1. Pre‑flight (backup) — REQUIRED

1. Confirm a recent automatic backup exists: Supabase Dashboard → **Database → Backups** (note the timestamp).
2. (Optional extra safety) capture the pre‑state counts to compare later:
   ```sql
   select
     (select count(*) from public.events)                as events_total,
     (select count(*) from public.events where org_id is null) as events_unorged,
     (select count(distinct owner_id) from public.events where owner_id is not null) as distinct_owners;
   ```
   Record these three numbers.

**Go/No‑Go:** proceed only if a backup timestamp is confirmed.

---

## 2. Apply (single file, atomic)

Run the **entire contents** of `202606280021_org_multitenancy.sql` in **Supabase Dashboard → SQL Editor**, wrapped in a transaction so it is all‑or‑nothing:

```sql
begin;
-- (paste the full file contents here)
commit;
```

- Do **not** use `supabase db push` — the local migrations folder is partial (base schema lives only in the DB), so a blind push may try to apply unrelated files.
- If any statement errors, the whole transaction rolls back; fix and re‑run. Nothing partial remains.

---

## 3. Verify structure (read‑only)

```sql
select 'permission_definitions' t, count(*) n from public.permission_definitions
union all select 'org_roles', count(*) from public.org_roles
union all select 'role_permissions', count(*) from public.role_permissions;
```
Expected: `permission_definitions = 24`, `org_roles = 4`, `role_permissions > 0`.

Per‑role permission counts (sanity — owner has the most, viewer the fewest):
```sql
select r.name, count(rp.*) as perms
from public.org_roles r
left join public.role_permissions rp on rp.role_id = r.id
group by r.name order by perms desc;
```
Expected ordering: `owner` (24) ≥ `admin` (23) > `member` (16) > `viewer` (8). (Exact numbers may shift if the catalog is edited later — the relative order is the check.)

---

## 4. Verify backfill (the only existing‑data change)

```sql
-- (a) every event now belongs to an org — expect 0
select count(*) as events_without_org from public.events where org_id is null;

-- (b) every event's owner is an OWNER member of that event's org — expect 0 orphans
select count(*) as missing_owner_membership
from public.events e
join public.org_roles owner_role on owner_role.is_owner_role
left join public.organization_members m
  on m.organization_id = e.org_id and m.user_id = e.owner_id and m.role_id = owner_role.id
where m.id is null;

-- (c) one personal org per distinct owner — these two numbers should match
select
  (select count(distinct owner_id) from public.events where owner_id is not null) as owners,
  (select count(*) from public.organizations) as orgs;
```
Expected: (a) `0`, (b) `0`, (c) the two numbers equal (assuming no orgs existed before — they didn't).

---

## 5. (Optional) simulate a user and check the permission gate

The SQL editor runs as `postgres`, so `auth.uid()` is NULL and `has_org_permission` returns false. To test as a real member, set the JWT claim **within the same transaction**:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<A_REAL_USER_UUID>')::text, true);
-- pick that user's org id first:
--   select organization_id from organization_members where user_id = '<UUID>' limit 1;
select
  public.has_org_permission('<THAT_ORG_UUID>','guests','edit')  as owner_can_edit_guests,   -- expect true (owner)
  public.has_org_permission('<THAT_ORG_UUID>','organization','edit') as owner_can_rename_org; -- expect true (owner)
rollback;  -- read‑only check; discard the set_config
```

---

## 6. Regenerate TypeScript types (unblocks Phase 2 code)

```bash
npx supabase gen types typescript --linked > src/lib/supabase/types.ts
```
Then sanity‑check the build is still green **before** any Phase 2 code:
```bash
npx tsc --noEmit && npm run lint
```
(`src/lib/supabase/types.ts` will now include the new tables/functions.)

---

## 7. Rollback (Phase 1 only — run if any verification fails)

> Safe: drops only what this migration created. `events.owner_id` and all original
> rows are untouched. Only the new column + backfilled personal orgs disappear.
> Do NOT use this if Phase 2/3 have already shipped (they add dependencies).

```sql
begin;
-- functions
drop function if exists public.accept_invitation(text);
drop function if exists public.create_organization(text);
drop function if exists public.org_role_rank(uuid);
drop function if exists public.can_access_event(uuid, text, text);
drop function if exists public.is_org_member(uuid);
drop function if exists public.has_org_permission(uuid, text, text);

-- events column (removes the FK to organizations first)
drop index if exists public.events_org_idx;
alter table public.events drop column if exists org_id;

-- tables (cascade clears their policies/indexes/constraints)
drop table if exists public.organization_audit_log   cascade;
drop table if exists public.organization_invitations cascade;
drop table if exists public.organization_members     cascade;
drop table if exists public.organizations            cascade;
drop table if exists public.role_permissions         cascade;
drop table if exists public.org_roles                cascade;
drop table if exists public.permission_definitions   cascade;
commit;
```

---

## 8. Go / No‑Go checklist

- [ ] Backup timestamp confirmed (§1)
- [ ] Migration applied in a transaction, no errors (§2)
- [ ] Structure counts correct (§3)
- [ ] Backfill checks all return the expected `0` / equal numbers (§4)
- [ ] Types regenerated; `tsc` + `lint` green (§6)

If all checked → Phase 1 is live; proceed to Phase 2 (server layer).
If any fails → run §7 rollback, report which check failed, and we diagnose before retrying.
