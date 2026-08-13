-- =====================================================================
-- Call-center research (12.8) — capability A, THIRD design ("call-me-now"):
-- the WebRTC widget was accepted as blocked (an unauthenticated endpoint
-- that mints telephony credentials, even for a shared identity, is a real
-- attack surface — see console-calls.ts's evaluateWidgetCallCaps header for
-- that finding, kept as dead-but-inert code pending an explicit cleanup
-- decision). This is the replacement design: the visitor types their own
-- phone number, proves control of it via SMS OTP (reusing the EXISTING
-- otp_challenges machinery, unchanged), and the SERVER places a real
-- outbound PSTN call to them and bridges it to a console agent —
-- StartScenarios, the SAME Management-API primitive already proven in
-- production by the outbound AI-call campaign (dispatchOutreachCall /
-- scripts/voximplant/bridge-call.ts), not a new mechanism.
--
-- No browser ever holds a Voximplant identity for this flow, so there is no
-- MAU question and no credential-issuing endpoint at all — the objection
-- that blocked the widget does not apply here by construction.
-- =====================================================================

-- 1 · console_calls.kind — add 'call_me_now' alongside the existing five
-- values (constraint verified live via pg_constraint, project convention;
-- 'widget' was added by 20260812194830_callcenter_widget_kind.sql, earlier
-- in this migration chain).
alter table public.console_calls
  drop constraint console_calls_kind_check;
alter table public.console_calls
  add constraint console_calls_kind_check
  check (kind in ('manual', 'inbound_customer', 'internal', 'ai_handoff', 'widget', 'call_me_now'));

-- 2 · Go-live flag — same discipline as every other capability in this
-- project (console_softphone_enabled, console_manual_dial_enabled,
-- inbound_calls_enabled, console_widget_enabled, console_wake_enabled):
-- default FALSE, admin-only RLS (app_settings already has this posture; no
-- new policy needed), a single owner "בצע" flips it. Flipping this does NOT
-- by itself place any call — there is no Voximplant rule bound to the new
-- ConsoleCallMeNow scenario until that is separately created, uploaded, and
-- approved (see console-calls.ts's evaluateCallMeNowCaps header).
alter table public.app_settings
  add column console_call_me_now_enabled boolean not null default false;

comment on column public.app_settings.console_call_me_now_enabled is
  'Feature flag for the OTP-verified "call me now" capability (capability A, third design, 12.8). Default FALSE. Gates /api/call-me-now/verify''s admission check only — has no effect until a Voximplant rule+scenario (ConsoleCallMeNow) are separately created, uploaded, and approved.';

-- No new columns on console_call_pii or otp_challenges: the visitor's phone
-- is stored exactly the way every other console_calls row stores its
-- target phone (console_call_pii.phone_e164), and OTP verification proof is
-- consumed atomically by otp.ts's existing verifyOtp() before a
-- console_calls row is ever created for this kind — there is nothing left
-- to persist about the verification itself. The per-visitor rate limit
-- reuses the EXISTING countAnsweredLastHourForPhone(phone) (console-calls.ts)
-- unchanged: it already counts any console_call_pii row for a phone in the
-- last hour regardless of kind, which is exactly the property this cap
-- needs, so this migration adds nothing for it. The dial-token mechanism
-- (console_call_pii.dial_token_hash/dial_token_expires_at) is reused as-is
-- with a third prefix ('cn') — see mintDialToken/verifyDialToken's
-- DIAL_TOKEN_PREFIXES in console-calls.ts.
