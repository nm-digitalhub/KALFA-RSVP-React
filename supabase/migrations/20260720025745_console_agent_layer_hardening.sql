-- Hardening per security advisors:
-- trigger function must not be RPC-callable at all
revoke execute on function public.sync_console_call_feed() from anon, authenticated;
-- gate helper: not callable by anon (authenticated keeps EXECUTE — RLS policies and views invoke it)
revoke execute on function public.is_console_agent() from anon;
