-- Purpose: expose the existing (text) attempt -> analysis link as first-class
-- PostgREST *computed relationships*, so /admin/callbacks/[id] can load every
-- persona's AI call together with its ElevenLabs analysis in ONE request.
--
-- Ref: https://docs.postgrest.org/en/v14/references/api/resource_embedding.html
--      "Computed Relationships" (PostgREST >= 11; this project runs 14.5).
--
-- WHAT THIS CHANGES: nothing. No column, no constraint, no index, no policy,
-- no grant on any table, no row. A computed relationship is metadata only:
-- PostgREST reads pg_proc and offers the function as an embeddable resource.
-- It therefore applies retroactively to every existing row - no backfill.
--
-- WHY NO `set search_path = ''`: the house convention pins search_path on
-- SECURITY DEFINER functions. These are SECURITY INVOKER, and a SET clause
-- makes a SQL function NON-INLINABLE - inlining is precisely the property
-- PostgREST relies on for computed-relationship performance (see the doc
-- above). Safety is preserved instead by fully qualifying every reference.
--
-- WHY `rows 1` IS SOUND: call_analysis is UNIQUE (provider, conversation_id).
-- Pinning provider = 'elevenlabs' is what makes at most one row match, so the
-- relationship is genuinely many-to-one. If a SECOND provider is ever written
-- to call_analysis, these functions must be revisited (they would silently
-- become multi-row while PostgREST still treats them as to-one).
--
-- ROLLBACK:
--   drop function if exists public.call_analysis(public.sales_call_attempts);
--   drop function if exists public.call_analysis(public.callback_request_attempts);

create or replace function public.call_analysis(public.sales_call_attempts)
returns setof public.call_analysis
rows 1
language sql
stable
as $$
  select a.*
  from public.call_analysis a
  where a.provider = 'elevenlabs'
    and a.conversation_id = $1.el_conversation_id
$$;

comment on function public.call_analysis(public.sales_call_attempts) is
  'PostgREST computed relationship sales_call_attempts -> call_analysis over the '
  'text el_conversation_id link. provider is pinned so UNIQUE(provider, '
  'conversation_id) makes this genuinely to-one (rows 1).';

create or replace function public.call_analysis(public.callback_request_attempts)
returns setof public.call_analysis
rows 1
language sql
stable
as $$
  select a.*
  from public.call_analysis a
  where a.provider = 'elevenlabs'
    and a.conversation_id = $1.el_conversation_id
$$;

comment on function public.call_analysis(public.callback_request_attempts) is
  'PostgREST computed relationship callback_request_attempts -> call_analysis '
  'over the text el_conversation_id link. provider is pinned so '
  'UNIQUE(provider, conversation_id) makes this genuinely to-one (rows 1).';

-- Grants mirror the underlying tables. sales_call_attempts and
-- callback_request_attempts grant NOTHING to anon/authenticated (RLS on, zero
-- policies, service-role only), so only service_role may traverse these.
-- SECURITY INVOKER means RLS on call_analysis still applies to every caller.
revoke execute on function public.call_analysis(public.sales_call_attempts)
  from public, anon, authenticated;
revoke execute on function public.call_analysis(public.callback_request_attempts)
  from public, anon, authenticated;

grant execute on function public.call_analysis(public.sales_call_attempts)
  to service_role;
grant execute on function public.call_analysis(public.callback_request_attempts)
  to service_role;

-- No new index: the existing UNIQUE (provider, conversation_id) index already
-- covers the equality predicate on both of its leading columns.
