-- personal-coupons tasks 1.1 + 1.1b — the schema. Change: openspec/changes/personal-coupons (D2, D3, D4, D7, D14,
-- D16, D22, D23; every decision is the owner's, 11–12.10.2026).
--
-- WHAT IT CREATES, in dependency order (D4):
--   1. offers + offer_packages — the staff-managed source of every benefit (D14/D23): kind, value, validity in days,
--      who may assign, usage rules, and the allowed packages with an optional per-package value.
--   2. coupon_assignments — one personal benefit (D3): frozen terms, a target (account or phone), a source (one sales
--      call or one staff user), a state, and the campaign it is bound to. One ACTIVE assignment per phone (D16).
--   3. coupon_assignment_options — the frozen per-package prices of an assignment.
--   4. coupon_assignment_events — insert-only history.
--   5. campaign_pricing — append-only pricing rounds (D2): one CURRENT row per campaign (partial unique index),
--      superseded rows kept as immutable history; superseded_by is DEFERRABLE INITIALLY DEFERRED (D22's replace order:
--      mark the old row first, insert the successor with a pre-allocated id; a partial unique INDEX can never be
--      deferred, which is why the order matters).
--   6. approval_requests — D7's finality record: a terms-approval attempt is persisted before its PDF is uploaded,
--      and a PDF may be cleaned up only for a request concluded as refused.
--   7. signed_agreements gains approval_request_id (unique) + pricing_round_id; payment_operations gains
--      pricing_round_id — a payment names the round it charges and settles by it (D22).
--
-- Row-integrity triggers that belong to the tables themselves (freeze, version bump, insert-only history) are here;
-- the operation functions and the lock/sync/copy triggers are the sibling migration (tasks 1.2 + 1.3). Both are pushed
-- in the same `db push`.
--
-- ACCESS: RLS on, no grants to anon or authenticated on any new table. Writes go only through the SECURITY DEFINER
-- functions (service role); reads through the server.
--
-- ROLLBACK (nothing here holds data yet at creation time):
--   alter table public.payment_operations drop column pricing_round_id;
--   alter table public.signed_agreements drop column approval_request_id, drop column pricing_round_id;
--   drop table public.approval_requests, public.campaign_pricing, public.coupon_assignment_events,
--              public.coupon_assignment_options, public.coupon_assignments, public.offer_packages, public.offers;

set local lock_timeout = '5s';

-- ── 1. offers ───────────────────────────────────────────────────────────────

create table public.offers (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) between 1 and 120),
  kind           text not null check (kind in ('percent', 'amount')),
  value          numeric not null check (value > 0),
  validity_days  integer not null check (validity_days > 0),
  allow_agent    boolean not null default false,
  allow_staff    boolean not null default true,
  -- D23 usage rules. agent_objections: which reported objections this offer answers (free values, not a closed list);
  -- may_replace: whether assigning it may replace an earlier active assignment (controlled escalation).
  agent_objections text[] not null default '{}',
  may_replace    boolean not null default false,
  is_active      boolean not null default true,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.offers is
  'Staff-managed benefit offers (personal-coupons D14/D23). The server computes every discount from here; no discount value lives in code.';
comment on column public.offers.agent_objections is
  'D23: the reported objection kinds this offer answers. Free values; the server matches the agent''s report against them.';
comment on column public.offers.may_replace is
  'D23: whether assigning this offer may replace an earlier active assignment (escalation). Never implicit.';

create table public.offer_packages (
  offer_id       uuid not null references public.offers (id) on delete cascade,
  package_id     uuid not null references public.packages (id) on delete restrict,
  -- A pricier package may carry a larger discount (owner, 12.10.2026): overrides offers.value for this package only.
  value_override numeric check (value_override > 0),
  primary key (offer_id, package_id)
);

comment on table public.offer_packages is
  'The packages an offer allows, with an optional per-package value override (personal-coupons D14).';

-- ── 2. coupon_assignments ───────────────────────────────────────────────────

create table public.coupon_assignments (
  id                     uuid primary key default gen_random_uuid(),
  offer_id               uuid not null references public.offers (id) on delete restrict,
  -- The source: exactly one — the sales call, or the staff user (D3/D13).
  sales_call_attempt_id  uuid references public.sales_call_attempts (id) on delete restrict,
  assigned_by            uuid references auth.users (id),
  -- The target: a known account, or a phone until claimed (D3). At least one.
  user_id                uuid references auth.users (id),
  phone_e164             text check (phone_e164 ~ '^\+[0-9]{8,15}$'),
  -- Frozen at assignment time (D3); a later offer change never touches an existing assignment.
  kind                   text not null check (kind in ('percent', 'amount')),
  value                  numeric not null check (value > 0),
  expires_at             timestamptz not null,
  state                  text not null default 'assigned' check (state in ('assigned', 'bound', 'consumed', 'void')),
  bound_campaign_id      uuid references public.campaigns (id) on delete restrict,
  idempotency_key        text not null check (length(idempotency_key) between 1 and 120),
  created_at             timestamptz not null default now(),
  claimed_at             timestamptz,
  constraint coupon_assignments_one_source
    check ((sales_call_attempt_id is not null)::int + (assigned_by is not null)::int = 1),
  constraint coupon_assignments_has_target
    check (user_id is not null or phone_e164 is not null),
  constraint coupon_assignments_bound_iff
    check ((state = 'bound') = (bound_campaign_id is not null) or state = 'consumed')
);

comment on table public.coupon_assignments is
  'One personal benefit (personal-coupons D3): frozen terms, one source, one target, used for at most one purchase.';

-- Idempotency per source (D3): one assignment per sales call; staff retries dedupe on their own key.
create unique index coupon_assignments_one_per_call
  on public.coupon_assignments (sales_call_attempt_id)
  where sales_call_attempt_id is not null;
create unique index coupon_assignments_staff_idem
  on public.coupon_assignments (assigned_by, idempotency_key)
  where assigned_by is not null;

-- D16: one ACTIVE assignment per phone. An expired row still counts until it is voided; the assign path voids an
-- expired active row in the same transaction before creating a new one.
create unique index coupon_assignments_one_active_per_phone
  on public.coupon_assignments (phone_e164)
  where phone_e164 is not null and state in ('assigned', 'bound');

create index coupon_assignments_offer_idx on public.coupon_assignments (offer_id);
create index coupon_assignments_user_idx on public.coupon_assignments (user_id) where user_id is not null;
create index coupon_assignments_campaign_idx on public.coupon_assignments (bound_campaign_id) where bound_campaign_id is not null;
create index coupon_assignments_assigned_by_idx on public.coupon_assignments (assigned_by) where assigned_by is not null;

-- The freeze (D3): after insert, only the state machine's own fields may change — state, binding, the one-time claim.
create or replace function public.coupon_assignments_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_id               is distinct from old.offer_id
  or new.sales_call_attempt_id  is distinct from old.sales_call_attempt_id
  or new.assigned_by            is distinct from old.assigned_by
  or new.phone_e164             is distinct from old.phone_e164
  or new.kind                   is distinct from old.kind
  or new.value                  is distinct from old.value
  or new.expires_at             is distinct from old.expires_at
  or new.idempotency_key        is distinct from old.idempotency_key
  or new.created_at             is distinct from old.created_at then
    raise exception 'coupon_assignments: frozen fields cannot change';
  end if;
  -- The claim is one-way and one-time (D3: "its account (once, on claim)").
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'coupon_assignments: the claimed account cannot change';
  end if;
  return new;
end $$;

create trigger coupon_assignments_freeze
  before update on public.coupon_assignments
  for each row execute function public.coupon_assignments_freeze();

-- ── 3. coupon_assignment_options ────────────────────────────────────────────

create table public.coupon_assignment_options (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.coupon_assignments (id) on delete restrict,
  package_id       uuid not null references public.packages (id) on delete restrict,
  list_price       numeric not null check (list_price >= 0),
  discount_amount  numeric not null check (discount_amount >= 0),
  final_price      numeric not null check (final_price > 0),
  unique (assignment_id, package_id),
  constraint coupon_assignment_options_price_math check (list_price - discount_amount = final_price)
);

comment on table public.coupon_assignment_options is
  'The frozen per-package prices of one assignment (personal-coupons D3). final_price is strictly positive (D14).';

create index coupon_assignment_options_package_idx on public.coupon_assignment_options (package_id);

-- Options are frozen with their assignment: no update, ever.
create or replace function public.coupon_assignment_options_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'coupon_assignment_options are frozen';
end $$;

create trigger coupon_assignment_options_frozen
  before update on public.coupon_assignment_options
  for each row execute function public.coupon_assignment_options_frozen();

-- ── 4. coupon_assignment_events ─────────────────────────────────────────────

create table public.coupon_assignment_events (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.coupon_assignments (id) on delete restrict,
  at             timestamptz not null default now(),
  action         text not null check (length(action) between 1 and 60),
  actor_user_id  uuid references auth.users (id),
  reason         text,
  meta           jsonb not null default '{}'::jsonb
);

comment on table public.coupon_assignment_events is
  'Insert-only history of every assignment state change (personal-coupons D3/D5).';

create index coupon_assignment_events_assignment_idx on public.coupon_assignment_events (assignment_id, at);

create or replace function public.coupon_assignment_events_insert_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'coupon_assignment_events is insert-only';
end $$;

create trigger coupon_assignment_events_insert_only
  before update or delete on public.coupon_assignment_events
  for each row execute function public.coupon_assignment_events_insert_only();

-- ── 5. campaign_pricing ─────────────────────────────────────────────────────

create table public.campaign_pricing (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.campaigns (id) on delete restrict,
  list_price            numeric not null check (list_price >= 0),
  discount_amount       numeric not null check (discount_amount >= 0),
  package_price         numeric not null check (package_price >= 0),
  coupon_assignment_id  uuid references public.coupon_assignments (id) on delete restrict,
  version               integer not null default 1,
  locked_at             timestamptz,
  superseded_at         timestamptz,
  superseded_by         uuid references public.campaign_pricing (id) deferrable initially deferred,
  created_at            timestamptz not null default now(),
  constraint campaign_pricing_price_math check (list_price - discount_amount = package_price),
  -- Both set together by the supersede operation, never separately.
  constraint campaign_pricing_superseded_pair check ((superseded_at is null) = (superseded_by is null))
);

comment on table public.campaign_pricing is
  'Append-only pricing rounds (personal-coupons D2/D22): one CURRENT row per campaign; a superseded row is immutable history. The lock and supersede rules are enforced by the sibling migration''s triggers and functions.';

-- One CURRENT row per campaign — a database fact (D2). A partial unique INDEX is not a constraint and can never be
-- deferred (SET CONSTRAINTS docs), hence D22's replace order: mark the old row superseded FIRST, then insert the
-- successor with its pre-allocated id; the deferred superseded_by FK is checked at commit.
create unique index campaign_pricing_current_per_campaign
  on public.campaign_pricing (campaign_id)
  where superseded_at is null;
create unique index campaign_pricing_superseded_by_unique
  on public.campaign_pricing (superseded_by)
  where superseded_by is not null;

create index campaign_pricing_campaign_idx on public.campaign_pricing (campaign_id);
create index campaign_pricing_assignment_idx on public.campaign_pricing (coupon_assignment_id) where coupon_assignment_id is not null;

-- ── 6. approval_requests ────────────────────────────────────────────────────

create table public.approval_requests (
  id                uuid primary key,
  campaign_id       uuid not null references public.campaigns (id) on delete restrict,
  pricing_round_id  uuid not null references public.campaign_pricing (id) on delete restrict,
  expected_version  integer not null,
  pdf_ref           text not null,
  state             text not null default 'open' check (state in ('open', 'approved', 'refused')),
  created_at        timestamptz not null default now(),
  concluded_at      timestamptz,
  constraint approval_requests_concluded_pair check ((state = 'open') = (concluded_at is null))
);

comment on table public.approval_requests is
  'D7 finality: every terms-approval attempt, persisted before its PDF is uploaded. A retry reuses the id and reads the stored outcome; cleanup may delete only the PDF of a request concluded as refused.';

create index approval_requests_campaign_idx on public.approval_requests (campaign_id);
create index approval_requests_open_idx on public.approval_requests (created_at) where state = 'open';
create index approval_requests_round_idx on public.approval_requests (pricing_round_id);

-- ── 7. the two existing tables ──────────────────────────────────────────────

alter table public.signed_agreements
  add column approval_request_id uuid unique references public.approval_requests (id),
  add column pricing_round_id uuid references public.campaign_pricing (id);

comment on column public.signed_agreements.approval_request_id is
  'D7: the approval attempt this agreement concluded. Unique — a retried request can never store a second agreement.';
comment on column public.signed_agreements.pricing_round_id is
  'D2/D7: the pricing round the approved document was rendered from. Null on rows older than personal-coupons.';

create index signed_agreements_round_idx on public.signed_agreements (pricing_round_id) where pricing_round_id is not null;

alter table public.payment_operations
  add column pricing_round_id uuid references public.campaign_pricing (id) on delete restrict;

comment on column public.payment_operations.pricing_round_id is
  'D22: the pricing round this package payment charges, written at INSERT by open_package_payment. Settlement, consumption and refunds read the price from this round, never from whichever row is current later. Null on operations that are not package purchases and on rows older than personal-coupons.';

create index payment_operations_round_idx on public.payment_operations (pricing_round_id) where pricing_round_id is not null;

-- ── ACCESS ──────────────────────────────────────────────────────────────────

alter table public.offers enable row level security;
alter table public.offer_packages enable row level security;
alter table public.coupon_assignments enable row level security;
alter table public.coupon_assignment_options enable row level security;
alter table public.coupon_assignment_events enable row level security;
alter table public.campaign_pricing enable row level security;
alter table public.approval_requests enable row level security;

revoke all on table public.offers from anon, authenticated;
revoke all on table public.offer_packages from anon, authenticated;
revoke all on table public.coupon_assignments from anon, authenticated;
revoke all on table public.coupon_assignment_options from anon, authenticated;
revoke all on table public.coupon_assignment_events from anon, authenticated;
revoke all on table public.campaign_pricing from anon, authenticated;
revoke all on table public.approval_requests from anon, authenticated;

-- ── SELF-CHECK (task 1.1's verify, re-measured here so a bad state aborts the push) ──

do $$
declare v integer;
begin
  -- No grants to anon/authenticated on any new table.
  select count(*) into v
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('offers', 'offer_packages', 'coupon_assignments', 'coupon_assignment_options',
                        'coupon_assignment_events', 'campaign_pricing', 'approval_requests')
     and grantee in ('anon', 'authenticated');
  if v <> 0 then
    raise exception 'coupons schema: % grant(s) to anon/authenticated remain', v;
  end if;
  -- Every new table has RLS enabled.
  select count(*) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('offers', 'offer_packages', 'coupon_assignments', 'coupon_assignment_options',
                       'coupon_assignment_events', 'campaign_pricing', 'approval_requests')
     and not c.relrowsecurity;
  if v <> 0 then
    raise exception 'coupons schema: % table(s) without RLS', v;
  end if;
end $$;

revoke all on function public.coupon_assignments_freeze() from public, anon, authenticated;
revoke all on function public.coupon_assignment_options_frozen() from public, anon, authenticated;
revoke all on function public.coupon_assignment_events_insert_only() from public, anon, authenticated;
