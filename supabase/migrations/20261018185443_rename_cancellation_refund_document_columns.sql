-- event_cancellation_requests.sumit_document_id / sumit_document_url are renamed refund_document_id / refund_document_url (owner,
-- 18.10.2026: no clearing company's name in a column that holds any company's document).
--
-- WHY. The two columns keep the credit document of the request's refund, as the refund returned it (event-cancellation.ts,
-- resolveCancellationRequest). They were named in 20260821142147, when SUMIT was the only clearing company. Since the CardCom pilot
-- a CardCom refund writes its document link here too (its id stays null: CardCom names a document by its number, not an id).
--
-- WHAT ELSE READS THEM (read on the live database, 18.10.2026):
--   - public.test_event_purge_blocker(uuid) reads sumit_document_id. Its body is stored as text (LANGUAGE sql, not BEGIN ATOMIC), so
--     the rename does not reach it: it is replaced below with the same body and the new name. CREATE OR REPLACE keeps its owner and
--     grants;
--   - the column grants (authenticated SELECT; service_role SELECT, INSERT, UPDATE) belong to the column, not its name, and follow it;
--   - no view, policy, index, constraint or trigger names them.
-- Data: 5 rows, none with a document id, one with a document link. A rename moves no data.
--
-- DEPLOY ORDER. The application deployed today reads and writes the old names. Apply this migration and deploy the code that uses
-- the new names together, with no cancellation request being approved in between: until the new code is live, the admin
-- cancellation screen cannot load a request, and approving one fails after its refund (approving it again resumes it — a package
-- refund is made once per request).
--
-- ROLLBACK (with the code that uses the old names):
--   alter table public.event_cancellation_requests rename column refund_document_id to sumit_document_id;
--   alter table public.event_cancellation_requests rename column refund_document_url to sumit_document_url;
--   and test_event_purge_blocker again as in 20261012000132_purge_test_event_coupons_aware.sql.

alter table public.event_cancellation_requests rename column sumit_document_id to refund_document_id;
alter table public.event_cancellation_requests rename column sumit_document_url to refund_document_url;

-- The body of 20261012000132_purge_test_event_coupons_aware.sql, with the new column name only.
create or replace function public.test_event_purge_blocker(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    -- personal-coupons: an ever-approved campaign has a LOCKED pricing round, which is undeletable history (D6).
    when exists (
      select 1 from public.campaign_pricing p
      join public.campaigns c on c.id = p.campaign_id
      where c.event_id = p_event and p.locked_at is not null
    ) then 'approved_terms'
    when exists (
      select 1 from public.campaigns c
      where c.event_id = p_event
        and c.status::text in ('billed', 'paid', 'awaiting_invoice')
    ) then 'financial_activity'
    when exists (
      select 1 from public.payment_operations o where o.event_id = p_event
    ) then 'financial_activity'
    when exists (
      select 1 from public.event_cancellation_requests r
      where r.event_id = p_event
        and (r.refund_document_id is not null or coalesce(r.resolution_amount, 0) > 0)
    ) then 'financial_activity'
    else null
  end;
$fn$;
