-- A random reference code for each cancellation request, and the insert hole closed.
--
-- WHY (1) — the number leaks volume: customers and staff are shown request_number, a running identity (#1, #3, #4…),
-- which tells anyone how many cancellation requests exist and how fast they arrive. A random code tells nothing. Owner
-- decision 9.10.2026: a random code (option B), not a sequence with a prefix. Sqids/Hashids were ruled out: their own
-- FAQ says their ids decode back to the number. request_number stays, for internal ordering only.
--
-- WHY (2) — the insert hole (measured 9.10.2026, as a signed-in customer, inside a transaction that was rolled back):
-- the authenticated role held INSERT on every column, and ecr_owner_insert checks only the owner and the event. A
-- customer could insert a request already status='resolved', resolution='full_cancellation', any resolution_amount,
-- resolved_by = themself, and a sumit_document_url of their choosing — which /admin/cancellations/[id] renders to staff
-- as a "קבלה / תעודת זיכוי" link. The database accepted all of it. A customer needs four columns; they get four.
--
-- WHAT IT DOES:
--   1. new_cancellation_request_code(): 8 symbols of Crockford Base32 (0-9 and A-Z without I, L, O, U — no symbols
--      that read alike, no accidental words), from pgcrypto's gen_random_bytes, as XXXX-XXXX. 256 is a multiple of 32,
--      so byte % 32 is uniform. 32^8 ≈ 1.1e12 codes; the unique constraint holds anyway, and the app retries a
--      collision (createCancellationRequest).
--   2. request_code: NOT NULL, UNIQUE, format-checked, DEFAULT that function. Adding a column with a VOLATILE default
--      rewrites the table and computes the value per existing row (PostgreSQL 17, ddl-alter.html / sql-altertable.html
--      Notes) — no UPDATE runs, so event_cancellation_requests_no_remutate (which refuses any UPDATE of a resolved row;
--      all 3 rows are resolved) is not involved and stays in force.
--   3. a BEFORE UPDATE trigger that refuses any change to request_code.
--   4. INSERT for authenticated narrowed to (event_id, owner_id, reason, sms_consent); anon loses INSERT (RLS already
--      refused it: the policy needs auth.uid()). Every other column — status, resolution, amounts, documents, the code —
--      is the server's to write (service role).
--
-- WHAT IT DOES NOT DO: change any existing column or row value, request_number, RLS policies, or the update guard.
--
-- ROLLBACK:
--   revoke insert on table public.event_cancellation_requests from authenticated;
--   grant insert on table public.event_cancellation_requests to anon, authenticated;
--   drop trigger event_cancellation_requests_code_immutable on public.event_cancellation_requests;
--   drop function public.event_cancellation_requests_code_immutable();
--   alter table public.event_cancellation_requests drop column request_code;
--   drop function public.new_cancellation_request_code();

set lock_timeout = '5s';
set statement_timeout = '60s';

create function public.new_cancellation_request_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return substr(code, 1, 4) || '-' || substr(code, 5, 4);
end;
$$;

comment on function public.new_cancellation_request_code() is
  'A random cancellation-request reference: 8 Crockford Base32 symbols as XXXX-XXXX (pgcrypto randomness). Shown as CX-XXXX-XXXX.';

alter table public.event_cancellation_requests
  add column request_code text not null default public.new_cancellation_request_code();

alter table public.event_cancellation_requests
  add constraint event_cancellation_requests_request_code_key unique (request_code),
  add constraint event_cancellation_requests_request_code_format
    check (request_code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

comment on column public.event_cancellation_requests.request_code is
  'The reference customers and staff see (CX- + this). Random, set by the database on insert, never changed. request_number is internal ordering only.';

create function public.event_cancellation_requests_code_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_code is distinct from old.request_code then
    raise exception 'event_cancellation_requests: request_code of row % cannot change', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger event_cancellation_requests_code_immutable
  before update on public.event_cancellation_requests
  for each row execute function public.event_cancellation_requests_code_immutable();

revoke insert on table public.event_cancellation_requests from anon, authenticated;
grant insert (event_id, owner_id, reason, sms_consent) on table public.event_cancellation_requests to authenticated;

-- ── Verification ──
do $$
declare
  v_missing int;
  v_cols text;
begin
  select count(*) into v_missing from public.event_cancellation_requests where request_code is null;
  if v_missing > 0 then
    raise exception '% rows have no request_code', v_missing;
  end if;

  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'event_cancellation_requests'
     and grantee = 'authenticated' and privilege_type = 'INSERT';
  if v_cols is distinct from 'event_id,owner_id,reason,sms_consent' then
    raise exception 'authenticated may insert unexpected columns: %', v_cols;
  end if;
end $$;
