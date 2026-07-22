-- monitor_enabled — kill switch for human-agent monitor / takeover.
--
-- The /api/calls/{id}/monitor route is built and testable, but the leg it
-- requests only becomes real once the RSVPAgent scenario is redeployed with the
-- conference-mixer handler AND that change is verified on a live call (scenario
-- topology cannot be verified any other way — CLAUDE.md: transcribe real audio).
--
-- Until that verified deploy, the route must NOT answer 202 and do nothing — a
-- console that shows "listen" and silently never joins is the exact silent-no-op
-- this project keeps closing. With this flag OFF (the default) the route returns
-- a clear "not enabled" instead. It is flipped ON only after the live-call
-- verification, the same shape as voximplant_live_calls and
-- billing_exposure_gate.
alter table public.app_settings
  add column if not exists monitor_enabled boolean not null default false;

comment on column public.app_settings.monitor_enabled is
  'Gate for human-agent monitor/takeover. OFF until the RSVPAgent conference handler is deployed and verified on a live call. See docs/voice-agent/app-integration-reference.md.';
