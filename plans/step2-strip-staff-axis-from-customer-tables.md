# Step 2 — strip the staff axis off customer-owned tables

Status: **specified, not executed.** Blast radius mapped and verified 2026-07-20.


## CORRECTION (verified 2026-07-20, from the domain + schema agents' cross-check)

The scope is **32 policies, not 30.** Two customer-owned org tables were mis-classified
as "staff-only" in my earlier axis mapping (a crude keyword match that missed `is_org_owner`):

- `organization_role_permissions` — policy `organization_role_permissions_owner_select`
- `organization_role_audit_log`  — policy `organization_role_audit_log_owner_select`

Both are `is_org_owner(organization_id) OR has_role(auth.uid(),'admin')` — a MIXED axis, i.e.
a residual staff leak (an admin can read another tenant's org-role config over the Data API)
that the 30-policy scope leaves open. They are **REWRITE** (strip `OR has_role`, keep
`is_org_owner`), taking the rewrite count from 9 to 11 and the total from 30 to 32. No customer
breakage: their only app readers use `createAdminClient` (orgs.ts L295/L422/L434), so the
customer half is future-proofing, not load-bearing today.

METHOD NOTE for whoever executes this: ad-hoc keyword classification of policy predicates
repeatedly produced false results tonight because `auth.uid()` appears INSIDE every wrapped
`has_role((select auth.uid()),'admin')` call, falsely reading as a customer axis. The
authoritative DROP/REWRITE classification is the schema agent's per-policy table above —
re-derive from `pg_policies` per policy, not by grepping for keywords.


## Why it is not urgent today, and why it is mandatory later

An admin can read every tenant's rows over the public Data API with their own JWT
and leave no audit trail. Verified live: acting as Postgres role `authenticated`
with the admin's `sub`, `select count(*) from guests` returns 44 and `events`
returns 2 — both tenants.

At current scale that is **one** foreign row (the second tenant owns 1 event /
1 guest; the admin owns the other 43). The mechanism is what matters, not the
number: the same policy that leaks one test guest today leaks every guest of
every customer the day the product has customers. Close it before the first real
customer, not after.

## Scope — 30 policies (an earlier note said 36; that was wrong)

`activity_log al_admin_all` · `billed_results` · `billing_credits` ·
`call_analysis_admin_select` · `call_attempts_admin_read` · `callback_requests cb_admin_all` ·
`campaign_authorized_contacts` · `campaign_authorized_set_audit_org_select` ·
`campaigns camp_admin_all` · `contact_interactions` · `contact_messages cm_admin_all` ·
`contacts_admin_all` · `event_questions eq_admin_all` · `events_admin_all` ·
`guest_groups gg_admin_all` · `guests_admin_all` · `organization_audit_log` (×2) ·
`organization_invitations_manage` · `organizations` (×3) · `outreach_state` ·
`profiles_admin_read` · `push_subscriptions` (×4) · `rsvp_responses rsvp_admin_read` ·
`signed_agreements_admin_all`

Two shapes, and they need different surgery:
- **standalone `*_admin_all`** — droppable outright.
- **`OR has_role(admin)` inlined into a customer predicate** (`organizations_update`,
  `organizations_member_select`, `organization_invitations_manage`,
  `organization_audit_log_select`, `campaign_authorized_set_audit_org_select`,
  `push_subscriptions_*`) — must be REWRITTEN, not dropped, or the customer path dies.

## The ordering constraint that makes this non-trivial

These modules read a Step-2 table through the **cookie client**, so they depend on
the staff policy to read at all. Dropping policies first breaks them:

| call site | tables |
|---|---|
| `src/lib/data/admin/activity.ts` L438, L501, L534, L559 | activity_log, profiles |
| `src/lib/data/admin/callbacks.ts` L33, L62, L74 | callback_requests |
| `src/lib/data/admin/contacts.ts` L31 | contact_messages |
| `src/lib/data/admin/dashboard.ts` L34 | (aggregates) |
| `src/app/(admin)/admin/recordings/page.tsx` L50 | call_attempts — **a page, not a DAL** |

**Flip those five to `createAdminClient` FIRST**, verify, and only then drop policies.
They are already gated by `requirePlatformPermission`, so the authorization does not
regress — only the client changes.

Everything else under `src/lib/data/admin/` either already uses service_role or touches
platform tables (`app_settings`, `packages`, `call_dnc_list`, `message_templates`) that
are out of scope.

## The part that is easy to get wrong

Dropping the policies **increases** the service_role surface. That is the intended
direction — implicit DB-level reach becomes explicit, greppable, gated call sites — but
it is only an improvement if it arrives WITH auditing. `src/lib/data/admin/support.ts`
already models this: it writes a `support_access_log` row on every access and fails
closed. Generalise that to any staff reader of customer data, or this step trades a
visible hole for an invisible one.

Do **not** reach for `AS RESTRICTIVE` policies here. They narrow *who* but cannot express
*log this access*, they AND against the working customer policies (one typo breaks every
tenant), and they would have to be applied to all 29 tables with an invisible failure mode.

## Verification

Use a Supabase branch — this is exactly the wide, risky migration that justifies the
~$0.01344/hour. Before and after, probe as each tenant:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<uid>","role":"authenticated"}';
select (select count(*) from guests), (select count(*) from events);
rollback;
```

Pass: the admin sees only their own rows; the second tenant is unchanged; `/admin`
still renders every gated page when logged in (this cannot be checked from the shell —
it needs a real browser session).
