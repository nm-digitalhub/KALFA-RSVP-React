-- call_analysis.rsvp_persisted — did the RSVP the agent reported actually land?
--
-- WHY: ElevenLabs success criteria are evaluated against the CONVERSATION
-- TRANSCRIPT only (docs: eleven-agents/customization/agent-analysis/
-- success-evaluation — "Each criterion is evaluated against the conversation
-- transcript"). A criterion therefore cannot see whether a client tool succeeded;
-- it infers from what was said. So an agent that says "רשמתי מבוגר אחד" scores
-- rsvp_captured = success even when the save failed a moment later.
--
-- That is not hypothetical. On 2026-07-21 three consecutive bridge calls scored
-- el_call_score 100 with rsvp_captured success and el_data
-- {status: attending, adults: 1}, while guests.updated_at stayed on 2026-07-07 —
-- nothing was written. The recording has the agent saying so plainly: "לא הצלחתי
-- לעדכן את זה במערכת". The agent was honest; the score was not.
--
-- This column is the measured counterpart: not what the transcript suggests, but
-- whether the guest row actually moved during this call.
--
--   true   the agent reported an outcome AND the guest row was written at/after
--          the attempt started
--   false  the agent reported an outcome and the guest row was NOT touched —
--          the guest was told (or believes) their RSVP was recorded and it was
--          not. This is the alarming state.
--   NULL   not assessable: no linked attempt, no guest bound to it, or the
--          conversation produced no rsvp_status (removal request, wrong person,
--          handed off). NULL is "we did not check", never "fine".
--
-- Deliberately compares TIMESTAMPS, not values. A guest already marked
-- 'attending' from an earlier channel would make a value comparison report
-- success for a call that wrote nothing.

alter table public.call_analysis
  add column if not exists rsvp_persisted boolean;

comment on column public.call_analysis.rsvp_persisted is
  'Whether the RSVP outcome the agent reported was actually written to the guest row during this call (timestamp comparison, not value). false = the agent believed it saved and nothing did. NULL = not assessable, never "fine". ElevenLabs criteria cannot see this — they only see the transcript.';

-- The operational question this exists to answer: which calls told a guest their
-- RSVP was recorded when it was not.
create index if not exists call_analysis_rsvp_not_persisted_idx
  on public.call_analysis (event_id, analysis_at)
  where rsvp_persisted = false;

-- Grants unchanged and restated: read-only for authenticated, as with the turn
-- counters added in 20260720202543.
revoke all on public.call_analysis from anon;
grant select on public.call_analysis to authenticated;
