-- =====================================================================
-- Pricing model: flat base + included-reached + overage  (Plan S1).
-- Spec: plans/pricing-base-overage-model-plan.md §4 (S1).
-- Owner-locked model (2026-07-26): base ₪200 · included 200 reached ·
-- overage ₪4 per reached above 200. The MONEY VALUES are admin DB data
-- (packages rows), NOT schema defaults — this migration only adds the
-- structure to carry them.
--
-- ADDITIVE + REVERSIBLE. Rollback (see bottom) = drop the 4 columns + the
-- partial unique index; the one-time backfill leaves no residue to undo.
-- No destructive SQL. Applied via `supabase db push` — USER-RUN,
-- classifier-gated (do not apply from an agent session).
--
-- Design facts, VERIFIED-LIVE 2026-07-26 (linked kalfa-event-magic):
--   * packages.price_per_reached is numeric NULLABLE today; the two new
--     package columns mirror that nullability (NULL = non-campaign package;
--     set-together = campaign-enabled). price_per_reached is UNCHANGED and
--     becomes the OVERAGE rate by interpretation, not by schema.
--   * campaigns already snapshots price_per_reached + max_charge_ceiling at
--     authorize; base_price / included_reached are added as the same kind of
--     per-campaign SNAPSHOT locks (populated later by S3 at authorize).
--   * RLS is ENABLED on both tables; table-level GRANTs to authenticated +
--     service_role already exist, so new columns inherit both RLS and
--     privileges — no new policy / grant required (see §RLS note below).
-- =====================================================================

-- ---------- 1. packages: template-level base + included tier ----------
-- Nullable, mirroring price_per_reached: NULL for non-campaign packages;
-- set together with price_per_reached for a campaign-enabled package. No
-- column default — a package's price facts are explicit admin input (S4).
alter table public.packages
  add column if not exists base_price       numeric,
  add column if not exists included_reached integer;

comment on column public.packages.base_price is
  'Flat base fee for a campaign-enabled package (₪), charged at settle regardless of reached (plan D1). NULL = non-campaign package. Admin-set (S4), not a schema default.';
comment on column public.packages.included_reached is
  'Reached count included in base_price before overage applies. NULL = non-campaign package. price_per_reached is the per-reached OVERAGE rate above this tier.';

-- ---------- 2. campaigns: per-campaign SNAPSHOT of base + included ----------
-- Snapshot columns locked at authorize (S3), mirroring price_per_reached /
-- max_charge_ceiling. Nullable like those; S2 close-charge reads the SNAPSHOT,
-- never the live package.
alter table public.campaigns
  add column if not exists base_price       numeric,
  add column if not exists included_reached integer;

comment on column public.campaigns.base_price is
  'Snapshot of package.base_price at authorize (₪). Close-charge = base_price + max(0, reached - included_reached) * price_per_reached - credits. Backfilled to 0 for pre-model campaigns.';
comment on column public.campaigns.included_reached is
  'Snapshot of package.included_reached at authorize. Backfilled to 0 for pre-model campaigns so the close-charge formula reduces to pure per-reached.';

-- ---------- 3. Backfill existing campaigns -> pure per-reached ----------
-- Every in-flight campaign gets base_price=0, included_reached=0 so the new
-- close-charge formula  base + max(0, reached - included) * overage  reduces
-- EXACTLY to today's Σ(reached * price_per_reached) — ZERO behaviour change
-- for any campaign authorized before this model ships. New campaigns are
-- populated by S3 at authorize; until then they stay NULL by design.
-- Live snapshot 2026-07-26: 3 campaign rows total (closed/approved/active).
update public.campaigns
  set base_price = 0, included_reached = 0
  where base_price is null or included_reached is null;

-- ---------- 4. One-campaign-per-event DB invariant (freeze-audit GAP D) --
-- Backstops the APP-LEVEL invariant documented at
-- src/lib/data/campaigns.ts:249-254: getCampaignForEvent returns the most
-- recent NON-cancelled campaign, and createCampaign's create-or-continue
-- early return (campaigns.ts:176-178) inserts a new campaign ONLY when no
-- non-cancelled one exists. A concurrent createCampaign race can currently
-- double the row (no DB backstop today: only campaigns_pkey on id).
--
-- Predicate aligns EXACTLY with that invariant: 'cancelled' is the sole
-- terminal status that frees an event for a replacement campaign; every
-- other status (draft, pending_approval, approved, scheduled, active,
-- paused, closed, awaiting_invoice, billed, paid) blocks a second row.
-- Making the index stricter (e.g. only the operational-6 set) would be
-- LAXER than the app invariant and admit rows the app never produces.
--
-- Collision preflight on the LIVE DB (2026-07-26): 0 events have >1
-- non-cancelled campaign, so the unique index builds cleanly. status is
-- NOT NULL and the enum comparison is IMMUTABLE, so it is a valid partial
-- index predicate. Plain (non-CONCURRENTLY) build: db push runs migrations
-- in a transaction and the table is tiny.
create unique index if not exists campaigns_event_noncancelled_uidx
  on public.campaigns (event_id)
  where status <> 'cancelled'::public.campaign_status;

-- ---------- 5. Non-negative money guards (defense in depth) ----------
-- Mirrors the packages_operational_checks precedent, but >= 0 (NOT > 0 as
-- price_per_reached uses): 0 is a VALID value here — the campaign backfill
-- above sets 0/0, and a base-fee-only package could set included_reached=0.
-- All existing rows (packages: NULL; campaigns: 0) satisfy these, so ADD
-- CONSTRAINT validates cleanly. The S4 form also validates >= 0 in Zod; this
-- is the DB backstop so no path can persist negative money/counts.
alter table public.packages
  add constraint packages_base_overage_nonneg
  check ((base_price is null or base_price >= 0)
     and (included_reached is null or included_reached >= 0));

alter table public.campaigns
  add constraint campaigns_base_overage_nonneg
  check ((base_price is null or base_price >= 0)
     and (included_reached is null or included_reached >= 0));

-- =====================================================================
-- ROLLBACK (manual, if ever needed):
--   alter table public.campaigns  drop constraint if exists campaigns_base_overage_nonneg;
--   alter table public.packages   drop constraint if exists packages_base_overage_nonneg;
--   drop index if exists public.campaigns_event_noncancelled_uidx;
--   alter table public.campaigns  drop column if exists included_reached;
--   alter table public.campaigns  drop column if exists base_price;
--   alter table public.packages   drop column if exists included_reached;
--   alter table public.packages   drop column if exists base_price;
-- The backfill (campaigns set 0/0) needs no undo — dropping the columns
-- removes the values.
-- =====================================================================
