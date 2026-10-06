-- Expand phase of the payment split (docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md).
-- Adds the payment domain beside campaigns; touches no existing column. Contract is a later migration.

-- ── outcome of ONE attempt. The only enum here: it is about the attempt, not the kind of money movement. ──
create type public.payment_operation_outcome as enum ('pending', 'succeeded', 'failed', 'review');

-- Time-ordered v7 ids (schema-primary-keys): cem-uuidv7 1.0.2 is installed in `extensions` (owner, 24.9 21:49;
-- verified: version nibble 7, monotonic, executable by service_role). Not core Postgres — the `if not exists` below
-- makes the migration honest about the dependency; on this project it is a no-op.
create extension if not exists "cem-uuidv7" with schema extensions;

-- ── payment_operation_kinds: the registry. A new kind is a ROW, not a migration. ──
-- effect drives the derived status (src/lib/payments/status.ts): commit = money reserved,
-- collect = money taken, return = money given back, none = informational.
create table public.payment_operation_kinds (
  kind       text primary key,
  label_he   text not null,
  -- effect: commit = money reserved (a guarantee), collect = money taken, void = a guarantee ended with no
  -- money movement (a hold released/expired), return = money given back, none = informational.
  effect     text not null check (effect in ('commit', 'collect', 'void', 'return', 'none')),
  -- once_per_campaign: at most ONE live (pending/review/succeeded) operation of this kind per campaign (the final
  -- charge happens once). Snapshotted onto payment_operations.once_slot at insert and enforced by the partial
  -- unique index payment_operations_once_uq — data-driven, no kind name in code or index.
  once_per_campaign boolean not null default false,
  -- once_per_parent: at most ONE succeeded operation of this kind per parent operation (a hold is released once;
  -- a charge may be refunded several times). Snapshotted onto parent_slot; enforced by payment_operations_parent_uq.
  once_per_parent   boolean not null default false,
  sort_order integer not null default 100,
  active     boolean not null default true
);
-- effect is DEFINITIONAL and read live by every status computation. Changing it would rewrite the meaning of
-- history for every campaign. A different behaviour is a NEW kind, never an edited one.
create or replace function public.payment_operation_kinds_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.kind <> old.kind or new.effect <> old.effect or new.once_per_campaign <> old.once_per_campaign
     or new.once_per_parent <> old.once_per_parent then
    raise exception 'payment_operation_kinds: kind/effect/once flags are immutable — add a new kind instead' using errcode = 'check_violation';
  end if;
  return new;   -- label_he, sort_order, active may change
end $$;
create trigger payment_operation_kinds_guard_update before update on public.payment_operation_kinds
  for each row execute function public.payment_operation_kinds_guard_update();
-- The final charge is a FRESH charge on the saved token (capture.ts:123-162; verified live 2026-06-29), NOT a
-- capture of the hold — so there is no 'capture' kind and 'charge' has no parent. 'release' ends the guarantee.
insert into public.payment_operation_kinds (kind, label_he, effect, once_per_campaign, once_per_parent, sort_order) values
  ('authorize',           'אישור מסגרת',   'commit',  true,  false, 10),   -- once per campaign: today lockCampaignForHold never re-holds after 'authorized' (campaigns.ts:467-482)
  ('release',             'שחרור מסגרת',   'void',    false, true,  20),   -- once per parent: a hold is released once (reconciler dedupe
  ('charge',              'חיוב סופי',     'collect', true,  false, 30),
  ('refund',              'החזר',          'return',  false, false, 50);   -- several partial refunds of one charge are allowed
-- No 'cancellation_charge' kind (corrected 2026-09-30): a captured cancellation IS the campaign's final 'charge' (same
-- SUMIT document, closeCampaignAndCharge), a refunded one is a 'refund'. The request links via meta.cancellation_request_id.

-- ── payment_operations: append-only. One row per thing that happened to money. ──
create table public.payment_operations (
  id                   uuid primary key default extensions.uuid_generate_v7(),
  -- RESTRICT, like billed_results (measured: its three FKs are ON DELETE RESTRICT): a money ledger never vanishes
  -- silently because a campaign or event was deleted.
  campaign_id          uuid not null references public.campaigns (id) on delete restrict,
  event_id             uuid not null references public.events (id) on delete restrict,
  -- ── the card, on the operation where the provider returned it (a hold, or a simple charge — SUMIT saves a
  --    reusable token unless CardTokenNotNeeded=true). NULL on every other operation. Owner 25.9: no separate table.
  payment_method_type  text,            -- as the provider reports it (SUMIT PaymentMethod.Type: credit card / direct debit)
  card_token_ref       text,            -- reusable CreditCard_Token (campaigns.card_token_ref today)
  card_exp_month       smallint check (card_exp_month between 1 and 12),
  card_exp_year        smallint check (card_exp_year between 2024 and 2100),
  card_last4           text,            -- CreditCard_LastDigits (masked, safe to show)
  card_mask            text,            -- CreditCard_CardMask
  card_brand           text,            -- card brand (Visa / Isracard / …) as the provider reports it; filled after the charge
  card_issuer          text,            -- issuing company, as the provider reports it; filled after the charge
  citizen_id_secret    uuid,            -- vault.secrets.id — the ONLY link to the ת"ז
  kind                 text not null references public.payment_operation_kinds (kind),
  outcome              public.payment_operation_outcome not null default 'pending',
  amount               numeric(12,2) not null default 0 check (amount >= 0),
  credit_applied       numeric(12,2) not null default 0 check (credit_applied >= 0),
  parent_operation_id  uuid references public.payment_operations (id),   -- release → its authorize; refund → its charge. charge has NONE.
  provider             text not null default 'sumit',
  -- Names follow the provider's RESPONSE fields (rule above), never the action. Request-only mechanism
  -- parameters (AutoCapture, AuthorizeAmount, ParamJ, …) live in `meta`, per kind.
  provider_payment_id  bigint,                                          -- Data.Payment.ID
  provider_auth_ref    text,                                            -- Data.Payment.AuthNumber
  provider_status      text,                                            -- Data.Payment.Status (as returned)
  provider_status_description text,                                     -- Data.Payment.StatusDescription (as returned, not our wording)
  provider_document_id bigint,
  provider_document_number integer,
  provider_document_url text,
  source               text not null default 'app' check (source in ('app', 'provider_sync', 'manual_backfill')),
  occurred_at          timestamptz not null default now(),              -- when it happened at the provider; for a two-phase op it is
                                                                         -- the begin time and may be set once on completion (guard_update)
  recorded_at          timestamptz not null default now(),              -- when we wrote it
  note                 text,
  meta                 jsonb not null default '{}'::jsonb               -- non-sensitive extras only (no card data, no ת"ז)
);
comment on table public.payment_operations is 'Append-only ledger of every money movement per campaign. Status is DERIVED from the rows (effect of the last succeeded operations), never stored. Server-only.';
-- Indexes. Every FK column is indexed (schema-foreign-key-indexes: Postgres does not do it for you; cascades and joins scan otherwise).
create index payment_operations_campaign_idx on public.payment_operations (campaign_id, occurred_at desc);  -- loadOperations: equality then order
create index payment_operations_event_idx    on public.payment_operations (event_id);
create index payment_operations_parent_idx   on public.payment_operations (parent_operation_id) where parent_operation_id is not null;
-- UNIQUE: one SUMIT document (receipt/order) is recorded once. Recording the same receipt twice would double the
-- collected sum. The backfill maps hold_order_document_id → authorize and sumit_charge_document_id
-- → charge, distinct documents, so the 3 live campaigns pass.
create unique index payment_operations_doc_uq on public.payment_operations (provider, provider_document_id) where provider_document_id is not null;
-- The one meta key code looks up (event-cancellation, Task 7): expression index, not a table scan (advanced-jsonb-indexing).
-- UNIQUE: one cancellation request → one live money operation (its 'charge' or its 'refund'), enforced in the btree.
create unique index payment_operations_cancellation_uq on public.payment_operations ((meta->>'cancellation_request_id'))
  where meta ? 'cancellation_request_id' and outcome in ('pending', 'review', 'succeeded');   -- failed leaves the slot, like once_uq
-- Uniqueness of the final charge is enforced by payment_operations_once_uq (below) via the once_slot snapshot — not by a
-- parent-based unique index, which would also block a second partial refund of one charge.
-- THE MUTEX: today lockCampaignForHold/lockCampaignForCharge are an UPDATE filtered on
-- capture_status/charge_status — a compare-and-set that makes "final charge exactly once" true under concurrency.
-- In the ledger the lock is the PENDING row: inserting it acquires the lock (23505 if one is already pending),
-- completing it (pending → succeeded/failed/review) releases it. One pending operation per campaign per kind.
create unique index payment_operations_one_pending_uq
  on public.payment_operations (campaign_id, kind) where outcome = 'pending';

-- ── Concurrency ─────────
-- A trigger that does `exists(select …)` is NOT a lock under read committed: two concurrent inserts see neither
-- row and both pass. Uniqueness is enforced only inside the btree (index-unique-checks), at any isolation level.
-- So: the registry stays the source of truth (once_per_campaign), a BEFORE INSERT trigger SNAPSHOTS that flag
-- onto the row (once_slot) and locks the campaign row, and a partial UNIQUE index does the enforcement.

alter table public.payment_operations add column once_slot boolean not null default false;
alter table public.payment_operations add column parent_slot boolean not null default false;
comment on column public.payment_operations.parent_slot is 'Snapshot of kinds.once_per_parent (and parent set) at insert; immutable; drives payment_operations_parent_uq.';
comment on column public.payment_operations.once_slot is 'Snapshot of payment_operation_kinds.once_per_campaign at insert time; immutable; drives payment_operations_once_uq.';

-- BEFORE INSERT: (1) lock the campaign row, so ledger writes and campaign status changes (whose guard triggers
-- read the ledger) queue behind each other instead of racing; (2) snapshot the registry flag.
create or replace function public.payment_operations_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_event uuid; v_effect text; v_once boolean; v_parent_once boolean; v_parent_campaign uuid; v_parent_outcome public.payment_operation_outcome;
begin
  -- Lock the campaign row FIRST, then read its status under the lock: a cancel that committed a moment ago is
  -- seen here (cancel-first scenario. Money may not be committed or collected for a
  -- cancelled campaign; a release/refund (void/return) on one is still allowed — that is how it gets its money back.
  select c.status::text, c.event_id into v_status, v_event from public.campaigns c where c.id = new.campaign_id for update;
  if v_status is null then
    raise exception 'campaign % not found', new.campaign_id using errcode = 'foreign_key_violation';
  end if;
  select k.effect, k.once_per_campaign, k.once_per_parent into v_effect, v_once, v_parent_once
    from public.payment_operation_kinds k where k.kind = new.kind;
  if v_status = 'cancelled' and v_effect in ('commit', 'collect') then
    raise exception 'campaign % is cancelled: no % allowed', new.campaign_id, new.kind using errcode = 'check_violation';
  end if;
  -- coalesce: an unknown kind then fails on the FK (23503, clear) rather than on NOT NULL (23502)
  -- Integrity: event_id is DERIVED from the locked campaign, never trusted from the caller.
  new.event_id := v_event;
  -- A parent must belong to the same campaign and must have succeeded (releasing a failed hold or refunding a
  -- failed charge is meaningless and would corrupt the derived state).
  if new.parent_operation_id is not null then
    select p.campaign_id, p.outcome into v_parent_campaign, v_parent_outcome
      from public.payment_operations p where p.id = new.parent_operation_id;
    if v_parent_campaign is distinct from new.campaign_id then
      raise exception 'parent operation % belongs to another campaign', new.parent_operation_id using errcode = 'check_violation';
    end if;
    if v_parent_outcome <> 'succeeded' then
      raise exception 'parent operation % did not succeed (%)', new.parent_operation_id, v_parent_outcome using errcode = 'check_violation';
    end if;
  end if;
  new.once_slot   := coalesce(v_once, false);
  new.parent_slot := coalesce(v_parent_once, false) and new.parent_operation_id is not null;
  return new;
end $$;
create trigger payment_operations_before_insert before insert on public.payment_operations
  for each row execute function public.payment_operations_before_insert();

-- THE LOCK for once-per-campaign kinds: at most one LIVE row per campaign per kind.
--   pending   → blocks (an attempt is in flight)
--   review    → blocks until a person reconciles it (SUMIT may have charged; a retry could charge twice)
--   succeeded → blocks for good
--   failed    → leaves the index; a retry is allowed
create unique index payment_operations_once_uq
  on public.payment_operations (campaign_id, kind)
  where once_slot and outcome in ('pending', 'review', 'succeeded');
-- One live once-per-parent child per parent (a hold is released once, even if two reconciler runs overlap).
create unique index payment_operations_parent_uq
  on public.payment_operations (parent_operation_id, kind)
  where parent_slot and outcome in ('pending', 'review', 'succeeded');

-- Append-only with controlled completion. Allowed transitions: pending → succeeded | failed | review,
-- review → succeeded | failed (the human reconciliation). One late fill: card_brand + card_issuer, once, from NULL, on a
-- succeeded row that holds a card (it arrives only with a later charge document). Nothing else ever changes.
create or replace function public.payment_operations_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.outcome = 'succeeded' and new.outcome = 'succeeded' and old.card_token_ref is not null
     and old.card_brand is null and old.card_issuer is null
     and (new.card_brand is not null or new.card_issuer is not null)
     and (to_jsonb(new) - 'card_brand' - 'card_issuer') = (to_jsonb(old) - 'card_brand' - 'card_issuer') then
    return new;
  end if;
  if not (
       (old.outcome = 'pending' and new.outcome in ('succeeded', 'failed', 'review'))
    or (old.outcome = 'review'  and new.outcome in ('succeeded', 'failed'))
  ) then
    raise exception 'payment_operations: % → % is not an allowed transition (row %)', old.outcome, new.outcome, old.id
      using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.campaign_id <> old.campaign_id or new.event_id <> old.event_id or new.kind <> old.kind
     or new.parent_operation_id is distinct from old.parent_operation_id
     or new.recorded_at <> old.recorded_at or new.source <> old.source
     or new.once_slot is distinct from old.once_slot or new.parent_slot is distinct from old.parent_slot then
    raise exception 'only outcome, amounts, provider refs, occurred_at, note and meta may change on completion' using errcode = 'check_violation';
  -- Note: an UPDATE that does not change outcome (e.g. note only on a review row) is rejected by the transition check
  -- above. Interim admin notes go to activity_log, not to the row.
  end if;
  return new;
end $$;
create trigger payment_operations_guard_update before update on public.payment_operations
  for each row execute function public.payment_operations_guard_update();

-- ── ACL: not part of the Data API. ──
alter table public.payment_operation_kinds enable row level security;
alter table public.payment_operations      enable row level security;
revoke all on table public.payment_operation_kinds, public.payment_operations from public, anon, authenticated;
-- service_role keeps Supabase's default privileges (the public default ACL grants it full table rights on every new
-- table; measured 2026-09-24) — the same as every other table here, by the owner's decision. Append-only is enforced
-- by the two triggers above, not by privileges.
-- No policies on purpose: RLS with none denies every non-bypass role; service_role bypasses RLS.

-- ── Vault write + read: the same privileges/search_path as integrations_write/read_credential (20260916002343). ──
-- Write returns the secret id; the caller puts it on the operation row with the rest of the card (completeOperation).
-- Unlike integrations_write_credential (secret + row in ONE call), this is two calls: a failure between them
-- leaves an orphan 'pay:' secret in vault.secrets (corrected 2026-09-30).
create or replace function public.payment_citizen_id_write(p_citizen_id text, p_campaign_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select vault.create_secret(p_citizen_id, 'pay:' || p_campaign_id::text || ':' || extensions.uuid_generate_v7()::text,
                             'card-holder citizen id', null)
$$;

create or replace function public.payment_citizen_id(p_operation_id uuid)
returns text
language sql
security invoker
stable
set search_path = ''
as $$
  select s.decrypted_secret
    from public.payment_operations o
    join vault.decrypted_secrets s on s.id = o.citizen_id_secret
   where o.id = p_operation_id
$$;
revoke execute on function public.payment_citizen_id_write(text, uuid) from public, anon, authenticated;
revoke execute on function public.payment_citizen_id(uuid) from public, anon, authenticated;
grant execute on function public.payment_citizen_id_write(text, uuid) to service_role;
grant execute on function public.payment_citizen_id(uuid) to service_role;

-- ── Records the owner's manual drop of 2026-09-24 so migration history matches the live schema. No-op live. ──
alter table public.campaigns drop column if exists auth_expires_at;

-- ── DRY RUN (owner, one transaction ending in ROLLBACK) ──
-- a) select c.relname, has_table_privilege('anon',c.oid,'select') anon_sel, has_table_privilege('authenticated',c.oid,'select') auth_sel,
--           has_table_privilege('service_role',c.oid,'select,insert,update,delete') sr
--    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'payment\_%';
--    expect: anon f, auth f, sr t (default ACL, owner's decision)
-- b) select count(*) from pg_policies where tablename like 'payment\_%';  -- 0
-- c) select has_function_privilege('anon','public.payment_citizen_id(uuid)','execute'),
--           has_function_privilege('service_role','public.payment_citizen_id(uuid)','execute'); -- f, t
-- c2) (ROLLBACK) on a succeeded authorize with a card: update card_brand/card_issuer from NULL → accepted; update again → check_violation;
--     update card_brand together with amount → check_violation
-- d) select kind, effect, once_per_campaign from public.payment_operation_kinds order by sort_order; -- 4 rows; authorize+charge once
-- e) FK columns without an index (schema-foreign-key-indexes) — expect 0 rows (kind is the second column of
--    one_pending_uq and once_uq, which the query counts;):
--    select conrelid::regclass, a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
--    where c.contype='f' and conrelid::regclass::text like 'payment\_%' and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and a.attnum=any(i.indkey));
--    (kind has no index of its own on purpose — a 4-row registry, never deleted from; the composite indexes cover the FK check.)
-- f) select count(*) from pg_trigger where tgname in ('payment_operations_before_insert','payment_operations_guard_update'); -- 2
--    select indexdef from pg_indexes where indexname='payment_operations_once_uq'; -- WHERE once_slot AND outcome IN (pending, review, succeeded)
-- g) select confdeltype from pg_constraint where conrelid='public.payment_operations'::regclass and contype='f' and conname like '%campaign_id%'; -- 'r' (restrict)
-- h) TWO connections (not one transaction — the point is concurrency; `db query --linked` is ONE connection and
--    cannot run this — use two psql sessions or two SQL-editor tabs: A inserts a pending 'charge' for campaign X and
--    waits; B inserts a pending 'charge' for X → B blocks on the index until A commits/rolls back, then fails 23505
--    (or succeeds if A rolled back). Then: A's row updated to 'review' → a new pending insert still fails; A's row
--    updated to 'failed' → a new pending insert succeeds. Both connections ROLLBACK at the end.
-- i) update a 'succeeded' row's outcome → check_violation; update a row's once_slot / parent_slot → check_violation
-- j) (ROLLBACK) the live campaigns_guard_cancel blocks cancelling an authorized campaign, so inside the SAME rollback
--    transaction first `alter table public.campaigns disable trigger campaigns_guard_cancel` (it is rolled back too),
--    then update campaigns set status='cancelled' where id=X; insert 'charge' pending for X → check_violation ('cancelled');
--    insert 'release' succeeded for X (parent = X's authorize) → accepted; a second 'release' for the same parent → 23505 on payment_operations_parent_uq
-- k) (ROLLBACK) two rows with the same meta.cancellation_request_id → 23505 on payment_operations_cancellation_uq
-- l) (ROLLBACK) insert with event_id of another event → row gets the campaign's real event_id (derived); a release whose
--    parent belongs to another campaign → check_violation; a release whose parent authorize is 'failed' → check_violation
-- m) (ROLLBACK) two rows with the same (provider, provider_document_id) → 23505 on payment_operations_doc_uq
-- n) (ROLLBACK) update payment_operation_kinds set effect='return' where kind='release' → check_violation; set label_he=… → accepted
-- ROLLBACK (manual): drop trigger payment_operation_kinds_guard_update on public.payment_operation_kinds; drop function public.payment_operation_kinds_guard_update();
--   drop trigger payment_operations_before_insert on public.payment_operations; drop function public.payment_operations_before_insert();
--   drop trigger payment_operations_guard_update on public.payment_operations; drop function public.payment_operations_guard_update();
--   drop function public.payment_citizen_id_write(text, uuid); drop function public.payment_citizen_id(uuid);
--   drop table public.payment_operations, public.payment_operation_kinds;
--   delete from vault.secrets where name like 'pay:%';
--   drop type public.payment_operation_outcome;
