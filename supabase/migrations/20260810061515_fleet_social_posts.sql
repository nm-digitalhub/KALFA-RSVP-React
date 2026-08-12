-- fleet_social_posts: ledger of what the autonomous fleet actually published
-- (or attempted to publish) to Instagram/Facebook, and when.
--
-- Nothing today tracks this independently of fleet_requests.status — this is
-- its own append-mostly audit trail, one row per (request, platform) attempt.
-- Plan: plans/fleet-social-publishing-capability-plan.md §4.3-4.4.
--
-- Status at the time of this migration: the `publish-social` CLI verb that
-- writes to this table is not yet wired up (fleet-social-publishing-capability
-- plan, stage 2). This migration only creates the table so it exists ahead of
-- that wiring; it is inert on its own — no other table, RLS policy, or code
-- path is touched, and it introduces zero behavior change.
--
-- Access model: service_role only, no exceptions. Mirrors push_delivery_log
-- (20260708233928) — RLS enabled with zero policies, and the Supabase default
-- grants to anon/authenticated stripped explicitly (revoking from PUBLIC does
-- not touch grants already made to a named role; see
-- 20260729160205_fleet_owner_request_revoke_anon.sql). No browser access is
-- needed for v1.

create table public.fleet_social_posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fleet_requests(id),
  platform text not null check (platform in ('instagram', 'facebook')),
  -- 'dry_run' is included up front so stage 2 (§7, publish-social --dry-run)
  -- doesn't hit this CHECK later — it's unused until stage 2 itself ships.
  status text not null check (status in ('publishing', 'published', 'failed', 'dry_run')),
  external_post_id text,
  permalink text,
  -- Copied from fleet_requests.payload.attachments[].sha256 (computed there by
  -- cmdRequest, see §4.5 item 2) once publish-social has verified the match —
  -- not new input, just an audit-independent copy in this ledger table.
  caption_sha256 text not null,
  image_sha256 text,
  attempt_count int not null default 1,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fleet_social_posts_request_platform_key unique (request_id, platform)
);

alter table public.fleet_social_posts enable row level security;
-- Deliberately no policies for anon/authenticated — this table is reachable
-- only by service_role, the same shape as fleet_requests itself. No browser
-- access is needed for v1.

revoke all on public.fleet_social_posts from public;
revoke all on public.fleet_social_posts from anon;
revoke all on public.fleet_social_posts from authenticated;

grant select, insert, update, delete on public.fleet_social_posts to service_role;

comment on table public.fleet_social_posts is
  'Ledger of fleet social-publishing attempts (one row per request+platform). service_role only; not yet written by any code path.';
