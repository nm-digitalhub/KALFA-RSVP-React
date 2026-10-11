-- callback_requests.origin — where each request to be called back came from.
--
-- WHY: a call made after the person asked to be called back is exempt from the national Do-Not-Call registry check
-- (Consumer Protection Law, Sixth Schedule, item 1), and the burden of proving the request is on the business. Today
-- four writers produce the same row shape and nothing records which one wrote it. Owner rulings 11.10.2026: a request
-- the person submitted counts as entered, and so does a call they placed to KALFA that went unanswered; only rows no
-- person initiated (a workflow, staff) are checked. Change: openspec/changes/dnc-registry-dial-gate (design D7,
-- task 2.1).
--
-- Values (open text, no CHECK list):
--   person_request  — the website contact form (inquiry-intake.ts) or a call-me-now request no agent could take
--   missed_call     — an inbound call no agent answered (console-calls.ts recordMissedCallCallback)
--   workflow        — a workflow's action.create_callback_request (guest-actions.ts)
--   staff           — created by staff
--   unknown         — the default; never treated as an exemption
--
-- BACKFILL (measured 11.10.2026: 18 rows):
--   * the two automatic writers stamp a fixed note: "נוצר אוטומטית משיחה נכנסת …" (missed_call) and
--     "נוצר אוטומטית מבקשת "התקשרו אליי עכשיו" …" (person_request);
--   * every other row came from the website form: the only other writer, the workflow node
--     action.create_callback_request, has never run (0 rows in workflow_run_steps, measured 11.10.2026).
--
-- ROLLBACK:
--   alter table public.callback_requests drop column if exists origin;

alter table public.callback_requests
  add column if not exists origin text not null default 'unknown' check (origin <> '');

comment on column public.callback_requests.origin is
  'Who created the request: person_request | missed_call | workflow | staff | unknown. person_request and missed_call exempt a call from the national Do-Not-Call registry check (Sixth Schedule item 1; owner rulings 11.10.2026); unknown never does.';

update public.callback_requests
   set origin = case
     when note like 'נוצר אוטומטית משיחה נכנסת%' then 'missed_call'
     when note like 'נוצר אוטומטית מבקשת "התקשרו אליי עכשיו"%' then 'person_request'
     else 'person_request'
   end
 where origin = 'unknown';
