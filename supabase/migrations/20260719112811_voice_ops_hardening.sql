-- Voice-ops hardening (non-blocking follow-ups from the migration review of
-- 20260719104000). Both are additive + idempotent.

-- 1. Auto-maintain vox_log_exports.updated_at. The worker mutates this row
--    repeatedly (lease renewal + status transitions), so a trigger is more
--    robust than relying on every UPDATE path to set it by hand. Reuses the
--    existing public.set_updated_at() (202606240001) — same precedent as
--    app_settings / outreach_state.
drop trigger if exists vox_log_exports_set_updated_at on public.vox_log_exports;
create trigger vox_log_exports_set_updated_at
  before update on public.vox_log_exports
  for each row execute function public.set_updated_at();

-- 2. Constrain the account-callback state machine to its six documented values.
--    A singleton field driving a real external wiring action — a CHECK guards
--    against a typo'd state ever being persisted. Safe to add unconditionally:
--    the column currently only holds the 'unwired' default.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_voximplant_account_callback_state_check'
  ) then
    alter table public.app_settings
      add constraint app_settings_voximplant_account_callback_state_check
      check (
        voximplant_account_callback_state in
        ('unwired', 'pending', 'wired', 'failed', 'rollback_pending', 'rolled_back')
      );
  end if;
end $$;
