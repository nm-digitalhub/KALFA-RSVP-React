-- =====================================================================
-- Call-me-now (capability A, third design) — the Voximplant ROUTING RULE
-- ID that StartScenarios must target, stored as admin config rather than
-- baked into the route.
--
-- Why a column and not a constant in verify/route.ts: a rule id is a
-- platform-assigned identity that CHANGES whenever a rule is recreated
-- (two new rules were created on this account on 12.8 and were assigned
-- fresh ids). This codebase already has exactly one precedent for that
-- fact — app_settings.voximplant_rule_id, read by getVoximplantConfig()
-- — and NO precedent for a hard-coded rule id anywhere in src/ (verified
-- by grep for every live rule id: 1494311/1520915/1523083/1523084/
-- 1494687 appear only inside explanatory comments). Following the
-- existing precedent keeps rotation a DB edit instead of a redeploy, and
-- avoids inventing a second, divergent convention for the same kind of
-- value.
--
-- Deliberately NULLABLE with no default: absent/blank means "no rule
-- bound yet", which verify/route.ts already treats as fail-closed via its
-- numeric guard (/^\d+$/). So applying this migration does NOT by itself
-- make call-me-now reachable — it stays inert until an admin writes a
-- real id here AND console_call_me_now_enabled is flipped on, which are
-- two separate deliberate acts.
--
-- getVoximplantConfig() reads app_settings with select('*'), so it picks
-- this column up with no code change required at read time; the typed
-- surface is added alongside this migration.
-- =====================================================================

alter table public.app_settings
  add column voximplant_call_me_now_rule_id text;

comment on column public.app_settings.voximplant_call_me_now_rule_id is
  'Voximplant routing-rule id for the ConsoleCallMeNow scenario, targeted by StartScenarios from /api/call-me-now/verify. NULL/blank = no rule bound yet (fail-closed: the route refuses before placing any call). Separate from voximplant_rule_id, which is the OutCall/AI-campaign rule.';
