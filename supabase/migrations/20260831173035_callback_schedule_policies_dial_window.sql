-- Makes the actual-dial hours window admin-editable (/admin/callbacks/policy,
-- new "חיוג" tab) — previously HUMAN_CALL_WINDOW in console-calls.ts, a
-- hardcoded constant (08:00–19:00 Sun–Thu, 08:00–13:00 Fri, closed Sat) that
-- evaluateSharedConsentGates enforced on every live dial, completely
-- independent of the `weekday` scheduling window already on this table (which
-- only governs when a NEW callback may be booked onto the calendar).
--
-- Same shape and CHECK-constraint pattern as the existing sun_start_min..
-- sat_end_min columns. Seed values below match HUMAN_CALL_WINDOW verbatim so
-- existing behavior is unchanged until an admin edits them.

alter table public.callback_schedule_policies
  add column dial_sun_start_min smallint,
  add column dial_sun_end_min smallint,
  add column dial_mon_start_min smallint,
  add column dial_mon_end_min smallint,
  add column dial_tue_start_min smallint,
  add column dial_tue_end_min smallint,
  add column dial_wed_start_min smallint,
  add column dial_wed_end_min smallint,
  add column dial_thu_start_min smallint,
  add column dial_thu_end_min smallint,
  add column dial_fri_start_min smallint,
  add column dial_fri_end_min smallint,
  add column dial_sat_start_min smallint,
  add column dial_sat_end_min smallint;

alter table public.callback_schedule_policies
  add constraint callback_schedule_policies_dial_sun_check
    check ((dial_sun_start_min is null) = (dial_sun_end_min is null)
      and (dial_sun_start_min is null or (dial_sun_start_min between 0 and 1439 and dial_sun_end_min between 1 and 1440 and dial_sun_start_min < dial_sun_end_min))),
  add constraint callback_schedule_policies_dial_mon_check
    check ((dial_mon_start_min is null) = (dial_mon_end_min is null)
      and (dial_mon_start_min is null or (dial_mon_start_min between 0 and 1439 and dial_mon_end_min between 1 and 1440 and dial_mon_start_min < dial_mon_end_min))),
  add constraint callback_schedule_policies_dial_tue_check
    check ((dial_tue_start_min is null) = (dial_tue_end_min is null)
      and (dial_tue_start_min is null or (dial_tue_start_min between 0 and 1439 and dial_tue_end_min between 1 and 1440 and dial_tue_start_min < dial_tue_end_min))),
  add constraint callback_schedule_policies_dial_wed_check
    check ((dial_wed_start_min is null) = (dial_wed_end_min is null)
      and (dial_wed_start_min is null or (dial_wed_start_min between 0 and 1439 and dial_wed_end_min between 1 and 1440 and dial_wed_start_min < dial_wed_end_min))),
  add constraint callback_schedule_policies_dial_thu_check
    check ((dial_thu_start_min is null) = (dial_thu_end_min is null)
      and (dial_thu_start_min is null or (dial_thu_start_min between 0 and 1439 and dial_thu_end_min between 1 and 1440 and dial_thu_start_min < dial_thu_end_min))),
  add constraint callback_schedule_policies_dial_fri_check
    check ((dial_fri_start_min is null) = (dial_fri_end_min is null)
      and (dial_fri_start_min is null or (dial_fri_start_min between 0 and 1439 and dial_fri_end_min between 1 and 1440 and dial_fri_start_min < dial_fri_end_min))),
  add constraint callback_schedule_policies_dial_sat_check
    check ((dial_sat_start_min is null) = (dial_sat_end_min is null)
      and (dial_sat_start_min is null or (dial_sat_start_min between 0 and 1439 and dial_sat_end_min between 1 and 1440 and dial_sat_start_min < dial_sat_end_min)));

update public.callback_schedule_policies
set
  dial_sun_start_min = 480, dial_sun_end_min = 1140,
  dial_mon_start_min = 480, dial_mon_end_min = 1140,
  dial_tue_start_min = 480, dial_tue_end_min = 1140,
  dial_wed_start_min = 480, dial_wed_end_min = 1140,
  dial_thu_start_min = 480, dial_thu_end_min = 1140,
  dial_fri_start_min = 480, dial_fri_end_min = 780,
  dial_sat_start_min = null, dial_sat_end_min = null
where id = true;

comment on column public.callback_schedule_policies.dial_sun_start_min is
  'The actual-dial window (when a live call may be PLACED, not merely scheduled) — see console-calls.ts evaluateSharedConsentGates. Separate from sun_start_min, which only governs new-callback scheduling.';
