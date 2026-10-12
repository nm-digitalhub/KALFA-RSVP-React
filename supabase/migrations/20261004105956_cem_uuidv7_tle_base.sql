-- HISTORICAL BASE MIGRATION #3 — packages the cem-uuidv7 TLE for from-scratch replays. Written 12.10.2026 (the
-- drift-repair procedure, per support: install the extension in the local Postgres BEFORE the migration that
-- creates it — never weaken `create extension` and never substitute the generator).
--
-- cem-uuidv7 is a pg_tle TRUSTED LANGUAGE EXTENSION: its source lives inside the database, not on disk. On
-- production it was installed via database.dev (owner, 24.09.2026); a fresh replica has no extension files, so
-- 20261004105957's `create extension` fails with 0A000. This file registers THE EXACT PRODUCTION BODY — read
-- verbatim from pgtle."cem-uuidv7--1.0.2.sql"() on 12.10.2026 — so `create extension` finds it and the behavior
-- (RFC-4122 v7, Fabio Lima's MIT implementation, Colin Emonds' TLE packaging) is identical everywhere.
--
-- Version 20261004105956 sorts one tick before 20261004105957. SAFE ON ANY DATABASE: the guard makes it a no-op
-- where the TLE is already registered (production). It is recorded there with
--   supabase migration repair 20261004105956 --status applied
-- like its sibling base files, so it only ever executes on replays.

create extension if not exists pg_tle;

do $install$
begin
  if exists (select 1 from pgtle.available_extensions() where name = 'cem-uuidv7') then
    raise notice 'cem-uuidv7 already registered; skipping';
    return;
  end if;
  perform pgtle.install_extension(
    'cem-uuidv7',
    '1.0.2',
    'UUIDv7 extension',
$tle_body$
/*
 * MIT License
 *
 * Copyright (c) 2023-2024 Fabio Lima
 * 
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 * 
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 * 
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

/* Colin Emonds: Change function names to make this fit the uuid_ossp feel, and package as TLE. */
 
/**
 * Returns a time-ordered with Unix Epoch UUID (UUIDv7).
 * 
 * Referencies:
 * - https://github.com/uuid6/uuid6-ietf-draft
 * - https://github.com/ietf-wg-uuidrev/rfc4122bis
 *
 * MIT License.
 *
 * Tags: uuid guid uuid-generator guid-generator generator time order rfc4122 rfc-4122
 */
create or replace function uuid_generate_v7()
returns uuid
security invoker
volatile
as $$
declare
begin
	return @extschema@.uuid7_from_timestamp(clock_timestamp());
end $$ language plpgsql;

create or replace function uuid7_from_timestamp(p_timestamp timestamp with time zone)
returns uuid
security invoker
volatile
strict
as $$
declare

	v_time numeric := null;

	v_unix_t numeric := null;
	v_rand_a numeric := null;
	v_rand_b numeric := null;

	v_unix_t_hex varchar := null;
	v_rand_a_hex varchar := null;
	v_rand_b_hex varchar := null;

	v_output_bytes bytea := null;

	c_milli_factor numeric := 10^3::numeric;  -- 1000
	c_micro_factor numeric := 10^6::numeric;  -- 1000000
	c_scale_factor numeric := 4.096::numeric; -- 4.0 * (1024 / 1000)
	
	c_version bit(64) := x'0000000000007000'; -- RFC-4122 version: b'0111...'
	c_variant bit(64) := x'8000000000000000'; -- RFC-4122 variant: b'10xx...'

begin

	v_time := extract(epoch from p_timestamp);

	v_unix_t := trunc(v_time * c_milli_factor);
	v_rand_a := ((v_time * c_micro_factor) - (v_unix_t * c_milli_factor)) * c_scale_factor;
	v_rand_b := random()::numeric * 2^62::numeric;

	v_unix_t_hex := lpad(to_hex(v_unix_t::bigint), 12, '0');
	v_rand_a_hex := lpad(to_hex((v_rand_a::bigint::bit(64) | c_version)::bigint), 4, '0');
	v_rand_b_hex := lpad(to_hex((v_rand_b::bigint::bit(64) | c_variant)::bigint), 16, '0');

	v_output_bytes := decode(v_unix_t_hex || v_rand_a_hex || v_rand_b_hex, 'hex');

	return encode(v_output_bytes, 'hex')::uuid;
	
end $$ language plpgsql;

-------------------------------------------------------------------
-- EXAMPLE:
-------------------------------------------------------------------
-- 
-- select uuid7() uuid, clock_timestamp()-statement_timestamp() time_taken;
--
-- |uuid                                  |time_taken        |
-- |--------------------------------------|------------------|
-- |018da240-e0db-72e1-86f5-345c2c240387  |00:00:00.000222   |
-- 

-------------------------------------------------------------------
-- EXAMPLE: generate a list
-------------------------------------------------------------------
-- 
-- with x as (select clock_timestamp() as t from generate_series(1, 1000))
-- select uuid7(x.t) uuid, x.t::text ts from x;
-- 
-- |uuid                                |ts                           |
-- |------------------------------------|-----------------------------|
-- |018da235-6271-70cd-a937-0bb7d22b801e|2024-02-13 08:23:44.113054-03|
-- |018da235-6271-7214-9188-1d3191883b5d|2024-02-13 08:23:44.113126-03|
-- |018da235-6271-723d-bebe-87f66085fad7|2024-02-13 08:23:44.113143-03|
-- |018da235-6271-728f-86ba-6e277d10c0a3|2024-02-13 08:23:44.113156-03|
-- |018da235-6271-72b8-9887-f31e4ca48020|2024-02-13 08:23:44.113168-03|
-- |018da235-6271-72e1-bbeb-8b686d0d4281|2024-02-13 08:23:44.113179-03|
-- |018da235-6271-730a-96a2-73275626f72a|2024-02-13 08:23:44.113190-03|
-- |018da235-6271-7333-8a5c-9d1ab89dc489|2024-02-13 08:23:44.113201-03|
-- |018da235-6271-735c-ba64-a42b55ad7d5c|2024-02-13 08:23:44.113212-03|
-- |018da235-6271-7385-a0fb-c65f5be24073|2024-02-13 08:23:44.113223-03|
--

-------------------------------------------------------------------
-- FOR TEST: the expected result is an empty result set
-------------------------------------------------------------------
-- 
-- with t as (select uuid7() as id from generate_series(1, 1000))
-- select * from t where (id is null or id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$');
--

$tle_body$
  );
end $install$;
