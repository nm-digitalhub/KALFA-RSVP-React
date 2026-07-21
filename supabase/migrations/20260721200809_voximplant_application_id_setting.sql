-- voximplant_application_id — which Voximplant application console-agent SDK
-- users are created in.
--
-- AddUser takes application_id (or application_name); the existing config carries
-- voximplant_rule_id and voximplant_caller_id but never the application itself,
-- because nothing until now needed to create anything INSIDE an application —
-- StartScenarios addresses a rule, not an app.
--
-- Configuration, not a constant: the account has more than one application
-- (kalfa-rsvp 11107202, kalfatest 11107302), and which one is production is an
-- operational fact that belongs in settings beside the rule and caller id.
-- Hard-coding it in provisioning code would put a business fact in source.
--
-- Nullable and unset: provisioning refuses cleanly when it is missing rather
-- than guessing which application to mint credentials in.
alter table public.app_settings
  add column if not exists voximplant_application_id text;

comment on column public.app_settings.voximplant_application_id is
  'Voximplant application that console-agent SDK users are provisioned into (AddUser). Discover with: npm run voximplant -- rules';
